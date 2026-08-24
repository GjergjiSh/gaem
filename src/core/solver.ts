// The movement solver. Engine-agnostic by design: it touches T (tuning), the Player
// struct, an Intent, and a CollisionWorld interface. Nothing else.

import { T } from './tuning';
import * as V from './vec';
import type { V3 } from './vec';
import type { Cable, CollisionWorld, Intent, Player, StateName } from './types';

export function makePlayer(spawn: V3): Player {
  return {
    pos: V.copy(spawn),
    vel: V.v3(),
    prevPos: V.copy(spawn),
    facing: 0,
    state: 'airborne',
    stateTime: 0,
    grounded: false,
    groundNormal: V.v3(0, 1, 0),
    jumpsLeft: T.jump.maxJumps,
    dashCharges: T.dash.maxCharges,
    dashCooldown: 0,
    dashDir: V.v3(),
    dashTime: 0,
    coyoteJump: 0,
    coyoteDash: 0,
    bufJump: 0,
    bufDash: 0,
    bufSlide: 0,
    slideCooldown: 0,
    slideCoyote: 0,
    dashEntrySpeed: 0,
    wallNormal: V.v3(),
    wallSide: 0,
    wallTime: 0,
    wallCoyote: 0,
    wallCooldown: 0,
    lastWallX: 0,
    lastWallZ: 0,
    wallChain: 0,
    sprinting: false,
    stamina: T.stamina.max,
    thrusting: false,
    boosting: false,
    fuel: T.thruster.fuelMax,
    fuelIdle: 0,
    fuelDry: false,
    cables: [
      { on: false, anchor: V.v3(), len: 0 },
      { on: false, anchor: V.v3(), len: 0 },
    ],
    slamming: false,
    slamBoost: 0,
    dashBoost: 1,
    vaultT: 0,
    vaultPush: 0,
    vaultCooldown: 0,
    vaultDir: V.v3(),
    vaultArmed: false,
    vaultPending: 0,
    vaultGrace: 0,
    vaultRise: 0,
    vaultNormal: V.v3(),
    vaultEntryVel: V.v3(),
    grappling: false,
    grappleReel: 0,
    grappleAuto: false,
    grappleTime: 0,
    grappleKeep: 0,
    grappleCooldown: 0,
    chain: 0,
    chainTimer: 0,
    alive: true,
  };
}

/** World-space horizontal direction the player is asking to move, relative to camera. */
export function wishDir(i: Intent): V3 {
  const s = Math.sin(i.yaw), c = Math.cos(i.yaw);
  // At yaw 0 the camera looks down -Z, so forward = (0,0,-1) and right = (1,0,0).
  const x = -s * i.moveY + c * i.moveX;
  const z = -c * i.moveY - s * i.moveX;
  const l = Math.hypot(x, z);
  return l > 1e-6 ? V.v3(x / l, 0, z / l) : V.v3();
}

/** Speed ceiling for the current state, raised by chains, slides and wallruns. */
export function currentCap(p: Player): number {
  const chain = Math.min(T.momentum.maxChainBonus, Math.pow(T.momentum.chainBonus, p.chain));
  const state = p.state === 'sliding' ? T.slide.capBonus
    : p.state === 'wallrunning' ? T.wall.capBonus
      : p.state === 'grounded' && p.sprinting ? T.sprint.multiplier
        : 1;
  return T.ground.maxSpeed * chain * state;
}

/**
 * Quake-style directional acceleration: only adds speed until the projection of
 * velocity onto the wish direction reaches the cap. Crucially this leaves speed
 * gained from dashes and slides intact instead of clamping it away.
 */
function accelerate(vel: V3, wish: V3, accel: number, cap: number, dt: number): V3 {
  if (V.lenH(wish) < 1e-6) return vel;
  const projected = vel.x * wish.x + vel.z * wish.z;
  let rate = accel;
  if (projected < 0) rate *= T.ground.turnAssist; // snappier direction reversals
  const add = Math.min(rate * dt, Math.max(0, cap - projected));
  return V.v3(vel.x + wish.x * add, vel.y, vel.z + wish.z * add);
}

/**
 * Rotate horizontal velocity toward the wish direction while PRESERVING its
 * magnitude. Acceleration alone cannot turn you when you're already at cap —
 * there is no headroom left to add — which is exactly what made air control
 * feel sloppy. This is what makes direction changes crisp without giving away
 * free speed.
 */
function redirect(vel: V3, wish: V3, rate: number, dt: number): V3 {
  const h = V.lenH(vel);
  if (h < 1e-4 || V.lenH(wish) < 1e-6 || rate <= 0) return vel;
  const t = 1 - Math.exp(-rate * dt);
  const cx = vel.x / h, cz = vel.z / h;
  const nx = cx + (wish.x - cx) * t;
  const nz = cz + (wish.z - cz) * t;
  const l = Math.hypot(nx, nz);
  if (l < 1e-6) return vel;
  return V.v3((nx / l) * h, vel.y, (nz / l) * h);
}

/**
 * Classic Quake air acceleration. The wish speed is deliberately tiny, so when your
 * stick direction is near-perpendicular to your velocity the dot product is close to
 * zero and there is headroom to accelerate into — that headroom IS the bunnyhop
 * speed gain. Note it must NOT be paired with redirect(): rotating velocity toward
 * the stick destroys the perpendicular relationship the gain depends on.
 */
function accelerateClassic(vel: V3, wish: V3, accel: number, wishSpeed: number, dt: number): V3 {
  if (V.lenH(wish) < 1e-6) return vel;
  const current = vel.x * wish.x + vel.z * wish.z;
  const add = wishSpeed - current;
  if (add <= 0) return vel;
  const step = Math.min(accel * dt, add);
  return V.v3(vel.x + wish.x * step, vel.y, vel.z + wish.z * step);
}

function applyFriction(vel: V3, friction: number, dt: number): V3 {
  const h = V.lenH(vel);
  if (h < 1e-6) return vel;
  return V.setLenH(vel, Math.max(0, h - friction * dt));
}

/** The soft cap. Overspeed bleeds off rather than being clamped. */
function bleedOverspeed(p: Player, dt: number) {
  // The thruster runs its own drag toward hoverCap; letting the soft cap bleed on
  // top would double up and make the hover feel sticky.
  if (p.thrusting) return;
  // A swing lives entirely above the ground cap — bleeding it back to 11 u/s
  // would delete the mechanic. The grace after release is what makes the speed
  // you earned on the rope worth anything once you are off it.
  if (p.grappling || p.grappleKeep > 0) return;
  const cap = currentCap(p);
  const h = V.lenH(p.vel);
  if (h <= cap) return;
  // A jump already queued means we're bunnyhopping, not standing — decay at the
  // gentle air rate so the landing tick doesn't eat the speed we're about to reuse.
  const scale = (p.grounded && p.bufJump <= 0) ? 1 : T.momentum.airDecayScale;
  const next = Math.max(cap, h - T.momentum.overspeedDecay * scale * dt);
  p.vel = V.setLenH(p.vel, Math.min(next, T.momentum.hardCap));
}

function registerTech(p: Player) {
  p.chain = p.chainTimer > 0 ? p.chain + 1 : 1;
  p.chainTimer = T.momentum.chainWindow;
}

function enter(p: Player, s: StateName) {
  p.state = s;
  p.stateTime = 0;
}

// ---------------------------------------------------------------- actions

function canJump(p: Player) {
  return p.jumpsLeft > 0 || p.coyoteJump > 0;
}

