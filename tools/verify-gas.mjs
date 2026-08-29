// Gas, and the super dash, driven through the real solver.
//
// Gas is worth measuring rather than looking at, for the same reason the wingsuit
// was: it is a claim about a BUDGET, and a budget is only a budget if the prices
// are real and the rule is the same everywhere. Two things can go wrong and
// neither is visible on screen. A cost that quietly does not get charged makes
// the meter decoration. A cost charged on the wrong thing — walking, wallrunning,
// a vault you did not ask for — strands the player on a rooftop with nothing to
// press, which is the one failure this system can produce that is worse than not
// having it.
//
// So: every price is checked against the tuning value, every free verb is checked
// to be actually free, and there is an explicit test that an empty tank on the
// ground recovers on its own.
//
// Compiles src/core (engine-agnostic by design, so it runs in node against a stub
// CollisionWorld) and steps it at the fixed 120 Hz tick the game uses.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-'));
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
const HALF = T.character.height / 2;

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

/** A ground plane at y=0, and nothing else. */
const FLOOR = {
  move: (pos, d) => {
    const np = { x: pos.x + d.x, y: pos.y + d.y, z: pos.z + d.z };
    let grounded = false;
    if (np.y - HALF <= 0) { np.y = HALF; grounded = true; }
    return {
      pos: np, grounded, groundNormal: { x: 0, y: 1, z: 0 },
      hitWall: false, wallNormal: { x: 0, y: 1, z: 0 },
    };
  },
  // Straight down finds the floor; that is what stops a slam right off the deck.
  ray: (from, dir, maxDist) => {
    if (dir.y > -0.5) return null;
    const d = from.y;
    return d <= maxDist ? d : null;
  },
  rayHit: () => null,
};

/** An endless vertical wall at +x, normal pointing back at you. Nothing below. */
const WALL = {
  move: (pos, d) => ({
    pos: { x: pos.x + d.x, y: pos.y + d.y, z: pos.z + d.z },
    grounded: false, groundNormal: { x: 0, y: 1, z: 0 },
    hitWall: false, wallNormal: { x: -1, y: 0, z: 0 },
  }),
  ray: () => null,
  rayHit: (from, dir) => (dir.x > 0.5 ? { dist: 0.5, normal: { x: -1, y: 0, z: 0 } } : null),
};

/**
 * Anything you aim at is 12m away — enough for a cable to bite. `ray`, not
 * `rayHit`: fireGrapple only wants the distance, and a stub that answers the
 * wrong probe reads exactly like a grapple that does not work.
 */
const ANCHOR = { ...VOID, ray: () => 12 };

const btn = () => ({ pressed: false, held: false });
const press = { pressed: true, held: true };
const intent = (over = {}) => ({
  moveX: 0, moveY: 0, yaw: 0, pitch: 0,
  jump: btn(), dash: btn(), slide: btn(), slam: btn(), thrust: btn(), grapple: btn(),
  wing: btn(), super: btn(), ...over,
});

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok  ' : '  FAIL'}  ${msg}`); if (!ok) fails++; };
const note = (msg) => console.log(`        ${msg}`);
const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

function grounded(vz = 0) {
  const p = S.makePlayer({ x: 0, y: HALF, z: 0 });
  p.grounded = true;
  p.state = 'grounded';
  p.vel = { x: 0, y: 0, z: vz };
  return p;
}
function airborne(y = 400, vz = 0) {
  const p = S.makePlayer({ x: 0, y, z: 0 });
  p.grounded = false;
  p.state = 'airborne';
  p.vel = { x: 0, y: 0, z: vz };
  return p;
}
/** Run one press and report what it cost. */
function cost(p, over, col = VOID) {
  const before = p.gas;
  S.step(p, intent(over), col, DT);
  return before - p.gas;
}

