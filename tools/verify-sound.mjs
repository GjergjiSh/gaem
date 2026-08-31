// What the wall sounds like, and why it can be checked at all.
//
// The audio layer never looks at the Player. It reads a Frame from engine/moves.ts
// — a list of verbs that fired — and turns each verb into a clip through
// T.soundAssign. So "a wall catch makes the landing noise" is not a claim about
// sound at all: it is a claim that the wall attach FIRES a verb, and that the verb
// resolves to the same clip the floor uses. Both halves are checkable in node, and
// neither is checkable by listening — a missing verb and a muted clip are the same
// silence, and you cannot tell them apart with your ears.
//
// That is the whole reason this file exists. Wall audio had already been mapped
// once before, to '' (no clip yet); nothing caught it because nothing could.
//
// Compiles src/core AND src/engine/moves.ts. moves.ts is engine-side but imports
// only a core TYPE, so it compiles and runs here exactly as it does in the browser.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'sound-'));
try {
  execFileSync('npx', ['tsc', '--ignoreConfig', 'src/core/solver.ts', 'src/engine/moves.ts',
    '--outDir', OUT, '--rootDir', 'src',
    '--module', 'esnext', '--target', 'es2022', '--moduleResolution', 'bundler',
    '--skipLibCheck'], { stdio: 'pipe', shell: process.platform === 'win32' });
} catch {
  if (!fs.existsSync(path.join(OUT, 'core', 'solver.js'))) throw new Error('core failed to compile');
}
for (const dir of ['core', 'engine']) {
  const d = path.join(OUT, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d).filter((f) => f.endsWith('.js'))) {
    const q = path.join(d, f);
    fs.writeFileSync(q, fs.readFileSync(q, 'utf8')
      .replace(/from '\.\/([a-z0-9-]+)'/g, "from './$1.js'")
      .replace(/from '\.\.\/core\/([a-z0-9-]+)'/g, "from '../core/$1.js'"));
  }
}
const load = (p) => import('file:///' + path.join(OUT, p).replace(/\\/g, '/'));
const S = await load('core/solver.js');
const { T } = await load('core/tuning.js');
const { MoveWatch, SOUNDS_LIKE } = await load('engine/moves.js');

const DT = 1 / 120;
const HALF = T.character.height / 2;

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
  ray: (from, dir, maxDist) => (dir.y > -0.5 ? null : (from.y <= maxDist ? from.y : null)),
  rayHit: () => null,
};

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

const btn = () => ({ pressed: false, held: false });
const press = { pressed: true, held: true };
const intent = (over = {}) => ({
  moveX: 0, moveY: 0, yaw: 0, pitch: 0,
  jump: btn(), dash: btn(), slide: btn(), slam: btn(), thrust: btn(), grapple: btn(),
  vault: btn(),
  wing: btn(), super: btn(), ...over,
});

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok  ' : '  FAIL'}  ${msg}`); if (!ok) fails++; };
const note = (msg) => console.log(`        ${msg}`);
/** Held beds. Silent by default for some kits, so not worth reporting as muted. */
const LOOPS = new Set(['thruster', 'wingsuit', 'reel']);

/**
 * Step and report the verbs that fired. The watch diffs against its own previous
 * snapshot, so it is fed every frame — exactly how main.ts drives it.
 */
function run(p, col, frames, over = () => ({})) {
  const watch = new MoveWatch();
  watch.step(p, false);          // prime; the first frame has nothing to diff
  const seen = [];
  let arrival = 0;
  for (let k = 0; k < frames; k++) {
    S.step(p, intent(over(k)), col, DT);
    const f = watch.step(p, false);
    seen.push(...f.fired);
    arrival = Math.max(arrival, f.landSpeed);
  }
  seen.arrival = arrival;
  return seen;
}

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

