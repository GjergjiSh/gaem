// Timed vault, driven through the real solver.
//
// Same rig as verify-slam: src/core is engine-agnostic, so it compiles and runs
// in node against a stub CollisionWorld at the game's fixed 120 Hz tick. The
// world here is a floor plus one axis-aligned box, which is all a vault needs:
// a face to run at and a top to land on.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'));
try {
  execFileSync('npx', ['tsc', '--ignoreConfig', 'src/core/solver.ts', '--outDir', OUT,
    '--module', 'esnext', '--target', 'es2022', '--moduleResolution', 'bundler',
    '--skipLibCheck'], { stdio: 'pipe', shell: process.platform === 'win32' });
} catch {
  if (!fs.existsSync(path.join(OUT, 'solver.js'))) throw new Error('core failed to compile');
}
for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith('.js'))) {
  const p = path.join(OUT, f);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/from '\.\/([a-z0-9-]+)'/g, "from './$1.js'"));
}
const S = await import('file:///' + path.join(OUT, 'solver.js').replace(/\\/g, '/'));
const { T } = await import('file:///' + path.join(OUT, 'tuning.js').replace(/\\/g, '/'));

const DT = 1 / 120;
const R = T.character.radius;
const HH = T.character.height / 2;

/**
 * Floor at y=0 plus a box: x in [FACE, FACE+DEPTH], any z, y in [0, TOP].
 * TOP sits between stepHeight and vault.maxHeight, so it is a vaultable lip.
 */
const FACE = 10, DEPTH = 2, TOP = 1.2;
const inBoxX = (x) => x > FACE - R && x < FACE + DEPTH + R;

const WORLD = {
  move(pos, d) {
    let { x, y, z } = { x: pos.x + d.x, y: pos.y + d.y, z: pos.z + d.z };
    let hitWall = false;
    const wallNormal = { x: 0, y: 0, z: 0 };
    // Box face, only while the capsule bottom is below the lip. Above it you are
    // over the top and the box is floor, not wall.
    if (y - HH < TOP && inBoxX(x) && pos.x <= FACE - R) {
      x = FACE - R;
      hitWall = true;
      wallNormal.x = -1;
    }
    // Floor: the box top where we are over it, y=0 everywhere else.
    const floor = (x > FACE && x < FACE + DEPTH) ? TOP : 0;
    let grounded = false;
    if (y - HH <= floor) { y = floor + HH; grounded = true; }
    return { pos: { x, y, z }, grounded, groundNormal: { x: 0, y: 1, z: 0 }, hitWall, wallNormal };
  },
  ray(from, dir, maxDist) {
    const h = this.rayHit(from, dir, maxDist);
    return h ? h.dist : null;
  },
  rayHit(from, dir, maxDist) {
    if (dir.y < -0.5) {                       // downward probe: what is under here?
      const surf = (from.x > FACE && from.x < FACE + DEPTH) ? TOP : 0;
      const d = from.y - surf;
      return d >= 0 && d <= maxDist ? { dist: d, normal: { x: 0, y: 1, z: 0 } } : null;
    }
    if (dir.x > 0.001) {                      // forward probe: the box face
      if (from.y > TOP || from.y < 0) return null;
      // Distance ALONG THE RAY, not along x. A diagonal approach covers the same
      // gap over a longer ray, and dividing by dir.x is the whole difference
      // between the angled cases working and silently never finding the face.
      const d = (FACE - from.x) / dir.x;
      return d >= 0 && d <= maxDist ? { dist: d, normal: { x: -1, y: 0, z: 0 } } : null;
    }
    return null;
  },
};

const btn = (pressed = false, held = false) => ({ pressed, held });
const intent = (over = {}) => ({
  moveX: 0, moveY: 0, yaw: 0, pitch: 0,
  jump: btn(), dash: btn(), slide: btn(), grapple: btn(), slam: btn(), thrust: btn(),
  ...over,
});

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok  ' : '  FAIL'}  ${msg}`); if (!ok) fails++; };

/** Running at the box on the floor, `speed` m/s, aimed `angle` radians off head-on. */
function runner(speed = 20, angle = 0) {
  const p = S.makePlayer({ x: 0, y: HH, z: 0 });
  p.grounded = true;
  p.state = 'grounded';
  p.vel = { x: Math.cos(angle) * speed, y: 0, z: Math.sin(angle) * speed };
  return p;
}

/**
 * Step until the press condition says go, press Space for one tick, then keep
 * stepping. `press` gets the player and the gap to the box face, in metres.
 * Velocity is re-asserted each tick while on the floor so ground friction does
 * not quietly change the approach speed between cases.
 */
