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
  slide: ['ControlLeft'],
  // C used to be a second slide key. It is the ground slam now — in the air it
  // is a verb of its own, and on the ground it does nothing, which is the point:
  // one key, one meaning, and no crouch to fight the slide for it.
  slam: ['KeyC'],
  // Its own key, not a Space overload. Sharing Space meant the vault had to
  // decide, every tick, whether a press belonged to it or to the jump — and the
  // one time it guessed wrong was the one time you wanted the other move. A
  // dedicated key deletes the whole question.
  vault: ['KeyF'],
  // Same key as jump on purpose: jump, double jump, keep holding and the jets
  // light. The solver gates it on having no jumps left (thruster.requireEmptyJumps),
  // so a held hop can't quietly burn the tank.
  thrust: ['Space'],
};

/** Gun slots, in arsenal order. Slot N is Digit(N+1). */
const SLOT_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'];

// Every code the game consumes. Each of these gets preventDefault so the browser
// never treats a gameplay chord as a shortcut — slide (Ctrl) + strafe (D) is
// literally Ctrl+D, the "bookmark this page" accelerator, and Ctrl+S is "save
// page". (Ctrl+W closes the tab and CANNOT be blocked from a normal tab — the
// beforeunload guard below turns that into a confirm dialog instead.)
const GAME_CODES = new Set([
  ...Object.values(KEYS).flat(),
  ...SLOT_CODES,
  'KeyR', 'KeyV', 'KeyQ',
]);

/**
 * The tuning panel has real text fields. Its key events bubble to the window
 * listeners below, so without this typing a value would also drive the character.
 */
