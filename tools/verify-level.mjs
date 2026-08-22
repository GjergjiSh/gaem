// Ashgate, measured — against the real Rapier world and the real solver.
//
// A level is the one kind of content you cannot review by reading it. The
// numbers in the source say what was intended; only the built world says what
// is actually there, and the gap between those two is exactly where "janky"
// lives: the platform that floats, the block sitting on a launch edge, the ramp
// that ends 2 m above the roof it was aimed at, the gap nothing can cross.
//
// So everything below is a measurement. Nothing here restates a constant from
// the level file — the geometry is built, stepped, and then probed with the
// same rays the solver itself uses.
//
// It runs twice where it matters: once on the shipped defaults and once with
// `src/profiles/gaem.json` applied, because that is the tune the game is
// actually played on and a level that only works on one of them is a level
// with a bug in it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// --- build ------------------------------------------------------------------
const OUT = path.resolve('.verify-level');
fs.rmSync(OUT, { recursive: true, force: true });
try {
  execFileSync('npx', ['tsc', '--ignoreConfig',
    'src/levels/ashgate.ts', 'src/engine/physics.ts', 'src/core/solver.ts',
    '--outDir', OUT, '--module', 'esnext', '--target', 'es2022',
    '--moduleResolution', 'bundler', '--skipLibCheck'],
  { stdio: 'pipe', shell: process.platform === 'win32' });
} catch {
  if (!fs.existsSync(path.join(OUT, 'levels', 'ashgate.js'))) {
    throw new Error('level failed to compile');
  }
}
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
for (const f of walk(OUT).filter((f) => f.endsWith('.js'))) {
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8')
    .replace(/(from '\.\.?\/[^']+)'/g, "$1.js'"));
}
const load = (rel) => import(pathToFileURL(path.join(OUT, rel)).href);

// `LEVEL=raw` runs the whole suite against `ashgate-raw` instead — the same
// district with every kit model taken off it. The two share their colliders, so
// this is mostly a check that they still do: anything that passes on one and
// fails on the other is a place where the art is load-bearing, which is the one
// thing it is never allowed to be.
const NS = await load('levels/ashgate.js');
const A = process.env.LEVEL === 'raw'
  ? { ...NS, brushes: NS.brushesRaw, RAMP_BRUSHES: NS.RAMP_BRUSHES_RAW }
  : NS;
if (process.env.LEVEL === 'raw') console.log('  (ashgate-raw: no models)');
const P = await load('engine/physics.js');
const S = await load('core/solver.js');
const TUNE = await load('core/tuning.js');
const { T } = TUNE;
await P.initPhysics();

const GAEM = JSON.parse(fs.readFileSync('src/profiles/gaem.json', 'utf8'));
const SHIPPED = JSON.parse(JSON.stringify(T));
const useTune = (which) => {
  TUNE.applyProfile(SHIPPED, T);
  if (which === 'gaem') TUNE.applyProfile(GAEM, T);
};

// --- reporting --------------------------------------------------------------
let fails = 0;
let warns = 0;
const check = (ok, msg) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'}  ${msg}`);
  if (!ok) fails++;
};
const warn = (ok, msg) => {
  console.log(`${ok ? '  ok  ' : '  warn'}  ${msg}`);
  if (!ok) warns++;
};
const note = (msg) => console.log(`        ${msg}`);
const head = (msg) => console.log(`\n${msg}`);
const v = (x, y, z) => ({ x, y, z });

// --- the world --------------------------------------------------------------
const world = new P.RapierWorld(A.brushes, A.spawn);
// Rapier's query pipeline is empty until the world steps, so a ray into a fresh
// world reports nothing at all — including straight through solid geometry.
world.move(v(0, 4000, 0), v(0, 0, 0));

const DOWN = v(0, -1, 0);
/** Height of the first surface under (x, z), searching down from `from`. */
function surfaceAt(x, z, from = 400) {
  const d = world.ray(v(x, from, z), DOWN, from + 60);
  return d === null ? null : from - d;
}

/**
 * Every tilted brush on the map: the Chute, the Overpass segments and the slip
 * roads. They are ROUTES, and a route landing on a deck necessarily occupies
 * the air just above that deck where the two meet — so they get judged by
 * whether they meet it flush, not by whether they are standing in a lane.
 */
/**
 * World AABB of every brush. Over-approximates the rotated ones, which is the
 * safe direction for every question asked of it here: a width it reports as
 * tight is at worst tighter than the truth.
 */
