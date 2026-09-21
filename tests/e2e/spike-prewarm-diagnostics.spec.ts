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
    playRenderPrewarmEnabled?: boolean;
    playRenderPrewarmMs?: number;
    playRenderPrewarmDeferredCount?: number;
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

async function flyAndDump(
  page: import("@playwright/test").Page,
  label: string,
  evidenceDir: string,
  query = "",
) {
  await page.goto(`/${query}`);
  await page.getByRole("button", { name: "ひこうき", exact: false }).click();
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  const stats = page.getByLabel("Runtime Stats");
  await expect(stats).toContainText("Rebase");

  await page.waitForTimeout(400);
  await page.keyboard.down("w");
  await page.waitForTimeout(800);
  await page.keyboard.down("ArrowDown");
  await page.waitForTimeout(700);
  await page.keyboard.up("ArrowDown");
  await page.waitForTimeout(8000);
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

  await mkdir(evidenceDir, { recursive: true });
  const path = `${evidenceDir}/spike-flight-${label}.json`;
  await writeFile(
    path,
    JSON.stringify(
      {
        label,
        query,
        savedAt: new Date().toISOString(),
        note: "playwright-e2e: play render prewarm A/B (A=off, B=on/default)",
        hud,
        position,
        dump,
      },
      null,
      2,
    ),
  );
  await page.getByRole("button", { name: "■ やめる", exact: true }).click();
  // 終了時の診断保存・ダイアログ・DROPが完了してから次の画面へ移動する。
  await expect(
    page.getByRole("button", { name: "▶ あそぶ", exact: true }),
  ).toBeEnabled();
  return { label, query, dump, path };
}

test.describe("spike prewarm diagnostics", () => {
  test.setTimeout(240000);

  test("A/B: disablePlayRenderPrewarm vs default preparePlayRendering", async ({
    page,
  }, testInfo) => {
    const evidenceDir = testInfo.outputPath("evidence");
    // A = 無効（旧挙動）、B = Production 既定（準備あり）
    const off = await flyAndDump(
      page,
      "prewarm-a",
      evidenceDir,
      "?disablePlayRenderPrewarm=1",
    );
    const on = await flyAndDump(page, "prewarm-b", evidenceDir);

    expect(off.dump.environment?.playRenderPrewarmEnabled ?? false).toBe(false);
    expect(on.dump.environment?.playRenderPrewarmEnabled).toBe(true);

    const summary = await writeSpikePrewarmSummaryFromDisk(evidenceDir);
    expect(summary.written).toBe(true);
    console.log(
      "[spike-prewarm-summary]",
      JSON.stringify(summary.summary, null, 2),
    );
  });
});
