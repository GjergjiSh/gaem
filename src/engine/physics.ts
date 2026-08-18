// Rapier backend. Implements CollisionWorld and nothing more — this file is the
// swappable half of the port boundary described in DESIGN.md §2.

import RAPIER from '@dimforge/rapier3d-compat';
import { T } from '../core/tuning';
import * as V from '../core/vec';
import type { V3 } from '../core/vec';
import type { CollisionWorld, MoveResult } from '../core/types';
import type { Brush } from '../levels/course01';

export async function initPhysics() { await RAPIER.init(); }

export class RapierWorld implements CollisionWorld {
  world: RAPIER.World;
  controller: RAPIER.KinematicCharacterController;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;

  constructor(brushes: Brush[], spawn: V3) {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 }); // gravity is the solver's job

    for (const b of brushes) {
      const d = RAPIER.ColliderDesc.cuboid(b.s[0] / 2, b.s[1] / 2, b.s[2] / 2)
        .setTranslation(b.p[0], b.p[1], b.p[2]);
      if (b.r) {
        const q = euler(b.r[0], b.r[1], b.r[2]);
        d.setRotation(q);
      }
      this.world.createCollider(d);
    }

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

    const grounded = this.controller.computedGrounded();

    // Wall normals come from the controller, sign-corrected so they always oppose
    // the attempted motion. Rapier's normal orientation is not reliable enough to
    // trust raw when you need it for velocity projection.
    let hitWall = false;
    let wallNormal = V.v3();
    const cos = Math.cos(T.character.maxSlopeAngle);
    for (let k = 0; k < this.controller.numComputedCollisions(); k++) {
      const c = this.controller.computedCollision(k);
      if (!c) continue;
      let n = V.v3(c.normal1.x, c.normal1.y, c.normal1.z);
      if (V.dot(n, disp) > 0) n = V.scale(n, -1);
      if (n.y < cos) { hitWall = true; wallNormal = n; }
    }

    // Ground normal from an explicit downward probe — deterministic sign, unlike
    // fishing it out of the contact set.
    let groundNormal = V.v3(0, 1, 0);
    if (grounded) {
      const n = this.rayNormal(next, V.v3(0, -1, 0), T.character.height);
      if (n && n.y > 0) groundNormal = n;
    }

    return { pos: next, grounded, groundNormal, hitWall, wallNormal };
  }

  ray(from: V3, dir: V3, maxDist: number): number | null {
    const hit = this.world.castRay(
      new RAPIER.Ray(from, dir), maxDist, true,
      undefined, undefined, this.collider,
    );
    return hit ? hit.timeOfImpact : null;
  }

  private rayNormal(from: V3, dir: V3, maxDist: number): V3 | null {
    const hit = this.world.castRayAndGetNormal(
      new RAPIER.Ray(from, dir), maxDist, true,
      undefined, undefined, this.collider,
    );
    return hit ? V.v3(hit.normal.x, hit.normal.y, hit.normal.z) : null;
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
