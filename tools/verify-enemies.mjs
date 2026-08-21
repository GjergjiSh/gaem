// Do the robots stand on the ground, and do their hitboxes match them?
//
// Drives the REAL src/engine/models.ts -- compiled, with only the Vite
// `import.meta.glob` line rewritten to point at a local http server -- so
// fitStanding and hitboxesOf under test are the ones that ship. The ten lines
// of Enemies.spawn that parent a box to a bone are mirrored below.
//
// Everything is measured with Box3.setFromObject(obj, precise), which for a
// SkinnedMesh walks the posed vertices. Measuring any other way turned out to
// be a trap: the hitboxes are CHILDREN OF THE BONES, so traversing the robot
// counts them as part of the robot and the comparison silently goes circular.
// Here they are detached for the duration of the model measurement.
import * as THREE from 'three';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

globalThis.ProgressEvent ??= class { constructor(t, i = {}) { Object.assign(this, i, { type: t }); } };

// Textures need a DOM and nothing here cares what colour a robot is, so .gltf
// comes back with the image data stripped.
const server = http.createServer((req, res) => {
  const file = path.resolve(decodeURIComponent(req.url.split('?')[0]).replace(/^\//, ''));
  if (!file.startsWith(process.cwd()) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  if (!file.endsWith('.gltf')) return res.end(fs.readFileSync(file));
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete j.images; delete j.textures; delete j.samplers;
  for (const m of j.materials ?? []) {
    for (const k of Object.keys(m)) if (/[Tt]exture$/.test(k)) delete m[k];
    const pbr = m.pbrMetallicRoughness;
    if (pbr) for (const k of Object.keys(pbr)) if (/[Tt]exture$/.test(k)) delete pbr[k];
  }
  res.end(JSON.stringify(j));
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;

// Compile models.ts on the spot, so this is one command and can never be run
// against a stale build of the thing it is checking.
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'hitbox-'));
try {
  execFileSync('npx', ['tsc', '--ignoreConfig', 'src/engine/models.ts', '--outDir', OUT,
    '--module', 'esnext', '--target', 'es2022', '--moduleResolution', 'bundler',
    '--skipLibCheck'], { stdio: 'pipe', shell: process.platform === 'win32' });
} catch {
  // tsc reports import.meta.glob as an error (it is Vite syntax) and still
  // emits. Only a missing output is fatal.
  if (!fs.existsSync(path.join(OUT, 'models.js'))) throw new Error('models.ts failed to compile');
}

// models.ts globs twice now: once for the models themselves and once for the
// side-car buffers and textures a glTF references by name. Replace EVERY
// occurrence -- a lone `replace` with no /g leaves the second one as literal
// Vite syntax, which is a `.glob is not a function` at import time.
const MODELS = JSON.stringify(Object.fromEntries(fs.readdirSync('assets/robots-pack')
  .filter((f) => f.endsWith('.gltf'))
  .map((f) => [`/assets/robots-pack/${f}`, `${BASE}assets/robots-pack/${f}`])));
let seen = 0;
const js = fs.readFileSync(path.join(OUT, 'models.js'), 'utf8').replace(
  /import\.meta\.glob\([^)]*\)/g,
  // The robots pack embeds its buffers and has no textures, so the side-car
  // table is legitimately empty here.
  () => (seen++ === 0 ? MODELS : '{}'),
);
const shim = path.resolve('models.live.mjs');   // in-repo, so bare 'three' resolves
fs.writeFileSync(shim, js);
const M = await import('file:///' + shim.replace(/\\/g, '/'));

const ROBOTS = ['George', 'Leela', 'Mike', 'Stan'];
const HEIGHT = 1.8 * 1.6;                          // 1.8 m x T.enemy.scale
const CLIPS = ['Idle', 'Shoot', 'HitRecieve_1'];   // what a LIVE dummy plays
await M.preloadModels(ROBOTS);

let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log(`     FAIL  ${msg}`); } };

