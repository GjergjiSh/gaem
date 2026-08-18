import type { V3 } from './vec';

export type StateName = 'grounded' | 'airborne' | 'dashing' | 'sliding';

export interface Btn { pressed: boolean; held: boolean }

/** Everything the solver is allowed to know about the player's intentions. */
export interface Intent {
  moveX: number;   // -1..1 strafe
  moveY: number;   // -1..1 forward
  yaw: number;     // camera yaw, radians
  pitch: number;   // camera pitch, radians, positive = looking up
  jump: Btn;
  dash: Btn;
  slide: Btn;
}

export interface MoveResult {
  pos: V3;
  grounded: boolean;
  groundNormal: V3;
  hitWall: boolean;
  wallNormal: V3;
}

/**
 * The only door between the movement solver and the physics engine.
 * Swapping Rapier for another backend means reimplementing exactly this.
 */
export interface CollisionWorld {
  move(pos: V3, displacement: V3): MoveResult;
  ray(from: V3, dir: V3, maxDist: number): number | null;
}

export interface Player {
  pos: V3;
  vel: V3;
  prevPos: V3;        // for render interpolation
  facing: number;     // radians, decoupled from camera

  state: StateName;
  stateTime: number;
  grounded: boolean;
  groundNormal: V3;

  jumpsLeft: number;
  dashCharges: number;
  dashCooldown: number;
  dashDir: V3;
  dashTime: number;

  // timers (seconds remaining)
  coyoteJump: number;
  coyoteDash: number;
  bufJump: number;
  bufDash: number;
  bufSlide: number;
  slideCooldown: number;

  chain: number;      // consecutive tech links
  chainTimer: number;

  alive: boolean;
}
