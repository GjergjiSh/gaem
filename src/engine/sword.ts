// The blade. Mouse 4 swings it, mouse 5 throws a Getsuga — a crescent of energy
// that flies out and cuts through everything on the way.
//
// The swing is an instant frontal-arc strike: dummies inside reach take sword
// damage, and enemy projectiles inside the (slightly longer) parry range are
// reflected straight back at whoever fired them. Three swings, then a cooldown
// restores the whole combo. Everything is a slider in T.sword — including
// T.sword.infinite, which takes the resource off both verbs so arc, reach and
// parry can be tuned without a cooldown getting in the way.
//
// Hits resolve on the press, but the ANIMATION is the thing you actually read,
// so the blade is a real object rather than a floating decal: held out in front
// in first person, in the character's hand in third, drawn in both. Every press
// picks a random slash direction — overhead, diagonal, horizontal, upward — and
// the trail and any wave thrown by that swing follow the same line, so a combo
// never plays the same animation twice.

import * as THREE from 'three';
import { T } from '../core/tuning';
import * as V from '../core/vec';
import type { Renderer } from './render';
import type { Input } from './input';
import type { Enemies } from './enemies';
import type { Projectiles } from './projectiles';
import type { Player } from '../core/types';

/** Grip base to blade tip, in world metres. The trail and the pose key off this. */
const BLADE_LEN = 1.55;

/** Seconds a spent wave takes to blow out. */
const FADE = 0.18;

/** Where the hand sits in first person, and how close to the near plane the blade
 *  tip is allowed to get. */
const HAND = { x: 0.30, y: -0.42, z: -0.75, margin: 0.15 };

/** Rest tilt of the blade off the aim axis, when there is room for it: upright
 *  enough to read as a held sword rather than a lance pointed at the target. */
const REST_TILT = 0.37;

/**
 * Rest pose of the wrist — blade up and canted forward across the view.
 *
 * How far forward is not a taste call. A swing rotates off this pose by up to
 * 0.55 x `swingSweep`, and a blade that starts too upright passes BEHIND the
 * camera at the end of a big sweep — which, with the viewmodel's depth test off,
 * smears across the whole screen. So the pose is SOLVED rather than fixed: work
 * out the largest angle off the aim the tip may reach while staying in front of
 * the near plane, subtract the sweep, and rest at whatever is left. Small sweeps
 * get the upright pose; a huge one tilts the whole arc forward instead of
 * clipping, and `swingSweep` and `scale` stay free to go wherever you drag them.
 */
function restPose(fp: boolean): THREE.Quaternion {
  let tilt = REST_TILT;
  if (fp) {
    const reach = BLADE_LEN * T.sword.scale;
    const budget = Math.acos(Math.min(1, Math.max(-1, (HAND.z + HAND.margin) / reach)));
    tilt = Math.min(REST_TILT, budget - 0.55 * T.sword.swingSweep);
  }
  // Blade local +Y, so an x rotation of -(PI/2 - tilt) lays it `tilt` off the aim.
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-(Math.PI / 2 - tilt), -0.2, 0.34),
  );
}

/**
 * A tapered arc lying in XY, centred on +X, spanning `span` radians: thickest at
 * the middle and coming to a point at both tips. That is the sword's trail and
 * the Getsuga's crescent both — same shape, different scale.
 */
