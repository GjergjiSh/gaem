import * as THREE from 'three';
import { T } from '../core/tuning';
import * as V from '../core/vec';
import { currentCap } from '../core/solver';
import type { Player } from '../core/types';
import { brushes, triggers } from '../levels/course01';

const TRAIL_POINTS = 900;

export class Renderer {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(T.camera.fovBase, 1, 0.1, 600);
  renderer: THREE.WebGLRenderer;
  player: THREE.Group;

  private camPos = new THREE.Vector3(0, 5, 10);
  private camTarget = new THREE.Vector3();
  private arm = T.camera.distance;
  private roll = 0;
  private fov = T.camera.fovBase;

  private trail: THREE.Line;
  private trailPos: Float32Array;
  private trailCount = 0;
  showTrail = true;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x0b0d12);
    this.scene.fog = new THREE.Fog(0x0b0d12, 90, 320);

    this.scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x1a1a22, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(30, 60, 20);
    this.scene.add(sun);

    for (const b of brushes) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(b.s[0], b.s[1], b.s[2]),
        new THREE.MeshLambertMaterial({ color: b.c ?? 0x6b7280 }),
      );
      m.position.set(b.p[0], b.p[1], b.p[2]);
      if (b.r) m.rotation.set(b.r[0], b.r[1], b.r[2]);
      this.scene.add(m);

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(m.geometry),
        new THREE.LineBasicMaterial({ color: 0x000000, opacity: 0.35, transparent: true }),
      );
      edges.position.copy(m.position);
      edges.rotation.copy(m.rotation);
      this.scene.add(edges);
    }

    for (const t of triggers) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(t.r * 0.5, 0.08, 8, 32),
        new THREE.MeshBasicMaterial({
          color: t.kind === 'goal' ? 0x22c55e : 0xfbbf24,
          transparent: true, opacity: 0.5,
        }),
      );
      ring.position.set(t.p[0], t.p[1], t.p[2]);
      ring.rotation.x = Math.PI / 2;
      this.scene.add(ring);
    }

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

    this.trailPos = new Float32Array(TRAIL_POINTS * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    g.setDrawRange(0, 0);
    this.trail = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x38bdf8 }));
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  pushTrail(p: { x: number; y: number; z: number }) {
    if (this.trailCount >= TRAIL_POINTS) {
      this.trailPos.copyWithin(0, 3);
      this.trailCount = TRAIL_POINTS - 1;
    }
    const i = this.trailCount * 3;
    this.trailPos[i] = p.x; this.trailPos[i + 1] = p.y; this.trailPos[i + 2] = p.z;
    this.trailCount++;
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.setDrawRange(0, this.trailCount);
  }

  clearTrail() {
    this.trailCount = 0;
    this.trail.geometry.setDrawRange(0, 0);
  }

  /**
   * @param alpha interpolation factor between the last two physics ticks
   * @param castRay world query for camera collision pull-in
   */
  update(
    p: Player, yaw: number, pitch: number, dt: number,
    castRay: (from: V.V3, dir: V.V3, max: number) => number | null,
  ) {
    const pos = new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z);

    this.player.position.copy(pos);
    this.player.rotation.y = p.facing;
    const sliding = p.state === 'sliding';
    this.player.scale.y = V.damp(this.player.scale.y, sliding ? 0.55 : 1, 14, dt);

    // --- spring arm
    const drop = sliding ? T.camera.slideHeight : 0;
    const target = new THREE.Vector3(pos.x, pos.y + T.camera.height - drop, pos.z);
    this.camTarget.lerp(target, 1 - Math.exp(-T.camera.lagPos * dt));

    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const fwd = new THREE.Vector3(-Math.sin(yaw) * cp, sp, -Math.cos(yaw) * cp);
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    // Overspeed extends the arm — reads as "you are going fast" in third person.
    const over = Math.max(0, V.lenH(p.vel) - currentCap(p)) / T.momentum.hardCap;
    let want = T.camera.distance * (1 + over * 0.35);

    const dir = fwd.clone().negate();
    const hit = castRay(
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

    // roll + fov feedback
    const wantRoll = sliding ? T.camera.slideRoll
      : p.state === 'wallrunning' ? T.camera.wallRoll * p.wallSide
        : 0;
    this.roll = V.damp(this.roll, wantRoll, 10, dt);
    this.camera.rotateZ(this.roll);

    const wantFov = T.camera.fovBase
      + (p.state === 'dashing' ? T.camera.fovDash : 0)
      + (p.state === 'wallrunning' ? T.camera.fovDash * 0.5 : 0)
      + over * T.camera.fovSpeed;
    this.fov = V.damp(this.fov, wantFov, T.camera.fovRate, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    this.trail.visible = this.showTrail;
    this.renderer.render(this.scene, this.camera);
  }
}
