import * as THREE from 'three';
import { T } from './core/tuning';
import * as V from './core/vec';
import { makePlayer, step } from './core/solver';
import { initPhysics, RapierWorld } from './engine/physics';
import { Input } from './engine/input';
import { Renderer } from './engine/render';
import { Panel } from './tools/panel';
import { Hud } from './tools/hud';
import { brushes, triggers, spawn, killY } from './levels';

const FIXED = 1 / 120;
const MAX_STEPS = 8;

await initPhysics();

const canvas = document.getElementById('view') as HTMLCanvasElement;
const world = new RapierWorld(brushes, spawn);
const input = new Input(canvas);
const gfx = new Renderer(canvas);
const hud = new Hud();
const panel = new Panel(() => world.syncTuning());

let player = makePlayer(spawn);

// ---------------------------------------------------------------- run timer + ghost

interface Run { active: boolean; time: number; splits: string[]; hit: Set<string>; path: V.V3[] }
let run: Run = newRun();
let best: number | null = null;
let bestPath: V.V3[] | null = null;

function newRun(): Run {
  return { active: false, time: 0, splits: [], hit: new Set(), path: [] };
}

const ghost = new THREE.Mesh(
  new THREE.CapsuleGeometry(T.character.radius, T.character.height - 2 * T.character.radius),
  new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.28 }),
);
ghost.visible = false;
gfx.scene.add(ghost);

function restart() {
  player = makePlayer(spawn);
  input.intent.yaw = 0;
  input.intent.pitch = 0;
  run = newRun();
  ghost.visible = bestPath !== null;
}

function checkTriggers() {
  for (const t of triggers) {
    if (run.hit.has(t.name)) continue;
    const d = Math.hypot(player.pos.x - t.p[0], player.pos.y - t.p[1], player.pos.z - t.p[2]);
    if (d > t.r) continue;
    run.hit.add(t.name);
    run.splits.push(`${t.name.padEnd(10)} ${run.time.toFixed(2)}s`);
    if (t.kind === 'goal') finish();
  }
}

function finish() {
  run.active = false;
  if (best === null || run.time < best) {
    best = run.time;
    bestPath = run.path.slice();
  }
}

// ---------------------------------------------------------------- camera drift

/**
 * Keeps the camera behind the character so you can parkour without steering it.
 * It targets the character's FACING (which itself chases the movement direction),
 * so the framing is literally "looking at their back".
 *
 * The gating is the subtle part. Movement is camera-relative, so rotating the yaw
 * while the player holds a direction changes what that direction means — auto-follow
 * during a pure strafe would silently curve them into a spiral. It is therefore
 * allowed only when there is no feedback loop to create:
 *
 *   - no movement input at all (post-ejection flight, falling) — nothing to curve
 *   - forward-ish input, where turning the camera just keeps "forward" pointing
 *     where they are already going
 *   - wallrunning or dashing, where the state drives motion and input is ignored
 *
 * Pure strafe is deliberately excluded — that is also the bunnyhop stance, which
 * depends on the player steering the mouse themselves.
 */
function autoFollowCamera(dt: number) {
  // Never in first person: there the camera IS your aim, so moving it for you is
  // both disorienting and a fight for control.
  if (T.camera.firstPerson) return;
  if (T.camera.autoFollow <= 0) return;
  if (input.mouseIdle < T.camera.followDelay) return;
  if (V.lenH(player.vel) < T.camera.followMinSpeed) return;

  const mx = input.intent.moveX, my = input.intent.moveY;
  const noInput = Math.abs(mx) < 0.1 && Math.abs(my) < 0.1;
  const forwardish = my > 0.1 && Math.abs(mx) <= my + 0.35;
  const stateDriven = player.state === 'wallrunning' || player.state === 'dashing';
  if (!noInput && !forwardish && !stateDriven) return;

  // Character forward is (sin facing, cos facing); camera forward is
  // (-sin yaw, -cos yaw). Equating them gives yaw = facing + PI.
  const targetYaw = player.facing + Math.PI;
  const k = 1 - Math.exp(-T.camera.autoFollow * dt);
  input.intent.yaw += V.shortestAngle(input.intent.yaw, targetYaw) * k;
  input.intent.pitch += (T.camera.pitchRest - input.intent.pitch)
    * (1 - Math.exp(-T.camera.pitchFollow * dt));
}

// ---------------------------------------------------------------- loop

let last = performance.now();
let acc = 0;

function frame(now: number) {
  const raw = Math.min((now - last) / 1000, 0.25);
  last = now;
  input.sample(raw);

  if (input.restart) { input.restart = false; restart(); }
  if (input.toggleView) {
    input.toggleView = false;
    T.camera.firstPerson = !T.camera.firstPerson;
    panel.noteOverride('camera/firstPerson', T.camera.firstPerson);
    if (!T.camera.firstPerson) gfx.resetCamera(player, input.intent.yaw);
    // Third person clamps pitch tighter, so carry the view back into range.
    input.intent.pitch = V.clamp(
      input.intent.pitch,
      T.camera.firstPerson ? T.camera.pitchMinFP : T.camera.pitchMin,
      T.camera.firstPerson ? T.camera.pitchMaxFP : T.camera.pitchMax,
    );
  }

  acc += raw * T.world.timeScale;
  let steps = 0;
  while (acc >= FIXED && steps < MAX_STEPS) {
    // The run clock starts the moment the player actually asks to move.
    if (!run.active && run.splits.length === 0 && best !== run.time) {
      const moving = input.intent.moveX || input.intent.moveY
        || input.intent.jump.pressed || input.intent.dash.pressed;
      if (moving) run.active = true;
    }

    step(player, input.intent, world, FIXED);
    input.consumeEdges();

    if (run.active) {
      run.time += FIXED;
      run.path.push(V.copy(player.pos));
      checkTriggers();
    }

    if (player.pos.y < killY) { restart(); break; }

    acc -= FIXED;
    steps++;
  }
  if (steps === MAX_STEPS) acc = 0; // don't let a stall snowball

  autoFollowCamera(raw);
  gfx.update(player, input.intent, raw, world);

  if (bestPath) {
    const i = Math.min(bestPath.length - 1, Math.floor(run.time / FIXED));
    const g = bestPath[i];
    ghost.position.set(g.x, g.y, g.z);
    ghost.visible = true;
  }

  hud.update(player, { run: run.time, splits: run.splits, best }, panel.abLabel, input.lookMode,
    T.camera.firstPerson ? 'first person' : 'third person');
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Debug handle: lets tests and the console drive the sim without a human at the keys.
(globalThis as any).__game = {
  T,
  get player() { return player; },
  get run() { return run; },
  world,
  input,
  gfx,
  restart,
  autoFollowCamera,
  /** Teleport for tests — drops the player at a spot with zero velocity. */
  place(x: number, y: number, z: number) {
    player = makePlayer({ x, y, z });
    return player;
  },
  /** Run N fixed ticks with a synthetic intent. Returns the resulting player. */
  sim(ticks: number, intent: Partial<typeof input.intent> = {}) {
    Object.assign(input.intent, intent);
    for (let k = 0; k < ticks; k++) {
      step(player, input.intent, world, FIXED);
      input.consumeEdges();
    }
    return player;
  },
};

// Vite HMR: keep the tune, drop the stale module.
if (import.meta.hot) import.meta.hot.accept(() => location.reload());