// ---------------------------------------------------------------------------
console.log('\nthe price list is real: every move charges what the panel says');
{
  const g = grounded();
  check(near(cost(g, { jump: press }, FLOOR), T.jump.gas),
    `a jump off the ground costs jump.gas (${T.jump.gas})`);

  const a = airborne();
  check(near(cost(a, { jump: press }), T.jump.gasAir),
    `and one in the air costs jump.gasAir (${T.jump.gasAir}) — a different purchase`);

  const d = airborne();
  check(near(cost(d, { dash: press }), T.dash.gas),
    `a dash costs dash.gas (${T.dash.gas})`);

  const s = grounded(-8);
  check(near(cost(s, { slide: press }, FLOOR), T.slide.gas),
    `entering a slide costs slide.gas (${T.slide.gas}), once and not per second`);

  // ...and staying in it is free, which is the point of charging on entry.
  const before = s.gas;
  for (let k = 0; k < 60; k++) S.step(s, intent({ slide: { pressed: false, held: true } }), FLOOR, DT);
  check(s.state === 'sliding' && s.gas >= before,
    'and holding the slide costs nothing more (a long slide is not a dear one)');

  const c = airborne();
  check(near(cost(c, { slam: press }), T.slam.gas),
    `a slam costs slam.gas (${T.slam.gas}) — it used to be free, and free was the problem`);

  const z = grounded();
  check(near(cost(z, { super: press }, FLOOR), T.superdash.gas),
    `a super dash costs superdash.gas (${T.superdash.gas}) — half a tank, by design`);

  // The wall: attach by running past it, then kick off.
  const w = airborne(400, -12);
  S.step(w, intent(), WALL, DT);
  check(w.state === 'wallrunning', 'setup: on a wall');
  const wallStart = w.gas;
  for (let k = 0; k < 24; k++) S.step(w, intent(), WALL, DT);
  check(w.state === 'wallrunning' && w.gas >= wallStart,
    'the RUN along a wall is free — wallrunning is running');
  check(near(cost(w, { jump: press }, WALL), T.wall.gasJump),
    `but the kick off it costs wall.gasJump (${T.wall.gasJump})`);
}

// ---------------------------------------------------------------------------
console.log('\nand an empty tank means the move does not come out');
{
  const cases = [
    ['a dash', { dash: press }, (p) => p.state === 'dashing'],
    ['an air jump', { jump: press }, (p) => p.vel.y > 1],
    ['a slam', { slam: press }, (p) => p.slamming],
    ['a super dash', { super: press }, (p) => p.state === 'dashing'],
  ];
  for (const [name, over, fired] of cases) {
    const rich = airborne();
    S.step(rich, intent(over), VOID, DT);
    check(fired(rich), `setup: ${name} fires on a full tank`);
    const broke = airborne();
    broke.gas = 0;
    S.step(broke, intent(over), VOID, DT);
    check(!fired(broke), `  ...and refuses on an empty one`);
  }
}

// ---------------------------------------------------------------------------
console.log('\nwhat is free is really free — this is what stops the rule stranding you');
{
  const run = grounded();
  for (let k = 0; k < 240; k++) S.step(run, intent({ moveY: 1 }), FLOOR, DT);
  check(run.gas >= T.gas.max - 1e-6 && Math.hypot(run.vel.x, run.vel.z) > 5,
    'two seconds of running: moving, and the tank never moved');

  // The wingsuit. Deploy, glide for four seconds, no jets.
  const wing = airborne(2000, -40);
  S.step(wing, intent({ wing: press }), VOID, DT);
  check(wing.state === 'wingsuit', 'setup: in the suit');
  const g0 = wing.gas;
  for (let k = 0; k < 480; k++) S.step(wing, intent(), VOID, DT);
  check(wing.state === 'wingsuit' && wing.gas >= g0,
    'four seconds of gliding is free — the wing is a shape, not an engine');

  // The rope: firing it, and hanging on it.
  const rope = airborne(400, -20);
  const r0 = rope.gas;
  S.step(rope, intent({ grapple: press }), ANCHOR, DT);
  check(rope.grappling, 'setup: hooked');
  for (let k = 0; k < 240; k++) {
    S.step(rope, intent({ grapple: { pressed: false, held: true } }), ANCHOR, DT);
  }
  check(rope.grappling && rope.gas >= r0, 'and two seconds on the cable is free too');

  // The one that matters most: flat on the deck with nothing in the tank.
  const dry = grounded();
  dry.gas = 0;
  let recovered = -1;
  for (let k = 0; k < 240; k++) {
    S.step(dry, intent(), FLOOR, DT);
    if (recovered < 0 && dry.gas >= T.jump.gas) recovered = k * DT;
  }
  note(`empty on the deck: a jump is affordable again after ${recovered.toFixed(2)}s`);
  check(recovered > 0 && recovered < 1.2,
    'an empty tank on the ground costs you a moment, never a run');
}

