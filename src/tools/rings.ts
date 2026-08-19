// The peripheral meters. Movement resources on the left (stamina outside,
// thruster fuel inside), the sword combo on the right, plus the red edge flash
// when an enemy shot connects.
//
// They are outward-facing half-circles bulging away from the crosshair and
// parked far out toward the edges of the view. That shape and that distance are
// the whole point: a meter near your aim competes with the thing you are
// actually looking at, so these sit where peripheral vision picks up a change in
// fill without ever asking you to look away from the target.
//
// Geometry lives in T.meters — radius, offset, stroke, sweep — so the whole
// cluster is tunable from the panel. Redrawn every frame on one centred canvas:
// cheap, and always in sync.

import { T } from '../core/tuning';

export class Rings {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private vignette: HTMLDivElement;
  private flashT = 0;
  private size = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'rings';
    this.canvas.style.cssText = `
      position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
      z-index:14; pointer-events:none;`;
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
    stamina: number;        // 0..1
    fuel: number;           // 0..1 thruster tank
    thrusting: boolean;
    charges: number;
    maxCharges: number;
    cooldown: number;       // 0..1 remaining, 0 = ready
  }) {
    this.flashT = Math.max(0, this.flashT - dt);
    this.vignette.style.opacity = String(this.flashT / 0.45);

    const { radius: R, width, spacing } = T.meters;
    // A big offset on a small window would push the meters off screen entirely,
    // so the tuned value is a request, not a promise — it yields to the viewport.
    const room = innerWidth / 2 - R - width - 8;
    const offset = Math.max(R, Math.min(T.meters.offset, room));
    // Half the canvas has to reach the far edge of the outer arc, stroke included.
    const size = Math.ceil((offset + R + width) * 2) + 4;
    if (size !== this.size) {
      this.size = size;
      this.canvas.width = size;
      this.canvas.height = size;
    }
    const cx = size / 2;

    const c = this.ctx;
    c.clearRect(0, 0, size, size);
    c.lineWidth = width;
    c.lineCap = 'round';

    // Canvas angles: 0 is +x (right), +y is DOWN. Each cluster's arc is centred
    // on the direction pointing away from the crosshair, so it bulges outward.
    const sweep = (T.meters.sweep * Math.PI) / 180;
    const half = sweep / 2;
    const LEFT = Math.PI, RIGHT = 0;

    /** One filled arc: a dim track with `frac` of it drawn in `color`. */
    const meter = (x: number, r: number, centre: number, frac: number, color: string) => {
      c.strokeStyle = 'rgba(255,255,255,.13)';
      c.beginPath(); c.arc(x, cx, r, centre - half, centre + half); c.stroke();
      if (frac <= 0) return;
      c.strokeStyle = color;
      c.beginPath();
      c.arc(x, cx, r, centre - half, centre - half + sweep * Math.min(1, frac));
      c.stroke();
    };

    // --- left: movement. Stamina outside, thruster fuel on the inner arc.
    // Both dim when full, so a topped-up resource fades out of notice entirely
    // and only a spent one draws the eye.
    const lx = cx - offset;
    meter(lx, R, LEFT, s.stamina, s.stamina >= 1 ? 'rgba(56,189,248,.32)' : '#38bdf8');
    const fuelR = R - width - spacing;
    if (fuelR > width) {
      const fuel = s.thrusting ? '#fb923c'
        : s.fuel >= 1 ? 'rgba(251,146,60,.28)' : '#f59e0b';
      meter(lx, fuelR, LEFT, s.fuel, fuel);
    }

    // --- right: the sword. One arc segment per remaining swing, so the combo
    // reads as a count rather than a bar; the cooldown refills the whole sweep.
    const rx = cx + offset;
    const seg = sweep / s.maxCharges;
    const gap = Math.min(0.3, seg * 0.18);
    for (let i = 0; i < s.maxCharges; i++) {
      const a0 = RIGHT - half + i * seg + gap / 2;
      const a1 = RIGHT - half + (i + 1) * seg - gap / 2;
      c.strokeStyle = i < s.charges ? '#e6edf3' : 'rgba(255,255,255,.13)';
      c.beginPath(); c.arc(rx, cx, R, a0, a1); c.stroke();
    }
    if (s.cooldown > 0) {
      c.strokeStyle = '#f43f5e';
      c.beginPath();
      c.arc(rx, cx, R, RIGHT - half, RIGHT - half + sweep * (1 - s.cooldown));
      c.stroke();
    }
  }
}
