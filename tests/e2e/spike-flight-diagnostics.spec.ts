import { test, expect } from "./fixtures";
import { mkdir, writeFile } from "node:fs/promises";

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
  lastRebase?: {
    rebaseTotalMs: number;
    physicsRebaseMs: number;
    rendererRebaseMs: number;
  };
  recentRebases: unknown[];
  spikeWindows: unknown[];
};

type CaseResult = {
  label: string;
  query: string;
  path: string;
  hud: string;
  position: number[];
  dump: SpikeDump;
};

function summarize(result: CaseResult) {
  const env = result.dump.environment;
  return {
    path: result.path,
    query: result.query,
    position: result.position,
    spikes: [
      result.dump.spikeCount20ms,
      result.dump.spikeCount33ms,
      result.dump.spikeCount50ms,
    ],
    early: [
      result.dump.earlySpikeCount20ms,
      result.dump.earlySpikeCount33ms,
      result.dump.earlySpikeCount50ms,
    ],
    p50: result.dump.frameP50Ms,
    p95: result.dump.frameP95Ms,
    p99: result.dump.frameP99Ms,
    maxMs: result.dump.frameMaxMs,
    rebaseEvents: result.dump.recentRebases.length,
    spikeWindows: result.dump.spikeWindows.length,
    environment: env
      ? {
          visibilityState: env.visibilityState,
          hasFocus: env.hasFocus,
          devicePixelRatio: env.devicePixelRatio,
          canvasCss: [env.canvasCssWidth, env.canvasCssHeight],
          drawingBuffer: [env.drawingBufferWidth, env.drawingBufferHeight],
          webglRenderer: env.webglRenderer,
          longAnimationFrameCount: env.longAnimationFrameCount,
          shadowMapEnabled: env.shadowMapEnabled,
          effectivePixelRatio: env.effectivePixelRatio,
          gpuTimerSupported: env.gpuTimerSupported,
          gpuSamples: env.gpuFrameSampleCount,
          gpuP50: env.gpuFrameP50Ms,
          gpuP95: env.gpuFrameP95Ms,
          gpuMax: env.gpuFrameMaxMs,
        }
      : undefined,
    hud: result.hud,
  };
}

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

  await mkdir("docs/evidence", { recursive: true });
  const path = `docs/evidence/spike-flight-${label}.json`;
  await writeFile(
    path,
    JSON.stringify(
      {
        label,
        query,
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
  return { label, query, hud, dump, path, position };
}

test.describe("spike flight diagnostics", () => {
  test.setTimeout(360000);

  test("録画なし GPU A/B（baseline / shadowOFF / dpr1 / both）", async ({
    page,
  }) => {
    const baseline = await flyAndDump(page, "baseline");
    const shadowOff = await flyAndDump(
      page,
      "shadow-off",
      "?disableShadow=1",
    );
    const dpr1 = await flyAndDump(page, "dpr1", "?pixelRatio=1");
    const both = await flyAndDump(
      page,
      "shadow-off-dpr1",
      "?disableShadow=1&pixelRatio=1",
    );

    expect(baseline.dump.environment?.visibilityState).toBeTruthy();
    expect(baseline.dump.environment?.webglRenderer).toBeTruthy();
    expect(shadowOff.dump.environment?.shadowMapEnabled).toBe(false);
    expect(dpr1.dump.environment?.effectivePixelRatio).toBeLessThanOrEqual(1.01);
    expect(both.dump.environment?.shadowMapEnabled).toBe(false);
    expect(both.dump.environment?.effectivePixelRatio).toBeLessThanOrEqual(1.01);

    const summary = {
      note: "Origin Rebase は主因ではない前提。GPU/Compositor/解像度 A/B（録画なし）。",
      readingGuide: {
        "baseline only bad vs manual recording":
          "画面キャプチャ / Chrome Compositor が主因の可能性",
        "shadow-off improves": "Shadow GPU 負荷が主因の可能性",
        "dpr1 improves": "描画解像度・Fill Rate が主因の可能性",
        "only both improves": "GPU 総負荷が限界に近い可能性",
        "all unchanged": "Chrome/OS/ディスプレイ側、または別の GPU 同期を調査",
      },
      baseline: summarize(baseline),
      shadowOff: summarize(shadowOff),
      dpr1: summarize(dpr1),
      shadowOffDpr1: summarize(both),
    };

    await writeFile(
      "docs/evidence/spike-flight-summary.json",
      JSON.stringify(summary, null, 2),
    );
    console.log("[spike-flight-summary]", JSON.stringify(summary, null, 2));
  });
});
