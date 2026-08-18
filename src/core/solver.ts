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

/** Current speed ceiling, raised by an active chain. */
export function currentCap(p: Player): number {
  const mult = Math.min(T.momentum.maxChainBonus, Math.pow(T.momentum.chainBonus, p.chain));
  return T.ground.maxSpeed * mult;
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
  const next = Math.max(cap, h - T.momentum.overspeedDecay * dt);
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
  enter(p, p.grounded ? 'grounded' : 'airborne');
}

// ---------------------------------------------------------------- states

function gravity(p: Player, dt: number, scale = 1) {
  const g = p.vel.y > 0 ? T.world.gravityRise : T.world.gravityFall;
  p.vel.y = Math.max(-T.world.maxFallSpeed, p.vel.y - g * scale * dt);
}

function updateGrounded(p: Player, i: Intent, wish: V3, dt: number) {
  if (V.lenH(wish) > 1e-6) {
    p.vel = accelerate(p.vel, wish, T.ground.accel, currentCap(p), dt);
  } else {
    p.vel = applyFriction(p.vel, T.ground.friction, dt);
  }
  p.vel.y = Math.min(p.vel.y, 0);

  if (p.bufSlide > 0 && canSlide(p)) return doSlide(p);
  if (p.bufDash > 0 && canDash(p)) return doDash(p, i);
  if (p.bufJump > 0 && canJump(p)) return doJump(p);
}

function updateAirborne(p: Player, i: Intent, wish: V3, dt: number) {
  gravity(p, dt);
  p.vel = accelerate(p.vel, wish, T.air.accel * T.air.control, currentCap(p), dt);
  if (V.lenH(wish) < 1e-6) p.vel = applyFriction(p.vel, T.air.friction, dt);

  if (p.bufDash > 0 && canDash(p)) return doDash(p, i);
  if (p.bufJump > 0 && canJump(p)) return doJump(p);
}

function updateDashing(p: Player, i: Intent, dt: number) {
  p.vel = V.scale(p.dashDir, T.dash.speed);
  if (T.dash.gravityScale > 0) gravity(p, dt, T.dash.gravityScale);

  p.dashTime -= dt;

  // Dash is cancellable — this is where most of the tech comes from.
  if (p.bufJump > 0 && canJump(p)) return doJump(p);
  if (p.bufSlide > 0 && p.grounded && canSlide(p)) return doSlide(p);

  if (p.dashTime <= 0) {
    p.vel = V.scale(p.dashDir, T.dash.speed * T.dash.exitSpeedKeep);
    if (p.vel.y > 0) p.vel.y = Math.min(p.vel.y, T.jump.speed);
    enter(p, p.grounded ? 'grounded' : 'airborne');
  }
}

function updateSliding(p: Player, i: Intent, wish: V3, dt: number) {
  if (!p.grounded) {
    gravity(p, dt);
  } else {
    // Slope component: accelerate downhill, brake uphill.
    const n = p.groundNormal;
    const downhill = V.v3(n.x, 0, n.z);
    const dh = V.lenH(downhill);
    if (dh > 1e-4) {
      const dir = V.scale(downhill, 1 / dh);
      const alignment = (p.vel.x * dir.x + p.vel.z * dir.z) / Math.max(V.lenH(p.vel), 1e-6);
      const rate = alignment >= 0 ? T.slide.slopeAccel : -T.slide.slopeBrake;
      p.vel.x += dir.x * rate * dh * dt;
      p.vel.z += dir.z * rate * dh * dt;
    }
    p.vel = applyFriction(p.vel, T.slide.friction, dt);
    p.vel.y = Math.min(p.vel.y, 0);
  }

  // Steering curves the slide without letting you accelerate out of it.
  if (V.lenH(wish) > 1e-6) {
    const h = V.lenH(p.vel);
    const steered = V.norm(V.v3(
      p.vel.x + wish.x * T.slide.steerRate * h * dt,
      0,
      p.vel.z + wish.z * T.slide.steerRate * h * dt,
    ));
    p.vel.x = steered.x * h;
    p.vel.z = steered.z * h;
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
  p.dashCooldown = d(p.dashCooldown);
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
      case 'airborne': updateAirborne(p, i, wish, dt); break;
      case 'dashing': updateDashing(p, i, dt); break;
      case 'sliding': updateSliding(p, i, wish, dt); break;
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

  // Kill velocity into surfaces we actually hit, or we stick to walls.
  if (res.hitWall) p.vel = V.projectOnPlane(p.vel, res.wallNormal);
  if (res.grounded && p.vel.y < 0) p.vel.y = 0;

  // Ground state bookkeeping
  if (res.grounded && !wasGrounded) {
    p.jumpsLeft = T.jump.maxJumps;
    if (T.dash.refillOnGround) p.dashCharges = T.dash.maxCharges;
    if (p.state === 'airborne') {
      // Buffered slide on landing — lets you slide the instant you touch down.
      if (p.bufSlide > 0 && canSlide(p)) doSlide(p);
      else enter(p, 'grounded');
    }
  } else if (!res.grounded && wasGrounded) {
    p.coyoteJump = T.jump.coyoteTime;
    p.coyoteDash = T.dash.coyoteTime;
    if (p.state === 'grounded') enter(p, 'airborne');
    if (p.state === 'sliding' && !i.slide.held) endSlide(p);
  }

  // Facing chases movement direction; decoupled from the camera on purpose.
  const h = V.lenH(p.vel);
  if (h > 0.5) {
    const target = Math.atan2(p.vel.x, p.vel.z);
    p.facing += V.shortestAngle(p.facing, target) * (1 - Math.exp(-T.character.turnRate * dt));
  }
}
