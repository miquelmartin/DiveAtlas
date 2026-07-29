import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4174",
    browserName: "chromium",
    channel: "chrome",
    serviceWorkers: "allow",
  },
  webServer: {
    command: "node scripts/serve.mjs",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
