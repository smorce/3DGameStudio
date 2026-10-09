import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** 全体E2Eと別Port・別出力で景観の修正を確認する。 */
export default defineConfig({
  ...base,
  testMatch: ["alpine-village.spec.ts", "sample-worlds.spec.ts"],
  outputDir: "test-results/alpine-isolated",
  use: { ...base.use, baseURL: "http://127.0.0.1:8790" },
  webServer: {
    command:
      "pnpm build && PORT=8790 ASSET_DATA_DIR=.data/alpine-e2e pnpm start:server",
    url: "http://127.0.0.1:8790/api/health",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
