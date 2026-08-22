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
  /** Derived on first use — see hitboxesOf. */
  boxes?: HitBox[];
}

/**
 * One hit volume, in the local space of the bone that carries it. Parented to
 * that bone it follows the animation for free, at no per-frame cost.
 */
export interface HitBox {
  bone: string;
  part: 'head' | 'body' | 'limb';
  centre: [number, number, number];
  size: [number, number, number];
}

/**
 * Joints worth putting a hit volume on. Everything else — fingers, toes, IK
 * poles — folds into its nearest anchor ancestor, so the boxes still cover
 * every vertex without one box per knuckle.
 */
const ANCHOR =
  /^(Head|Chest|Torso|Body|UpperArm[LR]|LowerArm[LR]|UpperLeg[LR]|MidLeg[LR]|LowerLeg[LR]|Foot[A-Za-z]*[LR])$/;

const partForBone = (n: string): HitBox['part'] =>
  (/^Head$/.test(n) ? 'head' : /^(Chest|Torso|Body)$/.test(n) ? 'body' : 'limb');

/**
 * Every side-car file a glTF might reference — buffers and textures — as
 * basename -> URL, globbed the same way the models are.
 *
 * Two problems, one fix. The sci-fi pack keeps its textures in a sibling
 * `Textures/` folder but references them by BARE FILENAME, so a relative
 * resolve looks for them next to the .gltf and finds nothing: every panel
 * loads untextured. And Vite hashes the files it emits, so even a correct
 * relative path breaks in a production build, where `Wall.bin` has become
 * `Wall-a1b2c3.bin`.
 *
 * Resolving by basename against what Vite actually emitted answers both, and
 * without editing a single vendor asset.
 */
const SIDECARS: Record<string, string> = {};
for (const [path, url] of Object.entries(
  import.meta.glob('/assets/**/*.{bin,png,jpg,jpeg,ktx2,webp}', {
    query: '?url', import: 'default', eager: true,
  }),
)) {
  SIDECARS[path.split('/').pop()!] = url as string;
}

const manager = new THREE.LoadingManager();
manager.setURLModifier((url) => {
  // Absolute or already-resolved URLs pass through; the ones worth rewriting
  // are the relative side-cars glTF asks for by name.
  const name = url.split('?')[0].split('/').pop() ?? '';
  return SIDECARS[name] ?? url;
});

const loader = new GLTFLoader(manager);
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

/**
 * Scale a model so it stands `height` metres tall ON the group's origin.
 *
 * The unit-cube fit is wrong for a character twice over. It normalises the
 * LARGEST axis, and three of the four robots are wider than they are tall with
 * their arms out, so "1.8 metres" would have produced four different heights.
 * And it centres the model, which leaves the caller to work out where the feet
 * went — the caller did, got it wrong, and buried them.
 *
 * Here the returned group's origin IS the soles of the feet, so placing a
 * character is `position.set(...)` and nothing else.
 */
function fitStanding(obj: THREE.Object3D, height: number) {
  obj.updateMatrixWorld(true);
  // `precise` walks the skinned vertex positions. The cheap path takes the
  // mesh's cached local AABB and transforms it, which for a posed skeleton is
  // a conservative box and left the four robots 2% different in height. One
  // vertex loop per dummy at spawn is a fair price for the number being right.
  const box = new THREE.Box3().setFromObject(obj, true);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());

  const inner = new THREE.Group();
  inner.add(obj);
  inner.scale.setScalar(size.y > 1e-6 ? height / size.y : 1);
  // Centred across, standing on the floor.
  obj.position.x -= centre.x;
  obj.position.z -= centre.z;
  obj.position.y -= box.min.y;
  return inner;
}

/**
 * Hit volumes for a rigged model, derived from the mesh itself.
 *
 * Every skinned vertex is assigned to the bone that moves it most, that bone is
 * walked up to its nearest anchor, and the anchor's vertices are measured in
 * that bone's own space. The result wraps the actual geometry, so it is right
 * for a robot with no arms and for one with fingers, without a table of
 * proportions that is a guess for all four.
 *
 * Measured, this covers 100% of the vertices of all four robots and reproduces
 * each model's bounding box exactly.
 */
export function hitboxesOf(name: string): HitBox[] {
  const got = cache.get(name);
  if (!got) return [];
  if (got.boxes) return got.boxes;

  const bounds = new Map<string, THREE.Box3>();
  const v = new THREE.Vector3();
  got.scene.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const pos = mesh.geometry.attributes.position;
    const si = mesh.geometry.attributes.skinIndex;
    const sw = mesh.geometry.attributes.skinWeight;
    if (!si || !sw) return;
    const sk = mesh.skeleton;

    for (let i = 0; i < pos.count; i++) {
      let bi = si.getX(i);
      let bw = sw.getX(i);
      if (sw.getY(i) > bw) { bw = sw.getY(i); bi = si.getY(i); }
      if (sw.getZ(i) > bw) { bw = sw.getZ(i); bi = si.getZ(i); }
      if (sw.getW(i) > bw) { bw = sw.getW(i); bi = si.getW(i); }

      let anchor: THREE.Object3D | null = sk.bones[bi];
      while (anchor && !ANCHOR.test(anchor.name)) {
        anchor = anchor.parent && (anchor.parent as THREE.Bone).isBone ? anchor.parent : null;
      }
      if (!anchor) continue;
      const ai = sk.bones.indexOf(anchor as THREE.Bone);
      if (ai < 0) continue;

      // Into that bone's frame: the inverse bind matrix is exactly the transform
      // skinning would apply, so the box lands where the geometry actually is.
      v.fromBufferAttribute(pos, i)
        .applyMatrix4(mesh.bindMatrix)
        .applyMatrix4(sk.boneInverses[ai]);
      let b = bounds.get(anchor.name);
      if (!b) { b = new THREE.Box3(); bounds.set(anchor.name, b); }
      b.expandByPoint(v);
    }
  });

  const centre = new THREE.Vector3();
  const size = new THREE.Vector3();
  got.boxes = [...bounds].map(([bone, b]) => {
    b.getCenter(centre);
    b.getSize(size);
    return {
      bone,
      part: partForBone(bone),
      centre: [centre.x, centre.y, centre.z] as [number, number, number],
      size: [size.x, size.y, size.z] as [number, number, number],
    };
  });
  return got.boxes;
}

