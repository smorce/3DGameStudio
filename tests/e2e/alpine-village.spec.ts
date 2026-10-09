import { test, expect } from "./fixtures";
import { mkdir, writeFile } from "node:fs/promises";
import type { MachineStudioAgentApi } from "../../packages/engine-core/src/agent-observation";
import type { Vec3 } from "../../packages/project-schema/src/index";

const views: { name: string; position: Vec3; target: Vec3 }[] = [
  { name: "reference", position: [-85, 68, 290], target: [-20, 40, -340] },
  { name: "overview", position: [20, 105, 450], target: [-30, 35, -220] },
  { name: "village", position: [-150, 58, 190], target: [-95, 22, -65] },
  { name: "farmland", position: [-112, 24, 150], target: [-85, 13, 57] },
  { name: "aerial", position: [90, 390, 240], target: [-15, 12, -65] },
  { name: "windmill", position: [-205, 25, -20], target: [-205, 20, -65] },
  { name: "forest", position: [80, 75, -155], target: [0, 38, -270] },
];
test("Alpine Village: 景観・再読込・車の移動と同条件の描画性能", async ({
  page,
}, testInfo) => {
  test.setTimeout(420000);
  await mkdir(testInfo.outputDir, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const runs = [];
  const memorySample = () =>
    page.evaluate(() => {
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
  for (const id of ["starter-grassland", "alpine-village"]) {
    await page.goto("/?agent=1");
    await page.getByTestId(`sample-world-${id}`).click();
    await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
    await expect(page.getByTestId("runtime-position")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
              }
            ).__MACHINE_STUDIO_AGENT__.getState().machine.groundedWheelCount ??
            0,
        ),
      )
      .toBeGreaterThan(0);
    if (id === "alpine-village")
      await expect
        .poll(
          () =>
            page.evaluate(() =>
              (
                window as unknown as {
                  __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
                }
              ).__MACHINE_STUDIO_AGENT__.getRenderedEntityPosition(
                "gen:2:42:landmark:alpine-windmill",
              ),
            ),
          { timeout: 30000 },
        )
        .toBeDefined();
    const states = [];
    for (const view of [
      {
        name: "initial",
        position: [8, 18, 77] as Vec3,
        target: [0, 13, 60] as Vec3,
      },
      ...views,
    ]) {
      if (view.name !== "initial")
        await page.evaluate(
          ({ position, target }) =>
            (
              window as unknown as {
                __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
              }
            ).__MACHINE_STUDIO_AGENT__.setInspectionView(position, target),
          view,
        );
      await page.waitForTimeout(2000);
      const samples = await page.evaluate(async () => {
        const api = (
          window as unknown as {
            __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
          }
        ).__MACHINE_STUDIO_AGENT__;
        const result = [];
        let lastFrame = -1;
        const deadline = performance.now() + 2000;
        while (performance.now() < deadline) {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
          const s = api.getState();
          if (s.engine.frame !== lastFrame) {
            result.push(s);
            lastFrame = s.engine.frame;
          }
        }
        return result;
      });
      states.push({ view: view.name, samples, memory: await memorySample() });
      if (id === "alpine-village" && views.some((v) => v.name === view.name))
        await page
          .locator("canvas")
          .first()
          .screenshot({
            path: testInfo.outputPath(`${view.name}.png`),
            style:
              "body * { visibility: hidden !important; } canvas { visibility: visible !important; }",
          });
    }
    // 前進入力と移動距離を実際のRuntimeで確認する。
    const before = await page.evaluate(() =>
      (
        window as unknown as { __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi }
      ).__MACHINE_STUDIO_AGENT__.getState(),
    );
    await page.keyboard.down("w");
    const driveSamples = await page.evaluate(async () => {
      const api = (
        window as unknown as { __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi }
      ).__MACHINE_STUDIO_AGENT__;
      const samples = [];
      const deadline = performance.now() + 2500;
      while (performance.now() < deadline) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        samples.push(api.getState());
      }
      return samples;
    });
    states.push({
      view: "driving",
      samples: driveSamples,
      memory: await memorySample(),
    });
    await page.keyboard.up("w");
    const after = await page.evaluate(() =>
      (
        window as unknown as { __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi }
      ).__MACHINE_STUDIO_AGENT__.getState(),
    );
    expect(after.machine.position?.every(Number.isFinite)).toBe(true);
    const a = before.machine.position!,
      b = after.machine.position!;
    expect(Math.hypot(b[0] - a[0], b[2] - a[2])).toBeGreaterThan(1);
    const events = await page.evaluate(() =>
      (
        window as unknown as { __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi }
      ).__MACHINE_STUDIO_AGENT__
        .getEvents()
        .filter((e) => e.name === "world.chunk.ready"),
    );
    runs.push({ id, states, before, after, chunkEvents: events });
  }
  await page.goto("/?agent=1");
  await page.getByTestId("sample-world-alpine-village").click();
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
            }
          ).__MACHINE_STUDIO_AGENT__.getState().machine.groundedWheelCount ?? 0,
      ),
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  await page.evaluate(
    (view) =>
      (
        window as unknown as { __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi }
      ).__MACHINE_STUDIO_AGENT__.setInspectionView(view.position, view.target),
    views.find((view) => view.name === "overview")!,
  );
  await page.waitForTimeout(1500);
  await page
    .locator("canvas")
    .first()
    .screenshot({
      path: testInfo.outputPath("reloaded.png"),
      style:
        "body * { visibility: hidden !important; } canvas { visibility: visible !important; }",
    });
  const environment = await page.evaluate(() => {
    const gl = document.querySelector("canvas")?.getContext("webgl2");
    const debug = gl?.getExtension("WEBGL_debug_renderer_info");
    return {
      userAgent: navigator.userAgent,
      viewport: [innerWidth, innerHeight],
      pixelRatio: devicePixelRatio,
      renderer: debug
        ? gl?.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : "unavailable",
      vendor: debug
        ? gl?.getParameter(debug.UNMASKED_VENDOR_WEBGL)
        : "unavailable",
      memory: (
        performance as Performance & {
          memory?: {
            usedJSHeapSize: number;
            totalJSHeapSize: number;
            jsHeapSizeLimit: number;
          };
        }
      ).memory
        ? {
            usedJSHeapSize: (
              performance as Performance & {
                memory: { usedJSHeapSize: number };
              }
            ).memory.usedJSHeapSize,
          }
        : null,
    };
  });
  await writeFile(
    testInfo.outputPath("performance.json"),
    JSON.stringify(
      {
        environment,
        backend: "Chromium ANGLE SwiftShader (software)",
        sampleWindowMs: 2000,
        runs,
      },
      null,
      2,
    ),
  );
  // 性能の採取後、同じAlpineの車を道路上で走らせて実際のRebaseを検証する。
  await page.evaluate(
    (view) =>
      (
        window as unknown as { __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi }
      ).__MACHINE_STUDIO_AGENT__.setInspectionView(view.position, view.target),
    views.find((view) => view.name === "reference")!,
  );
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (
            window as unknown as {
              __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
            }
          ).__MACHINE_STUDIO_AGENT__.getRenderedEntityPosition(
            "gen:2:42:landmark:alpine-windmill",
          ),
        ),
      { timeout: 30000 },
    )
    .toBeDefined();
  const beforeRebase = await page.evaluate(() => {
    const api = (
      window as unknown as { __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi }
    ).__MACHINE_STUDIO_AGENT__;
    return {
      state: api.getState(),
      mill: api.getRenderedEntityPosition("gen:2:42:landmark:alpine-windmill")!,
    };
  });
  await page
    .locator("canvas")
    .first()
    .screenshot({
      path: testInfo.outputPath("before-rebase.png"),
      style:
        "body * { visibility: hidden !important; } canvas { visibility: visible !important; }",
    });
  await page.keyboard.down("w");
  try {
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
                }
              ).__MACHINE_STUDIO_AGENT__.getState().world.rebaseCount ?? 0,
          ),
        { timeout: 90000 },
      )
      .toBeGreaterThan(beforeRebase.state.world.rebaseCount ?? 0);
  } finally {
    await page.keyboard.up("w");
  }
  await page.waitForTimeout(1500);
  const afterRebase = await page.evaluate(() => {
    const api = (
      window as unknown as { __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi }
    ).__MACHINE_STUDIO_AGENT__;
    return {
      state: api.getState(),
      mill: api.getRenderedEntityPosition("gen:2:42:landmark:alpine-windmill"),
      events: api
        .getEvents()
        .filter(
          (event) =>
            event.name.includes("rebase") || event.name === "world.chunk.ready",
        ),
    };
  });
  expect(afterRebase.mill).toBeDefined();
  beforeRebase.mill.forEach((value, axis) =>
    expect(afterRebase.mill![axis]).toBeCloseTo(value, 3),
  );
  expect(afterRebase.state.machine.position!.every(Number.isFinite)).toBe(true);
  await page
    .locator("canvas")
    .first()
    .screenshot({
      path: testInfo.outputPath("after-rebase.png"),
      style:
        "body * { visibility: hidden !important; } canvas { visibility: visible !important; }",
    });
  await writeFile(
    testInfo.outputPath("rebase.json"),
    JSON.stringify({ beforeRebase, afterRebase }, null, 2),
  );
});