// ---------------------------------------------------------------------------
console.log('\nspending delays the refill, or the prices would be fiction');
{
  const p = airborne();
  S.step(p, intent({ dash: press }), VOID, DT);
  const spent = p.gas;
  for (let k = 0; k < Math.round((T.gas.refuelDelay - 0.05) / DT); k++) S.step(p, intent(), VOID, DT);
  check(near(p.gas, spent, 1e-6), `nothing comes back for gas.refuelDelay (${T.gas.refuelDelay}s)`);
  for (let k = 0; k < 60; k++) S.step(p, intent(), VOID, DT);
  check(p.gas > spent + 5, 'and then it refills');
}

// ---------------------------------------------------------------------------
console.log('\nthe jets bill per second, and only they can dry the tank out');
{
  const p = airborne();
  p.jumpsLeft = 0;                      // thruster.requireEmptyJumps
  const burn = intent({ thrust: { pressed: false, held: true } });
  for (let k = 0; k < 60; k++) S.step(p, burn, VOID, DT);
  const spent = T.gas.max - p.gas;
  note(`half a second of hover: ${spent.toFixed(1)} gas (burnRate ${T.thruster.burnRate}/s)`);
  check(near(spent, T.thruster.burnRate * 0.5, 1.5), 'the hover burns at thruster.burnRate');

  // Hold it until the tank is out. Bounded rather than a fixed count, because
  // holding for a fixed 5s ran PAST the lockout: the tank refills the moment the
  // jets cut out, so by the end of the loop it was back over `restart` and no
  // longer dry. The lockout is a moment, not a state you can stroll up to.
  let dryAt = -1;
  for (let k = 0; k < 1200 && dryAt < 0; k++) {
    S.step(p, burn, VOID, DT);
    if (p.gasDry) dryAt = (k + 60) * DT;
  }
  note(`the tank runs out after ${dryAt.toFixed(2)}s of hover`);
  check(dryAt > 0, 'burning the last drop sets gasDry');

  // Refill to just short of `restart` — the one window where the two rules can
  // be told apart: enough gas for a jump, not enough to re-light.
  for (let k = 0; k < 1200 && p.gas < T.gas.restart - 3; k++) S.step(p, intent(), VOID, DT);
  note(`refilled to ${p.gas.toFixed(0)}, under gas.restart (${T.gas.restart})`);
  check(p.gasDry, 'still dry: the jets want gas.restart back, not a drop');
  S.step(p, burn, VOID, DT);
  check(!p.thrusting, 'so holding the button does nothing');
  // ...and a jump does, which is the whole reason gasDry is the jets' alone. A
  // lockout that also took your jump would leave you on a roof with a part-full
  // bar and nothing to press.
  p.jumpsLeft = 1;
  const beforeJump = p.vel.y;
  S.step(p, intent({ jump: press }), VOID, DT);
  check(p.vel.y > beforeJump + 5, 'but a jump comes out — the dry lockout is the jets, not the kit');

  let relit = -1;
  for (let k = 0; k < 1200 && relit < 0; k++) {
    S.step(p, intent(), VOID, DT);
    if (!p.gasDry) relit = p.gas;
  }
  check(relit >= T.gas.restart - 1, `and the jets re-light at gas.restart (${T.gas.restart})`);
}

// ---------------------------------------------------------------------------
console.log('\nthe cheat: infinite gas makes every price zero');
{
  T.cheats.infiniteGas = true;
  const p = airborne();
  p.jumpsLeft = 0;
  for (let k = 0; k < 240; k++) S.step(p, intent({ thrust: { pressed: false, held: true } }), VOID, DT);
  check(near(p.gas, T.gas.max, 1e-6), 'two seconds of jets and the tank is still full');
  check(p.thrusting, 'and they are still burning');
  p.jumpsLeft = 2;
  S.step(p, intent({ super: press }), VOID, DT);
  check(p.state === 'dashing' && near(p.gas, T.gas.max, 1e-6), 'a super dash is free');

  // And it does not merely stop spending — an empty tank is whole on the next
  // tick, so flipping the box mid-fall works now rather than in three seconds.
  const empty = airborne();
  empty.gas = 0;
  empty.gasDry = true;
  S.step(empty, intent(), VOID, DT);
  check(near(empty.gas, T.gas.max, 1e-6) && !empty.gasDry,
    'switching it on refills and un-dries immediately');
  T.cheats.infiniteGas = false;
}