function doJump(p: Player, speedBonus = 1) {
  const fromGround = p.grounded || p.coyoteJump > 0;
  p.vel.y = fromGround ? T.jump.speed : T.jump.doubleJumpSpeed;
  if (speedBonus !== 1) {
    p.vel = V.setLenH(p.vel, Math.min(T.momentum.hardCap, V.lenH(p.vel) * speedBonus));
  }
  // A coyote jump consumes the ground jump, not an air charge.
  p.jumpsLeft = fromGround ? T.jump.maxJumps - 1 : p.jumpsLeft - 1;
  p.coyoteJump = 0;
  p.bufJump = 0;
  p.grounded = false;
  registerTech(p);
  enter(p, 'airborne');
}

/** Kick off a wall: outward along the normal, plus a solid vertical pop. */
function doWallJump(p: Player) {
  const n = p.wallNormal;
  // Ejection angle comes entirely from jumpOut / jumpUp / jumpKeepAlong, with no
  // hidden speed-preservation clamp, so the three sliders fully describe the arc
  // and you can actually aim this at the opposite wall.
  const along = V.scale(
    V.projectOnPlane(V.v3(p.vel.x, 0, p.vel.z), n),
    T.wall.jumpKeepAlong,
  );
  p.vel = V.v3(
    along.x + n.x * T.wall.jumpOut,
    T.wall.jumpUp,
    along.z + n.z * T.wall.jumpOut,
  );
  p.bufJump = 0;
  p.wallCoyote = 0;
  p.wallCooldown = T.wall.cooldown;
  p.lastWallX = n.x;
  p.lastWallZ = n.z;
  if (T.wall.refillJumps) p.jumpsLeft = T.jump.maxJumps;
  if (T.wall.refillDash) p.dashCharges = T.dash.maxCharges;
  registerTech(p);
  enter(p, 'airborne');
}

function canDash(p: Player) {
  if (!T.dash.enabled) return false;
  if (p.stamina < T.stamina.dashCost) return false;
  return p.dashCharges > 0 && p.dashCooldown <= 0;
}

function doDash(p: Player, i: Intent) {
  let dir = wishDir(i);
  if (V.lenH(dir) < 1e-6) {
    // No stick input: dash where the camera is looking.
    dir = V.v3(-Math.sin(i.yaw), 0, -Math.cos(i.yaw));
  }
  // First person expects a dash to go exactly where you look; over the shoulder a
  // full-strength vertical component reads as the character launching oddly.
  const aim = T.camera.firstPerson ? T.dash.verticalAimFP : T.dash.verticalAim;
  dir.y = Math.sin(i.pitch) * aim;
  p.dashDir = V.norm(dir);
  // Stamped at the start, not read live: a dash that got weaker halfway through
  // because a timer expired mid-flight is a dash you cannot plan around.
  p.dashBoost = p.slamBoost > 0 ? T.slam.dashBoost : 1;
  p.dashTime = T.dash.duration;
  p.dashEntrySpeed = V.lenH(p.vel);
  p.dashCharges--;
  p.stamina = Math.max(0, p.stamina - T.stamina.dashCost);
  p.dashCooldown = T.dash.cooldown;
  p.bufDash = 0;
  p.coyoteDash = 0;
  if (T.dash.refundJumpOnDash) p.jumpsLeft = Math.max(p.jumpsLeft, T.jump.maxJumps - 1);
  registerTech(p);
  enter(p, 'dashing');
}

function canSlide(p: Player) {
  if (!T.slide.enabled) return false;
  // Sliding is a ground move. Without the explicit grounded test you can crouch
  // while stuck to a wall, which looks and reads wrong.
  if (!p.grounded || p.state === 'wallrunning') return false;
  return p.slideCooldown <= 0 && V.lenH(p.vel) >= T.slide.minSpeed;
}

function doSlide(p: Player) {
  const h = V.lenH(p.vel);
  p.vel = V.setLenH(p.vel, Math.min(T.momentum.hardCap, h + T.slide.boost));
  p.bufSlide = 0;
  registerTech(p);
  enter(p, 'sliding');
}

function endSlide(p: Player) {
  p.slideCooldown = T.slide.cooldown;
  p.slideCoyote = Math.max(p.slideCoyote, T.slide.coyoteTime);
  enter(p, p.grounded ? 'grounded' : 'airborne');
}

// ---------------------------------------------------------------- ground slam

/**
 * C, in the air only. Cancels the dash you were in and the wallrun you were on,
 * and drives you straight at the floor.
 *
 * NOT the rope. C while hooked is a dive — see the dive block in updateGrapple.
 * Slamming off a cable threw away the swing you had just set up, and the button
 * you press to go down is the button you want for going down on a rope too.
 *
 * It is not a damage move and it costs nothing. What it buys is the window after
 * it: `slam.boostTime` seconds where the dash comes out at `slam.dashBoost`, so
 * arriving at the ground hard is a way back INTO the fight instead of the end of
 * a line. The window is short on purpose. A permanent stronger dash is just a
 * faster dash, and then the number in `dash.speed` is a lie.
 */
function trySlam(p: Player, i: Intent, col: CollisionWorld): boolean {
  if (!T.slam.enabled || !i.slam.pressed || p.slamming) return false;
  if (p.grounded || p.state === 'grounded' || p.state === 'sliding') return false;
  // Hooked: the rope keeps it. C becomes a dive, handled by updateGrapple.
  if (p.grappling) return false;
  // Needs real air under you. Measured, not timed: a state clock gets reset by
  // every dash and wallrun, and the thing that actually makes a slam meaningless
  // is having nowhere to fall. It also closes the exploit of tapping C a hand's
  // width off a ledge to farm the dash window.
  const clear = col.ray(p.pos, V.v3(0, -1, 0), T.character.height / 2 + T.slam.minHeight);
  if (clear !== null) return false;

  p.slamming = true;
  p.vel = V.v3(p.vel.x * T.slam.keepH, -T.slam.speed, p.vel.z * T.slam.keepH);
  if (p.state === 'wallrunning') detachWall(p);
  p.vaultT = 0;                 // no hopping a ledge on the way down
  p.vaultPending = 0;           // ...and the press that was waiting for one is spent
  enter(p, 'airborne');
  registerTech(p);
  return true;
}

/** Holds the slam's line until it lands. Gravity would only add to it. */
function updateSlam(p: Player) {
  p.vel.x *= T.slam.keepH;
  p.vel.z *= T.slam.keepH;
  p.vel.y = Math.min(p.vel.y, -T.slam.speed);
}

// ---------------------------------------------------------------- vault

/** What the ledge probe found: a lip worth launching off, and where it is. */
interface Lip {
  rise: number;    // how far its top sits above your feet
  normal: V3;      // horizontal face normal, pointing back at you
  dist: number;    // gap from the capsule surface to the face, metres
}

/**
 * Ledge probe. Finds a lip you are running at that is too tall for the
 * controller's autostep but low enough to hop. Null means "not a vault": no face,
 * a slope, a gap, a wall, or an approach too glancing to be a launch.
 *
 * `reach` is a parameter rather than a constant because the timing window has to
 * see further ahead than the contact test does — see vaultSense.
 */
