import { defineConfig, devices } from "@playwright/test";

process.env.NO_PROXY = "127.0.0.1,localhost";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: "line",
  timeout: 30_000,
  // E2E scenarios intentionally share and reset the deterministic demo database.
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5174",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "corepack pnpm --filter @rongguang/api dev",
      env: {
        ADMIN_ORIGIN: "http://127.0.0.1:5174",
        API_PORT: "4100",
        DEMO_NOW: "2026-08-13T02:50:00.000Z",
        NO_PROXY: "127.0.0.1,localhost",
      },
      reuseExistingServer: true,
      timeout: 30_000,
      url: "http://127.0.0.1:4100/health",
    },
    {
      command: "corepack pnpm --filter @rongguang/admin dev",
      env: {
        ADMIN_ORIGIN: "http://127.0.0.1:5174",
        NO_PROXY: "127.0.0.1,localhost",
        VITE_API_BASE_URL: "http://127.0.0.1:4100",
        VITE_DEMO_NOW: "2026-08-13T02:50:00.000Z",
      },
      reuseExistingServer: true,
      timeout: 30_000,
      url: "http://127.0.0.1:5174/login",
    },
  ],
  projects: [
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
});
