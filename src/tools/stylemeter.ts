// The style meter's face. Scoring lives in engine/style.ts; this only draws it.
//
// Two things it has to communicate, and the second is the one that matters:
//
//   WHERE YOU ARE   the rank letter and a bar across the current rank's band.
//   WHY             which move just paid, and how much. Without that the meter
//                   is a number that moves on its own and nobody learns the
//                   variety rule from it. With it, the first time a fifth dash
//                   pays 4 instead of 20 you can see that it did.
//
// It also goes red and starts sliding as soon as the drain bites, because the
// moment the meter turns against you is the moment you need to know.

import { T } from '../core/tuning';
import { RANKS } from '../engine/style';
import type { Style } from '../engine/style';

/** Rank colours, low to high. Cool and dim through to white-hot. */
const COLOURS = ['#8d97a6', '#5fa8f5', '#42d17d', '#f2d23f', '#f79231', '#f2564b', '#ffffff'];

export class StyleMeter {
  private root: HTMLDivElement;
  private letter: HTMLDivElement;
  private barFill: HTMLDivElement;
  private note: HTMLDivElement;
  private shown = false;
  private lastRank = -1;

  constructor() {
    this.root = document.createElement('div');
    this.root.style.cssText = `
      position:fixed; right:16px; top:14px; z-index:11; pointer-events:none;
      display:flex; flex-direction:column; align-items:flex-end; gap:4px;
      font:600 12px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace;
      opacity:0; transition:opacity .18s ease;`;

    this.letter = document.createElement('div');
    this.letter.style.cssText = `
      font:800 54px/0.9 ui-monospace,SFMono-Regular,Consolas,monospace;
      letter-spacing:-0.02em; transition:color .12s, transform .12s;`;

    const bar = document.createElement('div');
    bar.style.cssText = `
      width:132px; height:5px; border-radius:3px; overflow:hidden;
      background:rgba(255,255,255,.13);`;
    this.barFill = document.createElement('div');
    this.barFill.style.cssText = 'height:100%; width:0%; border-radius:3px; transition:width .08s linear;';
    bar.append(this.barFill);

    this.note = document.createElement('div');
    this.note.style.cssText = 'color:#c7d0dc; opacity:0; transition:opacity .2s; height:14px;';

    this.root.append(this.letter, bar, this.note);
    document.body.append(this.root);
  }

  update(s: Style) {
    const on = T.style.enabled && T.style.show && s.rank >= 0;
    if (on !== this.shown) {
      this.shown = on;
      this.root.style.opacity = on ? '1' : '0';
    }
    if (!on) { this.lastRank = -1; return; }

    const colour = COLOURS[Math.min(s.rank, COLOURS.length - 1)];
    this.letter.textContent = RANKS[s.rank];
    this.letter.style.color = colour;
    // SSS earns a glow. Nothing below it does, or the top rank stops reading as
    // an achievement.
    this.letter.style.textShadow = s.rank >= RANKS.length - 1
      ? `0 0 18px ${colour}, 0 0 44px ${colour}` : 'none';

    // A rank change gets one punch of scale. Cheap, and it is the only moment
    // the meter is allowed to draw the eye away from the world.
    if (s.rank !== this.lastRank) {
      this.lastRank = s.rank;
      this.letter.style.transform = 'scale(1.22)';
      requestAnimationFrame(() => { this.letter.style.transform = 'scale(1)'; });
    }

    // The bar turns red once the drain has actually started eating the score,
    // rather than merely once you stopped pressing things.
    const draining = s.sinceScore > T.style.grace;
    this.barFill.style.width = `${(s.bandFrac * 100).toFixed(1)}%`;
    this.barFill.style.background = draining ? '#e0553f' : colour;

    // What just paid, and what it was worth. This is the teaching surface: a
    // move gone stale shows a visibly smaller number than the same move fresh.
    if (s.lastMove && s.sinceScore < 1.3) {
      const full = (T.styleValue as Record<string, number>)[s.lastMove] ?? 0;
      const stale = full > 0 && s.lastGain < full * 0.66;
      this.note.textContent = `${s.lastMove}  +${Math.round(s.lastGain)}${stale ? '  stale' : ''}`;
      this.note.style.color = stale ? '#e0a03f' : '#c7d0dc';
      this.note.style.opacity = '1';
    } else {
      this.note.style.opacity = '0';
    }
  }
}
