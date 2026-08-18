// Debug readout. Numbers you can see are numbers you can tune.

import { T } from '../core/tuning';
import * as V from '../core/vec';
import { currentCap } from '../core/solver';
import type { Player } from '../core/types';

const GRAPH_W = 240, GRAPH_H = 64, SAMPLES = 240;

export class Hud {
  private root: HTMLDivElement;
  private text: HTMLPreElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private history: number[] = [];

  constructor() {
    this.root = document.createElement('div');
    this.root.style.cssText = `
      position:fixed; left:12px; top:12px; z-index:10; pointer-events:none;
      font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace; color:#e6edf3;
      background:rgba(10,12,18,.72); padding:10px 12px; border-radius:8px;
      border:1px solid rgba(255,255,255,.09); min-width:260px;`;
    this.text = document.createElement('pre');
    this.text.style.cssText = 'margin:0 0 8px 0; font:inherit;';
    this.canvas = document.createElement('canvas');
    this.canvas.width = GRAPH_W; this.canvas.height = GRAPH_H;
    this.canvas.style.cssText = 'display:block; border-radius:4px; background:rgba(0,0,0,.35);';
    this.root.append(this.text, this.canvas);
    document.body.append(this.root);
    this.ctx = this.canvas.getContext('2d')!;
  }

  update(
    p: Player,
    timing: { run: number; splits: string[]; best: number | null },
    ab: string,
  ) {
    const h = V.lenH(p.vel);
    const cap = currentCap(p);
    const bar = (t: number, max: number) => {
      const n = Math.round(V.clamp(t / max, 0, 1) * 10);
      return '█'.repeat(n) + '·'.repeat(10 - n);
    };

    this.text.textContent = [
      `state    ${p.state.padEnd(9)}${p.grounded ? 'grounded' : 'air'}`,
      `speed    ${h.toFixed(2).padStart(6)}  cap ${cap.toFixed(1)}${h > cap + 0.05 ? '  OVER' : ''}`,
      `vert     ${p.vel.y.toFixed(2).padStart(6)}`,
      `jumps    ${p.jumpsLeft}/${T.jump.maxJumps}   dash ${p.dashCharges}/${T.dash.maxCharges}`,
      `chain    x${p.chain}  ${bar(p.chainTimer, T.momentum.chainWindow)}`,
      `wall     ${p.wallSide ? (p.wallSide > 0 ? 'right' : 'left ') : '--   '} arc ${bar(T.wall.gravityRamp - p.wallTime, T.wall.gravityRamp)}`,
      `coyote   ${bar(p.coyoteJump, T.jump.coyoteTime)}  buf ${bar(p.bufJump, T.jump.bufferTime)}`,
      `slidecoy ${bar(p.slideCoyote, T.slide.coyoteTime)}${p.slideCoyote > 0 ? '  LEDGE TECH ARMED' : ''}`,
      `dash cd  ${bar(T.dash.cooldown - p.dashCooldown, T.dash.cooldown)}`,
      ``,
      `time     ${timing.run.toFixed(2)}s${timing.best !== null ? `   best ${timing.best.toFixed(2)}s` : ''}`,
      ...timing.splits.map((s) => `  ${s}`),
      ``,
      `WASD move · Space jump · Shift dash · Ctrl slide`,
      `air into a wall = wallrun · Space = wall jump`,
      `mouse orbits the camera; it drifts back when you let go`,
      `R restart · F1 panel · T A/B${ab ? `  [${ab}]` : ''}`,
    ].join('\n');

    this.history.push(h);
    if (this.history.length > SAMPLES) this.history.shift();
    this.drawGraph(cap);
  }

  private drawGraph(cap: number) {
    const c = this.ctx;
    c.clearRect(0, 0, GRAPH_W, GRAPH_H);
    const max = Math.max(T.momentum.hardCap * 0.6, ...this.history) * 1.1;

    // base cap reference line
    const capY = GRAPH_H - (cap / max) * GRAPH_H;
    c.strokeStyle = 'rgba(251,191,36,.55)';
    c.setLineDash([3, 3]);
    c.beginPath(); c.moveTo(0, capY); c.lineTo(GRAPH_W, capY); c.stroke();
    c.setLineDash([]);

    c.strokeStyle = '#38bdf8';
    c.lineWidth = 1.5;
    c.beginPath();
    this.history.forEach((v, i) => {
      const x = (i / SAMPLES) * GRAPH_W;
      const y = GRAPH_H - (v / max) * GRAPH_H;
      i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    });
    c.stroke();
  }
}
