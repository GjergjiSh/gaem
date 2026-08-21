// Start the play server — but only from the play worktree.
//
// Running plain `vite --port 5174` from the dev tree quietly serves the WRONG
// tree on the right port, which looks like it worked and is worse than an
// error. This checks the branch and, if you are in the wrong place, tells you
// the command that does what you meant.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

let branch = '';
try { branch = git('rev-parse', '--abbrev-ref', 'HEAD'); } catch { /* not a repo */ }

if (branch !== 'play-local') {
  let play = null;
  let dir = null;
  try {
    for (const line of git('worktree', 'list', '--porcelain').split('\n')) {
      if (line.startsWith('worktree ')) dir = line.slice(9).trim();
      if (line === 'branch refs/heads/play-local') play = dir;
    }
  } catch { /* leave it null */ }

  console.error(`This is the ${branch || 'dev'} worktree — serving it on 5174 would put the`);
  console.error('wrong code on the port you play. Run it over there instead:\n');
  console.error(play && existsSync(play) ? `  cd "${play}" && npm run play\n`
    : '  (no play worktree yet — see tools/AB.md)\n');
  process.exit(1);
}

spawn('npx', ['vite', '--port', '5174', '--strictPort'],
  { stdio: 'inherit', shell: process.platform === 'win32' })
  .on('exit', (code) => process.exit(code ?? 0));
