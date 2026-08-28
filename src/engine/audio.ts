// Movement audio. Clips live in assets/odm-sounds-ref/ and are assigned to moves
// from the panel's `sounds` folder at runtime — nothing here hardcodes which file
// is which verb, because that is a judgement call for ears, not for code.
//
// Which move fired is not decided here — engine/moves.ts derives that once per
// frame and the style meter scores the same Frame. Two copies of that edge
// detection (a jump, a double jump and a wall jump are one charge spend, told
// apart only by where you were standing) would drift the first time either was
// touched. This file only turns a move into a sound.
//
// The other half of the file is flow. Moves here cancel into each other, so at
// any instant several clips are live and any one can be interrupted mid-flight.
// Five mechanisms handle that, and every one of them is a slider in `soundFlow`
// rather than a constant, because which settings feel right is not something
// that can be decided from outside the game:
//
//   crossfade   the clips are one-shot RECORDINGS, not loop-ready material, so
//               the held ones (jets, wingsuit, reel) are rebuilt at load into
//               seamless loops. Without this a held jet ticks once a second.
//   fades       loops ease in and out instead of snapping, so entering and
//               leaving a mode is a transition rather than an edit.
//   ducking     a loud one-shot dips the loop bus for a moment, so a landing
//               still reads while the jets are roaring underneath it.
//   retrigger   a floor on how often one slot can refire, so a verb you can
//               spam does not machine-gun.
//   cancel      refiring a slot fades the copy already playing rather than
//               stacking on it, which is what stops a chain of dashes turning
//               into a wall of noise.

import { T } from '../core/tuning';
import type { Frame } from './moves';

const FILES = import.meta.glob('/assets/odm-sounds-ref/*.wav', {
  query: '?url', import: 'default', eager: true,
}) as Record<string, string>;

const URL_BY_NAME: Record<string, string> = {};
for (const [path, url] of Object.entries(FILES)) {
  URL_BY_NAME[path.split('/').pop()!.replace(/\.wav$/, '')] = url;
}

/** Every clip on disk, for the panel's dropdowns. */
export const CLIP_NAMES = Object.keys(URL_BY_NAME).sort();

/** Slots that hold a note for as long as a key is down. The rest are one-shots. */
const LOOP_SLOTS = new Set(['thruster', 'wingsuit', 'reel']);

/** Slots loud enough to duck the beds. Impacts and the committed verbs. */
const DUCKERS = new Set(['land', 'slam', 'superDash', 'hookHit', 'dash']);

type Slot = keyof typeof T.soundAssign;

