# Movement Prototype — Design Doc

Living document. Decisions get recorded here as we settle them. Status legend:
**[PROPOSED]** = my recommendation, awaiting your call. **[DECIDED]** = locked. **[OPEN]** = unanswered.

---

## 0. Goal

A **third-person** movement sandbox with Ghostrunner-grade feel: dash, double jump, slide, coyote
time, input buffering, and the cancel/chain interactions between them. Hack-and-slash combat comes
later and is built *around* the movement — so the movement system is designed from day one to be
interrupted, cancelled, and re-entered by combat states.

The primary deliverable is **not** a game. It is a **tuning rig**: the movement numbers must be
editable while the game is running, saveable as named profiles, and diffable in version control.
Feel is found by iteration, so the iteration loop *is* the product.

---

## 1. Stack

### [DECIDED] TypeScript + Three.js + Rapier3D + Vite + Tweakpane

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript | Types on the tuning schema; no compile wait |
| Render | Three.js | Mature; grey-box geometry is trivial |
| Physics/collision | Rapier3D (Rust→WASM) | Ships a kinematic character controller: collide-and-slide, slope limits, snap-to-ground, autostep. This is the wheel I refuse to reinvent |
| Dev loop | Vite HMR | Edit a number, browser updates in <100ms — no restart, no lost state |
| Tuning UI | Tweakpane | Sliders/graphs/folders generated from a schema; preset import/export built in |

**Why not the alternatives:**

- **Bevy (Rust)** — no built-in character controller (you bolt on avian/rapier anyway), and a
  10–30s recompile sits in the middle of every tuning iteration. Feel is found by making a
  hundred small changes; a 20s tax on each one is the wrong trade for this specific project.
- **Godot 4** — genuinely good for this (`CharacterBody3D` is purpose-built, the inspector edits
  live). Two problems: it isn't installed, and **I can't see the running game**. Every iteration
  would need you as my eyes and hands.
- **Python (Ursina/Panda3D)** — collision quality isn't good enough for precision movement.

**The deciding factor:** with a browser target I can drive the prototype myself — screenshot it,
read its console, script inputs, verify a dash actually travels 8 units — before handing it to
you. That closes the loop without spending your time as my test harness.

### Honest downside

Browser input carries a few ms more latency than native, and there's no raw mouse access beyond
Pointer Lock. For *finding the numbers*, irrelevant. For a shipping twitch game, not irrelevant.
Mitigation is architectural (§2): the movement solver is engine-agnostic, so a later port to
Godot or Bevy carries over as logic plus a JSON of tuned numbers, not a rewrite.

---

## 2. Architecture

Two rules drive the whole layout.

**Rule 1 — the movement solver knows nothing about Three.js or Rapier.**
It is effectively a pure function: `(state, input, tuning, collisionQueries, dt) -> newState`.
Collision is reached only through a narrow interface (`raycast`, `shapeCast`, `overlap`). This
keeps it headlessly testable and portable to another engine later.

**Rule 2 — no magic numbers in code, ever.**
Every constant lives in the tuning schema. If I write `0.15` inline, that's a bug.

```
src/
  core/           # engine-agnostic — the actual game feel lives here
    solver.ts       # fixed-step movement integration
    states/         # grounded, airborne, dashing, sliding, wallrunning...
    timers.ts       # coyote, input buffer, cooldowns, grace windows
    tuning.ts       # THE schema: every param + range + default + doc string
  engine/         # the swappable half
    rapier.ts       # implements the collision interface
    render.ts       # three.js scene, camera, interpolation
    input.ts        # keyboard/mouse/gamepad -> intent struct
  tools/
    panel.ts        # Tweakpane, generated from tuning.ts
    hud.ts          # live state readout + speed graph
    recorder.ts     # input recording / deterministic replay
  levels/         # grey-box courses as data (JSON), not hand-placed meshes
profiles/         # saved tuning presets, checked into git, human-diffable
```

### Third-person camera

Movement is **camera-relative**: WASD maps to the camera basis, not the character's facing.
Character facing is decoupled and rotates toward the movement direction at a tunable rate — that
decoupling is most of what makes a third-person character read as *ninja* rather than *tank*.

- Spring arm with collision: the camera pulls in when geometry intrudes, with tunable pull-in
  speed and minimum distance.
- Tunables: distance, height, shoulder offset, follow lag (positional and rotational separately),
  pitch limits, base FOV plus per-state FOV kick (dash / slide / overspeed), roll on slide, shake.
- **Overspeed feedback runs through the camera** — FOV widens and the arm extends as you exceed
  base cap. In third person this is the primary channel for communicating speed, and it carries
  more weight here than the equivalent would in first person.
- Lock-on isn't built yet, but the camera exposes a `target` slot so combat can drive it later.

### Built for combat, before combat exists

Hack-and-slash lands on top of this later, so v1 avoids the two decisions that would block it:

1. **Attack states are just states in the same FSM.** Movement states declare which combat states
   may interrupt them and on what frames — so "dash-cancel into attack" and "attack-cancel into
   dash" become data, not new code.
2. **A global timescale/hitstop hook sits in the fixed-step loop from the start.** Retrofitting
   hitstop into a movement system that assumed a constant dt is miserable; adding the hook now is
   nearly free.

No combat verbs get implemented now.

### Fixed timestep

Physics runs at a fixed **120 Hz** with an accumulator; rendering interpolates between ticks.
Non-negotiable here — it makes tuned numbers framerate-independent and makes replays
deterministic, which is what lets us A/B two profiles honestly.

### State machine, not if-chains

