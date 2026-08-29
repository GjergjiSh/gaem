// The style meter. Devil May Cry's, applied to traversal instead of combat.
//
// The problem it solves: this kit is overpowered on purpose, and every situation
// has several answers. Left alone, players find the one answer that works and
// stop looking — not because the others are worse, but because there is nothing
// asking them to. So the meter does not reward MOVING, it rewards moving
// DIFFERENTLY, and it does that with one rule:
//
//   a move you just used is worth less than one you did not.
//
// Every move carries `heat`, which rises each time you use it and cools with
// time. Its payout is scaled by how cool it is, so a fifth consecutive dash pays
// a fraction of the first. Meanwhile the meter drains on its own. Put those
// together and the three states fall out without any of them being coded
// specially:
//
//   VARIED    fresh moves out-earn the drain, and the meter climbs.
//   SPAMMED   payouts shrink toward nothing, the drain does not, and the meter
//             first stalls and then falls. This is the behaviour the meter
//             exists for and it is not a penalty rule — it is just what happens
//             when income stops and outgoings do not.
//   IDLE      no income at all; it falls fastest.
//
// The one piece of real bookkeeping is `stallAt`. A move cold enough to pay
// almost nothing should also stop protecting you from the drain, or spamming
// would hold the meter at a plateau forever on scraps. Below that fraction of
// its full value a move stops counting as activity — you are still pressing
// buttons, but the meter has stopped believing you.

import { T } from '../core/tuning';
import { MOVES } from './moves';
import type { Frame, MoveName } from './moves';

/** Rank names, low to high. Index lines up with the thresholds in T.style. */
export const RANKS = ['D', 'C', 'B', 'A', 'S', 'SS', 'SSS'] as const;
export type Rank = typeof RANKS[number];

/** Threshold keys, in the same order as RANKS. */
const RANK_KEYS = ['rankD', 'rankC', 'rankB', 'rankA', 'rankS', 'rankSS', 'rankSSS'] as const;

export class Style {
  /** Current score. Everything else on screen is derived from this. */
  points = 0;
  /** Index into RANKS, or -1 for "below D" — no rank shown at all. */
  rank = -1;
  /** Per-move repetition heat. High = recently overused = worth little. */
  private heat = new Map<MoveName, number>();
  /** Seconds since a move that still counted as activity. Gates the drain. */
  private idle = 0;
  /** The last move that actually paid, and what it paid — for the readout. */
  lastMove: MoveName | null = null;
  lastGain = 0;
  private lastAt = -1e9;
  private clock = 0;

  reset() {
    this.points = 0;
    this.rank = -1;
    this.heat.clear();
    this.idle = 0;
    this.lastMove = null;
    this.lastGain = 0;
  }

  /** 0..1 across the CURRENT rank's band — the bar that drains on screen. */
  get bandFrac(): number {
    const lo = this.rank < 0 ? 0 : this.threshold(this.rank);
    const hi = this.rank + 1 < RANKS.length ? this.threshold(this.rank + 1) : T.style.max;
    return hi > lo ? Math.min(1, Math.max(0, (this.points - lo) / (hi - lo))) : 0;
  }

  /** How stale a move is right now, 1 = fully fresh. For the HUD's move list. */
  freshness(m: MoveName): number {
    const spam = Math.max(0.001, (T.styleSpam as Record<string, number>)[m] ?? 1);
    return Math.max(0, 1 - (this.heat.get(m) ?? 0) / spam);
  }

  /** Seconds since the last paying move, for fading the readout. */
  get sinceScore(): number { return this.clock - this.lastAt; }

  private threshold(i: number): number {
    return (T.style as Record<string, any>)[RANK_KEYS[i]] as number;
  }

  /** Docked for taking a hit, the way DMC docks you for getting clipped. */
  onHit() {
    if (!T.style.enabled) return;
    this.points = Math.max(0, this.points - T.style.hitPenalty);
    this.syncRank();
  }

  update(f: Frame, dt: number) {
    const s = T.style;
    this.clock += dt;
    if (!s.enabled) { this.points = 0; this.rank = -1; return; }

    // --- cool everything down first, so a move fired this frame is scored
    // against the heat it had BEFORE this frame's cooling. Otherwise a long
    // frame quietly refreshes the move you are about to spam.
    for (const [m, h] of this.heat) {
      const next = h - s.cool * dt;
      if (next <= 0) this.heat.delete(m); else this.heat.set(m, next);
    }

    for (const m of f.fired) {
      const value = (T.styleValue as Record<string, number>)[m] ?? 0;
      if (value <= 0) continue;                      // scored at 0 = not a move
      const spam = Math.max(0.001, (T.styleSpam as Record<string, number>)[m] ?? 1);
      const heat = this.heat.get(m) ?? 0;
      // Linear to zero rather than an exponential tail: `spam` then reads as
      // "how many in a row before this is worth nothing", which is a number you
      // can reason about while tuning instead of a curve constant.
      const mult = Math.max(0, 1 - heat / spam);
      const gain = value * mult;

      this.points += gain;
      this.heat.set(m, heat + 1);
      // Only a move that still pays properly resets the drain timer. Without
      // this, spam holds the meter on a plateau forever on scraps.
      if (mult >= s.stallAt) {
        this.idle = 0;
        this.lastMove = m;
        this.lastGain = gain;
        this.lastAt = this.clock;
      }
    }

    // --- the drain. Always running once the grace window lapses, and ramping in
    // rather than switching on, so the meter sags before it drops.
    this.idle += dt;
    const over = this.idle - s.grace;
    if (over > 0) {
      const ramp = s.drainRamp > 0 ? Math.min(1, over / s.drainRamp) : 1;
      this.points -= s.drain * ramp * dt;
    }

    this.points = Math.min(s.max, Math.max(0, this.points));
    this.syncRank();
  }

  private syncRank() {
    let r = -1;
    for (let i = 0; i < RANKS.length; i++) if (this.points >= this.threshold(i)) r = i;
    this.rank = r;
  }
}