// ---------------------------------------------------------------------------
console.log('\nthe floor pair — the sounds the wall is being asked to match');
{
  const g = grounded();
  const up = run(g, FLOOR, 4, (k) => (k === 0 ? { jump: press } : {}));
  check(up.includes('jump'), 'pushing off the ground fires `jump`');

  const d = airborne(6);
  const down = run(d, FLOOR, 240);
  check(down.includes('land'), 'and coming back down fires `land`');
}

// ---------------------------------------------------------------------------
console.log('\nthe wall fires its own pair, one verb per event');
{
  // Attach by running past it. Catching a wall is entering `wallrunning`, which
  // is the event the touch-down clip hangs off.
  const w = airborne(400, -12);
  const on = run(w, WALL, 1);
  check(w.state === 'wallrunning', 'setup: on a wall');
  check(on.includes('wallRun'), 'catching a wall fires `wallRun` — the touch down');
  check(on.filter((m) => m === 'wallRun').length === 1,
    'once, on the catch, not once a frame while you hold it');

  const held = run(w, WALL, 24);
  check(!held.includes('wallRun'),
    'and the run along it stays silent — the catch is the event, not the ride');

  const off = run(w, WALL, 2, (k) => (k === 0 ? { jump: press } : {}));
  check(off.includes('wallJump'), 'kicking off it fires `wallJump` — the push off');
  check(!off.includes('jump') && !off.includes('doubleJump'),
    'and it is that verb alone: a wall kick is not a ground jump or an air jump');
}

// ---------------------------------------------------------------------------
// The kick spends gas, not a jump charge, so it is read off the wall it left
// rather than off the charge counter. That reading has to survive the OTHER way
// a wall ends, and has to still work once the wall is already behind you.
console.log('\nand the kick is told apart from just running out of wall');
{
  const w = airborne(400, -12);
  run(w, WALL, 1);
  check(w.state === 'wallrunning', 'setup: on a wall');
  // Hold it, touching nothing, until the timer ends it on its own.
  const rode = run(w, WALL, Math.ceil(T.wall.maxTime / DT) + 30);
  check(w.state !== 'wallrunning', 'setup: the run timed out and dropped us');
  check(!rode.includes('wallJump'),
    'sliding off the end of a wall is silent — you did not push off anything');

  // The coyote kick: the wall goes away, then the press lands inside the grace
  // window. Same verb, fired from airborne with the wall already gone.
  const c = airborne(400, -12);
  run(c, WALL, 1);
  check(c.state === 'wallrunning', 'setup: on a wall again');
  const late = run(c, VOID, 6, (k) => (k === 3 ? { jump: press } : {}));
  check(late.includes('wallJump'),
    'but a press just after the wall ran out is still a wall jump, and still sounds like one');
}

// ---------------------------------------------------------------------------
// A wall catch reports an arrival speed like a floor landing does, so the two
// go through the same impact scaling instead of the wall being pinned soft.
console.log('\nand it reports how hard you hit the wall, the way a floor does');
{
  // Angled in at the wall, so there is a real closing component to measure.
  const slow = airborne(400, -9);
  slow.vel.x = 4;
  const slowHit = run(slow, WALL, 1);
  const fast = airborne(400, -30);
  fast.vel.x = 13;
  const fastHit = run(fast, WALL, 1);
  check(slow.state === 'wallrunning' && fast.state === 'wallrunning', 'setup: both caught');
  note(`closing at 4 m/s -> ${slowHit.arrival.toFixed(1)}   at 13 m/s -> ${fastHit.arrival.toFixed(1)}`);
  check(slowHit.arrival > 0, 'a wall catch reports an arrival speed, not a flat 0');
  check(fastHit.arrival > slowHit.arrival,
    'and hitting one harder reports more of it, so the clip scales like a landing');
}

