export const GARDEN_WIDTH = 1000;
export const MIN_GARDEN_HEIGHT = 390;

export interface ViewportInfo { scale: number; height: number; left: number; top: number; width: number }

export function fitGardenViewport(bounds: { left: number; top: number; width: number; height: number }): ViewportInfo {
  const availableWidth = Math.max(1, bounds.width);
  const availableHeight = Math.max(1, bounds.height);
  const scale = Math.min(availableWidth / GARDEN_WIDTH, availableHeight / MIN_GARDEN_HEIGHT);
  return {
    scale,
    width: GARDEN_WIDTH,
    height: Math.max(MIN_GARDEN_HEIGHT, availableHeight / scale),
    left: bounds.left + (availableWidth - GARDEN_WIDTH * scale) * 0.5,
    top: bounds.top,
  };
}
