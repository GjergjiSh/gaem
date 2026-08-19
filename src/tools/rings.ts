// The peripheral meters. Left side, reading outward from the crosshair: stamina,
// then the thruster tank in yellow. Right side: the sword combo. Plus the red
// edge flash when an enemy shot connects.
//
// They are outward-facing half-circles bulging away from the crosshair and
// parked far out toward the edges of the view. That shape and that distance are
// the whole point: a meter near your aim competes with the thing you are
// actually looking at, so these sit where peripheral vision picks up a change in
// fill without ever asking you to look away from the target. Big and bold, since
// nothing out there is competing with them for space.
//
// Geometry lives in T.meters — radius, offset, stroke, sweep, spacing — so the
// whole cluster is tunable from the panel. Redrawn every frame on one centred
// canvas: cheap, and always in sync.

import { T } from '../core/tuning';

/** Everything one arc needs: where it sits, how full it is, and what colour. */
interface Arc {
  slot: number;       // 0 = nearest the crosshair, 1 = one step further out
  side: -1 | 1;       // -1 left, +1 right
  frac: number;       // 0..1
  color: string;
}

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
    // The outermost arc (slot 1) is what has to fit.
    const room = innerWidth / 2 - spacing - R - width - 8;
    const offset = Math.max(R, Math.min(T.meters.offset, room));
    // Half the canvas has to reach the far edge of the outermost arc.
    const size = Math.ceil((offset + spacing + R + width) * 2) + 4;
    if (size !== this.size) {
      this.size = size;
      this.canvas.width = size;
      this.canvas.height = size;
    }
    const cx = size / 2;

    const c = this.ctx;
    c.clearRect(0, 0, size, size);
    c.lineCap = 'round';

    // Canvas angles: 0 is +x (right), +y is DOWN. Each arc is centred on the
    // direction pointing away from the crosshair, so it always bulges outward.
    const sweep = (T.meters.sweep * Math.PI) / 180;
    const half = sweep / 2;

    const centreX = (a: Arc) => cx + a.side * (offset + a.slot * spacing);
    const facing = (a: Arc) => (a.side < 0 ? Math.PI : 0);

    /** The dim track every meter is drawn on, with a dark rim under it so the
     *  whole cluster reads against bright arena geometry as well as sky. */
    const track = (a: Arc) => {
      const x = centreX(a), f = facing(a);
      c.lineWidth = width + 3;
      c.strokeStyle = 'rgba(6,8,14,.55)';
      c.beginPath(); c.arc(x, cx, R, f - half, f + half); c.stroke();
      c.lineWidth = width;
      c.strokeStyle = 'rgba(255,255,255,.12)';
      c.beginPath(); c.arc(x, cx, R, f - half, f + half); c.stroke();
    };

    const fill = (a: Arc) => {
      if (a.frac <= 0) return;
      const x = centreX(a), f = facing(a);
      c.lineWidth = width;
      c.strokeStyle = a.color;
      c.beginPath();
      c.arc(x, cx, R, f - half, f - half + sweep * Math.min(1, a.frac));
      c.stroke();
    };

    // --- left, inner: stamina. Dims when full so a topped-up resource fades out
    // of notice entirely and only a spent one draws the eye.
    const stamina: Arc = {
      slot: 0, side: -1, frac: s.stamina,
      color: s.stamina >= 1 ? 'rgba(56,189,248,.30)' : '#38bdf8',
    };
    track(stamina); fill(stamina);

    // --- left, outer: the thruster tank, in its own colour so a glance tells you
    // which resource is empty without reading either of them.
    const fuel: Arc = {
      slot: 1, side: -1, frac: s.fuel,
      color: s.thrusting ? '#fde047' : s.fuel >= 1 ? 'rgba(250,204,21,.30)' : '#facc15',
    };
    track(fuel); fill(fuel);

    // --- right: the sword. One arc segment per remaining swing, so the combo
    // reads as a count rather than a bar; the cooldown refills the whole sweep.
    const rx = cx + offset;
    track({ slot: 0, side: 1, frac: 0, color: '' });
    const seg = sweep / s.maxCharges;
    const gap = Math.min(0.3, seg * 0.18);
    c.lineWidth = width;
    for (let i = 0; i < s.maxCharges; i++) {
      if (i >= s.charges) continue;
      c.strokeStyle = '#e6edf3';
      c.beginPath();
      c.arc(rx, cx, R, -half + i * seg + gap / 2, -half + (i + 1) * seg - gap / 2);
      c.stroke();
    }
    if (s.cooldown > 0) {
      c.strokeStyle = '#f43f5e';
      c.beginPath();
      c.arc(rx, cx, R, -half, -half + sweep * (1 - s.cooldown));
      c.stroke();
    }
  }
}
