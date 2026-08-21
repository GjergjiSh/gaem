# Two copies of the game

One tree I work in, one tree you play in. They are separate directories with
separate Vite servers, so nothing I do interrupts a run and nothing you do turns
up in my diff.

| | dev (mine) | play (yours) |
|---|---|---|
| directory | `Repos/gaem` | `Repos/gaem-play` |
| branch | `dev` | `play-local` |
| server | `npm run dev` → :5173 | `npm run play` → :5174 |

Both are git worktrees of the same repository, so there is one history and one
`node_modules` (junctioned), not two clones.

## Why separate at all

`main.ts` self-accepts HMR with `location.reload()`, because the game holds too
much global state to hot-swap. So **any** source file I touch restarts your
game. And it runs the other way too: the tuning panel and the level editor write
into `src/`, so your play session edits the same files I am working in. Both
directions have gone wrong in practice — a brush deleted in your editor showed
up in my diff, and a half-written `.tmp` got caught by `git add -A`.

## Who owns what

Code is mine, tunes and levels are yours:

- I own `src/**` code, `tools/`, `DESIGN.md`, config.
- **You own `src/profiles/*.json` and `src/levels/tracks/*.json`.**

An update never overwrites what you own. Move a slider, drag a brush, save a
level — it survives every update, forever. If I need your tune I read it out of
your tree; it never travels the other way automatically.

## The loop

**Me, when a feature is finished and verified:**

```
npm run publish
```

That moves the `playable` ref. It writes nothing into your tree — deliberately.
Deploying into a running server would trip its watcher and reload the page under
you, which is the thing this whole arrangement exists to prevent.

**You, whenever you are between runs:**

```
npm run update        # in Repos/gaem-play
```

It brings across the published code, skips everything you own, commits the code
on `play-local`, and prints what changed. Then reload the tab.

Nothing is automatic. The game only ever changes under you when you ask it to.

## First-time setup

From `Repos/gaem`:

```sh
git branch playable                     # the "ready to play" marker
git worktree add -b play-local ../gaem-play playable
```

(Already done — this is here so it can be rebuilt.)

Then link the dependencies rather than installing them twice (PowerShell):

```powershell
New-Item -ItemType Junction -Path ..\gaem-play\node_modules -Target (Resolve-Path .\node_modules)
```

And start it:

```sh
cd ../gaem-play && npm run play         # http://localhost:5174
```

## Reading a bug report

The HUD's first line is `branch@sha`. `play-local@abc1234` is your tree,
`dev@abc1234` is mine. It is read when the server starts, so restart `npm run
play` after an update if you want the stamp to match.

## Things worth knowing

- `npm run update` does not delete files that the published commit removed. If I
  delete a source file, say so and run `git clean` on your side.
- Your tree will always show your tunes and levels as uncommitted changes in
  `git status`. That is correct — it is how you can see what is yours.
- Running both servers means two node processes and two copies of `assets/`
  (36 MB). `node_modules` is shared.
