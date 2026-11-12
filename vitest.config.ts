import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@content": fileURLToPath(new URL("./content", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/db/**/*.test.ts", "src/**/*.test.ts"],
    // In-process PostgreSQL (PGlite) needs a moment to start.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/domain/**/*.ts", "src/offline/**/*.ts", "src/data/mock/auth.ts"],
      exclude: ["**/index.ts", "src/offline/types.ts"],
      reporter: ["text-summary", "text"],
      // Each area has its own 90% floor, so a strong area cannot hide a weak one.
      thresholds: {
        "src/domain/**": { lines: 90 },
        "src/offline/**": { lines: 90 },
        "src/data/mock/auth.ts": { lines: 90 },
      },
    },
  },
});
