import type { HazardKind, HazardSpec, LevelSpec, PickupKind } from './data';
import { LEVELS } from './data';
import { clamp, distance, seededRandom, wrapAngle, type Point } from './math';
import type { Settings } from './store';
import { MIN_GARDEN_HEIGHT } from './viewport';

export type GameMode = 'campaign' | 'tutorial' | 'endless' | 'daily';
export type GameEvent = 'collect' | 'rare' | 'dew' | 'power' | 'combo' | 'boost' | 'crash' | 'win';

export interface InputSnapshot {
  direction: Point | null;
  boost: boolean;
}

export interface Pickup {
  id: number;
  x: number;
  y: number;
  kind: PickupKind;
  expiresAt?: number;
}

export interface Hazard {
  x: number;
  y: number;
  radius: number;
  kind: HazardKind;
  phase: number;
  moving: boolean;
  active: boolean;
  warning: boolean;
}

export interface RivalSnakeView {
  head: Point;
  heading: number;
  headRadius: number;
  bodyRadius: number;
  body: Point[];
  center: Point;
  radiusX: number;
  radiusY: number;
  color: string;
  aggressive: boolean;
}

export interface GameStats {
  nectar: number;
  rare: number;
  hidden: boolean;
  score: number;
  combo: number;
  maxCombo: number;
  collisions: number;
  time: number;
}

export interface GameOptions {
  mode: GameMode;
  level?: LevelSpec;
  settings: Settings;
  height: number;
  scale: number;
  seed?: string;
}

interface TrailPoint extends Point { distance: number }

interface RivalSnakeState {
  center: Point;
  radiusX: number;
  radiusY: number;
  phase: number;
  direction: 1 | -1;
  speedCss: number;
  head: Point;
  heading: number;
  headRadius: number;
  bodyRadius: number;
  bodyLength: number;
  path: TrailPoint[];
  pathDistance: number;
  color: string;
  aggressive: boolean;
}

const WORLD_WIDTH = 1000;
const HEAD_RADIUS_CSS = 12.5;
const BODY_RADIUS_CSS = 9.2;
const TRAIL_SAMPLE_CSS = 3;

export class SnakeGame {
  readonly mode: GameMode;
  readonly level?: LevelSpec;
  readonly seed: string;
  settings: Settings;
  width = WORLD_WIDTH;
  height: number;
  scale: number;
  head: Point;
  heading = 0;
  headRadius: number;
  bodyRadius: number;
  bodyLength: number;
  pickups: Pickup[] = [];
  hazards: HazardSpec[] = [];
  stats: GameStats = { nectar: 0, rare: 0, hidden: false, score: 0, combo: 0, maxCombo: 0, collisions: 0, time: 0 };
  elapsed = 0;
  boostCharge = 2.2;
  effectShield = 0;
  effectSlow = 0;
  effectGlow = 0;
  invulnerable = 0;
  goalOpen = false;
  ended: 'win' | 'crash' | null = null;
  lastCollectAt = 0;
  lastBoosting = false;
  private path: TrailPoint[] = [];
  private rivals: RivalSnakeState[] = [];
  private pathDistance = 0;
  private spawnCooldown = 0;
  private nextPickupId = 0;
  private rng: () => number;
  private previousBoost = false;
  private subStep = 1 / 120;
  private accumulator = 0;

  constructor(options: GameOptions) {
    this.mode = options.mode;
    this.level = options.level;
    this.settings = { ...options.settings };
    this.height = Math.max(MIN_GARDEN_HEIGHT, options.height);
    this.scale = options.scale;
    this.seed = options.seed ?? `campaign-${options.level?.id ?? 1}`;
    this.rng = seededRandom(this.seed);
    this.headRadius = HEAD_RADIUS_CSS / this.scale;
    this.bodyRadius = BODY_RADIUS_CSS / this.scale;
    this.bodyLength = 66 / this.scale;
    this.head = { x: 218, y: this.height * 0.5 };
    this.hazards = options.mode === 'daily' ? this.makeDailyHazards() : (options.level?.hazards ?? []).map((item) => ({ ...item }));
    this.initializeTrail();
    this.initializeRivals();
    this.createInitialPickups();
    if (options.mode === 'daily') this.makeDailyPickups();
  }

