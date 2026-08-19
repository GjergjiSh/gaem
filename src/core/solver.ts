// The movement solver. Engine-agnostic by design: it touches T (tuning), the Player
// struct, an Intent, and a CollisionWorld interface. Nothing else.

import { T } from './tuning';
import * as V from './vec';
import type { V3 } from './vec';
import type { CollisionWorld, Intent, Player, StateName } from './types';

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
    fuel: T.thruster.fuelMax,
    fuelIdle: 0,
    fuelDry: false,
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

// ---------------------------------------------------------------- wallrun

/**
 * Shared attach path. Validates that the surface is steep enough, that we aren't
 * re-grabbing the wall we just left, and that we're travelling ALONG it rather
 * than straight into it — hitting a wall head-on should bonk, not stick.
 */
function attachWall(p: Player, rawNormal: V3): boolean {
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

  p.fuelIdle = 0;
  p.fuel = Math.max(0, p.fuel - t.burnRate * dt);
  if (p.fuel <= 0) p.fuelDry = true;

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

// ---------------------------------------------------------------- states

function gravity(p: Player, dt: number, scale = 1) {
  const g = p.vel.y > 0 ? T.world.gravityRise : T.world.gravityFall;
  p.vel.y = Math.max(-T.world.maxFallSpeed, p.vel.y - g * scale * dt);
}

function updateGrounded(p: Player, i: Intent, wish: V3, dt: number) {
  if (V.lenH(wish) > 1e-6) {
    p.vel = redirect(p.vel, wish, T.ground.redirect, dt);
    p.vel = accelerate(p.vel, wish, T.ground.accel, currentCap(p), dt);
  } else if (p.bufJump <= 0) {
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
    if (p.bufDash > 0 && canDash(p)) return doDash(p, i);
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
  p.vel = V.scale(p.dashDir, T.dash.speed);
  if (T.dash.gravityScale > 0) gravity(p, dt, T.dash.gravityScale);

  p.dashTime -= dt;

  // Dash is cancellable — this is where most of the tech comes from.
  if (p.bufJump > 0 && p.wallCoyote > 0) return doWallJump(p);
  if (p.bufJump > 0 && canJump(p)) return doJump(p);
  if (p.bufSlide > 0 && p.grounded && canSlide(p)) return doSlide(p);
  if (!p.grounded && tryWallAttach(p, col)) return;

  if (p.dashTime <= 0) {
    const base = T.dash.speed * T.dash.exitSpeedKeep;
    const keep = T.dash.preserveEntrySpeed ? Math.max(base, p.dashEntrySpeed) : base;
    p.vel = V.scale(p.dashDir, Math.min(keep, T.momentum.hardCap));
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
  // Cleared every tick; only updateAirborne re-arms it, so no other state can
  // leave the HUD showing a burn that isn't happening.
  p.thrusting = false;
}

/** One fixed physics tick. */
export function step(p: Player, i: Intent, col: CollisionWorld, dt: number) {
  tickTimers(p, dt);

  if (i.jump.pressed) p.bufJump = T.jump.bufferTime;
  if (i.dash.pressed) p.bufDash = T.dash.bufferTime;
  if (i.slide.pressed) p.bufSlide = T.slide.bufferTime;

  const wish = wishDir(i);
  const wasGrounded = p.grounded;

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

  // Ground state bookkeeping
  if (res.grounded && !wasGrounded) {
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
