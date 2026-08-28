import * as THREE from 'three';
import { T } from './core/tuning';
import * as V from './core/vec';
import { makePlayer, step } from './core/solver';
import { initPhysics, RapierWorld } from './engine/physics';
import { Input } from './engine/input';
import { Renderer } from './engine/render';
import { Panel } from './tools/panel';
import { Hud } from './tools/hud';
import { Editor } from './tools/editor';
import { Pause } from './tools/pause';
import { Wheel } from './tools/wheel';
import { updates } from './tools/updates';
import { Carriers } from './engine/carriers';
import { Enemies, ROBOTS } from './engine/enemies';
import { preloadModels } from './engine/models';
import { preloadSurfaces } from './engine/surfaces';
import { Weapon } from './engine/weapon';
import { Projectiles } from './engine/projectiles';
import { Sword } from './engine/sword';
import { Hook } from './engine/hook';
import { Audio } from './engine/audio';
import { Rings } from './tools/rings';
import { level, LEVEL_MODELS } from './levels';

const FIXED = 1 / 120;
const MAX_STEPS = 8;

await initPhysics();
// Models before anything builds a scene, so the world is never briefly made of
// placeholder boxes that then pop. Everything else loads on demand.
// Surfaces alongside them, for the same reason: the first frame should be of
// a finished world, not of one that dresses itself while you watch.
await Promise.all([preloadModels([...ROBOTS, ...LEVEL_MODELS]), preloadSurfaces()]);

const canvas = document.getElementById('view') as HTMLCanvasElement;
const world = new RapierWorld(level.brushes, level.spawn);
const input = new Input(canvas);
const gfx = new Renderer(canvas);
const hud = new Hud();
const panel = new Panel(() => world.syncTuning());

let player = makePlayer(level.spawn);
const enemies = new Enemies(gfx.scene);
const carriers = new Carriers(gfx.scene);
carriers.rebuild(level.rails);
const rings = new Rings();
let hitsTaken = 0;
let laps = 0;
const projectiles = new Projectiles(gfx, enemies, {
  onEnemyHit: (r) => weapon.markerFor(r),
  onPlayerHit: () => { hitsTaken++; rings.flash(); },
});
const weapon = new Weapon(input, gfx, enemies, projectiles);
const pause = new Pause();
const wheel = new Wheel(input, weapon);
const sword = new Sword(input, gfx, enemies, projectiles, (r) => weapon.markerFor(r));
const hook = new Hook(input, gfx, enemies, world, (r) => weapon.markerFor(r));
// Movement audio. Arms itself on the first click or key — browsers hold the
// speaker until a gesture, and the pointer-lock click is always one.
const audio = new Audio();

const editor = new Editor(gfx, world, enemies, {
  playerPos: () => player.pos,
  // Exit / level switch invalidates the run, the ghost and the player's spot.
  onWorldChanged: () => {
    best = null;
    bestPath = null;
    acc = 0;
    // The editor flies on WASD. Without this the keys you were holding when you
    // hit play are still held by the character, who runs off on their own.
    input.releaseAll();
    restart();
  },
});

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
  player = makePlayer(level.spawn);
  input.intent.yaw = level.spawnYaw ?? 0;
  input.intent.pitch = 0;
  run = newRun();
  laps = 0;
  hitsTaken = 0;
  enemies.rebuild();
  carriers.rebuild(level.rails);
  projectiles.clear();
  sword.clear();
  hook.clear();
  // Otherwise a respawn mid-hover leaves the jets running, and the fresh player
  // never re-enters the state that would turn them off.
  audio.stopAll();
  ghost.visible = bestPath !== null;
}

function checkTriggers() {
  // The goal only counts after every checkpoint — a lap means a full lap, and
  // spawning on top of the finish line can't instantly complete one.
  const need = level.triggers.filter((t) => t.kind === 'checkpoint').length;
  for (const t of level.triggers) {
    if (run.hit.has(t.name)) continue;
    if (t.kind === 'goal' && run.hit.size < need) continue;
    const d = Math.hypot(player.pos.x - t.p[0], player.pos.y - t.p[1], player.pos.z - t.p[2]);
    if (d > t.r) continue;
    run.hit.add(t.name);
    run.splits.push(`${t.name.padEnd(10)} ${run.time.toFixed(2)}s`);
    if (t.kind === 'goal') finish();
  }
}

