// Slam and rope behaviour, driven through the real solver.
//
// Compiles src/core (which is engine-agnostic by design, so it runs in node
// with nothing but a stub CollisionWorld) and steps it at the fixed 120 Hz tick
// the game uses.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'slam-'));
try {
  execFileSync('npx', ['tsc', '--ignoreConfig', 'src/core/solver.ts', '--outDir', OUT,
    '--module', 'esnext', '--target', 'es2022', '--moduleResolution', 'bundler',
    '--skipLibCheck'], { stdio: 'pipe', shell: process.platform === 'win32' });
} catch {
  if (!fs.existsSync(path.join(OUT, 'solver.js'))) throw new Error('core failed to compile');
}
// tsc emits extensionless relative imports; node needs them spelled out.
for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith('.js'))) {
  const p = path.join(OUT, f);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/from '\.\/([a-z0-9-]+)'/g, "from './$1.js'"));
}
const S = await import('file:///' + path.join(OUT, 'solver.js').replace(/\\/g, '/'));
const { T } = await import('file:///' + path.join(OUT, 'tuning.js').replace(/\\/g, '/'));

const DT = 1 / 120;

/** Empty space. Nothing to hit, nothing underfoot — pure airborne behaviour. */
const VOID = {
  move: (pos, d) => ({
    pos: { x: pos.x + d.x, y: pos.y + d.y, z: pos.z + d.z },
    grounded: false, normal: { x: 0, y: 1, z: 0 }, hitWall: false, wallNormal: null,
  }),
  ray: () => null,
  rayHit: () => null,
};

const btn = () => ({ pressed: false, held: false });
const HOLD = { pressed: false, held: true };
const intent = (over = {}) => ({
  moveX: 0, moveY: 0, look: { x: 0, y: 0 },
  jump: btn(), dash: btn(), slide: btn(), grapple: btn(), slam: btn(), thrust: btn(),
  wing: btn(),
  ...over,
});

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok  ' : '  FAIL'}  ${msg}`); if (!ok) fails++; };

// ---------------------------------------------------------------------------
console.log('\njump cancels a slam');
{
  const p = S.makePlayer({ x: 0, y: 100, z: 0 });
  p.grounded = false;
  p.state = 'airborne';
  p.jumpsLeft = 2;
  S.step(p, intent({ slam: { pressed: true, held: true } }), VOID, DT);
  check(p.slamming, 'C in clear air starts a slam');
  for (let k = 0; k < 10; k++) S.step(p, intent({ slam: { pressed: false, held: true } }), VOID, DT);
  const falling = p.vel.y;
  check(falling <= -T.slam.speed + 0.01, `slam holds its line (vy ${falling.toFixed(1)})`);

  S.step(p, intent({ jump: { pressed: true, held: true } }), VOID, DT);
  check(!p.slamming, 'jump ends the slam');
  check(p.vel.y > 0, `and you actually go up (vy ${p.vel.y.toFixed(1)})`);
}

// ---------------------------------------------------------------------------
console.log('\nthe slam key on a rope is a dive, not a release');
{
  const p = S.makePlayer({ x: 0, y: 100, z: 0 });
  p.grounded = false;
  p.state = 'airborne';
  S.attachGrappleTo(p, { x: 0, y: 130, z: 0 }, false);
  check(p.grappling, 'hooked');
  // grapple.toggle is false: the rope is hold-to-hang, so every tick below has
  // to keep the button down or the release fires before anything else runs.
  const len0 = p.cables.find((c) => c.on).len;
  const vy0 = p.vel.y;

  for (let k = 0; k < 30; k++) {
    S.step(p, intent({ grapple: HOLD, slam: { pressed: k === 0, held: true } }), VOID, DT);
  }
  check(p.grappling, 'still hooked after pressing slam');
  check(!p.slamming, 'and it did not become a ground slam');
  const len1 = p.cables.find((c) => c.on).len;
  check(len1 > len0 + 0.1, `cable paid out ${(len1 - len0).toFixed(2)} m — the arc got longer`);
  check(p.vel.y < vy0, `and it drove you down (vy ${p.vel.y.toFixed(1)})`);
}

// ---------------------------------------------------------------------------
console.log('\ndive layers on WASD instead of replacing it');
{
  const run = (over) => {
    const p = S.makePlayer({ x: 0, y: 100, z: 0 });
    p.grounded = false;
    p.state = 'airborne';
    S.attachGrappleTo(p, { x: 0, y: 130, z: 0 }, false);
    const len0 = p.cables.find((c) => c.on).len;
    for (let k = 0; k < 30; k++) S.step(p, intent({ grapple: HOLD, ...over(k) }), VOID, DT);
    return p.cables.find((c) => c.on).len - len0;
  };
  const diveOnly = run((k) => ({ slam: { pressed: k === 0, held: true } }));
  const reelOnly = run(() => ({ moveY: 1 }));
  const both = run((k) => ({ moveY: 1, slam: { pressed: k === 0, held: true } }));
  console.log(`     dive ${diveOnly.toFixed(2)} m, reel ${reelOnly.toFixed(2)} m, both ${both.toFixed(2)} m`);
  check(reelOnly < -0.1, 'reeling alone shortens the rope');
  check(Math.abs(both - (diveOnly + reelOnly)) < 0.05, 'holding both adds the two exactly');
}

// ---------------------------------------------------------------------------
console.log('\nregressions: the plain ground slam is untouched');
{
  const p = S.makePlayer({ x: 0, y: 100, z: 0 });
  p.grounded = false;
  p.state = 'airborne';
  p.vel = { x: 12, y: 4, z: 0 };
  S.step(p, intent({ slam: { pressed: true, held: true } }), VOID, DT);
  check(p.slamming, 'still slams when not hooked');
  check(Math.abs(p.vel.x - 12 * T.slam.keepH) < 0.01, 'still applies keepH to horizontal');

  // and it still refuses without air underneath
  const q = S.makePlayer({ x: 0, y: 1, z: 0 });
  q.grounded = false;
  q.state = 'airborne';
  const FLOOR = { ...VOID, ray: () => 0.5 };
  S.step(q, intent({ slam: { pressed: true, held: true } }), FLOOR, DT);
  check(!q.slamming, 'still refuses with the floor right there');
}

fs.rmSync(OUT, { recursive: true, force: true });
console.log(fails === 0 ? '\nAll checks passed.' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
