import { defineConfig } from "vitest/config";

/** Integration tests talk to a running server over HTTP (INTEGRATION_BASE_URL); they import no application code. */
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    // One reader's calls must not interleave with another file's: the tests share one disposable database.
    fileParallelism: false,
  },
});
