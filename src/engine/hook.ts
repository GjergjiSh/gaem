// The engine-side half of the grapple (middle mouse). The solver owns the part
// that moves the PLAYER — rope constraint, reeling, swinging — because that is
// movement and movement lives in core/. This file owns the two things the solver
// is not allowed to know about:
//
//   1. Dummies. Fire at one and mass decides who moves: the arena doesn't budge,
//      a body does, so the same button that pulls you to a wall pulls a target to
//      you. That test has to happen out here, because core/ must never learn that
//      enemies exist (DESIGN rule 1).
//   2. The cables themselves, which are three.js objects.
//
// The enemy test gets first refusal on the press and CONSUMES it when it hits, so
// the solver never sees that click and never attaches to the wall behind them.

import * as THREE from 'three';
import { T } from '../core/tuning';
import type { Renderer } from './render';
import type { Input } from './input';
import type { Enemies } from './enemies';
import { attachGrappleTo, moveGrappleAnchor, releaseGrapple } from '../core/solver';
import type { CollisionWorld, Player } from '../core/types';

/** Seconds the rope takes to whip out. Visual only — the hook bit on the press. */
const WHIP = 0.07;

interface Haul {
  idx: number;
  t: number;            // seconds spent hauling
  speed: number;        // ramps toward T.grapple.hookSpeed
  /** true = the BODY is being dragged (pullTarget); false = the player is. */
  dragging: boolean;
  /** pullTarget only: the body's position along its path, WITHOUT the arc lift.
   *  Keeping this separate is the whole fix for the launch bug — see stepDrag. */
  base: THREE.Vector3;
}

export class Hook {
  private haul: Haul | null = null;
  /** One per launcher: index 0 is the left hip, 1 the right. */
  private ropes: THREE.Mesh[] = [];
  private tips: THREE.Mesh[] = [];
  private ropeT = 0;    // shared whip-out progress — both cables fire together

