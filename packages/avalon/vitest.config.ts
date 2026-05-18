import { defineConfig } from "vitest/config";

// Vitest runs the engine tests directly against the TS sources. The
// production build path (`vite build && tsc`) is untouched — server
// code excludes `src/**/*.test.ts` in tsconfig so a stray test file
// doesn't leak into dist.
//
// Tests live alongside the code in `src/__tests__/` so a refactor that
// renames a module surfaces a test-file rename in the same diff.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Tests need to spin up tmp dirs (art / volume tests) and run
    // table-driven scenarios — give them a roomy default timeout.
    testTimeout: 10_000,
    // Stage tests stub out the Discord RPC + runtime() so they have to
    // re-import the runtime module between cases. Setup file wires the
    // fake runtime up once per test file.
    setupFiles: ["src/__tests__/_setup.ts"],
  },
});