const BOXES = A.brushes.map((b) => {
  const [sx, sy, sz] = b.s;
  let hx = sx / 2, hy = sy / 2, hz = sz / 2;
  if (b.q) {
    const [x, y, z, w] = b.q;
    const m = [
      [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ];
    hx = Math.abs(m[0][0]) * sx / 2 + Math.abs(m[0][1]) * sy / 2 + Math.abs(m[0][2]) * sz / 2;
    hy = Math.abs(m[1][0]) * sx / 2 + Math.abs(m[1][1]) * sy / 2 + Math.abs(m[1][2]) * sz / 2;
    hz = Math.abs(m[2][0]) * sx / 2 + Math.abs(m[2][1]) * sy / 2 + Math.abs(m[2][2]) * sz / 2;
  }
  return {
    x0: b.p[0] - hx, x1: b.p[0] + hx,
    y0: b.p[1] - hy, y1: b.p[1] + hy,
    z0: b.p[2] - hz, z1: b.p[2] + hz,
  };
});
const solidAt = (x, y, z) => BOXES.some((b) =>
  x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && z > b.z0 && z < b.z1);

const RAMPS = A.brushes.filter((b) => b.q);
/** Is a point inside an oriented brush? Margin in metres. */
function insideBrush(b, px, py, pz, margin = 0.6) {
  let dx = px - b.p[0], dy = py - b.p[1], dz = pz - b.p[2];
  if (b.q) {
    // Rotate by the conjugate to get into the brush's own frame.
    const [qx, qy, qz, qw] = b.q;
    const tx = 2 * (-qy * dz + qz * dy);
    const ty = 2 * (-qz * dx + qx * dz);
    const tz = 2 * (-qx * dy + qy * dx);
    dx += qw * tx + (-qy) * tz - (-qz) * ty;
    dy += qw * ty + (-qz) * tx - (-qx) * tz;
    dz += qw * tz + (-qx) * ty - (-qy) * tx;
  }
  return Math.abs(dx) <= b.s[0] / 2 + margin
    && Math.abs(dy) <= b.s[1] / 2 + margin
    && Math.abs(dz) <= b.s[2] / 2 + margin;
}
const onARamp = (px, py, pz) => RAMPS.some((b) => insideBrush(b, px, py, pz));

// ---------------------------------------------------------------------------
head('what got built');
{
  const n = A.brushes.length;
  const decor = A.brushes.filter((b) => b.d === true).length;
  const rotated = A.brushes.filter((b) => b.q || b.r).length;
  const skinned = A.brushes.filter((b) => b.m).length;
  note(`${n} brushes, ${rotated} rotated, ${skinned} wearing a kit model`);
  note(`${A.roofs.length} decks, ${A.triggers.length} triggers, ${A.brushes.length - decor} colliders`);
  check(decor === 0, `not one decorative brush — every object is solid (${decor} ghosts)`);

  // The bar is DEGENERACY, not thinness. A vent grille is modelled 44 mm thick
  // and that is a perfectly good static collider; clamping it up to clear an
  // arbitrary 5 cm line is how you distort a model to satisfy a check.
  const bad = A.brushes.filter((b) =>
    ![...b.p, ...b.s].every(Number.isFinite) || b.s.some((x) => x < 0.02));
  const thin = A.brushes.filter((b) => b.s.some((x) => x < 0.1)).length;
  note(`${thin} brushes are under 10 cm on some axis — grilles, panels and paint`);
  check(bad.length === 0, `every brush has finite position and real size (${bad.length} bad)`);

  // What this actually costs to draw. A plain brush is ONE call in play -- its
  // wireframe outline is an editor affordance and is not built outside the
  // editor -- and a brush wearing a model draws the model's primitives instead,
  // because the renderer hides the box under it.
  //
  // Counted across EVERY pack, which it did not used to be: this walked
  // assets/Platforms alone, so once Ashgate moved onto the sci-fi kit every
  // model in the level fell through to the `?? 1` default and the estimate came
  // in about a quarter under the truth. Measured against
  // `renderer.info.render.calls` on the widest view of the district, the
  // corrected figure lands within a few percent. A budget is only worth having
  // if the number it is checking is the real one.
  const prims = {};
  const scanPrims = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) scanPrims(p);
      else if (e.name.endsWith('.gltf')) {
        try {
          const d = JSON.parse(fs.readFileSync(p, 'utf8'));
          prims[e.name.slice(0, -5)] = (d.meshes ?? []).reduce((a, m) => a + m.primitives.length, 0);
        } catch { /* a pack we cannot parse cannot be priced; it falls back to 1 */ }
      }
    }
  };
  scanPrims('assets');
  // Models are INSTANCED, and the estimate has to model that or it is measuring
  // a renderer that no longer exists. Every copy of a kit model shares its
  // geometry and its material, so the renderer collects them into one instanced
  // draw per (piece, 96 m cell) -- the cell is what keeps the frustum able to
  // reject anything, since one batch per piece for the whole district is one
  // bounding sphere the size of the district. So the price of a model is its
  // primitive count once per cell it appears in, NOT once per copy: the
  // hundredth building on a street is a matrix, and the first one in a new cell
  // is thirteen calls.
  const CELL = 128;
  const cells = new Map();
  let calls = 0;
  for (const b of A.brushes) {
    if (!b.m) { calls++; continue; }
    const key = `${b.m}|${Math.round(b.p[0] / CELL)},${Math.round(b.p[2] / CELL)}`;
    if (cells.has(key)) continue;
    cells.set(key, true);
    calls += prims[b.m] ?? 1;
  }
  note(`~${calls} draw calls (${cells.size} instanced batches over ${
    A.brushes.filter((b) => b.m).length} model brushes)`);

  // Every model the level names has to be a file on disk. A name that is in the
  // measured table but no longer in the pack loads as nothing and leaves a hole
  // where a prop was, which is the kind of thing you notice six weeks later.
  const onDisk = new Set();
  const sweep = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) sweep(path.join(dir, e.name));
      else if (e.name.endsWith('.gltf')) onDisk.add(e.name.slice(0, -5));
    }
  };
  sweep('assets');
  const named = [...new Set(A.brushes.filter((b) => b.m).map((b) => b.m))];
  const missing = named.filter((n) => !onDisk.has(n));
  note(`${named.length} distinct models named, all from one pack`);
  check(missing.length === 0, `every model resolves to a file (${missing.join(', ') || 'none missing'})`);
  // Lowered from 3800 when the renderer learned to instance. That is the
  // opposite of making room and it is the point: the ceiling has to sit just
  // above what the district actually costs, or it stops being a budget. What
  // changed underneath it is that the cost of dressing the map no longer scales
  // with how much of it you dress -- so the number to guard is the number of
  // DISTINCT pieces in play, and a level that doubles its buildings and holds
  // this line is a level that added no draws at all.
  //
  // The number that justifies this one is measured rather than guessed. At
  // ~3260 real calls (`renderer.info.render.calls`, widest view of the whole
  // city) the frame costs about 15 ms at 720p, and it is CPU-bound on call
  // submission -- halving the resolution changes nothing, and turning the sun's
  // shadows off changes nothing. So this ceiling is a frame-time budget wearing
  // a draw-call costume, and the thing to do when it is hit is to make the
  // renderer submit fewer calls, not to raise it again.
  check(calls < 2600, `inside the draw budget (${calls} of 2600)`);

  const spanX = A.EXTENT.x1 - A.EXTENT.x0;
  const spanZ = A.EXTENT.z1 - A.EXTENT.z0;
  note(`district is ${spanX} x ${spanZ} m`);
  check(spanX > 300 && spanZ > 250, 'large enough to be a district rather than a course');
}

// ---------------------------------------------------------------------------
head('rule 2: every prop is at its true size');
{
  // The scrapyard test. A model is stretched to fill its brush, so a brush
  // drawn without regard for the model's proportions DISTORTS it — `Sign_1` is
  // 0.06 units thick, and poured into a brush 3 m deep it is a billboard the
  // size of a building. Props are sized from the measured box, so every one of
  // them must come out at a stretch of exactly 1 on all three axes.
  const worn = A.brushes.filter((b) => b.m);
  const props = worn.filter((b) => !A.STRETCHED.has(b.m));
  let bent = 0;
  let worst = 0;
  for (const b of props) {
    const nat = A.propBoxOf(b.m);
    // Compare the three axes to EACH OTHER, not to 1. Scaling a model evenly is
    // not distortion — it is just a smaller version of the same object — and
    // the thing that ruins a kit is one axis moving without the others.
    // Only the axes the model actually HAS. Several panels and every decal are
    // modelled as planes with a zero axis, which the brush opens up to a few
    // centimetres so it is not degenerate — dividing by that zero is how the
    // worst distortion came out as Infinity.
    const ks = [0, 1, 2].filter((i) => nat[i] > 1e-3).map((i) => b.s[i] / nat[i]);
    if (ks.length < 2) continue;
    const skew = Math.max(...ks) / Math.min(...ks) - 1;
    worst = Math.max(worst, skew);
    if (skew > 1e-6) bent++;
  }
  note(`${worn.length} brushes wear a model: ${props.length} props at true size, `
    + `${worn.length - props.length} linear models stretched on purpose`);
  note(`worst distortion across every prop: ${(worst * 100).toFixed(4)}%`);
  check(bent === 0, `no prop is stretched out of shape (${bent} distorted)`);
}

// ---------------------------------------------------------------------------
head('rule 1: nothing floats');
{
  const boxes = BOXES;
  const TOL = 0.6;
  const floating = [];
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    if (a.y0 <= 0.05) continue;                       // stands on the street
    const held = boxes.some((b, j) => j !== i
      && b.x1 > a.x0 && b.x0 < a.x1 && b.z1 > a.z0 && b.z0 < a.z1
      && b.y1 >= a.y0 - TOL && b.y0 < a.y1 - 0.05);
    if (!held) floating.push({ i, a });
  }
  for (const f of floating.slice(0, 8)) {
    note(`brush ${f.i} at (${f.a.x0.toFixed(0)}..${f.a.x1.toFixed(0)}, `
      + `y ${f.a.y0.toFixed(1)}, ${f.a.z0.toFixed(0)}..${f.a.z1.toFixed(0)}) rests on nothing`);
  }
  check(floating.length === 0,
    `all ${A.brushes.length} brushes reach the ground or sit on something (${floating.length} floating)`);
}

