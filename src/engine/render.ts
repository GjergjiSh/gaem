import * as THREE from 'three';
import { T } from '../core/tuning';
import * as V from '../core/vec';
import { currentCap } from '../core/solver';
import type { CollisionWorld, Intent, Player } from '../core/types';
import { level } from '../levels';
import type { Theme } from '../levels/types';
import { Ink } from './ink';
import { instance, warm } from './models';
import { boxFor, DEFAULT_SURFACE, materialFor, useAnisotropy } from './surfaces';

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

/** What a brush wears once a model has taken over the drawing. */
const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
/**
 * The outline every brush wears, and there is ONE of it.
 *
 * It used to be a fresh `LineBasicMaterial` per brush, which is seventeen
 * hundred distinct materials for seventeen hundred identical black lines — and
 * a distinct material is a program bind and a uniform upload the renderer
 * cannot batch away. Nothing has ever wanted a per-brush outline colour.
 */
const EDGE = new THREE.LineBasicMaterial({ color: 0x000000, opacity: 0.35, transparent: true });
/** What a brush wears while the editor has hold of it. */
const SELECTED = new THREE.MeshLambertMaterial({ color: 0x6b7280, emissive: 0x2a3550 });

/**
 * Dusk over the district: the colours the sky, the fog and the lights all agree
 * on. They have to be one set of numbers, because the single loudest tell that
 * a world is fake is a horizon that fades to a grey nothing the sky above it
 * never mentions.
 */
const SKY = {
  /** Straight up: the last of the night still in it. */
  zenith: 0x1b2742,
  /** The band the buildings actually stand against. */
  horizon: 0x4d5c80,
  /** Low and warm, where the sun went. Also what the key light is coloured. */
  ember: 0xa86a44,
  /**
   * Fog, and therefore the colour distance turns things. Sits between the
   * horizon and the ember: a fog colour darker than the sky it fades into is
   * the classic tell, because the far towers come out as dark shapes on a
   * bright sky instead of pale ones, and the depth reads backwards.
   */
  haze: 0x445070,
} as const;

/**
 * Dusk, as a theme.
 *
 * Every number here was a literal somewhere in this file until a second art
 * direction needed the first one to stay put. Nothing about it changed in the
 * move, and that is the whole contract: a level that names no theme gets this,
 * and gets exactly the district it had.
 */
const BASE_THEME: Required<Theme> = {
  zenith: SKY.zenith,
  horizon: SKY.horizon,
  ember: SKY.ember,
  sun: 0xffd2a1,
  sunPos: [260, 120, 180],
  sunScale: 1,
  glow: [0.62, 0.06, 0.42],
  sky: 0x8ea6d8,
  ground: 0x241d20,
  skyScale: 1,
  fill: 0x7f9ad6,
  fillScale: 1,
  fog: SKY.haze,
  fogNear: 130,
  fogFar: 620,
  exposure: 1.15,
  ink: 0x000000,
  inkWidth: 0,
  inkFade: [140, 420],
};

/**
 * A gradient dome, drawn inside everything else.
 *
 * Cheaper and more controllable than a cube map, and it is the difference
 * between a level standing in a place and a level standing in a void — a black
 * background gives the eye no horizon, so a 76 m tower and a 20 m block read as
 * the same distance away. `depthWrite: false` and a low render order let the
 * whole world draw over it without a depth fight.
 */
