import { defineConfig } from 'vitest/config';

/**
 * Tests get their own config, deliberately without the Cloudflare plugin.
 *
 * vitest previously inherited `vite.config.ts`, which loads `cloudflare()` and
 * spins up workerd environments. Nothing here needs that: every test in this
 * repo exercises a pure exported function - the query normalisers and groupers
 * in `worker/cf.ts`, the derivation helpers in `src/lib/health.ts` - and none of
 * them touch a binding, a fetch handler or the DOM.
 *
 * Vite 8 forced the issue. It now populates `resolve.external` with the Node
 * builtins for worker environments, and the Cloudflare plugin validates that
 * option away, so the whole suite failed at startup with a config error rather
 * than a test failure.
 *
 * Splitting the config also fixes something that had been tolerated for weeks:
 * every `vitest run` ended with "Tests closed successfully but something
 * prevents Vite server from exiting", which was workerd being started for a
 * suite that never asked for it.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts']
  }
});
