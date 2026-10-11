import { defineConfig } from "@playwright/test";
import environment from "./playwright.environment.config";
export default defineConfig({
  ...environment,
  testMatch: "hybrid-environment.spec.ts",
  outputDir: process.env.GEOMETRY_OUTPUT ?? "test-results/hybrid-environment",
});