function skyDome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: new THREE.Color(SKY.zenith) },
      horizon: { value: new THREE.Color(SKY.horizon) },
      ember: { value: new THREE.Color(SKY.ember) },
      // Where the sun set, matched to the key light's bearing so the glow is
      // behind the buildings the key light rims.
      sunDir: { value: new THREE.Vector3(0.62, 0.06, 0.42).normalize() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 zenith, horizon, ember;
      uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        // Up the dome: horizon to zenith, biased so most of the sky is dark and
        // the gradient is concentrated in the first few degrees, which is where
        // a real one is.
        float h = pow(clamp(d.y, 0.0, 1.0), 0.42);
        vec3 c = mix(horizon, zenith, h);
        // Afterglow: a wide, low lobe towards the set sun.
        float glow = pow(max(0.0, dot(d, sunDir)), 3.0) * (1.0 - clamp(d.y * 2.4, 0.0, 1.0));
        c = mix(c, ember, glow * 0.85);
        // And a little of the same warmth spilled along the whole horizon.
        c = mix(c, ember * 0.5, (1.0 - smoothstep(-0.06, 0.22, d.y)) * 0.35);
        gl_FragColor = vec4(c, 1.0);
        // Through the same two steps as every other pixel in the frame.
        //
        // Not optional and not cosmetic: a THREE.Color built from a hex is
        // converted INTO linear working space, and a shader that writes it
        // straight out is writing a linear number into an sRGB buffer. A sky
        // authored at #1b2742 arrives on screen at about #030509 — which does
        // not look like a colour-space bug, it looks like the sky is black, and
        // the first three things you try are all in the gradient.
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  // Radius is well inside the camera's far plane, because the dome is kept
  // CENTRED ON THE CAMERA every frame rather than on the world. Left at the
  // origin it works from the middle of the map and fails at the edges: stand in
  // the west street and the far side of the dome is 700 m away, past the far
  // plane, and the sky is clipped into a black dome-shaped hole hanging over
  // the district. Moving it with the eye makes the horizon unreachable, which
  // is what a horizon is.
  const dome = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 20), mat);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  return dome;
}

export class Renderer {
  scene = new THREE.Scene();
  // Far enough to hold the city BEHIND the city: the backdrop ring stands up to
  // 400 m off the origin, and from the far corner of the district that is 620 m
  // away. At the old 600 the horizon used to tear open as you crossed the map.
  camera = new THREE.PerspectiveCamera(T.camera.fovBase, 1, 0.1, 1000);
  renderer: THREE.WebGLRenderer;
  player: THREE.Group;
  /** One mesh per brush, index-aligned with level.brushes — the editor's handle. */
  brushMeshes: THREE.Mesh[] = [];
  /** 0..1 scope amount, written by the weapon each frame. Pulls FOV in. */
  adsT = 0;
  /**
   * Draw a black wireframe over every brush. Off in play, on in the editor.
   *
   * These were how a world of flat-shaded boxes stayed readable: without an
   * outline, two untextured boxes at slightly different angles are one shape.
   * A textured world does not need them — measured, hiding every outline
   * changes the rendered frame by under half a percent of its JPEG size — and
   * they are not free: an outline is a second draw call for every plain brush
   * on the map, which is the single largest block of calls in the frame.
   *
   * The editor is the other case entirely. There you are looking AT brushes,
   * often ones a model is hiding, and the outline is the only thing that says
   * where a collider's corner is.
   */
  edges = false;
  /** The level's theme, filled out. Read every frame by `syncLights`. */
  private theme: Required<Theme> = BASE_THEME;
  /** The outline pass. Idle unless a theme asks for a line. */
  private ink = new Ink();
  private levelGroup = new THREE.Group();
  private dome!: THREE.Mesh;
  private sky!: THREE.HemisphereLight;
  private sun!: THREE.DirectionalLight;
  private fill!: THREE.DirectionalLight;

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
    // Behind the dome, so any pixel the dome somehow misses is still sky-coloured
    // rather than a hole punched through to the void.
    this.scene.background = new THREE.Color(SKY.haze);
    // Filmic, because half this world is now emissive. Without a curve every
    // lamp, window and marked surface clips to the same white disc and the
    // range between "lit" and "very lit" disappears exactly where the art is
    // trying to use it.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    // Shadows, drawn ONCE. The district is static and so is the sun, so the map
    // is baked at build time and never touched again — the per-frame cost of
    // nine hundred casters is a cost this does not pay. The price is that
    // nothing which moves may cast, which is why the player does not.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    useAnisotropy(this.renderer.capabilities.getMaxAnisotropy());

    this.dome = skyDome();
    this.scene.add(this.dome);
    // Fog the colour of the horizon, reaching most of the way across the
    // district. Distance has to do something to a surface or the far side of a
    // 400 m city sits in your face.
    // Near is out at the far side of a city block on purpose. Fog that starts at
    // arm's length is atmosphere applied to a room; this one only begins where
    // the district itself ends, so the streets stay crisp and the haze is
    // something that happens to the OTHER city, behind this one.
    this.scene.fog = new THREE.Fog(SKY.haze, 130, 620);

