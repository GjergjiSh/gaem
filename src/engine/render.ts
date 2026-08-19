import * as THREE from 'three';
import { T } from '../core/tuning';
import * as V from '../core/vec';
import { currentCap } from '../core/solver';
import type { CollisionWorld, Intent, Player } from '../core/types';
import { level } from '../levels';

/** Unit square pyramid: 1x1 base centred at y=-0.5, apex at (0, 0.5, 0). */
function pyramidGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0, 0.5, 0,
  ], 3));
  g.setIndex([1, 0, 4, 2, 1, 4, 3, 2, 4, 0, 3, 4, 0, 1, 2, 0, 2, 3]);
  // Non-indexed so each face gets its own flat normal instead of smoothed corners.
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_PYRAMID = pyramidGeometry();
const BOX_EDGES = new THREE.EdgesGeometry(UNIT_BOX);
const PYRAMID_EDGES = new THREE.EdgesGeometry(UNIT_PYRAMID);

export class Renderer {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(T.camera.fovBase, 1, 0.1, 600);
  renderer: THREE.WebGLRenderer;
  player: THREE.Group;
  /** One mesh per brush, index-aligned with level.brushes — the editor's handle. */
  brushMeshes: THREE.Mesh[] = [];
  /** 0..1 scope amount, written by the weapon each frame. Pulls FOV in. */
  adsT = 0;
  private levelGroup = new THREE.Group();