function approach(p, press, ticks = 240) {
  const keep = { x: p.vel.x, z: p.vel.z };
  let pressed = false, peak = -Infinity, vaulted = false, jumped = false;
  for (let k = 0; k < ticks; k++) {
    const gap = FACE - R - p.pos.x;
    let go = false;
    if (!pressed && press(p, gap)) { go = true; pressed = true; }
    const jumpsBefore = p.jumpsLeft;
    if (p.grounded && p.pos.x < FACE - R && !pressed) { p.vel.x = keep.x; p.vel.z = keep.z; }
    S.step(p, intent({ jump: btn(go, go) }), WORLD, DT);
    if (p.vaultT > 0) vaulted = true;
    if (!vaulted && p.jumpsLeft < jumpsBefore) jumped = true;
    peak = Math.max(peak, p.pos.y);
  }
  return { vaulted, jumped, peak, x: p.pos.x, z: p.pos.z, pressed };
}

// ---------------------------------------------------------------------------
console.log('\nSpace is the vault only when there is a lip to vault');
{
  // Well outside windowBefore: 20 m/s x 0.16 s = 3.2 m of window, press at 6 m.
  const early = approach(runner(), (p, gap) => gap < 6.0);
  check(!early.vaulted, 'a press 6 m out does not vault');
  check(early.jumped, '...it comes out as an ordinary jump');

  const timed = approach(runner(), (p, gap) => gap < 1.0);
  check(timed.vaulted, 'a press inside the window vaults');
  check(timed.x > FACE + DEPTH, `and carries you past the box (x ${timed.x.toFixed(1)})`);

  const never = approach(runner(), () => false);
  check(!never.vaulted, 'no press, no vault — the button is the move');
  check(never.x < FACE + DEPTH, `you stall on the face instead (x ${never.x.toFixed(1)})`);
}

// ---------------------------------------------------------------------------
console.log('\nthe window has two sides');
{
  const before = approach(runner(), (p, gap) => gap < 20 * T.vault.windowBefore * 0.5);
  check(before.vaulted, `early half: pressed ~${(T.vault.windowBefore * 500).toFixed(0)} ms out`);

  // Late: press only once the face has already been touched.
  const after = approach(runner(), (p) => p.vaultGrace > 0);
  check(after.vaulted, 'late half: pressed after contact, inside windowAfter');
  check(after.x > FACE + DEPTH, `and it still gets you over (x ${after.x.toFixed(1)})`);
}

// ---------------------------------------------------------------------------
console.log('\nthe arc is paid for by the entry angle');
{
  const square = approach(runner(20, 0), (p, gap) => gap < 1.0);
  const slanted = approach(runner(20, 0.75), (p, gap) => gap < 1.0);
  check(square.vaulted && slanted.vaulted, 'both angles vault');
  check(square.peak > slanted.peak,
    `head-on flies higher (${square.peak.toFixed(2)} m vs ${slanted.peak.toFixed(2)} m)`);
  check(square.x > slanted.x,
    `and further past the lip (x ${square.x.toFixed(1)} vs ${slanted.x.toFixed(1)})`);
  check(Math.abs(slanted.z) > 1, `a slanted entry throws you slanted (z ${slanted.z.toFixed(1)})`);

  // Past maxEntryAngle it is a wall you are skimming, not a box you are diving at.
  const glance = approach(runner(20, T.vault.maxEntryAngle + 0.25), (p, gap) => gap < 1.0);
  check(!glance.vaulted, 'past maxEntryAngle it stops being a vault');
}

// ---------------------------------------------------------------------------
console.log('\nnothing is eaten');
{
  // Open floor, no box in range: Space has to be the jump it has always been.
  const p = S.makePlayer({ x: -60, y: HH, z: 0 });
  p.grounded = true;
  p.state = 'grounded';
  p.vel = { x: 12, y: 0, z: 0 };
  S.step(p, intent({ jump: btn(true, true) }), WORLD, DT);
  check(p.vel.y > 0, `Space in open air still jumps (vy ${p.vel.y.toFixed(1)})`);

  // Armed, pressed, then the lip never arrives: failToJump hands the input back.
  const q = runner(20, 0);
  let done = false;
  for (let k = 0; k < 400; k++) {
    const gap = FACE - R - q.pos.x;
    const go = !done && gap < 20 * T.vault.windowBefore * 0.9;
    if (go) { done = true; q.vel.x = 0; q.vel.z = -20; }   // veer away on the press
    if (q.grounded && !done) { q.vel.x = 20; q.vel.z = 0; }
    S.step(q, intent({ jump: btn(go, go) }), WORLD, DT);
    if (q.vel.y > 0.5) break;
  }
  check(q.vel.y > 0.5, `an early press that misses becomes a jump (vy ${q.vel.y.toFixed(1)})`);
}

// ---------------------------------------------------------------------------
console.log('\nspeed does not change the timing');
{
  // The window is a duration, so the same gap-in-seconds has to work at any
  // speed. A fixed-distance probe would fail the fast case.
  for (const v of [8, 20, 34]) {
    const r = approach(runner(v), (p, gap) => gap / v < T.vault.windowBefore * 0.6);
    check(r.vaulted, `${v} m/s vaults on a press ${(T.vault.windowBefore * 600).toFixed(0)} ms out`);
  }
}

console.log(fails ? `\n${fails} FAILED\n` : '\nall good\n');
process.exit(fails ? 1 : 0);