    this.sky = new THREE.HemisphereLight(0x8ea6d8, 0x241d20, T.light.sky);
    this.scene.add(this.sky);
    // The key, warm and LOW — a dusk sun rakes across a district instead of
    // flattening it from overhead, so every wall in the city gets a lit face and
    // a dark one and the volumes read.
    this.sun = new THREE.DirectionalLight(0xffd2a1, T.light.sun);
    this.sun.position.set(260, 120, 180);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    // The shadow camera has to hold the whole city, because it is drawn once and
    // there is no second chance to move it: 400 m of district plus its towers.
    const cam = this.sun.shadow.camera;
    cam.left = -320; cam.right = 320; cam.top = 320; cam.bottom = -320;
    cam.near = 1; cam.far = 900;
    // At 4096 texels over 640 m a shadow is ~16 cm to a texel, and acne at that
    // resolution needs a bias measured against the same scale.
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    // From behind and below the key. The kit's models are dark and unlit faces
    // read as holes without something to catch them.
    this.fill = new THREE.DirectionalLight(0x7f9ad6, T.light.fill);
    this.fill.position.set(-200, 90, -160);
    this.scene.add(this.fill);

    // The camera goes IN the scene so anything parented to it — the sword
    // viewmodel, its slash — is part of the traversal and actually gets drawn.
    // A camera outside the graph still renders the world, it just silently drops
    // every child hanging off it.
    this.scene.add(this.camera);

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
  /** Solid brushes only — what a projectile or a wave can actually be stopped by. */
  get wallMeshes(): THREE.Mesh[] {
    return this.brushMeshes.filter((m) => !m.userData.decor);
  }

  /**
   * Light a brush up as selected, and put it back afterwards.
   *
   * Swapping the whole material rather than setting `emissive` on the one it
   * has, which is what this used to do and is now actively wrong: surface
   * materials are SHARED between every brush wearing the same surface and
   * colour, so tinting one tints the district — and clearing it afterwards sets
   * the emissive of every window strip and every amber wall to black, which
   * does not come back until the page reloads.
   *
   * A brush hidden under a model is left alone, exactly as before: its box does
   * not draw, so there was never anything there to light up.
   */
  highlightBrush(index: number, on: boolean) {
    const mesh = this.brushMeshes[index];
    if (!mesh || mesh.material === HIDDEN) return;
    if (on) {
      if (mesh.material !== SELECTED) mesh.userData.surfaceMaterial = mesh.material;
      mesh.material = SELECTED;
    } else if (mesh.userData.surfaceMaterial) {
      mesh.material = mesh.userData.surfaceMaterial as THREE.Material;
      mesh.userData.surfaceMaterial = undefined;
    }
  }

  /** Lights follow the sliders, scaled by whatever the level's theme asks for. */
  private syncLights() {
    const t = this.theme;
    this.sky.intensity = T.light.sky * t.skyScale;
    this.sun.intensity = T.light.sun * t.sunScale;
    this.fill.intensity = T.light.fill * t.fillScale;
  }

  /**
   * Put the level's theme on the sky, the lights and the haze.
   *
   * Called on every rebuild rather than once at boot, because switching level
   * is how you compare two art directions and a theme that only applied at
   * startup would mean a reload to see the other one. Anything the level does
   * not specify comes from BASE_THEME, so a level with no theme resets the
   * renderer to exactly the look it had before any of this existed — that is
   * what makes a second style safe to add to a district that already has one.
   */
  private applyTheme() {
    const t: Required<Theme> = { ...BASE_THEME, ...(level.theme ?? {}) };
    this.theme = t;
    const u = (this.dome.material as THREE.ShaderMaterial).uniforms;
    u.zenith.value.setHex(t.zenith);
    u.horizon.value.setHex(t.horizon);
    u.ember.value.setHex(t.ember);
    this.sun.color.setHex(t.sun);
    this.sun.position.set(t.sunPos[0], t.sunPos[1], t.sunPos[2]);
    u.sunDir.value.set(t.glow[0], t.glow[1], t.glow[2]).normalize();
    this.sky.color.setHex(t.sky);
    this.sky.groundColor.setHex(t.ground);
    this.fill.color.setHex(t.fill);
    (this.scene.background as THREE.Color).setHex(t.fog);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.setHex(t.fog);
    fog.near = t.fogNear;
    fog.far = t.fogFar;
    this.renderer.toneMappingExposure = t.exposure;
    this.ink.configure({ colour: t.ink, width: t.inkWidth, fade: t.inkFade });
    if (!this.ink.enabled) this.ink.dispose();
    this.syncLights();
  }