function finish() {
  if (best === null || run.time < best) {
    best = run.time;
    bestPath = run.path.slice();
  }
  // Lap loop: the course re-arms immediately — fresh (re-jittered) enemies, a
  // clean set of splits, and the next lap's clock starts as you keep moving.
  laps++;
  run = newRun();
  enemies.rebuild();
  carriers.rebuild(level.rails);
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

  // Editor mode: the sim is frozen, the editor owns the camera, we only draw.
  if (editor.active) {
    editor.update();
    sword.setHidden(true);
    gfx.draw();
    acc = 0;
    requestAnimationFrame(frame);
    return;
  }

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

  // Before the fixed steps: a grapple press aimed at a dummy is a haul, not an
  // attach, and that decision has to be made on the same click the solver would
  // otherwise consume.
  // Captured before hook.preStep, which CONSUMES the press when it lands on a
  // dummy — and before the fixed steps, which consume it in every other case.
  // Audio needs it because a hook that hits nothing writes no player state.
  const firedHook = input.intent.grapple.pressed;

  hook.preStep(player);

  // --- the clock. Three independent factors multiplied, never assigned: the
  // wheel writing world.timeScale would hand back a different tune than it
  // found, and the panel's slider has to keep meaning what it says.
  if (input.pausePressed) { input.pausePressed = false; pause.toggle(editor.active); }
  // Real time on purpose — a menu that slowed down with the world it is slowing
  // would take five times as long to open.
  wheel.update(raw, pause.active || editor.active);

  const scale = T.world.timeScale * wheel.timeScale;
  const dt = pause.active ? 0 : raw * scale;

  // Pause skips the simulation outright rather than stepping it with dt 0.
  // Systems that consume an input edge do it unconditionally — the weapon
  // clears shootPressed whether or not time passed — so a zero-length frame
  // still fires a shot into a frozen world.
  if (pause.active) {
    // Frozen is the one moment a reload costs nothing, so a build waiting on
    // disk takes it here rather than mid-run.
    updates.applyWhenIdle(true);
    audio.update(player, true);
    gfx.update(player, input.intent, 0, world);
    gfx.draw();
    hud.update(player, { run: run.time, splits: run.splits, best }, panel.abLabel, input.lookMode,
      T.camera.firstPerson ? 'first person' : 'third person',
      `PAUSED   ${weapon.hudLine()}`);
    requestAnimationFrame(frame);
    return;
  }

  // Robots become obstacles here, from last frame's positions. They barely move
  // -- only the meathook hauls them -- so a frame of lag is invisible, and doing
  // it before the fixed steps means the solver sees a world that is consistent
  // for the whole tick rather than shifting under it.
  world.syncEnemies(enemies.alivePositions());

  // The conveyor, before the fixed steps and for the same reason as the robots:
  // the solver should see a world that is consistent for the whole tick rather
  // than one shifting under it. The carry comes straight after, so a rider is
  // moved WITH the cargo and then gets to move themselves, which is the order
  // that makes running along a moving box feel like running along a floor.
  carriers.update(dt);
  carriers.carry(player);
  world.syncCarriers(carriers.bodies());

  acc += dt;
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

    if (player.pos.y < level.killY) { restart(); break; }

    acc -= FIXED;
    steps++;
  }
  if (steps === MAX_STEPS) acc = 0; // don't let a stall snowball

  // All of these run on the SCALED clock. Slowing only the solver would leave
  // bullets, animations and cooldowns running at full speed through a slowed
  // world, which is not slow motion — it is the player being slowed down.
  autoFollowCamera(dt);

  // The camera is placed FIRST, before anything that reads it. The grapple
  // builds its cable origins from the camera in first person and hangs the
  // ropes in world space, so with the old ordering — camera last — each cable
  // anchored to the previous frame's view and visibly tore away from your hips
  // at speed, reading as several hooks at once. Weapon fire spawns off the
  // camera too, with the same one-frame staleness. Placing the camera up front
  // fixes both and every future case of it.
  //
  // The one thing this costs: `gfx.adsT`, which the weapon writes below, is a
  // frame old when the FOV is computed. It is a damped 0..1 scalar, so a frame
  // of lag on it is not a thing anyone can see.
  gfx.update(player, input.intent, dt, world);

  weapon.update(dt);
  sword.update(dt, player);
  hook.update(dt, player);
  // After the solver has stepped and before the draw: audio derives its events
  // by diffing the player against last frame, so it has to see the settled state.
  audio.update(player, false, firedHook);
  enemies.update(dt, player.pos, projectiles, gfx.wallMeshes);
  projectiles.update(dt, player.pos);
  rings.update(dt, {
    gas: player.gas / T.gas.max,
    thrusting: player.thrusting,
    boosting: player.boosting,
    charges: sword.charges,
    maxCharges: T.sword.combo,
    cooldown: sword.cooldownFrac,
    getsuga: sword.waveFrac,
  });

  if (bestPath) {
    const i = Math.min(bestPath.length - 1, Math.floor(run.time / FIXED));
    const g = bestPath[i];
    ghost.position.set(g.x, g.y, g.z);
    ghost.visible = true;
  }

  // Everything has been placed; draw it.
  gfx.draw();

  hud.update(player, { run: run.time, splits: run.splits, best }, panel.abLabel, input.lookMode,
    T.camera.firstPerson ? 'first person' : 'third person',
    `${weapon.hudLine()}   lap ${laps} · hits ${hitsTaken}${hook.hauling ? ' · HAULING' : ''}`);
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
  panel,
  audio,
  editor,
  level,
  enemies,
  carriers,
  weapon,
  sword,
  hook,
  projectiles,
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
// A new build does NOT interrupt a run. See tools/updates.ts — the page holds
// its snapshot and reloads when the game is paused, or when you click the badge.
if (import.meta.hot) import.meta.hot.accept(() => updates.arrived());