// ---------------------------------------------------------------------------
head('rule 3: the roofs are where the plan says, and their edges are clear');
{
  // Masts stand at the corners on purpose. A corner is the one part of a roof
  // nobody runs a line through, so they are excluded by position rather than by
  // being quietly skipped.
  const LANE = 9;
  const CORNER = 8;
  // Probe from just over head height. Anything above that is a bridge, a
  // gantry or the Chute passing over — a canopy, not an obstruction — and
  // raying from 400 m up reports every one of them as a block underfoot.
  const HEAD = 2.6;
  // The lane rule is about decks you LAUNCH from. A terrace with a tower on it,
  // or the ring left behind by a setback, is a ledge: it gets judged on whether
  // it is wide enough to run along instead.
  const isTop = (r) => !A.roofs.some((o) => o !== r && o.top > r.top + 0.5
    && Math.abs(o.cx - r.cx) < (o.w + r.w) / 2 - 1
    && Math.abs(o.cz - r.cz) < (o.d + r.d) / 2 - 1);
  const tops = A.roofs.filter(isTop);
  const ledges = A.roofs.filter((r) => !isTop(r));
  note(`${tops.length} launch decks, ${ledges.length} ring ledges and terraces`);

  let narrow = 0;
  for (const r of ledges) {
    const over = A.roofs.filter((o) => o !== r && o.top > r.top + 0.5
      && Math.abs(o.cx - r.cx) < (o.w + r.w) / 2 && Math.abs(o.cz - r.cz) < (o.d + r.d) / 2);
    if (!over.length) continue;
    const big = over.reduce((a, b) => (a.w * a.d > b.w * b.d ? a : b));
    const ring = Math.min(
      (r.w - big.w) / 2 + Math.abs(r.cx - big.cx),
      (r.d - big.d) / 2 + Math.abs(r.cz - big.cz),
    );
    if (ring < 4) { narrow++; note(`ring only ${ring.toFixed(1)} m wide at y=${r.top}`); }
  }
  check(narrow === 0, `every setback ring is wide enough to run along (${narrow} too narrow)`);

  let wrongTop = 0, obstructed = 0, holes = 0, samples = 0, joins = 0, flat = 0;
  let worstLane = null;

  for (const r of tops) {
    const hit = surfaceAt(r.cx, r.cz, r.top + HEAD);
    // The middle of a deck can legitimately carry a plant room, so the height
    // test only asks that SOMETHING is there at or above the plan.
    if (hit === null || hit < r.top - 0.05) wrongTop++;

    for (let x = -r.w / 2 + 1; x <= r.w / 2 - 1; x += 2.5) {
      for (let z = -r.d / 2 + 1; z <= r.d / 2 - 1; z += 2.5) {
        // The lane scales with the deck. A 12 m service platform cannot have a
        // 9 m clear ring round it and still be a platform, and demanding one
        // just means the rule gets switched off for the decks it was written
        // for. Small decks get a proportionally small lane instead.
        const lane = Math.min(LANE, Math.max(0, (Math.min(r.w, r.d) - 10) / 2));
        const edge = Math.min(r.w / 2 - Math.abs(x), r.d / 2 - Math.abs(z));
        const corner = (r.w / 2 - Math.abs(x)) < CORNER && (r.d / 2 - Math.abs(z)) < CORNER;
        if (edge > lane || corner) continue;
        samples++;
        const h = surfaceAt(r.cx + x, r.cz + z, r.top + HEAD);
        if (h === null) { holes++; continue; }
        // Under a step, the controller simply walks over it — so a painted
        // marking or a floor vent cannot obstruct anything, and the rule that
        // matters is about things you can actually be stopped by.
        if (h > r.top + T.character.stepHeight) {
          if (onARamp(r.cx + x, h, r.cz + z)) { joins++; continue; }
          obstructed++;
          if (!worstLane || h - r.top > worstLane.d) {
            worstLane = { d: h - r.top, x: r.cx + x, z: r.cz + z, top: r.top };
          }
        } else if (h < r.top - 0.05) holes++;
        else if (h > r.top + 0.05) flat++;
      }
    }
  }
  note(`${samples} probes in the edge lanes of ${tops.length} launch decks`);
  if (worstLane) {
    note(`tallest thing in a lane: ${worstLane.d.toFixed(2)} m at `
      + `(${worstLane.x.toFixed(0)}, ${worstLane.z.toFixed(0)})`);
  }
  check(wrongTop === 0, `every deck is solid at its own centre (${wrongTop} missing)`);
  note(`${joins} probes landed on a ramp meeting a deck — those are joins, and`
    + ' they get measured for a lip further down instead');
  note(`${flat} landed on something under a step height — paint and floor vents,`
    + ' which the controller walks over');
  check(obstructed === 0, `nothing stands in a launch lane (${obstructed} obstructions)`);
  check(holes === 0, `no holes in a deck edge (${holes} found)`);
}

// ---------------------------------------------------------------------------
head('every ramp either meets the floor flush or does not meet it at all');
{
  useTune('shipped');
  const STEP_OK = T.character.stepHeight;
  let lipped = 0, joined = 0, launches = 0;
  // The level says which brushes are ramps. Inferring it from the geometry does
  // not work in either direction: most rotated brushes here are level pipes and
  // rails turned to lie along a street, and the tilted ones include every vent
  // tipped ninety degrees to face out of a wall.
  const FLOORS = A.RAMP_BRUSHES.map((i) => A.brushes[i]);
  for (const b of FLOORS) {
    // Local +Z is the ramp's length; walk a metre past each end and see what is
    // there. A surface within a few metres is a join and has to be flush; open
    // air is a launch and is allowed to be anything.
    const [qx, qy, qz, qw] = b.q;
    const ax = 2 * (qy * 1 * 0 - qz * 0), _ = ax;   // eslint-disable-line
    const dir = (() => {
      const x = 0, y = 0, z = 1;
      const tx = 2 * (qy * z - qz * y);
      const ty = 2 * (qz * x - qx * z);
      const tz = 2 * (qx * y - qy * x);
      return {
        x: x + qw * tx + qy * tz - qz * ty,
        y: y + qw * ty + qz * tx - qx * tz,
        z: z + qw * tz + qx * ty - qy * tx,
      };
    })();
    const half = b.s[2] / 2;
    for (const side of [1, -1]) {
      const ex = b.p[0] + dir.x * half * side;
      const ey = b.p[1] + dir.y * half * side + b.s[1] / 2;
      const ez = b.p[2] + dir.z * half * side;
      const flat = Math.hypot(dir.x, dir.z) || 1e-6;
      const ox = ex + (dir.x / flat) * 1.2 * side;
      const oz = ez + (dir.z / flat) * 1.2 * side;
      // Shallow on purpose: a join is a floor within a couple of metres. Probing
      // further just finds the street 40 m below an overpass segment and calls
      // the end of a bridge a broken join.
      const dNear = world.ray(v(ox, ey + 1.5, oz), DOWN, 6);
      const beyond = dNear === null ? null : ey + 1.5 - dNear;
      if (beyond === null) { launches++; continue; }
      const lip = beyond - ey;
      if (Math.abs(lip) <= STEP_OK + 0.35) { joined++; continue; }
      // Buried in a mass is fine — that is how a ramp is let into a building.
      if (lip > 0 && lip < 6) { joined++; continue; }
      lipped++;
      note(`ramp end at (${ox.toFixed(0)}, ${ey.toFixed(1)}, ${oz.toFixed(0)}) `
        + `has a ${lip.toFixed(2)} m step to the surface beyond`);
    }
  }
  note(`${FLOORS.length} ramp floors: ${joined} ends meet a surface, `
    + `${launches} end in open air (which is a launch, not a fault)`);
  check(lipped === 0, `no ramp lands with a lip you would trip over (${lipped})`);
}

