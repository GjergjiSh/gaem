---
name: deploy
description: Ship committed work to the play worktree so the user can play it. Use when asked to deploy, publish, push to play, "make it playable", or update play-local. Also the right skill when a change is finished and the user wants to try it in the actual game.
---

# Deploy to the play worktree

Two checkouts of one repo. Work happens in `Repos/gaem` on `playable`; the user plays
`Repos/gaem-play` on `play-local`. `tools/update-play.mjs` moves code from the first to the second.

## Steps

1. **Commit the work on `playable`.** The deploy reads the `playable` *ref*, not the working tree —
   uncommitted changes will not ship.

   ```bash
   git -C /c/Users/ACER/Repos/gaem status --short
   ```

2. **Run the update from the play side.** It refuses to run anywhere else.

   ```bash
   cd /c/Users/ACER/Repos/gaem-play && npm run update
   ```

3. **Verify it actually landed** — grep the play tree for something the change introduced, then:

   ```bash
   cd /c/Users/ACER/Repos/gaem-play && npm run check && npm run verify
   ```

4. **Tell the user to reload the tab.** The dev server does not restart on its own.

## What the tool guarantees

- `src/profiles/` and `src/levels/tracks/` are **owned by the play side** and are never overwritten.
  The user's tunes and hand-built levels survive every deploy. Never hand-copy into them.
- It commits on `play-local` with the message `play: <sha> <subject of the playable commit>`.

## Traps

- **It copies with `git checkout <ref> -- .`, which overwrites but never deletes.** A file that a
  rollback removed from `playable` stays behind in the play tree forever. This has already produced
  an orphaned `verify-vault.mjs` — a test file present without the feature it tested, unwired and
  crashing. After a deploy that follows a revert, check for leftovers.
- **Never hand-copy files between the worktrees.** Use the tool, or the two trees drift and the next
  deploy silently reverts whatever you copied.
- **`playable` has been force-reset more than once**, orphaning committed work. If the expected
  commits are missing, they are almost certainly still in `git reflog show playable` — recover from
  there rather than redoing the work.
- If `git rev-parse` reports "Needed a single revision" in a worktree, you are probably in a directory
  whose worktree was pruned. Check `git worktree list` before trusting any git output.
