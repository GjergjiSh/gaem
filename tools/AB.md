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

**You, once:** start the play server in your own terminal and leave it.

```sh
cd Repos/gaem-play
npm run play          # http://localhost:5174
```

That is the only command on your side. It is yours, in your terminal, and
nothing else will start one behind your back.

**Me, when a feature is finished and verified:**

```
npm run deploy
```

That writes the new code straight into your tree and commits it there. You do
nothing.

It can push directly because **the page no longer reloads itself**. `main.ts`
used to answer HMR with a bare `location.reload()`, which yanked the game out
from under whoever was playing — the exact problem the two trees exist to solve.
Now it hands the update to `tools/updates.ts`: Vite has already fetched the new
modules, the running page keeps its snapshot, and a badge appears saying a build
is waiting. It applies itself the moment you pause, or immediately if you click
it. Never mid-run.

`npm run update` still exists as a manual pull if you ever want one, but nothing
requires it.

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

`npm run play` refuses to run from the dev tree. Serving the wrong tree on the
right port looks like it worked, which is worse than an error.

## Reading a bug report

The HUD's first line is `branch@sha`. `play-local@abc1234` is your tree,
`dev@abc1234` is mine. It is read when the server starts, so restart `npm run
play` after an update if you want the stamp to match.

## Things worth knowing

- A deploy does not delete files that the commit removed. If I delete a source
  file, say so and run `git clean` on your side.
- Nothing but you ever starts a server. If a port is busy and you did not start
  it, that is a bug — say so.
- Your tree will always show your tunes and levels as uncommitted changes in
  `git status`. That is correct — it is how you can see what is yours.
- Running both servers means two node processes and two copies of `assets/`
  (36 MB). `node_modules` is shared.
