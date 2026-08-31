# gaem

Browser movement-shooter prototype. Vite + TypeScript + three.js (render) + rapier3d (collision).
No framework, no test runner — verification is bespoke headless harnesses (see below).

## Two task families — route by model

| family | files | model |
|---|---|---|
| **gameplay** — mechanics, systems, feel | `src/core/**`, `src/engine/{physics,input,hook,projectiles,weapon,sword,enemies}.ts`, `tools/verify-*.mjs` | **opus** |
| **look** — visuals, sound, levels, models | `src/engine/{render,surfaces,models,ink,audio,rush}.ts`, `src/levels/**`, `src/tools/{editor,hud,panel}.ts`, `assets/**` | **sonnet** |

Agents for each live in `.claude/agents/`. Use them — they keep exploration out of the main
context, which is where this project's token cost actually comes from.

## Architecture invariants

- **`src/core/` is engine-agnostic.** It imports nothing from three or rapier — only `T`, the
  `Player` struct, an `Intent`, and a `CollisionWorld` interface. This is what lets the verify
  harnesses compile it and run it in node against a stub world. Never import an engine type into `core/`.
- **Every constant lives in `src/core/tuning.ts`.** A number inline in `core/` is a bug. Adding a
  field to `T` auto-generates a slider; `META` overrides its range/doc.
- **Fixed 120 Hz tick** (`FIXED = 1/120` in `main.ts`). The solver is deterministic — that is why
  the harnesses can assert exact positions.
- Movement is a small state machine (`grounded/airborne/dashing/sliding/wallrunning/wingsuit`) plus
  *modifiers* layered on top (vault, slam, grapple, gas). Modifiers are the extension point: they
  probe and hand velocity back, so they work out of any state without it knowing they exist.

## Navigating the big files cheaply — do not read these whole

- `src/core/solver.ts` (1750 lines) — split by banner comments. `grep -n "^// -\{10,\}"` lists the
  sections (gas, actions, ground slam, vault, wallrun, grapple, thrusters, wingsuit, states, main step),
  then read only that range.
- `src/core/tuning.ts` (1460 lines) — one object per system. `sed -n '/^  vault: {/,/^  },/p'` gets one block.
- `src/levels/ashgate.ts` (3850 lines) — generated geometry. Grep for the feature, never open it whole.
- `DESIGN.md` (4400 lines) — **archival. Do not read it and do not update it.** It was a scratchpad of
  early thoughts that Claude then kept growing; nobody reads it. Writing sections into it is pure
  token cost. Explain design decisions in the commit message and in code comments instead.

## Commands

```bash
npm run check      # tsc --noEmit
npm run verify     # every headless harness — the real test suite
npm run dev        # vite; prefer the preview tool with .claude/launch.json name "game"
```

Per-system harnesses: `verify:vault`, `verify:slam`, `verify:wing`, `verify:gas`, `verify:collision`,
`verify:enemies`, `verify:level`, `verify:boxselect`, `verify:sound`.

**Gameplay changes must be verified by a harness, not by eye.** They compile `src/core` and step the
real solver against a stub `CollisionWorld` — far cheaper and far stronger than driving the browser.
Adding a mechanic means adding or extending a `tools/verify-*.mjs`.

> Every harness builds its own `Intent` stub. **Adding a button to `Intent` breaks all of them** —
> update every `tools/verify-*.mjs` stub in the same change.

**Look changes** are verified in the browser preview (`preview_start` name `"game"`), with a
screenshot or `read_page`. Do not start dev servers with Bash.

## Worktrees and deploying

Three checkouts share this repo:

| path | branch | role |
|---|---|---|
| `Repos/gaem` | `playable` | where work happens |
| `Repos/gaem-play` | `play-local` | the tab the user actually plays |

Deploy is `/deploy` (see `.claude/skills/deploy/`). Never hand-copy files between worktrees.
`src/profiles/` and `src/levels/tracks/` are owned by the play side and are never overwritten.

> `playable` has been force-reset more than once, orphaning committed work. Before any history
> operation, check `git reflog show playable`. Objects survive resets even when branches do not.

## Token discipline

- Answer from this file first. Only grep when it does not cover the question.
- Read line ranges, not files. Use `sed -n 'A,Bp'` / `grep -n` to locate, then read narrowly.
- Do not re-read a file you just edited to confirm the edit.
- No summary documents unless asked. No DESIGN.md updates, ever.
