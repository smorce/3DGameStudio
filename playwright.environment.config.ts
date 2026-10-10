import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** Phase比較は既存Studio/Runtimeで実施し、通常E2EとPort・出力を分離する。 */
export default defineConfig({
  ...base,
  testMatch: "environment-quality.spec.ts",
  outputDir: "test-results/environment-quality",
  use: { ...base.use, baseURL: "http://127.0.0.1:8791" },
  webServer: {
    command:
      "pnpm build && PORT=8791 ASSET_DATA_DIR=.data/environment-e2e pnpm start:server",
    url: "http://127.0.0.1:8791/api/health",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
