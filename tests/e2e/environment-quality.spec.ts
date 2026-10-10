import { test, expect } from "./fixtures";
import { writeFile } from "node:fs/promises";
import type { MachineStudioAgentApi } from "../../packages/engine-core/src/agent-observation";
import type { Vec3 } from "../../packages/project-schema/src/index";

const cameras: { name: string; position: Vec3; target: Vec3 }[] = [
  { name: "forest-path", position: [72, 16, -137], target: [122, 16, -153] },
  { name: "house-close", position: [-50, 17, -75], target: [-20, 16, -80] },
  { name: "village", position: [-150, 58, 190], target: [-95, 22, -65] },
  { name: "village-square", position: [39, 16, -7], target: [37, 15, -50] },
];
test("環境品質: 実Studioの材質・草・景観をPhaseごとに比較する", async ({
  page,
}, info) => {
  test.setTimeout(240000);
  const phase = process.env.QUALITY_PHASE ?? "phase4";
  const selected =
    phase === "phase1"
      ? cameras.slice(0, 1)
      : phase === "phase2"
        ? cameras.slice(1, 2)
        : phase === "phase3"
          ? cameras.slice(2)
          : cameras;
  const errors: string[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith(".glb") && !response.ok())
      errors.push(`${response.status()} ${response.url()}`);
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?agent=1");
  await page.getByTestId("sample-world-alpine-village").click();
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  await expect(page.getByTestId("runtime-position")).toBeVisible();
  const states = [];
  for (const view of selected) {
    await page.evaluate(
      (view) =>
        (
          window as unknown as {
            __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
          }
        ).__MACHINE_STUDIO_AGENT__.setInspectionView(
          view.position,
          view.target,
        ),
      view,
    );
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
                }
              ).__MACHINE_STUDIO_AGENT__.getState().renderer.textures ?? 0,
          ),
        { timeout: 30000 },
      )
      .toBeGreaterThan(0);
    await page.waitForTimeout(3500);
    const samples = await page.evaluate(async () => {
      const api = (
        window as unknown as { __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi }
      ).__MACHINE_STUDIO_AGENT__;
      const samples = [],
        deadline = performance.now() + 2000;
      while (performance.now() < deadline) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        samples.push(api.getState());
      }
      return samples;
    });
    const memory = await page.evaluate(() => {
      const memory = (
        performance as Performance & {
          memory?: {
            usedJSHeapSize: number;
            totalJSHeapSize: number;
            jsHeapSizeLimit: number;
          };
        }
      ).memory;
      return memory
        ? {
            usedJSHeapSize: memory.usedJSHeapSize,
            totalJSHeapSize: memory.totalJSHeapSize,
            jsHeapSizeLimit: memory.jsHeapSizeLimit,
          }
        : null;
    });
    states.push({ view: view.name, samples, memory });
    await page
      .locator("canvas")
      .first()
      .screenshot({
        path: info.outputPath(`${view.name}.png`),
        style:
          "body * { visibility: hidden !important; } canvas { visibility: visible !important; }",
      });
  }
  expect(errors).toEqual([]);
  const environment = await page.evaluate(() => {
    const gl = document.querySelector("canvas")?.getContext("webgl2"),
      debug = gl?.getExtension("WEBGL_debug_renderer_info");
    return {
      userAgent: navigator.userAgent,
      viewport: [innerWidth, innerHeight],
      pixelRatio: devicePixelRatio,
      renderer: debug
        ? gl?.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : "unavailable",
    };
  });
  await writeFile(
    info.outputPath("performance.json"),
    JSON.stringify(
      {
        phase,
        environment,
        backend: "Chromium ANGLE SwiftShader (software)",
        sampleWindowMs: 2000,
        runs: [{ id: "alpine-village", states }],
      },
      null,
      2,
    ),
  );
  await writeFile(
    info.outputPath("validation.json"),
    JSON.stringify(
      { phase, views: selected, glbDownloadErrors: errors, completed: true },
      null,
      2,
    ),
  );
});
