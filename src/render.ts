import type { ThemeKey } from './data';
import type { GameEvent, GameMode, Hazard, Pickup, RivalSnakeView, SnakeGame } from './game';
import { clamp, seededRandom, type Point } from './math';
import { fitGardenViewport, type ViewportInfo } from './viewport';

interface Palette { grass: string; deep: string; light: string; flower: string; shadow: string; water: string; glow: string }

const PALETTES: Record<ThemeKey, Palette> = {
  greenhouse: { grass: '#a9c88b', deep: '#416949', light: '#e4edb6', flower: '#e9ad72', shadow: '#31563d', water: '#77b7a4', glow: '#fff0be' },
  creek: { grass: '#91ba9f', deep: '#355d55', light: '#cfe1b6', flower: '#e6c36f', shadow: '#294a46', water: '#76b9c1', glow: '#f2efc1' },
  moon: { grass: '#6f8582', deep: '#334f53', light: '#d2d6ae', flower: '#d9b585', shadow: '#263f47', water: '#76a0a0', glow: '#e8edc1' },
};

export type { ViewportInfo } from './viewport';

export class GardenRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly board: HTMLElement;
  private readonly random = seededRandom('qinglan-painting');
  private readonly tufts = Array.from({ length: 110 }, () => ({ x: this.random(), y: this.random(), length: 2 + this.random() * 6, turn: this.random() * Math.PI * 2 }));
  private dpr = 1;
  private game: SnakeGame | null = null;
  private mode: GameMode | 'menu' = 'menu';
  private lowMotion = false;
  private gentleQuality = false;
  private reduceFlash = false;
  private crashAt = -Infinity;
  private bursts: Array<{ x: number; y: number; at: number; color: string; amount: number }> = [];
  private lastViewport: ViewportInfo = { scale: 1, height: 600, left: 0, top: 0, width: 1000 };
  private width = 1000;
  private height = 600;

  constructor(canvas: HTMLCanvasElement, board: HTMLElement) {
    this.canvas = canvas;
    this.board = board;
    const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!context) throw new Error('Canvas 2D is not supported by this browser.');
    this.context = context;
    this.resize();
  }

  setGame(game: SnakeGame | null, mode: GameMode | 'menu', lowMotion: boolean, gentleQuality: boolean, reduceFlash = false): void {
    this.game = game;
    this.mode = mode;
    this.lowMotion = lowMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.gentleQuality = gentleQuality;
    this.reduceFlash = reduceFlash;
  }

  feedback(event: GameEvent, point: Point, now: number): void {
    if (event === 'crash') this.crashAt = now;
    if (!['collect', 'rare', 'dew', 'power', 'combo'].includes(event)) return;
    const color = event === 'dew' ? '#c9e5dc' : event === 'rare' ? '#f2cf84' : event === 'power' ? '#cadb9b' : '#f3d9a2';
    this.bursts.push({ x: point.x, y: point.y, at: now, color, amount: this.reduceFlash ? 5 : event === 'combo' ? 10 : 7 });
    if (this.bursts.length > 10) this.bursts.shift();
  }

  get viewport(): ViewportInfo { return { ...this.lastViewport }; }

  resize(): ViewportInfo {
    const viewport = this.board.getBoundingClientRect();
    const dprLimit = this.gentleQuality ? 1.25 : 2;
    this.dpr = Math.min(dprLimit, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(window.innerWidth * this.dpr);
    const pixelHeight = Math.round(window.innerHeight * this.dpr);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
      this.canvas.style.width = `${window.innerWidth}px`;
      this.canvas.style.height = `${window.innerHeight}px`;
    }
    this.lastViewport = fitGardenViewport(viewport);
    this.width = this.lastViewport.width;
    this.height = this.lastViewport.height;
    return this.viewport;
  }

  render(now: number): void {
    const ctx = this.context;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const base = ctx.createLinearGradient(0, 0, screenW, screenH);
    base.addColorStop(0, '#d8e2c7');
    base.addColorStop(0.52, '#c8d8bf');
    base.addColorStop(1, '#eeddb7');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, screenW, screenH);
    this.drawOutsideGarden(now);
    const view = this.lastViewport;
    const game = this.game;
    const theme: ThemeKey = game?.level?.theme ?? 'greenhouse';
    const palette = PALETTES[theme];
    const crashAge = now - this.crashAt;
    const shakeStrength = game?.ended === 'crash' && game.settings.cameraShake && !this.lowMotion && crashAge >= 0 && crashAge < 230 ? (1 - crashAge / 230) * 4 : 0;
    const shakeX = shakeStrength > 0 ? Math.sin(crashAge * .08) * shakeStrength : 0;
    const shakeY = shakeStrength > 0 ? Math.cos(crashAge * .09) * shakeStrength * .45 : 0;
    ctx.save();
    ctx.translate(view.left + shakeX, view.top + shakeY);
    ctx.scale(view.scale, view.scale);
    this.drawGround(palette, now);
    this.drawPathHints(game, palette);
    if (game) {
      const rivals = game.rivalSnakes;
      this.drawRivalRoutes(rivals);
      const hazards = game.hazardStates();
      for (const hazard of hazards) this.drawHazard(hazard, palette, now);
      for (const pickup of game.pickups) this.drawPickup(pickup, palette, now);
      this.drawGate(game, palette, now);
      for (const rival of rivals) this.drawRivalSnake(rival, now);
      this.drawSnake(game, palette, now);
      this.drawBursts(now, palette);
      if (game.effectGlow > 0) this.drawSafeGuide(game, palette, now);
      if (game.invulnerable > 0 && !this.lowMotion) this.drawShield(game, now);
    } else {
      this.drawIdleScene(palette, now);
    }
    this.drawGroundEdge(palette);
    ctx.restore();
    this.drawAmbientWisps(now, palette);
  }

  private drawOutsideGarden(now: number): void {
    const ctx = this.context;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.save();
    const drawCorner = (x: number, y: number, flipX: number, flipY: number): void => {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(flipX, flipY);
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#5a805a';
      for (let i = 0; i < 8; i += 1) {
        const angle = -0.82 + i * 0.23;
        const length = 64 + i * 8;
        ctx.save();
        ctx.rotate(angle + Math.sin(now * 0.0005 + i) * (this.lowMotion ? 0.002 : 0.035));
        this.leaf(ctx, 0, -length * 0.56, 16 + i * 0.7, length * 0.7, '#66875b', i % 2 ? '#92aa75' : '#7e9d68');
        ctx.restore();
      }
      ctx.restore();
    };
    drawCorner(-18, 15, 1, 1);
    drawCorner(w + 18, 12, -1, 1);
    drawCorner(-12, h + 12, 1, -1);
    drawCorner(w + 18, h + 18, -1, -1);
    ctx.restore();
  }

  private drawGround(palette: Palette, now: number): void {
    const ctx = this.context;
    const ground = ctx.createLinearGradient(0, 0, this.width, this.height);
    ground.addColorStop(0, palette.grass);
    ground.addColorStop(0.52, this.mode === 'daily' ? '#81ae92' : '#9cbe85');
    ground.addColorStop(1, palette.deep);
    ctx.beginPath();
    ctx.roundRect(0, 0, this.width, this.height, 36);
    ctx.fillStyle = '#36593f';
    ctx.shadowColor = 'rgba(39, 62, 39, 0.24)';
    ctx.shadowBlur = 34;
    ctx.shadowOffsetY = 15;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.save();
    ctx.clip();
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, this.width, this.height);
    const wash = ctx.createRadialGradient(this.width * 0.38, this.height * 0.35, 8, this.width * 0.45, this.height * 0.45, Math.max(this.width, this.height) * 0.7);
    wash.addColorStop(0, 'rgba(250, 244, 205, 0.17)');
    wash.addColorStop(1, 'rgba(23, 58, 45, 0.22)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, this.width, this.height);
    this.drawGroundPatches(palette);
    this.drawTufts(now, palette);
    this.drawBedEdges(palette);
    ctx.restore();
  }

  private drawGroundPatches(palette: Palette): void {
    const ctx = this.context;
    for (let i = 0; i < 17; i += 1) {
      const x = (i * 181 + 63) % this.width;
      const y = ((i * 233 + 95) % Math.max(300, this.height - 40)) + 20;
      const rx = 26 + (i * 17 % 54);
      const ry = 16 + (i * 13 % 32);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((i % 5) * 0.41);
      ctx.beginPath();
      ctx.ellipse(0, 0, rx * 1.8, ry * 1.65, 0, 0, Math.PI * 2);
      ctx.fillStyle = i % 3 ? 'rgba(228, 236, 186, 0.035)' : `${palette.light}12`;
      ctx.fill();
      ctx.restore();
    }
  }

  private drawTufts(now: number, palette: Palette): void {
    const ctx = this.context;
    ctx.lineCap = 'round';
    for (const tuft of this.tufts) {
      const x = 20 + tuft.x * (this.width - 40);
      const y = 20 + tuft.y * Math.max(160, this.height - 40);
      const sway = this.lowMotion ? 0 : Math.sin(now * 0.00075 + tuft.x * 12) * 0.025;
      const length = tuft.length;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(tuft.turn) * length * 0.4, y + Math.sin(tuft.turn) * length * 0.4, x + Math.sin(tuft.turn + sway) * length, y - Math.cos(tuft.turn + sway) * length);
      ctx.strokeStyle = 'rgba(239, 241, 193, 0.12)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    ctx.strokeStyle = `${palette.light}55`;
  }

  private drawBedEdges(palette: Palette): void {
    const ctx = this.context;
    const edgePad = Math.max(34, 50 / this.lastViewport.scale);
    ctx.globalAlpha = 0.22;
    for (let x = 52; x < this.width - 20; x += 125) {
      const y = 14 + (x % 3) * 5;
      this.leaf(ctx, x, y + 24, 12, 30, palette.deep, palette.light);
      this.leaf(ctx, x + 14, this.height - 28, 14, 33, palette.deep, '#c5d89b');
    }
    ctx.globalAlpha = 0.18;
    for (let y = edgePad + 6; y < this.height - edgePad; y += 110) {
      this.leaf(ctx, 10, y, 10, 22, palette.deep, palette.light);
      this.leaf(ctx, this.width - 11, y + 24, 10, 24, palette.deep, palette.light);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(245, 238, 201, 0.32)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(10, 10, this.width - 20, this.height - 20, 29);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(38, 72, 54, 0.25)';
  }

  private drawPathHints(game: SnakeGame | null, palette: Palette): void {
    const ctx = this.context;
    if (!game || (game.mode !== 'campaign' && game.mode !== 'tutorial')) return;
    const points: Point[] = [{ x: 218, y: this.height * 0.5 }, ...game.pickups.filter((item) => item.kind === 'nectar').map((item) => ({ x: item.x, y: item.y })), game.portal];
    if (points.length < 2) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      const before = points[i - 1];
      const current = points[i];
      const midX = (before.x + current.x) / 2;
      const midY = (before.y + current.y) / 2;
      ctx.quadraticCurveTo(before.x, before.y, midX, midY);
    }
    const finalPoint = points[points.length - 1];
    ctx.lineTo(finalPoint.x, finalPoint.y);
    ctx.setLineDash([2.5, 14]);
    ctx.lineWidth = 2.2 / this.lastViewport.scale;
    ctx.strokeStyle = `${palette.light}45`;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  private drawHazard(hazard: Hazard, palette: Palette, now: number): void {
    const ctx = this.context;
    const r = hazard.radius;
    ctx.save();
    ctx.translate(hazard.x, hazard.y);
    if (hazard.moving) {
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 2.25, r * 1.55, 0, 0, Math.PI * 2);
      ctx.setLineDash([7 / this.lastViewport.scale, 9 / this.lastViewport.scale]);
      ctx.lineWidth = 1.5 / this.lastViewport.scale;
      ctx.strokeStyle = 'rgba(250, 238, 192, 0.4)';
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(r * 0.12, r * 0.55, r * 1.1, r * 0.75, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(27, 56, 43, 0.22)';
    ctx.fill();

    if (hazard.kind === 'pool') {
      this.drawPool(r, palette, now);
    } else if (hazard.kind === 'hedge') {
      this.drawHedge(r, palette, now);
    } else if (hazard.kind === 'root') {
      this.drawRoot(r, palette);
    } else if (hazard.kind === 'mushroom') {
      this.drawMushroom(r, palette, now);
    } else if (hazard.kind === 'bloom') {
      this.drawHazardBloom(r, palette, hazard.active, hazard.warning);
    } else if (hazard.kind === 'moving') {
      this.drawMovingPad(r, palette, now);
    } else {
      this.drawStone(r, palette);
    }
    ctx.restore();
  }

  private drawPool(r: number, palette: Palette, now: number): void {
    const ctx = this.context;
    const water = ctx.createRadialGradient(-r * 0.28, -r * 0.38, 2, 0, 0, r * 1.35);
    water.addColorStop(0, '#b3d8c4');
    water.addColorStop(0.4, palette.water);
    water.addColorStop(1, '#467f7a');
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.08, r * 0.92, 0.15, 0, Math.PI * 2);
    ctx.fillStyle = water;
    ctx.fill();
    ctx.strokeStyle = 'rgba(243, 239, 194, 0.55)';
    ctx.lineWidth = 2.2 / this.lastViewport.scale;
    ctx.stroke();
    ctx.beginPath();
    const pulse = this.lowMotion ? 0 : Math.sin(now * 0.002) * r * 0.04;
    ctx.ellipse(-r * 0.18, -r * 0.28, r * 0.42 + pulse, r * 0.11 + pulse * 0.2, -0.3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(229, 245, 216, 0.45)';
    ctx.lineWidth = 2 / this.lastViewport.scale;
    ctx.stroke();
    this.leaf(ctx, r * 0.44, -r * 0.12, r * 0.48, r * 0.46, '#4c7963', '#a8c99e');
    this.leaf(ctx, r * 0.56, -r * 0.09, r * 0.34, r * 0.32, '#4c7963', '#9bbf90');
  }

  private drawStone(r: number, palette: Palette): void {
    const ctx = this.context;
    const path = new Path2D();
    const n = 10;
    for (let i = 0; i <= n; i += 1) {
      const angle = (i / n) * Math.PI * 2;
      const variation = 0.84 + Math.sin(i * 8.3 + r) * 0.1 + Math.sin(i * 3.1) * 0.05;
      const x = Math.cos(angle) * r * variation;
      const y = Math.sin(angle) * r * variation * 0.78;
      if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
    }
    path.closePath();
    const fill = ctx.createLinearGradient(-r * 0.55, -r, r, r);
    fill.addColorStop(0, '#c5c3a4');
    fill.addColorStop(0.44, '#82927e');
    fill.addColorStop(1, '#4f715c');
    ctx.fillStyle = fill;
    ctx.strokeStyle = `${palette.shadow}cc`;
    ctx.lineWidth = 2.5 / this.lastViewport.scale;
    ctx.fill(path);
    ctx.stroke(path);
    ctx.beginPath();
    ctx.ellipse(-r * 0.28, -r * 0.24, r * 0.31, r * 0.16, -0.25, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(245, 238, 202, 0.27)';
    ctx.fill();
  }

  private drawRoot(r: number, palette: Palette): void {
    const ctx = this.context;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.98, r * 0.8, -0.28, 0, Math.PI * 2);
    const wood = ctx.createLinearGradient(0, -r, 0, r);
    wood.addColorStop(0, '#a78b61');
    wood.addColorStop(0.52, '#765d42');
    wood.addColorStop(1, '#4e583e');
    ctx.fillStyle = wood;
    ctx.fill();
    ctx.strokeStyle = `${palette.shadow}cc`;
    ctx.lineWidth = 3 / this.lastViewport.scale;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(224, 200, 147, 0.55)';
    ctx.lineWidth = 2 / this.lastViewport.scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.66, r * 0.2);
    ctx.quadraticCurveTo(-r * 0.15, -r * 0.42, r * 0.72, -r * 0.05);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.1, r * 0.38);
    ctx.quadraticCurveTo(r * 0.14, 0, r * 0.3, -r * 0.62);
    ctx.stroke();
  }

  private drawMushroom(r: number, palette: Palette, now: number): void {
    const ctx = this.context;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.83, r * 0.66, 0, 0, Math.PI * 2);
    const body = ctx.createLinearGradient(0, -r, 0, r);
    body.addColorStop(0, '#e3d4b0');
    body.addColorStop(0.42, '#a88365');
    body.addColorStop(1, '#716650');
    ctx.fillStyle = body;
    ctx.fill();
    ctx.strokeStyle = `${palette.shadow}cc`;
    ctx.lineWidth = 2 / this.lastViewport.scale;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-r * 0.08, -r * 0.18, r * 0.7, r * 0.35, -0.08, Math.PI * 1.08, Math.PI * 1.98);
    ctx.fillStyle = '#a76562';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-r * 0.12, -r * 0.24, r * 0.5, Math.PI * 1.06, Math.PI * 1.95);
    ctx.strokeStyle = '#e9cf9a';
    ctx.lineWidth = 2 / this.lastViewport.scale;
    ctx.stroke();
    const shimmer = this.lowMotion ? 0 : Math.sin(now * 0.0017) * 0.07;
    ctx.fillStyle = `rgba(244, 232, 181, ${0.3 + shimmer})`;
    for (const [x, y, size] of [[-.38, -.26, .055], [-.05, -.34, .04], [.2, -.18, .055]] as const) {
      ctx.beginPath(); ctx.arc(r * x, r * y, r * size, 0, Math.PI * 2); ctx.fill();
    }
  }

  private drawHazardBloom(r: number, palette: Palette, active: boolean, warning: boolean): void {
    const ctx = this.context;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.95, r * 0.78, 0, 0, Math.PI * 2);
    const base = ctx.createRadialGradient(-r * 0.18, -r * 0.28, 2, 0, 0, r * 1.1);
    base.addColorStop(0, active ? '#f0d795' : '#bbca8a');
    base.addColorStop(1, active ? '#c68664' : '#76916e');
    ctx.fillStyle = base;
    ctx.fill();
    ctx.strokeStyle = `${palette.shadow}bd`;
    ctx.lineWidth = 2 / this.lastViewport.scale;
    ctx.stroke();
    const color = active ? '#f0c177' : '#bfd49c';
    for (let i = 0; i < 5; i += 1) {
      const a = i * Math.PI * 0.4 - Math.PI * 0.5;
      const x = Math.cos(a) * r * 0.6;
      const y = Math.sin(a) * r * 0.44;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.2, r * 0.12, a, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r * (warning ? 1.22 : 0.36), 0, Math.PI * 2);
    ctx.fillStyle = active ? '#f3d989' : '#e3e6bd';
    ctx.fill();
    ctx.strokeStyle = 'rgba(250, 242, 197, 0.75)';
    ctx.lineWidth = 2 / this.lastViewport.scale;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.12, 0, Math.PI * 2);
    ctx.setLineDash([5 / this.lastViewport.scale, 6 / this.lastViewport.scale]);
    ctx.strokeStyle = warning ? '#fff2bd' : active ? 'rgba(239, 178, 130, 0.48)' : 'rgba(239, 238, 190, 0.28)';
    ctx.lineWidth = (warning ? 3 : 1.5) / this.lastViewport.scale;
    ctx.stroke();
  }

  private drawMovingPad(r: number, palette: Palette, now: number): void {
    const ctx = this.context;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.9, r * 0.78, 0.08, 0, Math.PI * 2);
    const fill = ctx.createLinearGradient(0, -r, 0, r);
    fill.addColorStop(0, '#d6d9a5');
    fill.addColorStop(0.5, '#839f72');
    fill.addColorStop(1, '#506f5f');
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = `${palette.shadow}c7`;
    ctx.lineWidth = 2 / this.lastViewport.scale;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(246, 233, 185, 0.7)';
    ctx.lineWidth = 1.8 / this.lastViewport.scale;
    ctx.beginPath();
    ctx.ellipse(-r * 0.12, -r * 0.13, r * 0.48, r * 0.2, -0.16 + (this.lowMotion ? 0 : Math.sin(now * 0.001) * 0.025), 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawHedge(r: number, palette: Palette, now: number): void {
    const ctx = this.context;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.98, r * 0.8, -0.1, 0, Math.PI * 2);
    const fill = ctx.createRadialGradient(-r * 0.4, -r * 0.4, 4, 0, 0, r * 1.1);
    fill.addColorStop(0, '#a3ba7b');
    fill.addColorStop(1, '#486c54');
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = `${palette.shadow}d9`;
    ctx.lineWidth = 2.4 / this.lastViewport.scale;
    ctx.stroke();
    for (let i = 0; i < 9; i += 1) {
      const a = (i / 9) * Math.PI * 2;
      this.leaf(ctx, Math.cos(a) * r * 0.48, Math.sin(a) * r * 0.31, r * 0.22, r * 0.3, i % 2 ? '#719368' : '#91ac75', '#c6cf93', now);
    }
  }

  private drawPickup(item: Pickup, palette: Palette, now: number): void {
    const ctx = this.context;
    const bob = this.lowMotion ? 0 : Math.sin(now * 0.0033 + item.id * 1.3) * 3 / this.lastViewport.scale;
    const baseR = item.kind === 'rare' || item.kind === 'hidden' ? 16 / this.lastViewport.scale : 13 / this.lastViewport.scale;
    ctx.save();
    ctx.translate(item.x, item.y + bob);
    const color = item.kind === 'dew' ? '#abd8df' : item.kind === 'rare' ? '#f1c875' : item.kind === 'hidden' ? '#efb9a7' : item.kind === 'shield' ? '#a8d38c' : item.kind === 'slow' ? '#e7d59a' : item.kind === 'glow' ? '#e2eaa6' : '#e8aa82';
    const halo = ctx.createRadialGradient(0, 0, 1, 0, 0, baseR * 2.8);
    halo.addColorStop(0, `${color}99`);
    halo.addColorStop(1, `${color}00`);
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, baseR * 2.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, baseR * 1.46, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(39, 71, 54, 0.26)';
    ctx.fill();

    if (item.kind === 'dew') {
      this.drawDrop(baseR * 0.85, color, palette.deep);
    } else if (item.kind === 'shield' || item.kind === 'slow' || item.kind === 'glow') {
      this.drawPowerIcon(item.kind, baseR, color);
    } else {
      this.drawBerry(baseR, color, item.kind === 'rare' || item.kind === 'hidden');
    }
    ctx.restore();
  }

  private drawBerry(r: number, color: string, special: boolean): void {
    const ctx = this.context;
    const fill = ctx.createRadialGradient(-r * 0.34, -r * 0.48, 1, 0, 0, r * 1.3);
    fill.addColorStop(0, '#fff0c3');
    fill.addColorStop(0.27, color);
    fill.addColorStop(1, special ? '#b46e60' : '#bc755e');
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = 'rgba(93, 75, 51, 0.58)';
    ctx.lineWidth = 1.5 / this.lastViewport.scale;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.77, r * 0.42, r * 0.16, 0.1, 0, Math.PI * 2);
    ctx.fillStyle = '#527c55';
    ctx.fill();
    this.leaf(ctx, r * 0.24, -r * 0.85, r * 0.43, r * 0.3, '#547a52', '#b4cc8c');
    ctx.beginPath();
    ctx.arc(-r * 0.28, -r * 0.31, r * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 249, 220, 0.56)';
    ctx.fill();
  }

  private drawDrop(r: number, color: string, outline: string): void {
    const ctx = this.context;
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.26);
    ctx.bezierCurveTo(r * 0.35, -r * 0.7, r * 0.92, -r * 0.13, r * 0.8, r * 0.36);
    ctx.bezierCurveTo(r * 0.65, r * 1.09, -r * 0.59, r * 1.1, -r * 0.8, r * 0.35);
    ctx.bezierCurveTo(-r * 0.92, -r * 0.13, -r * 0.31, -r * 0.7, 0, -r * 1.26);
    const fill = ctx.createLinearGradient(-r * 0.7, -r, r * 0.6, r);
    fill.addColorStop(0, '#f1f8dc');
    fill.addColorStop(0.38, color);
    fill.addColorStop(1, '#6b9d9c');
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.2 / this.lastViewport.scale;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-r * 0.24, -r * 0.12, r * 0.15, r * 0.3, -0.3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 238, 0.65)';
    ctx.fill();
  }

  private drawPowerIcon(kind: 'shield' | 'slow' | 'glow', r: number, color: string): void {
    const ctx = this.context;
    if (kind === 'shield') {
      ctx.save(); ctx.rotate(-0.48);
      this.leaf(ctx, 0, 0, r * 0.92, r * 1.18, '#557c54', color);
      ctx.beginPath(); ctx.moveTo(-r * .8, r * .24); ctx.quadraticCurveTo(0, 0, r * .75, -r * .48);
      ctx.strokeStyle = '#e7edc2'; ctx.lineWidth = 1.5 / this.lastViewport.scale; ctx.stroke();
      ctx.restore();
      return;
    }
    if (kind === 'slow') {
      for (let i = 0; i < 6; i += 1) {
        ctx.beginPath(); ctx.ellipse(Math.cos(i * Math.PI / 3) * r * .38, Math.sin(i * Math.PI / 3) * r * .38, r * .35, r * .23, i * Math.PI / 3, 0, Math.PI * 2);
        ctx.fillStyle = i % 2 ? color : '#f1e8bd'; ctx.fill();
      }
      ctx.beginPath(); ctx.arc(0, 0, r * .24, 0, Math.PI * 2); ctx.fillStyle = '#bd9761'; ctx.fill();
      return;
    }
    ctx.save();
    ctx.translate(0, -r * .12);
    ctx.beginPath(); ctx.arc(0, 0, r * .58, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    for (let i = 0; i < 6; i += 1) {
      const a = i * Math.PI / 3;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r * 1.18, Math.sin(a) * r * 1.18);
      ctx.strokeStyle = '#eff1c5'; ctx.lineWidth = 1.6 / this.lastViewport.scale; ctx.stroke();
      ctx.beginPath(); ctx.arc(Math.cos(a) * r * 1.2, Math.sin(a) * r * 1.2, r * .11, 0, Math.PI * 2); ctx.fillStyle = '#fff3c3'; ctx.fill();
    }
    ctx.restore();
  }

  private drawGate(game: SnakeGame, palette: Palette, now: number): void {
    const ctx = this.context;
    const { x, y } = game.portal;
    const r = 39 / this.lastViewport.scale;
    const pulse = this.lowMotion ? 0 : Math.sin(now * 0.0025) * 0.06;
    ctx.save(); ctx.translate(x, y);
    ctx.beginPath(); ctx.ellipse(0, r * 0.45, r * 1.32, r * 0.82, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(42, 66, 48, 0.32)'; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, r * (game.goalReady ? 1.18 + pulse : 0.82), 0, Math.PI * 2);
    ctx.strokeStyle = game.goalReady ? `${palette.glow}` : 'rgba(204, 218, 178, 0.45)';
    ctx.lineWidth = (game.goalReady ? 5 : 2) / this.lastViewport.scale;
    ctx.stroke();
    if (game.goalReady) {
      const halo = ctx.createRadialGradient(0, 0, r * .2, 0, 0, r * 1.8);
      halo.addColorStop(0, `${palette.glow}66`); halo.addColorStop(1, `${palette.glow}00`);
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 0, r * 1.8, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 8; i += 1) {
        const a = i * Math.PI / 4 - Math.PI / 2 + Math.sin(now * 0.0012) * .02;
        const px = Math.cos(a) * r * .86, py = Math.sin(a) * r * .86;
        this.leaf(ctx, px, py, r * .25, r * .49, '#527d5d', '#e6d796', now);
      }
      ctx.beginPath(); ctx.arc(0, 0, r * .59, 0, Math.PI * 2);
      const inner = ctx.createRadialGradient(0, -r * .2, 0, 0, 0, r * .7);
      inner.addColorStop(0, '#f7edc7'); inner.addColorStop(.6, '#a8c88f'); inner.addColorStop(1, '#547d68');
      ctx.fillStyle = inner; ctx.fill();
      ctx.fillStyle = '#4f6b4e'; ctx.font = `600 ${12 / this.lastViewport.scale}px "Noto Serif SC", "Songti SC", serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('花门', 0, 1 / this.lastViewport.scale);
    } else {
      ctx.beginPath(); ctx.arc(0, 0, r * .32, 0, Math.PI * 2); ctx.fillStyle = '#9cae7a'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(-r * .32, 0); ctx.quadraticCurveTo(0, -r * .68, r * .32, 0);
      ctx.strokeStyle = '#e1d5a3'; ctx.lineWidth = 2 / this.lastViewport.scale; ctx.stroke();
    }
    ctx.restore();
  }

  private drawRivalRoutes(rivals: RivalSnakeView[]): void {
    const ctx = this.context;
    ctx.save();
    ctx.setLineDash([8 / this.lastViewport.scale, 10 / this.lastViewport.scale]);
    ctx.lineWidth = 2 / this.lastViewport.scale;
    for (const rival of rivals) {
      ctx.beginPath();
      ctx.ellipse(rival.center.x, rival.center.y, rival.radiusX, rival.radiusY, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(247, 241, 213, 0.27)';
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  private drawRivalSnake(rival: RivalSnakeView, now: number): void {
    const ctx = this.context;
    const points = rival.body;
    if (points.length < 2) return;
    const w = rival.bodyRadius;
    const left: Point[] = [];
    const right: Point[] = [];
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      const before = points[Math.max(0, i - 1)];
      const after = points[Math.min(points.length - 1, i + 1)];
      const dx = before.x - after.x;
      const dy = before.y - after.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const taper = Math.pow(1 - i / Math.max(1, points.length - 1), 0.66);
      const width = w * Math.max(0.08, taper) * (0.96 + Math.sin(i * 0.37 + now * 0.002) * 0.025);
      left.push({ x: p.x + nx * width, y: p.y + ny * width });
      right.push({ x: p.x - nx * width, y: p.y - ny * width });
    }
    const headColor = rival.color === '#bd684b' ? '#e8ad82' : rival.color === '#8268a5' ? '#c4acd9' : '#91c3cf';
    const deepColor = rival.color === '#bd684b' ? '#713d33' : rival.color === '#8268a5' ? '#493c68' : '#294d5e';
    ctx.save();
    ctx.beginPath();
    this.smoothSide(ctx, left);
    this.smoothSideReverse(ctx, right);
    ctx.closePath();
    ctx.fillStyle = 'rgba(28, 43, 39, 0.19)';
    ctx.shadowColor = 'rgba(24, 45, 38, .18)';
    ctx.shadowBlur = 10 / this.lastViewport.scale;
    ctx.shadowOffsetY = 4 / this.lastViewport.scale;
    ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.beginPath();
    this.smoothSide(ctx, left);
    this.smoothSideReverse(ctx, right);
    ctx.closePath();
    const bodyFill = ctx.createLinearGradient(0, -w, 0, w);
    bodyFill.addColorStop(0, headColor);
    bodyFill.addColorStop(.47, rival.color);
    bodyFill.addColorStop(1, deepColor);
    ctx.fillStyle = bodyFill;
    ctx.strokeStyle = 'rgba(43, 63, 53, .78)';
    ctx.lineWidth = 1.6 / this.lastViewport.scale;
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    for (let i = 2; i < left.length - 2; i += 5) {
      ctx.moveTo(left[i].x, left[i].y);
      ctx.quadraticCurveTo(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
    }
    ctx.strokeStyle = 'rgba(242, 237, 205, .31)';
    ctx.lineWidth = 1.2 / this.lastViewport.scale;
    ctx.lineCap = 'round';
    ctx.stroke();
    const tail = points[points.length - 1];
    const tailAngle = Math.atan2(tail.y - points[points.length - 2].y, tail.x - points[points.length - 2].x);
    ctx.save(); ctx.translate(tail.x, tail.y); ctx.rotate(tailAngle);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-w * 1.4, -w * .7, -w * 2.4, 0); ctx.quadraticCurveTo(-w * 1.4, w * .7, 0, 0);
    ctx.fillStyle = deepColor; ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(rival.head.x, rival.head.y); ctx.rotate(rival.heading);
    const r = rival.headRadius;
    ctx.beginPath(); ctx.ellipse(-r * .08, r * .3, r * 1.04, r * .54, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(25, 44, 39, .18)'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(r * .12, 0, r * .92, r * .68, 0, 0, Math.PI * 2);
    const headFill = ctx.createLinearGradient(0, -r, 0, r);
    headFill.addColorStop(0, headColor); headFill.addColorStop(1, rival.color);
    ctx.fillStyle = headFill; ctx.strokeStyle = deepColor; ctx.lineWidth = 1.5 / this.lastViewport.scale; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r * .12, -r * .52); ctx.quadraticCurveTo(r * .08, -r * 1.08, r * .35, -r * .56); ctx.quadraticCurveTo(r * .12, -r * .65, -r * .12, -r * .52);
    ctx.fillStyle = headColor; ctx.strokeStyle = deepColor; ctx.lineWidth = 1 / this.lastViewport.scale; ctx.fill(); ctx.stroke();
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(r * .38, side * r * .32, r * .18, r * .22, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#f3edcf'; ctx.fill();
      ctx.beginPath(); ctx.arc(r * .43, side * r * .32, r * .075, 0, Math.PI * 2);
      ctx.fillStyle = rival.aggressive ? '#b33f36' : deepColor; ctx.fill();
    }
    ctx.beginPath(); ctx.moveTo(r * .82, 0); ctx.lineTo(r * 1.16, 0);
    ctx.strokeStyle = 'rgba(55, 58, 43, .45)'; ctx.lineWidth = 1.1 / this.lastViewport.scale; ctx.stroke();
    if (rival.aggressive) {
      ctx.beginPath(); ctx.arc(-r * .12, -r * 1.35, r * .43, 0, Math.PI * 2);
      ctx.fillStyle = '#f4e2bf'; ctx.fill();
      ctx.strokeStyle = '#b84c3d'; ctx.lineWidth = 1.8 / this.lastViewport.scale; ctx.stroke();
      ctx.fillStyle = '#a64337'; ctx.font = `700 ${r * .65}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', -r * .12, -r * 1.34);
    }
    ctx.restore();
    ctx.restore();
  }

  private drawSnake(game: SnakeGame, palette: Palette, now: number): void {
    const ctx = this.context;
    const points = game.bodyPoints(6);
    if (points.length < 2) return;
    const w = game.bodyRadius;
    const left: Point[] = [];
    const right: Point[] = [];
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      const before = points[Math.max(0, i - 1)];
      const after = points[Math.min(points.length - 1, i + 1)];
      const dx = before.x - after.x;
      const dy = before.y - after.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const taper = Math.pow(1 - i / Math.max(1, points.length - 1), 0.62);
      const breathing = 0.93 + Math.sin(i * 0.28 + now * 0.0022) * (this.lowMotion ? 0.012 : 0.035);
      const width = w * Math.max(0.08, taper) * breathing;
      left.push({ x: p.x + nx * width, y: p.y + ny * width });
      right.push({ x: p.x - nx * width, y: p.y - ny * width });
    }
    ctx.save();
    ctx.beginPath();
    this.smoothSide(ctx, left);
    this.smoothSideReverse(ctx, right);
    ctx.closePath();
    ctx.fillStyle = 'rgba(29, 56, 43, 0.26)';
    ctx.shadowColor = 'rgba(29, 52, 41, 0.26)';
    ctx.shadowBlur = 12 / this.lastViewport.scale;
    ctx.shadowOffsetY = 6 / this.lastViewport.scale;
    ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.beginPath();
    this.smoothSide(ctx, left);
    this.smoothSideReverse(ctx, right);
    ctx.closePath();
    const bodyFill = ctx.createLinearGradient(0, -w, 0, w);
    bodyFill.addColorStop(0, game.settings && this.getSkinColor(game) ? this.getSkinColor(game) : '#65895d');
    bodyFill.addColorStop(.45, '#8da966');
    bodyFill.addColorStop(1, '#3e684d');
    ctx.fillStyle = bodyFill;
    ctx.strokeStyle = '#345a43';
    ctx.lineWidth = 2.2 / this.lastViewport.scale;
    ctx.fill(); ctx.stroke();

    ctx.beginPath();
    for (let i = 1; i < left.length - 2; i += 6) {
      ctx.moveTo(left[i].x, left[i].y);
      ctx.quadraticCurveTo(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
    }
    ctx.strokeStyle = 'rgba(227, 235, 175, 0.35)';
    ctx.lineWidth = 1.5 / this.lastViewport.scale;
    ctx.lineCap = 'round'; ctx.stroke();

    const dorsalStride = Math.max(10, Math.floor((50 / this.lastViewport.scale) / (6 / this.lastViewport.scale)));
    for (let i = dorsalStride; i < points.length - 7; i += dorsalStride) {
      const p = points[i];
      const tangent = points[i - 1];
      const angle = Math.atan2(p.y - tangent.y, p.x - tangent.x) + Math.PI / 2;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(angle);
      ctx.beginPath(); ctx.moveTo(0, -w * .35); ctx.quadraticCurveTo(w * .58, -w * 1.2, 0, -w * 1.35);
      ctx.quadraticCurveTo(-w * .58, -w * 1.2, 0, -w * .35); ctx.fillStyle = palette.light; ctx.fill();
      ctx.restore();
    }
    const tail = points[points.length - 1];
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(tail.x + Math.cos(game.heading + Math.PI) * w * 1.2 + Math.sin(game.heading) * w * .45, tail.y + Math.sin(game.heading + Math.PI) * w * 1.2 - Math.cos(game.heading) * w * .45);
    ctx.lineTo(tail.x + Math.cos(game.heading + Math.PI) * w * 1.2 - Math.sin(game.heading) * w * .45, tail.y + Math.sin(game.heading + Math.PI) * w * 1.2 + Math.cos(game.heading) * w * .45);
    ctx.closePath(); ctx.fillStyle = '#5c8055'; ctx.fill();
    this.drawHead(game, now);
    ctx.restore();
  }

  private getSkinColor(game: SnakeGame): string {
    const style = (game as SnakeGame & { skinColor?: string }).skinColor;
    return style ?? '#65895d';
  }

  private smoothSide(ctx: CanvasRenderingContext2D, points: Point[]): void {
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i += 1) {
      const midX = (points[i].x + points[i + 1].x) / 2;
      const midY = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
    }
    const end = points[points.length - 1];
    ctx.lineTo(end.x, end.y);
  }

  private smoothSideReverse(ctx: CanvasRenderingContext2D, points: Point[]): void {
    for (let i = points.length - 1; i > 0; i -= 1) {
      const midX = (points[i].x + points[i - 1].x) / 2;
      const midY = (points[i].y + points[i - 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
    }
    ctx.lineTo(points[0].x, points[0].y);
  }

  private drawHead(game: SnakeGame, now: number): void {
    const ctx = this.context;
    const r = game.headRadius;
    ctx.save(); ctx.translate(game.head.x, game.head.y); ctx.rotate(game.heading);
    ctx.beginPath(); ctx.ellipse(-r * .08, r * .3, r * 1.05, r * .56, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(25, 53, 41, 0.2)'; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r * 1.1, 0);
    ctx.bezierCurveTo(r * .79, -r * .58, r * .42, -r * .83, -r * .3, -r * .72);
    ctx.quadraticCurveTo(-r * 1.04, -r * .62, -r * .93, 0);
    ctx.quadraticCurveTo(-r * 1.02, r * .59, -r * .3, r * .72);
    ctx.bezierCurveTo(r * .43, r * .83, r * .82, r * .55, r * 1.1, 0);
    const fill = ctx.createLinearGradient(0, -r, 0, r);
    fill.addColorStop(0, '#bfd48d'); fill.addColorStop(.47, '#8da966'); fill.addColorStop(1, '#5c8058');
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = '#355a43'; ctx.lineWidth = 2.5 / this.lastViewport.scale; ctx.stroke();
    for (const eyeY of [-r * .37, r * .37]) {
      ctx.beginPath(); ctx.ellipse(r * .18, eyeY, r * .26, r * .32, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#f6eccb'; ctx.fill();
      ctx.beginPath(); ctx.ellipse(r * .25, eyeY, r * .105, r * .19, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#233f39'; ctx.fill();
      ctx.beginPath(); ctx.arc(r * .29, eyeY - r * .065, r * .04, 0, Math.PI * 2);
      ctx.fillStyle = '#fff6d6'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(-r * .03, eyeY - r * .28);
      ctx.quadraticCurveTo(r * .18, eyeY - r * .44, r * .42, eyeY - r * .24);
      ctx.strokeStyle = '#42674e'; ctx.lineWidth = 2 / this.lastViewport.scale; ctx.lineCap = 'round'; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(r * .78, -r * .1, r * .065, 0, Math.PI * 2); ctx.fillStyle = '#456553'; ctx.fill();
    ctx.beginPath(); ctx.arc(r * .78, r * .1, r * .065, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(r * .66, r * .24); ctx.quadraticCurveTo(r * .36, r * .4, r * .05, r * .24);
    ctx.strokeStyle = '#43634b'; ctx.lineWidth = 1.3 / this.lastViewport.scale; ctx.stroke();
    const flick = this.lowMotion ? 0 : Math.sin(now * .008) * .06;
    ctx.save(); ctx.translate(-r * .72, 0); ctx.rotate(flick);
    this.leaf(ctx, 0, -r * .63, r * .42, r * .57, '#4f7950', '#bed28f', now);
    this.leaf(ctx, 0, r * .63, r * .42, r * .57, '#4f7950', '#bed28f', now);
    ctx.restore();
    if (game.lastBoosting) {
      ctx.beginPath(); ctx.ellipse(-r * 1.28, 0, r * .58, r * .25, 0, 0, Math.PI * 2);
      const glow = ctx.createRadialGradient(-r * 1.28, 0, 0, -r * 1.28, 0, r * .58);
      glow.addColorStop(0, 'rgba(246, 223, 151, 0.75)'); glow.addColorStop(1, 'rgba(246, 223, 151, 0)');
      ctx.fillStyle = glow; ctx.fill();
    }
    ctx.restore();
  }

  private drawSafeGuide(game: SnakeGame, palette: Palette, now: number): void {
    const ctx = this.context;
    let target: Point | undefined;
    if (!game.goalReady) target = game.pickups.find((pickup) => pickup.kind === 'nectar');
    else target = game.portal;
    if (!target) return;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(game.head.x, game.head.y);
    ctx.quadraticCurveTo((game.head.x + target.x) * .5, game.head.y + Math.sin(now * .001) * 9 / this.lastViewport.scale, target.x, target.y);
    ctx.setLineDash([8 / this.lastViewport.scale, 12 / this.lastViewport.scale]);
    ctx.lineDashOffset = -now * .018 / this.lastViewport.scale;
    ctx.strokeStyle = `${palette.glow}cc`; ctx.lineWidth = 3.2 / this.lastViewport.scale; ctx.lineCap = 'round'; ctx.stroke();
    ctx.restore();
  }

  private drawBursts(now: number, palette: Palette): void {
    const ctx = this.context;
    this.bursts = this.bursts.filter((burst) => now - burst.at < 540);
    for (const burst of this.bursts) {
      const progress = clamp((now - burst.at) / 540, 0, 1);
      const spread = (18 + progress * (this.reduceFlash ? 12 : 22)) / this.lastViewport.scale;
      ctx.save();
      ctx.translate(burst.x, burst.y);
      ctx.globalAlpha = (1 - progress) * .78;
      for (let i = 0; i < burst.amount; i += 1) {
        const angle = (i / burst.amount) * Math.PI * 2 + .17;
        const radius = spread * (.66 + (i % 3) * .13);
        ctx.save(); ctx.translate(Math.cos(angle) * radius, Math.sin(angle) * radius); ctx.rotate(angle + Math.PI / 2);
        ctx.beginPath(); ctx.ellipse(0, 0, 2.2 / this.lastViewport.scale, 4.2 / this.lastViewport.scale, 0, 0, Math.PI * 2);
        ctx.fillStyle = burst.color; ctx.fill();
        ctx.restore();
      }
      if (!this.reduceFlash && burst.amount > 7) {
        ctx.beginPath(); ctx.arc(0, 0, spread * .48, 0, Math.PI * 2);
        ctx.strokeStyle = `${palette.glow}66`; ctx.lineWidth = 1.8 / this.lastViewport.scale; ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawShield(game: SnakeGame, now: number): void {
    const ctx = this.context;
    ctx.save(); ctx.translate(game.head.x, game.head.y);
    ctx.beginPath(); ctx.ellipse(0, 0, game.headRadius * 2.2, game.headRadius * 1.75, Math.sin(now * .002) * .03, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(204, 231, 180, 0.72)'; ctx.lineWidth = 2.5 / this.lastViewport.scale; ctx.stroke();
    ctx.restore();
  }

  private drawIdleScene(palette: Palette, now: number): void {
    const ctx = this.context;
    const w = this.width;
    const h = this.height;
    const scale = this.lastViewport.scale;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(w * .12, h * .79);
    ctx.bezierCurveTo(w * .4, h * .9, w * .31, h * .46, w * .58, h * .54);
    ctx.bezierCurveTo(w * .76, h * .6, w * .73, h * .19, w * .95, h * .24);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(55, 75, 51, 0.12)';
    ctx.lineWidth = 102 / scale;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(220, 204, 160, 0.55)';
    ctx.lineWidth = 92 / scale;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(245, 232, 192, 0.28)';
    ctx.lineWidth = 2 / scale;
    ctx.setLineDash([3 / scale, 12 / scale]);
    ctx.stroke();
    ctx.restore();

    this.drawPlantCluster(w * .88, h * .24, palette, now, 1);
    this.drawPlantCluster(w * .86, h * .78, palette, now, 2);
    this.drawPlantCluster(w * .61, h * .17, palette, now, 0);
    this.drawPlantCluster(w * .52, h * .87, palette, now, 1);
    this.drawHazard({ x: w * .92, y: h * .52, radius: 44 / scale, kind: 'pool', phase: 0, moving: false, active: false, warning: false }, palette, now);
    this.drawHazard({ x: w * .66, y: h * .79, radius: 27 / scale, kind: 'stone', phase: 0, moving: false, active: false, warning: false }, palette, now);
    this.drawPickup({ id: 54, x: w * .73, y: h * .25, kind: 'rare' }, palette, now);
    this.drawPickup({ id: 55, x: w * .77, y: h * .75, kind: 'nectar' }, palette, now);
    this.drawPickup({ id: 56, x: w * .62, y: h * .48, kind: 'dew' }, palette, now);
    const points: Point[] = [];
    for (let i = 0; i <= 70; i += 1) {
      const p = i / 70;
      points.push({ x: w * (.25 + p * .53), y: h * (.52 + Math.sin(p * Math.PI * 2 + now * .00025) * .15 + Math.sin(p * Math.PI * 4) * .04) });
    }
    const bodyW = 12 / this.lastViewport.scale;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
    ctx.strokeStyle = 'rgba(36, 67, 48, 0.22)'; ctx.lineWidth = bodyW * 2.2; ctx.lineCap = 'round'; ctx.stroke();
    const fill = ctx.createLinearGradient(0, h * .4, 0, h * .7);
    fill.addColorStop(0, '#bfd48e'); fill.addColorStop(.5, '#87a562'); fill.addColorStop(1, '#426c50');
    ctx.strokeStyle = fill; ctx.lineWidth = bodyW * 1.8; ctx.lineCap = 'round'; ctx.stroke();
    ctx.strokeStyle = `${palette.light}66`; ctx.lineWidth = Math.max(1 / this.lastViewport.scale, bodyW * .18); ctx.stroke();
    const head = points[points.length - 1];
    ctx.save(); ctx.translate(head.x, head.y); ctx.rotate(.24);
    ctx.beginPath(); ctx.ellipse(0, 0, 18 / this.lastViewport.scale, 13 / this.lastViewport.scale, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#8da967'; ctx.strokeStyle = '#355944'; ctx.lineWidth = 2 / this.lastViewport.scale; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(4 / this.lastViewport.scale, -4 / this.lastViewport.scale, 2 / this.lastViewport.scale, 0, Math.PI * 2); ctx.fillStyle = '#f7efcf'; ctx.fill();
    ctx.restore();
  }

  private drawPlantCluster(x: number, y: number, palette: Palette, now: number, variant: number): void {
    const ctx = this.context;
    const unit = 1 / this.lastViewport.scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.ellipse(0, 13 * unit, 36 * unit, 12 * unit, .06, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(44, 67, 47, 0.21)'; ctx.fill();
    for (let i = 0; i < 7; i += 1) {
      const angle = -1.36 + i * .44 + variant * .12;
      const length = (49 + (i % 3) * 11) * unit;
      const endX = Math.cos(angle) * length * .76;
      const endY = Math.sin(angle) * length;
      ctx.beginPath();
      ctx.moveTo(0, 6 * unit);
      ctx.quadraticCurveTo(endX * .25, endY * .48, endX, endY);
      ctx.strokeStyle = i % 2 ? '#526f4d' : '#718a59';
      ctx.lineWidth = (2.3 - (i % 2) * .5) * unit;
      ctx.lineCap = 'round'; ctx.stroke();
      ctx.save(); ctx.translate(endX, endY); ctx.rotate(angle + Math.PI * .48);
      this.leaf(ctx, 0, 0, (17 + i % 3 * 2) * unit, length * .72, i % 2 ? '#4f7752' : '#63895b', i % 3 ? '#a9bf7c' : '#c3cf8e', now);
      ctx.restore();
    }
    for (let i = 0; i < 3; i += 1) {
      const angle = -1.05 + i * .91;
      const dx = Math.cos(angle) * (29 + i * 8) * unit;
      const dy = Math.sin(angle) * (35 + i * 7) * unit - 3 * unit;
      ctx.beginPath(); ctx.moveTo(0, 4 * unit); ctx.quadraticCurveTo(dx * .42, dy * .76, dx, dy);
      ctx.strokeStyle = '#72855a'; ctx.lineWidth = 1.8 * unit; ctx.stroke();
      for (let petal = 0; petal < 6; petal += 1) {
        const p = petal * Math.PI / 3;
        ctx.beginPath(); ctx.ellipse(dx + Math.cos(p) * 5.2 * unit, dy + Math.sin(p) * 5.2 * unit, 4.6 * unit, 2.7 * unit, p, 0, Math.PI * 2);
        ctx.fillStyle = variant === 2 ? '#ecd5a0' : '#f0e6bb'; ctx.fill();
      }
      ctx.beginPath(); ctx.arc(dx, dy, 3.4 * unit, 0, Math.PI * 2); ctx.fillStyle = palette.flower; ctx.fill();
    }
    ctx.restore();
  }

  private drawGroundEdge(palette: Palette): void {
    const ctx = this.context;
    ctx.beginPath(); ctx.roundRect(8, 8, this.width - 16, this.height - 16, 31);
    ctx.strokeStyle = 'rgba(255, 248, 211, 0.2)'; ctx.lineWidth = 1.2 / this.lastViewport.scale; ctx.stroke();
    for (let i = 0; i < 8; i += 1) {
      const x = 66 + i * 123;
      const y = 27 + (i % 2) * 5;
      ctx.beginPath(); ctx.arc(x, y, 2.8 / this.lastViewport.scale, 0, Math.PI * 2);
      ctx.fillStyle = `${palette.light}92`; ctx.fill();
    }
  }

  private drawAmbientWisps(now: number, palette: Palette): void {
    if (this.lowMotion || this.gentleQuality) return;
    const ctx = this.context;
    const region = this.board.getBoundingClientRect();
    ctx.save();
    for (let i = 0; i < 5; i += 1) {
      const x = region.left + (((i * 0.211 + now * 0.000009) % 1) * region.width);
      const y = region.top + ((i * 0.267 + Math.sin(now * .0004 + i) * .018 + 1) % 1) * region.height;
      const alpha = .1 + ((Math.sin(now * .001 + i * 2.1) + 1) * .07);
      ctx.beginPath(); ctx.arc(x, y, 2 + (i % 2), 0, Math.PI * 2);
      ctx.fillStyle = `${palette.glow}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`; ctx.fill();
    }
    ctx.restore();
  }

  private leaf(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, length: number, dark: string, light: string, now = 0): void {
    ctx.save();
    ctx.translate(x, y);
    const sway = this.lowMotion ? 0 : Math.sin(now * .001 + x * .03 + y * .02) * .04;
    ctx.rotate(sway);
    ctx.beginPath();
    ctx.moveTo(0, length * .5);
    ctx.quadraticCurveTo(width * .9, length * .15, width * .45, -length * .18);
    ctx.quadraticCurveTo(width * .22, -length * .57, 0, -length * .5);
    ctx.quadraticCurveTo(-width * .18, -length * .57, -width * .46, -length * .15);
    ctx.quadraticCurveTo(-width * .85, length * .2, 0, length * .5);
    const fill = ctx.createLinearGradient(-width, length * .4, width, -length * .4);
    fill.addColorStop(0, dark); fill.addColorStop(.58, light); fill.addColorStop(1, dark);
    ctx.fillStyle = fill; ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, length * .42); ctx.quadraticCurveTo(width * .04, 0, 0, -length * .42);
    ctx.strokeStyle = 'rgba(245, 237, 193, 0.44)'; ctx.lineWidth = Math.max(.8 / this.lastViewport.scale, width * .055); ctx.stroke();
    ctx.restore();
  }
}