  get target(): number {
    if (this.mode === 'tutorial') return 1;
    return this.mode === 'campaign' ? (this.level?.target ?? 3) : 0;
  }

  get portal(): Point {
    return { x: 888, y: this.height * 0.5 };
  }

  get goalReady(): boolean {
    return this.mode === 'endless' || this.mode === 'daily' || this.stats.nectar >= this.target;
  }

  get bestCombo(): number { return this.stats.maxCombo; }
  get currentSpeedCss(): number { return 102 * this.settings.speed * (this.effectSlow > 0 ? 0.72 : 1) * (this.lastBoosting ? 1.55 : 1); }

  get rivalSnakes(): RivalSnakeView[] {
    return this.rivals.map((rival) => {
      const spacing = 6 / this.scale;
      const count = Math.max(3, Math.ceil(rival.bodyLength / spacing));
      const body: Point[] = [];
      for (let i = 0; i <= count; i += 1) body.push(this.sampleTrailFrom(rival.path, rival.pathDistance, (rival.bodyLength * i) / count));
      return { head: { ...rival.head }, heading: rival.heading, headRadius: rival.headRadius, bodyRadius: rival.bodyRadius, body, center: { ...rival.center }, radiusX: rival.radiusX, radiusY: rival.radiusY, color: rival.color, aggressive: rival.aggressive };
    });
  }

  setSettings(settings: Settings): void {
    this.settings = { ...settings };
  }

  resize(height: number, scale: number): void {
    const safeHeight = Math.max(MIN_GARDEN_HEIGHT, height);
    if (Math.abs(safeHeight - this.height) < 0.5 && Math.abs(scale - this.scale) < 0.0001) return;
    const yRatio = safeHeight / this.height;
    const radiusRatio = this.scale / scale;
    this.head.y *= yRatio;
    for (const point of this.path) point.y *= yRatio;
    for (const item of this.pickups) item.y *= yRatio;
    for (const rival of this.rivals) {
      rival.center.y *= yRatio;
      rival.radiusY *= yRatio;
      rival.head.y *= yRatio;
      for (const point of rival.path) point.y *= yRatio;
      rival.headRadius *= radiusRatio;
      rival.bodyRadius *= radiusRatio;
      rival.bodyLength *= radiusRatio;
    }
    this.height = safeHeight;
    this.headRadius *= radiusRatio;
    this.bodyRadius *= radiusRatio;
    this.bodyLength *= radiusRatio;
    let rebuiltDistance = 0;
    if (this.path.length) this.path[0].distance = 0;
    for (let i = 1; i < this.path.length; i += 1) {
      rebuiltDistance += distance(this.path[i - 1], this.path[i]);
      this.path[i].distance = rebuiltDistance;
    }
    this.pathDistance = rebuiltDistance;
    this.scale = scale;
    for (const rival of this.rivals) {
      let rivalDistance = 0;
      if (rival.path.length) rival.path[0].distance = 0;
      for (let i = 1; i < rival.path.length; i += 1) {
        rivalDistance += distance(rival.path[i - 1], rival.path[i]);
        rival.path[i].distance = rivalDistance;
      }
      rival.pathDistance = rivalDistance;
    }
  }

  update(delta: number, input: InputSnapshot): GameEvent[] {
    if (this.ended) return [];
    const dt = clamp(delta, 0, 0.09);
    this.accumulator += dt;
    const events: GameEvent[] = [];
    while (this.accumulator >= this.subStep) {
      events.push(...this.step(this.subStep, input));
      this.accumulator -= this.subStep;
      if (this.ended) break;
    }
    return events;
  }

