import type { V3 } from './vec';

export type StateName = 'grounded' | 'airborne' | 'dashing' | 'sliding' | 'wallrunning';

export interface Btn { pressed: boolean; held: boolean }

/**
 * One ODM cable. There are two, fired from the hips: index 0 is the left
 * launcher, 1 the right. Either can be live on its own — an asymmetric hang off
 * a single cable is half of what the gear is for.
 */
export interface Cable {
  on: boolean;
  anchor: V3;
  len: number;    // reeling shrinks it, paying out grows it
}

/** Everything the solver is allowed to know about the player's intentions. */
export interface Intent {
  moveX: number;   // -1..1 strafe
  moveY: number;   // -1..1 forward
  yaw: number;     // camera yaw, radians
  pitch: number;   // camera pitch, radians, positive = looking up
  jump: Btn;
  dash: Btn;
  slide: Btn;
  slam: Btn;       // C in the air: everything stops and you go straight down
  thrust: Btn;     // hover jets; shares the jump key, see engine/input.ts
  grapple: Btn;    // middle mouse: fire on press, hang on held (unless grapple.toggle)
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
  sprinting: boolean; // dash button doubles as sprint when sprint.enabled
  stamina: number;    // dashing spends this; regenerates over time

  // Thrusters. Their own resource, deliberately separate from stamina: hovering
  // must never cost you a dash, or the two verbs fight over one pool.
  thrusting: boolean; // jets burning this tick
  boosting: boolean;  // ...and the afterburner is lit on top of that
  fuel: number;
  fuelIdle: number;   // seconds since the jets last burned — gates the refuel
  fuelDry: boolean;   // ran the tank empty; locked out until restartFuel is back

  // Ground slam. Airborne only, and a modifier like the vault: it owns your
  // velocity until you land, then hands you a short window where the dash comes
  // out harder so the crater is a launch pad rather than a full stop.
  slamming: boolean;
  slamBoost: number;   // seconds left of the stronger dash
  dashBoost: number;   // the multiplier the CURRENT dash was started with

  // Vault. Like the grapple, a modifier rather than a state: it fires off a
  // ledge probe and hands velocity back, so it works out of a run, a fall, a
  // dash or a slide without any of them having to know about it.
  vaultT: number;        // seconds left of the forward push over the lip
  vaultCooldown: number;
  vaultDir: V3;          // horizontal direction the hop is carrying you

  // Grapple. Not a state — a constraint layered on top of whatever you are
  // already doing, so you can grapple out of a dash, a wallrun or a slide.
  cables: Cable[];      // exactly two, left then right
  grappling: boolean;   // derived: at least one cable is live
  grappleReel: number;  // -1 paying out, 0 hanging, +1 reeling — for the HUD/visual
  grappleAuto: boolean; // reel with no input asked for — the meathook hauling you in
  grappleTime: number;  // seconds attached, drives the rope's extend animation
  grappleKeep: number;  // post-release grace where overspeed doesn't bleed
  grappleCooldown: number;

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
  wallChain: number;  // wallruns since last touching the ground

  chain: number;      // consecutive tech links
  chainTimer: number;

  alive: boolean;
}