function probeLedge(p: Player, dir: V3, reach: number, col: CollisionWorld): Lip | null {
  const t = T.vault;
  const feetY = p.pos.y - T.character.height / 2;

  // Just above the autostep. Lower and the probe keeps finding the ramps the
  // controller already walks up; higher and it misses the short ledges that are
  // most of the point.
  const from = V.v3(p.pos.x, feetY + T.character.stepHeight + 0.1, p.pos.z);
  const hit = col.rayHit(from, dir, T.character.radius + reach);
  if (!hit) return null;
  // Only a face steep enough to actually stop you. Anything shallower is a slope,
  // which is the controller's job and not a thing to be launched up.
  if (Math.abs(hit.normal.y) > Math.sin(T.wall.maxAngle)) return null;

  // Drop a probe just past that face, starting above the tallest ledge allowed.
  // On a real wall this origin is buried inside the geometry, which reports a
  // surface at the very top of the range and fails the height test below —
  // exactly the answer we want, with no special case for it.
  const inset = hit.dist + T.character.radius * 0.6;
  const top = V.v3(p.pos.x + dir.x * inset, feetY + t.maxHeight + 0.5, p.pos.z + dir.z * inset);
  const drop = col.ray(top, V.v3(0, -1, 0), t.maxHeight + 0.5);
  if (drop === null) return null;              // nothing over there: a gap, not a ledge

  const rise = top.y - drop - feetY;
  // Under stepHeight the controller already walks it. Over maxHeight it is a wall,
  // and turning walls into launches would delete wallrunning from the game.
  if (rise <= T.character.stepHeight || rise > t.maxHeight) return null;

  const n = V.norm(V.v3(hit.normal.x, 0, hit.normal.z));
  if (V.lenH(n) < 1e-4) return null;
  // Head-on is 1. Too glancing and you are skimming a wall rather than diving
  // into a box, and a wall you are travelling along already belongs to wallrun.
  if (-(dir.x * n.x + dir.z * n.z) < Math.cos(t.maxEntryAngle)) return null;

  // From the capsule SURFACE, not its centre: that is the gap the window counts
  // down, and the radius would otherwise make the timing depend on the hitbox.
  return { rise, normal: n, dist: Math.max(0, hit.dist - T.character.radius) };
}

/**
 * The timing window. Runs once a tick BEFORE the state machine, because it has
 * to decide who owns the Space press before the jump gets its hands on it.
 *
 * Everything here is a duration rather than a distance. A fixed half-metre probe
 * is forty milliseconds of warning at 30 m/s and a fifth of a second at 6, which
 * would mean the faster you got the harder the vault became for no reason anyone
 * could name. Reaching `speed * windowBefore` ahead instead puts the press at the
 * same moment of the approach at every speed, and that is the only version of
 * this that is learnable.
 *
 * Returns the lip so tryVault can launch off it without probing twice.
 */
function vaultSense(p: Player, col: CollisionWorld): Lip | null {
  const t = T.vault;
  p.vaultArmed = false;
  if (!t.enabled || p.vaultT > 0 || p.vaultCooldown > 0) return null;
  if (p.state === 'wallrunning' || p.slamming) return null;

  const h = V.lenH(p.vel);
  if (h < t.minSpeed) return null;
  const dir = V.v3(p.vel.x / h, 0, p.vel.z / h);

  const lip = probeLedge(p, dir, Math.max(t.reach, h * t.windowBefore), col);
  if (!lip) return null;

  // Touching it. Remember what we hit and how fast we were going, because the
  // late half of the window fires AFTER the collision has flattened both — a
  // grace period that hands you a standing-start hop is not a window, it is a
  // consolation prize.
  if (lip.dist <= t.reach) {
    p.vaultGrace = t.windowAfter;
    p.vaultRise = lip.rise;
    p.vaultNormal = lip.normal;
    p.vaultEntryVel = V.v3(p.vel.x, 0, p.vel.z);
    p.vaultArmed = true;
  } else {
    p.vaultArmed = lip.dist / h <= t.windowBefore;
  }
  return lip;
}

/**
 * Space, timed against the lip. Deliberately NOT a jump: it spends no jump, and
 * it never slows you down — it only ever adds. What it costs is the timing, and
 * what it pays is decided by the angle you came in at.
 */
function tryVault(p: Player, lip: Lip | null): boolean {
  const t = T.vault;
  if (!t.enabled || p.vaultT > 0 || p.vaultCooldown > 0) return false;
  if (p.state === 'wallrunning') return false;

  const contact = lip !== null && lip.dist <= t.reach;

  // Timed: a press has to be live, either one waiting for this lip or one that
  // landed just after it. Untimed: the old automatic mantle, off contact alone.
  if (t.timed) { if (p.vaultPending <= 0) return false; }
  else if (!contact) return false;

  // Launch off what is in front of us, or — on a late press — off what we hit a
  // few frames ago, at the speed we hit it with.
  let rise: number, normal: V3, entry: V3;
  if (contact) {
    rise = lip!.rise;
    normal = lip!.normal;
    entry = V.v3(p.vel.x, 0, p.vel.z);
  } else if (p.vaultGrace > 0) {
    rise = p.vaultRise;
    normal = p.vaultNormal;
    entry = p.vaultEntryVel;
  } else {
    return false;
  }

  const speed = V.lenH(entry);
  if (speed < t.minSpeed) return false;
  const dir = V.v3(entry.x / speed, 0, entry.z / speed);

  // Entry angle, normalised: 1 is dead head-on, 0 the sloppiest approach that
  // still counts. Everything the vault pays out scales by this, which is the
  // whole reason to aim the dash at the crate instead of clipping its corner.
  const lo = Math.cos(t.maxEntryAngle);
  const head = -(dir.x * normal.x + dir.z * normal.z);
  const q = V.clamp((head - lo) / Math.max(1e-4, 1 - lo), 0, 1);

  // The line out: your own, turned toward straight-over-the-lip by `straighten`.
  // At 0 a diagonal entry throws you diagonally across the top, which is what
  // makes the angle something you steer with and not only something you score on.
  const outX = V.lerp(dir.x, -normal.x, t.straighten);
  const outZ = V.lerp(dir.z, -normal.z, t.straighten);
  const outLen = Math.hypot(outX, outZ) || 1;
  const out = V.v3(outX / outLen, 0, outZ / outLen);

  // Clearing the lip is derived rather than picked: v = sqrt(2gh) is the same
  // relation the jump height is read with, and a fixed impulse is either too weak
  // for the tall ledges or a pop on the short ones. That part is the FLOOR. What
  // makes it an arc on the far side rather than a mantle is launchUp on top, and
  // that part is earned by the angle.
  const up = Math.sqrt(2 * T.world.gravityRise * (rise + t.clearance)) + q * t.launchUp;
  p.vel.y = Math.max(p.vel.y, up);

  const push = Math.max(speed, t.push + q * t.pushBonus);
  p.vel.x = out.x * push;
  p.vel.z = out.z * push;

  p.vaultDir = out;
  p.vaultPush = push;
  p.vaultT = t.hold;
  p.vaultCooldown = t.hold + t.cooldown;
  p.vaultPending = 0;
  p.vaultGrace = 0;
  p.vaultArmed = false;
  // The press was spent on the vault, so it must not come back out as a jump on
  // the next tick — the jump buffer is still holding the same keystroke.
  p.bufJump = 0;

  // Both ground states clamp vertical velocity to zero every tick, so a hop that
  // leaves the state alone is a hop that gets deleted on the next one.
  if (p.state === 'sliding') endSlide(p);
  enter(p, 'airborne');
  p.grounded = false;
  registerTech(p);
  return true;
}

// ---------------------------------------------------------------- wallrun

