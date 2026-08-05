import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

// The Cloudflare plugin runs the Worker in workerd locally, so dev matches prod.
// Without it you develop against Node semantics and discover the difference on deploy.
// outDir is left at the plugin's default: it emits the SPA to dist/client and the
// Worker to dist/<worker-name>, which is what wrangler.jsonc's assets.directory
// points at. Overriding it nests a second `client/` inside the first.
export default defineConfig({
  plugins: [react(), cloudflare()],
  build: { sourcemap: true }
});
