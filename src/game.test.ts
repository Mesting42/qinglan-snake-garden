import { describe, expect, it } from 'vitest';
import { LEVELS } from './data';
import { SnakeGame, type InputSnapshot } from './game';
import { DEFAULT_SETTINGS } from './store';

const idle: InputSnapshot = { direction: null, boost: false };

function createTutorial(): SnakeGame {
  return new SnakeGame({ mode: 'tutorial', level: LEVELS[0], settings: { ...DEFAULT_SETTINGS }, height: 700, scale: 1 });
}

describe('continuous snake movement', () => {
  it('turns toward a new heading at a bounded rate', () => {
    const game = createTutorial();
    game.update(1 / 120, { direction: { x: 0, y: 1 }, boost: false });
    expect(game.heading).toBeGreaterThan(0);
    expect(game.heading).toBeLessThan(0.04);
  });

  it('keeps the trail smooth and protects the body beside the head', () => {
    const game = createTutorial();
    const before = game.bodyPoints(7);
    expect(before.length).toBeGreaterThan(5);
    const selfHit = (game as unknown as { hitOwnBody: () => boolean }).hitOwnBody();
    expect(selfHit).toBe(false);
    game.update(.35, { direction: { x: 1, y: 1 }, boost: false });
    const after = game.bodyPoints(7);
    expect(after.length).toBeGreaterThan(5);
    expect(after.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
  });

  it('collects nectar, grows and opens the gate when the requirement is met', () => {
    const game = createTutorial();
    const fruit = game.pickups.find((pickup) => pickup.kind === 'nectar');
    expect(fruit).toBeDefined();
    game.head = { x: fruit!.x - 2, y: fruit!.y };
    const events = game.update(1 / 60, idle);
    expect(events).toContain('collect');
    expect(game.stats.nectar).toBe(1);
    expect(game.goalOpen).toBe(true);
  });

  it('detects an obstacle collision at the visible head position', () => {
    const spec = { ...LEVELS[0], hazards: [{ x: .22, y: .5, radius: 25, kind: 'stone' as const }] };
    const game = new SnakeGame({ mode: 'campaign', level: spec, settings: { ...DEFAULT_SETTINGS }, height: 700, scale: 1 });
    const events = game.update(1 / 120, idle);
    expect(events).toContain('crash');
    expect(game.ended).toBe('crash');
  });

  it('builds the same daily route and pickup positions for a fixed date seed', () => {
    const create = (): SnakeGame => new SnakeGame({ mode: 'daily', settings: { ...DEFAULT_SETTINGS }, height: 720, scale: .42, seed: 'qinglan-2026-10-18' });
    const first = create();
    const second = create();
    expect(first.hazards).toEqual(second.hazards);
    expect(first.pickups).toEqual(second.pickups);
  });

  it('adds more predictable patrol snakes as the campaign enters later gardens', () => {
    const createLevel = (id: number): SnakeGame => new SnakeGame({ mode: 'campaign', level: LEVELS[id - 1], settings: { ...DEFAULT_SETTINGS }, height: 720, scale: 1 });
    expect(createLevel(1).rivalSnakes).toHaveLength(1);
    expect(createLevel(5).rivalSnakes).toHaveLength(2);
    expect(createLevel(9).rivalSnakes).toHaveLength(3);
    expect(createTutorial().rivalSnakes).toHaveLength(0);
    expect(createLevel(9).rivalSnakes.every((rival) => rival.body.length > 5 && rival.radiusX > 0 && rival.radiusY > 0)).toBe(true);
  });

  it('ends the run when the player collides with a rival head', () => {
    const game = new SnakeGame({ mode: 'campaign', level: LEVELS[0], settings: { ...DEFAULT_SETTINGS }, height: 700, scale: 1 });
    const rival = game.rivalSnakes[0];
    game.hazards = [];
    game.head = { x: rival.head.x - 3, y: rival.head.y };
    game.heading = 0;
    game.effectShield = 8;
    const events = game.update(1 / 120, idle);
    expect(events).toContain('crash');
    expect(game.ended).toBe('crash');
  });

  it('turns a patrol snake toward the player inside its warning range', () => {
    const game = new SnakeGame({ mode: 'campaign', level: LEVELS[0], settings: { ...DEFAULT_SETTINGS }, height: 700, scale: 1 });
    const rival = game.rivalSnakes[0];
    game.hazards = [];
    game.head = { x: rival.head.x - 70, y: rival.head.y };
    game.update(1 / 120, idle);
    expect(game.rivalSnakes[0].aggressive).toBe(true);
  });

  it('spends boost charge only while held and keeps it finite', () => {
    const game = createTutorial();
    const startCharge = game.boostCharge;
    game.update(.25, { direction: null, boost: true });
    expect(game.boostCharge).toBeLessThan(startCharge);
    game.update(1, idle);
    expect(game.boostCharge).toBeGreaterThan(0);
    expect(game.boostCharge).toBeLessThanOrEqual(5);
  });

  it('lets the authored route in every campaign level reach its flower gate', () => {
    for (const level of LEVELS) {
      const game = new SnakeGame({ mode: 'campaign', level, settings: { ...DEFAULT_SETTINGS }, height: 720, scale: 1 });
      for (let frame = 0; frame < 9000 && !game.ended; frame += 1) {
        const next = game.goalReady ? game.portal : game.pickups.find((pickup) => pickup.kind === 'nectar');
        if (!next) throw new Error(`Level ${level.id} lost its required nectar`);
        const direction = { x: next.x - game.head.x, y: next.y - game.head.y };
        game.update(1 / 60, { direction, boost: false });
      }
      expect(game.ended, `level ${level.id} should have a safe route to its exit`).toBe('win');
    }
  });
});
