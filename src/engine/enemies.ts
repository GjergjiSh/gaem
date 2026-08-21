// Dummy targets: box-people with distinct head / body / limb hitboxes, standing
// at positions defined in the level data (with a random jitter per respawn, so
// every lap the targets sit somewhere slightly different). They shoot slow
// projectiles at the player when in range and sight, but don't move or block.
// Head is one tap, everything else takes two (see T.weapon).

import * as THREE from 'three';
import { T } from '../core/tuning';
import { instance, materialsOf, disposeInstance, type Instance } from './models';
import { level } from '../levels';
import type { V3 } from '../core/vec';
import type { Projectiles } from './projectiles';

const BODY_COLOR = 0xb45309;
const HEAD_COLOR = 0xfbbf24;
const DEAD_COLOR = 0x4b5563;
const FLASH = 0xff3333;

interface Dummy {
  root: THREE.Group;
  parts: THREE.Mesh[];
  /** The visible robot. Null only while its glTF is still in flight. */
  body: Instance | null;
  /** Cloned per dummy, so a hit flash tints ONE robot and not the whole map. */
  mats: THREE.MeshStandardMaterial[];
  action: string;
  hp: number;
  alive: boolean;
  fallT: number;   // 0..1 death tip-over animation
  flashT: number;  // hit flash time remaining
  fireT: number;   // seconds until this dummy may shoot again
}

/**
 * The robots, from assets/robots-pack. Each is rigged with the same 20 clips, so
 * one set of names drives all four and picking a different body per spawn costs
 * nothing but the index.
 */
export const ROBOTS = ['George', 'Leela', 'Mike', 'Stan'];
const CLIP = {
  idle: 'Idle',
  death: 'Death',
  hit: 'HitRecieve_1',
  shoot: 'Shoot',
};