// ---------------------------------------------------------------------------
// Measure a crossing by walking the real surface, rather than by trusting the
// plan: this is what catches a setback that quietly widened a gap.
function measureGap(axis, from, to, cross, topA, topB) {
  const STEP = 0.25;
  const floor = Math.min(topA, topB) - 2.5;
  let lastA = null, firstB = null;
  for (let t = from; t <= to; t += STEP) {
    const h = axis === 'x' ? surfaceAt(t, cross, 400) : surfaceAt(cross, t, 400);
    if (h === null) continue;
    if (lastA === null || firstB === null) {
      if (h >= topA - 0.2 && h <= topA + 0.2 && firstB === null) lastA = t;
      else if (lastA !== null && h >= topB - 0.2 && h <= topB + 0.2) { firstB = t; break; }
      else if (lastA !== null && h > floor) { /* something in between: keep looking */ }
    }
  }
  if (lastA === null || firstB === null) return null;
  return firstB - lastA;
}

head('the street grid: every crossing measured, then priced against the tune');
{
  const budgets = (name) => {
    useTune(name);
    const gUp = T.world.gravityRise, gDn = T.world.gravityFall;
    const apex = (vy) => (vy * vy) / (2 * gUp);
    const reach = (vel, vys, rise) => {
      let t = 0, h = 0;
      for (const vy of vys) { t += vy / gUp; h += apex(vy); }
      if (h <= rise) return 0;
      return vel * (t + Math.sqrt((2 * (h - rise)) / gDn));
    };
    const run = T.ground.maxSpeed;
    const slide = run * T.slide.capBonus;
    const j1 = T.jump.speed, j2 = T.jump.doubleJumpSpeed;
    const js = j1 * T.jump.slideExitBonus;
    return {
      name,
      hop: (rise) => reach(run, [j1, j2], rise),
      span: (rise) => reach(slide, [js], rise),
      super: (rise) => reach(slide, [js, j2], rise),
    };
  };
  const TUNES = [budgets('shipped'), budgets('gaem')];

  let measured = 0, unreachable = 0, missed = 0, bridged = 0;
  const worst = [];
  for (let ri = 0; ri < A.ROWS.length; ri++) {
    for (let ci = 0; ci < A.COLS.length - 1; ci++) {
      const ka = A.KIND[ri][ci], kb = A.KIND[ri][ci + 1];
      if (ka === 'yard' || ka === 'plaza' || kb === 'yard' || kb === 'plaza') continue;
      if (ka === 'spire' || kb === 'spire') continue;
      const topA = A.HEIGHT[ri][ci], topB = A.HEIGHT[ri][ci + 1];
      // The player picks their line, so take the best crossing anywhere along
      // the shared frontage rather than the one at the block centre.
      let best = null;
      for (let f = -0.35; f <= 0.351; f += 0.1) {
        const z = A.ROWS[ri].c + f * A.ROWS[ri].size;
        const g = measureGap('x', A.COLS[ci].c, A.COLS[ci + 1].c, z, topA, topB);
        if (g !== null && (best === null || g < best)) best = g;
      }
      if (best === null) continue;
      measured++;
      const rise = topB - topA;
      const priced = TUNES.map((b) => ({
        t: b.name,
        ok: best <= b.super(Math.max(0, rise)),
        budget: b.super(Math.max(0, rise)),
      }));
      const bad = priced.filter((p) => !p.ok);
      if (bad.length) {
        // Past a jump — so there had better be something to land on in the
        // middle. The Overpass runs down one of these avenues, and a crossing
        // that is BRIDGED is not a crossing that is broken.
        const midX = (A.COLS[ci].hi + A.COLS[ci + 1].lo) / 2;
        const span = surfaceAt(midX, A.ROWS[ri].c, Math.max(topA, topB) + 30);
        const landable = span !== null
          && span > Math.min(topA, topB) - 12 && span < Math.max(topA, topB) + 14;
        if (landable) {
          bridged++;
          note(`r${ri} c${ci}->c${ci + 1}: ${best.toFixed(1)} m is past a jump, but a deck `
            + `at ${span.toFixed(1)} m crosses the middle of it`);
        } else {
          missed++;
          worst.push(`r${ri} c${ci}->c${ci + 1}: ${best.toFixed(1)} m at ${rise >= 0 ? '+' : ''}`
            + `${rise} m — budget ${bad.map((p) => `${p.t} ${p.budget.toFixed(1)}`).join(', ')}`);
        }
      }
      if (priced.some((p) => p.budget === 0)) unreachable++;
    }
  }
  note(`${measured} east–west crossings walked with a ray, ${bridged} of them bridged`);
  for (const w of worst.slice(0, 6)) note(w);
  check(missed === 0,
    `every one is inside a slide jump plus the double, on BOTH tunes (${missed} are not)`);
  check(unreachable === 0, `and none needs an apex the character does not have (${unreachable})`);
  useTune('shipped');
}

// ---------------------------------------------------------------------------
head('the roofscape is connected: can you get anywhere from anywhere?');
{
  useTune('shipped');
  const gUp = T.world.gravityRise, gDn = T.world.gravityFall;
  const apex = (vy) => (vy * vy) / (2 * gUp);
  // SIGNED rise: negative means the far roof is LOWER, which lengthens the jump
  // rather than shortening it. Getting that backwards makes every descent look
  // impossible and the whole roofscape look disconnected.
  const superReach = (rise) => {
    const j2 = T.jump.doubleJumpSpeed, js = T.jump.speed * T.jump.slideExitBonus;
    const h = apex(js) + apex(j2);
    if (h <= rise) return 0;
    return T.ground.maxSpeed * T.slide.capBonus
      * (js / gUp + j2 / gUp + Math.sqrt((2 * (h - rise)) / gDn));
  };

  // Nodes are decks; an edge exists when the shortest hop between their
  // footprints is inside the budget for the height difference.
  const nodes = A.roofs;
  const gapBetween = (a, b) => {
    const dx = Math.max(0, Math.abs(a.cx - b.cx) - (a.w + b.w) / 2);
    const dz = Math.max(0, Math.abs(a.cz - b.cz) - (a.d + b.d) / 2);
    return Math.hypot(dx, dz);
  };
  const adj = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const g = gapBetween(nodes[i], nodes[j]);
      if (g <= superReach(nodes[j].top - nodes[i].top)) adj[i].push(j);
      if (g <= superReach(nodes[i].top - nodes[j].top)) adj[j].push(i);
    }
  }
  // Seed where the level actually puts you: the roof the Ladder tops out on.
  // Seeding from the lowest deck instead asks whether you can JUMP out of the
  // street, and you cannot — that is the whole reason the Ladder exists.
  const eX = A.COLS[1].c, eZ = A.ROWS[2].c, eTop = A.HEIGHT[2][1];
  const score = (r) => Math.hypot(r.cx - eX, r.cz - eZ) + Math.abs(r.top - eTop) * 4;
  const start = nodes.reduce((best, r, i) => (score(r) < score(nodes[best]) ? i : best), 0);
  note(`seeded on the deck at (${nodes[start].cx.toFixed(0)}, ${nodes[start].top}, `
    + `${nodes[start].cz.toFixed(0)}) — where the Ladder puts you`);
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    for (const n of adj[queue.pop()]) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  }
  const stranded = nodes.filter((_, i) => !seen.has(i));
  note(`${nodes.length} decks, ${seen.size} reachable on foot without touching the street`);
  for (const s of stranded.slice(0, 6)) {
    note(`stranded: deck at (${s.cx.toFixed(0)}, ${s.top}, ${s.cz.toFixed(0)})`);
  }
  // The Spire crown is meant to be unreachable on foot alone — that is what the
  // balconies, the shaft and the grapple are for. Everything else must not be.
  const onlyCrown = stranded.every((s) => s.top >= 70);
  check(onlyCrown,
    `nothing is stranded except the Spire crown, which is the climb (${stranded.length} stranded)`);
}

