// All projectiles in flight — the rifle's bullets, enemy shots, and reflected
// shots — stepped every frame with per-kind gravity drop. Collision is a segment
// raycast from the previous position, so fast bullets can't tunnel through a
// thin wall or a dummy's head between frames.

import * as THREE from 'three';
import { T } from '../core/tuning';
import type { Renderer } from './render';
import type { Enemies } from './enemies';
import type { V3 } from '../core/vec';

export type ProjKind = 'player' | 'enemy' | 'reflected';

/** Ballistics travel WITH the projectile, because the gun that fired it may be
 *  swapped away — or retuned — long before the round lands. */
export interface Ballistics {
  size: number;
  drop: number;
  range: number;
  damage: number;     // multiplier on the shared head/body damage
  pierce: number;     // targets this round passes through before it stops
}

interface Proj extends Ballistics {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  kind: ProjKind;
  owner: number;      // enemy index that fired it (-1 for the player's)
  travelled: number;
}

const COLORS: Record<ProjKind, number> = {
  player: 0xfff1b8,
  enemy: 0xf87171,
  reflected: 0x38bdf8,
};

export class Projectiles {
  private list: Proj[] = [];
  private ray = new THREE.Raycaster();
  private flashes: { mesh: THREE.Mesh; t: number }[] = [];
  private beams: {
    group: THREE.Group;
    mats: { mat: THREE.MeshBasicMaterial; opacity: number }[];
    t: number; life: number;
  }[] = [];

  constructor(
    private gfx: Renderer,
    private enemies: Enemies,
    private hooks: {
      /** Rifle/reflected shot connected with a dummy — drive the hitmarker. */
      onEnemyHit: (r: { killed: boolean; headshot: boolean }) => void;
      /** An enemy shot reached the player. */
      onPlayerHit: () => void;
    },
  ) {}