interface LoopVoice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  clip: string;
  stopping: boolean;
}

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private oneShotBus!: GainNode;
  private loopBus!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private loopBuffers = new Map<string, AudioBuffer>();
  private loops = new Map<string, LoopVoice>();
  private playing = new Map<string, { gain: GainNode; src: AudioBufferSourceNode }>();
  private lastFired = new Map<string, number>();
  private duckUntil = 0;
  private ready = false;
  /** Set once the browser has let us out of the autoplay gate. */
  private armed = false;

  constructor() {
    // Browsers hold the speaker until a real gesture. The game pointer-locks on
    // click, so there is always one — we just have to not miss it.
    const arm = () => { void this.arm(); };
    addEventListener('pointerdown', arm, { once: true });
    addEventListener('keydown', arm, { once: true });
  }

  private async arm() {
    if (this.armed) return;
    this.armed = true;
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
    const ctx: AudioContext = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.oneShotBus = ctx.createGain();
    this.loopBus = ctx.createGain();
    this.oneShotBus.connect(this.master);
    this.loopBus.connect(this.master);
    this.master.connect(ctx.destination);

    await Promise.all(CLIP_NAMES.map(async (name) => {
      try {
        const res = await fetch(URL_BY_NAME[name]);
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(name, buf);
      } catch { /* a clip that will not decode is simply never assignable */ }
    }));
    this.ready = true;
  }

  /**
   * Rebuild a one-shot recording into something that can be held.
   *
   * These clips were cut from footage; their heads and tails do not match, so
   * looping one raw ticks audibly every pass. This folds the last `xf` seconds
   * back over the first `xf` on an equal-power curve, which makes the join
   * continuous. Cached, because it costs a copy of the buffer.
   */
  private seamless(name: string, xf: number): AudioBuffer | null {
    const key = `${name}@${xf.toFixed(3)}`;
    const hit = this.loopBuffers.get(key);
    if (hit) return hit;
    const src = this.buffers.get(name);
    if (!src || !this.ctx) return null;

    const sr = src.sampleRate;
    const fade = Math.min(Math.floor(xf * sr), Math.floor(src.length / 3));
    if (fade < 32) return src;                       // too short to be worth it
    const len = src.length - fade;
    const out = this.ctx.createBuffer(src.numberOfChannels, len, sr);
    for (let c = 0; c < src.numberOfChannels; c++) {
      const i0 = src.getChannelData(c);
      const o = out.getChannelData(c);
      o.set(i0.subarray(0, len));
      for (let i = 0; i < fade; i++) {
        const t = i / fade;
        // Equal power: a linear crossfade dips in the middle, and on a loop that
        // dip is heard once per pass as a pulse.
        o[i] = o[i] * Math.sqrt(t) + i0[len + i] * Math.sqrt(1 - t);
      }
    }
    this.loopBuffers.set(key, out);
    return out;
  }

  private clipFor(slot: Slot): string {
    return (T.soundAssign as Record<string, string>)[slot] ?? '';
  }

  private gainFor(slot: Slot): number {
    return (T.soundLevel as Record<string, number>)[slot] ?? 1;
  }

  /** Fire a one-shot. `scale` lets an impact be louder for a harder landing. */
  private fire(slot: Slot, scale = 1) {
    const ctx = this.ctx;
    const f = T.soundFlow;
    if (!ctx || !this.ready || !f.enabled) return;
    const clip = this.clipFor(slot);
    const buf = clip ? this.buffers.get(clip) : null;
    if (!buf) return;

    const now = ctx.currentTime;
    const last = this.lastFired.get(slot) ?? -1e9;
    if (now - last < f.retrigger) return;            // machine-gun guard
    this.lastFired.set(slot, now);

    // Cancel the copy already in the air rather than stacking onto it.
    const live = this.playing.get(slot);
    if (live) {
      const g = live.gain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + f.cancelFade);
      try { live.src.stop(now + f.cancelFade + 0.02); } catch { /* already done */ }
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    // A touch of detune per shot so a repeated verb does not sound like a
    // sample being retriggered. Small — past a few per cent it sounds broken.
    if (f.pitchVary > 0) src.playbackRate.value = 1 + (Math.random() * 2 - 1) * f.pitchVary;
    const gain = ctx.createGain();
    gain.gain.value = this.gainFor(slot) * f.oneShot * scale;
    src.connect(gain);
    gain.connect(this.oneShotBus);
    src.start(now);
    this.playing.set(slot, { gain, src });
    src.onended = () => { if (this.playing.get(slot)?.src === src) this.playing.delete(slot); };

    if (f.duck > 0 && DUCKERS.has(slot)) this.duck(now);
  }

  /** Dip the beds so an impact reads through them, then bring them back. */
  private duck(now: number) {
    const f = T.soundFlow;
    const g = this.loopBus.gain;
    const end = now + f.duckTime;
    if (end <= this.duckUntil) return;               // already ducked deeper
    this.duckUntil = end;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(1 - f.duck, now + Math.min(0.02, f.duckTime * 0.25));
    g.linearRampToValueAtTime(1, end);
  }

  /** Hold or release a looping slot. Idempotent — safe to call every frame. */
  private hold(slot: Slot, want: boolean) {
    const ctx = this.ctx;
    const f = T.soundFlow;
    if (!ctx || !this.ready) return;
    const clip = this.clipFor(slot);
    const cur = this.loops.get(slot);
    const on = want && f.enabled && !!clip;

    // A clip reassigned from the panel while it is playing has to be swapped,
    // or the dropdown appears not to work until you stop moving.
    if (cur && !cur.stopping && (!on || cur.clip !== clip)) {
      const g = cur.gain.gain;
      const now = ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + f.loopFade);
      try { cur.src.stop(now + f.loopFade + 0.05); } catch { /* already done */ }
      cur.stopping = true;
      this.loops.delete(slot);
    }
    if (!on || this.loops.has(slot)) return;

    const buf = this.seamless(clip, f.loopXfade);
    if (!buf) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(this.gainFor(slot) * f.loops, now + f.loopFade);
    src.connect(gain);
    gain.connect(this.loopBus);
    src.start(now);
    this.loops.set(slot, { src, gain, clip, stopping: false });
  }

  /** Track live level changes on a held slot without restarting it. */
  private trim(slot: Slot) {
    const l = this.loops.get(slot);
    if (!l || l.stopping || !this.ctx) return;
    const target = this.gainFor(slot) * T.soundFlow.loops;
    if (Math.abs(l.gain.gain.value - target) > 0.001) {
      l.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
    }
  }

  /** Kill everything — used on restart, so a respawn is not still roaring. */
  stopAll() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const [slot, l] of this.loops) {
      try { l.src.stop(now + 0.06); } catch { /* already done */ }
      l.gain.gain.linearRampToValueAtTime(0, now + 0.05);
      this.loops.delete(slot);
    }
    for (const [slot, v] of this.playing) {
      try { v.src.stop(now + 0.06); } catch { /* already done */ }
      v.gain.gain.linearRampToValueAtTime(0, now + 0.05);
      this.playing.delete(slot);
    }
  }

  /**
   * One frame. `paused` freezes everything without tearing the loops down, so
   * opening the pause menu mid-hover does not restart the jets on the way out.
   *
   * The events arrive already derived, from engine/moves.ts — the style meter
   * scores the same Frame, and two copies of that edge detection would drift.
   */
  update(f: Frame, paused: boolean) {
    if (!this.ctx || !this.ready) return;
    const flow = T.soundFlow;
    this.master.gain.setTargetAtTime(
      flow.enabled ? flow.master : 0, this.ctx.currentTime, 0.02);
    if (paused || !flow.enabled) {
      for (const slot of LOOP_SLOTS) this.hold(slot as Slot, false);
      return;
    }

    for (const m of f.fired) {
      // Landing is scaled by how hard you hit, so a hop off a kerb and a drop
      // from a tower are not the same event at the same volume.
      const scale = m === 'land' && flow.landScale
        ? 0.35 + 0.65 * Math.min(1, f.landSpeed / Math.max(1, flow.landFullSpeed))
        : 1;
      this.fire(m as Slot, scale);
    }

    this.hold('thruster', f.thruster);
    this.hold('wingsuit', f.wingsuit);
    this.hold('reel', f.reel);
    this.trim('thruster'); this.trim('wingsuit'); this.trim('reel');
  }
}
