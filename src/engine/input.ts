import { T } from '../core/tuning';
import { clamp } from '../core/vec';
import type { Intent } from '../core/types';

const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  dash: ['ShiftLeft', 'ShiftRight'],
  slide: ['ControlLeft', 'KeyC'],
};

export class Input {
  intent: Intent = {
    moveX: 0, moveY: 0, yaw: 0, pitch: 0,
    jump: { pressed: false, held: false },
    dash: { pressed: false, held: false },
    slide: { pressed: false, held: false },
  };

  restart = false;
  private down = new Set<string>();
  private locked = false;

  constructor(private canvas: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      if (e.code === 'KeyR') this.restart = true;
      if (KEYS.jump.includes(e.code)) { this.intent.jump.pressed = true; e.preventDefault(); }
      if (KEYS.dash.includes(e.code)) this.intent.dash.pressed = true;
      if (KEYS.slide.includes(e.code)) this.intent.slide.pressed = true;
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));

    // Click the canvas to capture the mouse. No overlay: Chrome imposes a short
    // cooldown after Esc releases the lock, and a request inside that window is
    // rejected — which is what produced the "refused" state that never cleared.
    // Swallowing the error and letting the next click retry is the whole fix.
    canvas.addEventListener('click', () => {
      if (document.pointerLockElement !== canvas) {
        const r = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        if (r && typeof r.catch === 'function') r.catch(() => { /* retry on next click */ });
      }
    });
    document.addEventListener('pointerlockerror', () => { /* Esc cooldown; ignore */ });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.intent.yaw -= e.movementX * T.camera.sensitivity;
      this.intent.pitch = clamp(
        this.intent.pitch - e.movementY * T.camera.sensitivity,
        T.camera.pitchMin, T.camera.pitchMax,
      );
    });
    // Mouse buttons as alternates: LMB dash, RMB slide.
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.intent.dash.pressed = true;
      if (e.button === 2) { this.intent.slide.pressed = true; this.mouseSlide = true; }
    });
    addEventListener('mouseup', (e) => { if (e.button === 2) this.mouseSlide = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get pointerLocked() { return this.locked; }

  /** Refresh held state. Call once per rendered frame. */
  sample() {
    const on = (list: string[]) => list.some((k) => this.down.has(k));
    this.intent.moveY = (on(KEYS.forward) ? 1 : 0) - (on(KEYS.back) ? 1 : 0);
    this.intent.moveX = (on(KEYS.right) ? 1 : 0) - (on(KEYS.left) ? 1 : 0);
    this.intent.jump.held = on(KEYS.jump);
    this.intent.dash.held = on(KEYS.dash);
    this.intent.slide.held = on(KEYS.slide) || this.mouseSlide;
  }

  private mouseSlide = false;

  /** Edge flags must survive exactly one fixed tick, then be consumed. */
  consumeEdges() {
    this.intent.jump.pressed = false;
    this.intent.dash.pressed = false;
    this.intent.slide.pressed = false;
  }
}