  headAt(backDistance: number): Point {
    return this.sampleTrail(Math.max(0, backDistance));
  }

  bodyPoints(spacingCss = 7): Point[] {
    const spacing = spacingCss / this.scale;
    const count = Math.max(3, Math.ceil(this.bodyLength / spacing));
    const result: Point[] = [];
    for (let i = 0; i <= count; i += 1) result.push(this.sampleTrail((this.bodyLength * i) / count));
    return result;
  }

  hazardStates(): Hazard[] {
    const now = this.elapsed;
    return this.hazards.map((item) => {
      const oscillation = item.kind === 'moving' ? Math.sin(now * 0.76 + (item.phase ?? 0)) * (15 / this.scale) : 0;
      const phase = ((now + (item.phase ?? 0)) % 8 + 8) % 8;
      const active = item.kind !== 'bloom' || phase < 4.75;
      const warning = item.kind === 'bloom' && phase >= 4.75 && phase < 6.1;
      return {
        x: item.x * this.width,
        y: item.y * this.height + oscillation,
        radius: item.radius / this.scale,
        kind: item.kind,
        phase,
        moving: item.kind === 'moving',
        active,
        warning,
      };
    });
  }

  private initializeTrail(): void {
    const start = this.head.x - this.bodyLength;
    this.pathDistance = this.bodyLength;
    const sampleSpacing = TRAIL_SAMPLE_CSS / this.scale;
    for (let x = start; x <= this.head.x; x += sampleSpacing) {
      const d = x - start;
      this.path.push({ x, y: this.head.y, distance: d });
    }
    this.path.push({ ...this.head, distance: this.pathDistance });
  }

  private initializeRivals(): void {
    if (this.mode === 'tutorial') return;
    const region = this.mode === 'campaign' ? Math.ceil((this.level?.id ?? 1) / 4) : 2;
    const routes = [
      { x: .56, y: .15, rx: .13, ry: .035 },
      { x: .42, y: .85, rx: .12, ry: .035 },
      { x: .82, y: .15, rx: .06, ry: .035 },
    ];
    const count = Math.max(1, Math.min(3, region));
    for (let i = 0; i < count; i += 1) {
      const route = routes[i];
      const phaseSeed = this.seed.length + (this.level?.id ?? 0) * 1.37 + i * 2.1;
      const rival: RivalSnakeState = {
        center: { x: route.x * this.width, y: route.y * this.height },
        radiusX: route.rx * this.width,
        radiusY: route.ry * this.height,
        phase: phaseSeed,
        direction: i % 2 === 0 ? 1 : -1,
        speedCss: 42 + region * 5 + i * 2,
        head: { x: 0, y: 0 },
        heading: 0,
        headRadius: 10.5 / this.scale,
        bodyRadius: 7.6 / this.scale,
        bodyLength: 78 / this.scale,
        path: [],
        pathDistance: 0,
        color: ['#bd684b', '#8268a5', '#3f7f96'][i],
        aggressive: false,
      };
      rival.head = this.rivalPointAt(rival, rival.phase);
      rival.heading = this.rivalHeadingAt(rival, rival.phase);
      this.rebuildRivalPath(rival);
      this.rivals.push(rival);
    }
  }

  private rivalPointAt(rival: RivalSnakeState, phase: number): Point {
    return { x: rival.center.x + Math.cos(phase) * rival.radiusX, y: rival.center.y + Math.sin(phase) * rival.radiusY };
  }

  private rivalHeadingAt(rival: RivalSnakeState, phase: number): number {
    return Math.atan2(rival.direction * Math.cos(phase) * rival.radiusY, rival.direction * -Math.sin(phase) * rival.radiusX);
  }