export function typingInAField(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

export class Input {
  intent: Intent = {
    moveX: 0, moveY: 0, yaw: 0, pitch: 0,
    jump: { pressed: false, held: false },
    dash: { pressed: false, held: false },
    slide: { pressed: false, held: false },
    slam: { pressed: false, held: false },
    vault: { pressed: false, held: false },
    thrust: { pressed: false, held: false },
    grapple: { pressed: false, held: false },
  };

  /** Seconds since the mouse last moved — drives the camera drift-behind. */
  mouseIdle = 0;

  /** Fire edge, consumed by the weapon. Only set while pointer-locked, so the
   *  click that CAPTURES the pointer never also fires a shot. */
  shootPressed = false;
  /** Left mouse still down. Full-auto guns read this instead of the edge. */
  shootHeld = false;
  /** Right mouse held — ADS. The "scope" is an FOV pull, handled by the weapon. */
  adsHeld = false;
  /** Mouse 4 (first side button) edge — sword swing, consumed by the sword. */
  swingPressed = false;
  /** Mouse 5 (second side button) edge — the sword's ranged wave. */
  getsugaPressed = false;
  /** Gun slot requested this frame (0-based), or null. Consumed by the weapon. */
  weaponSlot: number | null = null;
  /** Q edge — swap to the previously held gun, CS/Doom style. */
  weaponSwap = false;

  restart = false;
  toggleView = false;
  /** Escape edge — pause. Consumed by main. */
  pausePressed = false;
  /**
   * Mouse motion steers the weapon wheel instead of the camera while this is
   * set. The wheel has no cursor to move — the pointer is locked — so it reads
   * the same deltas the look does, and the look has to stop reading them or
   * choosing a gun would spin you round.
   */
  suppressLook = false;
  /** Motion accumulated while suppressLook is on, in raw mouse px. */
  wheelX = 0;
  wheelY = 0;
  /** True once a pointer-lock request has been rejected — surfaced in the HUD. */
  lockBlocked = false;
  private down = new Set<string>();
  private locked = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(private canvas: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (typingInAField(e)) return;
      // BEFORE the repeat check: a held Ctrl+D fires repeat keydowns, and each
      // one would re-trigger the bookmark dialog if left unprevented.
      if (GAME_CODES.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      if (e.code === 'Escape') this.pausePressed = true;
      if (e.code === 'KeyR') this.restart = true;
      if (e.code === 'KeyV') this.toggleView = true;
      if (e.code === 'KeyQ') this.weaponSwap = true;
      const slot = SLOT_CODES.indexOf(e.code);
      if (slot >= 0) this.weaponSlot = slot;
      if (KEYS.jump.includes(e.code)) this.intent.jump.pressed = true;
      if (KEYS.dash.includes(e.code)) this.intent.dash.pressed = true;
      if (KEYS.slide.includes(e.code)) this.intent.slide.pressed = true;
      if (KEYS.slam.includes(e.code)) this.intent.slam.pressed = true;
      if (KEYS.vault.includes(e.code)) this.intent.vault.pressed = true;
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));

    // A keyup is only delivered to the focused window. Alt-tab, click another app,
    // or hit any OS/browser chord while holding W and that keyup lands somewhere
    // else — the key stays "down" forever and the character runs on its own with
    // nothing on the keyboard to stop it. Focus loss is the only signal we get, so
    // treat it as every key being released.
    addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });

    // Ctrl+W (slide + forward!) closes the tab and JS cannot cancel it. While the
    // pointer is locked — i.e. actually playing — arm a leave-confirmation so a
    // mid-run Ctrl+W asks instead of instantly killing the session.
    addEventListener('beforeunload', (e) => {
      if (this.locked) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // Where available (Chromium, requires fullscreen to take effect), keyboard
    // lock captures even Ctrl+W/Ctrl+T for the game. Harmless no-op elsewhere.
    (navigator as any).keyboard?.lock?.([...GAME_CODES]).catch(() => {});

    // Two ways to look, because Pointer Lock is not always available: an embedded
    // frame has to be granted `allow="pointer-lock"`, and without it every request
    // is rejected. Free-look is the good path; drag-look is the fallback that always
    // works. Never depend on the lock alone — a silent rejection leaves the camera
    // completely dead, with nothing on screen to explain why.
    canvas.addEventListener('click', () => {
      // The editor owns the mouse while active: clicks select brushes there,
      // so grabbing pointer lock would fight it.
      if (document.body.classList.contains('editing')) return;
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
      if (e.button === 2) { this.adsHeld = true; return; }
      // Middle mouse is the grapple. preventDefault matters here beyond the usual
      // reason: without it the browser opens its autoscroll widget, which eats
      // every subsequent mousemove and leaves the camera dead.
      if (e.button === 1) {
        e.preventDefault();
        this.intent.grapple.pressed = true;
        this.intent.grapple.held = true;
        return;
      }
      // Side buttons drive the sword: 4 swings it, 5 throws the wave. Both must
      // be prevented or the browser takes them as back/forward navigation.
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        if (e.button === 3) this.swingPressed = true;
        else this.getsugaPressed = true;
        return;
      }
      if (e.button !== 0) return;
      if (this.locked) { this.shootPressed = true; this.shootHeld = true; return; }
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.shootHeld = false;
      if (e.button === 2) this.adsHeld = false;
      if (e.button === 1) { e.preventDefault(); this.intent.grapple.held = false; }
      if (e.button === 3 || e.button === 4) e.preventDefault();
      this.dragging = false;
    });
    // Chromium fires history navigation from side buttons on mouseup/auxclick.
    canvas.addEventListener('auxclick', (e) => {
      if (e.button === 1 || e.button === 3 || e.button === 4) e.preventDefault();
    });
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
      if (this.suppressLook) {
        this.wheelX += dx;
        this.wheelY += dy;
        return;
      }
      // Scoped aim slows the mouse — precision without a separate scope state.
      const sens = T.camera.sensitivity * (this.adsHeld ? T.weapon.adsSensScale : 1);
      this.intent.yaw -= dx * sens;
      const lo = T.camera.firstPerson ? T.camera.pitchMinFP : T.camera.pitchMin;
      const hi = T.camera.firstPerson ? T.camera.pitchMaxFP : T.camera.pitchMax;
      this.intent.pitch = clamp(this.intent.pitch - dy * sens, lo, hi);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** E held: the weapon wheel is open. Read from `down`, so a lost keyup
   *  (alt-tab mid-hold) closes it with everything else rather than sticking. */
  get wheelHeld() { return this.down.has('KeyE'); }

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
    this.intent.slam.held = on(KEYS.slam);
    this.intent.vault.held = on(KEYS.vault);
    this.intent.thrust.held = on(KEYS.thrust);
  }


  /**
   * Drop all held input. Used when focus leaves the page, where the matching
   * keyups will never arrive.
   */
  releaseAll() {
    this.down.clear();
    this.dragging = false;
    this.shootPressed = false;
    this.shootHeld = false;
    this.adsHeld = false;
    this.swingPressed = false;
    this.getsugaPressed = false;
    this.weaponSlot = null;
    this.weaponSwap = false;
    this.intent.moveX = 0;
    this.intent.moveY = 0;
    for (const b of [this.intent.jump, this.intent.dash, this.intent.slide,
      this.intent.slam, this.intent.vault, this.intent.thrust, this.intent.grapple]) {
      b.pressed = false;
      b.held = false;
    }
  }

  /** Edge flags must survive exactly one fixed tick, then be consumed. */
  consumeEdges() {
    this.intent.jump.pressed = false;
    this.intent.dash.pressed = false;
    this.intent.slide.pressed = false;
    this.intent.slam.pressed = false;
    this.intent.vault.pressed = false;
    this.intent.thrust.pressed = false;
    this.intent.grapple.pressed = false;
  }
}
