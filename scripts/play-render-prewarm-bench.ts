/**
 * PLAY 描画準備（preparePlayRendering）の多回 A/B ベンチ。
 * Cursor 内蔵ブラウザ（実GPU）向け。Vite :5183 が起動している前提。
 *
 * 記録:
 *   docs/evidence/play-render-prewarm-bench.json
 */
import { chromium, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.env.SPIKE_PROBE_BASE ?? "http://127.0.0.1:5183";
const RUNS = Number(process.env.PREWARM_BENCH_RUNS ?? "5");

type Machine = "plane" | "car" | "boat";

const MACHINE_BUTTON: Record<Machine, RegExp> = {
  plane: /ひこうき/,
  car: /くるま/,
  boat: /ボート/,
};

type TrialDump = {
  spikeCount20ms?: number;
  spikeCount33ms?: number;
  spikeCount50ms?: number;
  frameMaxMs?: number;
  maxRenderFrame?: { renderMs?: number; frame?: number; timeMs?: number };
  environment?: {
    playRenderPrewarmEnabled?: boolean;
    playRenderPrewarmMs?: number;
    playRenderPrewarmDeferredCount?: number;
    gpuFrameMaxMs?: number;
    gpuFrameMaxSample?: { gpuMs: number; frame: number; timeMs: number };
    webglRenderer?: string;
  };
};

type TrialResult = {
  machine: Machine;
  prewarm: boolean;
  run: number;
  spikes20: number;
  spikes33: number;
  maxRafMs: number;
  maxRenderMs: number;
  prewarmMs: number;
  deferredCount: number;
  gpuMaxMs: number;
  webgl?: string;
};

async function oneTrial(
  page: Page,
  machine: Machine,
  prewarm: boolean,
  run: number,
): Promise<TrialResult> {
  const query = prewarm ? "" : "?disablePlayRenderPrewarm=1";
  await page.goto(`${BASE}/${query}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: MACHINE_BUTTON[machine] }).click();
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  await page.getByRole("button", { name: "■ やめる", exact: true }).waitFor({
    state: "visible",
    timeout: 60000,
  });

  // 短時間 PLAY（初回フレーム Stall の有無が主目的）
  await page.waitForTimeout(400);
  await page.keyboard.down("w");
  await page.waitForTimeout(2500);
  await page.keyboard.up("w");

  const dump = (await page.evaluate(() => {
    const fn = (
      window as unknown as { __exportSpikeDiagnostics?: () => TrialDump }
    ).__exportSpikeDiagnostics;
    if (!fn) throw new Error("__exportSpikeDiagnostics is missing");
    return fn();
  })) as TrialDump;

  const result: TrialResult = {
    machine,
    prewarm,
    run,
    spikes20: dump.spikeCount20ms ?? 0,
    spikes33: dump.spikeCount33ms ?? 0,
    maxRafMs: dump.frameMaxMs ?? 0,
    maxRenderMs: dump.maxRenderFrame?.renderMs ?? 0,
    prewarmMs: dump.environment?.playRenderPrewarmMs ?? 0,
    deferredCount: dump.environment?.playRenderPrewarmDeferredCount ?? 0,
    gpuMaxMs: dump.environment?.gpuFrameMaxMs ?? 0,
    webgl: dump.environment?.webglRenderer,
  };
  console.log(
    JSON.stringify({
      ...result,
      prewarmEnabled: dump.environment?.playRenderPrewarmEnabled,
    }),
  );
  return result;
}

function summarize(trials: TrialResult[], machine: Machine, prewarm: boolean) {
  const subset = trials.filter(
    (t) => t.machine === machine && t.prewarm === prewarm,
  );
  const renders = subset.map((t) => t.maxRenderMs);
  const prewarmMs = subset.map((t) => t.prewarmMs);
  const spikes20 = subset.map((t) => t.spikes20);
  return {
    n: subset.length,
    spikes20AllZero: spikes20.every((n) => n === 0),
    spikes20Max: Math.max(0, ...spikes20),
    maxRenderMax: Math.max(0, ...renders),
    maxRenderAvg:
      renders.reduce((a, b) => a + b, 0) / Math.max(1, renders.length),
    prewarmMsMax: Math.max(0, ...prewarmMs),
    prewarmMsAvg:
      prewarmMs.reduce((a, b) => a + b, 0) / Math.max(1, prewarmMs.length),
    deferredCount: subset[0]?.deferredCount ?? 0,
  };
}

async function main() {
  // Cursor ブラウザ相当の実GPUは MCP 側で回す想定。ここは Playwright fallback。
  const browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: ["--ignore-gpu-blocklist", "--enable-webgl", "--use-gl=angle"],
  });
  const trials: TrialResult[] = [];
  try {
    for (const machine of ["plane", "car", "boat"] as Machine[]) {
      for (const prewarm of [false, true]) {
        for (let run = 1; run <= RUNS; run++) {
          const page = await browser.newPage();
          page.on("dialog", async (dialog) => {
            try {
              await dialog.accept();
            } catch {
              /* ignore */
            }
          });
          try {
            trials.push(await oneTrial(page, machine, prewarm, run));
          } finally {
            await page.close().catch(() => undefined);
          }
        }
      }
    }
  } finally {
    await browser.close();
  }

  const byMachine = Object.fromEntries(
    (["plane", "car", "boat"] as Machine[]).map((machine) => [
      machine,
      {
        off: summarize(trials, machine, false),
        on: summarize(trials, machine, true),
      },
    ]),
  );

  const report = {
    note: "preparePlayRendering 多回 A/B。off=disablePlayRenderPrewarm, on=Production既定",
    generatedAt: new Date().toISOString(),
    runsPerCell: RUNS,
    webgl: trials[0]?.webgl,
    byMachine,
    trials,
  };
  await mkdir("docs/evidence", { recursive: true });
  await writeFile(
    "docs/evidence/play-render-prewarm-bench.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(byMachine, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
