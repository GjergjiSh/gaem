// Rapier backend. Implements CollisionWorld and nothing more — this file is the
// swappable half of the port boundary described in DESIGN.md §2.

import RAPIER from '@dimforge/rapier3d-compat';
import { T } from '../core/tuning';
import * as V from '../core/vec';
import type { V3 } from '../core/vec';
import type { CollisionWorld, MoveResult, RayHit } from '../core/types';
import type { Brush } from '../levels/types';

export async function initPhysics() { await RAPIER.init(); }

export class RapierWorld implements CollisionWorld {
  world: RAPIER.World;
  controller: RAPIER.KinematicCharacterController;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;

  private levelColliders: RAPIER.Collider[] = [];

  constructor(brushes: Brush[], spawn: V3) {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 }); // gravity is the solver's job
    this.buildLevel(brushes);

    const halfHeight = (T.character.height - 2 * T.character.radius) / 2;
    this.body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
    );
    this.collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, T.character.radius),
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
      this.levelColliders.push(this.world.createCollider(d));
    }
  }

  /** Tear down and re-create the level colliders — the editor's exit path. */
  rebuildLevel(brushes: Brush[]) {
    for (const c of this.levelColliders) this.world.removeCollider(c, false);
    this.levelColliders = [];
    this.buildLevel(brushes);
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
      const hit = this.rayHit(
        V.v3(next.x + ox, next.y, next.z + oz), V.v3(0, -1, 0), reach,
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

  ray(from: V3, dir: V3, maxDist: number): number | null {
    const hit = this.world.castRay(
      new RAPIER.Ray(from, dir), maxDist, true,
      undefined, undefined, this.collider,
    );
    return hit ? hit.timeOfImpact : null;
  }

  rayHit(from: V3, dir: V3, maxDist: number): RayHit | null {
    const hit = this.world.castRayAndGetNormal(
      new RAPIER.Ray(from, dir), maxDist, true,
      undefined, undefined, this.collider,
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