  constructor(
    private input: Input,
    private gfx: Renderer,
    private enemies: Enemies,
    private world: CollisionWorld,
    private onHit: (r: { killed: boolean; headshot: boolean }) => void,
  ) {
    // A cylinder rather than a THREE.Line: line width is stuck at one pixel in
    // WebGL, and a one-pixel cable reads as a scratch on the screen at the speeds
    // this thing moves you.
    for (let k = 0; k < 2; k++) {
      const rope = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, 1, 6, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.9 }),
      );
      rope.visible = false;
      this.gfx.scene.add(rope);
      this.ropes.push(rope);

      const tip = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.22),
        new THREE.MeshBasicMaterial({ color: 0xbfe9ff }),
      );
      tip.visible = false;
      this.gfx.scene.add(tip);
      this.tips.push(tip);
    }
  }

  get hauling() { return this.haul !== null; }

  /** Restart: drop whatever we were dragging. */
  clear() {
    this.haul = null;
    this.ropeT = 0;
  }

  /**
   * Called once per frame BEFORE the fixed steps, so the decision lands on the
   * same click the solver would otherwise act on. Returns having either taken the
   * press (a dummy was hit) or left it alone (the solver attaches as normal).
   */
  preStep(player: Player) {
    if (!T.grapple.enabled) return;
    if (!this.input.intent.grapple.pressed) return;
    // Already on the rope? The press means "let go", which is the solver's call.
    if (player.grappling) return;
    if (this.haul) return;

    const from = new THREE.Vector3(player.pos.x, player.pos.y + T.grapple.eyeOffset, player.pos.z);
    const cp = Math.cos(this.input.intent.pitch);
    const dir = new THREE.Vector3(
      -Math.sin(this.input.intent.yaw) * cp,
      Math.sin(this.input.intent.pitch),
      -Math.cos(this.input.intent.yaw) * cp,
    );

    const target = this.enemies.hookScan(from, dir, T.grapple.range);
    if (!target) return;
    // A dummy standing in front of a wall is the target; one standing behind it
    // is not. Whichever surface the ray reaches first wins the hook.
    const wall = this.world.ray(
      { x: from.x, y: from.y, z: from.z },
      { x: dir.x, y: dir.y, z: dir.z },
      T.grapple.range,
    );
    if (wall !== null && wall < target.dist) return;

    // Taken: the solver must not also attach to whatever is behind them.
    this.input.intent.grapple.pressed = false;
    this.ropeT = 0;
    this.enemies.stagger(target.idx, T.grapple.pullStagger);

    const body = this.enemies.positionOf(target.idx) ?? target.point;
    this.haul = {
      idx: target.idx,
      t: 0,
      speed: 0,
      dragging: T.grapple.pullTarget,
      base: body.clone(),
    };
    // The meathook is the ordinary rope with the body as its anchor and the reel
    // held down — no second movement implementation, and it swings, collides and
    // chains exactly like a rope tied to the arena.
    if (!this.haul.dragging) attachGrappleTo(player, this.chestOf(target.idx), true);
  }

  /** Advance the haul and draw whichever rope is live. */
  update(dt: number, player: Player) {
    this.stepHaul(dt, player);
    this.drawRope(dt, player);
  }

  private stepHaul(dt: number, player: Player) {
    const h = this.haul;
    if (!h) return;
    const g = T.grapple;

    // Let go if they died on the way in, if the button came up, or if the safety
    // timer ran out — a hook stuck on something must not hold on forever.
    h.t += dt;
    const done = !this.enemies.alive(h.idx) || h.t > g.hookTime
      || (!g.toggle && !this.input.intent.grapple.held);
    if (done) return this.endHaul(player, h, false);

    if (h.dragging) this.stepDrag(dt, player, h);
    else this.stepMeathook(player, h);
  }

  /** Doom's meathook: the body is the anchor and you are the thing that moves. */
  private stepMeathook(player: Player, h: Haul) {
    const chest = this.chestOf(h.idx);
    // Follow the body — a corpse tipping over shouldn't drag the anchor with it,
    // but a target that ever moves should take the rope with it.
    moveGrappleAnchor(player, { x: chest.x, y: chest.y, z: chest.z });

    const gap = Math.hypot(
      chest.x - player.pos.x, chest.y - player.pos.y, chest.z - player.pos.z,
    );
    // The solver would let go at minLen; we get there first, at sword range.
    if (gap <= T.grapple.hookStop) this.endHaul(player, h, true);
    else if (!player.grappling) this.endHaul(player, h, false);
  }

  /**
   * pullTarget: the body is hauled to you instead.
   *
   * `base` is the body's position along its path and the lift is added to a COPY
   * of it. The first version added the lift to the stored position, so every
   * frame re-lifted an already-lifted body and it climbed out of the level —
   * an offset applied as though it were an increment.
   */
  private stepDrag(dt: number, player: Player, h: Haul) {
    const g = T.grapple;
    const me = new THREE.Vector3(player.pos.x, player.pos.y, player.pos.z);
    const flat = new THREE.Vector3(h.base.x - me.x, 0, h.base.z - me.z);
    const gap = flat.length();
    if (gap < 1e-3) return this.endHaul(player, h, true);

    // Aim for a spot in front of the player, not the player, so the body is
    // delivered at sword range instead of inside you.
    const drop = me.clone().addScaledVector(flat.divideScalar(gap), g.hookStop);
    drop.y = this.footY(player);
    if (gap <= g.hookStop + 0.15) return this.endHaul(player, h, true);

    // Ramp rather than snap to top speed: the weight of the thing is the ramp.
    h.speed = Math.min(g.hookSpeed, h.speed + g.hookAccel * dt);
    const left = h.base.distanceTo(drop);
    h.base.lerp(drop, Math.min(1, (h.speed * dt) / Math.max(1e-6, left)));

    // Ride above the line on the way in — dragged along the floor reads as a bug,
    // yanked off its feet reads as a hook. Applied to a copy, never stored.
    const arc = Math.sin(Math.PI * Math.min(1, h.t * 2)) * g.pullLift;
    this.enemies.dragTo(h.idx, h.base.clone().setY(h.base.y + arc));
  }

  /**
   * End a haul from any cause. A dragged body is always set back down on the way
   * out — without this a released or timed-out haul leaves it hanging in the air,
   * because dummies have no gravity of their own to bring them back.
   */
  private endHaul(player: Player, h: Haul, arrived: boolean) {
    if (h.dragging) {
      this.enemies.dragTo(h.idx, h.base.clone().setY(this.footY(player)));
    } else if (player.grappling) {
      // Arriving at 46 u/s and sailing straight past the thing you hooked is not
      // a meathook, so an arrival brakes into melee range. Letting go EARLY is a
      // different move — that is a launch, and it keeps everything it earned.
      releaseGrapple(player, !arrived);
      if (arrived) {
        player.vel.x *= T.grapple.hookBrake;
        player.vel.y *= T.grapple.hookBrake;
        player.vel.z *= T.grapple.hookBrake;
      }
    }
    if (arrived && this.enemies.alive(h.idx)) {
      if (T.grapple.pullDamage > 0) {
        this.onHit(this.enemies.damage(h.idx, T.grapple.pullDamage));
      }
      this.enemies.stagger(h.idx, T.grapple.pullStagger);
    }
    this.haul = null;
  }

  /** Ground level under the player — where a hauled body gets set down. */
  private footY(player: Player) {
    return player.pos.y - T.character.height / 2 + T.character.radius;
  }

  /** Chest height on a dummy: what the hook bites, and the rope's anchor. */
  private chestOf(idx: number): THREE.Vector3 {
    const at = this.enemies.positionOf(idx) ?? new THREE.Vector3();
    at.y += 1.05 * T.enemy.scale;
    return at;
  }

  /**
   * Draw the gear. Two cables, one per hip, each to its own anchor — that splay
   * from the body out to two separate bites is the whole silhouette of the thing.
   *
   * Both jobs share the meshes, because they are mutually exclusive: a press that
   * grabs a body never reaches the solver, so you are never hauling and swinging
   * at the same time. On a haul both cables bury themselves in the same target.
   */
  private drawRope(dt: number, player: Player) {
    const hauled = this.haul ? this.chestOf(this.haul.idx) : null;
    const live = hauled !== null || player.grappling;
    if (!live) {
      for (const r of this.ropes) r.visible = false;
      for (const t of this.tips) t.visible = false;
      this.ropeT = 0;
      return;
    }
    this.ropeT = Math.min(WHIP, this.ropeT + dt);
    const whip = Math.min(1, this.ropeT / WHIP);

    for (let k = 0; k < this.ropes.length; k++) {
      const rope = this.ropes[k];
      const tip = this.tips[k];
      const cable = player.cables[k];
      const anchor = hauled ?? (cable?.on
        ? new THREE.Vector3(cable.anchor.x, cable.anchor.y, cable.anchor.z)
        : null);
      if (!anchor) { rope.visible = false; tip.visible = false; continue; }

      const from = this.hipPosition(player, k === 0 ? -1 : 1);
      const end = from.clone().lerp(anchor, whip);
      tip.position.copy(anchor);
      tip.rotation.y += 0.08;
      tip.visible = whip >= 1;

      const span = end.clone().sub(from);
      const len = span.length();
      if (len < 1e-4) { rope.visible = false; continue; }
      rope.visible = true;
      rope.position.copy(from).addScaledVector(span, 0.5);
      // The cylinder is built along +Y; aim it down the cable.
      rope.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0), span.clone().divideScalar(len),
      );
      // Thicker and hotter under load, so a pull is something you can see on the
      // cable rather than something you infer from the world moving.
      const loaded = this.haul !== null || player.grappleReel > 0;
      const thick = loaded ? 0.05 : 0.032;
      rope.scale.set(thick, len, thick);
      (rope.material as THREE.MeshBasicMaterial).color.setHex(
        this.haul ? 0xf87171 : player.grappleReel > 0 ? 0xfde047
          : player.grappleReel < 0 ? 0x94a3b8 : 0x7dd3fc,
      );
    }
  }

  /**
   * Where a cable leaves you: the hip launchers, offset left and right. In first
   * person they hang off the camera, since that is where your body is; in third
   * they ride the character's own sides.
   */
  private hipPosition(player: Player, side: -1 | 1): THREE.Vector3 {
    const cam = this.gfx.camera;
    if (T.camera.firstPerson) {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      const down = new THREE.Vector3(0, -1, 0).applyQuaternion(cam.quaternion);
      const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      return cam.position.clone()
        .addScaledVector(right, side * 0.34)
        .addScaledVector(down, 0.3)
        .addScaledVector(ahead, 0.2);
    }
    const right = new THREE.Vector3(Math.cos(player.facing), 0, -Math.sin(player.facing));
    return new THREE.Vector3(player.pos.x, player.pos.y + 0.1, player.pos.z)
      .addScaledVector(right, side * 0.38);
  }
}
