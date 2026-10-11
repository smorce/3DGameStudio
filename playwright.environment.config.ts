import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** Phase比較は既存Studio/Runtimeで実施し、通常E2EとPort・出力を分離する。 */
export default defineConfig({
  ...base,
  testMatch: "environment-quality.spec.ts",
  outputDir: process.env.GEOMETRY_OUTPUT ?? "test-results/environment-quality",
  use: {
    ...base.use,
    baseURL: "http://127.0.0.1:8791",
    ...(process.env.GEOMETRY_GPU_CAPTURE === "1"
      ? {
          headless: false,
          launchOptions: {
            args: [
              "--use-gl=angle",
              "--use-angle=gl",
              "--ignore-gpu-blocklist",
              "--disable-software-rasterizer",
            ],
          },
        }
      : {}),
  },
  webServer: {
    command:
      process.env.FIDELITY_EXISTING_BUILD === "1"
        ? "PORT=8791 ASSET_DATA_DIR=.data/environment-e2e EVIDENCE_DATA_DIR=test-results/generated-evidence pnpm start:server"
        : "pnpm build && PORT=8791 ASSET_DATA_DIR=.data/environment-e2e EVIDENCE_DATA_DIR=test-results/generated-evidence pnpm start:server",
    url: "http://127.0.0.1:8791/api/health",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
