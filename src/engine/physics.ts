// Rapier backend. Implements CollisionWorld and nothing more — this file is the
// swappable half of the port boundary described in DESIGN.md §2.

import RAPIER from '@dimforge/rapier3d-compat';
import { T } from '../core/tuning';
import * as V from '../core/vec';
import type { V3 } from '../core/vec';
import type { CollisionWorld, MoveResult, RayHit } from '../core/types';
import type { Brush } from '../levels/types';

export async function initPhysics() { await RAPIER.init(); }

/*
 * Collision groups. The point of them here is one guarantee: enemy bodies are
 * solid to the CHARACTER and invisible to the solver's raycasts.
 *
 * The solver rays the world constantly — clear air under a slam, a ledge to
 * vault, a wall to run, a cable's line of sight — and every one of those
 * questions is about the level. Let a robot answer them and standing next to
 * one silently changes how you move, which is the one thing that must not
 * happen. So the public ray/rayHit test LEVEL only, and the ground probe inside
 * move() is the single exception: it tests both, because standing on a robot's
 * head should ground you.
 *
 * Packed as (membership << 16) | filter. Two collide when each one's filter
 * includes the other's membership.
 */
const G_LEVEL = 0b0001;
const G_ENEMY = 0b0010;
const G_CHAR = 0b0100;
const G_RAY = 0b1000;

const groups = (membership: number, filter: number) => ((membership << 16) | filter) >>> 0;

/** A ray that sees the level and nothing else. */
const RAY_LEVEL = groups(G_RAY, G_LEVEL);
/** ...and one that also sees the robots, for the ground probe. */
const RAY_STAND = groups(G_RAY, G_LEVEL | G_ENEMY);

export class RapierWorld implements CollisionWorld {
  world: RAPIER.World;
  controller: RAPIER.KinematicCharacterController;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;

  private levelColliders: RAPIER.Collider[] = [];
  private enemyBodies: RAPIER.RigidBody[] = [];
  private enemyColliders: RAPIER.Collider[] = [];
  /** Shape of the current enemy colliders, so a slider change rebuilds them. */
  private enemyKey = '';

