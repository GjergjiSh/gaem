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

/** Shared world up, for building a frame around a direction. */
const UP = new THREE.Vector3(0, 1, 0);

/** Ballistics travel WITH the projectile, because the gun that fired it may be
 *  swapped away — or retuned — long before the round lands. */
export interface Ballistics {
  size: number;
  drop: number;
  range: number;
  damage: number;     // multiplier on the shared head/body damage
  pierce: number;     // targets this round passes through before it stops
  /** Body colour. Rockets and missiles want to read differently in flight. */
  color: number;
  /** Lateral acceleration, metres/s^2. The erratic in an erratic missile. */
  wander: number;
  /** How often the wander picks a new direction, per second. */
  wanderFreq: number;
  /**
   * Seconds of straight flight before the wander reaches full strength.
   *
   * Without it a missile is swerving metres off course while it is still beside
   * your shoulder, so a salvo fired while standing on a platform sticks to the
   * platform. Boosting straight and then manoeuvring is also what a missile
   * actually does.
   */
  wanderRamp: number;
  /**
   * How hard it steers toward `seek`, as a turn rate. 0 = drunk.
   *
   * It steers toward a POINT and not toward a direction, and that distinction
   * is the whole reason the weapon works. Correcting the heading fixes which
   * way a missile is pointing and never fixes where it is, so every metre of
   * swerve becomes permanent and a salvo walks further off with range —
   * measured, 15 m off the line at 60 m. Seeking a point closes the loop: the
   * missile wanders off and then has to come back.
   */
  homing: number;
  /** The world point `homing` steers toward. Null = fly the launch direction. */
  seek: THREE.Vector3 | null;
  /**
   * Seconds it clings to whatever it touched before detonating. 0 = goes off on
   * contact. Above 0 the round stops dead, sticks — following the target if the
   * target moves — and burns down a fuse in plain sight.
   */
  stick: number;
  blastRadius: number;
  /** Damage at the centre of the blast, falling off linearly to zero at the edge. */
  blastDamage: number;
}

interface Proj extends Ballistics {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  kind: ProjKind;
  owner: number;      // enemy index that fired it (-1 for the player's)
  travelled: number;
  age: number;
  /** Randomises each missile's wander so a burst does not move as one object. */
  phase: number;
  /** Per-missile frequency multiplier, for the same reason as `phase`. */
  spin: number;
  /** Fuse left once stuck. Undefined while still in flight. */
  fuse?: number;
  /** What it stuck to, and where on that thing, in the target's own frame. */
  stuckTo?: THREE.Object3D;
  stuckAt?: THREE.Vector3;
}

const COLORS: Record<ProjKind, number> = {
  player: 0xfff1b8,
  enemy: 0xf87171,
  reflected: 0x38bdf8,
};

const WHITE = new THREE.Color(0xffffff);

