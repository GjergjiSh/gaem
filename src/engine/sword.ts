// Sword on mouse 4. An instant frontal-arc strike: dummies inside reach take
// sword damage, and enemy projectiles inside the (slightly longer) parry range
// are reflected straight back at whoever fired them. Three swings, then a
// cooldown restores the whole combo. Everything is a slider in T.sword —
// including T.sword.infinite, which takes the resource off the verb entirely so
// arc, reach and parry can be tuned without a cooldown getting in the way.

import * as THREE from 'three';
import { T } from '../core/tuning';
import type { Renderer } from './render';
import type { Input } from './input';
import type { Enemies } from './enemies';
import type { Projectiles } from './projectiles';
import type { Player } from '../core/types';

export class Sword {
  charges = T.sword.combo;
  cooldown = 0;      // seconds left until the combo restores; 0 = off cooldown
  private swingT = 0;
  private swingDir = 1;
  private slash: THREE.Mesh;

  constructor(
    private input: Input,
    private gfx: Renderer,
    private enemies: Enemies,
    private projectiles: Projectiles,
    private onHit: (r: { killed: boolean; headshot: boolean }) => void,
  ) {
    // Slash visual: a thin ring sector parented to the camera, shown per swing.
    this.slash = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.72, 24, 1, 0, T.sword.arc * 0.8),
      new THREE.MeshBasicMaterial({
        color: 0xe6f6ff, transparent: true, opacity: 0, side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    this.slash.position.set(0, -0.1, -1.4);
    this.gfx.camera.add(this.slash);
  }

  get cooldownFrac() { return T.sword.cooldown <= 0 ? 0 : this.cooldown / T.sword.cooldown; }

  update(dt: number, player: Player) {
    // Infinite: hold the combo full so the meter reads as unlimited, and clear
    // any cooldown left over from before the switch was flipped.
    if (T.sword.infinite) {
      this.charges = T.sword.combo;
      this.cooldown = 0;
    } else if (this.cooldown > 0) {
      this.cooldown = Math.max(0, this.cooldown - dt);
      if (this.cooldown === 0) this.charges = T.sword.combo;
    }
    this.swingT = Math.max(0, this.swingT - dt);

    // Swing animation: sweep the arc across the view and fade it out.
    const mat = this.slash.material as THREE.MeshBasicMaterial;
    if (this.swingT > 0) {
      const t = 1 - this.swingT / T.sword.swingTime;
      mat.opacity = 0.75 * (1 - t);
      this.slash.rotation.z = this.swingDir * (1.1 - 2.2 * t);
    } else {
      mat.opacity = 0;
    }

    if (this.input.swingPressed) {
      this.input.swingPressed = false;
      this.swing(player);
    }
  }

  private swing(player: Player) {
    if (this.cooldown > 0 || this.charges <= 0) return;
    if (!T.sword.infinite) {
      this.charges--;
      if (this.charges <= 0) this.cooldown = T.sword.cooldown;
    }
    this.swingT = T.sword.swingTime;
    this.swingDir = -this.swingDir;

    const cam = this.gfx.camera;
    cam.updateMatrixWorld();
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const origin = new THREE.Vector3(player.pos.x, player.pos.y, player.pos.z);
    const halfArc = T.sword.arc / 2;

    // In-cone test on the horizontal plane: reach + angle from view direction.
    const inArc = (at: THREE.Vector3, reach: number) => {
      const to = at.clone().sub(origin);
      const dist = to.length();
      if (dist > reach) return false;
      const flatTo = new THREE.Vector3(to.x, 0, to.z).normalize();
      const flatFwd = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
      return flatTo.angleTo(flatFwd) <= halfArc;
    };

    // Cut everything living inside the blade cone.
    for (const { idx, pos } of this.enemies.alivePositions()) {
      const centre = pos.clone();
      centre.y += 1.05 * T.enemy.scale;
      if (inArc(centre, T.sword.reach)) {
        this.onHit(this.enemies.damage(idx, T.sword.damage));
      }
    }

    // Parry: enemy shots in the (longer) reflect range fly back at their owner.
    for (const p of this.projectiles.enemyShotsNear(origin, T.sword.reflectReach)) {
      if (inArc(p.mesh.position, T.sword.reflectReach)) this.projectiles.reflect(p);
    }
  }
}
