import { test, expect } from "./fixtures";
import { mkdir, writeFile } from "node:fs/promises";
import { writeSpikeFlightSummaryFromDisk } from "../../scripts/spike-flight-summary";

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
  originRebaseEnabled: boolean;
  environment?: {
    visibilityState: string;
    hasFocus: boolean;
    devicePixelRatio: number;
    canvasCssWidth: number;
    canvasCssHeight: number;
    drawingBufferWidth: number;
    drawingBufferHeight: number;
    webglVendor: string;
    webglRenderer: string;
    longAnimationFrameCount: number;
    shadowMapEnabled: boolean;
    effectivePixelRatio: number;
    gpuTimerSupported: boolean;
    gpuFrameSampleCount: number;
    gpuFrameP50Ms: number;
    gpuFrameP95Ms: number;
    gpuFrameMaxMs: number;
  };
  recentRebases: unknown[];
  spikeWindows: unknown[];
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
  evidenceDir: string,
  query = "",
): Promise<CaseResult> {
  await page.goto(`/${query}`);
  await page.getByRole("button", { name: "ひこうき", exact: false }).click();
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  const stats = page.getByLabel("Runtime Stats");
  await expect(stats).toContainText("Rebase");

  await page.keyboard.down("w");
  await page.waitForTimeout(800);
  await page.keyboard.down("ArrowDown");
  await page.waitForTimeout(700);
  await page.keyboard.up("ArrowDown");
  // 約20秒飛行（録画なし JSON 採取）。画面キャプチャは行わない。
  await page.waitForTimeout(18500);
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
        note: "playwright-e2e: no display/tab capture (recording-off baseline)",
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

test.describe("spike flight diagnostics", () => {
  test.setTimeout(360000);

  test("録画なし GPU A/B（baseline / shadowOFF / dpr1 / both）", async ({
    page,
  }, testInfo) => {
    // UIの終了時保存と競合しない、テスト専用の計測ファイルを使う。
    const evidenceDir = testInfo.outputPath("evidence");
    const baseline = await flyAndDump(page, "baseline", evidenceDir);
    const shadowOff = await flyAndDump(
      page,
      "shadow-off",
      evidenceDir,
      "?disableShadow=1",
    );
    const dpr1 = await flyAndDump(page, "dpr1", evidenceDir, "?pixelRatio=1");
    const both = await flyAndDump(
      page,
      "shadow-off-dpr1",
      evidenceDir,
      "?disableShadow=1&pixelRatio=1",
    );

    expect(baseline.dump.environment?.visibilityState).toBeTruthy();
    expect(baseline.dump.environment?.webglRenderer).toBeTruthy();
    expect(shadowOff.dump.environment?.shadowMapEnabled).toBe(false);
    expect(dpr1.dump.environment?.effectivePixelRatio).toBeLessThanOrEqual(
      1.01,
    );
    expect(both.dump.environment?.shadowMapEnabled).toBe(false);
    expect(both.dump.environment?.effectivePixelRatio).toBeLessThanOrEqual(
      1.01,
    );

    // summary はメモリ上の dump を使わず、書き出した4ファイルから再生成する。
    const summaryResult = await writeSpikeFlightSummaryFromDisk(evidenceDir);
    expect(summaryResult.written).toBe(true);
    expect(summaryResult.summary?.baseline?.p95).toBe(baseline.dump.frameP95Ms);
    expect(summaryResult.summary?.shadowOff?.p95).toBe(
      shadowOff.dump.frameP95Ms,
    );
    expect(summaryResult.summary?.dpr1?.p95).toBe(dpr1.dump.frameP95Ms);
    expect(summaryResult.summary?.shadowOffDpr1?.p95).toBe(
      both.dump.frameP95Ms,
    );
    console.log(
      "[spike-flight-summary]",
      JSON.stringify(summaryResult.summary, null, 2),
    );
  });
});
