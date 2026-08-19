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

  /** Seconds since the mouse last moved — drives the camera drift-behind. */
  mouseIdle = 0;

  restart = false;
  toggleView = false;
  /** True once a pointer-lock request has been rejected — surfaced in the HUD. */
  lockBlocked = false;
  private down = new Set<string>();
  private locked = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(private canvas: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      if (e.code === 'KeyR') this.restart = true;
      if (e.code === 'KeyV') this.toggleView = true;
      if (KEYS.jump.includes(e.code)) { this.intent.jump.pressed = true; e.preventDefault(); }
      if (KEYS.dash.includes(e.code)) this.intent.dash.pressed = true;
      if (KEYS.slide.includes(e.code)) this.intent.slide.pressed = true;
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));

    // Two ways to look, because Pointer Lock is not always available: an embedded
    // frame has to be granted `allow="pointer-lock"`, and without it every request
    // is rejected. Free-look is the good path; drag-look is the fallback that always
    // works. Never depend on the lock alone — a silent rejection leaves the camera
    // completely dead, with nothing on screen to explain why.
    canvas.addEventListener('click', () => {
      if (document.pointerLockElement === canvas) return;
      try {
        const r = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        if (r && typeof r.catch === 'function') r.catch(() => { this.lockBlocked = true; });
      } catch { this.lockBlocked = true; }
    });
    document.addEventListener('pointerlockerror', () => { this.lockBlocked = true; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) this.lockBlocked = false;
    });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || this.locked) return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    addEventListener('mouseup', () => { this.dragging = false; });
    addEventListener('mouseleave', () => { this.dragging = false; });

    addEventListener('mousemove', (e) => {
      let dx = 0, dy = 0;
      if (this.locked) {
        dx = e.movementX; dy = e.movementY;
      } else if (this.dragging) {
        dx = e.clientX - this.lastX; dy = e.clientY - this.lastY;
        this.lastX = e.clientX; this.lastY = e.clientY;
      } else {
        return;
      }
      this.mouseIdle = 0;
      this.intent.yaw -= dx * T.camera.sensitivity;
      const lo = T.camera.firstPerson ? T.camera.pitchMinFP : T.camera.pitchMin;
      const hi = T.camera.firstPerson ? T.camera.pitchMaxFP : T.camera.pitchMax;
      this.intent.pitch = clamp(this.intent.pitch - dy * T.camera.sensitivity, lo, hi);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get pointerLocked() { return this.locked; }
  get lookMode() {
    if (this.locked) return 'free look';
    return this.lockBlocked ? 'drag to look (pointer lock blocked)' : 'click to capture · or drag to look';
  }

  /** Refresh held state. Call once per rendered frame. */
  sample(dt = 0) {
    this.mouseIdle += dt;
    const on = (list: string[]) => list.some((k) => this.down.has(k));
    this.intent.moveY = (on(KEYS.forward) ? 1 : 0) - (on(KEYS.back) ? 1 : 0);
    this.intent.moveX = (on(KEYS.right) ? 1 : 0) - (on(KEYS.left) ? 1 : 0);
    this.intent.jump.held = on(KEYS.jump);
    this.intent.dash.held = on(KEYS.dash);
    this.intent.slide.held = on(KEYS.slide);
  }


  /** Edge flags must survive exactly one fixed tick, then be consumed. */
  consumeEdges() {
    this.intent.jump.pressed = false;
    this.intent.dash.pressed = false;
    this.intent.slide.pressed = false;
  }
}
