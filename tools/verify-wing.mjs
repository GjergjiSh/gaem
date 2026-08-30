// The wingsuit, driven through the real solver.
//
// This one is worth having as a measurement rather than a look, because the verb
// is a claim about ENERGY: aiming down buys speed, raising the mouse spends it
// on height, and neither direction is allowed to be free. A glide that quietly
// makes energy is a glide you can loop forever, and you cannot see that in a
// screenshot — you see it twenty seconds later when the player is in orbit.
//
// Compiles src/core (engine-agnostic by design, so it runs in node against a
// stub CollisionWorld) and steps it at the fixed 120 Hz tick the game uses.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-'));
try {
  execFileSync('npx', ['tsc', '--ignoreConfig', 'src/core/solver.ts', '--outDir', OUT,
    '--module', 'esnext', '--target', 'es2022', '--moduleResolution', 'bundler',
    '--skipLibCheck'], { stdio: 'pipe', shell: process.platform === 'win32' });
} catch {
  if (!fs.existsSync(path.join(OUT, 'solver.js'))) throw new Error('core failed to compile');
}
for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith('.js'))) {
  const q = path.join(OUT, f);
  fs.writeFileSync(q, fs.readFileSync(q, 'utf8').replace(/from '\.\/([a-z0-9-]+)'/g, "from './$1.js'"));
}
const S = await import('file:///' + path.join(OUT, 'solver.js').replace(/\\/g, '/'));
const { T } = await import('file:///' + path.join(OUT, 'tuning.js').replace(/\\/g, '/'));

const DT = 1 / 120;

/** Empty space: nothing to hit, nothing underfoot. */
const VOID = {
  move: (pos, d) => ({
    pos: { x: pos.x + d.x, y: pos.y + d.y, z: pos.z + d.z },
    grounded: false, groundNormal: { x: 0, y: 1, z: 0 }, hitWall: false,
    wallNormal: { x: 0, y: 1, z: 0 },
  }),
  ray: () => null,
  rayHit: () => null,
};

const btn = () => ({ pressed: false, held: false });
/** Looking along -Z (yaw 0) at `pitch` radians. */
const intent = (pitch = 0, over = {}) => ({
  moveX: 0, moveY: 0, yaw: 0, pitch,
  jump: btn(), dash: btn(), slide: btn(), slam: btn(), thrust: btn(), grapple: btn(),
  vault: btn(),
  wing: btn(), super: btn(), ...over,
});

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok  ' : '  FAIL'}  ${msg}`); if (!ok) fails++; };
const note = (msg) => console.log(`        ${msg}`);
const speed = (p) => Math.hypot(p.vel.x, p.vel.y, p.vel.z);

/** Airborne, in the suit, flying level along -Z at `v`. */
function flying(v = 40, y = 400) {
  const p = S.makePlayer({ x: 0, y, z: 0 });
  p.grounded = false;
  p.state = 'airborne';
  p.vel = { x: 0, y: 0, z: -v };
  S.step(p, intent(0, { wing: { pressed: true, held: true } }), VOID, DT);
  return p;
}
/** Hold `pitch` for `secs`. */
function hold(p, pitch, secs, over = {}) {
  for (let k = 0; k < Math.round(secs / DT); k++) S.step(p, intent(pitch, over), VOID, DT);
  return p;
}

// ---------------------------------------------------------------------------
console.log('\nX deploys and stows, and only in the air');
{
  const g = S.makePlayer({ x: 0, y: 0, z: 0 });
  g.grounded = true;
  g.state = 'grounded';
  S.step(g, intent(0, { wing: { pressed: true, held: true } }), VOID, DT);
  check(g.state !== 'wingsuit', 'a wingsuit on the ground is a costume, and does not deploy');

  const p = flying();
  check(p.state === 'wingsuit', 'X in the air deploys it');
  S.step(p, intent(0, { wing: { pressed: true, held: true } }), VOID, DT);
  check(p.state === 'airborne', 'X again stows it');
}

// ---------------------------------------------------------------------------
console.log('\ndeploying cancels everything except the jets');
{
  // Mid-dash.
  const p = S.makePlayer({ x: 0, y: 400, z: 0 });
  p.grounded = false;
  p.state = 'airborne';
  p.vel = { x: 0, y: 0, z: -20 };
  S.step(p, intent(0, { dash: { pressed: true, held: false } }), VOID, DT);
  check(p.state === 'dashing', 'setup: a dash is running');
  S.step(p, intent(0, { wing: { pressed: true, held: true } }), VOID, DT);
  check(p.state === 'wingsuit', 'a dash can be cancelled into the suit');
  check(p.dashTime <= 0, 'and the dash is actually over, not still owning velocity');

  // The jets survive, because they are the half that combines.
  const q = flying(50);
  hold(q, 0, 0.2, { thrust: { pressed: false, held: true } });
  check(q.thrusting, 'the jets still light inside the suit');
  check(q.gas < T.gas.max, `and they burn the tank (${q.gas.toFixed(0)} of ${T.gas.max})`);
}

