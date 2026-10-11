import { test, expect } from "./fixtures";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { MachineStudioAgentApi } from "../../packages/engine-core/src/agent-observation";
import type { Vec3 } from "../../packages/project-schema/src/index";

const cameras: {
  name: string;
  position: Vec3;
  target: Vec3;
  exactPose?: boolean;
}[] = [
  { name: "forest-path", position: [72, 16, -137], target: [122, 16, -153] },
  { name: "house-close", position: [-50, 17, -75], target: [-20, 16, -80] },
  { name: "village", position: [-150, 58, 190], target: [-95, 22, -65] },
  { name: "village-square", position: [39, 16, -7], target: [37, 15, -50] },
];
test("環境品質: 実Studioの材質・草・景観をPhaseごとに比較する", async ({
  page,
}, info) => {
  const fidelity = process.env.FIDELITY_CAPTURE === "1";
  test.setTimeout(fidelity ? 1200000 : 240000);
  const sampleWindowMs = fidelity ? 10000 : 2000;
  const repetitions = fidelity ? 3 : 1;
  const phase = process.env.QUALITY_PHASE ?? "phase4";
  const extraCameras: typeof cameras = [
    {
      name: "house-detail",
      position: [-30, 14, -67],
      target: [-19.6, 16, -83.6],
    },
    { name: "village-eye", position: [39, 13, -7], target: [37, 14, -50] },
  ];
  const selected =
    phase === "phase1"
      ? cameras.slice(0, 1)
      : phase === "phase2"
        ? cameras.slice(1, 2)
        : phase === "phase3"
          ? fidelity
            ? []
            : cameras.slice(2)
          : cameras;
  if (process.env.GEOMETRY_DETAILS_ONLY === "1")
    selected.splice(
      0,
      selected.length,
      { name: "front", position: [-5, 17, -72], target: [-19.6, 16, -83.6] },
      { name: "side", position: [-5, 17, -102], target: [-19.6, 16, -83.6] },
      { name: "closeup", position: [-10, 16, -76], target: [-19.6, 16, -83.6] },
    );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /shader|WebGL/i.test(message.text()))
      errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.url().endsWith(".glb") && !response.ok())
      errors.push(`${response.status()} ${response.url()}`);
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const startupStarted = Date.now();
  await page.goto("/?agent=1");
  const worldResponse = page.waitForResponse("**/api/worlds/alpine-village");
  await page.getByTestId("sample-world-alpine-village").click();
  const preparedWorld = await (await worldResponse).json();
  expect(preparedWorld.world.source.seed).toBe(42);
  const worldSourceHash = createHash("sha256")
    .update(JSON.stringify(preparedWorld.world.source))
    .digest("hex");
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  await expect(page.getByTestId("runtime-position")).toBeVisible();
  const startupUntilRuntimeHudMs = Date.now() - startupStarted;
  const grassMode = process.env.PROCEDURAL_GRASS_MODE;
  if (grassMode === "A0" || grassMode === "A1" || grassMode === "A2")
    await page.evaluate(
      (grassMode) =>
        (
          window as unknown as {
            __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
          }
        ).__MACHINE_STUDIO_AGENT__.setEnvironmentDiagnostics({
          grassMode: grassMode as "A0" | "A1" | "A2",
        }),
      grassMode,
    );
  const states = [];
  const loading = [];
  const diagnostics = [];
  if (fidelity && phase !== "phase1") selected.push(...extraCameras);
  if (process.env.FIDELITY_FOREST_ONLY === "1")
    selected.splice(0, selected.length, cameras[0], ...extraCameras);
  if (process.env.FIDELITY_EXTRA_ONLY === "1") {
    selected.splice(0, selected.length, ...extraCameras);
  }
  if (
    fidelity &&
    phase === "phase4" &&
    process.env.FIDELITY_EXTRA_ONLY !== "1" &&
    process.env.FIDELITY_FOREST_ONLY !== "1"
  )
    selected.push(
      { name: "overview", position: [0, 170, 300], target: [0, 15, -100] },
      { name: "aerial", position: [0, 450, 0], target: [0, 12, -80] },
    );
  // 実GPUは代表4視点を同じSeed・画角・10秒×3回で補助測定する。
  if (
    process.env.GEOMETRY_GPU_CAPTURE === "1" &&
    !process.env.PROCEDURAL_GRASS_MODE
  )
    selected.splice(
      0,
      selected.length,
      cameras[0],
      extraCameras[0],
      cameras[2],
      {
        name: "village-eye-exact",
        position: [39, 13, -7],
        target: [37, 14, -50],
        exactPose: true,
      },
    );
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
          view.exactPose ? { exactPose: true } : undefined,
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
    loading.push({
      view: view.name,
      state: await page.evaluate(() =>
        (
          window as unknown as {
            __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
          }
        ).__MACHINE_STUDIO_AGENT__.getState(),
      ),
    });
    await page.waitForTimeout(fidelity ? 10000 : 3500);
    if (fidelity || process.env.GEOMETRY_DETAILS_ONLY === "1") {
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
              const debug = api.getWorldDesignDebug() as {
                renderPending: number;
              };
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
    }
    if (view.exactPose) {
      const camera = await page.evaluate(
        () =>
          (
            window as unknown as {
              __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
            }
          ).__MACHINE_STUDIO_AGENT__.getState().camera,
      );
      for (const [i, coordinate] of view.position.entries())
        expect(camera.position?.[i]).toBeCloseTo(coordinate, 2);
      for (const [i, coordinate] of view.target.entries())
        expect(camera.target?.[i]).toBeCloseTo(coordinate, 2);
    }
    for (let repetition = 0; repetition < repetitions; repetition++) {
      const samples = await page.evaluate(async (sampleWindowMs) => {
        const api = (
          window as unknown as {
            __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
          }
        ).__MACHINE_STUDIO_AGENT__;
        const samples = [],
          deadline = performance.now() + sampleWindowMs;
        while (performance.now() < deadline) {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
          samples.push(api.getState());
        }
        return samples;
      }, sampleWindowMs);
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
      const resources = await page.evaluate(
        () =>
          (
            window as unknown as {
              __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
            }
          ).__MACHINE_STUDIO_AGENT__.getEnvironmentResources?.() ?? null,
      );
      states.push({ view: view.name, repetition, samples, memory, resources });
    }
    if (
      fidelity &&
      !process.env.PROCEDURAL_GRASS_MODE &&
      ["forest-path", "house-close", "village-square"].includes(view.name)
    ) {
      for (const category of [
        "trees",
        "grass",
        "buildingDetails",
        "groundDetails",
        "shadows",
      ] as const) {
        await page.evaluate(
          (category) =>
            (
              window as unknown as {
                __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
              }
            ).__MACHINE_STUDIO_AGENT__.setEnvironmentDiagnostics({
              [category]: false,
            }),
          category,
        );
        await page.waitForTimeout(2000);
        const samples = await page.evaluate(async () => {
          const api = (
            window as unknown as {
              __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
            }
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
        diagnostics.push({ view: view.name, disabled: category, samples });
        await page.evaluate(
          (category) =>
            (
              window as unknown as {
                __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
              }
            ).__MACHINE_STUDIO_AGENT__.setEnvironmentDiagnostics({
              [category]: true,
            }),
          category,
        );
      }
      await page.waitForTimeout(2000);
    }
    await page
      .locator("canvas")
      .first()
      .screenshot({
        path: info.outputPath(`${view.name}.png`),
        style:
          "body * { visibility: hidden !important; } canvas { visibility: visible !important; }",
      });
    console.log(`Captured ${view.name}`);
  }
  expect(errors).toEqual([]);
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
        phase,
        measurementVersion: 2,
        worldSeed: preparedWorld.world.source.seed,
        worldGeneratorVersion: preparedWorld.world.source.generatorVersion,
        worldSourceHash,
        environment,
        backend:
          process.env.GEOMETRY_GPU_CAPTURE === "1"
            ? environment.renderer
            : "Chromium ANGLE SwiftShader (software)",
        sampleWindowMs,
        startupUntilRuntimeHudMs,
        grassMode: grassMode ?? "A0",
        loading,
        diagnostics,
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
