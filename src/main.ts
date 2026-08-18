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
  gfx.clearTrail();
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
 * Devil-May-Cry style: you own the camera with the mouse, but the moment you stop
 * steering it, it eases back behind your direction of travel so you're never
 * fighting it while running. Gated on roughly-forward input — auto-rotating the
 * yaw while the player is strafing would silently curve their movement, since
 * movement is camera-relative.
 */
function autoFollowCamera(dt: number) {
  if (T.camera.autoFollow <= 0) return;
  if (input.mouseIdle < T.camera.followDelay) return;
  const speed = V.lenH(player.vel);
  if (speed < T.camera.followMinSpeed) return;
  if (input.intent.moveY <= 0.5 || Math.abs(input.intent.moveX) > 0.5) return;

  const targetYaw = Math.atan2(-player.vel.x, -player.vel.z);
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

  gfx.pushTrail(player.pos);
  autoFollowCamera(raw);
  gfx.update(player, input.intent, raw, world);

  if (bestPath) {
    const i = Math.min(bestPath.length - 1, Math.floor(run.time / FIXED));
    const g = bestPath[i];
    ghost.position.set(g.x, g.y, g.z);
    ghost.visible = true;
  }

  hud.update(player, { run: run.time, splits: run.splits, best }, panel.abLabel);
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