function crescentGeometry(radius: number, span: number, thick: number, seg = 48) {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const a = -span / 2 + span * t;
    // sin() is 0 at both ends and 1 in the middle — the taper that makes it a
    // crescent rather than a slice of ring.
    const w = thick * Math.sin(Math.PI * t);
    const c = Math.cos(a), s = Math.sin(a);
    pos.push(c * (radius - w), s * (radius - w), 0);
    pos.push(c * (radius + w), s * (radius + w), 0);
  }
  for (let i = 0; i < seg; i++) {
    const b = i * 2;
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** One Getsuga in flight. */
interface Wave {
  group: THREE.Group;
  geo: THREE.BufferGeometry;
  mats: { mat: THREE.MeshBasicMaterial; opacity: number }[];
  dir: THREE.Vector3;
  travelled: number;
  hit: Set<number>;   // dummies already cut — a wave passes through, once each
  fade: number;       // >0 once it is dying out; counts down to removal
}

export class Sword {
  charges = T.sword.combo;
  cooldown = 0;         // seconds left until the combo restores; 0 = off cooldown
  waveCooldown = 0;     // seconds left until the next Getsuga
  private swingT = 0;
  private swingAngle = 0;   // screen direction of the current slash, radians
  private idleT = 0;
  private show = 0;         // 0 sheathed, 1 fully drawn — the blade is not always out
  private linger = 0;       // seconds left of the post-swing hold before it goes away
  private rig = new THREE.Group();      // hand: positioned per view mode
  private pivot = new THREE.Group();    // animated — the wrist
  private slash: THREE.Mesh;
  private parts: THREE.Material[] = []; // blade materials, for the depth swap
  private mountedFP: boolean | null = null;
  private waves: Wave[] = [];
  private ray = new THREE.Raycaster();

  constructor(
    private input: Input,
    private gfx: Renderer,
    private enemies: Enemies,
    private projectiles: Projectiles,
    private onHit: (r: { killed: boolean; headshot: boolean }) => void,
  ) {
    // --- the blade itself, built up the +Y axis from the hand at the origin, so
    // rotating the pivot swings it exactly the way a wrist does.
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number, x = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, 0);
      this.pivot.add(m);
      this.parts.push(mat);
      return m;
    };
    add(new THREE.CylinderGeometry(0.035, 0.045, 0.28, 8),
      new THREE.MeshLambertMaterial({ color: 0x1f2937 }), 0.14);
    add(new THREE.BoxGeometry(0.34, 0.055, 0.09),
      new THREE.MeshLambertMaterial({ color: 0xd4a017 }), 0.30);
    add(new THREE.BoxGeometry(0.13, 1.25, 0.035),
      new THREE.MeshLambertMaterial({ color: 0xdbeafe, emissive: 0x1e3a8a }), 0.925);
    // A brighter sliver proud of one face: the cutting edge, so which way the
    // blade is turned is readable even mid-swing.
    add(new THREE.BoxGeometry(0.03, 1.25, 0.042),
      new THREE.MeshBasicMaterial({ color: 0x7dd3fc }), 0.925, 0.062);
    this.rig.add(this.pivot);

    // The trail rides on the hand, not the camera, so it lands where the blade
    // actually is in both view modes.
    this.slash = new THREE.Mesh(
      crescentGeometry(1, 1.7, 0.2),
      new THREE.MeshBasicMaterial({
        color: 0xe6f6ff, transparent: true, opacity: 0, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    this.rig.add(this.slash);
    this.mount(T.camera.firstPerson);
  }

  get cooldownFrac() { return T.sword.cooldown <= 0 ? 0 : this.cooldown / T.sword.cooldown; }
  /** 0..1 charge on the wave — 1 means it is ready to throw. */
  get waveFrac() {
    if (T.getsuga.cooldown <= 0 || T.sword.infinite) return 1;
    return 1 - this.waveCooldown / T.getsuga.cooldown;
  }

  /** The editor owns the camera; a viewmodel hanging off it just gets in the way. */
  setHidden(hidden: boolean) { this.rig.visible = !hidden; }

  /** Drop every wave in flight — a restart shouldn't inherit the last run's. */
  clear() {
    while (this.waves.length) this.despawnWave(this.waves.length - 1);
  }

  update(dt: number, player: Player) {
    // Infinite: hold the combo full so the meter reads as unlimited, and clear
    // any cooldown left over from before the switch was flipped.
    if (T.sword.infinite) {
      this.charges = T.sword.combo;
      this.cooldown = 0;
      this.waveCooldown = 0;
    } else {
      if (this.cooldown > 0) {
        this.cooldown = Math.max(0, this.cooldown - dt);
        if (this.cooldown === 0) this.charges = T.sword.combo;
      }
      this.waveCooldown = Math.max(0, this.waveCooldown - dt);
    }
    this.swingT = Math.max(0, this.swingT - dt);
    this.idleT += dt;

    if (this.input.swingPressed) {
      this.input.swingPressed = false;
      this.strike(player);
    }
    if (this.input.getsugaPressed) {
      this.input.getsugaPressed = false;
      this.throwWave(player);
    }

    // Waves live in the world, not on the rig — they keep flying long after the
    // blade that threw them has been put away.
    this.updateWaves(dt);

    // Drawn for the swing, held for `linger`, then put away. Damped both ways so
    // a fast combo never re-draws a blade that is already out.
    this.linger = this.swingT > 0 ? T.sword.linger : Math.max(0, this.linger - dt);
    const out = this.swingT > 0 || this.linger > 0 ? 1 : 0;
    this.show = V.damp(this.show, out, T.sword.drawSpeed, dt);
    this.rig.visible = this.show > 0.01;
    if (!this.rig.visible) return;

    this.mount(T.camera.firstPerson);
    this.poseRig(player);
    this.animate();
  }

  // ---------------------------------------------------------------- the swing

  private strike(player: Player) {
    if (this.cooldown > 0 || this.charges <= 0) return;
    if (!T.sword.infinite) {
      this.charges--;
      if (this.charges <= 0) this.cooldown = T.sword.cooldown;
    }
    this.beginSwing();

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

  /**
   * Start the animation on a fresh, random line. The direction is a screen-space
   * angle: 0 slashes right, PI/2 slashes up, and everything between is a
   * diagonal. Drawn from the full circle rather than a list of canned arcs, so
   * back-to-back swings essentially never repeat.
   */
  private beginSwing() {
    this.swingT = Math.max(T.sword.swingTime, 1e-3);
    this.swingAngle = Math.random() * Math.PI * 2;
  }

  /**
   * Where the blade is right now, or null when idle:
   *
   *   angle  radians off the rest pose, signed along the slash line
   *   t      0..1 through the whole swing — drives the lunge
   *   cut    0..1 through the CUT beat alone — drives the trail's growth
   *   since  0..1 from the start of the cut to the end of the swing — the trail
   *          keeps burning off through the recovery, so it outlives the beat
   *          that made it instead of blinking out with it
   *
   * Three beats: cock back, cut, recover. The cut is the short one and it eases
   * OUT, so the blade leaves fast and arrives slow — that asymmetry is the whole
   * reason a swing reads as a strike rather than a wave of the hand.
   */
  private swingPhase(): { angle: number; t: number; cut: number; since: number } | null {
    if (this.swingT <= 0) return null;
    const t = 1 - this.swingT / Math.max(T.sword.swingTime, 1e-3);
    const sweep = T.sword.swingSweep;
    const w = Math.min(0.6, Math.max(0, T.sword.windup));
    // With the windup dialled out there is nothing to cock back INTO, so the cut
    // starts from rest and takes the whole sweep — otherwise the blade would pop
    // to the cocked pose on frame one.
    const back = w > 0 ? sweep * 0.45 : 0;
    const through = w > 0 ? -sweep * 0.55 : -sweep;

    if (t < w) return { angle: back * easeOut(t / w), t, cut: 0, since: 0 };
    const k = (t - w) / Math.max(1e-3, 1 - w);
    const cutEnd = 0.45;
    if (k < cutEnd) {
      const c = easeOutCubic(k / cutEnd);
      return { angle: back + (through - back) * c, t, cut: k / cutEnd, since: k };
    }
    const r = (k - cutEnd) / (1 - cutEnd);
    return { angle: through * (1 - smooth(r)), t, cut: 1, since: k };
  }

  /** Park the hand: camera-parented in first person, at the character's in third. */
  private mount(fp: boolean) {
    if (this.mountedFP === fp) return;
    this.mountedFP = fp;
    (fp ? this.gfx.camera : this.gfx.scene).add(this.rig);
    // First person draws the viewmodel over everything — a blade held at arm's
    // length otherwise punches into every wall you stand next to. Third person
    // is a normal object in the world and occludes properly.
    for (const m of this.parts) {
      m.depthTest = !fp;
      m.needsUpdate = true;
    }
    for (const child of this.pivot.children) child.renderOrder = fp ? 999 : 0;
    this.slash.renderOrder = fp ? 1000 : 1;
  }

  /** Place the hand for the current view mode, including the strike's lunge. */
  private poseRig(player: Player) {
    const fp = T.camera.firstPerson;
    const p = this.swingPhase();
    // The hand punches forward through the cut and settles back — the reach that
    // sells the strike, on top of the rotation.
    const lunge = p ? T.sword.lunge * Math.sin(Math.PI * clamp01(p.t)) : 0;
    // A slow breath so the blade is never a dead prop between swings.
    const bob = Math.sin(this.idleT * 1.6) * 0.012;

    // Sheathed, the hand sits low and off to the side; drawing swings it up into
    // frame rather than popping it in.
    const away = 1 - this.show;

    if (fp) {
      this.rig.scale.setScalar(T.sword.scale);
      this.rig.rotation.set(0, 0, -away * 1.1);
      this.rig.position.set(
        HAND.x + away * 0.3,
        HAND.y + bob - away * 0.85,
        HAND.z - lunge + away * 0.3,
      );
    } else {
      // Not parented to the character: its mesh squashes on a slide, and a
      // squashed sword reads as a bug. World transform from pos + facing instead.
      const f = player.facing;
      const sin = Math.sin(f), cos = Math.cos(f);
      const right = new THREE.Vector3(cos, 0, -sin);
      const fwd = new THREE.Vector3(sin, 0, cos);
      this.rig.scale.setScalar(1);
      // Local -Z has to point where the character faces, so the swing maths is
      // identical in both modes and only this one line knows about the flip.
      this.rig.rotation.set(0, f + Math.PI, 0);
      this.rig.position.set(player.pos.x, player.pos.y + 0.1 + bob - away * 1.1, player.pos.z)
        .addScaledVector(right, 0.5)
        .addScaledVector(fwd, 0.2 + lunge);
    }
  }

  /** Drive the wrist and the trail from the current swing phase. */
  private animate() {
    const mat = this.slash.material as THREE.MeshBasicMaterial;
    const p = this.swingPhase();
    if (!p) {
      this.pivot.quaternion.copy(restPose(T.camera.firstPerson));
      mat.opacity = 0;
      return;
    }

    // Sweeping about an axis that lies in the screen plane and is perpendicular
    // to the slash line carries the tip ALONG that line — which is exactly what
    // "swing this direction" means.
    const axis = new THREE.Vector3(-Math.sin(this.swingAngle), Math.cos(this.swingAngle), 0);
    const turn = new THREE.Quaternion().setFromAxisAngle(axis, p.angle);
    this.pivot.quaternion.copy(turn.multiply(restPose(T.camera.firstPerson)));

    // The trail: a crescent whose chord lies along the slash line, bowed the way
    // the blade travelled. It appears with the cut and burns off behind it.
    const r = BLADE_LEN * T.sword.slashSize;
    this.slash.scale.setScalar(r * (0.82 + 0.3 * p.cut));
    this.slash.position.set(0, 0, -T.sword.slashDist);
    this.slash.rotation.z = this.swingAngle + Math.PI / 2 + p.angle * 0.25;
    // Snaps in with the cut, then burns off across the recovery.
    mat.opacity = T.sword.slashSize <= 0 ? 0
      : 0.9 * Math.min(1, p.since * 8) * Math.pow(1 - p.since, 1.2);
  }

  // ---------------------------------------------------------------- getsuga tenshō

  /**
   * Throw a wave along the aim. It swings first — the wave is what comes OFF the
   * blade, so it borrows the same random slash line and the crescent flies rolled
   * to match the cut that threw it.
   */
  private throwWave(player: Player) {
    if (!T.sword.infinite && this.waveCooldown > 0) return;
    this.waveCooldown = T.getsuga.cooldown;
    this.beginSwing();

    const cam = this.gfx.camera;
    cam.updateMatrixWorld();
    const aimDir = new THREE.Vector3();
    cam.getWorldDirection(aimDir);
    // Off the BLADE, not out of the camera. Guns can get away with a muzzle at
    // the camera because a bullet is a dot; a two-metre crescent spawned behind
    // a third-person player would visibly fly out through their back.
    const origin = new THREE.Vector3(player.pos.x, player.pos.y + T.camera.eyeHeight, player.pos.z)
      .addScaledVector(aimDir, 1.2);

    // ...but a muzzle that is not the camera means a path that is not the
    // crosshair. Thrown flat along the camera's direction the wave runs PARALLEL
    // to your aim, permanently offset by however far the blade is from the eye —
    // which in third person is metres, and reads as the wave whiffing shots it
    // actually connects with. Aim it at a point ON the crosshair line instead, so
    // the two converge where the fighting is.
    const eye = cam.getWorldPosition(new THREE.Vector3());
    const dir = eye.addScaledVector(aimDir, T.getsuga.converge).sub(origin).normalize();

    const group = new THREE.Group();
    const mats: Wave['mats'] = [];
    // Unit crescent scaled by the live radius, so `growth` is one scale write per
    // frame instead of a geometry rebuild.
    // Re-centred on the arc's MIDDLE. crescentGeometry puts the curve a radius
    // out along +X, which is right for the sword trail (it sweeps around the
    // hand) and wrong for a projectile: it left the visible crescent one whole
    // radius — nearly three metres — to the side of the point being hit-tested,
    // so the thing you saw and the thing that cut were never in the same place.
    const geo = crescentGeometry(1, T.getsuga.span, T.getsuga.thickness);
    geo.translate(-1, 0, 0);
    // Core plus a wider, dimmer copy behind it: the bright edge with the haze of
    // spiritual pressure dragging along after it.
    for (const [color, opacity, scale] of [
      [0x1d4ed8, 0.5, 1.22], [0xbfe9ff, 0.95, 1.0],
    ] as const) {
      const mat = new THREE.MeshBasicMaterial({
        color, opacity, transparent: true, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(geo, mat);
      m.scale.setScalar(scale);
      group.add(m);
      mats.push({ mat, opacity });
    }
    group.position.copy(origin);
    // +Z of the crescent faces the way it flies, then roll it onto the slash line.
    group.lookAt(origin.clone().add(dir));
    group.rotateZ(this.swingAngle + Math.PI / 2);
    group.scale.setScalar(T.getsuga.radius);
    this.gfx.scene.add(group);

    this.waves.push({ group, geo, mats, dir, travelled: 0, hit: new Set(), fade: 0 });
  }

  private updateWaves(dt: number) {
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];

      // Dying: blow out and thin away rather than blinking off.
      if (w.fade > 0) {
        w.fade -= dt;
        const f = Math.max(0, w.fade / FADE);
        for (const { mat, opacity } of w.mats) mat.opacity = opacity * f;
        w.group.scale.multiplyScalar(1 + dt * 2.5);
        if (w.fade <= 0) this.despawnWave(i);
        continue;
      }

      const step = T.getsuga.speed * dt;
      const radius = T.getsuga.radius * (1 + w.travelled * T.getsuga.growth);
      w.group.scale.setScalar(radius);

      // Walls stop it. Only the centre line is tested — a wave clipping a corner
      // with its wingtip carrying on is the right read anyway.
      this.ray.set(w.group.position, w.dir);
      this.ray.far = step;
      const wall = this.ray.intersectObjects(this.gfx.brushMeshes, false)[0];
      if (wall) {
        w.group.position.copy(wall.point);
        w.fade = FADE;
      } else {
        w.group.position.addScaledVector(w.dir, step);
        w.travelled += step;
      }

      // Everything the wave sweeps over gets cut, each target only once.
      for (const { idx, pos } of this.enemies.alivePositions()) {
        if (w.hit.has(idx)) continue;
        const centre = pos.clone();
        centre.y += 1.05 * T.enemy.scale;
        if (centre.distanceTo(w.group.position) > radius + 0.5) continue;
        w.hit.add(idx);
        this.onHit(this.enemies.damage(idx, T.getsuga.damage));
      }

      if (w.travelled >= T.getsuga.range && w.fade <= 0) w.fade = FADE;
    }
  }

  private despawnWave(i: number) {
    const w = this.waves[i];
    this.gfx.scene.remove(w.group);
    w.geo.dispose();   // one geometry, shared by the core and its haze
    for (const { mat } of w.mats) mat.dispose();
    this.waves.splice(i, 1);
  }
}