// ---------------------------------------------------------------------------
head('the dressing did not narrow anything that matters');
{
  useTune('shipped');
  // Bands and cornices stand 0.25-0.35 m proud of every mass, on all four
  // faces — including the two that face each other across a twin's shaft. Six
  // of those are climbs, so the width that matters is the width AFTER the
  // decoration, measured at the height where the cornices are worst.
  const apexUp = (T.wall.jumpUp * T.wall.jumpUp) / (2 * T.world.gravityRise);
  const air = T.wall.jumpUp / T.world.gravityRise + Math.sqrt((2 * apexUp) / T.world.gravityFall);
  const cross = 0.7 * T.wall.jumpOut * air;
  const need = (w) => w - T.character.radius - (T.character.radius + T.wall.detectDist);

  let shafts = 0;
  let tightest = 99;
  for (let ri = 0; ri < A.ROWS.length; ri++) {
    for (let ci = 0; ci < A.COLS.length; ci++) {
      if (A.KIND[ri][ci] !== 'twin') continue;
      const ns = (ri + ci) % 2 === 0;
      const cx = A.COLS[ci].c;
      const cz = A.ROWS[ri].c;
      const top = A.HEIGHT[ri][ci];
      // Just under the deck, where the cornice is.
      for (const y of [top - 3, top * 0.5, 6]) {
        const a = world.ray(v(cx, y, cz), ns ? v(1, 0, 0) : v(0, 0, 1), 14);
        const b = world.ray(v(cx, y, cz), ns ? v(-1, 0, 0) : v(0, 0, -1), 14);
        if (a === null || b === null) continue;
        tightest = Math.min(tightest, a + b);
      }
      shafts++;
    }
  }
  note(`${shafts} twin shafts; the narrowest is ${tightest.toFixed(2)} m across `
    + `(SLOT is ${A.SLOT}, so the bands cost ${(A.SLOT - tightest).toFixed(2)} m)`);
  note(`a bounce covers ~${cross.toFixed(1)} m and that shaft asks for `
    + `${need(tightest).toFixed(1)} m`);
  check(need(tightest) < cross, 'every twin shaft is still crossable after the dressing');
}

// ---------------------------------------------------------------------------
head('the avenues are still the long straights');
{
  useTune('shipped');
  // Lamps, signs and doors hang off every frontage on the two main avenues, and
  // a street lamp reaches most of a metre into the road. The avenues are the
  // only run-up on the map long enough to reach the hard cap, so what matters
  // is how much clear road is LEFT.
  // The widest CONTIGUOUS clear run across the street, at chest height, sampled
  // every metre. Measuring out from the centreline instead reports zero the
  // moment the centreline itself is occupied — and a Chute pylon or a line of
  // containers standing in the middle of a road does not close the road, it
  // just means the lane is beside it rather than through it.
  const lane = (along, aFrom, aTo, cFrom, cTo) => {
    let worst = 1e9;
    let at = 0;
    for (let t = aFrom; t <= aTo; t += 3) {
      let run = 0;
      let best = 0;
      for (let u = cFrom; u <= cTo; u += 1) {
        const blocked = along === 'x' ? solidAt(t, 1.2, u) : solidAt(u, 1.2, t);
        run = blocked ? 0 : run + 1;
        if (run > best) best = run;
      }
      if (best < worst) { worst = best; at = t; }
    }
    return { worst, at };
  };
  const ew = lane('x', A.COLS[0].lo, A.COLS[5].hi, A.ROWS[1].hi, A.ROWS[2].lo);
  const ns = lane('z', A.ROWS[0].lo, A.ROWS[4].hi, A.COLS[1].hi, A.COLS[2].lo);
  note(`east–west avenue: narrowest clear lane ${ew.worst.toFixed(0)} m, at x=${ew.at.toFixed(0)}`);
  note(`north–south avenue: narrowest clear lane ${ns.worst.toFixed(0)} m, at z=${ns.at.toFixed(0)}`);
  const room = T.character.radius * 2 + 6;
  check(Math.min(ew.worst, ns.worst) > room,
    `both keep a lane wider than ${room.toFixed(1)} m, dressing and all`);
}

// ---------------------------------------------------------------------------
head('the Ladder: are those walls actually wallrunnable?');
{
  useTune('shipped');
  const z = A.ROWS[2].c;
  const x = A.COLS[1].lo - 13;
  const eye = 1.0;
  let legal = 0, total = 0;
  for (const side of [1, -1]) {
    const hit = world.rayHit(v(x, eye, z), v(0, 0, side), 6);
    total++;
    if (hit && Math.abs(hit.normal.y) <= Math.sin(T.wall.maxAngle)) legal++;
    if (hit) {
      note(`wall at ${hit.dist.toFixed(2)} m to ${side > 0 ? '+z' : '-z'}, `
        + `normal.y ${hit.normal.y.toFixed(3)} (a wall needs |y| <= `
        + `${Math.sin(T.wall.maxAngle).toFixed(3)})`);
    }
  }
  check(legal === total, 'both faces of the corridor register as walls, not slopes');

  const width = (() => {
    const a = world.ray(v(x, eye, z), v(0, 0, 1), 12);
    const b = world.ray(v(x, eye, z), v(0, 0, -1), 12);
    return a !== null && b !== null ? a + b : null;
  })();
  note(`corridor is ${width?.toFixed(2)} m across`);
  // The honest crossing figure. jumpOut times the airtime overstates it by
  // about a third, because jumpKeepAlong and stickAssist leave part of the
  // outward kick cancelling the velocity that was pulling you into the wall.
  const apexUp = (T.wall.jumpUp * T.wall.jumpUp) / (2 * T.world.gravityRise);
  const air = T.wall.jumpUp / T.world.gravityRise + Math.sqrt((2 * apexUp) / T.world.gravityFall);
  const cross = 0.7 * T.wall.jumpOut * air;
  const need = width - T.character.radius - (T.character.radius + T.wall.detectDist);
  note(`a bounce really covers ~${cross.toFixed(1)} m in ${air.toFixed(2)} s of air; `
    + `this shaft asks for ${need.toFixed(1)} m`);
  check(need < cross, 'narrow enough that a bounce reaches the far wall');
  check(width !== null && width > T.character.radius * 4,
    'and wide enough to run down without scraping both sides');
}

