// Level editor — F2 toggles it: the sim freezes, the camera becomes an orbit rig
// you can also fly, and both BRUSHES and ENEMY SPAWNS are edited with three.js
// TransformControls gizmos.
//
// Two selectable kinds, because a level is not only its geometry:
//
//   brushes  move / rotate / scale, written back to level.brushes
//   enemies  move only — a spawn point has a position and nothing else, so
//            selecting one forces translate mode rather than offering handles
//            that cannot be saved. The gizmo attaches to the REAL dummy rather
//            than a proxy marker, so what you drag is what you will fight, and
//            dummies rebuild without spawn jitter while editing: you cannot
//            place a spawn by dragging something that respawns four metres away.
//
// Selection is a LIST, and everything in it transforms together. The gizmo never
// attaches to a brush directly — it attaches to a pivot placed at the selection's
// centroid, with the selected objects re-parented under it. That is the whole
// trick: three.js `attach()` re-parents while preserving world transforms, so one
// gizmo drag moves twenty brushes correctly, and a single selection behaves
// exactly as it did before because its centroid is its own origin.
//
// Keys: 1/2/3 move/rotate/scale · WASD+QE fly (shift = fast) · shift+click adds
// to the selection · ctrl+drag box-selects · ctrl+C/V copy and paste ·
// Delete removes.
//
// All edits mutate `level` (the live singleton) directly. Visuals rebuild
// immediately; physics colliders rebuild on exit / level switch, which is when
// they next matter.
//
// SAVING: every edit writes `src/levels/tracks/<level>.level.json` about a third
// of a second later. Not on exit, not on unload — a level is source, and it
// belongs on disk while you work, where git can see it and a crashed tab cannot
// take it with it. "save json" is still there, and is now purely for backups:
// download a copy before you start wrecking something.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { level, loadLevel, setLevelData, noteTrackSaved, trackPath, LEVEL_NAMES, EDIT_STORE_KEY } from '../levels';
import { CAN_WRITE, saveJson, beaconJson, stamp } from './devsave';
import type { Brush } from '../levels';
import type { Renderer } from '../engine/render';
import type { RapierWorld } from '../engine/physics';
import type { Enemies } from '../engine/enemies';
import { typingInAField } from '../engine/input';
import { MODEL_NAMES, warm } from '../engine/models';
import type { V3 } from '../core/vec';

const BRUSH_COLOR = 0x8b5cf6;
const HILITE = 0x2a3550;
/** Editor fly speed, metres/sec. Shift multiplies it. */
const FLY_SPEED = 34;
const FLY_FAST = 4;

type Mode = 'translate' | 'rotate' | 'scale';

/** One selected thing. `home` is where it goes back to when the pivot lets go. */
interface Sel {
  kind: 'brush' | 'enemy';
  index: number;
  obj: THREE.Object3D;
  home: THREE.Object3D;
}

interface Clip {
  brushes: Brush[];
  enemies: [number, number, number][];
  centre: THREE.Vector3;
}

export class Editor {
  active = false;
  private orbit: OrbitControls;
  private gizmo: TransformControls;
  private ray = new THREE.Raycaster();
  private selection: Sel[] = [];
  /** What the gizmo actually holds. Selected objects hang off it while selected. */
  private pivot = new THREE.Group();
  private clip: Clip | null = null;
  private mode: Mode = 'translate';
  private toolbar!: HTMLDivElement;
  private levelSelect!: HTMLSelectElement;
  private status!: HTMLSpanElement;
  private modelSelect!: HTMLSelectElement;
  private decorBox!: HTMLLabelElement;
  private decorCheck!: HTMLInputElement;
  /** Unsaved edits pending, and the debounce timer that will write them. */
  private dirty = false;
  private saveT = 0;
  private writing = false;
  private queued = false;
  /** The level as last written or loaded, so a no-op edit writes nothing. */
  private lastJson = JSON.stringify(level);
  /** Where the last write went, or why it did not. Shown in the toolbar. */
  private savedNote = '';
  private modeButtons: Record<string, HTMLButtonElement> = {};
  private snap = true;
  private downAt = { x: 0, y: 0 };
  /** Live box-select. Null when not dragging one. */
  private marquee: { x0: number; y0: number; x1: number; y1: number; add: boolean } | null = null;
  private marqueeEl!: HTMLDivElement;
  /** Orbit's own enabled flag, parked while a box drag borrows the mouse. */
  private orbitWas = false;
  /** Held keys for the fly camera. The map is 268m across; orbiting to the far
   *  side of it one drag at a time is not navigation. */
  private flyKeys = new Set<string>();
  private lastFly = 0;

