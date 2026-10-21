import { describe, expect, it } from 'vitest';
import { InputController } from './input';

class FakeTarget extends EventTarget {
  captures = new Set<number>();
  style = { setProperty: () => undefined };
  classList = { add: () => undefined, remove: () => undefined };

  setPointerCapture(id: number): void { this.captures.add(id); }
  hasPointerCapture(id: number): boolean { return this.captures.has(id); }
  releasePointerCapture(id: number): void { this.captures.delete(id); }
  getBoundingClientRect(): DOMRect {
    return { x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, toJSON: () => ({}) };
  }
}

class FakePointerEvent extends Event {
  constructor(type: string, readonly pointerId: number, readonly clientX: number, readonly clientY: number) {
    super(type);
  }
}

class FakeKeyboardEvent extends Event {
  constructor(type: string, readonly code: string, readonly key: string) { super(type); }
  override preventDefault(): void { return; }
}

describe('independent touch pointers', () => {
  it('ignores extra joystick fingers and clears only the pointer whose capture is lost', () => {
    const fakeWindow = new FakeTarget();
    const originalWindow = (globalThis as typeof globalThis & { window?: Window }).window;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
    const stick = new FakeTarget();
    const knob = new FakeTarget();
    const boost = new FakeTarget();
    const controller = new InputController(stick as unknown as HTMLElement, knob as unknown as HTMLElement, boost as unknown as HTMLButtonElement, () => undefined);
    controller.setEnabled(true);
    try {
      stick.dispatchEvent(new FakePointerEvent('pointerdown', 11, 75, 25));
      const direction = controller.snapshot().direction;
      stick.dispatchEvent(new FakePointerEvent('pointerdown', 13, 25, 75));
      stick.dispatchEvent(new FakePointerEvent('pointermove', 13, 20, 80));
      fakeWindow.dispatchEvent(new FakePointerEvent('pointerup', 13, 20, 80));
      expect(controller.snapshot().direction).toEqual(direction);
      expect(stick.hasPointerCapture(13)).toBe(false);
      boost.dispatchEvent(new FakePointerEvent('pointerdown', 12, 50, 50));
      stick.releasePointerCapture(11);
      stick.dispatchEvent(new FakePointerEvent('lostpointercapture', 11, 75, 25));
      expect(controller.snapshot()).toEqual({ direction: null, boost: true });
      stick.dispatchEvent(new FakePointerEvent('pointerdown', 14, 75, 25));
      boost.releasePointerCapture(12);
      boost.dispatchEvent(new FakePointerEvent('lostpointercapture', 12, 50, 50));
      expect(controller.snapshot()).toEqual({ direction, boost: false });
      boost.dispatchEvent(new FakePointerEvent('pointerdown', 15, 50, 50));
      fakeWindow.dispatchEvent(new Event('blur'));
      expect(controller.snapshot()).toEqual({ direction: null, boost: false });
      expect(stick.captures.size).toBe(0);
      expect(boost.captures.size).toBe(0);
    } finally {
      controller.destroy();
      if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
    }
  });

  it('keeps joystick steering while a second pointer holds boost', () => {
    const fakeWindow = new FakeTarget();
    const originalWindow = (globalThis as typeof globalThis & { window?: Window }).window;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
    const stick = new FakeTarget();
    const knob = new FakeTarget();
    const boost = new FakeTarget();
    const controller = new InputController(stick as unknown as HTMLElement, knob as unknown as HTMLElement, boost as unknown as HTMLButtonElement, () => undefined);
    controller.setEnabled(true);

    try {
      stick.dispatchEvent(new FakePointerEvent('pointerdown', 11, 75, 25));
      boost.dispatchEvent(new FakePointerEvent('pointerdown', 12, 50, 50));
      const simultaneous = controller.snapshot();
      expect(simultaneous.direction).not.toBeNull();
      expect(simultaneous.boost).toBe(true);

      fakeWindow.dispatchEvent(new FakePointerEvent('pointerup', 12, 50, 50));
      boost.dispatchEvent(new FakePointerEvent('pointerup', 12, 50, 50));
      const afterBoostRelease = controller.snapshot();
      expect(afterBoostRelease.direction).not.toBeNull();
      expect(afterBoostRelease.boost).toBe(false);

      fakeWindow.dispatchEvent(new FakePointerEvent('pointerup', 11, 75, 25));
      stick.dispatchEvent(new FakePointerEvent('pointerup', 11, 75, 25));
      expect(controller.snapshot()).toEqual({ direction: null, boost: false });
    } finally {
      controller.destroy();
      if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
    }
  });

  it('steers with WASD and directions, and holds boost only while Shift is down', () => {
    const fakeWindow = new FakeTarget();
    const originalWindow = (globalThis as typeof globalThis & { window?: Window }).window;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
    const stick = new FakeTarget();
    const knob = new FakeTarget();
    const boost = new FakeTarget();
    const controller = new InputController(stick as unknown as HTMLElement, knob as unknown as HTMLElement, boost as unknown as HTMLButtonElement, () => undefined);
    controller.setEnabled(true);

    try {
      fakeWindow.dispatchEvent(new FakeKeyboardEvent('keydown', 'KeyW', 'w'));
      fakeWindow.dispatchEvent(new FakeKeyboardEvent('keydown', 'ShiftLeft', 'Shift'));
      expect(controller.snapshot()).toEqual({ direction: { x: 0, y: -1 }, boost: true });
      fakeWindow.dispatchEvent(new FakeKeyboardEvent('keyup', 'ShiftLeft', 'Shift'));
      expect(controller.snapshot()).toEqual({ direction: { x: 0, y: -1 }, boost: false });
      fakeWindow.dispatchEvent(new FakeKeyboardEvent('keyup', 'KeyW', 'w'));
      expect(controller.snapshot()).toEqual({ direction: null, boost: false });
    } finally {
      controller.destroy();
      if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
    }
  });
});