// ---------------------------------------------------------------------------
// The real solver, on the real world. Everything above measures the building;
// this drives the character through it.
const DT = 1 / 120;
const btn = () => ({ pressed: false, held: false });
const intent = (over = {}) => ({
  moveX: 0, moveY: 0, yaw: 0, pitch: 0,
  jump: btn(), dash: btn(), slide: btn(), slam: btn(), thrust: btn(), grapple: btn(),
  ...over,
});
/** Camera yaw that makes moveY = 1 push along (dx, dz). */
const yawAlong = (dx, dz) => Math.atan2(-dx, -dz);
/** Flat reach of a run-and-double-jump landing `drop` metres LOWER. */
const GAP_HOP_AT = (drop) => {
  const gUp = T.world.gravityRise, gDn = T.world.gravityFall;
  const h = (T.jump.speed ** 2 + T.jump.doubleJumpSpeed ** 2) / (2 * gUp);
  return T.ground.maxSpeed
    * ((T.jump.speed + T.jump.doubleJumpSpeed) / gUp + Math.sqrt((2 * (h + drop)) / gDn));
};
const speedH = (p) => Math.hypot(p.vel.x, p.vel.z);
const feet = (p) => p.pos.y - T.character.height / 2;

head('the spawn: you land on the Yard, facing the Ladder');
for (const tune of ['shipped', 'gaem']) {
  useTune(tune);
  const p = S.makePlayer({ ...A.spawn });
  const i = intent();
  for (let k = 0; k < 240; k++) S.step(p, i, world, DT);
  note(`${tune}: settled with feet at y=${feet(p).toFixed(3)}, state ${p.state}`);
  check(p.grounded && Math.abs(feet(p)) < 0.06, `${tune}: stands on the street, not in it`);

  // Facing: the camera looks along -(sin yaw, cos yaw).
  const fx = -Math.sin(A.spawnYaw), fz = -Math.cos(A.spawnYaw);
  const mouth = { x: A.COLS[1].lo - 26, z: A.ROWS[2].c };
  const dx = mouth.x - A.spawn.x, dz = mouth.z - A.spawn.z;
  const dot = (fx * dx + fz * dz) / Math.hypot(dx, dz);
  check(dot > 0.95, `${tune}: spawn yaw points down the Yard at the corridor (dot ${dot.toFixed(3)})`);
}

head('the Ladder, climbed: run in, bounce, and see how high it gets you');
for (const tune of ['shipped', 'gaem']) {
  useTune(tune);
  const p = S.makePlayer({ ...A.spawn });
  const yaw = yawAlong(1, 0);
  // At this yaw moveY drives +x and moveX drives +z, so steering is direct.
  const mouthX = A.LADDER_X - 13;
  const hugZ = A.ROWS[2].c + A.SLOT / 2 - 0.7;   // 0.7 m off the north face
  let best = 0, wallTicks = 0, bounces = 0, launched = false;
  for (let k = 0; k < 120 * 10; k++) {
    const i = intent({ moveY: 1, yaw });
    const inShaft = p.pos.x > mouthX && p.pos.x < mouthX + 26;
    if (p.state === 'wallrunning') {
      // Once attached the character runs the wall by itself; all the autopilot
      // does is let go again at a sensible moment.
      if (p.stateTime > 0.30) { i.jump = { pressed: true, held: true }; bounces++; }
    } else if (p.pos.x < mouthX + 3) {
      i.moveX = Math.max(-1, Math.min(1, (hugZ - p.pos.z) * 0.6));
      if (!launched && p.grounded && p.pos.x > mouthX) {
        i.jump = { pressed: true, held: true };
        launched = true;
      }
    } else if (inShaft && !p.grounded) {
      // STEER AT THE FAR WALL. Holding forward instead does not work and it is
      // worth knowing why: air.redirect rotates velocity toward the stick
      // without changing its length, so a fistful of forward quietly deletes
      // the sideways kick of the wall jump and drops you down the middle. This
      // is not a quirk of the level — it is how bouncing a shaft is played.
      i.moveX = Math.sign(p.lastWallZ || 1);
      i.moveY = 0.5;
    } else if (inShaft && p.grounded) {
      i.jump = { pressed: true, held: true };
    }
    S.step(p, i, world, DT);
    if (p.state === 'wallrunning') wallTicks++;
    best = Math.max(best, feet(p));
  }
  const stage = A.HEIGHT[2][1] / A.LADDER_STAGES;
  note(`${tune}: ${(wallTicks * DT).toFixed(2)} s on a wall, ${bounces} bounces, `
    + `topped out at y=${best.toFixed(1)} — ${A.LADDER_STAGES} stages of `
    + `${stage.toFixed(1)} m up to the ${A.HEIGHT[2][1]} m roof`);
  check(wallTicks > 20, `${tune}: the corridor actually catches a wallrun`);
  check(best >= stage * 0.9,
    `${tune}: a bounce with no timing at all clears the first stage (${stage.toFixed(1)} m)`);
}

head('the Chute: one committed slide from the crown');
for (const tune of ['shipped', 'gaem']) {
  useTune(tune);
  const from = A.CHUTE_FROM, to = A.CHUTE_TO;
  const dx = to.x - from.x, dz = to.z - from.z, dy = to.y - from.y;
  const flat = Math.hypot(dx, dz);
  const angle = (Math.atan2(-dy, flat) * 180) / Math.PI;
  const len = Math.hypot(flat, dy);
  if (tune === 'shipped') {
    note(`${len.toFixed(0)} m of ramp at ${angle.toFixed(1)} degrees, `
      + `dropping ${(-dy).toFixed(0)} m`);
    // Where slope acceleration starts beating slide friction.
    const breakEven = (Math.asin(Math.min(1, T.slide.friction / T.slide.slopeAccel)) * 180) / Math.PI;
    note(`slide accelerates on anything past ${breakEven.toFixed(1)} degrees`);
    check(angle > breakEven + 5, 'steep enough that the slide never stalls');
    check(angle < (T.character.maxSlopeAngle * 180) / Math.PI,
      'and shallow enough to still count as ground rather than a wall');
  }

  // Drop onto the top of the chute, start sliding, and hold it.
  const f0 = 0.06;
  const start = {
    x: from.x + dx * f0, y: from.y + dy * f0 + 1.2, z: from.z + dz * f0,
  };
  const yaw = yawAlong(dx / flat, dz / flat);
  const p = S.makePlayer({ ...start, y: start.y + T.character.height / 2 });
  p.vel = { x: (dx / flat) * 6, y: 0, z: (dz / flat) * 6 };

  const goal = A.triggers.find((t) => t.kind === 'goal');
  let nearGoal = 1e9, nearAt = null;
  let peak = 0, sliding = 0, landedAt = null, minY = 1e9;
  for (let k = 0; k < 120 * 14; k++) {
    const i = intent({ moveY: 1, yaw, slide: { pressed: k > 30 && k < 34, held: k > 30 } });
    S.step(p, i, world, DT);
    if (p.state === 'sliding') sliding++;
    peak = Math.max(peak, speedH(p));
    minY = Math.min(minY, feet(p));
    if (landedAt === null && feet(p) < A.HEIGHT[2][1] + 0.5 && p.grounded
      && p.pos.x < A.COLS[1].hi) {
      landedAt = { x: p.pos.x, y: feet(p), z: p.pos.z, s: speedH(p) };
    }
    const dg = Math.hypot(p.pos.x - goal.p[0], p.pos.z - goal.p[2]);
    if (dg < nearGoal) { nearGoal = dg; nearAt = { x: p.pos.x, z: p.pos.z, s: speedH(p) }; }
  }
  note(`${tune}: ${(sliding * DT).toFixed(1)} s sliding, peaked at ${peak.toFixed(1)} u/s `
    + `(hardCap ${T.momentum.hardCap})`);
  if (landedAt) {
    note(`${tune}: reached the landing roof at (${landedAt.x.toFixed(0)}, `
      + `${landedAt.y.toFixed(1)}, ${landedAt.z.toFixed(0)}) doing ${landedAt.s.toFixed(1)} u/s`);
  }
  note(`${tune}: finished at (${p.pos.x.toFixed(0)}, ${feet(p).toFixed(1)}, `
    + `${p.pos.z.toFixed(0)}), ${speedH(p).toFixed(1)} u/s, state ${p.state}`);
  check(sliding > 120, `${tune}: the slide holds down the ramp instead of dying on it`);
  check(peak > T.momentum.hardCap * 0.85,
    `${tune}: arrives near the hard cap (${peak.toFixed(1)} of ${T.momentum.hardCap})`);
  check(feet(p) > A.killY, `${tune}: the descent does not end in the void`);
  check(minY > A.killY, `${tune}: and never passes through the world on the way`);
  note(`${tune}: closest approach to the finish ring was ${nearGoal.toFixed(1)} m `
    + `at (${nearAt.x.toFixed(0)}, ${nearAt.z.toFixed(0)}) doing ${nearAt.s.toFixed(1)} u/s `
    + `(ring r=${goal.r})`);
  check(nearGoal < goal.r,
    `${tune}: the descent runs THROUGH the finish, so the lap closes by arriving`);
}

