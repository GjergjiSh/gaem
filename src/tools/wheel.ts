// The weapon wheel. Hold E, the arsenal fans out and the world slows; drag to a
// slice and let go to take it.
//
// Slowing time rather than stopping it is the whole point of the feature. A menu
// that pauses is somewhere you retreat to; a menu at a fifth speed is a decision
// you make with a rocket still in the air. It multiplies its factor onto the
// clock instead of writing `world.timeScale`, so it can never hand back a
// different tune than it found.
//
// There is no cursor to move — the pointer is locked to the game — so the wheel
// reads the raw mouse deltas the look would have used, with `input.suppressLook`
// stopping the camera from reading them at the same time. Selection is by
// DIRECTION, not by position: you flick toward a slice, and how far you flick
// past the dead zone does not matter. That is what makes it fast enough to use
// in a fight.

import { T } from '../core/tuning';
import type { Input } from '../engine/input';
import { GUN_NAMES } from '../engine/weapon';
import type { Weapon } from '../engine/weapon';

export class Wheel {
  /** True while it is on screen. Main reads this to slow the clock. */
  open = false;
  /** Slice the drag is currently over, or -1 for "no change". */
  private pick = -1;
  private fade = 0;                 // 0..1, eased so it does not snap in
  private root: HTMLDivElement;
  private svg: SVGSVGElement;
  private slices: SVGPathElement[] = [];
  private labels: HTMLDivElement[] = [];
  private hint: HTMLDivElement;
  private geometryKey = '';

  constructor(private input: Input, private weapon: Weapon) {
    this.root = document.createElement('div');
    this.root.style.cssText = `
      position:fixed; inset:0; z-index:30; display:none; pointer-events:none;
      align-items:center; justify-content:center;`;
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('style', 'position:absolute; left:50%; top:50%; overflow:visible;');
    this.hint = document.createElement('div');
    this.hint.style.cssText = `
      position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
      font:600 11px/1.5 ui-monospace,monospace; letter-spacing:.16em;
      text-transform:uppercase; color:#93a4bd; text-align:center;
      text-shadow:0 2px 8px rgba(0,0,0,.9);`;
    this.root.append(this.svg, this.hint);
    document.body.append(this.root);
    // The editor owns the mouse; a wheel over it would be nonsense.
    const style = document.createElement('style');
    style.textContent = '.editing #weapon-wheel { display:none !important }';
    this.root.id = 'weapon-wheel';
    document.head.append(style);
  }

  /** Multiplied onto the world clock by main. 1 when closed. */
  get timeScale() {
    if (!this.open && this.fade <= 0) return 1;
    // Ride the fade, so time eases into the slow rather than stepping into it.
    return 1 + (T.wheel.timeScale - 1) * this.fade;
  }

  /** Real time, never the scaled clock: the menu must not slow with the world. */
  update(raw: number, blocked: boolean) {
    const want = T.wheel.enabled && !blocked && this.input.wheelHeld;

    if (want && !this.open) {
      this.open = true;
      this.pick = -1;
      this.input.wheelX = 0;
      this.input.wheelY = 0;
      this.input.suppressLook = true;
      this.root.style.display = 'flex';
      this.build();
    } else if (!want && this.open) {
      this.open = false;
      this.input.suppressLook = false;
      // Commit on release. -1 means the drag never left the dead zone, which
      // reads as "changed my mind" rather than as picking whatever is under a
      // cursor that was never moved.
      if (this.pick >= 0) this.weapon.select(this.pick);
    }

    const rate = Math.max(T.wheel.fade, 1e-3);
    this.fade += (this.open ? 1 : -1) * (raw / rate);
    this.fade = Math.max(0, Math.min(1, this.fade));
    if (!this.open && this.fade <= 0) { this.root.style.display = 'none'; return; }
    if (!this.open) { this.root.style.opacity = String(this.fade); return; }

    // --- which slice the drag is pointing at
    const k = T.wheel.sensitivity;
    const dx = this.input.wheelX * k;
    const dy = this.input.wheelY * k;
    const n = GUN_NAMES.length;
    if (Math.hypot(dx, dy) < T.wheel.deadZone) {
      this.pick = -1;
    } else {
      // Slice 0 sits at the top. Screen y grows downward, so straight up is
      // -PI/2 and the rotation below brings it to zero.
      const a = Math.atan2(dy, dx) + Math.PI / 2;
      const step = (Math.PI * 2) / n;
      this.pick = ((Math.round(a / step) % n) + n) % n;
    }

    this.root.style.opacity = String(this.fade);
    this.paint(dx, dy);
  }