/**
 * Shared attach path. Validates that the surface is steep enough, that we aren't
 * re-grabbing the wall we just left, and that we're travelling ALONG it rather
 * than straight into it — hitting a wall head-on should bonk, not stick.
 */
function attachWall(p: Player, rawNormal: V3): boolean {
  // Mid-hop. A chest-high ledge is a legal wall by angle, so without this the
  // thing you just vaulted grabs you into a wallrun on the way over it.
  if (p.vaultT > 0) return false;
  if (!T.wall.enabled) return false;
  if (Math.abs(rawNormal.y) > Math.sin(T.wall.maxAngle)) return false;

  // Hard stop on endless wall travel. Cleared only by touching the ground, so a
  // hex arena's six faces can't be chained round and round forever.
  if (p.wallChain >= T.wall.maxChain) return false;

  const n = V.norm(V.v3(rawNormal.x, 0, rawNormal.z));
  if (V.lenH(n) < 1e-4) return false;
  if (n.x * p.lastWallX + n.z * p.lastWallZ > 0.85) return false;

  const h = V.lenH(p.vel);
  if (h < T.wall.minSpeed) return false;

  // Only the component running along the wall survives the attach; if that's too
  // small we came in square-on and there's nothing to carry.
  const along = V.projectOnPlane(V.v3(p.vel.x, 0, p.vel.z), n);
  if (V.lenH(along) < T.wall.minSpeed) return false;

  const right = V.v3(-p.vel.z / h, 0, p.vel.x / h);
  p.wallSide = (right.x * -n.x + right.z * -n.z) >= 0 ? 1 : -1;
  p.wallNormal = n;
  p.wallTime = 0;
  const entryVy = Math.min(Math.max(p.vel.y, 0), T.wall.entryVyMax) + T.wall.upBoost;
  p.vel = V.v3(along.x, entryVy, along.z);
  // Drop any jump still sitting in the buffer from the approach. Without this the
  // buffered press fires as a wall jump on the very next tick and you're flung off
  // a wallrun you never got to hold.
  p.bufJump = 0;
  p.wallChain++;
  if (T.wall.refillJumps) p.jumpsLeft = T.jump.maxJumps;
  if (T.wall.refillDash) p.dashCharges = T.dash.maxCharges;
  registerTech(p);
  enter(p, 'wallrunning');
  return true;
}

/** Proximity probe: catches walls you're running past without touching. */
function tryWallAttach(p: Player, col: CollisionWorld): boolean {
  if (p.wallCooldown > 0) return false;
  const h = V.lenH(p.vel);
  if (h < T.wall.minSpeed) return false;

  const dir = V.v3(p.vel.x / h, 0, p.vel.z / h);
  const right = V.v3(-dir.z, 0, dir.x);
  const reach = T.character.radius + T.wall.detectDist;

  for (const side of [1, -1]) {
    const hit = col.rayHit(p.pos, V.scale(right, side), reach);
    if (hit && attachWall(p, hit.normal)) return true;
  }
  return false;
}

function detachWall(p: Player) {
  p.wallCoyote = T.wall.coyoteTime;
  p.wallCooldown = T.wall.cooldown;
  p.lastWallX = p.wallNormal.x;
  p.lastWallZ = p.wallNormal.z;
  p.wallSide = 0;
  enter(p, 'airborne');
}

function updateWallrunning(p: Player, i: Intent, wish: V3, col: CollisionWorld, dt: number) {
  p.wallTime += dt;

  // Still on a wall?
  const into = V.scale(p.wallNormal, -1);
  const hit = col.rayHit(p.pos, into, T.character.radius + T.wall.detectDist);
  if (!hit || Math.abs(hit.normal.y) > Math.sin(T.wall.maxAngle)) return detachWall(p);
  p.wallNormal = V.norm(V.v3(hit.normal.x, 0, hit.normal.z));

  if (p.bufJump > 0) return doWallJump(p);
  if (p.bufDash > 0 && canDash(p)) return doDash(p, i);
  // Only a genuine landing ends the run. `grounded` alone lies here: an
  // outward-leaning wall registers a contact under the capsule and reads as
  // ground, which would detach us on the tick we attach.
  if (p.wallTime > T.wall.maxTime || (p.grounded && p.vel.y <= 0)) return detachWall(p);

  // The arc: gravity ramps in over the run, quadratically, so you attach nearly
  // weightless, hang, then peel off downward under increasing pull.
  const ramp = V.clamp(p.wallTime / Math.max(T.wall.gravityRamp, 1e-3), 0, 1);
  const gScale = V.lerp(T.wall.gravityStart, T.wall.gravityEnd, ramp * ramp);
  p.vel.y -= T.world.gravityRise * gScale * dt;

  // Auto-run: once you're on the wall the character keeps running along it on its
  // own, no held input required. You steer with the wall, not the stick.
  const tangent = V.norm(V.v3(-p.wallNormal.z, 0, p.wallNormal.x));
  const sign = (p.vel.x * tangent.x + p.vel.z * tangent.z) >= 0 ? 1 : -1;
  const runDir = V.scale(tangent, sign);
  p.vel = accelerate(p.vel, runDir, T.wall.runAccel, currentCap(p), dt);

  // Glue: a constant pull into the wall keeps you attached around corners.
  p.vel.x -= p.wallNormal.x * T.wall.stickAssist * dt;
  p.vel.z -= p.wallNormal.z * T.wall.stickAssist * dt;

  if (V.lenH(p.vel) < T.wall.minSpeed) detachWall(p);
}

// ---------------------------------------------------------------- grapple

/** Where the camera is pointing, as a unit vector. The hooks' aim. */
function aimDir(i: Intent): V3 {
  const cp = Math.cos(i.pitch);
  return V.v3(-Math.sin(i.yaw) * cp, Math.sin(i.pitch), -Math.cos(i.yaw) * cp);
}

/** The point the cables leave the body from — also where they are fired from. */
function ropeOrigin(p: Player): V3 {
  return V.v3(p.pos.x, p.pos.y + T.grapple.eyeOffset, p.pos.z);
}

/** At least one cable live. Every consumer asks this, never the array. */
function syncGrappling(p: Player) {
  p.grappling = p.cables.some((c) => c.on);
}

/**
 * Fire. Both hooks bite on the tick you press, or not at all: a projectile hook
 * is a hook that arrives late, and this is meant to be the fastest verb in the kit.
 *
 * Two rays, splayed `spread` radians either side of the aim, so on a flat wall
 * the anchors land a couple of metres apart and you hang between them. Either
 * side may miss, and that is fine — one cable biting and one flying off into
 * open sky is a perfectly good, and very ODM, way to be attached.
 */
function fireGrapple(p: Player, i: Intent, col: CollisionWorld): boolean {
  if (!T.grapple.enabled || p.grappleCooldown > 0) return false;
  const from = ropeOrigin(p);
  const aim = aimDir(i);
  // Sideways axis of the view, for splaying the two shots apart.
  const right = V.norm(V.v3(-Math.cos(i.yaw), 0, Math.sin(i.yaw)));

  let any = false;
  for (let k = 0; k < p.cables.length; k++) {
    const side = k === 0 ? -1 : 1;
    const dir = V.norm(V.add(aim, V.scale(right, side * T.grapple.spread)));
    const dist = col.ray(from, dir, T.grapple.range);
    const c = p.cables[k];
    if (dist === null) { c.on = false; continue; }
    c.on = true;
    c.anchor = V.v3(from.x + dir.x * dist, from.y + dir.y * dist, from.z + dir.z * dist);
    // Each cable starts exactly as long as its own shot, so attaching never
    // yanks you. Everything after this is the pendulum or something you asked for.
    c.len = dist;
    any = true;
  }
  if (!any) return false;

  p.grappleTime = 0;
  p.grappleReel = 0;
  p.grappleAuto = false;
  syncGrappling(p);
  // Grappling is tech: it feeds the same chain bonus as a wallrun or a slide, so
  // cable work raises the speed cap for whatever you do next.
  registerTech(p);
  return true;
}