// ---------------------------------------------------------------------------
// The wall has no sound knobs of its own; it plays the floor's. That is not a
// tidiness point - the knobs are what broke it. `soundAssign.wallRun` defaulted
// to '' and a saved profile went on pinning that after the default was fixed,
// so the wall stayed silent with everything apparently mapped correctly.
console.log('\nand the wall owns no sound settings that could drift from the floor');
{
  const a = T.soundAssign;
  check(!('wallRun' in a) && !('wallJump' in a),
    'the wall has no clip of its own to leave empty');
  check(!('wallRun' in T.soundLevel) && !('wallJump' in T.soundLevel),
    'and no level of its own to leave at zero');
  check(SOUNDS_LIKE.wallRun === 'land' && SOUNDS_LIKE.wallJump === 'jump',
    'it routes to the floor instead: catch -> land, kick -> jump');
  note(`catch -> ${a.land}.wav   kick -> ${a.jump}.wav`);
}

// ---------------------------------------------------------------------------
// The dash take was cut the same way the jump take was: one recording holding a
// transient and, most of a second later, a swell. They are the two dashes, so
// they have to come out of the two different presses.
console.log('\nand the two dashes are two different clips, not one clip twice');
{
  const a = T.soundAssign;
  const g = grounded();
  const ord = run(g, FLOOR, 4, (k) => (k === 0 ? { dash: press } : {}));
  check(ord.includes('dash') && !ord.includes('superDash'),
    'the ordinary dash fires `dash`');

  const h = grounded();
  const sup = run(h, FLOOR, 4, (k) => (k === 0 ? { super: press } : {}));
  check(sup.includes('superDash') && !sup.includes('dash'),
    'and the super fires `superDash` — the solver already told them apart');

  check(!!a.dash && !!a.superDash, 'both have a clip');
  check(a.dash !== a.superDash,
    'and they are DIFFERENT clips — sharing one is what the cut was for');
  note(`super -> ${a.superDash}.wav (the hit)   dash -> ${a.dash}.wav (the swell)`);
}

// ---------------------------------------------------------------------------
// The game does not run these defaults. It runs them under a saved profile, and
// a profile can mute anything it likes - which is what actually happened. So the
// check that matters is against the merged result, not against tuning.ts.
console.log('\nand it still makes a sound under the profile the game actually loads');
for (const file of fs.readdirSync('src/profiles').filter((f) => f.endsWith('.json'))) {
  const prof = JSON.parse(fs.readFileSync(path.join('src/profiles', file), 'utf8'));
  const clip = { ...T.soundAssign, ...(prof.soundAssign ?? {}) };
  const level = { ...T.soundLevel, ...(prof.soundLevel ?? {}) };
  const flow = { ...T.soundFlow, ...(prof.soundFlow ?? {}) };
  for (const [verb, slot] of [['landing', 'land'], ['jumping', 'jump']]) {
    const audible = !!clip[slot] && level[slot] > 0 && flow.master > 0 && flow.oneShot > 0;
    check(audible, `${file}: ${verb} — and so catching and kicking a wall — makes a sound`);
    if (!clip[slot]) note(`  ${file} pins soundAssign.${slot} to "" — that is silence`);
    else if (!(level[slot] > 0)) note(`  ${file} pins soundLevel.${slot} to ${level[slot]}`);
  }

  // Not a failure - a profile is allowed to mute whatever it likes, and these
  // are somebody's deliberate choices. But "why can I not hear X" has cost two
  // rounds of looking in the wrong place already, so the answer gets printed
  // rather than hunted for.
  const quiet = Object.keys({ ...clip, ...level })
    .filter((k) => !LOOPS.has(k) && (!clip[k] || !(level[k] > 0)))
    .sort();
  if (quiet.length) note(`  ${file} also silences: ${quiet.join(', ')}`);
  const moved = Object.keys(prof.soundAssign ?? {})
    .filter((k) => prof.soundAssign[k] && prof.soundAssign[k] !== T.soundAssign[k]);
  for (const k of moved) note(`  ${file} plays ${k} as ${prof.soundAssign[k]}.wav, not ${T.soundAssign[k]}.wav`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall good');
process.exit(fails ? 1 : 0);
