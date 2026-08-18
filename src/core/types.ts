import type { V3 } from './vec';

export type StateName = 'grounded' | 'airborne' | 'dashing' | 'sliding' | 'wallrunning';

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
export interface RayHit { dist: number; normal: V3 }

export interface CollisionWorld {
  move(pos: V3, displacement: V3): MoveResult;
  ray(from: V3, dir: V3, maxDist: number): number | null;
  rayHit(from: V3, dir: V3, maxDist: number): RayHit | null;
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
  slideCoyote: number; // ledge-tech grace: a jump here still counts as a slide jump
  dashEntrySpeed: number;

  // wallrun
  wallNormal: V3;
  wallSide: number;   // -1 wall on the left, +1 on the right, 0 none
  wallTime: number;
  wallCoyote: number;
  wallCooldown: number;
  lastWallX: number;  // so you can't re-attach to the wall you just left
  lastWallZ: number;

  chain: number;      // consecutive tech links
  chainTimer: number;

  alive: boolean;
}
