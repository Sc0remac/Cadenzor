import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const rootDir = dirname(fileURLToPath(new URL(import.meta.url)));

export default defineConfig({
  test: {
    include: [
      "shared/src/**/__tests__/**/*.test.ts",
      "worker/src/**/__tests__/**/*.test.ts",
    ],
    environment: "node",
    restoreMocks: true,
    clearMocks: true,
  },
  resolve: {
    alias: {
      "@cadenzor/shared": resolve(rootDir, "shared/src"),
    },
  },
});
