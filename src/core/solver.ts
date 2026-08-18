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

function applyFriction(vel: V3, friction: number, dt: number): V3 {
  const h = V.lenH(vel);
  if (h < 1e-6) return vel;
  return V.setLenH(vel, Math.max(0, h - friction * dt));
}

/** The soft cap. Overspeed bleeds off rather than being clamped. */
function bleedOverspeed(p: Player, dt: number) {
  const cap = currentCap(p);
  const h = V.lenH(p.vel);
  if (h <= cap) return;
  const scale = p.grounded ? 1 : T.momentum.airDecayScale;
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
  const h = V.lenH(p.vel);
  // Keep the along-wall component, add the outward kick.
  const along = V.projectOnPlane(V.v3(p.vel.x, 0, p.vel.z), n);
  p.vel = V.v3(
    along.x + n.x * T.wall.jumpOut,
    T.wall.jumpUp,
    along.z + n.z * T.wall.jumpOut,
  );
  if (V.lenH(p.vel) < h) p.vel = V.setLenH(p.vel, h); // never lose speed to a wall jump
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
  return p.dashCharges > 0 && p.dashCooldown <= 0;
}

function doDash(p: Player, i: Intent) {
  let dir = wishDir(i);
  if (V.lenH(dir) < 1e-6) {
    // No stick input: dash where the camera is looking.
    dir = V.v3(-Math.sin(i.yaw), 0, -Math.cos(i.yaw));
  }
  dir.y = Math.sin(i.pitch) * T.dash.verticalAim;
  p.dashDir = V.norm(dir);
  p.dashTime = T.dash.duration;
  p.dashEntrySpeed = V.lenH(p.vel);
  p.dashCharges--;
  p.dashCooldown = T.dash.cooldown;
  p.bufDash = 0;
  p.coyoteDash = 0;
  if (T.dash.refundJumpOnDash) p.jumpsLeft = Math.max(p.jumpsLeft, T.jump.maxJumps - 1);
  registerTech(p);
  enter(p, 'dashing');
}

function canSlide(p: Player) {
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

/** Probe both sides for a runnable wall. Returns true if we attached. */
function tryWallAttach(p: Player, col: CollisionWorld): boolean {
  if (p.wallCooldown > 0) return false;
  const h = V.lenH(p.vel);
  if (h < T.wall.minSpeed) return false;

  const dir = V.v3(p.vel.x / h, 0, p.vel.z / h);
  const right = V.v3(-dir.z, 0, dir.x);
  const reach = T.character.radius + T.wall.detectDist;
  const maxTilt = Math.sin(T.wall.maxAngle);

  for (const side of [1, -1]) {
    const probe = V.scale(right, side);
    const hit = col.rayHit(p.pos, probe, reach);
    if (!hit) continue;
    if (Math.abs(hit.normal.y) > maxTilt) continue;      // floor or ceiling, not a wall
    // Refuse the wall we just jumped off, unless it's genuinely a different surface.
    const sameWall = hit.normal.x * p.lastWallX + hit.normal.z * p.lastWallZ > 0.85;
    if (sameWall && p.chainTimer > 0 && p.wallCoyote > 0) continue;

    p.wallNormal = V.norm(V.v3(hit.normal.x, 0, hit.normal.z));
    p.wallSide = side;
    p.wallTime = 0;
    // Flatten into the wall plane and add the attach pop.
    const along = V.projectOnPlane(V.v3(p.vel.x, 0, p.vel.z), p.wallNormal);
    p.vel = V.v3(along.x, Math.max(p.vel.y, 0) + T.wall.upBoost, along.z);
    if (T.wall.refillJumps) p.jumpsLeft = T.jump.maxJumps;
    if (T.wall.refillDash) p.dashCharges = T.dash.maxCharges;
    registerTech(p);
    enter(p, 'wallrunning');
    return true;
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
  if (p.wallTime > T.wall.maxTime || p.grounded) return detachWall(p);

  p.vel.y -= T.world.gravityRise * T.wall.gravityScale * dt;

  // Accelerate along the wall in whichever direction we're already travelling.
  const tangent = V.norm(V.v3(-p.wallNormal.z, 0, p.wallNormal.x));
  const sign = (p.vel.x * tangent.x + p.vel.z * tangent.z) >= 0 ? 1 : -1;
  const runDir = V.scale(tangent, sign);
  const forwardInput = Math.max(0, wish.x * runDir.x + wish.z * runDir.z);
  p.vel = accelerate(p.vel, runDir, T.wall.runAccel * forwardInput, currentCap(p), dt);

  // Glue: a constant pull into the wall keeps you attached around corners.
  p.vel.x -= p.wallNormal.x * T.wall.stickAssist * dt;
  p.vel.z -= p.wallNormal.z * T.wall.stickAssist * dt;

  if (V.lenH(p.vel) < T.wall.minSpeed) detachWall(p);
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
  } else {
    p.vel = applyFriction(p.vel, T.ground.friction, dt);
  }
  p.vel.y = Math.min(p.vel.y, 0);

  if (p.bufSlide > 0 && canSlide(p)) return doSlide(p);
  if (p.bufDash > 0 && canDash(p)) return doDash(p, i);
  if (p.bufJump > 0 && canJump(p)) return doJump(p);
}

function updateAirborne(p: Player, i: Intent, wish: V3, col: CollisionWorld, dt: number) {
  gravity(p, dt);
  p.vel = redirect(p.vel, wish, T.air.redirect, dt);
  p.vel = accelerate(p.vel, wish, T.air.accel * T.air.control, currentCap(p), dt);
  if (V.lenH(wish) < 1e-6) p.vel = applyFriction(p.vel, T.air.friction, dt);

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
  p.stateTime += dt;
}

/** One fixed physics tick. */
export function step(p: Player, i: Intent, col: CollisionWorld, dt: number) {
  tickTimers(p, dt);

  if (i.jump.pressed) p.bufJump = T.jump.bufferTime;
  if (i.dash.pressed) p.bufDash = T.dash.bufferTime;
  if (i.slide.pressed) p.bufSlide = T.slide.bufferTime;

  const wish = wishDir(i);
  const wasGrounded = p.grounded;

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

  // Variable jump height: cutting the button early clips upward velocity.
  if (!i.jump.held && p.vel.y > 0 && p.state === 'airborne') {
    p.vel.y *= Math.pow(T.jump.cutMultiplier, dt * 60);
  }

  if (p.state !== 'dashing') bleedOverspeed(p, dt);

  p.prevPos = V.copy(p.pos);
  const res = col.move(p.pos, V.scale(p.vel, dt));
  p.pos = res.pos;
  p.grounded = res.grounded;
  p.groundNormal = res.groundNormal;

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
