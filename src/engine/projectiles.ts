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
          ? this.gfx.brushMeshes
          : [...this.enemies.aliveMeshes, ...this.gfx.brushMeshes];
        const hit = this.ray.intersectObjects(targets, false)[0];
        if (hit) {
          this.impactFlash(hit.point);
          if (hit.object.userData.part !== undefined && p.kind !== 'enemy') {
            this.hooks.onEnemyHit(this.enemies.hit(hit.object as THREE.Mesh, p.damage));
          }
          dead = true;
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
  }

  clear() {
    while (this.list.length) this.despawn(this.list.length - 1);
  }

  private despawn(i: number) {
    const p = this.list[i];
    this.gfx.scene.remove(p.mesh);
    p.mesh.geometry.dispose();
    (p.mesh.material as THREE.Material).dispose();
    this.list.splice(i, 1);
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