Each movement state is a module with `enter/update/exit` and an explicit list of legal
transitions. Ghostrunner's feel lives mostly in the *transitions* — dash-cancelling a slide,
jumping out of a slide while keeping speed, a dash restoring your double jump. A flat pile of
booleans can't express those cleanly and will rot within a week.

### Tuning rig specifics

- Live sliders for every param, grouped by system, with sane min/max.
- Named profiles saved to `profiles/*.json` — checked in, so "the tune that felt right on
  Tuesday" is recoverable, and I can read it.
- Hotkey A/B toggle between two loaded profiles mid-run.
- Debug HUD: current state, horizontal/vertical speed, grounded flag, every live timer, dash
  charges, plus a scrolling speed graph. Numbers you can see are numbers you can tune.
- Input recorder: record a run, replay it against a different profile. Same inputs, two tunes,
  honest comparison.
- Trajectory trace: draw the last N seconds of the player path in the world.

---

## 3. Feature scope

### v1 — the core (what I build first)

- Ground move: accel / friction / max speed, each separately tunable
- Air move: independent air accel + air control coefficient
- Jump: variable height (release-to-cut), tunable gravity with separate rise/fall multipliers
- Double jump (charge count is a parameter, so it generalizes to N)
- Dash: ground + air, directional from input, charges + cooldown + refill rules
- Slide: enter from run, slope acceleration, momentum preservation on exit
- Coyote time (jump and dash, separately tunable)
- Input buffering (per-action window lengths)
- The interactions: jump-out-of-slide, dash-into-slide, slide-cancel-into-jump, dash refunding
  the double jump
- Third-person orbit camera: spring arm, collision pull-in, FOV kick, slide roll
- Character facing decoupled from camera, tunable turn rate
- Grey-box test course, run timer with splits, ghost replay of your best
- **Instant restart** on a hotkey — the Neon White loop. Cheap to build, enormous for tuning

### Later (the system is built to accept these)

Wallrun, wall jump, grapple/hook, mantle + ledge grab, bunny-hop momentum retention, air-strafe
accel, slide-under geometry, dash-through targets, time dilation.

### Explicitly out of scope for now

Combat, enemies, art, audio, menus, save systems.

---

## 4. Settled answers — 2026-08-18

| # | Question | Answer |
|---|---|---|
| Q1 | Camera | **Third person.** Hack-and-slash to be built on top later |
| Q2 | Browser permanent? | **Prototype only.** Find the numbers here, port to native. `core/` stays strictly portable, no web polish |
| Q3 | Momentum | **Soft cap (B).** Proper tech should let players move like crazy — but not full Quake, and not across huge distances |
| Q4 | Gamepad | Keyboard + mouse only for now |
| Q5 | Timed course | **Yes** — splits + ghost replay |
| Q6 | References | **Ghostrunner + Neon White.** Titanfall's feel is admired but its scale is not: ninja/parkour, not bunny-hop-a-billion-metres |

### What Q3 + Q6 mean concretely

The target is **flow, not distance**. Speed is expressed through quick direction changes,
verticality, and clean state transitions — not long straight-line acceleration. That pushes
specific defaults:

- **Overspeed decays fast** (target ~0.6–1.0s back to base cap). You earn speed with a good
  chain and lose it if you stop chaining. Contrast with Quake, where speed persists indefinitely.
- **Levels stay compact and vertical.** Arena-scale, not open-world. Routes read in a few seconds.
- **Direction changes are cheap, straight lines aren't.** Dash and slide are the speed sources;
  holding W is not. This is what separates ninja-parkour from bunny-hopping.
- **Transitions carry the reward.** Chaining slide→dash→jump preserves more momentum than any
  single move produces on its own. The combo *is* the mechanic.
- **Instant restart** is core, not a nicety — Neon White's tight retry loop is how route
  optimisation becomes fun, and it also happens to be the best tuning tool we could ask for.

Because combat comes later and is built around movement, the eventual measure of a good movement
system here is *how well it sets up a fight* — approach, reposition, disengage. Noted now so it
informs defaults; nothing to implement yet.

---

## 5. Open / deferred

- **Lock-on** — camera exposes a `target` slot; behaviour undecided until combat exists
- **Combat verbs** — attack set, cancel windows, hitstop values
- **Dash as resource** — Ghostrunner uses a cooldown; Neon White uses consumable charges. Built
  as charges + cooldown + refill rules so either is reachable by tuning
- **Wallrun / wall jump** — highest-priority post-v1 addition, very likely needed for "ninja"
- **Level format** — grey-box JSON for now; a real editor only if hand-authoring gets painful

---

## 6. Decision log

| Date | Decision | Status |
|---|---|---|
| 2026-08-18 | Stack: TS + Three.js + Rapier3D + Vite + Tweakpane | DECIDED |
| 2026-08-18 | Engine-agnostic `core/`, narrow collision interface | DECIDED |
| 2026-08-18 | Fixed 120 Hz timestep w/ render interpolation | DECIDED |
| 2026-08-18 | State machine for movement states | DECIDED |
| 2026-08-18 | All constants in a tuning schema; profiles as checked-in JSON | DECIDED |
| 2026-08-18 | Third-person, camera-relative movement, decoupled facing | DECIDED |
| 2026-08-18 | Soft-cap momentum, fast overspeed decay, compact vertical levels | DECIDED |
| 2026-08-18 | Browser is a prototype host only; native port later | DECIDED |
| 2026-08-18 | Timescale/hitstop hook + FSM combat-interrupt slots reserved in v1 | DECIDED |
