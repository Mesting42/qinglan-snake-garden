import type { InputSnapshot } from './game';
import type { Point } from './math';

export class InputController {
  private held = new Set<string>();
  private stick: Point | null = null;
  private stickPointer: number | null = null;
  private boostPointers = new Set<number>();
  private boostKey = false;
  private enabled = false;
  private readonly stickBase: HTMLElement;
  private readonly stickKnob: HTMLElement;
  private readonly boostButton: HTMLButtonElement;
  private readonly onEscape: () => void;

  constructor(stickBase: HTMLElement, stickKnob: HTMLElement, boostButton: HTMLButtonElement, onEscape: () => void) {
    this.stickBase = stickBase;
    this.stickKnob = stickKnob;
    this.boostButton = boostButton;
    this.onEscape = onEscape;
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.clearInputs);
    this.stickBase.addEventListener('pointerdown', this.stickDown);
    this.stickBase.addEventListener('pointermove', this.stickMove);
    this.stickBase.addEventListener('lostpointercapture', this.stickCaptureLost);
    window.addEventListener('pointerup', this.pointerUp);
    window.addEventListener('pointercancel', this.pointerUp);
    this.boostButton.addEventListener('pointerdown', this.boostDown);
    this.boostButton.addEventListener('lostpointercapture', this.boostCaptureLost);
    this.boostButton.addEventListener('contextmenu', this.preventDefault);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clearInputs();
  }

  snapshot(): InputSnapshot {
    const direction = this.enabled
      ? this.held.size > 0 ? this.keyboardDirection() : this.stick
      : null;
    return { direction, boost: this.enabled && (this.boostKey || this.boostPointers.size > 0) };
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.clearInputs);
    this.stickBase.removeEventListener('pointerdown', this.stickDown);
    this.stickBase.removeEventListener('pointermove', this.stickMove);
    this.stickBase.removeEventListener('lostpointercapture', this.stickCaptureLost);
    window.removeEventListener('pointerup', this.pointerUp);
    window.removeEventListener('pointercancel', this.pointerUp);
    this.boostButton.removeEventListener('pointerdown', this.boostDown);
    this.boostButton.removeEventListener('lostpointercapture', this.boostCaptureLost);
    this.boostButton.removeEventListener('contextmenu', this.preventDefault);
  }

  private readonly keyDown = (event: KeyboardEvent): void => {
    if (!this.enabled) return;
    const key = event.code;
    if (event.key === 'Escape' || key === 'Escape' || key === 'KeyP' || event.key.toLowerCase() === 'p') {
      event.preventDefault();
      this.onEscape();
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(key)) event.preventDefault();
    if (key === 'ShiftLeft' || key === 'ShiftRight') this.boostKey = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(key)) this.held.add(key);
  };

  private readonly keyUp = (event: KeyboardEvent): void => {
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') this.boostKey = false;
    this.held.delete(event.code);
  };

  private readonly keyboardDirection = (): Point | null => {
    let x = 0;
    let y = 0;
    if (this.held.has('ArrowLeft') || this.held.has('KeyA')) x -= 1;
    if (this.held.has('ArrowRight') || this.held.has('KeyD')) x += 1;
    if (this.held.has('ArrowUp') || this.held.has('KeyW')) y -= 1;
    if (this.held.has('ArrowDown') || this.held.has('KeyS')) y += 1;
    return x === 0 && y === 0 ? null : { x, y };
  };

  private readonly pointerUp = (event: PointerEvent): void => {
    this.boostPointers.delete(event.pointerId);
    if (this.boostButton.hasPointerCapture(event.pointerId)) this.boostButton.releasePointerCapture(event.pointerId);
    if (this.boostPointers.size === 0) this.boostButton.classList.remove('is-held');
    if (this.stickPointer === event.pointerId) {
      this.resetStick();
      if (this.stickBase.hasPointerCapture(event.pointerId)) this.stickBase.releasePointerCapture(event.pointerId);
    }
  };

  private readonly stickDown = (event: PointerEvent): void => {
    if (!this.enabled) return;
    event.preventDefault();
    if (this.stickPointer !== null) return;
    this.stickPointer = event.pointerId;
    this.stickBase.setPointerCapture(event.pointerId);
    this.updateStick(event);
  };

  private readonly stickMove = (event: PointerEvent): void => {
    if (!this.enabled || this.stickPointer !== event.pointerId) return;
    this.updateStick(event);
  };

  private updateStick(event: PointerEvent): void {
    const rect = this.stickBase.getBoundingClientRect();
    const centerX = rect.left + rect.width * 0.5;
    const centerY = rect.top + rect.height * 0.5;
    const max = rect.width * 0.31;
    let dx = event.clientX - centerX;
    let dy = event.clientY - centerY;
    const length = Math.hypot(dx, dy);
    if (length > max) {
      dx *= max / length;
      dy *= max / length;
    }
    this.stick = Math.hypot(dx, dy) < rect.width * 0.1 ? null : { x: dx / max, y: dy / max };
    this.stickKnob.style.setProperty('--stick-x', `${dx}px`);
    this.stickKnob.style.setProperty('--stick-y', `${dy}px`);
  }

  private readonly boostDown = (event: PointerEvent): void => {
    if (!this.enabled) return;
    event.preventDefault();
    this.boostButton.setPointerCapture(event.pointerId);
    this.boostPointers.add(event.pointerId);
    this.boostButton.classList.add('is-held');
  };

  private resetStick(): void {
    this.stickPointer = null;
    this.stick = null;
    this.stickKnob.style.setProperty('--stick-x', '0px');
    this.stickKnob.style.setProperty('--stick-y', '0px');
  }

  private readonly stickCaptureLost = (event: PointerEvent): void => {
    if (this.stickPointer === event.pointerId) this.resetStick();
  };

  private readonly boostCaptureLost = (event: PointerEvent): void => {
    this.boostPointers.delete(event.pointerId);
    if (this.boostPointers.size === 0) this.boostButton.classList.remove('is-held');
  };

  private readonly clearInputs = (): void => {
    const stickPointer = this.stickPointer;
    const boostPointers = [...this.boostPointers];
    this.held.clear();
    this.boostKey = false;
    this.boostPointers.clear();
    this.resetStick();
    this.boostButton.classList.remove('is-held');
    if (stickPointer !== null && this.stickBase.hasPointerCapture(stickPointer)) this.stickBase.releasePointerCapture(stickPointer);
    for (const id of boostPointers) if (this.boostButton.hasPointerCapture(id)) this.boostButton.releasePointerCapture(id);
  };

  private readonly preventDefault = (event: Event): void => event.preventDefault();
}