/**
 * Attach both cables to one arbitrary point. The engine's door for hooking
 * something the solver is not allowed to know about — a dummy — and the reason
 * the meathook needs no second implementation: it IS the cables, with an anchor
 * the engine moves and `auto` holding the reel down for you.
 */
export function attachGrappleTo(p: Player, at: V3, auto: boolean) {
  const from = ropeOrigin(p);
  const len = V.len(V.sub(at, from));
  for (const c of p.cables) {
    c.on = true;
    c.anchor = V.copy(at);
    c.len = len;
  }
  p.grappleTime = 0;
  p.grappleReel = 0;
  p.grappleAuto = auto;
  syncGrappling(p);
  registerTech(p);
}

/** Move every live anchor — the hooked body they are buried in has shifted. */
export function moveGrappleAnchor(p: Player, at: V3) {
  for (const c of p.cables) if (c.on) c.anchor = V.copy(at);
}

/**
 * Let go of everything. A swing that just stops paying out is a swing nobody
 * uses twice, so release converts the arc into a launch: keep the speed, add a
 * little, and hold off the overspeed bleed for `keepTime` so it survives into
 * the next move.
 */
export function releaseGrapple(p: Player, boosted = true) {
  if (!p.grappling) return;
  for (const c of p.cables) c.on = false;
  p.grappling = false;
  p.grappleReel = 0;
  p.grappleAuto = false;
  p.grappleCooldown = T.grapple.cooldown;
  p.grappleKeep = T.grapple.keepTime;
  if (!boosted) return;
  const h = V.lenH(p.vel);
  if (h > 1e-3) p.vel = V.setLenH(p.vel, Math.min(T.momentum.hardCap, h * T.grapple.releaseBoost));
  if (T.grapple.releaseUp > 0) p.vel.y = Math.max(p.vel.y, p.vel.y + T.grapple.releaseUp);
  registerTech(p);
}

/** One cable's distance constraint. Returns false when that cable should let go. */
function holdCable(p: Player, c: Cable, from: V3, dt: number): boolean {
  const g = T.grapple;
  const to = V.sub(c.anchor, from);
  const dist = V.len(to);
  if (dist < g.minLen || dist > g.maxLen) return false;
  const dir = V.scale(to, 1 / dist);

  // Past the cable's length, kill the velocity heading away from the anchor and
  // pull the stretch back in. Removing that radial component is the single line
  // that turns a fall into a swing.
  const stretch = dist - c.len;
  if (stretch <= g.slack) return true;

  const away = -V.dot(p.vel, dir);          // >0 means moving away from the anchor
  if (away > 0) p.vel = V.add(p.vel, V.scale(dir, away));
  p.vel = V.add(p.vel, V.scale(dir, (stretch - g.slack) * g.stiffness * dt));
  // Drag along the arc only — deliberately tiny. A swing that scrubs speed is a
  // swing you stop using.
  if (g.swingDrag > 0) {
    const keep = Math.max(0, 1 - g.swingDrag * dt);
    const radial = V.scale(dir, V.dot(p.vel, dir));
    p.vel = V.add(radial, V.scale(V.sub(p.vel, radial), keep));
  }
  return true;
}

/**
 * The cables, applied after the state has had its say and before the move. They
 * are a MODIFIER, not a state, which is what lets you dash, wallrun, slide and
 * shoot with them attached — the gear never takes the character away from you.
 *
 * Order matters: the state update (ordinary air control, and the gas) has already
 * run, so the constraints below eat the radial half of everything it added and
 * leave the tangential half. That is why A and D steer a swing without a single
 * line of bespoke swing-steering code.
 */
function updateGrapple(p: Player, i: Intent, col: CollisionWorld, dt: number) {
  if (!p.grappling) return;
  p.grappleTime += dt;
  const g = T.grapple;
  const from = ropeOrigin(p);

  if (!g.enabled) return releaseGrapple(p, false);

  // --- WASD. Forward reels in, back pays out; left and right are left alone,
  // because ordinary air control already steers the arc. `grappleAuto` is the
  // meathook holding the reel down for you: hooking a body is a commitment.
  p.grappleReel = (p.grappleAuto || i.moveY > 0.1) ? 1 : i.moveY < -0.1 ? -1 : 0;
  if (p.grappleReel !== 0) {
    const speed = p.grappleAuto ? g.hookSpeed : g.reelSpeed;
    for (const c of p.cables) {
      if (!c.on) continue;
      c.len = p.grappleReel > 0
        ? Math.max(g.minLen, c.len - speed * dt)
        : Math.min(g.maxLen, c.len + g.payOutSpeed * dt);
    }
  }

  // --- C on the rope: dive. Down AND out, together. Driving down alone just
  // swings you faster through the same arc; paying cable out at the same time
  // is what drops you under the anchor and lengthens the path. Held, not
  // pressed, so the depth of the dive is how long you hold it, and it layers on
  // WASD rather than replacing it — dive while reeling and the two lengths add.
  if (T.slam.enabled && i.slam.held) {
    p.vel.y -= g.diveAccel * dt;
    for (const c of p.cables) {
      if (c.on) c.len = Math.min(g.maxLen, c.len + g.divePayOut * dt);
    }
  }

  if (p.grappleReel > 0) {
    // Pull along the AVERAGE of the live cables, once — applying the reel per
    // cable would double the yank whenever both are attached.
    let mean = V.v3();
    let n = 0;
    for (const c of p.cables) {
      if (!c.on) continue;
      mean = V.add(mean, V.norm(V.sub(c.anchor, from)));
      n++;
    }
    if (n > 0) {
      const dir = V.norm(mean);
      const accel = p.grappleAuto ? g.hookAccel : g.reelAccel;
      const cap = p.grappleAuto ? g.hookSpeed : g.reelCap;
      const along = V.dot(p.vel, dir);
      p.vel = V.add(p.vel, V.scale(dir, Math.min(accel * dt, Math.max(0, cap - along))));
      // Flat pull alone drags you into the wall below the anchor; the lift is
      // what turns a grapple at a ledge into an arc over it. Shaped by how flat
      // the cable is — unshaped it keeps pushing while you are already climbing
      // and fires you tens of metres past the anchor, which is a rocket, not a
      // cable. Manual only: the meathook is a straight line onto a body.
      if (!p.grappleAuto) p.vel.y += g.reelLift * (1 - Math.abs(dir.y)) * dt;
    }
  }

  // --- the constraints, one per live cable. Two taut cables genuinely pull
  // against each other, and that IS the two-point hang: it damps the swing and
  // holds you in the pocket between the anchors instead of arcing past them.
  for (const c of p.cables) {
    if (!c.on) continue;
    if (g.breakOnBlocked) {
      // Stop short of the anchor's own surface, or every cable reports blocked.
      const to = V.sub(c.anchor, from);
      const d = V.len(to);
      if (col.ray(from, V.scale(to, 1 / d), d - 0.35) !== null) { c.on = false; continue; }
    }
    if (!holdCable(p, c, from, dt)) c.on = false;
  }

  // Both cables gone means arrival (or over-stretch). Go out through the proper
  // door so the cooldown, the keep window and the release boost all still happen.
  if (!p.cables.some((c) => c.on)) return releaseGrapple(p, true);

  const speed = V.len(p.vel);
  if (speed > T.momentum.hardCap) p.vel = V.scale(p.vel, T.momentum.hardCap / speed);

  // A cable pulling up beats standing: let the reel lift you off the floor
  // rather than scraping you along it.
  if (p.grounded && p.vel.y > 0.1 && p.state === 'grounded') enter(p, 'airborne');
}

