import { describe, expect, it } from 'vitest';
import { SnakeGame } from './game';
import { DEFAULT_SETTINGS } from './store';
import { fitGardenViewport, MIN_GARDEN_HEIGHT } from './viewport';

describe('garden viewport and collision bounds', () => {
  it.each([
    ['phone portrait', 368, 608],
    ['small phone portrait', 298, 332],
    ['phone landscape', 793, 287],
    ['small phone landscape', 602, 257],
    ['tablet portrait', 722, 791],
    ['wide desktop', 1354, 667],
    ['short wide window', 1200, 200],
  ])('keeps %s inside the available rectangle', (_name, width, height) => {
    const bounds = { left: 17, top: 76, width: Number(width), height: Number(height) };
    const view = fitGardenViewport(bounds);
    expect(view.height).toBeGreaterThanOrEqual(MIN_GARDEN_HEIGHT);
    expect(view.left).toBeGreaterThanOrEqual(bounds.left);
    expect(view.left + view.width * view.scale).toBeLessThanOrEqual(bounds.left + bounds.width + 1e-6);
    expect(view.top + view.height * view.scale).toBeCloseTo(bounds.top + bounds.height, 6);
    const game = new SnakeGame({ mode: 'tutorial', settings: { ...DEFAULT_SETTINGS }, height: view.height, scale: view.scale });
    expect(game.height).toBeCloseTo(view.height, 6);
    game.resize(view.height, view.scale);
    expect(game.height * view.scale).toBeCloseTo(bounds.height, 6);
  });
});
