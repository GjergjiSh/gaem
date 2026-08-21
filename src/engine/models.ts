// glTF assets: the platform kit and the robots in /assets.
//
// Everything here fits models into UNIT space — a 1x1x1 cube centred on the
// origin. That is the whole trick that keeps the asset layer out of the rest of
// the game: a brush mesh already carries `scale = brush size` with unit
// geometry, so a unit-fitted model added as its CHILD inherits the stretch for
// free. The editor's gizmo keeps working, the collider is still the box, and
// nothing about the movement guarantees changes because a model appeared.
//
// Models are decoration over collision, never collision themselves. The physics
// world is built from brushes and only from brushes.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/**
 * Every .gltf under /assets, as name -> URL. Vite rewrites these to hashed
 * asset URLs at build time and serves them straight from disk in dev, so the
 * files stay where they were dropped instead of being copied into public/.
 */
const URLS: Record<string, string> = {};
for (const [path, url] of Object.entries(
  import.meta.glob('/assets/**/*.gltf', { query: '?url', import: 'default', eager: true }),
)) {
  URLS[path.split('/').pop()!.replace(/\.gltf$/, '')] = url as string;
}

/** Sorted, for the editor's dropdown. */
export const MODEL_NAMES = Object.keys(URLS).sort();

interface Loaded {
  scene: THREE.Object3D;          // already fitted to unit space
  clips: THREE.AnimationClip[];
  skinned: boolean;
}

const loader = new GLTFLoader();
const cache = new Map<string, Loaded>();
const pending = new Map<string, Promise<Loaded | null>>();

/**
 * Scale an object so its bounding box becomes the unit cube.
 *
 * Non-uniform by default, on purpose: a structural brush is a box with its own
 * proportions and the model has to fill it, or a stretched deck leaves its
 * collider showing at the edges.
 *
 * `uniform` opts out, and props always want it. A model stretched to a box
 * drawn without regard for its shape is not a smaller or bigger prop, it is a
 * broken one — `Sign_1` is 0.062 units thick, so a brush 3.2 deep turns it into
 * a billboard the size of a building. Under a uniform fit the brush stops being
 * a shape to conform to and becomes a bounding volume: the model fits inside on
 * its tightest axis and keeps its true proportions whatever box it is given.
 *
 * `ground` then sits it on the floor of that volume rather than floating it in
 * the middle, so "where the box's base is" means "where the prop stands".
 */
function fitUnit(obj: THREE.Object3D, uniform = false, ground = false) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const sx = size.x > 1e-6 ? 1 / size.x : 1;
  const sy = size.y > 1e-6 ? 1 / size.y : 1;
  const sz = size.z > 1e-6 ? 1 / size.z : 1;

  // The wrapper exists so the fit survives whatever transform the caller then
  // puts on the returned object.
  const inner = new THREE.Group();
  inner.add(obj);
  const k = Math.min(sx, sy, sz);
  if (uniform) inner.scale.setScalar(k);
  else inner.scale.set(sx, sy, sz);
  obj.position.sub(centre);
  if (ground) {
    // Base to the object's own origin, then the origin to the box's floor.
    obj.position.y += size.y / 2;
    inner.position.y = -0.5;
  }
  return inner;
}

async function load(name: string): Promise<Loaded | null> {
  const url = URLS[name];
  if (!url) return null;
  const gltf = await loader.loadAsync(url);
  const skinned = gltf.scene.children.some((c) => c.type === 'SkinnedMesh')
    || gltf.animations.length > 0;
  return { scene: gltf.scene, clips: gltf.animations, skinned };
}

/**
 * Fetch a set of models once, up front. Called before the first frame so the
 * world is never briefly built out of nothing; anything not listed still loads
 * on demand the first time it is asked for.
 */
export async function preloadModels(names: string[]): Promise<void> {
  await Promise.all(names.map(async (n) => {
    if (cache.has(n) || !URLS[n]) return;
    let p = pending.get(n);
    if (!p) { p = load(n); pending.set(n, p); }
    const got = await p;
    if (got) cache.set(n, got);
  }));
}

export function isLoaded(name: string) { return cache.has(name); }

/** Start a load without waiting for it. Used by the editor when you pick a model. */
export function warm(name: string, then?: () => void) {
  if (cache.has(name) || !URLS[name] || pending.has(name)) return;
  const p = load(name);
  pending.set(name, p);
  void p.then((got) => { if (got) { cache.set(name, got); then?.(); } });
}

export interface Instance {
  object: THREE.Object3D;
  clips: THREE.AnimationClip[];
  /** Present only on rigged models; drive it from the frame loop. */
  mixer: THREE.AnimationMixer | null;
}

/**
 * A fresh copy, fitted to the unit cube and ready to be parented to anything.
 *
 * Materials are cloned per instance. glTF shares one material across every copy
 * of a model, so tinting a single dummy red on a hit would flash the whole map
 * — the same trap as sharing a geometry, one level up.
 */
export function instance(
  name: string,
  opts: { uniform?: boolean; ground?: boolean; animate?: boolean } = {},
): Instance | null {
  const got = cache.get(name);
  if (!got) return null;

  const copy = got.skinned
    ? (cloneSkinned(got.scene) as THREE.Object3D)
    : got.scene.clone(true);

  copy.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const mat = mesh.material;
    mesh.material = Array.isArray(mat) ? mat.map((m) => m.clone()) : (mat as THREE.Material).clone();
  });

  const object = fitUnit(copy, opts.uniform ?? false, opts.ground ?? false);
  const mixer = opts.animate && got.clips.length ? new THREE.AnimationMixer(copy) : null;
  return { object, clips: got.clips, mixer };
}

/** Free an instance's cloned materials. Geometry belongs to the cache. */
export function disposeInstance(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else (mat as THREE.Material)?.dispose();
  });
}

/** Every material in an instance, for tinting (hit flashes, editor highlight). */
export function materialsOf(obj: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const out: THREE.MeshStandardMaterial[] = [];
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material;
    if (Array.isArray(mat)) out.push(...(mat as THREE.MeshStandardMaterial[]));
    else out.push(mat as THREE.MeshStandardMaterial);
  });
  return out;
}
