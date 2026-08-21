// Dev-only file writer, so the panel and the level editor can save straight into
// the repo instead of into localStorage.
//
// Why this exists: localStorage is per-browser state that a cleared cache, a
// different browser or a profile wipe takes with it, and nothing in it is visible
// to git. Tunes and levels are *source*. They belong in files you can diff,
// revert and commit, and they should be on disk the moment you move a slider —
// not when the tab happens to close cleanly.
//
// Serve-only: `apply: 'serve'` keeps the whole thing out of the production build,
// and the client side is behind `import.meta.env.DEV`. A built game writes nothing.
import type { Plugin, ViteDevServer } from 'vite';
import { writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

/**
 * Absolute paths this plugin wrote, and when. The watcher fires a moment later
 * and we use this to tell "the game just saved itself" from "someone edited the
 * file", which want opposite treatment — see handleHotUpdate.
 */
const selfWrites = new Map<string, number>();
const SELF_WRITE_MS = 2500;

/**
 * The only paths a browser may write, matched against the repo-relative POSIX
 * path. Fixed directory prefixes and a filename charset with no slash in it, so
 * nothing can be steered out of these two folders; the resolved path is then
 * checked against the project root as a second, independent gate.
 */
const ALLOW = [
  /^src\/profiles\/[A-Za-z0-9_.-]+\.json$/,
  /^src\/levels\/tracks\/[A-Za-z0-9_.-]+\.json$/,
];

const MAX_BYTES = 8 * 1024 * 1024;

function readBody(req: any): Promise<string> {
  return new Promise((ok, fail) => {
    let n = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      n += c.length;
      if (n > MAX_BYTES) { fail(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

export function devSave(): Plugin {
  return {
    name: 'devsave',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const root = resolve(server.config.root);
      server.middlewares.use('/__save', async (req, res) => {
        const reply = (code: number, body: object) => {
          res.statusCode = code;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST') return reply(405, { error: 'POST only' });
        try {
          const { path, data } = JSON.parse(await readBody(req));
          if (typeof path !== 'string' || !ALLOW.some((re) => re.test(path))) {
            return reply(400, { error: `path not writable: ${path}` });
          }
          const abs = resolve(root, path);
          if (!abs.startsWith(root + sep)) return reply(400, { error: 'path escapes root' });

          // Write-then-rename: a crash mid-write leaves the old file intact rather
          // than a truncated one. The whole point here is not losing work.
          const tmp = `${abs}.tmp`;
          await mkdir(dirname(abs), { recursive: true });
          await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
          await rename(tmp, abs);
          selfWrites.set(abs, Date.now());
          reply(200, { ok: true, path });
        } catch (err: any) {
          reply(500, { error: String(err?.message ?? err) });
        }
      });
    },

    /**
     * Writes the GAME made get their module cache invalidated but no client
     * update: the browser already has those values, it is the one that sent
     * them, and reloading the page mid-slider-drag is worse than no hot reload
     * at all.
     *
     * Writes anyone ELSE made — an editor, a script that regenerates a level —
     * fall through to Vite's default, which for JSON is a full reload. That
     * matters more than it sounds: the first version of this simply stopped
     * watching both directories, which also stopped Vite from ever noticing a
     * regenerated track, so the running game kept serving the copy it had
     * cached at startup and every change to the level looked like it had
     * silently failed.
     */
    handleHotUpdate(ctx) {
      const at = selfWrites.get(ctx.file);
      if (at === undefined) return;
      if (Date.now() - at > SELF_WRITE_MS) { selfWrites.delete(ctx.file); return; }
      selfWrites.delete(ctx.file);
      return [];
    },
  };
}
