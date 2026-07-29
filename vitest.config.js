import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    setupFiles: ["./tests/setup.js"],
    exclude: ["tests/browser/**", "node_modules/**"],
    coverage: {
      reporter: ["text"],
    },
  },
});
