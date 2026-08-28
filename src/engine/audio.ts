// Movement audio. Clips live in assets/odm-sounds-ref/ and are assigned to moves
// from the panel's `sounds` folder at runtime — nothing here hardcodes which file
// is which verb, because that is a judgement call for ears, not for code.
//
// DELIBERATELY OUTSIDE core/. The solver must not know that sound exists (DESIGN
// rule 1), so there is no callback from it and no event bus in it. Instead this
// diffs the Player struct against its own copy from last frame and derives every
// event from what CHANGED. That costs one small snapshot per frame and buys a
// solver that stays engine-agnostic, which is the whole point of the split.
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
import type { Player, StateName } from '../core/types';

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

interface Snap {
  state: StateName;
  grounded: boolean;
  jumpsLeft: number;
  slamming: boolean;
  vaultT: number;
  grappling: boolean;
  chain: number;
  vy: number;
  alive: boolean;
}

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
  private prev: Snap | null = null;
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
    this.prev = null;
  }

  /**
   * One frame. `paused` freezes everything without tearing the loops down, so
   * opening the pause menu mid-hover does not restart the jets on the way out.
   *
   * `firedHook` is the one thing that cannot be read off the Player: a hook that
   * MISSES leaves no trace at all - fireGrapple returns before it writes any
   * state - so without the press passed in, firing into open sky is silent.
   * Everything else on this frame is derived from the struct.
   */
  update(p: Player, paused: boolean, firedHook = false) {
    if (!this.ctx || !this.ready) return;
    const f = T.soundFlow;
    this.master.gain.setTargetAtTime(f.enabled ? f.master : 0, this.ctx.currentTime, 0.02);
    if (paused || !f.enabled) {
      for (const slot of LOOP_SLOTS) this.hold(slot as Slot, false);
      this.prev = null;
      return;
    }

    const now: Snap = {
      state: p.state, grounded: p.grounded, jumpsLeft: p.jumpsLeft,
      slamming: p.slamming, vaultT: p.vaultT, grappling: p.grappling,
      chain: p.chain, vy: p.vel.y, alive: p.alive,
    };
    const was = this.prev;
    this.prev = now;
    if (!was) return;                     // first frame after a reset: no edges

    const entered = (s: StateName) => now.state === s && was.state !== s;

    // --- the verbs, each derived from what changed rather than from a callback.
    if (entered('dashing')) this.fire(p.dashSuper ? 'superDash' : 'dash');
    if (entered('sliding')) this.fire('slide');
    if (entered('wingsuit')) this.fire('wingDeploy');

    // Jumps all spend a charge; WHERE you were is what tells them apart.
    if (now.jumpsLeft < was.jumpsLeft) {
      if (was.state === 'wallrunning') this.fire('wallJump');
      else if (was.grounded || was.state === 'grounded') this.fire('jump');
      else this.fire('doubleJump');
    }

    // Landing. Scaled by how hard you hit, so a hop off a kerb and a slam from a
    // tower are not the same event at the same volume.
    if (now.grounded && !was.grounded) {
      const hard = Math.min(1, Math.abs(was.vy) / Math.max(1, f.landFullSpeed));
      this.fire('land', f.landScale ? 0.35 + 0.65 * hard : 1);
      // The chain tick rides ON the landing rather than replacing it — that is
      // what makes a clean hop sound like a landing that went right.
      if (now.chain > was.chain) this.fire('bhop');
    }

    if (now.slamming && !was.slamming) this.fire('slam');
    if (now.vaultT > 0 && was.vaultT <= 0) this.fire('vault');

    // The launch fires on the PRESS, so a miss still sounds. The bite fires on
    // the attach, which the solver resolves on that same frame - so a hit plays
    // both and open sky plays only the first.
    if (firedHook) this.fire('hookFire');
    if (now.grappling && !was.grappling) this.fire('hookHit');
    if (!now.grappling && was.grappling) this.fire('hookRelease');

    // --- the held modes.
    this.hold('thruster', p.thrusting);
    this.hold('wingsuit', p.state === 'wingsuit');
    this.hold('reel', p.grappling && p.grappleReel > 0);
    this.trim('thruster'); this.trim('wingsuit'); this.trim('reel');
  }
}
