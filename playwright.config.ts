import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  use: {
    baseURL: "http://127.0.0.1:8788",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
  },
  projects: process.env.ALL_BROWSERS
    ? [
        {
          name: "chromium",
          use: { ...devices["Desktop Chrome"], channel: "chromium" },
        },
        { name: "firefox", use: devices["Desktop Firefox"] },
        { name: "webkit", use: devices["Desktop Safari"] },
      ]
    : [
        {
          name: "chromium",
          use: { ...devices["Desktop Chrome"], channel: "chromium" },
        },
      ],
  webServer: {
    command:
      "pnpm build && PORT=8788 ASSET_DATA_DIR=.data/e2e pnpm start:server",
    url: "http://127.0.0.1:8788/api/health",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
