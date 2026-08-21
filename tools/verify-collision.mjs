// Enemy collision, against the real Rapier world.
//
// The requirement has two halves and the second is the dangerous one: robots
// have to be solid to the character, and completely absent from every question
// the solver asks the world. The solver rays constantly — clear air under a
// slam, a ledge to vault, a wall to run — and if a robot can answer any of
// those, standing near one changes how you move.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Compile the real physics.ts into the repo (so bare 'three' and rapier
// resolve from node_modules) and spell out the extensions node needs.
const OUT = path.resolve('.verify-tmp');
fs.rmSync(OUT, { recursive: true, force: true });
try {
  execFileSync('npx', ['tsc', '--ignoreConfig', 'src/engine/physics.ts', '--outDir', OUT,
    '--module', 'esnext', '--target', 'es2022', '--moduleResolution', 'bundler',
    '--skipLibCheck'], { stdio: 'pipe', shell: process.platform === 'win32' });
} catch {
  if (!fs.existsSync(path.join(OUT, 'engine', 'physics.js'))) {
    throw new Error('physics failed to compile');
  }
}
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
for (const f of walk(OUT).filter((f) => f.endsWith('.js'))) {
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8')
    .replace(/(from '\.\.?\/[^']+)'/g, "$1.js'"));
}
const cleanup = () => fs.rmSync(OUT, { recursive: true, force: true });
const load = (rel) => import(pathToFileURL(path.join(OUT, rel)).href);

const P = await load('engine/physics.js');
const { T } = await load('core/tuning.js');
await P.initPhysics();

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok  ' : '  FAIL'}  ${msg}`); if (!ok) fails++; };
const v = (x, y, z) => ({ x, y, z });
/**
 * Rapier's query pipeline is empty until the world steps, so a ray into a
 * freshly built world reports nothing at all -- including through solid level
 * geometry. move() steps as part of its job, which is why this never shows up
 * in the game; a test that only rays has to do it by hand.
 */
const settle = (w) => { w.move(v(0, 400, 0), v(0, 0, 0)); return w; };

// A floor at y=0 (top face), 60 x 60.
const FLOOR = [{ p: [0, -1, 0], s: [60, 2, 60], c: 0 }];
const feet = (x, y, z) => [{ pos: v(x, y, z) }];

// ---------------------------------------------------------------------------
console.log('\nrobots are solid to the character');
{
  const w = new P.RapierWorld(FLOOR, v(0, 1, 0));
  w.syncEnemies(feet(3, 0, 0));           // one robot three metres to the +x
  let pos = v(0, T.character.height / 2, 0);
  for (let k = 0; k < 240; k++) pos = w.move(pos, v(0.05, 0, 0)).pos;   // walk into it
  const r = T.enemy.colliderRadius * T.enemy.scale;
  console.log(`     walked to x=${pos.x.toFixed(2)} (robot at 3.00, radius ${r.toFixed(2)})`);
  check(pos.x < 3 - r + 0.05, 'stopped short of the robot instead of walking through it');
  check(pos.x > 1.2, 'and actually got most of the way there');
}

// ---------------------------------------------------------------------------
console.log('\nand you can stand on one');
{
  const w = new P.RapierWorld(FLOOR, v(0, 1, 0));
  w.syncEnemies(feet(0, 0, 0));
  const top = 1.8 * T.enemy.scale;
  let pos = v(0, top + T.character.height / 2 + 0.6, 0);
  let res;
  for (let k = 0; k < 240; k++) res = w.move(pos, v(0, -0.05, 0)), pos = res.pos;
  console.log(`     settled at y=${pos.y.toFixed(2)}, robot is ${top.toFixed(2)} m tall`);
  check(res.grounded, 'grounded on the robot');
  check(pos.y > top, 'and standing on top of it, not inside it');
}

// ---------------------------------------------------------------------------
console.log('\nTHE guarantee: the solver never sees a robot');
{
  const w = settle(new P.RapierWorld(FLOOR, v(0, 40, 0)));
  w.syncEnemies(feet(0, 0, 0));
  settle(w);
  // straight down, from above the robot's head, at its feet position
  const down = w.ray(v(0, 6, 0), v(0, -1, 0), 40);
  console.log(`     ray down through the robot reports ${down === null ? 'nothing' : down.toFixed(2)} m`);
  check(down !== null && Math.abs(down - 6) < 0.2, 'it passes through and finds the FLOOR at 6 m');

  // sideways, through the robot's chest, with nothing behind it
  const across = w.ray(v(-6, 1.5, 0), v(1, 0, 0), 5);
  check(across === null, 'a ray through its chest hits nothing at all');

  const hit = w.rayHit(v(0, 6, 0), v(0, -1, 0), 40);
  check(hit !== null && Math.abs(hit.dist - 6) < 0.2, 'rayHit agrees — floor, not robot');

  // and the level is still perfectly visible to the same rays
  const wall = settle(new P.RapierWorld(
    [...FLOOR, { p: [4, 2, 0], s: [1, 4, 8], c: 0 }], v(0, 1, 0)));
  check(wall.ray(v(0, 2, 0), v(1, 0, 0), 10) !== null, 'a real wall still stops a solver ray');
}

// ---------------------------------------------------------------------------
console.log('\nmovement over level geometry is bit-for-bit unchanged');
{
  const walk = (withEnemies) => {
    const w = new P.RapierWorld(
      [...FLOOR, { p: [6, 0.2, 0], s: [4, 0.4, 8], c: 0 }], v(0, 1, 0));
    if (withEnemies) w.syncEnemies(feet(-20, 0, 0));   // far away, off the path
    let pos = v(0, T.character.height / 2, 0);
    const trail = [];
    for (let k = 0; k < 200; k++) {
      pos = w.move(pos, v(0.06, -0.02, 0)).pos;
      trail.push(`${pos.x.toFixed(6)},${pos.y.toFixed(6)},${pos.z.toFixed(6)}`);
    }
    return trail.join('|');
  };
  const a = walk(false);
  const b = walk(true);
  check(a === b, 'the same 200 steps over a step-up produce an identical path');
}

// ---------------------------------------------------------------------------
console.log('\nthe toggle and the haul');
{
  const w = new P.RapierWorld(FLOOR, v(0, 1, 0));
  w.syncEnemies(feet(3, 0, 0));
  T.enemy.collide = false;
  w.syncEnemies(feet(3, 0, 0));
  let pos = v(0, T.character.height / 2, 0);
  for (let k = 0; k < 240; k++) pos = w.move(pos, v(0.05, 0, 0)).pos;
  check(pos.x > 5, `enemy.collide off and you walk straight through (x=${pos.x.toFixed(2)})`);
  T.enemy.collide = true;

  // dragged by the meathook: the collider has to come with it
  const w2 = new P.RapierWorld(FLOOR, v(0, 1, 0));
  w2.syncEnemies(feet(3, 0, 0));
  for (let k = 0; k < 30; k++) w2.syncEnemies(feet(12, 0, 0));   // hauled away
  let q = v(0, T.character.height / 2, 0);
  for (let k = 0; k < 160; k++) q = w2.move(q, v(0.05, 0, 0)).pos;
  check(q.x > 4, `no invisible wall left where it used to be (x=${q.x.toFixed(2)})`);
}

cleanup();
console.log(fails === 0 ? '\nAll checks passed.' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