// ---------------------------------------------------------------- thrusters

/**
 * Hover jets, a held modifier rather than a state — you can still dash out of a
 * hover, still catch a wall, still be shot at. Modelling it as a state would have
 * meant duplicating all of updateAirborne inside it for no behavioural gain.
 *
 * The shape of the verb is "hang and shoot", not "fly": `maxRise` caps the climb,
 * `hoverDrag` bleeds horizontal speed so a hover parks you rather than launching
 * you across the arena, and the tank is short. Running it dry locks the jets out
 * until `restartFuel` is back, so there is a real cost to burning the last drop.
 *
 * Returns the gravity scale to apply this tick.
 */
function updateThruster(p: Player, i: Intent, wish: V3, dt: number): number {
  const t = T.thruster;
  const wants = t.enabled && i.thrust.held && !p.grounded
    // The gate that stops a held jump from lighting the jets on every hop.
    && (!t.requireEmptyJumps || p.jumpsLeft <= 0);

  p.thrusting = wants && !p.fuelDry && p.fuel > 0;
  if (!p.thrusting) return 1;

  // Afterburner: the dash key, held while the jets are already lit. The hover is
  // for holding a position and shooting; this is for crossing the arena, and the
  // only thing keeping it honest is that it drinks the tank.
  p.boosting = t.boost && i.dash.held;

  p.fuelIdle = 0;
  p.fuel = Math.max(0, p.fuel - t.burnRate * (p.boosting ? t.boostBurn : 1) * dt);
  if (p.fuel <= 0) p.fuelDry = true;

  if (p.boosting) return boostThruster(p, i, wish, dt);

  // ODM: on a cable the jets are GAS, not a hover — and this returns BEFORE the
  // climb and the hover steering, because every part of the hover model fights a
  // swing. `hoverDrag` scrubs the arc you just earned; `hoverRedirect` rotates
  // the velocity the cable is trying to own; the climb to `maxRise` cancels the
  // fall the pendulum runs on; and `gravityScale` cuts the gravity that IS the
  // pendulum's engine. Measured, all four together made holding the jets on a
  // cable SLOWER than not holding them, which is the wrong answer to every
  // question. So: full gravity, no drag, no steering — just a push.
  //
  // `accelerate` caps the push against gasCap along that direction ONLY, so gas
  // can never take away speed the pendulum earned. Swinging well still beats
  // holding the button, and the cable is what holds you up.
  if (p.grappling) {
    let dir = wish;
    if (V.lenH(dir) < 1e-6) dir = V.norm(V.v3(-Math.sin(i.yaw), 0, -Math.cos(i.yaw)));
    p.vel = accelerate(p.vel, dir, t.gasAccel, t.gasCap, dt);
    return 1;
  }

  // Climb, capped. Thrust only pushes until maxRise, so the jets can arrest a
  // fall instantly but can never turn into an escalator.
  if (p.vel.y < t.maxRise) {
    p.vel.y = Math.min(t.maxRise, p.vel.y + t.thrust * dt);
  }

  // Hover steering. Redirect FIRST, for the same reason air control needed it
  // (§9): at the hover cap there is no headroom left for accelerate() to add, so
  // without this a direction change reads as sluggish no matter how high
  // hoverAccel goes. Turning is free; gaining speed still is not.
  p.vel = redirect(p.vel, wish, t.hoverRedirect, dt);
  p.vel = accelerate(p.vel, wish, t.hoverAccel, t.hoverCap, dt);
  const h = V.lenH(p.vel);
  if (h > 1e-4) {
    p.vel = V.setLenH(p.vel, Math.max(0, h - t.hoverDrag * h * dt));
  }
  return t.gravityScale;
}

/**
 * The burner. Point and go: the stick if you're steering, otherwise wherever the
 * camera looks, with pitch folded in so you climb by aiming up rather than by
 * holding a separate key.
 *
 * It deliberately does NOT go through accelerate(): that clamps against a wish
 * speed, which is the right model for running and the wrong one for a rocket.
 * A burn adds along the aim until it hits its own ceiling, and `boostDrag` is
 * near zero so what you build you keep — including after you let go, where the
 * ordinary airborne overspeed bleed takes over at the gentle air rate.
 */
function boostThruster(p: Player, i: Intent, wish: V3, dt: number): number {
  const t = T.thruster;

  // Base lift first, so a level burn flies level instead of sinking. It only
  // arrests a fall — climbing still has to be aimed for.
  if (p.vel.y < 0) p.vel.y = Math.min(0, p.vel.y + t.thrust * dt);

  let dir = wish;
  if (V.lenH(dir) < 1e-6) dir = V.v3(-Math.sin(i.yaw), 0, -Math.cos(i.yaw));
  dir = V.norm(V.v3(dir.x, Math.sin(i.pitch) * t.boostAim, dir.z));

  p.vel.x += dir.x * t.boostAccel * dt;
  p.vel.y += dir.y * t.boostAccel * dt;
  p.vel.z += dir.z * t.boostAccel * dt;

  const h = V.lenH(p.vel);
  if (h > t.boostCap) p.vel = V.setLenH(p.vel, t.boostCap);
  else if (h > 1e-4) p.vel = V.setLenH(p.vel, Math.max(0, h - t.boostDrag * h * dt));
  p.vel.y = Math.min(p.vel.y, t.boostRise);

  return t.gravityScale;
}

// ---------------------------------------------------------------- states

function gravity(p: Player, dt: number, scale = 1) {
  const g = p.vel.y > 0 ? T.world.gravityRise : T.world.gravityFall;
  p.vel.y = Math.max(-T.world.maxFallSpeed, p.vel.y - g * scale * dt);
}

function updateGrounded(p: Player, i: Intent, wish: V3, dt: number) {
  if (V.lenH(wish) > 1e-6) {
    p.vel = redirect(p.vel, wish, T.ground.redirect, dt);
    p.vel = accelerate(p.vel, wish, T.ground.accel, currentCap(p), dt);
  } else if (p.bufJump <= 0 && !p.grappling) {
    // Ground friction against a taut rope is a tug of war the rope should win.
    p.vel = applyFriction(p.vel, T.ground.friction, dt);
  }
  p.vel.y = Math.min(p.vel.y, 0);

  if (p.bufSlide > 0 && canSlide(p)) return doSlide(p);
  if (p.bufDash > 0 && canDash(p)) return doDash(p, i);
  if (p.bufJump > 0 && canJump(p)) return doJump(p);
}

