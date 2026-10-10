import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** 目線の比較を既存E2Eから分離し、改修前のCheckoutでも同じ設定を使う。 */
const port = process.env.FIDELITY_EYE_PORT ?? "8793";
export default defineConfig({
  ...base,
  testDir: "tests/environment-eye",
  testMatch:
    process.env.FIDELITY_ALPHA_CAPTURE === "1"
      ? "alpha.spec.ts"
      : "eye.spec.ts",
  outputDir: process.env.FIDELITY_EYE_OUTPUT ?? "test-results/environment-eye",
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `pnpm build && PORT=${port} ASSET_DATA_DIR=.data/environment-eye pnpm start:server`,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