// ---------------------------------------------------------------------------
console.log('\naiming down buys speed; a dive has a terminal');
{
  const p = flying(30);
  const v0 = speed(p);
  hold(p, -Math.PI / 2, 1.0);
  const v1 = speed(p);
  note(`straight down for a second: ${v0.toFixed(1)} -> ${v1.toFixed(1)} m/s`);
  // Most of `wing.gravity` in the first second, and it cannot be all of it — a
  // second of it goes on swinging the nose down, and drag takes a bite.
  check(v1 > v0 + T.wing.gravity * 0.4, 'a dive gains speed, and quickly');

  hold(p, -Math.PI / 2, 12);
  const term = speed(p);
  const want = Math.sqrt(T.wing.gravity / T.wing.drag);
  note(`terminal dive settles at ${term.toFixed(1)} m/s (sqrt(g/drag) = ${want.toFixed(1)})`);
  check(Math.abs(term - want) < 1.5, 'and it settles where the drag says it should');
  check(term <= T.wing.maxSpeed + 0.01, `never past maxSpeed (${T.wing.maxSpeed})`);
  check(term > T.momentum.hardCap * 1.4,
    `a dive is comfortably the fastest thing on the map (hardCap ${T.momentum.hardCap})`);
}

// ---------------------------------------------------------------------------
console.log('\nraising the mouse spends that speed on height');
{
  // Measured from the BOTTOM of the pull-out, not from the moment the input
  // changed. Swinging 80 m/s of near-vertical dive back up through 160 degrees
  // takes over a second at `turn`, and you are still going down for most of it —
  // so the first version of this check read the cost of the pull-out and called
  // it a failed climb. The trade is the trough to the crest.
  const p = flying(30);
  hold(p, -0.8, 2.0);                    // dive to build, 46 degrees down
  const fast = speed(p);
  let low = p.pos.y;
  let high = -1e9;
  for (let k = 0; k < Math.round(3.0 / DT); k++) {
    S.step(p, intent(0.9), VOID, DT);    // and pull up, 52 degrees
    low = Math.min(low, p.pos.y);
    high = Math.max(high, p.pos.y);
  }
  note(`dived to ${fast.toFixed(1)} m/s, then climbed ${(high - low).toFixed(1)} m `
    + `out of the trough`);
  check(high - low > 25, 'the speed comes back as real height');
  check(speed(p) < fast * 0.7, `and it is paid for (${speed(p).toFixed(1)} m/s left)`);
}

// ---------------------------------------------------------------------------
console.log('\nand the trade cannot be run at a profit');
{
  // The check this file exists for. Dive, pull up, and come back to level: with
  // no drag that returns you to the height you started at, and WITH drag it has
  // to come back lower. Anything else is a glide that makes energy, which is a
  // glide you can loop until you leave the map.
  const p = flying(45);
  const y0 = p.pos.y;
  const e0 = 0.5 * speed(p) ** 2 + T.wing.gravity * p.pos.y;
  for (let loop = 0; loop < 4; loop++) {
    hold(p, -0.9, 1.4);
    hold(p, 0.9, 1.4);
  }
  const e1 = 0.5 * speed(p) ** 2 + T.wing.gravity * p.pos.y;
  note(`four dive-and-climb loops: energy ${(e0 / 1000).toFixed(1)} -> ${(e1 / 1000).toFixed(1)} kJ/kg, `
    + `height ${y0.toFixed(0)} -> ${p.pos.y.toFixed(0)} m`);
  check(e1 < e0, 'every loop costs energy — drag is the only term that is not reversible');
  check(p.pos.y < y0, 'so pumping the mouse cannot climb; it can only trade');
}

