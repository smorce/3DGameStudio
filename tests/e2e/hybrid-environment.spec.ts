import { test, expect, type Page } from "./fixtures";
import { writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import type {
  AgentGameState,
  MachineStudioAgentApi,
} from "../../packages/engine-core/src/agent-observation";
import { generateChunk } from "../../packages/world-generator/src/index";
import type { Vec3 } from "../../packages/project-schema/src/index";

type Modes = Parameters<MachineStudioAgentApi["setEnvironmentDiagnostics"]>[0];
const views: { name: string; position: Vec3; target: Vec3 }[] = [
  { name: "forest-path", position: [72, 16, -137], target: [122, 16, -153] },
  { name: "tree-close", position: [105, 18, -141], target: [122, 18, -153] },
  { name: "house-close", position: [-30, 14, -67], target: [-19.6, 16, -83.6] },
  { name: "village-square", position: [39, 16, -7], target: [37, 15, -50] },
  { name: "farmland", position: [-85, 25, 30], target: [-75, 15, -20] },
  { name: "overview", position: [0, 170, 300], target: [0, 15, -100] },
];
async function state(page: Page) {
  return page.evaluate(() =>
    (
      window as unknown as { __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi }
    ).__MACHINE_STUDIO_AGENT__.getState(),
  );
}
async function settle(page: Page) {
  let previous = "",
    stable = 0;
  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() => {
          const api = (
            window as unknown as {
              __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
            }
          ).__MACHINE_STUDIO_AGENT__;
          const s = api.getState();
          const d = api.getWorldDesignDebug() as { renderPending?: number };
          return {
            pending: d.renderPending,
            queue: s.world.generationQueue,
            workers: s.world.workerInFlight,
            chunks: s.world.loadedRenderChunks,
            calls: s.renderer.drawCalls,
            textures: s.renderer.textures,
          };
        });
        const signature = JSON.stringify(current);
        stable =
          !current.pending &&
          !current.queue &&
          !current.workers &&
          signature === previous
            ? stable + 1
            : 0;
        previous = signature;
        return stable;
      },
      { timeout: 180000, intervals: [1000] },
    )
    .toBeGreaterThanOrEqual(3);
}
test("ハイブリッド環境: 同一カメラで全方式と6景観を比較する", async ({
  page,
}, info) => {
  const full = process.env.HYBRID_FULL === "1",
    baseline = process.env.HYBRID_BASELINE === "1";
  test.setTimeout(full ? 1800000 : 600000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?agent=1");
  const start = Date.now();
  const response = page.waitForResponse("**/api/worlds/alpine-village");
  await page.getByTestId("sample-world-alpine-village").click();
  const project = await (await response).json();
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  await expect(page.getByTestId("runtime-position")).toBeVisible();
  await settle(page);
  const worldPreparationMs = Date.now() - start;
  const buildings = new Set<string>();
  for (let z = -3; z <= 3; z++)
    for (let x = -3; x <= 3; x++)
      for (const entity of generateChunk({
        ...project.world.source,
        chunkX: x,
        chunkZ: z,
      }).entities)
        if (entity.assetSlot?.startsWith("building.")) buildings.add(entity.id);
  expect(buildings.size).toBe(14);
  await expect
    .poll(
      () =>
        page.evaluate(
          (ids) => {
            const api = (
              window as unknown as {
                __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
              }
            ).__MACHINE_STUDIO_AGENT__;
            return ids.filter(
              (id) => api.getRenderedEntityPosition(id) !== undefined,
            ).length;
          },
          [...buildings],
        ),
      { timeout: 60000 },
    )
    .toBe(14);

  const conditions: {
    name: string;
    view: (typeof views)[number];
    modes: Modes;
  }[] = views.map((view) => ({
    name: view.name,
    view,
    modes: { grassMode: "A0" },
  }));
  if (!baseline) {
    for (const grassMode of ["A1", "A2", "A3"] as const)
      conditions.push({
        name: grassMode,
        view: views[0],
        modes: { grassMode, treeShadowMode: "B0", buildingMaterialMode: "C0" },
      });
    for (const treeShadowMode of ["B1", "B2", "B3"] as const)
      conditions.push({
        name: treeShadowMode,
        view: views[0],
        modes: { grassMode: "A0", treeShadowMode, buildingMaterialMode: "C0" },
      });
    for (const buildingMaterialMode of ["C1", "C2"] as const)
      conditions.push({
        name: buildingMaterialMode,
        view: views[2],
        modes: { grassMode: "A0", treeShadowMode: "B0", buildingMaterialMode },
      });
  }
  if (!baseline)
    conditions.forEach((condition) => {
      condition.modes.shadowPassTiming = true;
    });
  const results = [];
  for (const condition of conditions) {
    await page.evaluate(({ view, modes }) => {
      const api = (
        window as unknown as { __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi }
      ).__MACHINE_STUDIO_AGENT__;
      api.setEnvironmentDiagnostics(modes);
      api.setInspectionView(view.position, view.target);
    }, condition);
    const preparing = Date.now();
    await settle(page);
    const conditionPreparationMs = Date.now() - preparing;
    const windows = [];
    for (let repetition = 0; repetition < (full ? 3 : 1); repetition++) {
      const samples = await page.evaluate(
        async (duration) => {
          const api = (
            window as unknown as {
              __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
            }
          ).__MACHINE_STUDIO_AGENT__;
          const samples: AgentGameState[] = [];
          const deadline = performance.now() + duration;
          let frame: number | undefined;
          while (performance.now() < deadline) {
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
            const s = api.getState();
            if (s.engine.frame !== frame) {
              samples.push(s);
              frame = s.engine.frame;
            }
          }
          return samples;
        },
        full ? 10000 : 500,
      );
      const memory = await page.evaluate(() => {
        const api = (
          window as unknown as {
            __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
          }
        ).__MACHINE_STUDIO_AGENT__;
        const heap = (
          performance as Performance & { memory?: { usedJSHeapSize: number } }
        ).memory?.usedJSHeapSize;
        return { resources: api.getEnvironmentResources(), heap: heap ?? null };
      });
      windows.push({ repetition, samples, ...memory });
    }
    await page
      .locator("canvas")
      .first()
      .screenshot({ path: info.outputPath(`${condition.name}.png`) });
    results.push({ ...condition, conditionPreparationMs, windows });
    console.log(`Captured hybrid ${condition.name}`);
  }
  const environment = await page.evaluate(() => {
    const canvas = document.querySelector("canvas")!,
      gl = canvas.getContext("webgl2")!,
      debug = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      viewport: [innerWidth, innerHeight],
      canvas: [canvas.width, canvas.height],
      pixelRatio: devicePixelRatio,
      userAgent: navigator.userAgent,
    };
  });
  if (process.env.GEOMETRY_GPU_CAPTURE === "1")
    expect(environment.renderer).toContain("NVIDIA GeForce RTX 4090");
  await writeFile(
    info.outputPath("hybrid-comparison.json"),
    JSON.stringify(
      {
        baseline,
        full,
        revision: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        studioBuildHash: createHash("sha256")
          .update(await readFile("apps/studio/dist/index.html"))
          .digest("hex"),
        environment,
        worldPreparationMs,
        validatedBuildingCount: buildings.size,
        seed: project.world.source.seed,
        source: project.world.source,
        buildManifest: project.world.buildManifest,
        results,
      },
      null,
      2,
    ),
  );
});

