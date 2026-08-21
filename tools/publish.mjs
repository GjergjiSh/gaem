// Mark the current commit as ready to play. Run from the DEV worktree.
//
// This moves a ref and nothing else. It deliberately does not write into the
// play worktree: doing that mid-session would trip its Vite watcher, and
// main.ts self-accepts with location.reload(), so the game would restart under
// whoever is playing it. That interruption is the entire thing this setup
// exists to remove. The play side pulls, on its own schedule, with
// `npm run update`.
import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const dirty = git('status', '--porcelain', '--', 'src', 'tools', 'vite.config.ts',
  'vite-devsave.ts', 'index.html', 'package.json')
  .split('\n')
  .filter((l) => l.trim() && !/src\/(profiles|levels\/tracks)\//.test(l));

if (dirty.length) {
  console.error('Uncommitted code changes — publishing would ship the last commit,\n'
    + 'not what is on disk. Commit first, or stash:\n');
  for (const l of dirty) console.error('  ' + l);
  process.exit(1);
}

const head = git('rev-parse', 'HEAD');
const short = git('rev-parse', '--short', 'HEAD');
const subject = git('log', '-1', '--format=%s');

let previous = null;
try { previous = git('rev-parse', 'playable'); } catch { /* first publish */ }

git('branch', '-f', 'playable', head);

console.log(`published ${short}  ${subject}`);
if (previous && previous !== head) {
  const log = git('log', '--oneline', `${previous}..${head}`);
  if (log) {
    console.log('\nnew since the last publish:');
    for (const l of log.split('\n')) console.log('  ' + l);
  }
} else if (!previous) {
  console.log('\n(first publish — set up the play worktree with tools/AB.md)');
}
console.log('\nRun `npm run update` in the play worktree when you want it.');
