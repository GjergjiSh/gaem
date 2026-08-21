// Debug readout. Numbers you can see are numbers you can tune.
//
// Two blocks, separately toggleable, because they have different lifespans. The
// live state readout is the tuning rig and you want it up while you work; the
// controls list is a reminder you need once and then never again, so it starts
// hidden, toggles on F3, and remembers which way you left it. F4 takes the whole
// HUD away — same idea as F1 for the panel and F2 for the editor.

import { T } from '../core/tuning';
import * as V from '../core/vec';
import { currentCap } from '../core/solver';
import { typingInAField } from '../engine/input';
import type { Player } from '../core/types';

const GRAPH_W = 240, GRAPH_H = 64, SAMPLES = 240;
const STORE_KEY = 'hud.visibility.v1';

export class Hud {
  private root: HTMLDivElement;
  private text: HTMLPreElement;
  private help: HTMLPreElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private history: number[] = [];
  private showHelp = false;
  private showHud = true;

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
    this.help = document.createElement('pre');
    this.help.style.cssText = 'margin:8px 0 0 0; font:inherit; color:#9fb0c0;';
    this.root.append(this.text, this.canvas, this.help);
    document.body.append(this.root);
    this.ctx = this.canvas.getContext('2d')!;

    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
      if (typeof saved.help === 'boolean') this.showHelp = saved.help;
      if (typeof saved.hud === 'boolean') this.showHud = saved.hud;
    } catch { /* the defaults above are fine */ }
    this.applyVisibility();

    addEventListener('keydown', (e) => {
      // Same guard as the panel: these listeners live on the window, so without
      // it typing a value into a tuning field would also toggle the HUD.
      if (typingInAField(e)) return;
      if (e.code === 'F3') { e.preventDefault(); this.showHelp = !this.showHelp; }
      else if (e.code === 'F4') { e.preventDefault(); this.showHud = !this.showHud; }
      else return;
      this.applyVisibility();
      localStorage.setItem(STORE_KEY,
        JSON.stringify({ help: this.showHelp, hud: this.showHud }));
    });
  }

  private applyVisibility() {
    this.root.style.display = this.showHud ? '' : 'none';
    this.help.style.display = this.showHelp ? '' : 'none';
  }

  update(
    p: Player,
    timing: { run: number; splits: string[]; best: number | null },
    ab: string,
    lookMode = '',
    viewMode = '',
    combat = '',
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
      `jumps    ${p.jumpsLeft}/${T.jump.maxJumps}   dash ${T.dash.enabled
        ? `${p.dashCharges}/${T.dash.maxCharges}`
        : `off (shift = ${T.sprint.enabled ? 'sprint' : 'nothing'})`}`,
      `chain    x${p.chain}  ${bar(p.chainTimer, T.momentum.chainWindow)}`,
      `wall     ${p.wallSide ? (p.wallSide > 0 ? 'right' : 'left ') : '--   '} arc ${bar(T.wall.gravityRamp - p.wallTime, T.wall.gravityRamp)}  chain ${p.wallChain}/${T.wall.maxChain}`,
      `coyote   ${bar(p.coyoteJump, T.jump.coyoteTime)}  buf ${bar(p.bufJump, T.jump.bufferTime)}`,
      `slidecoy ${bar(p.slideCoyote, T.slide.coyoteTime)}${p.slideCoyote > 0 ? '  LEDGE TECH ARMED' : ''}`,
      `dash cd  ${bar(T.dash.cooldown - p.dashCooldown, T.dash.cooldown)}`,
      `cables   ${p.grappling
        ? `${p.cables.map((c) => (c.on ? c.len.toFixed(1).padStart(5) : '    -')).join(' ')}`
          + `  ${p.grappleReel > 0 ? 'REEL' : p.grappleReel < 0 ? 'PAY' : 'hang'}`
          + `${p.thrusting ? '  GAS' : ''}`
        : `--   ${p.grappleKeep > 0 ? `keep ${bar(p.grappleKeep, T.grapple.keepTime)}` : ''}`}`,
      `fuel     ${bar(p.fuel, T.thruster.fuelMax)}${p.boosting ? '  BURN x'
        + T.thruster.boostBurn : p.thrusting ? '  THRUST' : p.fuelDry ? '  DRY' : ''}`,
      ``,
      `time     ${timing.run.toFixed(2)}s${timing.best !== null ? `   best ${timing.best.toFixed(2)}s` : ''}`,
      ...(combat ? [combat] : []),
      ...timing.splits.map((s) => `  ${s}`),
      ``,
      `F1 tuning · F2 editor · F3 controls · F4 hud${ab ? `   [A/B ${ab}]` : ''}`,
    ].join('\n');

    // Only built while it's on screen — this is eight string templates a frame
    // that nobody is reading once the controls are learned.
    if (this.showHelp) {
      this.help.textContent = [
        `WASD move · Space jump · Shift dash · Ctrl slide`,
        `C in the air = ground slam · landing it makes your next dashes hit harder`,
        `run into a low ledge = vault (automatic, keeps your speed)`,
        `hold Space with no jumps left = thrusters (hover + shoot)`,
        `  + Shift while thrusting = afterburner (drinks fuel, goes fast)`,
        `air into a wall = wallrun (auto-runs) · Space = eject`,
        `1 rifle · 2 shotgun · 3 railgun · Q last gun · M4 sword · M5 getsuga`,
        `M3 (middle mouse) ODM gear: BOTH cables fire, hold to hang,`,
        `  W reel in, S pay out, + hold Space = gas (the two together IS the gear)`,
        `  A/D swing the arc · let go to launch out of it`,
        `  aimed at a target it's a meathook — you fly to THEM, at sword range`,
        `view     ${viewMode}   [V to switch]`,
        `camera: ${lookMode}`,
        `it drifts back behind you when you let go`,
        `R restart · T A/B profiles · alt+1-9 built-in tunes`,
      ].join('\n');
    }

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
