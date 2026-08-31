// Which move just happened, derived once per frame.
//
// Two systems need this — audio picks a clip, the style meter scores it — and
// the derivation is subtle enough (a ground jump and a double jump are the same
// charge spend, told apart only by where you were standing, and a wall kick is
// not a charge spend at all) that two copies of it would quietly disagree the
// first time either was touched. So it lives here, main.ts runs it once, and both
// consumers read the same Frame.
//
// DELIBERATELY OUTSIDE core/. The solver must not know that audio or scoring
// exist (DESIGN rule 1), so nothing here is a callback from it: this diffs the
// Player struct against its own copy from last frame and reads the events off
// what CHANGED. One small snapshot a frame, and the solver stays clean.

import type { Player, StateName } from '../core/types';

/** Every scoreable move, in rough order of how hard it is to pull off. */
export const MOVES = [
  'jump', 'doubleJump', 'wallJump', 'wallRun', 'dash', 'superDash', 'slide',
  'bhop', 'slam', 'land', 'vault', 'hookFire', 'hookHit', 'hookRelease', 'wingDeploy',
] as const;
export type MoveName = typeof MOVES[number];

/**
 * Verbs that are not their own sound. A wall is a floor you hit sideways, so
 * catching one IS a landing and kicking off one IS a jump — same clip, same
 * level, same impact scaling, nothing to keep in step by hand. Giving the wall
 * its own pair of audio knobs is what silenced it before: they defaulted to no
 * clip, and a saved profile went on pinning that after the default was fixed.
 *
 * Sound only. The style meter still scores the wall as the wall.
 */
export const SOUNDS_LIKE: Partial<Record<MoveName, MoveName>> = {
  wallRun: 'land', wallJump: 'jump',
};

/** Held states. Not moves — they are things you ARE, not things you did. */
export const HELD = ['thruster', 'wingsuit', 'reel'] as const;
export type HeldName = typeof HELD[number];

export interface Frame {
  /** Moves that fired this frame, in the order they were detected. */
  fired: MoveName[];
  /**
   * How hard you arrived, or 0 on any frame that was not an arrival. Downward
   * speed onto a floor; closing speed into a wall, which is the same quantity
   * measured against a surface that happens to be vertical.
   */
  landSpeed: number;
  /** Held states, true for as long as the key is down. */
  thruster: boolean;
  wingsuit: boolean;
  reel: boolean;
}

interface Snap {
  state: StateName;
  grounded: boolean;
  jumpsLeft: number;
  slamming: boolean;
  vaultT: number;
  wallCooldown: number;
  wallSide: number;
  wallNormal: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  grappling: boolean;
  chain: number;
  vy: number;
}

const EMPTY: Frame = {
  fired: [], landSpeed: 0, thruster: false, wingsuit: false, reel: false,
};

export class MoveWatch {
  private prev: Snap | null = null;

  /** Drop the history, so a respawn does not read as a pile of transitions. */
  reset() { this.prev = null; }

  /**
   * `firedHook` is the one event that cannot be read off the Player: a hook that
   * MISSES returns out of fireGrapple before it writes any state, so without the
   * press passed in, firing into open sky is invisible here.
   */
  step(p: Player, firedHook: boolean): Frame {
    const now: Snap = {
      state: p.state, grounded: p.grounded, jumpsLeft: p.jumpsLeft,
      slamming: p.slamming, vaultT: p.vaultT, grappling: p.grappling,
      wallCooldown: p.wallCooldown, wallSide: p.wallSide,
      wallNormal: { ...p.wallNormal }, vel: { ...p.vel },
      chain: p.chain, vy: p.vel.y,
    };
    const was = this.prev;
    this.prev = now;
    // First frame after a reset has nothing to diff against, and every field
    // would read as a transition.
    if (!was) return EMPTY;

    const fired: MoveName[] = [];
    const entered = (s: StateName) => now.state === s && was.state !== s;

    if (entered('dashing')) fired.push(p.dashSuper ? 'superDash' : 'dash');
    if (entered('sliding')) fired.push('slide');
    if (entered('wingsuit')) fired.push('wingDeploy');
    if (entered('wallrunning')) fired.push('wallRun');

    // These two spend a charge; WHERE you were is the only thing that tells them
    // apart. The wall kick is NOT here - it costs gas, not a charge, and looking
    // for it on this edge found it exactly never.
    if (now.jumpsLeft < was.jumpsLeft) {
      if (was.grounded || was.state === 'grounded') fired.push('jump');
      else fired.push('doubleJump');
    }

    // So the kick is read off the wall it left instead. Both ways off a wall -
    // kicking and simply sliding off the end - reload wallCooldown, and nothing
    // else in the solver touches it, so that edge means "a wall just ended".
    // Which of the two it was: detaching clears wallSide, the kick leaves it
    // alone. The first clause is the kick you take standing on the wall; the
    // second is the same kick taken a few frames after it, out of the coyote
    // window, where the side is already gone and the reload is the whole tell.
    if (now.wallCooldown > was.wallCooldown
        && (was.state !== 'wallrunning' || now.wallSide !== 0)) fired.push('wallJump');

    let landSpeed = 0;

    // Catching a wall is an arrival, so it reports an arrival speed like any
    // other. Measured off LAST frame's velocity: the attach keeps only the
    // component running along the wall, so by now the part that hit it is gone.
    if (now.state === 'wallrunning' && was.state !== 'wallrunning') {
      const n = now.wallNormal;
      landSpeed = Math.max(0, -(was.vel.x * n.x + was.vel.y * n.y + was.vel.z * n.z));
    }

    if (now.grounded && !was.grounded) {
      landSpeed = Math.abs(was.vy);
      fired.push('land');
      // The chain tick rides ON the landing rather than replacing it — a clean
      // hop is a landing that went right, not a different event.
      if (now.chain > was.chain) fired.push('bhop');
    }

    if (now.slamming && !was.slamming) fired.push('slam');
    if (now.vaultT > 0 && was.vaultT <= 0) fired.push('vault');

    // Launch on the press so a miss still counts; bite on the attach, which the
    // solver resolves on that same frame.
    if (firedHook) fired.push('hookFire');
    if (now.grappling && !was.grappling) fired.push('hookHit');
    if (!now.grappling && was.grappling) fired.push('hookRelease');

    return {
      fired,
      landSpeed,
      thruster: p.thrusting,
      wingsuit: p.state === 'wingsuit',
      reel: p.grappling && p.grappleReel > 0,
    };
  }
}