// ---------------------------------------------------------------------------
head('the lap, leg by leg');
{
  useTune('shipped');
  // The run-up. A shaft entered below wall.minSpeed is a shaft you walk into.
  let blocked = 0;
  for (let x = A.spawn.x; x < A.LADDER_X - 13; x += 1.5) {
    const h = surfaceAt(x, A.ROWS[2].c, 3);
    if (h === null || h > 0.4) blocked++;
  }
  note(`${(A.LADDER_X - 13 - A.spawn.x).toFixed(0)} m of clear floor from the spawn `
    + 'to the mouth of the Ladder');
  check(blocked === 0, `nothing to trip over on the run-up (${blocked} probes blocked)`);

  // Every ramp you are meant to run UP has to be walkable, and every one you are
  // meant to slide DOWN has to out-accelerate slide friction.
  const maxSlope = T.character.maxSlopeAngle;
  const stall = Math.asin(Math.min(1, T.slide.friction / T.slide.slopeAccel));
  let steep = 0, stalls = 0;
  for (const b of A.RAMP_BRUSHES.map((i) => A.brushes[i])) {
    // Pitch straight off the quaternion: the angle its local up leans from world up.
    const [qx, , qz] = b.q;
    const upY = 1 - 2 * (qx * qx + qz * qz);
    const pitch = Math.acos(Math.max(-1, Math.min(1, upY)));
    if (pitch > maxSlope) { steep++; note(`a ramp pitches ${(pitch * 180 / Math.PI).toFixed(0)} deg`); }
    if (pitch > 0.02 && pitch < stall) stalls++;
  }
  note(`slopes run from flat to ${(maxSlope * 180 / Math.PI).toFixed(0)} deg walkable; `
    + `a slide stalls below ${(stall * 180 / Math.PI).toFixed(1)} deg`);
  check(steep === 0, `no ramp is secretly a wall (${steep})`);
  check(stalls === 0, `and none is shallow enough to kill a slide on it (${stalls})`);

  // Off the Overpass onto the Spire terrace: the hand-off into the climb.
  const opx = (A.COLS[3].hi + A.COLS[4].lo) / 2;
  // Sampled south of the tower and clear of the slip ramp: probing at z=-74 puts
  // the ray straight down the on-ramp and measures that instead of the terrace.
  const at = A.ROWS[1].c + 20;
  const deck = surfaceAt(opx, at, A.opY(at) + 3);
  const terr = surfaceAt(A.COLS[3].hi - 4, at, A.TERRACE + 3);
  const gap = opx - 8 - A.COLS[3].hi;
  note(`Overpass deck ${deck?.toFixed(1)} m, Spire terrace ${terr?.toFixed(1)} m, `
    + `${gap.toFixed(0)} m apart`);
  check(terr !== null && deck !== null && deck > terr,
    'the road arrives ABOVE the terrace, so the hand-off is a drop rather than a climb');
  check(gap < GAP_HOP_AT(deck - terr),
    `and the drop across is inside a plain hop (${gap.toFixed(0)} m)`);
}

head('the Chute has air under it the whole way');
{
  useTune('shipped');
  const from = A.CHUTE_FROM, to = A.CHUTE_TO;
  let worst = { clear: 1e9, f: 0 };
  let buried = 0;
  // Stops at 90%: the last stretch IS the ramp coming down to meet its landing
  // roof, so of course the clearance closes there. That join is measured by the
  // ramp-lip check instead, which is the right question to ask about it.
  for (let f = 0.04; f <= 0.90; f += 0.01) {
    const x = from.x + (to.x - from.x) * f;
    const y = from.y + (to.y - from.y) * f;
    const z = from.z + (to.z - from.z) * f;
    // Probe ACROSS the deck, not just down its spine: the pylons holding it up
    // stand on the centreline, so a single ray down the middle measures the
    // ramp's own supports and reports them as a collision.
    const nx = -(to.z - from.z), nz = (to.x - from.x);
    const nl = Math.hypot(nx, nz) || 1;
    let clear = -1;
    for (const off of [0, 7, -7]) {
      const d = world.ray(v(x + (nx / nl) * off, y - 2.2, z + (nz / nl) * off), DOWN, 200);
      clear = Math.max(clear, d === null ? 1e3 : d + 2.2);
    }
    if (clear < 3) buried++;
    if (clear < worst.clear) worst = { clear, f, y };
  }
  note(`tightest clearance to anything off the pylon line is `
    + `${worst.clear.toFixed(1)} m, at ${(worst.f * 100).toFixed(0)}% along`);
  check(buried === 0,
    `the ramp never dives into a building on its way across (${buried} sample(s) buried)`);
}

// ---------------------------------------------------------------------------
head('the Overpass: six segments, five gaps, one of each tier');
{
  useTune('shipped');
  const segs = A.OP_SEGS;
  const opx = (A.COLS[3].hi + A.COLS[4].lo) / 2;
  let priced = 0;
  for (let i = 0; i < segs.length - 1; i++) {
    const z0 = segs[i][1], z1 = segs[i + 1][0];
    // Measure the deck ends with a ray rather than trusting the table.
    // From just above the deck: probing from 200 m finds the gantry beam that
    // hangs over the two widest gaps and calls it the road.
    const hEnd = surfaceAt(opx, z0 - 0.5, A.opY(z0) + 3);
    const hStart = surfaceAt(opx, z1 + 0.5, A.opY(z1) + 3);
    const gap = z1 - z0;
    const dropSouth = hEnd === null || hStart === null ? 0 : hEnd - hStart;
    note(`gap ${i + 1}: ${gap.toFixed(0)} m, ${dropSouth.toFixed(1)} m downhill southbound `
      + `(deck ${hEnd?.toFixed(1)} -> ${hStart?.toFixed(1)})`);
    check(dropSouth > 0, `gap ${i + 1} falls the way the fast lane runs`);
    priced++;
  }
  check(priced === 5, 'five gaps, as planned');

  // Nothing under the deck should be in the deck's own lane.
  let blocked = 0;
  for (const [z0, z1] of segs) {
    for (let z = z0 + 2; z <= z1 - 2; z += 2) {
      const want = A.opY(z);
      const h = surfaceAt(opx, z, want + 3);
      if (h === null || Math.abs(h - want) > 0.15) blocked++;
    }
  }
  check(blocked === 0, `the deck surface is continuous along all six segments (${blocked} bad probes)`);
}