// ---------------------------------------------------------------------------
console.log('\na level glide sinks, which is what makes it a glide');
{
  // Held level from fast, the wing genuinely holds its line for a moment — that
  // is lift doing its job — and then drag takes the speed that was buying it and
  // the nose starts to fall. Both halves matter, so both get measured.
  const p = flying(55);
  const y1 = p.pos.y;
  hold(p, 0, 1);
  note(`first second level: ${(p.pos.y - y1).toFixed(1)} m, at ${speed(p).toFixed(1)} m/s`);
  check(p.pos.y > y1 - 3, 'while it is fast, a level aim really does hold the line');
  // Then let it settle. It holds level while it is above the stall, spending
  // speed to do it, and only sinks once drag has taken that speed — so the
  // equilibrium has to be measured AFTER the sustainable phase, not across it.
  // Reading the average over the whole thing was the first version of this
  // check, and it reported a glide with no sink at all.
  hold(p, 0, 9);
  const y2 = p.pos.y;
  hold(p, 0, 4);
  const sink = (y2 - p.pos.y) / 4;
  const fwd = Math.hypot(p.vel.x, p.vel.z);
  note(`settled: ${sink.toFixed(1)} m/s down at ${fwd.toFixed(1)} m/s forward `
    + `(glide ${(fwd / Math.max(0.01, sink)).toFixed(1)}:1)`);
  check(sink > 0.5, 'once drag has the speed, a level aim cannot hold it — a wing is not a hover');
  // lift/drag IS the glide ratio, so the measurement and the arithmetic have to
  // agree. If they stop agreeing, one of the three terms has grown a second job.
  const want = T.wing.lift / T.wing.drag;
  note(`and lift / drag says it should be ${want.toFixed(1)}:1`);
  check(Math.abs(fwd / Math.max(0.01, sink) - want) < want * 0.35,
    'which is what lift / drag predicts, so the model is still the model');
  // Sustainable level flight needs the path rotated up at g/v, so the wing runs
  // out of authority below this. It is the number `turn` really sets.
  const hold_v = Math.sqrt(T.wing.gravity / T.wing.lift);
  note(`level flight needs sqrt(gravity / lift) = ${hold_v.toFixed(1)} m/s to sustain`);
  check(hold_v > T.ground.maxSpeed * 1.5,
    `and it is well past a run (${T.ground.maxSpeed}), so level flight has to be earned`);
  check(hold_v < T.momentum.hardCap,
    `but inside what ordinary tech reaches (${T.momentum.hardCap}), so a dash into the suit flies`);
}

// ---------------------------------------------------------------------------
console.log('\nthe jets turn the glide into flight');
{
  const p = flying(40);
  const y0 = p.pos.y;
  hold(p, 0.5, 2.5, { thrust: { pressed: false, held: true } });
  note(`jets on, nose up 29 deg: ${(p.pos.y - y0).toFixed(1)} m of climb, `
    + `${speed(p).toFixed(1)} m/s`);
  check(p.pos.y > y0 + 10, 'with the jets lit you can climb on the aim alone');
  check(speed(p) <= T.wing.jetCap + 0.01, `and it is capped (jetCap ${T.wing.jetCap})`);

  // Without them, the same aim only bleeds off.
  const q = flying(40);
  const qy = q.pos.y;
  hold(q, 0.5, 2.5);
  check(q.pos.y < p.pos.y, 'and unpowered the same aim does not hold the climb');
}

// ---------------------------------------------------------------------------
console.log('\nthe stall: no speed, no wing');
{
  const p = flying(4);
  // Nose hard up at a crawl. With the turn rate scaled by speed it cannot simply
  // point up and hang there, which is what would make the suit a hover.
  hold(p, Math.PI / 2, 0.6);
  note(`deployed at a crawl, nose up: vy ${p.vel.y.toFixed(1)} m/s`);
  check(p.vel.y < 0, 'below stall the nose cannot be held up and you drop');
}

// ---------------------------------------------------------------------------
console.log('\nlanding stows it, and a dash is a way out');
{
  const GROUND = {
    ...VOID,
    move: (pos, d) => ({
      pos: { x: pos.x + d.x, y: Math.max(0, pos.y + d.y), z: pos.z + d.z },
      grounded: pos.y + d.y <= 0,
      groundNormal: { x: 0, y: 1, z: 0 }, hitWall: false, wallNormal: { x: 0, y: 1, z: 0 },
    }),
  };
  const p = S.makePlayer({ x: 0, y: 3, z: 0 });
  p.grounded = false;
  p.state = 'airborne';
  p.vel = { x: 0, y: 0, z: -40 };
  S.step(p, intent(0, { wing: { pressed: true, held: true } }), GROUND, DT);
  check(p.state === 'wingsuit', 'setup: flying just off the deck');
  for (let k = 0; k < 400 && p.state === 'wingsuit'; k++) S.step(p, intent(-0.3), GROUND, DT);
  check(p.state !== 'wingsuit', `touching down stows it (ended ${p.state})`);

  if (T.wing.cancelOnDash) {
    const q = flying(40);
    S.step(q, intent(0, { dash: { pressed: true, held: false } }), VOID, DT);
    check(q.state === 'dashing', 'and a dash gets you out rather than trapping you');
  }
}

// ---------------------------------------------------------------------------
console.log(fails === 0 ? '\nAll checks passed.' : `\n${fails} CHECK(S) FAILED`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fails === 0 ? 0 : 1);