test("ハイブリッド環境: 同じページでWorld復帰と診断切替を繰り返す", async ({
  page,
}, info) => {
  test.setTimeout(process.env.HYBRID_FULL === "1" ? 900000 : 240000);
  await page.goto("/?agent=1");
  const snapshots = [];
  for (
    let cycle = 0;
    cycle < (process.env.HYBRID_FULL === "1" ? 6 : 2);
    cycle++
  ) {
    for (const id of [
      "alpine-village",
      "starter-grassland",
      "alpine-village",
    ]) {
      if (cycle || snapshots.length) {
        await page
          .getByRole("button", { name: "■ やめる", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "▶ あそぶ", exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "新しくつくる", exact: true })
          .click();
      }
      await page.getByTestId(`sample-world-${id}`).click();
      await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
      await expect(page.getByTestId("runtime-position")).toBeVisible();
      if (id === "alpine-village") {
        for (const grassMode of ["A1", "A3", "A2", "A0"] as const) {
          await page.evaluate((grassMode) => {
            const api = (
              window as unknown as {
                __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
              }
            ).__MACHINE_STUDIO_AGENT__;
            api.setEnvironmentDiagnostics({
              grassMode,
              treeShadowMode: "B3",
              buildingMaterialMode: grassMode === "A3" ? "C1" : "C2",
              runtimeProfile:
                grassMode === "A1"
                  ? "performance"
                  : grassMode === "A3"
                    ? "quality"
                    : "balanced",
            });
            api.setInspectionView([72, 16, -137], [122, 16, -153]);
          }, grassMode);
          await page.waitForTimeout(500);
        }
        await page.evaluate(() =>
          (
            window as unknown as {
              __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
            }
          ).__MACHINE_STUDIO_AGENT__.setEnvironmentDiagnostics({
            grassMode: "A0",
            treeShadowMode: "B0",
            buildingMaterialMode: "C0",
          }),
        );
      }
      await settle(page);
      const snapshot = await page.evaluate(() =>
        (
          window as unknown as {
            __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
          }
        ).__MACHINE_STUDIO_AGENT__.getEnvironmentResources(),
      );
      const heap = await page.evaluate(
        () =>
          (performance as Performance & { memory?: { usedJSHeapSize: number } })
            .memory?.usedJSHeapSize ?? null,
      );
      snapshots.push({
        heap,
        cycle,
        id,
        state: await state(page),
        resources: snapshot,
      });
    }
  }
  const alpine = snapshots.filter((s) => s.id === "alpine-village");
  for (const resource of [
    "textures",
    "materials",
    "geometries",
    "grassPatches",
    "grassInstances",
  ])
    expect(alpine.at(-1)!.resources![resource]).toBeLessThanOrEqual(
      alpine[0].resources![resource] * 1.15 + 2,
    );
  expect(alpine.every((s) => s.resources?.grassCoverageBytes === 0)).toBe(true);
  await writeFile(
    info.outputPath("hybrid-stability.json"),
    JSON.stringify({ snapshots }, null, 2),
  );
});

