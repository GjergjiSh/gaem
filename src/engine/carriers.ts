// Cargo on the Line: boxes hung from the overhead rail, going round the circuit
// forever.
//
// The whole reason the Line is a closed loop rather than a grid is these. A
// carrier does not have a route, a destination or a state machine — it has a
// distance along a path that never runs out, and everything else falls out of
// that. Wrapping is a modulo, spacing is a division, and there is no case where
// one arrives at the end of the track, because the path has no end.
//
// They are DECORATION THAT YOU CAN STAND ON, which is a specific and awkward
// category. The physics world gets a kinematic box per carrier so the character
// controller collides with one properly; but Rapier's controller does not carry
// a character standing on a moving body, so the carry is done here, explicitly,
// by adding the frame's motion to anyone riding. That is the same trick a
// hand-rolled platform has used since the first one, and doing it here keeps it
// out of the solver — the movement rules do not need to learn about conveyors.

import * as THREE from 'three';
import { T } from '../core/tuning';
import type { Player } from '../core/types';

/** One box on the rail, in world space. */
export interface Carrier {
  x: number;
  y: number;
  z: number;
  /** How far it moved last frame — what a rider gets added to their position. */
  dx: number;
  dz: number;
  dy: number;
}

/** Half-extents of a carrier's body. */
const HALF_W = 3.2;
const HALF_H = 1.0;
const HALF_L = 4.5;
/**
 * How far the carrier's TOP hangs below the rail.
 *
 * The rail is 11 m over the deck and this puts the ridable surface at 4.6, with
 * 2.6 m of clear air under the box — over a standing player's head, so the deck
 * stays a road you can run down rather than a tunnel with a train in it.
 */
const HANG = 6.4;

export class Carriers {
  private group = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  /** The path, flattened into segments with running distances. */
  private segs: { ax: number; ay: number; az: number; dx: number; dy: number; dz: number; len: number }[] = [];
  private total = 0;
  /** Distance along the path, one per carrier. */
  private at: number[] = [];
  readonly carriers: Carrier[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  /**
   * Lay carriers out on a level's rails. Called on every level rebuild, so it
   * has to be safe to call with no rails at all — most levels have none.
   */
  rebuild(rails: [number, number, number][][] | undefined) {
    for (const m of this.meshes) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.meshes = [];
    this.segs = [];
    this.at = [];
    this.carriers.length = 0;
    this.total = 0;
    const path = rails?.[0];
    if (!path || path.length < 2) return;

    // Closed: the last point joins the first, so the wrap needs no special case.
    for (let i = 0; i < path.length; i++) {
      const a = path[i];
      const b = path[(i + 1) % path.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-3) continue;
      this.segs.push({ ax: a[0], ay: a[1], az: a[2], dx, dy, dz, len });
      this.total += len;
    }
    if (!this.total) return;

    const n = Math.max(1, Math.round(this.total / T.line.spacing));
    const geo = new THREE.BoxGeometry(HALF_W * 2, HALF_H * 2, HALF_L * 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x99a2b0, roughness: 0.9, metalness: 0.05 });
    const strut = new THREE.BoxGeometry(0.8, HANG - HALF_H * 2, 0.8);
    for (let i = 0; i < n; i++) {
      this.at.push((i / n) * this.total);
      this.carriers.push({ x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0 });
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      // The hanger, so a box is held up by something rather than floating under
      // a beam it has no connection to.
      const s = new THREE.Mesh(strut, mat);
      s.position.y = HALF_H + (HANG - HALF_H * 2) / 2;
      m.add(s);
      this.group.add(m);
      this.meshes.push(m);
    }
    this.place(0);
  }

  /** Where the path is, `d` metres along it. */
  private sample(d: number): { x: number; y: number; z: number } {
    let r = ((d % this.total) + this.total) % this.total;
    for (const s of this.segs) {
      if (r <= s.len) {
        const t = r / s.len;
        return { x: s.ax + s.dx * t, y: s.ay + s.dy * t, z: s.az + s.dz * t };
      }
      r -= s.len;
    }
    const last = this.segs[this.segs.length - 1];
    return { x: last.ax + last.dx, y: last.ay + last.dy, z: last.az + last.dz };
  }

  private place(dt: number) {
    for (let i = 0; i < this.carriers.length; i++) {
      const p = this.sample(this.at[i]);
      const c = this.carriers[i];
      const y = p.y - HANG + HALF_H;
      c.dx = dt ? p.x - c.x : 0;
      c.dy = dt ? y - c.y : 0;
      c.dz = dt ? p.z - c.z : 0;
      c.x = p.x; c.y = y; c.z = p.z;
      const m = this.meshes[i];
      m.position.set(c.x, c.y, c.z);
      // Turned to face the way it is going, in quarter turns — the circuit is
      // axis-aligned, so anything smoother than this is a rotation nobody can
      // see costing a trig call per carrier per frame.
      const ahead = this.sample(this.at[i] + 2);
      m.rotation.y = Math.abs(ahead.x - p.x) > Math.abs(ahead.z - p.z) ? Math.PI / 2 : 0;
    }
  }

  update(dt: number) {
    if (!this.total) return;
    for (let i = 0; i < this.at.length; i++) {
      this.at[i] = (this.at[i] + T.line.speed * dt) % this.total;
    }
    this.place(dt);
  }

  /** Boxes for the physics world, as centre plus half-extents. */
  bodies() {
    return this.carriers.map((c) => ({
      x: c.x, y: c.y, z: c.z, hw: HALF_W, hh: HALF_H, hl: HALF_L,
    }));
  }

  /**
   * Drag whoever is standing on one along with it.
   *
   * Tested against the carrier's TOP with a generous tolerance rather than
   * against `player.grounded`: a character standing on a body that is moving
   * under them spends some frames a few centimetres off it, and a carry that
   * drops out on those frames is a platform that shrugs you off at every seam.
   */
  carry(p: Player) {
    if (!this.total) return;
    const feet = p.pos.y - T.character.height / 2;
    for (const c of this.carriers) {
      const top = c.y + HALF_H;
      if (feet < top - 0.35 || feet > top + 0.6) continue;
      const r = T.character.radius;
      if (Math.abs(p.pos.x - c.x) > HALF_W + r || Math.abs(p.pos.z - c.z) > HALF_L + r) continue;
      p.pos.x += c.dx;
      p.pos.y += c.dy;
      p.pos.z += c.dz;
      return;
    }
  }
}
