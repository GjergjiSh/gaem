// Level editor — the simplest thing that works. F2 toggles it: the sim freezes,
// the camera becomes an orbit rig, and brushes are edited with three.js
// TransformControls gizmos (drag the handles to move / rotate / scale).
//
// All edits mutate `level` (the live singleton) directly. Visuals rebuild
// immediately; physics colliders rebuild on exit / level switch, which is when
// they next matter. The working level autosaves to localStorage.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { level, loadLevel, setLevelData, LEVEL_NAMES, EDIT_STORE_KEY } from '../levels';
import type { Brush } from '../levels';
import type { Renderer } from '../engine/render';
import type { RapierWorld } from '../engine/physics';
import { typingInAField } from '../engine/input';
import type { V3 } from '../core/vec';

const BRUSH_COLOR = 0x8b5cf6;

export class Editor {
  active = false;
  private orbit: OrbitControls;
  private gizmo: TransformControls;
  private ray = new THREE.Raycaster();
  private selected: THREE.Mesh | null = null;
  private toolbar!: HTMLDivElement;
  private levelSelect!: HTMLSelectElement;
  private modeButtons: Record<string, HTMLButtonElement> = {};
  private snap = true;
  private downAt = { x: 0, y: 0 };

  constructor(
    private gfx: Renderer,
    private world: RapierWorld,
    private hooks: {
      playerPos: () => V3;
      /** Fired on exit and on level switch — main resets the run/ghost/player. */
      onWorldChanged: () => void;
    },
  ) {
    const canvas = gfx.renderer.domElement;

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

    canvas.addEventListener('pointerdown', (e) => {
      this.downAt = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!this.active || e.button !== 0) return;
      if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 4) return;
      if ((this.gizmo as any).dragging || (this.gizmo as any).axis) return;
      this.pick(e.clientX, e.clientY);
    });

    addEventListener('keydown', (e) => {
      if (typingInAField(e)) return;
      if (e.code === 'F2') { e.preventDefault(); this.toggle(); }
      if (!this.active) return;
      if (e.code === 'Delete' || e.code === 'Backspace') this.deleteSelected();
    });
    addEventListener('beforeunload', () => { if (this.active) this.autosave(); });

    this.buildToolbar();
  }

  toggle() { this.active ? this.exit() : this.enter(); }

  enter() {
    this.active = true;
    document.body.classList.add('editing');
    document.exitPointerLock?.();
    this.toolbar.style.display = '';
    // Frame the player's spot: orbit around where they stand, camera pulled back.
    const p = this.hooks.playerPos();
    this.orbit.target.set(p.x, p.y, p.z);
    this.gfx.camera.position.set(p.x + 14, p.y + 18, p.z + 22);
    this.gfx.camera.up.set(0, 1, 0);
    this.orbit.enabled = true;
    this.gizmo.enabled = true;
  }

  exit() {
    this.active = false;
    document.body.classList.remove('editing');
    this.toolbar.style.display = 'none';
    this.select(null);
    this.orbit.enabled = false;
    this.gizmo.enabled = false;
    this.autosave();
    this.world.rebuildLevel(level.brushes);
    this.hooks.onWorldChanged();
  }

  /** Per-frame while active: damped orbit motion. */
  update() { this.orbit.update(); }

  // ------------------------------------------------------------ selection

  private pick(cx: number, cy: number) {
    const r = this.gfx.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((cx - r.left) / r.width) * 2 - 1,
      -((cy - r.top) / r.height) * 2 + 1,
    );
    this.ray.setFromCamera(ndc, this.gfx.camera);
    const hit = this.ray.intersectObjects(this.gfx.brushMeshes, false)[0];
    this.select(hit ? (hit.object as THREE.Mesh) : null);
  }

  private select(mesh: THREE.Mesh | null) {
    if (this.selected) {
      (this.selected.material as THREE.MeshLambertMaterial).emissive.setHex(0);
    }
    this.selected = mesh;
    if (mesh) {
      (mesh.material as THREE.MeshLambertMaterial).emissive.setHex(0x2a3550);
      this.gizmo.attach(mesh);
    } else {
      this.gizmo.detach();
    }
  }

  /** Gizmo drag → brush data. Mesh transform IS the brush transform (unit geometry). */
  private writeBack() {
    if (!this.selected) return;
    const b = level.brushes[this.selected.userData.brushIndex];
    if (!b) return;
    const m = this.selected;
    m.scale.set(Math.max(0.1, m.scale.x), Math.max(0.1, m.scale.y), Math.max(0.1, m.scale.z));
    const f = (v: number) => Math.round(v * 1000) / 1000;
    b.p = [f(m.position.x), f(m.position.y), f(m.position.z)];
    b.s = [f(m.scale.x), f(m.scale.y), f(m.scale.z)];
    b.q = [f(m.quaternion.x), f(m.quaternion.y), f(m.quaternion.z), f(m.quaternion.w)];
    delete b.r;
  }

  // ------------------------------------------------------------ edits

  private rebuildVisual(selectIndex: number | null) {
    this.select(null);
    this.gfx.buildLevel();
    if (selectIndex !== null && this.gfx.brushMeshes[selectIndex]) {
      this.select(this.gfx.brushMeshes[selectIndex]);
    }
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
    this.rebuildVisual(level.brushes.length - 1);
  }

  private duplicateSelected() {
    if (!this.selected) return;
    const src = level.brushes[this.selected.userData.brushIndex];
    const copy: Brush = JSON.parse(JSON.stringify(src));
    copy.p = [copy.p[0] + 2, copy.p[1], copy.p[2] + 2];
    level.brushes.push(copy);
    this.rebuildVisual(level.brushes.length - 1);
  }

  private deleteSelected() {
    if (!this.selected) return;
    level.brushes.splice(this.selected.userData.brushIndex, 1);
    this.rebuildVisual(null);
  }

  private setSpawnHere() {
    const t = this.orbit.target;
    level.spawn = { x: t.x, y: t.y + 1.5, z: t.z };
  }

  private switchLevel(name: string) {
    if (!loadLevel(name)) return;
    this.select(null);
    this.gfx.buildLevel();
    this.world.rebuildLevel(level.brushes);
    this.hooks.onWorldChanged();
    const p = level.spawn;
    this.orbit.target.set(p.x, p.y, p.z);
    this.gfx.camera.position.set(p.x + 14, p.y + 18, p.z + 22);
  }

  private autosave() {
    localStorage.setItem(EDIT_STORE_KEY, JSON.stringify(level));
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
        this.select(null);
        this.gfx.buildLevel();
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

  private setMode(mode: 'translate' | 'rotate' | 'scale') {
    this.gizmo.setMode(mode);
    for (const [name, btn] of Object.entries(this.modeButtons)) {
      btn.style.background = name === mode ? '#3b82f6' : '#1f2937';
    }
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

    this.modeButtons['translate'] = btn('move', () => this.setMode('translate'));
    this.modeButtons['rotate'] = btn('rotate', () => this.setMode('rotate'));
    this.modeButtons['scale'] = btn('scale', () => this.setMode('scale'));
    const snapBtn = btn('snap: on', () => {
      this.snap = !this.snap;
      snapBtn.textContent = `snap: ${this.snap ? 'on' : 'off'}`;
      this.applySnap();
    });
    btn('+ block', () => this.addBrush('box'));
    btn('+ pyramid', () => this.addBrush('pyramid'));
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

    btn('save json', () => this.download());
    btn('load json', () => this.upload());
    btn('play [F2]', () => this.exit());

    document.body.append(this.toolbar);
    this.setMode('translate');
  }
}