test("ハイブリッド環境: A3と影専用LODで実走しRebase後にWorldへ復帰する", async ({
  page,
}, info) => {
  test.setTimeout(300000);
  await page.goto("/?agent=1");
  await page.getByTestId("sample-world-alpine-village").click();
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  await expect(page.getByTestId("runtime-position")).toBeVisible();
  await page.evaluate(() => {
    const api = (
      window as unknown as { __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi }
    ).__MACHINE_STUDIO_AGENT__;
    api.setEnvironmentDiagnostics({
      grassMode: "A3",
      treeShadowMode: "B3",
      buildingMaterialMode: "C1",
      runtimeProfile: "balanced",
    });
    api.setInspectionView([72, 16, -137], [122, 16, -153]);
  });
  await settle(page);
  const snapshot = () =>
    page.evaluate(() => {
      const api = (
        window as unknown as { __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi }
      ).__MACHINE_STUDIO_AGENT__;
      return {
        state: api.getState(),
        mill: api.getRenderedEntityPosition(
          "gen:2:42:landmark:alpine-windmill",
        ),
        resources: api.getEnvironmentResources(),
        heap:
          (performance as Performance & { memory?: { usedJSHeapSize: number } })
            .memory?.usedJSHeapSize ?? null,
      };
    });
  const before = await snapshot();
  expect(before.mill).toBeDefined();
  await page.keyboard.down("w");
  try {
    await expect
      .poll(async () => (await state(page)).world.rebaseCount ?? 0, {
        timeout: 180000,
        intervals: [500],
      })
      .toBeGreaterThan(before.state.world.rebaseCount ?? 0);
    await expect
      .poll(
        async () => {
          const s = await state(page);
          return Math.hypot(
            s.machine.position![0] - before.state.machine.position![0],
            s.machine.position![2] - before.state.machine.position![2],
          );
        },
        { timeout: 90000, intervals: [500] },
      )
      .toBeGreaterThan(256);
  } finally {
    await page.keyboard.up("w");
  }
  const after = await snapshot();
  expect(after.mill).toBeDefined();
  for (let i = 0; i < 3; i++)
    expect(after.mill![i]).toBeCloseTo(before.mill![i], 2);
  expect(after.state.machine.position!.every(Number.isFinite)).toBe(true);
  expect(after.resources!.grassInstanceBytes).toBeLessThan(4 * 1024 * 1024);
  for (const id of ["starter-grassland", "alpine-village"]) {
    await page.getByRole("button", { name: "■ やめる", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "▶ あそぶ", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "新しくつくる", exact: true })
      .click();
    await page.getByTestId(`sample-world-${id}`).click();
    await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
    await expect(page.getByTestId("runtime-position")).toBeVisible();
  }
  await page.evaluate(() => {
    const api = (
      window as unknown as { __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi }
    ).__MACHINE_STUDIO_AGENT__;
    api.setEnvironmentDiagnostics({
      grassMode: "A0",
      treeShadowMode: "B0",
      buildingMaterialMode: "C0",
      runtimeProfile: "balanced",
    });
    api.setInspectionView([72, 16, -137], [122, 16, -153]);
  });
  await settle(page);
  const restored = await snapshot();
  expect(restored.resources!.grassCoverageBytes).toBe(0);
  expect(restored.resources!.textures).toBeLessThanOrEqual(
    before.resources!.textures,
  );
  expect(restored.state.world.rebaseCount).toBe(0);
  await writeFile(
    info.outputPath("hybrid-rebase.json"),
    JSON.stringify({ before, after, restored }, null, 2),
  );
});