  buildLevel() {
    this.applyTheme();
    // Nothing is disposed here any more. Materials and geometries belong to the
    // surface cache and are shared across brushes and across rebuilds — the
    // editor rebuilds the whole level on every edit, and disposing a shared
    // material there would take the rest of the map with it.
    for (const child of [...this.levelGroup.children]) this.levelGroup.remove(child);
    this.brushMeshes = [];

    for (let i = 0; i < level.brushes.length; i++) {
      const b = level.brushes[i];
      const pyramid = b.kind === 'pyramid';
      const colour = b.c ?? 0x6b7280;
      // Geometry carries the tiling (UVs in metres of THIS brush) and the
      // material carries the look, so two brushes of different sizes wearing
      // the same surface still share one material and one shader.
      const m: THREE.Mesh = new THREE.Mesh(
        pyramid ? UNIT_PYRAMID : boxFor(b.s[0], b.s[1], b.s[2], b.t ?? DEFAULT_SURFACE),
        materialFor(b.t ?? DEFAULT_SURFACE, colour),
      );
      // A brush is a building, and buildings shade the street. Decor is left out
      // of the shadow pass: it is small, there is a lot of it, and a handrail's
      // shadow is not worth a texel of a map that has a city to cover.
      m.castShadow = !b.d;
      m.receiveShadow = true;
      m.position.set(b.p[0], b.p[1], b.p[2]);
      if (b.q) m.quaternion.set(b.q[0], b.q[1], b.q[2], b.q[3]);
      else if (b.r) m.rotation.set(b.r[0], b.r[1], b.r[2]);
      m.scale.set(b.s[0], b.s[1], b.s[2]);
      m.userData.brushIndex = i;
      m.userData.decor = b.d === true;
      // Edge lines ride along as a child, so every gizmo drag moves them too.
      const edges = this.edges
        ? new THREE.LineSegments(pyramid ? PYRAMID_EDGES : BOX_EDGES, EDGE)
        : null;
      if (edges) m.add(edges);

      // A model, if this brush names one. It is a CHILD of the box rather than
      // a replacement for it: the box keeps its place in brushMeshes as the
      // raycast target for the sword, the Getsuga and the editor, keeps its
      // brushIndex, and — because it is unit geometry scaled to the brush —
      // stretches the model to the collider exactly, live, as you drag a handle.
      // Decor fits uniformly and stands on the box's floor; structure fills its
      // box. A deck must stretch to its collider or the collider shows at the
      // edges, but a lamppost stretched to a box is not a lamppost.
      if (b.m) {
        // Shared materials: a level's props are scenery and nothing ever tints
        // one, so they have no business each carrying their own copy of a
        // material with five textures hanging off it. See models.ts — this one
        // flag is worth more frame time than every other change in the pass.
        const inst = instance(b.m, { uniform: b.d, ground: b.d, share: true });
        if (inst) {
          m.add(inst.object);
          // Kit props stand in the same light as everything else. Without this
          // a lamppost is the one object in the district with no shadow under
          // it, which is exactly the sort of thing you see without seeing.
          inst.object.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.castShadow = !b.d;
            mesh.receiveShadow = true;
          });
          // The box itself stops drawing, but stays raycastable and selectable.
          // A dedicated hidden material, NOT `m.material.visible = false`: the
          // surface materials are shared between every brush that wears them,
          // so hiding one that way hides the whole district.
          m.material = HIDDEN;
          if (edges) edges.visible = false;
        } else {
          // Not in memory yet. Fetch it and rebuild once, rather than popping
          // in a frame later with the box still showing underneath.
          warm(b.m, () => this.buildLevel());
        }
      }

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

    // Every copy of every kit model in the district, collapsed into one draw
    // call per distinct piece. Not in the editor, where a model has to stay a
    // child of the brush it belongs to so the gizmo drags it.
    if (!this.edges) this.batchModels();

