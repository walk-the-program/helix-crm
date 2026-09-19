import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/repo/**/*.test.ts"],
    exclude: ["tests/e2e-mac/**", "tests/e2e-win/**", "node_modules/**"],
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