  constructor(brushes: Brush[], spawn: V3) {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 }); // gravity is the solver's job
    this.buildLevel(brushes);

    const halfHeight = (T.character.height - 2 * T.character.radius) / 2;
    this.body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
    );
    this.collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, T.character.radius)
        .setCollisionGroups(groups(G_CHAR, G_LEVEL | G_ENEMY)),
      this.body,
    );

    this.controller = this.world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.enableAutostep(T.character.stepHeight, T.character.radius * 0.5, true);
    this.controller.enableSnapToGround(T.character.snapToGround);
    this.controller.setMaxSlopeClimbAngle(T.character.maxSlopeAngle);
    this.controller.setMinSlopeSlideAngle(T.character.maxSlopeAngle);
    this.controller.setApplyImpulsesToDynamicBodies(false);
  }

  private buildLevel(brushes: Brush[]) {
    for (const b of brushes) {
      if (b.d) continue;                 // decor: visuals only, never a collider
      let d: RAPIER.ColliderDesc;
      if (b.kind === 'pyramid') {
        // Square pyramid = convex hull of the four base corners plus the apex.
        const [hx, hy, hz] = [b.s[0] / 2, b.s[1] / 2, b.s[2] / 2];
        const pts = new Float32Array([
          -hx, -hy, -hz, hx, -hy, -hz, hx, -hy, hz, -hx, -hy, hz, 0, hy, 0,
        ]);
        const hull = RAPIER.ColliderDesc.convexHull(pts);
        if (!hull) continue;
        d = hull;
      } else {
        d = RAPIER.ColliderDesc.cuboid(b.s[0] / 2, b.s[1] / 2, b.s[2] / 2);
      }
      d.setTranslation(b.p[0], b.p[1], b.p[2]);
      if (b.q) d.setRotation({ x: b.q[0], y: b.q[1], z: b.q[2], w: b.q[3] });
      else if (b.r) d.setRotation(euler(b.r[0], b.r[1], b.r[2]));
      d.setCollisionGroups(groups(G_LEVEL, G_CHAR | G_RAY));
      this.levelColliders.push(this.world.createCollider(d));
    }
  }

  /** Tear down and re-create the level colliders — the editor's exit path. */
  rebuildLevel(brushes: Brush[]) {
    for (const c of this.levelColliders) this.world.removeCollider(c, false);
    this.levelColliders = [];
    this.buildLevel(brushes);
  }

  /**
   * Living dummies, as things in the way. Called every frame with their feet
   * positions — they barely move, but the grapple hauls them, so a stale
   * collider would be an invisible wall where a robot used to be.
   *
   * A cylinder rather than a capsule: a rounded top is not a thing you can
   * stand on, and standing on them is most of what this is for.
   */
  syncEnemies(feet: { pos: { x: number; y: number; z: number } }[]) {
    const h = 1.8 * T.enemy.scale;
    const half = Math.max(0.05, h / 2);
    const radius = Math.max(0.05, T.enemy.colliderRadius * T.enemy.scale);
    const key = T.enemy.collide ? `${feet.length}|${half.toFixed(3)}|${radius.toFixed(3)}` : '';

    if (key !== this.enemyKey) {
      for (const c of this.enemyColliders) this.world.removeCollider(c, false);
      for (const b of this.enemyBodies) this.world.removeRigidBody(b);
      this.enemyColliders = [];
      this.enemyBodies = [];
      this.enemyKey = key;
      if (!key) return;
      for (const f of feet) {
        // Kinematic, not fixed: being moved is a first-class operation for a
        // body the meathook can drag across the map.
        const body = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.kinematicPositionBased()
            .setTranslation(f.pos.x, f.pos.y + half, f.pos.z),
        );
        this.enemyBodies.push(body);
        this.enemyColliders.push(this.world.createCollider(
          RAPIER.ColliderDesc.cylinder(half, radius)
            .setCollisionGroups(groups(G_ENEMY, G_CHAR | G_RAY)),
          body,
        ));
      }
      return;
    }
    if (!key) return;
    for (let i = 0; i < feet.length; i++) {
      this.enemyBodies[i].setNextKinematicTranslation(
        { x: feet[i].pos.x, y: feet[i].pos.y + half, z: feet[i].pos.z },
      );
    }
  }

  private carrierBodies: RAPIER.RigidBody[] = [];
  private carrierColliders: RAPIER.Collider[] = [];
  private carrierCount = -1;

  /**
   * The conveyor's cargo, as solid boxes that move.
   *
   * Kinematic for the same reason the dummies are: being moved every frame is
   * the whole point, and a fixed body cannot be. Rapier will not CARRY a
   * character standing on one of these — that is done in `carriers.ts`, by
   * adding the frame's motion to the rider — but it will stop them walking
   * through one, which is what a collider is for.
   */
  syncCarriers(boxes: { x: number; y: number; z: number; hw: number; hh: number; hl: number }[]) {
    if (boxes.length !== this.carrierCount) {
      for (const c of this.carrierColliders) this.world.removeCollider(c, false);
      for (const b of this.carrierBodies) this.world.removeRigidBody(b);
      this.carrierColliders = [];
      this.carrierBodies = [];
      this.carrierCount = boxes.length;
      for (const b of boxes) {
        const body = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(b.x, b.y, b.z),
        );
        this.carrierBodies.push(body);
        this.carrierColliders.push(this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(b.hw, b.hh, b.hl)
            .setCollisionGroups(groups(G_LEVEL, G_CHAR | G_RAY)),
          body,
        ));
      }
      return;
    }
    for (let i = 0; i < boxes.length; i++) {
      this.carrierBodies[i].setNextKinematicTranslation(boxes[i]);
    }
  }

  /** Tuning values that Rapier caches internally need re-pushing when sliders move. */
  syncTuning() {
    this.controller.setMaxSlopeClimbAngle(T.character.maxSlopeAngle);
    this.controller.setMinSlopeSlideAngle(T.character.maxSlopeAngle);
    this.controller.enableAutostep(T.character.stepHeight, T.character.radius * 0.5, true);
    this.controller.enableSnapToGround(T.character.snapToGround);
  }

  move(pos: V3, disp: V3): MoveResult {
    this.body.setTranslation(pos, true);
    this.controller.computeColliderMovement(this.collider, disp);
    const mv = this.controller.computedMovement();
    const next = V.v3(pos.x + mv.x, pos.y + mv.y, pos.z + mv.z);
    this.body.setTranslation(next, true);
    this.world.step();

    // Wall normals come from the controller, sign-corrected so they always oppose
    // the attempted motion. Rapier's normal orientation is not reliable enough to
    // trust raw when you need it for velocity projection.
    let hitWall = false;
    let wallNormal = V.v3();
    let groundNormal = V.v3(0, 1, 0);
    let walkable = false;
    let steepSupport = false;
    const cos = Math.cos(T.character.maxSlopeAngle);

    for (let k = 0; k < this.controller.numComputedCollisions(); k++) {
      const c = this.controller.computedCollision(k);
      if (!c) continue;
      let n = V.v3(c.normal1.x, c.normal1.y, c.normal1.z);
      if (V.dot(n, disp) > 0) n = V.scale(n, -1);
      if (n.y < cos) {
        hitWall = true;
        wallNormal = n;
        if (n.y > 0) steepSupport = true;   // sloped, but too steep to stand on
      } else {
        walkable = true;
        groundNormal = n;
      }
    }

    /*
     * Downward probe, sampled at the centre and four points around the capsule.
     *
     * A single centre ray is not enough: standing on a ledge edge it misses, and a
     * resting character produces NO contacts at all (zero displacement means the
     * controller computes no collisions), so there'd be nothing to judge by. The
     * ring gives positive evidence of real ground in both cases.
     */
    const reach = T.character.height * 0.5 + T.character.stepHeight + 0.25;
    const r = T.character.radius * 0.7;
    const samples: [number, number][] = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]];
    for (const [ox, oz] of samples) {
      // RAY_STAND, not the public rayHit: this is the one question where a
      // robot is a legitimate answer. Everything the solver asks is about the
      // level, and gets RAY_LEVEL.
      const hit = this.rayHit(
        V.v3(next.x + ox, next.y, next.z + oz), V.v3(0, -1, 0), reach, RAY_STAND,
      );
      if (!hit) continue;
      if (hit.normal.y >= cos) { walkable = true; groundNormal = hit.normal; break; }
      steepSupport = true;
    }

    /*
     * Rapier's computedGrounded() reports true against a steep bank — the slanted
     * arena walls register a resting contact under the capsule. Taken at face value
     * the solver treats you as standing, zeroes vertical velocity every tick, and you
     * hover against the wall forever instead of sliding off.
     *
     * Being grounded therefore requires positive evidence of a walkable surface, not
     * merely Rapier's say-so.
     */
    const grounded = this.controller.computedGrounded() && walkable;
    void steepSupport;

    return { pos: next, grounded, groundNormal, hitWall, wallNormal };
  }

  /** LEVEL only. Every question the solver asks about the world comes here. */
  ray(from: V3, dir: V3, maxDist: number): number | null {
    const hit = this.world.castRay(
      new RAPIER.Ray(from, dir), maxDist, true,
      undefined, RAY_LEVEL, this.collider,
    );
    return hit ? hit.timeOfImpact : null;
  }

  /**
   * As `ray`, with the surface normal. `filter` defaults to the level alone;
   * move()'s ground probe is the only caller that widens it to include robots.
   */
  rayHit(from: V3, dir: V3, maxDist: number, filter = RAY_LEVEL): RayHit | null {
    const hit = this.world.castRayAndGetNormal(
      new RAPIER.Ray(from, dir), maxDist, true,
      undefined, filter, this.collider,
    );
    if (!hit) return null;
    let n = V.v3(hit.normal.x, hit.normal.y, hit.normal.z);
    // Point the normal back at the ray origin, so callers get a consistent sign.
    if (V.dot(n, dir) > 0) n = V.scale(n, -1);
    return { dist: hit.timeOfImpact, normal: n };
  }

  private rayNormal(from: V3, dir: V3, maxDist: number): V3 | null {
    return this.rayHit(from, dir, maxDist)?.normal ?? null;
  }
}

/** XYZ euler (radians) to quaternion. */
function euler(x: number, y: number, z: number) {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  };
}
