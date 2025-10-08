import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const rootDir = dirname(fileURLToPath(new URL(import.meta.url)));

export default defineConfig({
  test: {
    include: [
      "shared/src/**/__tests__/**/*.test.ts",
      "worker/src/**/__tests__/**/*.test.ts",
      "app/lib/**/__tests__/**/*.test.ts?(x)",
      "app/components/**/__tests__/**/*.test.ts?(x)",
      "app/app/**/__tests__/**/*.test.ts?(x)",
    ],
    environment: "node",
    restoreMocks: true,
    clearMocks: true,
    environmentMatchGlobs: [
      ["app/components/**/__tests__/**/*.test.ts?(x)", "jsdom"],
    ],
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@cadenzor/shared": resolve(rootDir, "shared/src"),
      react: resolve(rootDir, "node_modules/react"),
      "react/jsx-runtime": resolve(rootDir, "node_modules/react/jsx-runtime"),
      "react-dom": resolve(rootDir, "node_modules/react-dom"),
      "react-dom/client": resolve(rootDir, "node_modules/react-dom/client"),
    },
  },
  esbuild: {
    jsx: "automatic",
  },
});