  constructor(
    private gfx: Renderer,
    private world: RapierWorld,
    private enemies: Enemies,
    private hooks: {
      playerPos: () => V3;
      /** Fired on exit and on level switch — main resets the run/ghost/player. */
      onWorldChanged: () => void;
    },
  ) {
    const canvas = gfx.renderer.domElement;
    gfx.scene.add(this.pivot);

    this.orbit = new OrbitControls(gfx.camera, canvas);
    this.orbit.enabled = false;
    this.orbit.enableDamping = true;

    this.gizmo = new TransformControls(gfx.camera, canvas);
    this.gizmo.enabled = false;
    gfx.scene.add(this.gizmo.getHelper());
    this.gizmo.addEventListener('dragging-changed', (e: any) => {
      this.orbit.enabled = this.active && !e.value;
    });
    this.gizmo.addEventListener('objectChange', () => this.writeBack());
    this.applySnap();

    this.buildMarquee();

    canvas.addEventListener('pointerdown', (e) => {
      this.downAt = { x: e.clientX, y: e.clientY };
      if (!this.active || e.button !== 0) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      // Never over the gizmo: ctrl-dragging an axis handle should still move
      // the thing you are holding.
      if ((this.gizmo as any).dragging || (this.gizmo as any).axis) return;
      e.preventDefault();
      // OrbitControls has already seen this same pointerdown — its listener was
      // registered first and there is no ordering trick that beats it. But its
      // MOVE handler re-checks `enabled` every event, so switching it off here
      // stops the drag from also spinning the camera.
      this.orbitWas = this.orbit.enabled;
      this.orbit.enabled = false;
      this.marquee = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, add: e.shiftKey };
      this.drawMarquee();
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!this.marquee) return;
      this.marquee.x1 = e.clientX;
      this.marquee.y1 = e.clientY;
      this.drawMarquee();
    });

    canvas.addEventListener('pointerup', (e) => {
      if (this.marquee) return;      // the window handler below owns this gesture
      if (!this.active || e.button !== 0) return;
      if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 4) return;
      if ((this.gizmo as any).dragging || (this.gizmo as any).axis) return;
      this.pick(e.clientX, e.clientY, e.shiftKey);
    });

    // Finishing the drag is on WINDOW, because letting go outside the viewport
    // still has to end it or the rectangle stays painted on screen. Only the
    // finish, though — the click-pick above stays on the canvas, or a click on
    // a toolbar button would bubble up here and select whatever is behind it.
    addEventListener('pointerup', () => {
      if (!this.marquee) return;
      const m = this.marquee;
      this.endMarquee();
      // A ctrl-click that never really moved is a click. Treat it as one rather
      // than selecting the empty set and wiping what was held.
      if (Math.hypot(m.x1 - m.x0, m.y1 - m.y0) <= 4) this.pick(m.x0, m.y0, m.add);
      else this.boxSelect(m);
    });
    addEventListener('pointercancel', () => { if (this.marquee) this.endMarquee(); });

    addEventListener('keydown', (e) => {
      if (typingInAField(e)) return;
      if (e.code === 'F2') { e.preventDefault(); this.toggle(); }
      if (!this.active) return;

      if (e.ctrlKey || e.metaKey) {
        if (e.code === 'KeyC') { e.preventDefault(); this.copy(); }
        if (e.code === 'KeyV') { e.preventDefault(); this.paste(); }
        if (e.code === 'KeyD') { e.preventDefault(); this.duplicateSelected(); }
        return;                      // ctrl+W etc. must not also fly the camera
      }
      if (e.code === 'Escape' && this.marquee) { this.endMarquee(); return; }
      if (e.code === 'Delete' || e.code === 'Backspace') this.deleteSelected();
      if (e.code === 'Digit1') this.setMode('translate');
      if (e.code === 'Digit2') this.setMode('rotate');
      if (e.code === 'Digit3') this.setMode('scale');
      if (e.code === 'Escape') this.clearSelection();
      this.flyKeys.add(e.code);
    });
    addEventListener('keyup', (e) => this.flyKeys.delete(e.code));
    addEventListener('blur', () => this.flyKeys.clear());
    // Teardown: flush the pending write, and send it by beacon as well — fetch()
    // is abandoned when the page goes away, sendBeacon is not.
    const flush = () => {
      if (this.saveT) { clearTimeout(this.saveT); this.saveT = 0; }
      this.autosave();
      if (CAN_WRITE && this.dirty) beaconJson(trackPath(level.name), level);
    };
    addEventListener('pagehide', flush);
    addEventListener('beforeunload', flush);

    this.buildToolbar();
  }

  toggle() { this.active ? this.exit() : this.enter(); }

  enter() {
    this.active = true;
    document.body.classList.add('editing');
    document.exitPointerLock?.();
    // Drop focus out of whatever it was in. Every key here is gated on
    // typingInAField, so opening the editor straight from a tuning slider would
    // otherwise leave the whole keyboard dead with nothing on screen saying why.
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.toolbar.style.display = '';
    // Frame the player's spot: orbit around where they stand, camera pulled back.
    const p = this.hooks.playerPos();
    this.orbit.target.set(p.x, p.y, p.z);
    this.gfx.camera.position.set(p.x + 14, p.y + 18, p.z + 22);
    this.gfx.camera.up.set(0, 1, 0);
    this.orbit.enabled = true;
    this.gizmo.enabled = true;
    this.lastFly = performance.now();
    this.flyKeys.clear();
    // Exact positions and everything standing: you cannot edit spawn points
    // through a set of dummies that are jittered off them and possibly dead.
    this.enemies.rebuild(true);
    this.refreshStatus();
  }

  exit() {
    this.active = false;
    document.body.classList.remove('editing');
    this.toolbar.style.display = 'none';
    // F2 mid-drag: the rectangle would otherwise stay painted over the game.
    if (this.marquee) this.endMarquee();
    this.clearSelection();
    this.orbit.enabled = false;
    this.gizmo.enabled = false;
    this.flyKeys.clear();
    this.autosave();
    this.world.rebuildLevel(level.brushes);
    this.hooks.onWorldChanged();
  }

  /**
   * Per-frame while active: fly the camera, then damped orbit motion.
   *
   * Axes come from the CAMERA's own matrix, not from `forward x up`. Looking
   * straight down — the most natural thing to do in an orbit editor — makes that
   * cross product zero and silently kills strafing.
   *
   * The orbit TARGET moves with the camera, so orbiting still works from
   * wherever you flew to instead of snapping back to where you started.
   */
  update() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFly) / 1000);
    this.lastFly = now;

    if (this.flyKeys.size) {
      const cam = this.gfx.camera;
      cam.updateMatrixWorld();
      const on = (...codes: string[]) => codes.some((c) => this.flyKeys.has(c));
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
      const fwd = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 2).negate();
      const move = new THREE.Vector3();
      if (on('KeyW')) move.add(fwd);
      if (on('KeyS')) move.sub(fwd);
      if (on('KeyD')) move.add(right);
      if (on('KeyA')) move.sub(right);
      if (on('KeyE', 'Space')) move.y += 1;
      if (on('KeyQ')) move.y -= 1;
      if (move.lengthSq() > 1e-6) {
        const speed = FLY_SPEED * (on('ShiftLeft', 'ShiftRight') ? FLY_FAST : 1);
        move.normalize().multiplyScalar(speed * dt);
        cam.position.add(move);
        this.orbit.target.add(move);
      }
    }

    this.orbit.update();
  }

  // ------------------------------------------------------------ box select

  private buildMarquee() {
    this.marqueeEl = document.createElement('div');
    this.marqueeEl.style.cssText = `
      position:fixed; z-index:25; display:none; pointer-events:none;
      border:1px solid rgba(125,211,252,.95);
      background:rgba(56,189,248,.14);`;
    document.body.append(this.marqueeEl);
  }

  private drawMarquee() {
    const m = this.marquee;
    if (!m) { this.marqueeEl.style.display = 'none'; return; }
    this.marqueeEl.style.display = 'block';
    this.marqueeEl.style.left = `${Math.min(m.x0, m.x1)}px`;
    this.marqueeEl.style.top = `${Math.min(m.y0, m.y1)}px`;
    this.marqueeEl.style.width = `${Math.abs(m.x1 - m.x0)}px`;
    this.marqueeEl.style.height = `${Math.abs(m.y1 - m.y0)}px`;
  }

  private endMarquee() {
    this.marquee = null;
    this.marqueeEl.style.display = 'none';
    this.orbit.enabled = this.orbitWas;
  }

  /**
   * Everything whose CENTRE falls inside the rectangle.
   *
   * Centres rather than outlines, deliberately. Testing a projected bounding box
   * for overlap sounds more generous, but the decks here are 22 metres across —
   * their screen box covers most of the viewport, so almost any drag anywhere
   * would sweep up every platform in sight. "Put the box around the middles of
   * the things you want" is a rule you can aim with.
   *
   * No occlusion test: something behind a platform still selects. This is an
   * editor, and the thing you cannot see is usually exactly the thing you were
   * trying to get at.
   */
  private boxSelect(m: { x0: number; y0: number; x1: number; y1: number; add: boolean }) {
    const canvas = this.gfx.renderer.domElement;
    const r = canvas.getBoundingClientRect();
    const cam = this.gfx.camera;
    cam.updateMatrixWorld();

    const lo = { x: Math.min(m.x0, m.x1), y: Math.min(m.y0, m.y1) };
    const hi = { x: Math.max(m.x0, m.x1), y: Math.max(m.y0, m.y1) };
    const world = new THREE.Vector3();

    /** Screen position, or null if it is behind the camera. */
    const onScreen = (p: THREE.Vector3) => {
      // View space first: the camera looks down -Z, so anything at z >= 0 is
      // behind it. project() alone is not enough — it flips the sign of points
      // behind the lens and lands them back inside the rectangle.
      const view = p.clone().applyMatrix4(cam.matrixWorldInverse);
      if (view.z >= 0) return null;
      const ndc = p.clone().project(cam);
      return {
        x: r.left + (ndc.x * 0.5 + 0.5) * r.width,
        y: r.top + (-ndc.y * 0.5 + 0.5) * r.height,
      };
    };
    const inside = (p: { x: number; y: number } | null) =>
      !!p && p.x >= lo.x && p.x <= hi.x && p.y >= lo.y && p.y <= hi.y;

    if (!m.add) this.clearSelection();

    for (const mesh of this.gfx.brushMeshes) {
      const index = mesh.userData.brushIndex;
      if (index === undefined) continue;
      mesh.getWorldPosition(world);
      if (!inside(onScreen(world))) continue;
      this.addToSelection('brush', index, true);
    }
    // aliveTargets is one entry per DUMMY at chest height. Going through the
    // hit meshes instead would offer the same robot a dozen times, once per
    // bone box, and put its selection marker on a shin.
    for (const t of this.enemies.aliveTargets()) {
      if (!inside(onScreen(t.pos))) continue;
      this.addToSelection('enemy', t.idx, true);
    }

    // Once, at the end. refreshStatus rides along and reports the new count.
    this.rebuildPivot();
  }

  // ------------------------------------------------------------ selection

  private pick(cx: number, cy: number, add: boolean) {
    const r = this.gfx.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((cx - r.left) / r.width) * 2 - 1,
      -((cy - r.top) / r.height) * 2 + 1,
    );
    this.ray.setFromCamera(ndc, this.gfx.camera);
    // Dummies are pickable alongside geometry — whichever the ray reaches first
    // wins, so a spawn standing on a platform selects instead of the platform.
    const targets = [...this.gfx.brushMeshes, ...this.enemies.aliveMeshes];
    const hit = this.ray.intersectObjects(targets, false)[0];

    if (!hit) {
      if (!add) this.clearSelection();
      return;
    }
    const mesh = hit.object as THREE.Mesh;
    // A dummy's parts carry the index of the dummy they belong to; the hook uses
    // the same mark to know whose body it bit.
    const isEnemy = mesh.userData.enemy !== undefined;
    const index = isEnemy ? mesh.userData.enemy : mesh.userData.brushIndex;
    const kind: Sel['kind'] = isEnemy ? 'enemy' : 'brush';

    const existing = this.selection.findIndex((s) => s.kind === kind && s.index === index);
    if (add && existing >= 0) {
      // Shift-clicking something already held takes it back out again.
      const [gone] = this.selection.splice(existing, 1);
      this.release(gone);
      this.rebuildPivot();
      return;
    }
    if (!add) this.clearSelection();
    this.addToSelection(kind, index);
  }

  /**
   * `defer` skips the pivot rebuild, for callers adding many at once. Rebuilding
   * per item re-parents the whole selection every time, which is quadratic — a
   * box drag over a few hundred brushes would visibly hitch.
   */
  private addToSelection(kind: Sel['kind'], index: number, defer = false) {
    const obj = kind === 'enemy'
      ? this.enemies.rootOf(index)
      : this.gfx.brushMeshes[index];
    if (!obj || !obj.parent) return;
    if (this.selection.some((s) => s.kind === kind && s.index === index)) return;
    this.selection.push({ kind, index, obj, home: obj.parent });
    this.highlight(kind, index, true);
    if (!defer) this.rebuildPivot();
  }

  /** Re-establish a selection from indices, after a rebuild invalidated the objects. */
  private selectIndices(brushes: number[], enemies: number[]) {
    this.clearSelection();
    for (const i of brushes) this.addToSelection('brush', i);
    for (const i of enemies) this.addToSelection('enemy', i);
  }

  private highlight(kind: Sel['kind'], index: number, on: boolean) {
    if (kind === 'enemy') { this.enemies.highlight(index, on); return; }
    const mesh = this.gfx.brushMeshes[index];
    if (mesh) (mesh.material as THREE.MeshLambertMaterial).emissive.setHex(on ? HILITE : 0);
  }

  /** Hand one object back to the group it came from, keeping it where it looks. */
  private release(s: Sel) {
    s.home.attach(s.obj);
    this.highlight(s.kind, s.index, false);
  }

  private clearSelection() {
    for (const s of this.selection) this.release(s);
    this.selection = [];
    this.gizmo.detach();
    this.refreshStatus();
  }

  /**
   * Put the pivot at the selection's centroid with an identity rotation, hang
   * everything selected off it, and give the gizmo the pivot.
   *
   * Re-parenting is what makes a group transform correct rather than an
   * approximation: each object keeps its world transform going in, so the drag
   * applies one rotation about one centre to all of them.
   */
  private rebuildPivot() {
    if (!this.selection.length) { this.gizmo.detach(); this.refreshStatus(); return; }

    for (const s of this.selection) s.home.attach(s.obj);   // out of the old pivot

    const centre = new THREE.Vector3();
    for (const s of this.selection) centre.add(s.obj.getWorldPosition(new THREE.Vector3()));
    centre.divideScalar(this.selection.length);

    this.pivot.position.copy(centre);
    this.pivot.quaternion.identity();
    this.pivot.scale.setScalar(1);
    this.pivot.updateMatrixWorld(true);

    for (const s of this.selection) this.pivot.attach(s.obj);

    // A spawn point is a position and nothing else, so a selection containing one
    // cannot be rotated or scaled into anything saveable.
    if (this.selection.some((s) => s.kind === 'enemy') && this.mode !== 'translate') {
      this.setMode('translate');
    }
    this.gizmo.attach(this.pivot);
    this.refreshStatus();
  }

  /**
   * Gizmo drag → level data. Every object's WORLD transform is the source of
   * truth, because while selected they live under the pivot and their local
   * transform is relative to it. Brush meshes and dummy roots both sit in
   * untransformed groups, so world is exactly what gets stored.
   */
  private writeBack() {
    if (!this.selection.length) return;

    // Non-uniform scale on a group of ROTATED children is not representable as
    // per-child position/quaternion/scale — it is a shear, and decompose() would
    // quietly hand back garbage. Force it uniform rather than corrupt the level.
    if (this.selection.length > 1 && this.mode === 'scale') {
      const s = this.pivot.scale;
      const avg = (s.x + s.y + s.z) / 3;
      if (Math.abs(s.x - avg) > 1e-6 || Math.abs(s.y - avg) > 1e-6) s.setScalar(avg);
    }
    this.pivot.updateMatrixWorld(true);

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const f = (v: number) => Math.round(v * 1000) / 1000;

    for (const s of this.selection) {
      s.obj.updateWorldMatrix(true, false);
      s.obj.matrixWorld.decompose(pos, quat, scl);

      if (s.kind === 'enemy') {
        // A dummy's root sits at its FEET, which is exactly how spawns are stored.
        const list = level.enemies ?? (level.enemies = []);
        list[s.index] = [f(pos.x), f(pos.y), f(pos.z)];
        continue;
      }
      const b = level.brushes[s.index];
      if (!b) continue;
      b.p = [f(pos.x), f(pos.y), f(pos.z)];
      b.s = [f(Math.max(0.1, scl.x)), f(Math.max(0.1, scl.y)), f(Math.max(0.1, scl.z))];
      b.q = [f(quat.x), f(quat.y), f(quat.z), f(quat.w)];
      delete b.r;
    }
    this.touch();
  }

  // ------------------------------------------------------------ edits

  private rebuildVisual(selectBrushes: number[]) {
    this.clearSelection();
    this.gfx.buildLevel();
    this.selectIndices(selectBrushes, []);
  }

  /** Respawn the dummies from the edited list and keep hold of some of them. */
  private rebuildEnemies(selectEnemies: number[]) {
    this.clearSelection();
    this.enemies.rebuild(true);
    this.selectIndices([], selectEnemies);
  }

  private addBrush(kind: 'box' | 'pyramid') {
    const t = this.orbit.target;
    const b: Brush = {
      p: [Math.round(t.x), Math.round(t.y), Math.round(t.z)],
      s: kind === 'pyramid' ? [4, 3, 4] : [4, 1, 4],
      c: BRUSH_COLOR,
    };
    if (kind === 'pyramid') b.kind = 'pyramid';
    level.brushes.push(b);
    this.touch();
    this.rebuildVisual([level.brushes.length - 1]);
  }

  /**
   * Drop a spawn point where the camera is looking, standing on whatever is
   * under it. A spawn is stored as a FEET position, so placing one at the orbit
   * target directly leaves it hanging in the air over the floor you meant.
   */
  private addEnemy() {
    const t = this.orbit.target;
    const from = { x: t.x, y: t.y + 2, z: t.z };
    const drop = this.world.ray(from, { x: 0, y: -1, z: 0 }, 400);
    const y = drop === null ? t.y : from.y - drop;
    const r = (v: number) => Math.round(v * 10) / 10;
    const list = level.enemies ?? (level.enemies = []);
    list.push([r(t.x), r(y), r(t.z)]);
    this.touch();
    this.rebuildEnemies([list.length - 1]);
  }

  // ------------------------------------------------------------ clipboard

  /** The selection as portable data, plus where its centroid was. */
  private snapshot(): Clip | null {
    if (!this.selection.length) return null;
    const centre = new THREE.Vector3();
    for (const s of this.selection) centre.add(s.obj.getWorldPosition(new THREE.Vector3()));
    centre.divideScalar(this.selection.length);

    const clip: Clip = { brushes: [], enemies: [], centre };
    for (const s of this.selection) {
      if (s.kind === 'brush') {
        const b = level.brushes[s.index];
        if (b) clip.brushes.push(JSON.parse(JSON.stringify(b)));
      } else {
        const e = level.enemies?.[s.index];
        if (e) clip.enemies.push([...e] as [number, number, number]);
      }
    }
    return clip;
  }

  private copy() {
    const clip = this.snapshot();
    if (!clip) return;
    this.clip = clip;
    this.refreshStatus();
  }

  /** Drop a clip into the level, displaced by `d`, and select what landed. */
  private pasteClip(clip: Clip, d: THREE.Vector3) {
    const f = (v: number) => Math.round(v * 1000) / 1000;

    const brushIdx: number[] = [];
    for (const src of clip.brushes) {
      const b: Brush = JSON.parse(JSON.stringify(src));
      b.p = [f(b.p[0] + d.x), f(b.p[1] + d.y), f(b.p[2] + d.z)];
      level.brushes.push(b);
      brushIdx.push(level.brushes.length - 1);
    }
    const enemyIdx: number[] = [];
    if (clip.enemies.length) {
      const list = level.enemies ?? (level.enemies = []);
      for (const e of clip.enemies) {
        list.push([f(e[0] + d.x), f(e[1] + d.y), f(e[2] + d.z)]);
        enemyIdx.push(list.length - 1);
      }
    }

    this.touch();
    this.clearSelection();
    if (brushIdx.length) this.gfx.buildLevel();
    if (enemyIdx.length) this.enemies.rebuild(true);
    this.selectIndices(brushIdx, enemyIdx);
  }

  /**
   * Paste with the clipboard's centroid moved to the orbit target — copy a
   * platform, fly to where you want another one, paste. Pasting in place and
   * making you drag it out from under the original is the worse default on a map
   * this size; duplicate is the in-place version.
   */
  private paste() {
    if (!this.clip) return;
    const t = this.orbit.target;
    this.pasteClip(this.clip, new THREE.Vector3(t.x, t.y, t.z).sub(this.clip.centre));
  }

  /** Copy-and-nudge, without touching the clipboard you were holding. */
  private duplicateSelected() {
    const clip = this.snapshot();
    if (clip) this.pasteClip(clip, new THREE.Vector3(2, 0, 2));
  }

  private deleteSelected() {
    if (!this.selection.length) return;
    // Descending, or every splice shifts the indices still to be removed.
    const brushes = this.selection.filter((s) => s.kind === 'brush')
      .map((s) => s.index).sort((a, b) => b - a);
    const enemies = this.selection.filter((s) => s.kind === 'enemy')
      .map((s) => s.index).sort((a, b) => b - a);
    this.clearSelection();
    for (const i of brushes) level.brushes.splice(i, 1);
    for (const i of enemies) level.enemies?.splice(i, 1);
    this.touch();
    if (brushes.length) this.gfx.buildLevel();
    if (enemies.length) this.enemies.rebuild(true);
  }

  private setSpawnHere() {
    const t = this.orbit.target;
    level.spawn = { x: t.x, y: t.y + 1.5, z: t.z };
    this.touch();
  }

  private switchLevel(name: string) {
    // Land whatever is pending on the level you are LEAVING, before `level` is
    // overwritten and the write would go to the wrong file.
    if (this.saveT) { clearTimeout(this.saveT); this.saveT = 0; this.autosave(); }
    if (!loadLevel(name)) return;
    this.lastJson = JSON.stringify(level);
    this.dirty = false;
    this.clearSelection();
    this.gfx.buildLevel();
    this.enemies.rebuild(true);
    this.world.rebuildLevel(level.brushes);
    this.hooks.onWorldChanged();
    const p = level.spawn;
    this.orbit.target.set(p.x, p.y, p.z);
    this.gfx.camera.position.set(p.x + 14, p.y + 18, p.z + 22);
  }

  /**
   * "The level changed." Debounced, because a gizmo drag fires this on every
   * mouse-move and the write is a real HTTP round trip — 350 ms is under the
   * time it takes to let go of the mouse and reach for anything else.
   */
  private touch() {
    this.dirty = true;
    if (this.saveT) return;
    this.saveT = setTimeout(() => { this.saveT = 0; this.autosave(); }, 350) as unknown as number;
  }

  private autosave() {
    const json = JSON.stringify(level);
    localStorage.setItem(EDIT_STORE_KEY, json);
    if (!CAN_WRITE || !this.dirty) return;
    // Nothing actually changed. Selecting a brush and letting go runs writeBack,
    // and without this a stray click on a GENERATED level writes a track file
    // that then shadows the generator for good — you edit figure8.ts afterwards
    // and nothing happens, because a snapshot of the old one is now the level.
    if (json === this.lastJson) { this.dirty = false; return; }
    // Serialised: a drag can outrun the round trip, and a level file is big
    // enough that two overlapping writes are worth avoiding outright.
    if (this.writing) { this.queued = true; return; }
    this.writing = true;
    const name = level.name;
    const path = trackPath(name);
    const data = JSON.parse(JSON.stringify(level));
    void saveJson(path, data).then((r) => {
      this.writing = false;
      if (r.ok) {
        this.dirty = false;
        this.lastJson = json;
        // Keep the in-memory pristine copy in step, or re-picking this level from
        // the dropdown would restore whatever was bundled when the page loaded.
        noteTrackSaved(name, data);
        this.savedNote = `${path} · ${stamp()}`;
      } else {
        this.savedNote = `NOT SAVED: ${r.error}`;
      }
      this.refreshStatus();
      if (this.queued) { this.queued = false; this.autosave(); }
    });
  }

  private download() {
    const blob = new Blob([JSON.stringify(level, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${level.name || 'level'}.level.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private upload() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json';
    inp.onchange = async () => {
      const file = inp.files?.[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        data.name = data.name ?? file.name.replace(/\.level\.json$|\.json$/, '');
        setLevelData(data);
        this.touch();
        this.clearSelection();
        this.gfx.buildLevel();
        this.enemies.rebuild(true);
        this.world.rebuildLevel(level.brushes);
        this.hooks.onWorldChanged();
      } catch (err) {
        console.error('level load failed', err);
      }
    };
    inp.click();
  }

  private applySnap() {
    this.gizmo.setTranslationSnap(this.snap ? 0.5 : null);
    this.gizmo.setRotationSnap(this.snap ? THREE.MathUtils.degToRad(15) : null);
    this.gizmo.setScaleSnap(this.snap ? 0.25 : null);
  }

  // ------------------------------------------------------------ toolbar

  private setMode(mode: Mode) {
    this.mode = mode;
    this.gizmo.setMode(mode);
    for (const [name, btn] of Object.entries(this.modeButtons)) {
      btn.style.background = name === mode ? '#3b82f6' : '#1f2937';
    }
  }

  /** Give every selected brush a model — or take it away with the empty entry. */
  private setModel(name: string) {
    const hit = this.selection.filter((s) => s.kind === 'brush');
    if (!hit.length) return;
    for (const s of hit) {
      const b = level.brushes[s.index];
      if (!b) continue;
      if (name) b.m = name; else delete b.m;
    }
    this.touch();
    const idx = hit.map((s) => s.index);
    // The model may not be in memory yet; rebuild once it lands rather than
    // leaving the box showing and no way to tell whether the pick took.
    if (name) warm(name, () => this.rebuildVisual(idx));
    this.rebuildVisual(idx);
  }

  /**
   * Decor is drawn and never collided with. Toggling it needs the physics world
   * rebuilt, which happens on exit — the same as every other geometry edit.
   */
  private setDecor(on: boolean) {
    const hit = this.selection.filter((s) => s.kind === 'brush');
    if (!hit.length) return;
    for (const s of hit) {
      const b = level.brushes[s.index];
      if (!b) continue;
      if (on) b.d = true; else delete b.d;
    }
    this.touch();
    this.rebuildVisual(hit.map((s) => s.index));
  }

  private refreshStatus() {
    if (!this.status) return;
    const n = this.selection.length;
    const held = this.clip
      ? `  clip ${this.clip.brushes.length + this.clip.enemies.length}`
      : '';
    // Reflect the selection rather than the last thing picked, or the widgets
    // start lying the moment you click something else.
    if (this.modelSelect) {
      const brushes = this.selection
        .filter((s) => s.kind === 'brush')
        .map((s) => level.brushes[s.index])
        .filter(Boolean);
      const models = new Set(brushes.map((b) => b.m ?? ''));
      this.modelSelect.value = models.size === 1 ? [...models][0] : '';
      this.modelSelect.disabled = brushes.length === 0;
      this.decorCheck.checked = brushes.length > 0 && brushes.every((b) => b.d === true);
      this.decorCheck.disabled = brushes.length === 0;
    }
    const save = this.savedNote ? `  ·  ${this.savedNote}`
      : (CAN_WRITE ? '' : '  ·  localStorage only');
    this.status.textContent = `${n ? `${n} selected` : 'nothing selected'}${held}${save}`;
  }

  private buildToolbar() {
    this.toolbar = document.createElement('div');
    this.toolbar.style.cssText = `
      position:fixed; left:50%; bottom:14px; transform:translateX(-50%); z-index:30;
      display:flex; gap:6px; align-items:center; flex-wrap:wrap; justify-content:center;
      font:12px ui-monospace,Consolas,monospace; color:#e6edf3;
      background:rgba(10,12,18,.85); padding:8px 10px; border-radius:8px;
      border:1px solid rgba(255,255,255,.12);`;
    this.toolbar.style.display = 'none';

    const btn = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = `
        font:inherit; color:inherit; background:#1f2937; border:1px solid #374151;
        border-radius:5px; padding:4px 8px; cursor:pointer;`;
      b.onclick = fn;
      this.toolbar.append(b);
      return b;
    };

    this.modeButtons['translate'] = btn('move [1]', () => this.setMode('translate'));
    this.modeButtons['rotate'] = btn('rotate [2]', () => this.setMode('rotate'));
    this.modeButtons['scale'] = btn('scale [3]', () => this.setMode('scale'));
    const snapBtn = btn('snap: on', () => {
      this.snap = !this.snap;
      snapBtn.textContent = `snap: ${this.snap ? 'on' : 'off'}`;
      this.applySnap();
    });
    btn('+ block', () => this.addBrush('box'));
    btn('+ pyramid', () => this.addBrush('pyramid'));
    btn('+ enemy', () => this.addEnemy());
    btn('copy', () => this.copy());
    btn('paste', () => this.paste());
    btn('duplicate', () => this.duplicateSelected());
    btn('delete', () => this.deleteSelected());
    btn('spawn here', () => this.setSpawnHere());

    this.levelSelect = document.createElement('select');
    this.levelSelect.style.cssText = `
      font:inherit; color:inherit; background:#1f2937; border:1px solid #374151;
      border-radius:5px; padding:4px;`;
    for (const n of LEVEL_NAMES) {
      const o = document.createElement('option');
      o.value = n;
      o.textContent = n;
      if (n === level.name) o.selected = true;
      this.levelSelect.append(o);
    }
    this.levelSelect.onchange = () => this.switchLevel(this.levelSelect.value);
    this.toolbar.append(this.levelSelect);

    // Model picker. Applies to every selected brush, which is what makes
    // dressing a level bearable: box-select a row of railings, pick once.
    this.modelSelect = document.createElement('select');
    this.modelSelect.style.cssText = this.levelSelect.style.cssText;
    for (const [text, value] of [['— no model —', ''], ...MODEL_NAMES.map((n) => [n, n])]) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      this.modelSelect.append(o);
    }
    this.modelSelect.onchange = () => this.setModel(this.modelSelect.value);
    this.toolbar.append(this.modelSelect);

    this.decorBox = document.createElement('label');
    this.decorBox.style.cssText = 'display:flex; gap:4px; align-items:center; opacity:.85;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.onchange = () => this.setDecor(cb.checked);
    this.decorBox.append(cb, document.createTextNode('decor'));
    this.decorCheck = cb;
    this.toolbar.append(this.decorBox);

    btn('save json (backup)', () => this.download());
    btn('load json', () => this.upload());
    btn('play [F2]', () => this.exit());

    this.status = document.createElement('span');
    this.status.style.cssText = 'opacity:.7; padding-left:4px;';
    this.toolbar.append(this.status);

    const help = document.createElement('span');
    help.textContent = 'WASD+QE fly · shift fast · shift+click multi · ctrl+C/V/D';
    help.style.cssText = 'opacity:.45; padding-left:6px;';
    this.toolbar.append(help);

    document.body.append(this.toolbar);
    this.setMode('translate');
    this.refreshStatus();
  }
}