export class Enemies {
  private dummies: Dummy[] = [];
  private group = new THREE.Group();
  private ray = new THREE.Raycaster();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.rebuild();
  }

  /**
   * Rebuild all dummies from the level data — fresh jitter every time.
   *
   * `exact` turns the jitter off, which is what the editor needs: you cannot
   * place a spawn point by dragging a dummy that respawns four metres from where
   * you dropped it.
   */
  rebuild(exact = false) {
    for (const d of this.dummies) {
      this.group.remove(d.root);
      for (const p of d.parts) (p.material as THREE.Material).dispose();
      if (d.body) disposeInstance(d.body.object);
    }
    this.dummies = [];
    const j = exact ? 0 : T.enemy.spawnJitter;
    for (const [x, y, z] of level.enemies ?? []) {
      this.spawn(x + (Math.random() * 2 - 1) * j, y, z + (Math.random() * 2 - 1) * j);
    }
  }

  /**
   * The dummy's root transform, for the editor to hang a gizmo off. Everything
   * else addresses dummies by index; this is the one place that hands out the
   * object itself, because TransformControls has to attach to something real.
   */
  rootOf(idx: number): THREE.Object3D | null {
    return this.dummies[idx]?.root ?? null;
  }

  /** Editor selection tint. Separate from the hit flash, which decays on its own. */
  highlight(idx: number, on: boolean) {
    const d = this.dummies[idx];
    if (!d) return;
    for (const p of d.parts) {
      (p.material as THREE.MeshLambertMaterial).emissive.setHex(on ? 0x2a3550 : 0);
    }
    for (const m of d.mats) m.emissive?.setHex(on ? 0x2a3550 : 0);
  }

  private spawn(x: number, y: number, z: number) {
    const root = new THREE.Group();
    root.position.set(x, y, z);
    const parts: THREE.Mesh[] = [];
    const idx = this.dummies.length;
    const k = T.enemy.scale;

    const box = (part: 'head' | 'body' | 'limb', color: number,
      sx: number, sy: number, sz: number, px: number, py: number) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(sx * k, sy * k, sz * k),
        new THREE.MeshLambertMaterial({ color }),
      );
      m.position.set(px * k, py * k, 0);
      m.userData.part = part;
      m.userData.enemy = idx;
      root.add(m);
      parts.push(m);
    };

    box('head', HEAD_COLOR, 0.36, 0.36, 0.36, 0, 1.62);
    box('body', BODY_COLOR, 0.55, 0.75, 0.28, 0, 1.05);
    box('limb', BODY_COLOR, 0.16, 0.65, 0.16, -0.4, 1.02);  // arms
    box('limb', BODY_COLOR, 0.16, 0.65, 0.16, 0.4, 1.02);
    box('limb', BODY_COLOR, 0.2, 0.85, 0.2, -0.15, 0.42);   // legs
    box('limb', BODY_COLOR, 0.2, 0.85, 0.2, 0.15, 0.42);

    // The boxes stay: they are the hitboxes, the head/body damage split, and
    // the raycast targets, and none of that should depend on a mesh an artist
    // drew. They just stop being drawn. material.visible rather than
    // object.visible, because only the former leaves raycasting alone.
    const robot = instance(ROBOTS[idx % ROBOTS.length], { uniform: true, animate: true });
    if (robot) {
      for (const m of parts) (m.material as THREE.Material).visible = false;
      // Fitted to a unit cube, so this scale IS the robot's height in metres,
      // and it stands on the group origin, which is the spawn's feet position.
      const h = 1.8 * k;
      robot.object.scale.setScalar(h);
      robot.object.position.y = h / 2;
      root.add(robot.object);
    }

    this.group.add(root);
    this.dummies.push({
      root, parts, body: robot, mats: robot ? materialsOf(robot.object) : [],
      action: '',
      hp: T.weapon.enemyHp, alive: true, fallT: 0, flashT: 0,
      // Random initial delay so a fresh lap doesn't greet you with one volley.
      fireT: Math.random() * T.enemy.fireInterval,
    });
  }

  /**
   * Cross-fade a dummy into one of its clips. Names come from the pack and are
   * the same on all four robots. A one-shot (death, flinch) clamps on its last
   * frame instead of snapping back to a pose that would undo the story.
   */
  private play(d: Dummy, name: string, once = false) {
    if (!d.body?.mixer || d.action === name) return;
    const clip = d.body.clips.find((c) => c.name === name);
    if (!clip) return;
    const next = d.body.mixer.clipAction(clip);
    next.reset();
    if (once) { next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true; }
    else next.setLoop(THREE.LoopRepeat, Infinity);
    const prevName = d.action;
    const prev = prevName && d.body.clips.find((c) => c.name === prevName);
    if (prev) d.body.mixer.clipAction(prev).crossFadeTo(next.play(), 0.18, false);
    else next.fadeIn(0.15).play();
    d.action = name;
  }

  /** Every hittable mesh of every living dummy — raycast targets. */
  get aliveMeshes(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const d of this.dummies) if (d.alive) out.push(...d.parts);
    return out;
  }

  get total() { return this.dummies.length; }
  get kills() { return this.dummies.filter((d) => !d.alive).length; }

  /** World position of a dummy's head — reflect target and muzzle. */
  headPosition(idx: number): THREE.Vector3 | null {
    const d = this.dummies[idx];
    if (!d || !d.alive) return null;
    return d.parts[0].getWorldPosition(new THREE.Vector3());
  }

  /** Is this dummy still up? */
  alive(idx: number) { return this.dummies[idx]?.alive === true; }

  /** Feet position of one dummy — the grapple drags this. */
  positionOf(idx: number): THREE.Vector3 | null {
    const d = this.dummies[idx];
    return d ? d.root.position.clone() : null;
  }

  /** Put a dummy somewhere. The grapple's yank is the only thing that moves them. */
  dragTo(idx: number, to: THREE.Vector3) {
    const d = this.dummies[idx];
    if (d) d.root.position.copy(to);
  }

  /** Hold this dummy's fire — being hauled through the air should interrupt it. */
  stagger(idx: number, seconds: number) {
    const d = this.dummies[idx];
    if (!d) return;
    d.fireT = Math.max(d.fireT, seconds);
    d.flashT = Math.max(d.flashT, 0.12);
  }

  /**
   * First living dummy along a ray — the grapple's target test. Returns the
   * dummy's index rather than the mesh, because the hook grabs the whole body,
   * not the shin it happened to touch.
   */
  hookScan(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number):
  { idx: number; dist: number; point: THREE.Vector3 } | null {
    this.ray.set(origin, dir);
    this.ray.far = maxDist;
    const hit = this.ray.intersectObjects(this.aliveMeshes, false)[0];
    if (!hit) return null;
    return { idx: hit.object.userData.enemy, dist: hit.distance, point: hit.point.clone() };
  }

  /** Feet positions of living dummies — the sword's targets. */
  alivePositions(): { idx: number; pos: THREE.Vector3 }[] {
    return this.dummies
      .map((d, idx) => ({ d, idx }))
      .filter(({ d }) => d.alive)
      .map(({ d, idx }) => ({ idx, pos: d.root.position.clone() }));
  }

  /**
   * Apply one part-based projectile hit. Head/body values are shared (T.weapon);
   * `scale` is the firing gun's multiplier, which is how a shotgun pellet does a
   * fraction of a rifle round without needing its own damage table.
   */
  hit(mesh: THREE.Mesh, scale = 1): { killed: boolean; headshot: boolean } {
    const headshot = mesh.userData.part === 'head';
    const base = headshot ? T.weapon.headDamage : T.weapon.bodyDamage;
    return this.damage(mesh.userData.enemy, base * scale, headshot);
  }

  /** Generic damage — the sword's path. */
  damage(idx: number, amount: number, headshot = false): { killed: boolean; headshot: boolean } {
    const d = this.dummies[idx];
    if (!d || !d.alive) return { killed: false, headshot };
    d.hp -= amount;
    d.flashT = 0.12;
    const killed = d.hp <= 0;
    if (killed) {
      d.alive = false;
      for (const p of d.parts) {
        (p.material as THREE.MeshLambertMaterial).color.setHex(DEAD_COLOR);
      }
    }
    return { killed, headshot };
  }

  /** Flash decay, death tip-over, and firing at the player. */
  update(dt: number, playerPos: V3, projectiles: Projectiles, walls: THREE.Mesh[]) {
    const target = new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z);

    for (const d of this.dummies) {
      d.body?.mixer?.update(dt);
      if (d.flashT > 0) {
        d.flashT -= dt;
        const on = d.flashT > 0;
        for (const p of d.parts) {
          (p.material as THREE.MeshLambertMaterial).emissive.setHex(on ? FLASH : 0);
        }
        for (const m of d.mats) m.emissive?.setHex(on ? FLASH : 0);
      }
      if (!d.alive) {
        // The pack ships a Death clip, so use it and leave the root alone. The
        // hand-rolled tip-over is still here for a dummy whose model has not
        // arrived: something has to read as "dead" either way.
        if (d.body?.mixer) {
          this.play(d, CLIP.death, true);
        } else if (d.fallT < 1) {
          d.fallT = Math.min(1, d.fallT + dt * 3);
          // Rotate about the feet (group origin) so the corpse tips, not floats.
          d.root.rotation.x = (-Math.PI / 2) * (1 - Math.pow(1 - d.fallT, 3));
        }
        continue;
      }
      this.play(d, CLIP.idle);

      // Disarmed from the panel (enemy/shoot). The timer is re-rolled instead of
      // frozen so re-arming staggers them again rather than firing the whole room
      // on the same frame.
      if (!T.enemy.shoot) { d.fireT = Math.random() * T.enemy.fireInterval; continue; }

      d.fireT -= dt;
      if (d.fireT > 0) continue;
      const muzzle = d.parts[0].getWorldPosition(new THREE.Vector3());
      const dist = muzzle.distanceTo(target);
      if (dist > T.enemy.range) continue;

      // Hold fire without line of sight — shooting through walls reads as unfair.
      const dir = target.clone().sub(muzzle).normalize();
      this.ray.set(muzzle, dir);
      this.ray.far = dist - 0.5;
      if (this.ray.intersectObjects(walls, false).length > 0) continue;

      d.fireT = T.enemy.fireInterval;
      // Turn to face what it is shooting at. A robot firing out of its own back
      // is worse than a box doing it, because a box has no front.
      d.root.rotation.y = Math.atan2(dir.x, dir.z);
      this.play(d, CLIP.shoot, true);
      projectiles.spawn(muzzle, dir.multiplyScalar(T.enemy.projSpeed), 'enemy',
        this.dummies.indexOf(d));
    }
  }
}
