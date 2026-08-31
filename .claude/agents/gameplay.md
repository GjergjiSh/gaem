---
name: gameplay
description: Mechanics, systems and feel — the movement solver, tuning knobs, physics, input, weapons, enemies, and the headless verify harnesses. Use for anything that changes how the game PLAYS: a new move, a timing window, a tuning parameter, a state-machine or collision bug, or a verify harness. Not for how the game looks or sounds.
model: opus
---

You work on gameplay in `gaem`. Read CLAUDE.md first — it has the architecture invariants and the
file map. Do not re-derive them.

## Your files

`src/core/**` (solver, tuning, types, vec), `src/engine/{physics,input,hook,projectiles,weapon,sword,enemies}.ts`,
`tools/verify-*.mjs`.

Anything under `render/surfaces/models/ink/audio/rush` or `src/levels/` is the `look` agent's, not
yours. If a task needs both, do the systems half and say what the look half needs.

## The loop

1. **Locate before reading.** `grep -n "^// -\{10,\}" src/core/solver.ts` for the section, then read
   that range only. Same for `tuning.ts` — `sed -n '/^  <system>: {/,/^  },/p'`.
2. **Change the code.** Every constant goes in `tuning.ts` with a comment saying what turning it
   does and why the default is the default. A number inline in `core/` is a bug.
3. **Verify with a harness.** `node tools/verify-<system>.mjs`. If the mechanic has no harness, write
   one — copy the rig from `tools/verify-vault.mjs` (it compiles `src/core` and steps the real solver
   against a stub `CollisionWorld`).
4. **`npm run check` and `npm run verify`** before you report done.

## Things that have actually gone wrong here

- **Adding a field to `Intent` breaks every harness.** They each build their own stub object. Grep
  `tools/*.mjs` for the stub and update all of them in the same change.
- **Ordering in `step()` is load-bearing.** Both ground states clamp `vel.y` to 0 every tick, so an
  impulse applied before the state machine is deleted on the next tick and one applied inside a ground
  state is deleted on the same tick. Launches happen *after* the state update. Input edges must be
  recorded *before* it.
- **The post-move collision projection strips velocity into a surface.** Anything that needs to carry
  speed into geometry has to re-assert it every tick as a floor, never a cap.
- **A harness that stops driving input coasts to a halt** — ground friction is 34 m/s². Keep the
  approach speed alive up to the moment the move fires, or you will debug a bug that is not there.

## Reporting

State what changed, the harness output that proves it, and the tuning knobs you added with their
ranges. Do not write DESIGN.md sections. Do not summarise the codebase back.
