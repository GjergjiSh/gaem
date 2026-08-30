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
  jump: btn(), dash: btn(), slide: btn(), grapple: btn(), slam: btn(),
  vault: btn(), thrust: btn(), wing: btn(), super: btn(),
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
    // Keep the approach speed alive right up to the lip. Ground friction is
    // 34 m/s^2, so a runner that stops being driven the moment it presses coasts
    // to a halt inside a metre — that is the harness letting go of the stick, not
    // the vault failing. Stops at the launch, which owns velocity from there.
    if (p.grounded && p.vaultT === 0 && p.pos.x < FACE - R) { p.vel.x = keep.x; p.vel.z = keep.z; }
    S.step(p, intent({ vault: btn(go, go) }), WORLD, DT);
    if (p.vaultT > 0) vaulted = true;
    if (!vaulted && p.jumpsLeft < jumpsBefore) jumped = true;
    peak = Math.max(peak, p.pos.y);
  }
  return { vaulted, jumped, peak, x: p.pos.x, z: p.pos.z, pressed };
}

// ---------------------------------------------------------------------------
console.log('\nF vaults only when there is a lip in range');
{
  // Well outside triggerDist (1.5 m by default).
  const early = approach(runner(), (p, gap) => gap < 6.0);
  check(!early.vaulted, 'a press 6 m out does not vault');
  check(!early.jumped, '...and does not come out as a jump either — F is not Space');

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
  const before = approach(runner(), (p, gap) => gap < T.vault.triggerDist * 0.9);
  check(before.vaulted, `early half: pressed ${(T.vault.triggerDist * 0.9).toFixed(2)} m out`);

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
console.log('\ntriggerDist is the range, and it is the knob');
{
  const dist0 = T.vault.triggerDist;
  // A press at a fixed 3 m: outside a 1.5 m range, inside a 5 m one. Nothing
  // else changes, so any difference is the knob doing its job.
  T.vault.triggerDist = 1.5;
  const tight = approach(runner(), (p, gap) => gap < 3.0);
  check(!tight.vaulted, 'triggerDist 1.5: a press 3 m out is too early');

  T.vault.triggerDist = 5.0;
  const loose = approach(runner(), (p, gap) => gap < 3.0);
  check(loose.vaulted, 'triggerDist 5.0: the same press now registers');
  T.vault.triggerDist = dist0;
}

// ---------------------------------------------------------------------------
console.log('\nF is its own key');
{
  // Open floor, no box in range. F does nothing; Space still jumps.
  const p = S.makePlayer({ x: -60, y: HH, z: 0 });
  p.grounded = true;
  p.state = 'grounded';
  p.vel = { x: 12, y: 0, z: 0 };
  S.step(p, intent({ vault: btn(true, true) }), WORLD, DT);
  check(p.vel.y <= 0 && p.jumpsLeft === T.jump.maxJumps, 'F in open air does nothing at all');
  S.step(p, intent({ jump: btn(true, true) }), WORLD, DT);
  check(p.vel.y > 0, `Space still jumps, untouched (vy ${p.vel.y.toFixed(1)})`);

  // Space next to a vaultable lip is a jump, not a vault — the whole point of
  // moving off the shared key.
  const q = runner(20, 0);
  let fired = false;
  for (let k = 0; k < 240 && !fired; k++) {
    const gap = FACE - R - q.pos.x;
    const go = gap < 1.0;
    if (q.grounded && !go) { q.vel.x = 20; q.vel.z = 0; }
    S.step(q, intent({ jump: btn(go, go) }), WORLD, DT);
    if (go) fired = true;
  }
  check(q.vaultT === 0, 'Space at the lip jumps and does NOT vault');
}

// ---------------------------------------------------------------------------
console.log('\ntriggerLead buys back the time a fixed distance loses');
{
  const lead0 = T.vault.triggerLead;
  // At 0 the range is the same metres at every speed, so the same gap works.
  T.vault.triggerLead = 0;
  for (const v of [8, 20, 34]) {
    const r = approach(runner(v), (p, gap) => gap < T.vault.triggerDist * 0.9);
    check(r.vaulted, `${v} m/s vaults on a press 1.35 m out (pure distance)`);
  }
  // Turned up, the range grows with speed: a 4 m press is too early at 8 m/s
  // and fine at 34.
  T.vault.triggerLead = 0.12;
  const slow = approach(runner(8), (p, gap) => gap < 4.0);
  const fast = approach(runner(34), (p, gap) => gap < 4.0);
  check(!slow.vaulted, 'lead 0.12: 4 m is still too early at 8 m/s');
  check(fast.vaulted, 'lead 0.12: 4 m registers at 34 m/s — the range grew with speed');
  T.vault.triggerLead = lead0;
}

console.log(fails ? `\n${fails} FAILED\n` : '\nall good\n');
process.exit(fails ? 1 : 0);
