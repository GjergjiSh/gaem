// Deploy the current commit into the play worktree. Run from the dev side.
//
// This used to only move a ref, leaving the play side to run `npm run update`
// by hand. That was the wrong call: the whole point of two trees is LESS work
// over there, not a chore after every change.
//
// It can push directly now because the running page no longer reloads itself —
// `main.ts` hands HMR to tools/updates.ts, which shows a badge and waits for a
// pause or a click. So writing files into a live play tree costs the player
// nothing, and nobody has to type anything.
//
// What it will not touch: `src/profiles` and `src/levels/tracks`. Those belong
// to the play side. Every slider moved and every brush dragged over there
// survives every deploy.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const gitIn = (dir, ...args) => git('-C', dir, ...args);

/** Paths the play side owns. Never overwritten. */
const YOURS = ['src/profiles', 'src/levels/tracks'];

// --- refuse to ship something that is not what is on disk -------------------
const dirty = git('status', '--porcelain', '--', 'src', 'tools', 'vite.config.ts',
  'vite-devsave.ts', 'index.html', 'package.json')
  .split('\n')
  .filter((l) => l.trim() && !YOURS.some((y) => l.includes(y)));
if (dirty.length) {
  console.error('Uncommitted code changes — a deploy ships the last COMMIT, not\n'
    + 'what is on disk. Commit first:\n');
  for (const l of dirty) console.error('  ' + l);
  process.exit(1);
}

// --- find the play worktree by its branch, not by a hardcoded path ----------
let play = null;
let dir = null;
for (const line of git('worktree', 'list', '--porcelain').split('\n')) {
  if (line.startsWith('worktree ')) dir = line.slice(9).trim();
  if (line === 'branch refs/heads/play-local') play = dir;
}
if (!play || !existsSync(play)) {
  console.error('No play worktree found (looking for the one on branch play-local).\n'
    + 'See tools/AB.md to create it.');
  process.exit(1);
}

const head = git('rev-parse', 'HEAD');
const short = git('rev-parse', '--short', 'HEAD');
const subject = git('log', '-1', '--format=%s');
const before = (() => { try { return gitIn(play, 'rev-parse', 'HEAD'); } catch { return null; } })();

// --- ship it ----------------------------------------------------------------
gitIn(play, 'checkout', head, '--', '.', ...YOURS.map((p) => `:(exclude)${p}`));
// Belt and braces: a tune that somehow got staged over there must not end up in
// the deploy commit and stop being theirs.
for (const p of YOURS) {
  try { execFileSync('git', ['-C', play, 'restore', '--staged', p], { stdio: 'pipe' }); } catch { /* nothing staged */ }
}

const staged = gitIn(play, 'diff', '--cached', '--name-only').split('\n').filter(Boolean);
if (staged.length) gitIn(play, 'commit', '-m', `play: ${short} ${subject}`);
git('branch', '-f', 'playable', head);

// --- report -----------------------------------------------------------------
console.log(`deployed ${short}  ${subject}`);
console.log(`  -> ${play}`);
console.log(`  ${staged.length} file(s) updated; profiles and tracks left alone`);

if (before) {
  const log = git('log', '--oneline', `${before}..${head}`).split('\n').filter(Boolean);
  if (log.length > 1) {
    console.log('\nincluded:');
    for (const l of log) console.log('  ' + l);
  }
}

const theirs = gitIn(play, 'status', '--porcelain', '--', ...YOURS)
  .split('\n').filter((l) => l.trim());
if (theirs.length) {
  console.log('\nstill theirs, untouched:');
  for (const l of theirs) console.log('  ' + l);
}

const running = staged.length > 0;
console.log(running
  ? '\nThe play page will show a "new build ready" badge. It reloads on a pause\n'
    + 'or a click — never mid-run.'
  : '\nNothing changed over there.');