  spawn(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    kind: ProjKind,
    owner = -1,
    ballistics?: Partial<Ballistics>,
  ) {
    const b: Ballistics = {
      size: T.enemy.projSize,
      drop: kind === 'enemy' ? T.enemy.projDrop : 0,
      range: T.weapon.range,
      damage: 1,
      pierce: 0,
      ...ballistics,
    };
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(b.size, 8, 8),
      new THREE.MeshBasicMaterial({ color: COLORS[kind] }),
    );
    mesh.position.copy(pos);
    this.gfx.scene.add(mesh);
    this.list.push({ ...b, mesh, vel: vel.clone(), kind, owner, travelled: 0 });
  }

  /**
   * Instant-hit shot — the railgun. No travel, no drop, no lead: the ray is
   * resolved on the frame you click, which is the entire identity of the weapon.
   *
   * Piercing is a loop of casts rather than one, because a raycast only ever
   * reports the nearest hit. Each pass steps the origin just past the surface it
   * went through; without that nudge the next cast starts inside the same mesh
   * and hits it again forever. Walls always stop the shot regardless of pierce,
   * or the beam would go through the arena itself.
   *
   * Hits are reported through the same hook as projectiles, so hitmarkers and
   * kill feedback need to know nothing about how the shot travelled.
   */
  hitscan(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    o: { range: number; damage: number; pierce: number; beamTime: number },
  ) {
    let from = origin.clone();
    let remaining = o.range;
    let pierce = o.pierce;
    let end = origin.clone().addScaledVector(dir, o.range);

    // +1 because the shot gets one cast per target it pierces, plus the last one
    // that actually stops it.
    for (let pass = 0; pass <= o.pierce + 1; pass++) {
      if (remaining <= 0) break;
      this.ray.set(from, dir);
      this.ray.far = remaining;
      const targets = [...this.enemies.aliveMeshes, ...this.gfx.wallMeshes];
      const hit = this.ray.intersectObjects(targets, false)[0];
      if (!hit) break;

      this.impactFlash(hit.point);
      end = hit.point.clone();
      const onTarget = hit.object.userData.part !== undefined;
      if (onTarget) {
        this.hooks.onEnemyHit(this.enemies.hit(hit.object as THREE.Mesh, o.damage));
      }
      if (!onTarget || pierce <= 0) break;

      pierce--;
      const step = hit.distance + 0.05;
      remaining -= step;
      from = hit.point.clone().addScaledVector(dir, 0.05);
      // Still going: unless something else stops it, the beam runs out to range.
      end = from.clone().addScaledVector(dir, remaining);
    }

    this.tracer(origin, end, o.beamTime);
  }

  /** Sword parry: turn every enemy shot in `meshes` back on its owner. */
  reflect(p: Proj) {
    const speed = p.vel.length() * T.sword.reflectSpeed;
    const target = this.enemies.headPosition(p.owner) ?? p.mesh.position.clone().add(
      p.vel.clone().multiplyScalar(-1),
    );
    p.vel = target.sub(p.mesh.position).normalize().multiplyScalar(speed);
    p.kind = 'reflected';
    (p.mesh.material as THREE.MeshBasicMaterial).color.setHex(COLORS.reflected);
  }

  /** Enemy shots close enough to the player-facing arc for the sword to parry. */
  enemyShotsNear(from: THREE.Vector3, reach: number): Proj[] {
    return this.list.filter(
      (p) => p.kind === 'enemy' && p.mesh.position.distanceTo(from) <= reach,
    );
  }

  update(dt: number, playerPos: V3) {
    const playerCentre = new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z);

    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      // Reflected shots keep flying flat: a parry is a reward, not a lob.
      p.vel.y -= (p.kind === 'reflected' ? 0 : p.drop) * dt;

      const from = p.mesh.position.clone();
      const step = p.vel.clone().multiplyScalar(dt);
      const dist = step.length();
      p.travelled += dist;

      let dead = p.travelled > p.range;
      if (!dead && dist > 1e-6) {
        const dir = step.clone().normalize();
        this.ray.set(from, dir);
        this.ray.far = dist;
        // Player + reflected shots hurt dummies; enemy shots only care about walls.
        const targets = p.kind === 'enemy'
          ? this.gfx.wallMeshes
          : [...this.enemies.aliveMeshes, ...this.gfx.wallMeshes];
        const hit = this.ray.intersectObjects(targets, false)[0];
        if (hit) {
          this.impactFlash(hit.point);
          const onTarget = hit.object.userData.part !== undefined && p.kind !== 'enemy';
          if (onTarget) {
            this.hooks.onEnemyHit(this.enemies.hit(hit.object as THREE.Mesh, p.damage));
          }
          // A piercing round keeps going through TARGETS only — walls always stop
          // it, or the railgun would shoot through the arena itself.
          if (onTarget && p.pierce > 0) p.pierce--;
          else dead = true;
        }
      }

      // Enemy shots vs the player: a plain distance check against the capsule.
      if (!dead && p.kind === 'enemy') {
        const r = (p.size + T.character.radius);
        if (p.mesh.position.distanceTo(playerCentre) < r + 0.35) {
          this.hooks.onPlayerHit();
          this.impactFlash(p.mesh.position.clone());
          dead = true;
        }
      }

      if (dead) {
        this.despawn(i);
      } else {
        p.mesh.position.add(step);
      }
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t -= dt;
      if (f.t <= 0) {
        this.gfx.scene.remove(f.mesh);
        (f.mesh.material as THREE.Material).dispose();
        this.flashes.splice(i, 1);
      }
    }

    // Hitscan tracers: the only evidence a shot happened, so they fade rather
    // than blink out — you need long enough to see where the line went.
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.t -= dt;
      const f = Math.max(0, b.t / b.life);
      // Squared, so the flare is bright for most of its life and then goes
      // quickly. A linear fade on an additive beam reads as a slow smear.
      for (const { mat, opacity } of b.mats) mat.opacity = opacity * f * f;
      // And it thins as it dies, which is what sells it as discharging rather
      // than as a cylinder someone turned the alpha down on.
      b.group.scale.x = b.group.scale.y = 0.35 + 0.65 * f;
      if (b.t <= 0) {
        this.disposeBeam(i);
      }
    }
  }

  clear() {
    while (this.list.length) this.despawn(this.list.length - 1);
    while (this.beams.length) this.disposeBeam(this.beams.length - 1);
  }

  private disposeBeam(i: number) {
    const b = this.beams[i];
    this.gfx.scene.remove(b.group);
    for (const child of b.group.children) {
      (child as THREE.Mesh).geometry.dispose();
    }
    for (const { mat } of b.mats) mat.dispose();
    this.beams.splice(i, 1);
  }

  private despawn(i: number) {
    const p = this.list[i];
    this.gfx.scene.remove(p.mesh);
    p.mesh.geometry.dispose();
    (p.mesh.material as THREE.Material).dispose();
    this.list.splice(i, 1);
  }

  /**
   * The visible line a hitscan shot leaves behind, faded out by update().
   *
   * Real geometry, not a THREE.Line: `linewidth` on a LineBasicMaterial is
   * ignored by every WebGL renderer, so a line is one pixel wide forever and the
   * railgun — the weapon whose whole identity is that it already hit — left the
   * faintest mark on the screen of anything in the game.
   *
   * Three nested cylinders, all additive: a white-hot core, the blue beam
   * proper, and a wide soft halo. Additive is what makes it read as light rather
   * than as a painted tube, and stacking three means the middle blows out to
   * white on its own instead of being coloured that way.
   */
  private tracer(from: THREE.Vector3, to: THREE.Vector3, life: number) {
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 1e-4) return;

    const group = new THREE.Group();
    const mats: { mat: THREE.MeshBasicMaterial; opacity: number }[] = [];
    const r = T.railgun.beamWidth;
    for (const [color, opacity, scale] of [
      [0x38bdf8, 0.16, T.railgun.beamGlow],   // halo
      [0x7dd3fc, 0.55, 1.0],                  // the beam
      [0xffffff, 0.95, 0.34],                 // core
    ] as const) {
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, depthWrite: false, depthTest: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      // Along +Y, then the whole group is rotated onto the shot below.
      const geo = new THREE.CylinderGeometry(r * scale, r * scale, len, 10, 1, true);
      geo.translate(0, len / 2, 0);
      group.add(new THREE.Mesh(geo, mat));
      mats.push({ mat, opacity });
    }
    group.position.copy(from);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    group.renderOrder = 5;
    this.gfx.scene.add(group);
    this.beams.push({ group, mats, t: life, life: Math.max(life, 1e-3) });
  }

  private impactFlash(at: THREE.Vector3) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xfff1b8 }),
    );
    m.position.copy(at);
    this.gfx.scene.add(m);
    this.flashes.push({ mesh: m, t: 0.08 });
  }
}