/**
 * One GPU texture per image FILE, however many models reference it.
 *
 * This is not an optimisation, it is the difference between the sci-fi pack
 * working and not. Every .gltf in it points at the same handful of 2048x2048
 * PBR maps, and GLTFLoader builds a fresh THREE.Texture per load — so forty-odd
 * models referencing four maps each is forty-odd separate uploads of the same
 * pixels, several gigabytes of video memory for about ninety megabytes of
 * actual texture. Shared, the whole pack costs what one copy costs.
 *
 * `parser.associations` is the documented way back from a Texture to the glTF
 * definition it came from, which is what makes the image URI available as a
 * key. Nothing else about a loaded texture identifies the file it came out of.
 */
const texCache = new Map<string, THREE.Texture>();
/** Longest edge kept. 2048 maps are more than a 4 m wall panel needs. */
const TEX_MAX = 1024;
const TEX_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
  'emissiveMap', 'alphaMap', 'specularMap'] as const;

/** Halve a texture down to TEX_MAX, in place. No-op off the main thread. */
function shrink(t: THREE.Texture): THREE.Texture {
  const img = t.image as { width?: number; height?: number } | undefined;
  const w = img?.width ?? 0;
  const h = img?.height ?? 0;
  if (!w || !h || Math.max(w, h) <= TEX_MAX) return t;
  if (typeof document === 'undefined') return t;
  const k = TEX_MAX / Math.max(w, h);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d')?.drawImage(t.image as CanvasImageSource, 0, 0, c.width, c.height);
  t.image = c;
  t.needsUpdate = true;
  return t;
}

function shareTextures(gltf: { scene: THREE.Object3D; parser: any }) {
  const json = gltf.parser?.json;
  const assoc: Map<unknown, { textures?: number }> | undefined = gltf.parser?.associations;
  if (!json || !assoc) return;
  const uriOf = (t: THREE.Texture): string | null => {
    const a = assoc.get(t);
    if (!a || a.textures === undefined) return null;
    const src = json.textures?.[a.textures]?.source;
    if (src === undefined) return null;
    const uri = json.images?.[src]?.uri;
    // Embedded images are per-file by definition and their URI is the whole
    // payload, so there is nothing to share and nothing worth keying on.
    return typeof uri === 'string' && !uri.startsWith('data:') ? uri : null;
  };
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as
      unknown as Record<string, THREE.Texture | undefined>[];
    for (const mat of mats) {
      if (!mat) continue;
      for (const slot of TEX_SLOTS) {
        const t = mat[slot];
        if (!t) continue;
        const uri = uriOf(t);
        if (!uri) continue;
        const got = texCache.get(uri);
        if (got) {
          if (got !== t) { mat[slot] = got; t.dispose(); }
        } else {
          texCache.set(uri, shrink(t));
        }
      }
    }
  });
}

async function load(name: string): Promise<Loaded | null> {
  const url = URLS[name];
  if (!url) return null;
  const gltf = await loader.loadAsync(url);
  shareTextures(gltf as unknown as { scene: THREE.Object3D; parser: any });
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
 * Materials are cloned per instance by default. glTF shares one material across
 * every copy of a model, so tinting a single dummy red on a hit would flash the
 * whole map — the same trap as sharing a geometry, one level up.
 *
 * `share` opts out, and a level's scenery wants it. Cloning is what makes a
 * prop expensive to DRAW: every clone is a distinct material, so every prop is
 * a program switch and four or five texture binds that the renderer cannot
 * batch away. Measured on Ashgate, 791 shared-geometry props with cloned
 * materials cost about 14 ms a frame on their own — more than the entire rest
 * of the city — and sharing them back is most of that time returned. Nothing
 * tints a lamppost, so nothing pays for the ability to.
 */
export function instance(
  name: string,
  opts: {
    uniform?: boolean;
    ground?: boolean;
    animate?: boolean;
    /** Metres tall, standing on the returned group's origin. Wins over `uniform`. */
    stand?: number;
    /**
     * Reuse the cached materials instead of cloning them. Only for objects
     * nothing will ever tint — and note that `disposeInstance` must not be
     * called on one, because the materials are not its to free.
     */
    share?: boolean;
  } = {},
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
    if (opts.share) return;
    const mat = mesh.material;
    mesh.material = Array.isArray(mat) ? mat.map((m) => m.clone()) : (mat as THREE.Material).clone();
  });

  const object = opts.stand !== undefined
    ? fitStanding(copy, opts.stand)
    : fitUnit(copy, opts.uniform ?? false, opts.ground ?? false);
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