function updateAirborne(p: Player, i: Intent, wish: V3, col: CollisionWorld, dt: number) {
  // Thrusters run before gravity because they change how much of it applies.
  const gScale = updateThruster(p, i, wish, dt);
  gravity(p, dt, gScale);

  // While the jets are burning the thruster owns horizontal control — running the
  // air accel on top would let you out-accelerate hoverCap and turn the hover into
  // free flight, which is exactly what the cap exists to prevent.
  if (p.thrusting) {
    // Shift is the burner while the jets are lit, so no dash branch here — the
    // dash is back the instant you let go of the jump key.
    if (!p.grounded && tryWallAttach(p, col)) return;
    return;
  }

  // Pure strafe (A or D with no forward input) is the bunnyhop stance: skip redirect
  // and use the classic small-wish-speed accel so turning the mouse gains speed.
  // Any forward input returns to the responsive redirect-based control.
  const pureStrafe = Math.abs(i.moveX) > 0.1 && Math.abs(i.moveY) < 0.1;
  if (pureStrafe) {
    p.vel = accelerateClassic(p.vel, wish, T.bhop.airAccel, T.bhop.airWishSpeed, dt);
  } else {
    p.vel = redirect(p.vel, wish, T.air.redirect, dt);
    p.vel = accelerate(p.vel, wish, T.air.accel * T.air.control, currentCap(p), dt);
    if (V.lenH(wish) < 1e-6) p.vel = applyFriction(p.vel, T.air.friction, dt);
  }

  // A wall jump stays available briefly after leaving the wall.
  if (p.bufJump > 0 && p.wallCoyote > 0) return doWallJump(p);
  // Slid off a ledge a moment ago? The jump still counts as a slide jump and
  // keeps the multiplier. This is the dash-slide-jump ledge extension.
  if (p.bufJump > 0 && p.slideCoyote > 0 && canJump(p)) {
    p.slideCoyote = 0;
    return doJump(p, T.jump.slideExitBonus);
  }
  if (p.bufDash > 0 && canDash(p)) return doDash(p, i);
  if (p.bufJump > 0 && canJump(p)) return doJump(p);

  if (!p.grounded && tryWallAttach(p, col)) return;
}

function updateDashing(p: Player, i: Intent, col: CollisionWorld, dt: number) {
  // "A dash must never COST you speed" (§9) has to hold DURING the dash, not just
  // on the way out. The old code overwrote velocity with dash.speed flat, so
  // dashing while already faster — out of an afterburn at 34 u/s, say — dropped
  // you to 32 for the duration and handed it back on exit. Net zero, and it read
  // as the dash doing nothing at all. At speed the dash is now a free redirect.
  const base = T.dash.speed * p.dashBoost;
  const speed = T.dash.preserveEntrySpeed
    ? Math.min(T.momentum.hardCap * p.dashBoost, Math.max(base, p.dashEntrySpeed))
    : base;
  p.vel = V.scale(p.dashDir, speed);
  if (T.dash.gravityScale > 0) gravity(p, dt, T.dash.gravityScale);

  p.dashTime -= dt;

  // Dash is cancellable — this is where most of the tech comes from.
  if (p.bufJump > 0 && p.wallCoyote > 0) return doWallJump(p);
  if (p.bufJump > 0 && canJump(p)) return doJump(p);
  if (p.bufSlide > 0 && p.grounded && canSlide(p)) return doSlide(p);
  if (!p.grounded && tryWallAttach(p, col)) return;

  if (p.dashTime <= 0) {
    const out = T.dash.speed * p.dashBoost * T.dash.exitSpeedKeep;
    const keep = T.dash.preserveEntrySpeed ? Math.max(out, p.dashEntrySpeed) : out;
    p.vel = V.scale(p.dashDir, Math.min(keep, T.momentum.hardCap * p.dashBoost));
    if (p.vel.y > 0) p.vel.y = Math.min(p.vel.y, T.jump.speed);
    enter(p, p.grounded ? 'grounded' : 'airborne');
  }
}

function updateSliding(p: Player, i: Intent, wish: V3, dt: number) {
  if (!p.grounded) {
    gravity(p, dt);
  } else {
    // Slope component: accelerate downhill, brake uphill. On a real descent this
    // should outrun the friction term comfortably, or slides die on ramps.
    const n = p.groundNormal;
    const downhill = V.v3(n.x, 0, n.z);
    const steepness = V.lenH(downhill);
    if (steepness > 1e-4) {
      const dir = V.scale(downhill, 1 / steepness);
      const alignment = (p.vel.x * dir.x + p.vel.z * dir.z) / Math.max(V.lenH(p.vel), 1e-6);
      const rate = alignment >= 0 ? T.slide.slopeAccel : -T.slide.slopeBrake;
      p.vel.x += dir.x * rate * steepness * dt;
      p.vel.z += dir.z * rate * steepness * dt;
    }
    p.vel = applyFriction(p.vel, T.slide.friction, dt);
    p.vel.y = Math.min(p.vel.y, 0);
  }

  // Steering curves the slide without letting you accelerate out of it.
  if (V.lenH(wish) > 1e-6) {
    p.vel = redirect(p.vel, wish, T.slide.steerRate, dt);
  }

  if (p.bufJump > 0 && canJump(p)) {
    doJump(p, T.jump.slideExitBonus);
    p.slideCooldown = T.slide.cooldown;
    return;
  }
  if (p.bufDash > 0 && canDash(p)) {
    doDash(p, i);
    p.slideCooldown = T.slide.cooldown;
    return;
  }
  // minTime stops the slide from being dropped the instant it starts, which is
  // what made it feel like it "ended too fast".
  if (p.stateTime < T.slide.minTime) return;
  if (!i.slide.held || V.lenH(p.vel) < T.slide.minSpeed) endSlide(p);
}

// ---------------------------------------------------------------- main step

function tickTimers(p: Player, dt: number) {
  const d = (x: number) => Math.max(0, x - dt);
  p.coyoteJump = d(p.coyoteJump);
  p.coyoteDash = d(p.coyoteDash);
  p.bufJump = d(p.bufJump);
  p.bufDash = d(p.bufDash);
  p.bufSlide = d(p.bufSlide);
  p.slideCooldown = d(p.slideCooldown);
  p.slideCoyote = d(p.slideCoyote);
  p.dashCooldown = d(p.dashCooldown);
  p.wallCoyote = d(p.wallCoyote);
  p.wallCooldown = d(p.wallCooldown);
  p.vaultT = d(p.vaultT);
  p.vaultCooldown = d(p.vaultCooldown);
  p.vaultGrace = d(p.vaultGrace);
  // An early Space that never found its lip turns back into a jump rather than
  // evaporating. You asked to leave the ground; silently getting nothing for it
  // is a worse answer than getting it a frame or two late.
  if (p.vaultPending > 0) {
    p.vaultPending = d(p.vaultPending);
    if (p.vaultPending <= 0 && T.vault.failToJump) p.bufJump = T.jump.bufferTime;
  }
  p.slamBoost = d(p.slamBoost);
  p.grappleKeep = d(p.grappleKeep);
  p.grappleCooldown = d(p.grappleCooldown);
  p.chainTimer = d(p.chainTimer);
  if (p.chainTimer <= 0) p.chain = 0;
  p.stamina = Math.min(T.stamina.max, p.stamina + T.stamina.regen * dt);
  p.stateTime += dt;

  // Thruster tank. Refuelling belongs here rather than in updateThruster because
  // it has to happen in every state — most of all on the ground, where the
  // groundRefuel bonus makes "land, top up, go again" the loop instead of
  // hanging in the air waiting. Landing is the reward, not patience.
  const th = T.thruster;
  if (p.thrusting) {
    p.fuelIdle = 0;
  } else {
    p.fuelIdle += dt;
    if (p.fuelIdle >= th.refuelDelay) {
      const rate = th.refuelRate * (p.grounded ? th.groundRefuel : 1);
      p.fuel = Math.min(th.fuelMax, p.fuel + rate * dt);
    }
  }
  if (p.fuelDry && p.fuel >= th.restartFuel) p.fuelDry = false;
  // Cleared every tick; only updateAirborne re-arms them, so no other state can
  // leave the HUD showing a burn that isn't happening.
  p.thrusting = false;
  p.boosting = false;
}