  private rebuildRivalPath(rival: RivalSnakeState): void {
    const sampleSpacing = 3 / this.scale;
    const reversePath: TrailPoint[] = [];
    let angle = rival.phase;
    let point = this.rivalPointAt(rival, angle);
    let backDistance = 0;
    let lastSample = -sampleSpacing;
    reversePath.push({ ...point, distance: 0 });
    while (backDistance < rival.bodyLength + 36 / this.scale) {
      angle -= rival.direction * 0.012;
      const next = this.rivalPointAt(rival, angle);
      backDistance += distance(point, next);
      if (backDistance - lastSample >= sampleSpacing) {
        reversePath.push({ ...next, distance: backDistance });
        lastSample = backDistance;
      }
      point = next;
    }
    const oldestDistance = reversePath[reversePath.length - 1].distance;
    rival.path = reversePath.reverse().map((item) => ({ ...item, distance: oldestDistance - item.distance }));
    rival.pathDistance = oldestDistance;
  }

  private updateRivals(dt: number): void {
    for (const rival of this.rivals) {
      if (this.mode === 'endless') rival.speedCss = 52 + Math.min(28, this.elapsed * 0.22);
      const oldHead = rival.head;
      const tangentLength = Math.hypot(Math.sin(rival.phase) * rival.radiusX, Math.cos(rival.phase) * rival.radiusY) || 1;
      rival.phase += rival.direction * (rival.speedCss / this.scale) * dt / tangentLength;
      const range = distance(rival.head, this.head) * this.scale;
      if (range < 90) rival.aggressive = true;
      else if (range > 142) rival.aggressive = false;
      const patrolTarget = this.rivalPointAt(rival, rival.phase + rival.direction * 0.22);
      let aim = patrolTarget;
      if (rival.aggressive) {
        const lead = Math.min(.34, range / 600);
        aim = {
          x: this.head.x + Math.cos(this.heading) * this.currentSpeedCss / this.scale * lead,
          y: this.head.y + Math.sin(this.heading) * this.currentSpeedCss / this.scale * lead,
        };
      }
      const desired = Math.atan2(aim.y - rival.head.y, aim.x - rival.head.x);
      rival.heading = wrapAngle(rival.heading + clamp(wrapAngle(desired - rival.heading), -2.2 * dt, 2.2 * dt));
      const chaseSpeed = rival.aggressive ? 50 : rival.speedCss;
      rival.head = {
        x: rival.head.x + Math.cos(rival.heading) * chaseSpeed / this.scale * dt,
        y: rival.head.y + Math.sin(rival.heading) * chaseSpeed / this.scale * dt,
      };
      rival.pathDistance += distance(oldHead, rival.head);
      const last = rival.path[rival.path.length - 1];
      if (!last || distance(rival.head, last) >= TRAIL_SAMPLE_CSS / this.scale) rival.path.push({ ...rival.head, distance: rival.pathDistance });
      const retainFrom = rival.pathDistance - rival.bodyLength - 36 / this.scale;
      let cut = 0;
      while (cut < rival.path.length - 3 && rival.path[cut + 1].distance < retainFrom) cut += 1;
      if (cut > 0) rival.path.splice(0, cut);
    }
  }

  private hitRivalSnakes(): boolean {
    const playerBody = this.bodyPoints(7 / this.scale);
    for (const rival of this.rivals) {
      if (distance(this.head, rival.head) < (this.headRadius + rival.headRadius) * 0.9) return true;
      for (let i = 2; i < playerBody.length; i += 1) {
        if (distance(playerBody[i], rival.head) < (this.bodyRadius + rival.headRadius) * 0.88) return true;
      }
      const points = this.rivalSnakesBody(rival, 7 / this.scale);
      const bodyHitRadius = this.headRadius * 0.9 + rival.bodyRadius * 0.88;
      for (let i = 2; i < points.length; i += 1) {
        if (distance(this.head, points[i]) < bodyHitRadius) return true;
      }
    }
    return false;
  }

