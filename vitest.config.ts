import { defineConfig } from 'vitest/config';

// One root config for the whole monorepo.
// Property-based tests are named *.pbt.test.ts so `pnpm test:pbt` can select them.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['{kit,apps/*,phantom-handset}/{src,test}/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