/** One fixed physics tick. */
export function step(p: Player, i: Intent, col: CollisionWorld, dt: number) {
  tickTimers(p, dt);

  // Who owns Space this tick. The vault claims it only when there is actually a
  // lip in the window — everywhere else the press falls straight through to the
  // jump, so binding both to one key costs nothing in open air. The sense pass
  // has to run here, before the state machine, or updateGrounded consumes the
  // buffered jump first and the vault never gets a look at its own button.
  const lip = vaultSense(p, col);
  const vaultClaim = T.vault.enabled && T.vault.timed && i.jump.pressed
    && p.state !== 'wallrunning' && !p.slamming
    && (p.vaultArmed || p.vaultGrace > 0);
  if (vaultClaim) p.vaultPending = T.vault.windowBefore;
  else if (i.jump.pressed) p.bufJump = T.jump.bufferTime;
  if (i.dash.pressed) p.bufDash = T.dash.bufferTime;
  if (i.slide.pressed) p.bufSlide = T.slide.bufferTime;

  // Grapple, before anything else moves: pressing it should change this tick.
  // Hold-to-hang by default; `toggle` turns the press into an on/off switch.
  if (i.grapple.pressed) {
    if (p.grappling) releaseGrapple(p);
    else fireGrapple(p, i, col);
  } else if (!T.grapple.toggle && p.grappling && !i.grapple.held) {
    releaseGrapple(p);
  }

  const wish = wishDir(i);
  const wasGrounded = p.grounded;

  // Jump out of a slam. This has to happen BEFORE the state machine: the slam
  // owns velocity outright, so airborne would apply the jump and updateSlam
  // would clamp it straight back down on the same tick. Cancelling forfeits the
  // landing boost, which is the cost, and needs no rule of its own.
  if (p.slamming && T.slam.jumpCancel && i.jump.pressed) p.slamming = false;

  // Before the state machine: a slam cancels whatever you were doing, so the
  // state it cancels should not get a tick of its own first.
  trySlam(p, i, col);

  // Sprint is a held modifier, not a state — the cap change happens in currentCap().
  p.sprinting = T.sprint.enabled && i.dash.held && i.moveY > T.sprint.minForward;

  // Run the new state's update in the same tick when a transition fires, so a dash
  // or jump takes effect on the frame you pressed it instead of the one after.
  let guard = 0;
  let before: StateName;
  do {
    before = p.state;
    switch (p.state) {
      case 'grounded': updateGrounded(p, i, wish, dt); break;
      case 'airborne': updateAirborne(p, i, wish, col, dt); break;
      case 'dashing': updateDashing(p, i, col, dt); break;
      case 'sliding': updateSliding(p, i, wish, dt); break;
      case 'wallrunning': updateWallrunning(p, i, wish, col, dt); break;
    }
    guard++;
  } while (p.state !== before && guard < 3);

  // The slam owns velocity outright while it is running, so it goes after the
  // state (which would otherwise re-apply air control into it) and before the
  // rope. Vaulting is suppressed for the same reason: the whole move is "down".
  if (p.slamming) updateSlam(p);
  else tryVault(p, lip);

  // After the state, before the move: the rope gets the last word on velocity,
  // so it can cancel whatever the state just added that the rope would not allow.
  updateGrapple(p, i, col, dt);

  if (p.state !== 'dashing') bleedOverspeed(p, dt);

  p.prevPos = V.copy(p.pos);
  const res = col.move(p.pos, V.scale(p.vel, dt));
  p.pos = res.pos;
  p.grounded = res.grounded;
  p.groundNormal = res.groundNormal;

  // Brushing a wall in mid-air is the most common way to start a wallrun — the
  // sideways probe alone misses it, because a wall you're running INTO is in front
  // of you, not beside you.
  if (res.hitWall && !res.grounded && p.wallCooldown <= 0
      && (p.state === 'airborne' || p.state === 'dashing')) {
    attachWall(p, res.wallNormal);
  }

  // Kill velocity into surfaces we actually hit, or we stick to walls. During a
  // wallrun the glue force is deliberately pushing into the wall, so skip it.
  if (res.hitWall && p.state !== 'wallrunning') p.vel = V.projectOnPlane(p.vel, res.wallNormal);
  if (res.grounded && p.vel.y < 0) p.vel.y = 0;

  // Hold the vault's push through the rise. The projection just above deletes
  // precisely the velocity that carries you over the lip — you are still inside
  // the face while climbing it — so without re-asserting it every tick you scrape
  // up the wall and arrive on top with nothing left, which is the stall this
  // whole thing exists to remove.
  if (p.vaultT > 0) {
    const along = p.vel.x * p.vaultDir.x + p.vel.z * p.vaultDir.z;
    if (along < p.vaultPush) {
      const add = p.vaultPush - along;
      p.vel.x += p.vaultDir.x * add;
      p.vel.z += p.vaultDir.z * add;
    }
  }

  // Ground state bookkeeping
  if (res.grounded && !wasGrounded) {
    if (p.slamming) {
      p.slamming = false;
      p.slamBoost = T.slam.boostTime;
      p.vel.y = 0;
    }
    p.jumpsLeft = T.jump.maxJumps;
    if (T.dash.refillOnGround) p.dashCharges = T.dash.maxCharges;
    p.wallCoyote = 0;
    p.lastWallX = 0;
    p.lastWallZ = 0;
    p.wallChain = 0;
    if (p.state === 'airborne' || p.state === 'wallrunning') {
      // Buffered slide on landing — lets you slide the instant you touch down.
      if (p.bufSlide > 0 && canSlide(p)) doSlide(p);
      else enter(p, 'grounded');
    }
  } else if (!res.grounded && wasGrounded) {
    p.coyoteJump = T.jump.coyoteTime;
    p.coyoteDash = T.dash.coyoteTime;
    if (p.state === 'grounded') enter(p, 'airborne');
    if (p.state === 'sliding') {
      p.slideCoyote = T.slide.coyoteTime;
      // Ghostrunner ledge boost: a slide carried off a ledge flings you forward
      // and drops you hard. The coyote jump above converts the fling into a
      // launch (the "Super"); miss the window and you eat the drop instead.
      if (T.slide.ledgeBoost > 0) {
        p.vel = V.setLenH(p.vel, Math.min(T.momentum.hardCap, V.lenH(p.vel) + T.slide.ledgeBoost));
        registerTech(p);
      }
      if (T.slide.ledgeDrop > 0) p.vel.y = Math.min(p.vel.y, -T.slide.ledgeDrop);
      if (!i.slide.held) endSlide(p);
    }
  }

  // Facing chases movement direction; decoupled from the camera on purpose.
  const h = V.lenH(p.vel);
  if (h > 0.5) {
    const target = Math.atan2(p.vel.x, p.vel.z);
    p.facing += V.shortestAngle(p.facing, target) * (1 - Math.exp(-T.character.turnRate * dt));
  }
}