  private rivalSnakesBody(rival: RivalSnakeState, spacing: number): Point[] {
    const count = Math.max(3, Math.ceil(rival.bodyLength / spacing));
    const points: Point[] = [];
    for (let i = 0; i <= count; i += 1) points.push(this.sampleTrailFrom(rival.path, rival.pathDistance, (rival.bodyLength * i) / count));
    return points;
  }

  private createInitialPickups(): void {
    if (this.mode === 'campaign' || this.mode === 'tutorial') {
      const coordinates = this.mode === 'tutorial'
        ? [[0.43, 0.35] as [number, number]]
        : (this.level?.fruit ?? [[.29, .34], [.52, .66], [.72, .36]]);
      for (const [x, y] of coordinates) this.addPickup(x, y, 'nectar');
      if (this.mode === 'campaign') {
        for (const item of this.level?.extras ?? []) this.addPickup(item.x, item.y, item.kind);
      }
    } else if (this.mode === 'endless') {
      for (let i = 0; i < 5; i += 1) this.spawnSafePickup(i === 2 ? 'dew' : 'nectar');
    }
  }

  private makeDailyHazards(): HazardSpec[] {
    const rng = this.rng;
    const hazards: HazardSpec[] = [];
    for (let i = 0; i < 7; i += 1) {
      const x = 0.25 + rng() * 0.61;
      const y = 0.22 + rng() * 0.56;
      if (Math.abs(y - 0.5) < 0.1 && x < 0.45) continue;
      hazards.push({ x, y, radius: 24 + rng() * 13, kind: i % 3 === 0 ? 'pool' : i % 2 ? 'stone' : 'moving', phase: rng() * Math.PI * 2 });
    }
    return hazards;
  }

  private makeDailyPickups(): void {
    this.pickups = [];
    for (let i = 0; i < 8; i += 1) this.spawnSafePickup(i === 6 ? 'rare' : i === 3 ? 'dew' : 'nectar');
    for (let i = 0; i < 2; i += 1) this.spawnSafePickup(i === 0 ? 'shield' : 'glow');
  }

  private addPickup(x: number, y: number, kind: PickupKind, expiresIn?: number): void {
    const pickup: Pickup = { id: this.nextPickupId++, x: x * this.width, y: y * this.height, kind };
    if (expiresIn !== undefined) pickup.expiresAt = this.elapsed + expiresIn;
    this.pickups.push(pickup);
  }

