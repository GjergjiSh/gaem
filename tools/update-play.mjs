// Pull the latest published code into the PLAY worktree. Run from that side,
// whenever you are between runs — never automatically.
//
// Your tune profiles and your levels are yours. The checkout excludes them, so
// every slider you have moved and every brush you have dragged survives an
// update untouched. Code comes from the dev side; `src/profiles` and
// `src/levels/tracks` only ever go the other way.
import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const gitQuiet = (...args) => execFileSync('git', args, { stdio: 'pipe' });

/** Paths the play side owns. Never overwritten by an update. */
const YOURS = ['src/profiles', 'src/levels/tracks'];

let branch;
try { branch = git('rev-parse', '--abbrev-ref', 'HEAD'); } catch { branch = ''; }
if (branch !== 'play-local') {
  console.error(`This is the ${branch || 'dev'} worktree, not the play one.\n`
    + 'Run it from the play worktree (its branch is play-local). See tools/AB.md.');
  process.exit(1);
}

let target;
try { target = git('rev-parse', 'playable'); } catch {
  console.error('No `playable` ref yet — nothing has been published.');
  process.exit(1);
}

const current = git('rev-parse', 'HEAD');
if (current === target) {
  console.log(`already on ${git('rev-parse', '--short', 'HEAD')} — nothing new published.`);
  process.exit(0);
}

// Bring across everything except what you own.
gitQuiet('checkout', target, '--', '.', ...YOURS.map((p) => `:(exclude)${p}`));

// Anything you have changed got staged by nothing above, but be certain: a
// stray staged tune would end up in the deploy commit and stop being yours.
for (const p of YOURS) {
  try { gitQuiet('restore', '--staged', p); } catch { /* nothing staged there */ }
}

const staged = git('diff', '--cached', '--name-only').split('\n').filter(Boolean);
if (staged.length) {
  gitQuiet('commit', '-m', `play: ${git('rev-parse', '--short', target)} `
    + `${git('log', '-1', '--format=%s', target)}`);
}

console.log(`updated to ${git('rev-parse', '--short', target)}  `
  + `${git('log', '-1', '--format=%s', target)}`);
console.log(`${staged.length} file(s) changed. Your tunes and levels were not touched.`);
const mine = git('status', '--porcelain', '--', ...YOURS).split('\n').filter((l) => l.trim());
if (mine.length) {
  console.log('\nstill yours, uncommitted:');
  for (const l of mine) console.log('  ' + l);
}
console.log('\nReload the tab to pick it up.');
