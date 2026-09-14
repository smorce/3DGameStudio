/**
 * spike-flight-*.json をディスクから読み、summary を生成する。
 * メモリ上の計測結果は使わない（古い値の混入を防ぐ）。
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const SPIKE_FLIGHT_SUMMARY_CASES = {
  baseline: "spike-flight-baseline.json",
  shadowOff: "spike-flight-shadow-off.json",
  dpr1: "spike-flight-dpr1.json",
  shadowOffDpr1: "spike-flight-shadow-off-dpr1.json",
} as const;

export type SpikeFlightSummaryKey = keyof typeof SPIKE_FLIGHT_SUMMARY_CASES;

type SpikeDump = {
  spikeCount20ms?: number;
  spikeCount33ms?: number;
  spikeCount50ms?: number;
  earlySpikeCount20ms?: number;
  earlySpikeCount33ms?: number;
  earlySpikeCount50ms?: number;
  frameP50Ms?: number;
  frameP95Ms?: number;
  frameP99Ms?: number;
  frameMaxMs?: number;
  recentRebases?: unknown[];
  spikeWindows?: unknown[];
  environment?: Record<string, unknown>;
};

type EvidenceFile = {
  label?: string;
  query?: string;
  savedAt?: string;
  note?: string;
  hud?: string;
  position?: number[];
  dump?: SpikeDump;
};

function summarizeFromFile(
  relativePath: string,
  file: EvidenceFile,
) {
  const dump = file.dump ?? {};
  const env = dump.environment;
  return {
    path: relativePath,
    query: file.query ?? "",
    savedAt: file.savedAt,
    position: file.position,
    spikes: [
      dump.spikeCount20ms ?? 0,
      dump.spikeCount33ms ?? 0,
      dump.spikeCount50ms ?? 0,
    ],
    early: [
      dump.earlySpikeCount20ms ?? 0,
      dump.earlySpikeCount33ms ?? 0,
      dump.earlySpikeCount50ms ?? 0,
    ],
    p50: dump.frameP50Ms ?? 0,
    p95: dump.frameP95Ms ?? 0,
    p99: dump.frameP99Ms ?? 0,
    maxMs: dump.frameMaxMs ?? 0,
    rebaseEvents: Array.isArray(dump.recentRebases)
      ? dump.recentRebases.length
      : 0,
    spikeWindows: Array.isArray(dump.spikeWindows)
      ? dump.spikeWindows.length
      : 0,
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
    hud: file.hud,
  };
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** 4ケース分のファイル有無を調べる。 */
export async function listMissingSpikeFlightCases(
  evidenceDir = path.resolve("docs/evidence"),
) {
  const missing: string[] = [];
  for (const fileName of Object.values(SPIKE_FLIGHT_SUMMARY_CASES)) {
    if (!(await fileExists(path.join(evidenceDir, fileName)))) {
      missing.push(fileName);
    }
  }
  return missing;
}

/**
 * ディスク上の最新 4 JSON だけから summary オブジェクトを組み立てる。
 * 欠けている場合は missing を返し、summary は作らない。
 */
export async function buildSpikeFlightSummaryFromDisk(
  evidenceDir = path.resolve("docs/evidence"),
) {
  const missing = await listMissingSpikeFlightCases(evidenceDir);
  if (missing.length) {
    return { ok: false as const, missing, summary: undefined };
  }

  const cases: Record<string, ReturnType<typeof summarizeFromFile>> = {};
  const savedAts: string[] = [];
  for (const [key, fileName] of Object.entries(SPIKE_FLIGHT_SUMMARY_CASES)) {
    const absolutePath = path.join(evidenceDir, fileName);
    const relativePath = path
      .join("docs/evidence", fileName)
      .replace(/\\/g, "/");
    const raw = await readFile(absolutePath, "utf8");
    const file = JSON.parse(raw) as EvidenceFile;
    if (file.savedAt) savedAts.push(file.savedAt);
    cases[key] = summarizeFromFile(relativePath, file);
  }

  const summary = {
    note: "Origin Rebase は主因ではない前提。GPU/Compositor/解像度 A/B（録画なし）。ディスク上の最新4 JSON からのみ生成。",
    generatedAt: new Date().toISOString(),
    sourceSavedAts: savedAts,
    readingGuide: {
      "baseline only bad vs manual recording":
        "画面キャプチャ / Chrome Compositor が主因の可能性",
      "shadow-off improves": "Shadow GPU 負荷が主因の可能性",
      "dpr1 improves": "描画解像度・Fill Rate が主因の可能性",
      "only both improves": "GPU 総負荷が限界に近い可能性",
      "all unchanged": "Chrome/OS/ディスプレイ側、または別の GPU 同期を調査",
    },
    baseline: cases.baseline,
    shadowOff: cases.shadowOff,
    dpr1: cases.dpr1,
    shadowOffDpr1: cases.shadowOffDpr1,
  };

  return { ok: true as const, missing: [], summary };
}

/** 4ファイル揃っていれば summary をディスクへ書き出す。 */
export async function writeSpikeFlightSummaryFromDisk(
  evidenceDir = path.resolve("docs/evidence"),
) {
  await mkdir(evidenceDir, { recursive: true });
  const built = await buildSpikeFlightSummaryFromDisk(evidenceDir);
  if (!built.ok || !built.summary) {
    return {
      written: false as const,
      missing: built.missing,
      path: undefined,
      summary: undefined,
    };
  }
  const relativePath = "docs/evidence/spike-flight-summary.json";
  const absolutePath = path.join(evidenceDir, "spike-flight-summary.json");
  await writeFile(absolutePath, JSON.stringify(built.summary, null, 2));
  return {
    written: true as const,
    missing: [] as string[],
    path: relativePath,
    summary: built.summary,
  };
}
