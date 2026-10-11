import { defineConfig } from "@playwright/test";
import environment from "./playwright.environment.config";
export default defineConfig({
  ...environment,
  testDir: "tests/graphics",
  testMatch: "ground-probe.spec.ts",
  outputDir: process.env.GEOMETRY_OUTPUT ?? "test-results/ground-probe",
  use: { ...environment.use, baseURL: "http://127.0.0.1:8792" },
  webServer: {
    command:
      "pnpm exec vite --config tests/fixtures/ground-probe/vite.config.ts",
    url: "http://127.0.0.1:8792",
    timeout: 30000,
    reuseExistingServer: false,
  },
});