/** Additive, depth-write-off material for anything that should read as light. */
function glowMaterial(color: number, opacity: number) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export class Projectiles {
  private list: Proj[] = [];
  private ray = new THREE.Raycaster();
  private flashes: { mesh: THREE.Mesh; t: number }[] = [];
  /** Flame puffs and blast spheres: grow, fade, die. Same update, same list. */
  private puffs: {
    mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial;
    vel: THREE.Vector3; grow: number; t: number; life: number;
    /** Colour at birth and at death — flame cools from white through to smoke. */
    hot: THREE.Color; cool: THREE.Color;
  }[] = [];
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
      color: COLORS[kind],
      wander: 0,
      wanderFreq: 0,
      wanderRamp: 0,
      homing: 0,
      seek: null,
      stick: 0,
      blastRadius: 0,
      blastDamage: 0,
      ...ballistics,
    };
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(b.size, 8, 8),
      new THREE.MeshBasicMaterial({ color: b.color }),
    );
    mesh.position.copy(pos);
    this.gfx.scene.add(mesh);
    this.list.push({
      ...b, mesh, vel: vel.clone(), kind, owner, travelled: 0, age: 0,
      phase: Math.random() * Math.PI * 2, spin: 0.7 + Math.random() * 0.6,
    });
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

  /**
   * What the crosshair is actually on, for weapons that need a target POINT
   * rather than a direction. Falls back to `fallback` metres down the line when
   * the shot would hit nothing, so aiming at the sky still sends the salvo
   * somewhere definite instead of nowhere.
   */
  aimPoint(from: THREE.Vector3, dir: THREE.Vector3, fallback: number): THREE.Vector3 {
    this.ray.set(from, dir);
    this.ray.far = T.weapon.range;
    const hit = this.ray.intersectObjects(
      [...this.enemies.aliveMeshes, ...this.gfx.wallMeshes], false,
    )[0];
    return hit ? hit.point.clone() : from.clone().addScaledVector(dir, fallback);
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
      p.age += dt;

      // Stuck and burning down. It rides whatever it landed on rather than
      // hanging in the air where the target used to be, then goes off.
      if (p.fuse !== undefined) {
        if (p.stuckTo && p.stuckAt) {
          if (p.stuckTo.parent) {
            p.mesh.position.copy(p.stuckAt).applyMatrix4(p.stuckTo.matrixWorld);
          } else {
            // Whatever it was attached to has been removed — a dummy that died
            // to something else. Stay where it was rather than snapping to the
            // origin, which is where a stale matrix would put it.
            p.stuckTo = undefined;
          }
        }
        // A visible tell that the fuse is running: it pulses harder as it ends.
        const left = Math.max(0, p.fuse / Math.max(p.stick, 1e-3));
        p.mesh.scale.setScalar(1 + 0.5 * Math.sin(p.age * (14 + 26 * (1 - left))));
        (p.mesh.material as THREE.MeshBasicMaterial).color.lerpColors(
          WHITE, new THREE.Color(p.color), left,
        );
        p.fuse -= dt;
        if (p.fuse <= 0) {
          this.detonate(p);
          this.despawn(i);
        }
        continue;
      }

      // Erratic flight: a corkscrew off the current heading, plus a pull back
      // toward the point this missile was sent to. The two together are the
      // weapon — the weave is what makes a burst paint an area instead of
      // drawing a line, and the seek is what keeps it an area around the thing
      // you aimed at.
      //
      // The swerve a sinusoid buys is amplitude = wander / omega^2, so the
      // frequency is quadratically expensive: at 7 Hz, 26 m/s^2 moves a missile
      // about a centimetre. Metres of weave need a low frequency and a big
      // number, which is why the defaults look violent.
      if (p.wander > 0) {
        const dir = p.vel.clone().normalize();
        const side = new THREE.Vector3().crossVectors(dir, UP);
        if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
        side.normalize();
        const lift = new THREE.Vector3().crossVectors(side, dir).normalize();
        const w = p.age * p.wanderFreq * p.spin * Math.PI * 2 + p.phase;
        const armed = p.wanderRamp > 0 ? Math.min(1, p.age / p.wanderRamp) : 1;
        const a = p.wander * armed * armed;   // eased in, so there is no kink
        p.vel.addScaledVector(side, Math.cos(w) * a * dt);
        p.vel.addScaledVector(lift, Math.sin(w * 1.37 + p.phase) * a * dt);
      }
      if (p.homing > 0 && p.seek) {
        // A turn rate, not a throttle: the speed is put back afterwards, so
        // homing changes where it is going and never how fast.
        const speed = p.vel.length();
        const want = p.seek.clone().sub(p.mesh.position);
        if (want.lengthSq() > 1e-6) {
          p.vel.addScaledVector(want.normalize(), speed * p.homing * dt);
          p.vel.setLength(speed);
        }
      }

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
          const onTarget = hit.object.userData.part !== undefined && p.kind !== 'enemy';

          // Sticky: stop dead on whatever it touched, remember where on that
          // thing it landed, and start the fuse. Nothing else happens yet — the
          // damage is the blast, and the blast has not gone off.
          if (p.stick > 0) {
            p.mesh.position.copy(hit.point).addScaledVector(dir, -p.size * 0.5);
            p.vel.set(0, 0, 0);
            p.fuse = p.stick;
            if (onTarget) {
              hit.object.updateMatrixWorld();
              p.stuckTo = hit.object;
              p.stuckAt = hit.object.worldToLocal(p.mesh.position.clone());
              // The thump of it landing on you, separate from the blast. It is
              // also the hitmarker for the stick, so a salvo that connects reads
              // as connected during the fuse rather than only when it goes off.
              this.hooks.onEnemyHit(this.enemies.hit(hit.object as THREE.Mesh, p.damage));
            }
            continue;
          }

          this.impactFlash(hit.point);
          if (onTarget) {
            this.hooks.onEnemyHit(this.enemies.hit(hit.object as THREE.Mesh, p.damage));
          }
          if (p.blastRadius > 0) {
            p.mesh.position.copy(hit.point);
            this.detonate(p);
            dead = true;
          } else if (onTarget && p.pierce > 0) {
            // A piercing round keeps going through TARGETS only — walls always
            // stop it, or the railgun would shoot through the arena itself.
            p.pierce--;
          } else {
            dead = true;
          }
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

    // Flame puffs and blast spheres. They grow, cool and fade on one curve, so
    // a jet of fire and a fireball are the same few lines of code.
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const q = this.puffs[i];
      q.t -= dt;
      if (q.t <= 0) {
        this.gfx.scene.remove(q.mesh);
        q.mesh.geometry.dispose();
        q.mat.dispose();
        this.puffs.splice(i, 1);
        continue;
      }
      const age = 1 - q.t / q.life;
      q.mesh.position.addScaledVector(q.vel, dt);
      q.vel.multiplyScalar(1 - 2.2 * dt);       // drag, so it billows and stalls
      q.vel.y += 3.0 * dt;                      // and then rises, being fire
      q.mesh.scale.setScalar(1 + q.grow * age);
      q.mat.color.lerpColors(q.hot, q.cool, age);
      // Fading from the first frame rather than holding and then dropping:
      // flame has no edge in time any more than it has one in space.
      q.mat.opacity = 0.85 * (1 - age) * (1 - age);
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

  /**
   * The flamethrower. Not a projectile: a cone test every tick, plus puffs that
   * are pure decoration. Modelling fire as hundreds of tiny rounds would make
   * the damage depend on the frame rate and the hit rate depend on luck, and
   * neither is a thing to build a weapon on.
   *
   * A target has to be inside the cone AND in line of sight. The angle alone
   * would let you burn people through walls.
   */
  flame(origin: THREE.Vector3, dir: THREE.Vector3, o: {
    range: number; cone: number; damage: number; puffs: number;
    puffLife: number; puffSpeed: number; puffSize: number; puffGrow: number;
  }) {
    const side = new THREE.Vector3().crossVectors(dir, UP);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const lift = new THREE.Vector3().crossVectors(side, dir).normalize();

    // One entry per DUMMY, not per body part: aliveMeshes would find the same
    // target five times and burn it five times over.
    for (const t of this.enemies.aliveTargets()) {
      const to = t.pos.clone().sub(origin);
      const dist = to.length();
      if (dist > o.range || dist < 1e-3) continue;
      to.divideScalar(dist);
      // The cone widens with distance in world terms, but the test is on angle,
      // which is the same shape and cheaper than building a frustum.
      if (to.dot(dir) < Math.cos(o.cone)) continue;
      this.ray.set(origin, to);
      this.ray.far = dist - 0.2;
      if (this.ray.intersectObjects(this.gfx.wallMeshes, false).length) continue;
      // Body damage flat. Fire has no head to find, and routing it through a
      // part would let a cone score headshots on whichever limb it happened to
      // pick out of the list.
      this.hooks.onEnemyHit(this.enemies.damage(t.idx, T.weapon.bodyDamage * o.damage));
    }

    for (let i = 0; i < o.puffs; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * o.cone;
      const jitter = dir.clone()
        .addScaledVector(side, Math.cos(a) * r)
        .addScaledVector(lift, Math.sin(a) * r)
        .normalize();
      this.puff(
        origin.clone().addScaledVector(dir, 0.4 + Math.random() * 0.6),
        jitter.multiplyScalar(o.puffSpeed * (0.7 + Math.random() * 0.6)),
        o.puffSize, o.puffGrow, o.puffLife * (0.7 + Math.random() * 0.6),
        0xfff0c0, 0x912a05,
      );
    }
  }

  /**
   * Blast damage, falling off linearly to nothing at the edge. Line of sight is
   * checked from the blast out to each target, so a wall between the two is
   * cover — without it the rocket becomes a weapon that kills through the level.
   */
  private detonate(p: Proj) {
    const at = p.mesh.position.clone();
    if (p.blastRadius > 0 && p.blastDamage > 0) {
      for (const t of this.enemies.aliveTargets()) {
        const to = t.pos.clone().sub(at);
        const dist = to.length();
        if (dist > p.blastRadius) continue;
        if (dist > 0.3) {
          this.ray.set(at, to.clone().divideScalar(dist));
          this.ray.far = dist - 0.2;
          if (this.ray.intersectObjects(this.gfx.wallMeshes, false).length) continue;
        }
        // Linear falloff, body damage. A blast does not find heads.
        this.hooks.onEnemyHit(this.enemies.damage(
          t.idx, T.weapon.bodyDamage * p.blastDamage * (1 - dist / p.blastRadius),
        ));
      }
    }

    // The fireball: a white core that dies fast, a slower cooling ball behind
    // it, and debris thrown outward. Sized off the real blast radius, so what
    // you see is what actually reached.
    const R = Math.max(p.blastRadius, 0.6);
    this.puff(at.clone(), new THREE.Vector3(), R * 0.34, 2.6, 0.22, 0xffffff, 0xffb03a);
    this.puff(at.clone(), new THREE.Vector3(), R * 0.5, 1.7, 0.55, 0xffa53a, 0x2a1208);
    for (let i = 0; i < 8; i++) {
      const fly = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .normalize().multiplyScalar(R * (1.5 + Math.random() * 2));
      this.puff(at.clone(), fly, R * 0.17, 2.2, 0.4 + Math.random() * 0.3, 0xffd08a, 0x3a1a0a);
    }
  }

  private puff(
    at: THREE.Vector3, vel: THREE.Vector3, size: number, grow: number, life: number,
    hot: number, cool: number,
  ) {
    const mat = glowMaterial(hot, 0.85);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 7, 6), mat);
    mesh.position.copy(at);
    mesh.renderOrder = 4;
    this.gfx.scene.add(mesh);
    this.puffs.push({
      mesh, mat, vel, grow, t: life, life,
      hot: new THREE.Color(hot), cool: new THREE.Color(cool),
    });
  }

  clear() {
    while (this.puffs.length) {
      const q = this.puffs.pop()!;
      this.gfx.scene.remove(q.mesh);
      q.mesh.geometry.dispose();
      q.mat.dispose();
    }
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
