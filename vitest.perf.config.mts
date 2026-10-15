import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests de performance (`npm run test:perf`) : volumineux, donc séparés de la suite courante. Ils tournent sur la base de
// test (TEST_DATABASE_URL, redirection faite par tests/setup.ts) et nettoient ce qu'ils créent.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["tests/perf/**/*.perf.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