  /** Rebuild the ring. Only when the slice count or the sizes actually change. */
  private build() {
    const n = GUN_NAMES.length;
    const key = [n, T.wheel.radius, T.wheel.thickness].join('|');
    if (key === this.geometryKey) return;
    this.geometryKey = key;

    for (const el of this.slices) el.remove();
    for (const el of this.labels) el.remove();
    this.slices = [];
    this.labels = [];

    const R = T.wheel.radius + T.wheel.thickness / 2;
    const r = T.wheel.radius - T.wheel.thickness / 2;
    const step = (Math.PI * 2) / n;
    const gap = 0.028;                      // radians of daylight between slices

    for (let i = 0; i < n; i++) {
      // Centre slice 0 on straight up, so the first gun is where the eye lands.
      const mid = -Math.PI / 2 + i * step;
      const a0 = mid - step / 2 + gap;
      const a1 = mid + step / 2 - gap;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', ring(a0, a1, r, R));
      path.setAttribute('stroke-width', '1');
      this.svg.append(path);
      this.slices.push(path);

      const label = document.createElement('div');
      label.textContent = `${i + 1} ${GUN_NAMES[i]}`;
      label.style.cssText = `
        position:absolute; left:50%; top:50%; white-space:nowrap;
        font:700 12px/1 ui-monospace,monospace; letter-spacing:.12em;
        text-transform:uppercase; text-shadow:0 2px 8px rgba(0,0,0,.95);
        transform:translate(-50%,-50%) translate(${Math.cos(mid) * T.wheel.radius}px,`
        + `${Math.sin(mid) * T.wheel.radius}px);`;
      this.root.append(label);
      this.labels.push(label);
    }
  }

  private paint(dx: number, dy: number) {
    this.build();
    for (let i = 0; i < this.slices.length; i++) {
      const on = i === this.pick;
      const held = i === this.weapon.slot;
      this.slices[i].setAttribute('fill', on ? 'rgba(56,189,248,.34)'
        : held ? 'rgba(148,163,184,.20)' : 'rgba(15,20,30,.55)');
      this.slices[i].setAttribute('stroke', on ? 'rgba(125,211,252,.95)'
        : held ? 'rgba(148,163,184,.55)' : 'rgba(148,163,184,.22)');
      this.labels[i].style.color = on ? '#e0f2fe' : held ? '#cbd5e1' : '#7b8798';
    }
    this.hint.textContent = this.pick >= 0 ? GUN_NAMES[this.pick] : 'drag to choose';
    // A stub of a pointer, so the flick has something to read against.
    const len = Math.min(Math.hypot(dx, dy), T.wheel.radius - T.wheel.thickness / 2 - 8);
    const a = Math.atan2(dy, dx);
    this.hint.style.transform = this.pick >= 0
      ? `translate(-50%,-50%) translate(${Math.cos(a) * len * 0.35}px,${Math.sin(a) * len * 0.35}px)`
      : 'translate(-50%,-50%)';
  }
}

/** An annulus sector from a0 to a1, between radii r and R. */
function ring(a0: number, a1: number, r: number, R: number) {
  const big = a1 - a0 > Math.PI ? 1 : 0;
  const p = (rad: number, a: number) => `${(Math.cos(a) * rad).toFixed(2)},${(Math.sin(a) * rad).toFixed(2)}`;
  return `M ${p(R, a0)} A ${R} ${R} 0 ${big} 1 ${p(R, a1)} `
    + `L ${p(r, a1)} A ${r} ${r} 0 ${big} 0 ${p(r, a0)} Z`;
}
