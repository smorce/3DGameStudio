import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testMatch: "sample-worlds.spec.ts",
  timeout: 90000,
  use: { ...base.use, baseURL: "http://127.0.0.1:8789" },
  webServer: {
    command:
      "pnpm build && ASSET_DATA_DIR=$(mktemp -d /tmp/sample-worlds-e2e-XXXXXX) PORT=8789 pnpm start:server",
    url: "http://127.0.0.1:8789/api/health",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
