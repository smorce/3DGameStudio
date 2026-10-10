import { test, expect } from "../e2e/fixtures";
import { writeFile } from "node:fs/promises";
import type { MachineStudioAgentApi } from "../../packages/engine-core/src/agent-observation";

/** 実際のカメラ位置を検証し、地表から約1.7mの同一視点を比較する。 */
test("environment-eye: 広場の実際の目線位置を固定して比較する", async ({
  page,
}, info) => {
  test.setTimeout(360000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?agent=1");
  await page.getByTestId("sample-world-alpine-village").click();
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  await expect(page.getByTestId("runtime-position")).toBeVisible();
  await page.evaluate(() => {
    const api = (
      window as unknown as { __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi }
    ).__MACHINE_STUDIO_AGENT__;
    api.setInspectionView([39, 13, -7], [37, 14, -50], { exactPose: true });
  });
  const loading = [
    {
      view: "village-eye-exact",
      state: await page.evaluate(() =>
        (
          window as unknown as {
            __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
          }
        ).__MACHINE_STUDIO_AGENT__.getState(),
      ),
    },
  ];
  await page.waitForTimeout(10000);
  let previous = "",
    stable = 0;
  await expect
    .poll(
      async () => {
        const status = await page.evaluate(() => {
          const api = (
            window as unknown as {
              __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
            }
          ).__MACHINE_STUDIO_AGENT__;
          const state = api.getState();
          const debug = api.getWorldDesignDebug() as { renderPending: number };
          return {
            pending: debug.renderPending,
            chunks: state.world.loadedRenderChunks,
            calls: state.renderer.drawCalls,
            textures: state.renderer.textures,
            queue: state.world.generationQueue,
            workers: state.world.workerInFlight,
          };
        });
        const signature = JSON.stringify(status);
        stable =
          status.pending === 0 &&
          status.queue === 0 &&
          status.workers === 0 &&
          signature === previous
            ? stable + 1
            : 0;
        previous = signature;
        return stable;
      },
      { timeout: 180000, intervals: [2000] },
    )
    .toBeGreaterThanOrEqual(5);
  const pose = await page.evaluate(() => {
    const api = (
      window as unknown as { __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi }
    ).__MACHINE_STUDIO_AGENT__;
    return {
      camera: api.getState().camera,
      design: api.getWorldDesignDebug(39, -7),
    };
  });
  for (const [i, coordinate] of [39, 13, -7].entries())
    expect(pose.camera.position?.[i]).toBeCloseTo(coordinate, 2);
  for (const [i, coordinate] of [37, 14, -50].entries())
    expect(pose.camera.target?.[i]).toBeCloseTo(coordinate, 2);
  const states = [];
  for (let repetition = 0; repetition < 3; repetition++) {
    const samples = await page.evaluate(async () => {
      const api = (
        window as unknown as { __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi }
      ).__MACHINE_STUDIO_AGENT__;
      const samples = [],
        deadline = performance.now() + 10000;
      while (performance.now() < deadline) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        samples.push(api.getState());
      }
      return samples;
    });
    states.push({
      view: "village-eye-exact",
      repetition,
      samples,
      memory: null,
    });
  }
  await page
    .locator("canvas")
    .first()
    .screenshot({
      path: info.outputPath("village-eye-exact.png"),
      style:
        "body * { visibility: hidden !important; } canvas { visibility: visible !important; }",
    });
  const environment = await page.evaluate(() => {
    const gl = document.querySelector("canvas")?.getContext("webgl2"),
      debug = gl?.getExtension("WEBGL_debug_renderer_info");
    return {
      userAgent: navigator.userAgent,
      viewport: [innerWidth, innerHeight],
      pixelRatio: devicePixelRatio,
      antialias: gl?.getContextAttributes()?.antialias ?? null,
      msaaSamples: gl?.getParameter(gl.SAMPLES) ?? null,
      renderer: debug
        ? gl?.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : "unavailable",
    };
  });
  await writeFile(
    info.outputPath("performance.json"),
    JSON.stringify(
      {
        environment,
        backend: "Chromium ANGLE SwiftShader (software)",
        sampleWindowMs: 10000,
        loading,
        diagnostics: [],
        runs: [{ id: "alpine-village", states }],
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    info.outputPath("validation.json"),
    JSON.stringify(
      {
        requestedPosition: [39, 13, -7],
        requestedTarget: [37, 14, -50],
        exactPose: true,
        ...pose,
        completed: true,
      },
      null,
      2,
    ) + "\n",
  );
});
