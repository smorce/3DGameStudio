import { test, expect } from "./fixtures";
import { mkdir, writeFile } from "node:fs/promises";
import { writeSpikePrewarmSummaryFromDisk } from "../../scripts/spike-prewarm-summary";

type FrameTrace = {
  timeMs: number;
  frame?: number;
  rafIntervalMs: number;
  cpuWorkMs: number;
  renderMs: number;
  physicsStepMs: number;
  positionZ: number;
  thrustActive?: boolean;
  thrustBecameActive?: boolean;
  shaderProgramCount?: number;
  geometryCount?: number;
  textureCount?: number;
};

type SpikeDump = {
  spikeCount20ms: number;
  spikeCount33ms: number;
  spikeCount50ms: number;
  earlySpikeCount20ms: number;
  earlySpikeCount33ms: number;
  earlySpikeCount50ms: number;
  frameP50Ms: number;
  frameP95Ms: number;
  frameP99Ms: number;
  frameMaxMs: number;
  firstThrustFrame?: FrameTrace;
  maxRenderFrame?: FrameTrace;
  environment?: {
    longAnimationFrameCount?: number;
    shaderPrewarmEnabled?: boolean;
    shaderPrewarmMs?: number;
    shaderPrewarmDeferredCount?: number;
    gpuFrameMaxMs?: number;
    gpuFrameMaxSample?: { gpuMs: number; frame: number; timeMs: number };
    recentGpuSamples?: { gpuMs: number; frame: number; timeMs: number }[];
  };
  recentFrames?: FrameTrace[];
  spikeWindows?: {
    centerTimeMs: number;
    spikeRafIntervalMs: number;
    frames: FrameTrace[];
  }[];
};

type CaseResult = {
  label: string;
  query: string;
  path: string;
  dump: SpikeDump;
};

async function flyAndDump(
  page: import("@playwright/test").Page,
  label: string,
  query = "",
): Promise<CaseResult> {
  await page.goto(`/${query}`);
  await page.getByRole("button", { name: "ひこうき", exact: false }).click();
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  const stats = page.getByLabel("Runtime Stats");
  await expect(stats).toContainText("Rebase");

  // 初スロットル瞬間を測るため、少し待ってから W を押す。
  await page.waitForTimeout(400);
  await page.keyboard.down("w");
  await page.waitForTimeout(800);
  await page.keyboard.down("ArrowDown");
  await page.waitForTimeout(700);
  await page.keyboard.up("ArrowDown");
  await page.waitForTimeout(12000);
  await page.keyboard.up("w");

  const hud = await stats.innerText();
  const position = JSON.parse(
    (await page
      .getByTestId("runtime-position")
      .getAttribute("data-position")) ?? "[0,0,0]",
  ) as number[];
  const dump = (await page.evaluate(() => {
    const fn = (
      window as unknown as {
        __exportSpikeDiagnostics?: () => SpikeDump;
      }
    ).__exportSpikeDiagnostics;
    if (!fn) throw new Error("__exportSpikeDiagnostics is missing");
    return fn();
  })) as SpikeDump;

  await mkdir("docs/evidence", { recursive: true });
  const path = `docs/evidence/spike-flight-${label}.json`;
  await writeFile(
    path,
    JSON.stringify(
      {
        label,
        query,
        savedAt: new Date().toISOString(),
        note: "playwright-e2e: thruster first-throttle / shader prewarm A/B",
        hud,
        position,
        dump,
      },
      null,
      2,
    ),
  );
  await page.getByRole("button", { name: "■ やめる", exact: true }).click();
  return { label, query, dump, path };
}

test.describe("spike prewarm diagnostics", () => {
  test.setTimeout(240000);

  test("A/B: baseline vs prewarmShaders", async ({ page }) => {
    const baseline = await flyAndDump(page, "prewarm-a");
    const prewarm = await flyAndDump(
      page,
      "prewarm-b",
      "?prewarmShaders=1",
    );

    expect(baseline.dump.environment?.shaderPrewarmEnabled ?? false).toBe(
      false,
    );
    expect(prewarm.dump.environment?.shaderPrewarmEnabled).toBe(true);
    expect(prewarm.dump.environment?.shaderPrewarmDeferredCount ?? 0).toBeGreaterThan(
      0,
    );

    const firstThrustA =
      baseline.dump.firstThrustFrame ??
      baseline.dump.recentFrames?.find((frame) => frame.thrustBecameActive);
    expect(firstThrustA).toBeTruthy();

    const summary = await writeSpikePrewarmSummaryFromDisk();
    expect(summary.written).toBe(true);
    console.log(
      "[spike-prewarm-summary]",
      JSON.stringify(summary.summary, null, 2),
    );
  });
});