  private spawnSafePickup(kind: PickupKind): void {
    const safePad = 80 / this.scale;
    const states = this.hazardStates();
    const occupied = [...this.pickups.map(({ x, y }) => ({ x, y })), ...states.map(({ x, y }) => ({ x, y }))];
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const x = 130 + this.rng() * 730;
      const y = safePad + this.rng() * Math.max(1, this.height - safePad * 2);
      const point = { x, y };
      if (distance(point, this.head) < this.bodyLength + 90 / this.scale) continue;
      if (occupied.some((other) => distance(point, other) < 90 / this.scale)) continue;
      if (states.some((hazard) => distance(point, hazard) < hazard.radius + 42 / this.scale)) continue;
      this.pickups.push({ id: this.nextPickupId++, ...point, kind });
      return;
    }
    const y = safePad + (this.rng() * (this.height - safePad * 2));
    this.pickups.push({ id: this.nextPickupId++, x: 760, y, kind });
  }

  private step(dt: number, input: InputSnapshot): GameEvent[] {
    const events: GameEvent[] = [];
    const wasBoosting = this.lastBoosting;
    const boosting = input.boost && this.boostCharge > 0;
    this.lastBoosting = boosting;
    if (boosting) this.boostCharge = Math.max(0, this.boostCharge - dt * 0.4);
    else this.boostCharge = Math.min(5, this.boostCharge + dt * 0.06);
    if (boosting && !wasBoosting && !this.previousBoost) events.push('boost');
    this.previousBoost = boosting;
    if (this.effectShield > 0) this.effectShield = Math.max(0, this.effectShield - dt);
    if (this.effectSlow > 0) this.effectSlow = Math.max(0, this.effectSlow - dt);
    if (this.effectGlow > 0) this.effectGlow = Math.max(0, this.effectGlow - dt);
    if (this.invulnerable > 0) this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.elapsed += dt;
    this.stats.time = this.elapsed;
    this.updateRivals(dt);
    if (this.stats.combo > 0 && this.elapsed - this.lastCollectAt > 14) this.stats.combo = 0;

    if (input.direction && Math.hypot(input.direction.x, input.direction.y) > 0.12) {
      const desired = Math.atan2(input.direction.y, input.direction.x);
      const deltaAngle = wrapAngle(desired - this.heading);
      const turnRate = 2.35 * this.settings.sensitivity * (boosting ? 0.72 : 1);
      this.heading += clamp(deltaAngle, -turnRate * dt, turnRate * dt);
      this.heading = wrapAngle(this.heading);
    }

    const speed = this.currentSpeedCss / this.scale;
    const next = {
      x: this.head.x + Math.cos(this.heading) * speed * dt,
      y: this.head.y + Math.sin(this.heading) * speed * dt,
    };
    const traveled = distance(this.head, next);
    this.head = next;
    this.pathDistance += traveled;
    const last = this.path[this.path.length - 1];
    if (!last || distance(this.head, last) >= TRAIL_SAMPLE_CSS / this.scale) this.path.push({ ...this.head, distance: this.pathDistance });
    this.trimTrail();

    const boundary = this.headRadius * 0.9;
    if (this.head.x < boundary || this.head.x > this.width - boundary || this.head.y < boundary || this.head.y > this.height - boundary) {
      this.collide(events);
      return events;
    }

    if (this.hitRivalSnakes()) {
      this.collide(events, true);
      return events;
    }

    if (this.invulnerable <= 0) {
      const headRadius = this.headRadius * 0.91;
      for (const hazard of this.hazardStates()) {
        if (!hazard.active) continue;
        if (distance(this.head, hazard) < headRadius + hazard.radius * 0.94) {
          this.collide(events);
          return events;
        }
      }
      if (this.hitOwnBody()) {
        this.collide(events);
        return events;
      }
    }

    let foundGoalPickup = false;
    for (let i = this.pickups.length - 1; i >= 0; i -= 1) {
      const pickup = this.pickups[i];
      if (pickup.expiresAt !== undefined && this.elapsed > pickup.expiresAt) {
        this.pickups.splice(i, 1);
        continue;
      }
      const pickupRadius = (pickup.kind === 'rare' ? 18 : pickup.kind === 'nectar' || pickup.kind === 'hidden' ? 16 : 15) / this.scale;
      if (distance(this.head, pickup) <= this.headRadius + pickupRadius) {
        this.collect(pickup, events);
        this.pickups.splice(i, 1);
        if (pickup.kind === 'nectar') foundGoalPickup = true;
      }
    }
    if (foundGoalPickup) this.goalOpen = this.goalReady;

    this.spawnCooldown -= dt;
    if (this.mode === 'endless' && this.pickups.filter((item) => item.kind === 'nectar' || item.kind === 'rare').length < 5 && this.spawnCooldown <= 0) {
      this.spawnSafePickup(this.rng() > 0.8 ? 'rare' : 'nectar');
      this.spawnCooldown = 1.8;
    }
    if (this.mode === 'daily' && this.pickups.filter((item) => item.kind === 'nectar' || item.kind === 'rare').length < 6 && this.spawnCooldown <= 0) {
      this.spawnSafePickup('nectar');
      this.spawnCooldown = 2.1;
    }
    if ((this.mode === 'campaign' || this.mode === 'tutorial') && this.goalReady && distance(this.head, this.portal) < 41 / this.scale) {
      this.ended = 'win';
      events.push('win');
      return events;
    }
    return events;
  }

  private collect(pickup: Pickup, events: GameEvent[]): void {
    switch (pickup.kind) {
      case 'dew':
        this.boostCharge = Math.min(5, this.boostCharge + 2.4);
        events.push('dew');
        return;
      case 'shield':
        this.effectShield = 18;
        events.push('power');
        return;
      case 'slow':
        this.effectSlow = 8;
        events.push('power');
        return;
      case 'glow':
        this.effectGlow = 9;
        events.push('power');
        return;
      case 'nectar':
        this.stats.nectar += 1;
        this.bodyLength += 28 / this.scale;
        this.stats.combo += 1;
        this.stats.maxCombo = Math.max(this.stats.maxCombo, this.stats.combo);
        this.lastCollectAt = this.elapsed;
        this.stats.score += Math.round(100 * this.comboFactor());
        events.push(this.stats.combo > 1 && this.stats.combo % 3 === 0 ? 'combo' : 'collect');
        return;
      case 'rare':
        this.stats.rare += 1;
        this.bodyLength += 18 / this.scale;
        this.stats.combo += 1;
        this.stats.maxCombo = Math.max(this.stats.maxCombo, this.stats.combo);
        this.lastCollectAt = this.elapsed;
        this.stats.score += Math.round(240 * this.comboFactor());
        events.push('rare');
        return;
      case 'hidden':
        this.stats.hidden = true;
        this.stats.score += 180;
        events.push('rare');
    }
  }

  private comboFactor(): number {
    return 1 + Math.floor(Math.max(0, this.stats.combo - 1) / 3) * 0.25;
  }

  private collide(events: GameEvent[], ignoreShield = false): void {
    this.stats.collisions += 1;
    this.stats.combo = 0;
    if (!ignoreShield && this.effectShield > 0) {
      this.effectShield = 0;
      this.invulnerable = 1.2;
      events.push('power');
      return;
    }
    this.ended = 'crash';
    events.push('crash');
  }

  private hitOwnBody(): boolean {
    const protectedDistance = Math.max(this.headRadius * 3.4, 48 / this.scale);
    const bodyHitRadius = (this.headRadius + this.bodyRadius * 0.72) * 0.91;
    const step = Math.max(this.headRadius * 0.72, 7 / this.scale);
    for (let back = protectedDistance; back < this.bodyLength - this.bodyRadius; back += step) {
      if (distance(this.head, this.sampleTrail(back)) < bodyHitRadius) return true;
    }
    return false;
  }

  private trimTrail(): void {
    const retainFrom = this.pathDistance - this.bodyLength - 260 / this.scale;
    let cut = 0;
    while (cut < this.path.length - 3 && this.path[cut + 1].distance < retainFrom) cut += 1;
    if (cut > 0) this.path.splice(0, cut);
  }

  private sampleTrail(backDistance: number): Point {
    return this.sampleTrailFrom(this.path, this.pathDistance, backDistance);
  }

  private sampleTrailFrom(path: TrailPoint[], pathDistance: number, backDistance: number): Point {
    const wanted = pathDistance - backDistance;
    if (path.length < 2) return { ...this.head };
    let low = 0;
    let high = path.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (path[mid].distance < wanted) low = mid + 1;
      else high = mid;
    }
    const after = path[low];
    const before = path[Math.max(0, low - 1)];
    const span = after.distance - before.distance;
    const ratio = span <= 0 ? 0 : (wanted - before.distance) / span;
    return { x: before.x + (after.x - before.x) * ratio, y: before.y + (after.y - before.y) * ratio };
  }
}

export function newCampaignGame(level: LevelSpec, settings: Settings, height: number, scale: number): SnakeGame {
  return new SnakeGame({ mode: 'campaign', level, settings, height, scale });
}

export function getLevel(id: number): LevelSpec {
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, id - 1))];
}