    // The city has changed shape, so the baked shadow map is out of date. One
    // flag, one extra pass on the next frame, and then never again — which is
    // what makes 4096² of sun shadow affordable at all. The editor's live gizmo
    // drags are the one thing this does not catch: shadows there are as of the
    // last rebuild, and a rebuild is one edit away.
    this.renderer.shadowMap.needsUpdate = true;
  }

  /**
   * Collapse the level's kit models into instanced draws.
   *
   * A model hung on a brush is a group of meshes, one per material, and the
   * renderer submits every one of them separately — so a district costs a draw
   * call for every window frame on every building in it, and the price of
   * dressing the map scales with how much of it you dress. That is the wall
   * this hit: a finished building is thirteen pieces, and cladding every street
   * face of forty blocks with them is twenty thousand draw calls.
   *
   * But every copy of `Building_Small_1` is the SAME thirteen geometries and
   * the same thirteen materials — `share: true` already stopped the materials
   * being cloned, and the geometry was never cloned at all. So the copies
   * differ in nothing but a matrix, which is exactly what `InstancedMesh` is
   * for. Grouped by (geometry, material), the whole district's kit collapses to
   * one draw per distinct piece: a few hundred, however many buildings there
   * are, and adding the hundredth costs a matrix.
   *
   * Geometry stays shared, so this is a few hundred kilobytes of matrices
   * rather than a merged copy of every building in the city.
   *
   * The catch is culling. One batch per piece for the whole district is one
   * bounding sphere the size of the district, which no frustum ever rejects —
   * so every triangle in the city is submitted from every camera, and the frame
   * stops being call-bound and starts being triangle-bound. So the batches are
   * cut into 128 m cells as well: a few more draws, and a street view submits
   * the two cells it can see instead of the whole map.
   */
  private static readonly CELL = 128;
  private batchModels() {
    interface Batch {
      geo: THREE.BufferGeometry;
      mat: THREE.Material;
      shadow: boolean;
      m: THREE.Matrix4[];
    }
    const batches = new Map<string, Batch>();
    const roots: THREE.Object3D[] = [];
    for (const brush of this.brushMeshes) {
      for (const child of brush.children) {
        if ((child as THREE.LineSegments).isLineSegments) continue;
        child.updateWorldMatrix(true, true);
        let found = false;
        child.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh || Array.isArray(mesh.material)) return;
          const C = Renderer.CELL;
          const cell = `${Math.round(brush.position.x / C)},${Math.round(brush.position.z / C)}`;
          const key = `${mesh.geometry.uuid}|${mesh.material.uuid}|${mesh.castShadow}|${cell}`;
          let b = batches.get(key);
          if (!b) {
            b = { geo: mesh.geometry, mat: mesh.material, shadow: mesh.castShadow, m: [] };
            batches.set(key, b);
          }
          b.m.push(mesh.matrixWorld.clone());
          found = true;
        });
        if (found) roots.push(child);
      }
    }
    if (!batches.size) return;
    for (const b of batches.values()) {
      const im = new THREE.InstancedMesh(b.geo, b.mat, b.m.length);
      for (let i = 0; i < b.m.length; i++) im.setMatrixAt(i, b.m[i]);
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = b.shadow;
      im.receiveShadow = true;
      im.userData.batched = true;
      this.levelGroup.add(im);
    }
    // The originals stay parented where they were — the brush still owns its
    // model, and leaving the tree alone is what keeps a rebuild the only thing
    // that has to know about any of this — but they no longer draw.
    for (const r of roots) r.visible = false;
  }

  /**
   * Draw the scene with the camera exactly as it stands. This is the ONLY place
   * a frame is rendered, and it is deliberately separate from `update`.
   *
   * `update` moves the camera; anything that positions a world-space object
   * from the camera — the grapple cables off your hips, a muzzle flash, a
   * spawned projectile — has to run in between, or it anchors itself to last
   * frame's view and tears away from the eye whenever you are moving fast.
   * Camera-parented viewmodels (the sword) are immune, because a child's world
   * transform is recomputed from the parent at render time; loose objects in
   * `scene` are not. Splitting the two makes that ordering enforceable instead
   * of a thing every new system has to rediscover.
   */
  draw() {
    this.syncLights();
    // The sky rides with the eye. Position only — turning it with the camera
    // would take the sunset round the sky with you.
    this.dome.position.copy(this.camera.position);
    if (this.ink.enabled) this.ink.render(this.renderer, this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Place the camera for this frame. Draws nothing — call `draw` once the rest
   * of the frame's visuals have had their turn.
   *
   * @param col world query for camera collision pull-in
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

    // No render here on purpose — see `draw`. The camera is final as of this
    // line, and everything that reads it gets to run before the frame is drawn.
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