// ---------------------------------------------------------------------------
head('the Spire: three ways up, and each one is inside its own budget');
{
  useTune('shipped');
  const tank = (T.thruster.fuelMax / T.thruster.burnRate) * T.thruster.maxRise;
  const cx = A.COLS[3].c, cz = A.ROWS[1].c;

  // Ray each balcony the level says it built. Sweeping the four faces blind
  // found two of the four and quietly passed a check about the other two — a
  // measurement that can miss what it is measuring is worse than no check.
  const found = [];
  let missing = 0;
  for (const b of A.BALCONY_AT) {
    const h = surfaceAt(b.x, b.z, b.y + 2);
    if (h !== null && Math.abs(h - b.y) < 0.1) found.push(h);
    else { missing++; note(`no floor at the balcony claimed for y=${b.y.toFixed(1)}`); }
  }
  found.sort((a, b) => a - b);
  check(missing === 0, `every balcony is really there (${missing} missing)`);
  note(`balconies at ${found.map((f) => f.toFixed(1)).join(', ')} `
    + `(terrace 30, crown ${A.HEIGHT[1][3]})`);
  const steps = found.map((h, k) => h - (k === 0 ? A.TERRACE : found[k - 1]));
  const biggest = Math.max(...steps, A.SPIRE_TOP - found[found.length - 1]);
  note(`biggest step is ${biggest.toFixed(1)} m; one thruster tank climbs ${tank.toFixed(1)} m`);
  check(found.length >= 3, `enough balconies to make a climb of it (${found.length})`);
  check(biggest < tank, 'every step is inside a single tank, with ground between to refuel');

  // The shaft between the tower and its service core: one landing per flight.
  const ledges = [];
  let ghost = 0;
  for (const l of A.SPIRE_LANDINGS) {
    const h = surfaceAt(l.x, l.z, l.y + 2);
    if (h !== null && Math.abs(h - l.y) < 0.1) ledges.push(h);
    else ghost++;
  }
  ledges.sort((a, b) => a - b);
  check(ghost === 0, `every shaft landing is really there (${ghost} missing)`);
  // And the shaft itself has to be two facing walls, not one.
  for (const l of A.SPIRE_LANDINGS.slice(0, 1)) {
    const a = world.ray(v(A.SHAFT_X, l.y + 1.2, l.z), v(1, 0, 0), 12);
    const b = world.ray(v(A.SHAFT_X, l.y + 1.2, l.z), v(-1, 0, 0), 12);
    note(`shaft is ${a !== null && b !== null ? (a + b).toFixed(2) : '??'} m `
      + `across at y=${l.y.toFixed(0)} (SLOT is ${A.SLOT})`);
    check(a !== null && b !== null && Math.abs(a + b - A.SLOT) < 0.3,
      'the tower and its core really do face each other a SLOT apart');
  }
  note(`shaft ledges at ${ledges.map((l) => l.toFixed(0)).join(', ')}`);
  const bounce = (T.wall.jumpUp * T.wall.jumpUp) / (2 * T.world.gravityRise);
  const perChain = bounce * T.wall.maxChain;
  const worstStage = Math.max(...ledges.map((l, k) => l - (k === 0 ? A.TERRACE : ledges[k - 1])),
    A.CORE_TOP - ledges[ledges.length - 1]);
  note(`a bounce is worth ${bounce.toFixed(2)} m and wall.maxChain is ${T.wall.maxChain}, `
    + `so a stage between landings buys ~${perChain.toFixed(1)} m`);
  check(ledges.length >= 3, `the shaft has landings, not just a 46 m wall (${ledges.length})`);
  warn(worstStage <= perChain * 1.35,
    `the tallest stage (${worstStage.toFixed(1)} m) is within reach of one chain`);

  // The grapple: a 65 m rope does not reach the top of a 98 m tower from the
  // street, and it is not meant to. What matters is that from every place you
  // can stand on the way up, the NEXT anchor is inside range — so the hook is a
  // way to climb the Spire rather than a way to skip it.
  const mastTop = A.HEIGHT[1][3] + 22;
  const anchors = [A.TERRACE, ...found, A.SPIRE_TOP, mastTop];
  const hooks = anchors.slice(1).map((h, k) => Math.hypot(24, h - anchors[k]));
  note(`anchors up the tower at ${anchors.map((a) => a.toFixed(0)).join(' -> ')} m`);
  note(`longest reach between two of them: ${Math.max(...hooks).toFixed(0)} m, `
    + `grapple.range is ${T.grapple.range} m`);
  check(Math.max(...hooks) < T.grapple.range,
    'from anywhere you can stand on the tower, the next anchor up is hookable');
}

// ---------------------------------------------------------------------------
head('the lap: every checkpoint sits on something you can stand on');
{
  useTune('shipped');
  for (const t of A.triggers) {
    const h = surfaceAt(t.p[0], t.p[2], t.p[1] + 30);
    const above = h === null ? null : t.p[1] - h;
    note(`${t.kind.padEnd(10)} ${t.name.padEnd(9)} ring at y=${t.p[1].toFixed(1)}, `
      + `surface ${h === null ? 'NONE' : h.toFixed(1)} (${above?.toFixed(1)} m under it)`);
    check(h !== null && above > 0 && above < t.r,
      `'${t.name}' is over solid ground and inside its own radius of it`);
  }
  const need = A.triggers.filter((t) => t.kind === 'checkpoint').length;
  check(need >= 3 && A.triggers.some((t) => t.kind === 'goal'),
    `a real lap: ${need} checkpoints and a goal`);

  // The finish must not be collectable from the spawn pad.
  const goal = A.triggers.find((t) => t.kind === 'goal');
  const d = Math.hypot(goal.p[0] - A.spawn.x, goal.p[2] - A.spawn.z);
  check(d > goal.r, `you do not spawn inside the finish ring (${d.toFixed(1)} m away, r=${goal.r})`);
}

// ---------------------------------------------------------------------------
head('the street is a floor, and the map has an edge');
{
  useTune('shipped');
  let holes = 0, probes = 0;
  for (let x = A.EXTENT.x0 + 4; x < A.EXTENT.x1; x += 11) {
    for (let z = A.EXTENT.z0 + 4; z < A.EXTENT.z1; z += 11) {
      probes++;
      if (surfaceAt(x, z, 400) === null) holes++;
    }
  }
  note(`${probes} probes over the whole district`);
  check(holes === 0, `there is ground under every part of the city (${holes} holes)`);
  check(A.killY < -10, `killY (${A.killY}) is below the street, so a fall costs the climb, not the run`);
}

// ---------------------------------------------------------------------------
console.log(fails === 0
  ? `\nAll checks passed${warns ? ` (${warns} warning${warns > 1 ? 's' : ''})` : ''}.`
  : `\n${fails} CHECK(S) FAILED${warns ? `, ${warns} warning(s)` : ''}`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fails === 0 ? 0 : 1);
