import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for the plex-media-manager test suite.
 *
 * The project is ESM ("type": "module") but the source is authored in a
 * CommonJS-friendly style (e.g. `__dirname` in src/config/env.ts). Vitest's
 * Vite transform injects `__dirname`/`__filename` per module, so the source
 * imports cleanly without changing the production tsconfig (module: commonjs).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types/**', 'src/**/index.ts'],
      reporter: ['text', 'html'],
    },
  },
});
