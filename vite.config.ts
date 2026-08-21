import { defineConfig } from 'vite';
import { devSave } from './vite-devsave.ts';

export default defineConfig({
  plugins: [devSave()],
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