// ---------------------------------------------------------------------------
console.log('\nZ launches, and one missing clamp is the whole difference');
{
  /** Press it looking up at `pitch`, then coast until we come back down. */
  function launch(over, pitch = Math.PI / 2) {
    const p = grounded();
    S.step(p, intent({ ...over, pitch }), FLOOR, DT);
    let peak = p.pos.y;
    for (let k = 0; k < 1200; k++) {
      S.step(p, intent({ pitch }), FLOOR, DT);
      peak = Math.max(peak, p.pos.y);
      if (p.grounded && k > 30) break;
    }
    return peak;
  }

  const sup = launch({ super: press });
  const dash = launch({ dash: press });
  note(`aimed straight up: super dash peaks at ${sup.toFixed(0)}m, dash at ${dash.toFixed(0)}m`);
  check(sup > 50, 'the super dash puts you 50m+ over flat ground');
  check(sup > dash * 3, 'and it is a different move, not a bigger number: 3x+ the height');
  check(dash < 14, "the ordinary dash still cannot launch — its vertical exit clamp is intact");

  // The bug this was designed around: the dash builds its direction by adding y
  // to a FULL-LENGTH horizontal vector, so with W held a fully vertical aim comes
  // out at 45 degrees. The launch is spherical instead.
  const straight = grounded();
  S.step(straight, intent({ super: press, pitch: Math.PI / 2, moveY: 1 }), FLOOR, DT);
  note(`aimed up with W held: dir.y = ${straight.dashDir.y.toFixed(3)}`);
  check(straight.dashDir.y > 0.99,
    'aiming at the sky goes at the sky even with the stick held forward');

  const level = grounded();
  S.step(level, intent({ super: press, pitch: 0, moveY: 1 }), FLOOR, DT);
  check(Math.abs(level.dashDir.y) < 0.01 && level.dashDir.z < -0.99,
    'and aimed level it goes where the stick points, like any dash');

  const cd = grounded();
  S.step(cd, intent({ super: press }), FLOOR, DT);
  const armed = cd.superCooldown;
  cd.state = 'grounded';
  cd.dashTime = 0;
  S.step(cd, intent({ super: press }), FLOOR, DT);
  check(armed > 0 && cd.superCooldown < armed,
    `it cannot be chained: superdash.cooldown (${T.superdash.cooldown}s) has to run out`);
}

// ---------------------------------------------------------------------------
console.log('\nthe point of the launch: it hands you off to the wingsuit');
{
  const p = grounded();
  const up = Math.PI / 2;
  S.step(p, intent({ super: press, pitch: up }), FLOOR, DT);
  // Ride it up and deploy at the apex, which is the input the player actually
  // makes: Z, wait, X.
  let last = p.pos.y;
  let apex = 0;
  for (let k = 0; k < 1200; k++) {
    S.step(p, intent({ pitch: up }), FLOOR, DT);
    if (p.pos.y < last) { apex = last; break; }
    last = p.pos.y;
  }
  note(`apex ${apex.toFixed(0)}m`);
  S.step(p, intent({ wing: press, pitch: -0.35 }), FLOOR, DT);
  check(p.state === 'wingsuit', 'X at the top of a launch deploys the suit');

  const z0 = p.pos.z;
  const y0 = p.pos.y;
  for (let k = 0; k < 600; k++) S.step(p, intent({ pitch: -0.2 }), FLOOR, DT);
  const flown = Math.abs(p.pos.z - z0);
  note(`five seconds of glide off it: ${flown.toFixed(0)}m out, ${(y0 - p.pos.y).toFixed(0)}m down`);
  check(flown > 100, 'and from there the glide actually goes somewhere');
  check(p.gas > T.gas.max - T.superdash.gas - 1,
    'having spent nothing beyond the launch itself');
}

console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed.\n');
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