  private camPos = new THREE.Vector3(0, 5, 10);
  private camTarget = new THREE.Vector3();
  private arm = T.camera.distance;
  private roll = 0;
  private fov = T.camera.fovBase;
  private eyeDrop = 0;      // smoothed crouch dip, first person
  private bobPhase = 0;


  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x0b0d12);
    this.scene.fog = new THREE.Fog(0x0b0d12, 90, 320);

    this.scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x1a1a22, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(30, 60, 20);
    this.scene.add(sun);

    this.scene.add(this.levelGroup);
    this.buildLevel();

    // Player: capsule plus a nose so facing direction is readable.
    this.player = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(T.character.radius, T.character.height - 2 * T.character.radius),
      new THREE.MeshLambertMaterial({ color: 0xf43f5e }),
    );
    this.player.add(body);
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.16, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    nose.position.set(0, 0.35, 0.45);
    this.player.add(nose);
    this.scene.add(this.player);

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  /**
   * (Re)build all level visuals from the live level data. Meshes use UNIT
   * geometry with mesh.scale = brush size, so an editor gizmo dragging
   * position/rotation/scale IS the brush transform — no conversion layer.
   */
  buildLevel() {
    for (const child of [...this.levelGroup.children]) {
      this.levelGroup.remove(child);
      const m = child as THREE.Mesh;
      if (m.material) (m.material as THREE.Material).dispose();
    }
    this.brushMeshes = [];

    for (let i = 0; i < level.brushes.length; i++) {
      const b = level.brushes[i];
      const pyramid = b.kind === 'pyramid';
      const m = new THREE.Mesh(
        pyramid ? UNIT_PYRAMID : UNIT_BOX,
        new THREE.MeshLambertMaterial({ color: b.c ?? 0x6b7280 }),
      );
      m.position.set(b.p[0], b.p[1], b.p[2]);
      if (b.q) m.quaternion.set(b.q[0], b.q[1], b.q[2], b.q[3]);
      else if (b.r) m.rotation.set(b.r[0], b.r[1], b.r[2]);
      m.scale.set(b.s[0], b.s[1], b.s[2]);
      m.userData.brushIndex = i;
      // Edge lines ride along as a child, so every gizmo drag moves them too.
      m.add(new THREE.LineSegments(
        pyramid ? PYRAMID_EDGES : BOX_EDGES,
        new THREE.LineBasicMaterial({ color: 0x000000, opacity: 0.35, transparent: true }),
      ));
      this.levelGroup.add(m);
      this.brushMeshes.push(m);
    }

    for (const t of level.triggers) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(t.r * 0.5, 0.08, 8, 32),
        new THREE.MeshBasicMaterial({
          color: t.kind === 'goal' ? 0x22c55e : 0xfbbf24,
          transparent: true, opacity: 0.5,
        }),
      );
      ring.position.set(t.p[0], t.p[1], t.p[2]);
      ring.rotation.x = Math.PI / 2;
      this.levelGroup.add(ring);
    }
  }

  /** Draw the scene with the camera exactly as-is — the editor's render path. */
  renderOnly() {
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * @param alpha interpolation factor between the last two physics ticks
   * @param castRay world query for camera collision pull-in
   */
  update(p: Player, i: Intent, dt: number, col: CollisionWorld) {
    const yaw = i.yaw, pitch = i.pitch;
    const pos = new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z);
    const sliding = p.state === 'sliding';
    const fp = T.camera.firstPerson;

    // The body still exists in first person, it's just not drawn — keeping its
    // transform live means switching modes mid-run never shows a stale pose.
    this.player.position.copy(pos);
    this.player.rotation.y = p.facing;
    this.player.scale.y = V.damp(this.player.scale.y, sliding ? 0.55 : 1, 14, dt);
    this.player.visible = !fp;

    const over = Math.max(0, V.lenH(p.vel) - currentCap(p)) / T.momentum.hardCap;

    // Roll reads much stronger from the eyes than over the shoulder, so first
    // person scales it down rather than using a separate set of values.
    let wantRoll = sliding ? T.camera.slideRoll
      : p.state === 'wallrunning' ? T.camera.wallRoll * p.wallSide
        : 0;
    if (fp) wantRoll *= T.camera.fpRollScale;
    this.roll = V.damp(this.roll, wantRoll, 10, dt);

    if (fp) this.firstPerson(p, yaw, pitch, dt, sliding);
    else this.thirdPerson(p, yaw, pitch, dt, col, over);

    // Third person shows speed by extending the arm; first person has no arm, so
    // FOV and head bob carry that job alone.
    // The dash FOV punch is a FORWARD cue: scale it by how camera-forward the dash
    // actually is, or a sideways blink reads as a lunge you never made.
    let dashFov = 0;
    if (p.state === 'dashing') {
      const dh = Math.hypot(p.dashDir.x, p.dashDir.z);
      const dot = dh > 1e-4
        ? (p.dashDir.x * -Math.sin(yaw) + p.dashDir.z * -Math.cos(yaw)) / dh
        : 0;
      dashFov = T.camera.fovDash * V.lerp(1, Math.max(0, dot), T.camera.fovDashAim);
    }
    const wantFov = T.camera.fovBase
      + dashFov
      + (p.state === 'wallrunning' ? T.camera.fovDash * 0.5 : 0)
      + (p.sprinting ? T.sprint.fovAdd : 0)
      + over * T.camera.fovSpeed
      + T.weapon.adsFov * this.adsT;
    this.fov = V.damp(this.fov, wantFov, T.camera.fovRate, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    this.renderer.render(this.scene, this.camera);
  }

  /** Eyes at the capsule, orientation straight from yaw/pitch. */
  private firstPerson(p: Player, yaw: number, pitch: number, dt: number, sliding: boolean) {
    this.eyeDrop = V.damp(this.eyeDrop, sliding ? T.camera.slideHeight : 0, 12, dt);

    // Bob is driven by distance travelled, not time, so it stays in step with your
    // stride instead of wobbling while you stand still.
    const speed = V.lenH(p.vel);
    if (p.grounded && speed > 0.5) this.bobPhase += speed * dt * T.camera.bobRate;
    const bobT = V.clamp(speed / T.ground.maxSpeed, 0, 1);
    const bob = Math.sin(this.bobPhase * Math.PI) * T.camera.bobAmount * bobT;

    this.camera.position.set(
      p.pos.x,
      p.pos.y + T.camera.eyeHeight - this.eyeDrop + bob,
      p.pos.z,
    );
    // YXZ is the standard FPS order: yaw about world Y, then pitch, then roll.
    this.camera.rotation.set(pitch, yaw, this.roll, 'YXZ');
  }

  /** Spring arm over the shoulder, with collision pull-in. */
  private thirdPerson(
    p: Player, yaw: number, pitch: number, dt: number, col: CollisionWorld, over: number,
  ) {
    const sliding = p.state === 'sliding';
    const drop = sliding ? T.camera.slideHeight : 0;
    const target = new THREE.Vector3(p.pos.x, p.pos.y + T.camera.height - drop, p.pos.z);
    this.camTarget.lerp(target, 1 - Math.exp(-T.camera.lagPos * dt));

    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const fwd = new THREE.Vector3(-Math.sin(yaw) * cp, sp, -Math.cos(yaw) * cp);
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    const speedT = V.clamp(V.lenH(p.vel) / T.momentum.hardCap, 0, 1);
    let want = T.camera.distance + T.camera.speedDistance * speedT
      + T.camera.distance * over * 0.35;

    const dir = fwd.clone().negate();
    const hit = col.ray(
      { x: this.camTarget.x, y: this.camTarget.y, z: this.camTarget.z },
      { x: dir.x, y: dir.y, z: dir.z },
      want + T.camera.collisionRadius,
    );
    if (hit !== null) want = Math.max(0.8, hit - T.camera.collisionRadius);
    this.arm = hit !== null
      ? V.damp(this.arm, want, T.camera.collisionPull, dt)
      : V.damp(this.arm, want, T.camera.lagPos * 0.5, dt);

    const desired = this.camTarget.clone()
      .add(dir.multiplyScalar(this.arm))
      .add(right.clone().multiplyScalar(T.camera.shoulder));
    this.camPos.lerp(desired, 1 - Math.exp(-T.camera.lagRot * dt));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
    this.camera.rotateZ(this.roll);
  }

  /** Snap the arm to the player so switching modes doesn't sling the camera in. */
  resetCamera(p: Player, yaw: number) {
    this.camTarget.set(p.pos.x, p.pos.y + T.camera.height, p.pos.z);
    this.camPos.set(
      this.camTarget.x + Math.sin(yaw) * T.camera.distance,
      this.camTarget.y,
      this.camTarget.z + Math.cos(yaw) * T.camera.distance,
    );
    this.arm = T.camera.distance;
  }
}