for (const name of ROBOTS) {
  // ---- mirrors Enemies.spawn --------------------------------------------
  const root = new THREE.Group();
  const robot = M.instance(name, { stand: HEIGHT, animate: true });
  root.add(robot.object);
  const parts = [];
  for (const hb of M.hitboxesOf(name)) {
    const bone = robot.object.getObjectByName(hb.bone);
    if (!bone) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(...hb.size), new THREE.MeshBasicMaterial());
    m.position.set(...hb.centre);
    m.userData.part = hb.part;
    m.userData.half = new THREE.Vector3(hb.size[0] / 2, hb.size[1] / 2, hb.size[2] / 2);
    bone.add(m);
    parts.push(m);
  }
  // ------------------------------------------------------------------------

  const homes = parts.map((m) => m.parent);
  const modelBox = () => {
    parts.forEach((m) => m.removeFromParent());
    root.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(robot.object, true);
    parts.forEach((m, i) => homes[i].add(m));
    root.updateMatrixWorld(true);
    return b;
  };
  const hitUnion = () => {
    root.updateMatrixWorld(true);
    const b = new THREE.Box3();
    for (const m of parts) b.union(new THREE.Box3().setFromObject(m, true));
    return b;
  };

  // The metric that actually answers "can I shoot what I see": the share of the
  // visible mesh's vertices that lie inside some hit volume, in the current
  // pose. Comparing union AABBs instead is dominated by fingertips and says
  // almost nothing about hitting a torso or a head.
  const skins = [];
  robot.object.traverse((o) => { if (o.isSkinnedMesh) skins.push(o); });
  const STEP = 3;
  // Which vertices belong to the head, by the same dominant-bone rule the
  // hitboxes were built with. Headshots are the complaint, so this is measured
  // on its own rather than folded into the overall figure.
  const headVerts = [];
  for (const mesh of skins) {
    const si = mesh.geometry.attributes.skinIndex;
    const sw = mesh.geometry.attributes.skinWeight;
    for (let i = 0; i < si.count; i += STEP) {
      let bi = si.getX(i), bw = sw.getX(i);
      if (sw.getY(i) > bw) { bw = sw.getY(i); bi = si.getY(i); }
      if (sw.getZ(i) > bw) { bw = sw.getZ(i); bi = si.getZ(i); }
      if (sw.getW(i) > bw) { bw = sw.getW(i); bi = si.getW(i); }
      if (mesh.skeleton.bones[bi]?.name === 'Head') headVerts.push([mesh, i]);
    }
  }
  const coverage = () => {
    root.updateMatrixWorld(true);
    const inv = parts.map((m) => new THREE.Matrix4().copy(m.matrixWorld).invert());
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    let inside = 0, total = 0, headHits = 0, headTotal = 0;
    for (const mesh of skins) {
      const n = mesh.geometry.attributes.position.count;
      for (let i = 0; i < n; i += STEP) {
        mesh.getVertexPosition(i, p);
        p.applyMatrix4(mesh.matrixWorld);
        total++;
        for (let b = 0; b < parts.length; b++) {
          const h = parts[b].userData.half;
          q.copy(p).applyMatrix4(inv[b]);
          if (Math.abs(q.x) <= h.x + 1e-4 && Math.abs(q.y) <= h.y + 1e-4 && Math.abs(q.z) <= h.z + 1e-4) {
            inside++;
            if (parts[b].userData.part === 'head') headHits++;
            break;
          }
        }
      }
    }
    const hm = parts.find((m) => m.userData.part === 'head');
    const hinv = new THREE.Matrix4().copy(hm.matrixWorld).invert();
    const hh = hm.userData.half;
    for (const [mesh, i] of headVerts) {
      headTotal++;
      mesh.getVertexPosition(i, p);
      p.applyMatrix4(mesh.matrixWorld).applyMatrix4(hinv);
      if (Math.abs(p.x) <= hh.x + 1e-4 && Math.abs(p.y) <= hh.y + 1e-4 && Math.abs(p.z) <= hh.z + 1e-4) headHits++;
    }
    return { pct: (100 * inside) / total, head: headTotal ? (100 * headHits) / headTotal : 100 };
  };

  const counts = parts.reduce((a, m) => { a[m.userData.part] = (a[m.userData.part] ?? 0) + 1; return a; }, {});
  const rest = modelBox();
  console.log(`\n${name}  ${parts.length} hitboxes `
    + `(${counts.head ?? 0} head, ${counts.body ?? 0} body, ${counts.limb ?? 0} limb)`);
  console.log(`  rest pose  feet y ${rest.min.y.toFixed(4)}   height ${(rest.max.y - rest.min.y).toFixed(4)} m`
    + `   (want feet 0, height ${HEIGHT.toFixed(2)})`);
  check(Math.abs(rest.min.y) < 0.02, `${name}: feet ${rest.min.y.toFixed(3)} m off the deck`);
  check(Math.abs((rest.max.y - rest.min.y) - HEIGHT) < 0.02, `${name}: height is not ${HEIGHT} m`);
  check(counts.head === 1, `${name}: ${counts.head} head boxes, want exactly 1`);
  check((counts.body ?? 0) >= 1, `${name}: no body box`);

  const headMesh = parts.find((m) => m.userData.part === 'head');
  const hbox = new THREE.Box3().setFromObject(headMesh, true);
  const frac = (hbox.getCenter(new THREE.Vector3()).y - rest.min.y) / (rest.max.y - rest.min.y);
  console.log(`  head box at ${(frac * 100).toFixed(0)}% of height`);
  check(frac > 0.7, `${name}: head box at ${(frac * 100).toFixed(0)}% of height, not near the top`);

  for (const clipName of CLIPS) {
    const clip = robot.clips.find((c) => c.name === clipName);
    if (!clip) { console.log(`  ${clipName}: no such clip`); continue; }
    const mixer = new THREE.AnimationMixer(robot.object);
    mixer.clipAction(clip).play();
    let miss = 0, foot = 0, unhit = 0, cover = 100, headCover = 100;
    for (let i = 0; i <= 20; i++) {
      mixer.setTime((clip.duration * i) / 20);
      const mb = modelBox();
      const bb = hitUnion();
      foot = Math.max(foot, Math.abs(mb.min.y));
      if (i % 5 === 0) {
        const c = coverage();
        cover = Math.min(cover, c.pct);
        headCover = Math.min(headCover, c.head);
      }
      for (const ax of ['x', 'y', 'z']) {
        miss = Math.max(miss, Math.abs(bb.min[ax] - mb.min[ax]), Math.abs(bb.max[ax] - mb.max[ax]));
        // Model sticking OUT of the boxes is the bad direction: mesh you can
        // see and cannot shoot.
        unhit = Math.max(unhit, mb.min[ax] - bb.min[ax], bb.max[ax] - mb.max[ax]);
      }
    }
    mixer.stopAllAction();
    console.log(`  ${clipName.padEnd(13)} ${cover.toFixed(1)}% of the mesh is inside a hitbox`
      + ` (head ${headCover.toFixed(1)}%)`
      + `, feet within ${foot.toFixed(3)} m of the deck`);
    check(cover > 97, `${name}/${clipName}: only ${cover.toFixed(1)}% of the mesh is shootable`);
    check(headCover > 98, `${name}/${clipName}: only ${headCover.toFixed(1)}% of the head is in the head box`);
    check(foot < 0.12, `${name}/${clipName}: feet ${foot.toFixed(2)} m off the deck`);
  }
}

fs.rmSync(shim);
fs.rmSync(OUT, { recursive: true, force: true });
console.log(fails === 0 ? '\nAll checks passed.' : `\n${fails} CHECK(S) FAILED`);
server.close();
process.exit(fails === 0 ? 0 : 1);
