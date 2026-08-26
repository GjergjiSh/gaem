// The meters. Three flat bars stacked in the top-right corner, reading down:
// gas, sword combo, Getsuga charge. Plus the red edge flash when an enemy shot
// connects.
//
// There were four. Stamina sat between gas and the sword, and it went with the
// pool it was reading: the dash spends gas now, like everything else does, so
// that bar had nothing left to say. A meter that is always full is not
// information, it is furniture.
//
// They used to be big arcs flanking the crosshair, on the theory that peripheral
// vision would pick them up without you looking away. It does — but it also puts
// four moving objects in the one part of the screen you are always looking at,
// and they fought the reticle and the target both. A resource meter is a thing
// you GLANCE at. So: a corner, small, dim, and readable by which colour moved
// rather than by reading any of them.
//
// Geometry and opacity live in T.meters, so the whole cluster is tunable from
// the panel. Redrawn every frame on one canvas: cheap, and always in sync.

import { T } from '../core/tuning';

export class Rings {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private vignette: HTMLDivElement;
  private flashT = 0;
  private size = '';

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'rings';
    this.canvas.style.cssText = 'position:fixed; z-index:14; pointer-events:none;';
    document.body.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.vignette = document.createElement('div');
    this.vignette.style.cssText = `
      position:fixed; inset:0; z-index:13; pointer-events:none; opacity:0;
      background:radial-gradient(ellipse at center, transparent 55%, rgba(220,38,38,.55) 100%);`;
    document.body.append(this.vignette);

    const style = document.createElement('style');
    style.textContent = '.editing #rings { display:none }';
    document.head.append(style);
  }

  /** Red edge pulse — the player got hit. */
  flash() { this.flashT = 0.45; }

  update(dt: number, s: {
    gas: number;            // 0..1 — the one movement tank
    thrusting: boolean;
    boosting: boolean;
    charges: number;
    maxCharges: number;
    cooldown: number;       // 0..1 remaining, 0 = ready
    getsuga: number;        // 0..1 charged, 1 = the wave is ready to throw
  }) {
    this.flashT = Math.max(0, this.flashT - dt);
    this.vignette.style.opacity = String(this.flashT / 0.45);

    const m = T.meters;
    const w = Math.round(m.width);
    const h = Math.round(m.height);
    const gap = Math.round(m.gap);
    const rows = 3;
    const pad = 2;                                   // room for the rim stroke
    const cw = w + pad * 2;
    const ch = rows * h + (rows - 1) * gap + pad * 2;

    // Resize and reposition only on a change: writing canvas.width every frame
    // clears and reallocates the backing store.
    const key = `${cw}x${ch}@${m.top},${m.right},${m.opacity}`;
    if (key !== this.size) {
      this.size = key;
      this.canvas.width = cw;
      this.canvas.height = ch;
      this.canvas.style.top = `${m.top}px`;
      this.canvas.style.right = `${m.right}px`;
      this.canvas.style.opacity = String(m.opacity);
    }

    const c = this.ctx;
    c.clearRect(0, 0, cw, ch);

    const y = (row: number) => pad + row * (h + gap);

    /** The dim track a meter sits on, with a dark rim so it reads on sky too. */
    const track = (row: number) => {
      c.fillStyle = 'rgba(6,8,14,.55)';
      c.fillRect(pad - 1, y(row) - 1, w + 2, h + 2);
      c.fillStyle = 'rgba(255,255,255,.10)';
      c.fillRect(pad, y(row), w, h);
    };

    /** Bars fill from the RIGHT, toward the screen edge: they are anchored to the
     *  corner, so a draining bar shrinks away from the middle of the view. */
    const fill = (row: number, frac: number, color: string) => {
      const len = Math.round(w * Math.min(1, Math.max(0, frac)));
      if (len <= 0) return;
      c.fillStyle = color;
      c.fillRect(pad + w - len, y(row), len, h);
    };

    // --- 0: the gas. Every move in the kit except running, the wing and the rope
    // comes out of this one bar, so it is the only meter that is worth a colour
    // change: the burner drains multiples of it, and you need to see that you are
    // spending fast without stopping to read a number. Dims when full, so a topped
    // -up tank fades out of notice and only a spent one draws the eye.
    track(0);
    fill(0, s.gas, s.boosting ? '#fb7185'
      : s.thrusting ? '#fde047'
        : s.gas >= 1 ? 'rgba(250,204,21,.35)' : '#facc15');

    // --- 1: the sword. One block per remaining swing, so the combo reads as a
    // count rather than a level; the cooldown refills the whole bar in red.
    track(1);
    const n = Math.max(1, Math.round(s.maxCharges));
    const seg = (w - (n - 1) * 2) / n;
    for (let i = 0; i < n; i++) {
      if (i >= s.charges) continue;
      c.fillStyle = '#e6edf3';
      c.fillRect(pad + i * (seg + 2), y(1), seg, h);
    }
    if (s.cooldown > 0) {
      c.fillStyle = '#f43f5e';
      c.fillRect(pad, y(1), Math.round(w * (1 - s.cooldown)), h);
    }

    // --- 2: the Getsuga, filling as it recharges. Same rule as the gas — a ready
    // wave dims out of notice, a spent one draws the eye.
    track(2);
    fill(2, s.getsuga, s.getsuga >= 1 ? 'rgba(129,140,248,.35)' : '#818cf8');
  }
}
