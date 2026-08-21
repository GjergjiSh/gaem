import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import { devSave } from './vite-devsave.ts';

/**
 * Which commit this server is serving. With a dev tree and a play tree running
 * side by side, "it broke" is only actionable if we both know which build broke
 * — the two are deliberately not the same code.
 *
 * Read once at startup, so it goes stale until the server restarts. That is the
 * honest reading anyway: an update you have not restarted for is an update the
 * running page may not fully have.
 */
function buildStamp(): string {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
    return `${branch}@${sha}`;
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  plugins: [devSave()],
  define: { __BUILD__: JSON.stringify(buildStamp()) },
  server: {
    port: 5173,
    strictPort: false,
    // NOTE: profiles and tracks are deliberately still WATCHED. Un-watching them
    // stopped the reload-on-every-slider-move, and it also meant Vite never
    // invalidated its cache for those files — so a level regenerated on disk
    // never reached the running game at all, and looked like the edit had not
    // been made. devSave suppresses the reload for its own writes instead; see
    // handleHotUpdate in vite-devsave.ts.
  },
  esbuild: { target: 'esnext' },
  build: { target: 'esnext' },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
});
