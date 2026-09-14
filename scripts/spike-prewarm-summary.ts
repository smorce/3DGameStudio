/**
 * spike-flight-prewarm-a/b.json を読み、初スロットルと Render Stall の対応を要約する。
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const SPIKE_PREWARM_CASES = {
  a: "spike-flight-prewarm-a.json",
  b: "spike-flight-prewarm-b.json",
} as const;

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

type GpuSample = { gpuMs: number; frame: number; timeMs: number };

type SpikeDump = {
  spikeCount20ms?: number;
  spikeCount33ms?: number;
  spikeCount50ms?: number;
  earlySpikeCount20ms?: number;
  earlySpikeCount33ms?: number;
  earlySpikeCount50ms?: number;
  frameP50Ms?: number;
  frameP95Ms?: number;
  frameMaxMs?: number;
  firstThrustFrame?: FrameTrace;
  maxRenderFrame?: FrameTrace;
  recentFrames?: FrameTrace[];
  spikeWindows?: {
    centerTimeMs: number;
    spikeRafIntervalMs: number;
    earlySpike?: boolean;
    frames: FrameTrace[];
  }[];
  environment?: {
    longAnimationFrameCount?: number;
    recentLongAnimationFrames?: { durationMs: number; startTime: number }[];
    shaderPrewarmEnabled?: boolean;
    shaderPrewarmMs?: number;
    shaderPrewarmDeferredCount?: number;
    gpuFrameMaxMs?: number;
    gpuFrameMaxSample?: GpuSample;
    recentGpuSamples?: GpuSample[];
    webglRenderer?: string;
  };
};

type EvidenceFile = {
  label?: string;
  query?: string;
  savedAt?: string;
  note?: string;
  dump?: SpikeDump;
};

function nearestGpu(
  samples: GpuSample[] | undefined,
  timeMs: number,
  windowMs = 80,
) {
  if (!samples?.length) return undefined;
  let best: GpuSample | undefined;
  let bestDelta = Infinity;
  for (const sample of samples) {
    const delta = Math.abs(sample.timeMs - timeMs);
    if (delta < bestDelta) {
      best = sample;
      bestDelta = delta;
    }
  }
  if (!best || bestDelta > windowMs) return undefined;
  return { ...best, deltaMs: bestDelta };
}

function analyzeCase(relativePath: string, file: EvidenceFile) {
  const dump = file.dump ?? {};
  const frames = dump.recentFrames ?? [];
  const firstThrust =
    dump.firstThrustFrame ??
    frames.find((frame) => frame.thrustBecameActive);
  const firstThrustIndex = firstThrust
    ? frames.findIndex(
        (frame) =>
          frame.timeMs === firstThrust.timeMs &&
          frame.frame === firstThrust.frame,
      )
    : -1;
  const beforeThrust =
    firstThrustIndex > 0 ? frames[firstThrustIndex - 1] : undefined;
  const afterThrust =
    firstThrustIndex >= 0 && firstThrustIndex + 1 < frames.length
      ? frames[firstThrustIndex + 1]
      : undefined;

  const heavyRenders = [
    ...frames.filter((frame) => frame.renderMs > 20),
    ...(dump.maxRenderFrame && dump.maxRenderFrame.renderMs > 20
      ? [dump.maxRenderFrame]
      : []),
  ]
    // 同一 frame の重複を除く
    .filter(
      (frame, index, all) =>
        all.findIndex(
          (other) =>
            other.timeMs === frame.timeMs && other.frame === frame.frame,
        ) === index,
    )
    .map((frame) => ({
      timeMs: frame.timeMs,
      frame: frame.frame,
      renderMs: frame.renderMs,
      rafIntervalMs: frame.rafIntervalMs,
      thrustBecameActive: Boolean(frame.thrustBecameActive),
      thrustActive: Boolean(frame.thrustActive),
      shaderProgramCount: frame.shaderProgramCount,
      geometryCount: frame.geometryCount,
      textureCount: frame.textureCount,
      positionZ: frame.positionZ,
      nearestGpu: nearestGpu(dump.environment?.recentGpuSamples, frame.timeMs),
    }));

  const programDelta =
    firstThrust && beforeThrust
      ? (firstThrust.shaderProgramCount ?? 0) -
        (beforeThrust.shaderProgramCount ?? 0)
      : undefined;
  const geometryDelta =
    firstThrust && beforeThrust
      ? (firstThrust.geometryCount ?? 0) - (beforeThrust.geometryCount ?? 0)
      : undefined;
  const textureDelta =
    firstThrust && beforeThrust
      ? (firstThrust.textureCount ?? 0) - (beforeThrust.textureCount ?? 0)
      : undefined;

  return {
    path: relativePath,
    query: file.query ?? "",
    savedAt: file.savedAt,
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
    maxMs: dump.frameMaxMs ?? 0,
    longAnimationFrameCount: dump.environment?.longAnimationFrameCount ?? 0,
    shaderPrewarmEnabled: Boolean(dump.environment?.shaderPrewarmEnabled),
    shaderPrewarmMs: dump.environment?.shaderPrewarmMs ?? 0,
    shaderPrewarmDeferredCount:
      dump.environment?.shaderPrewarmDeferredCount ?? 0,
    webglRenderer: dump.environment?.webglRenderer,
    gpuMax: dump.environment?.gpuFrameMaxMs ?? 0,
    gpuMaxSample: dump.environment?.gpuFrameMaxSample,
    maxRenderFrame: dump.maxRenderFrame
      ? {
          timeMs: dump.maxRenderFrame.timeMs,
          frame: dump.maxRenderFrame.frame,
          renderMs: dump.maxRenderFrame.renderMs,
          rafIntervalMs: dump.maxRenderFrame.rafIntervalMs,
          thrustBecameActive: Boolean(dump.maxRenderFrame.thrustBecameActive),
          thrustActive: Boolean(dump.maxRenderFrame.thrustActive),
          shaderProgramCount: dump.maxRenderFrame.shaderProgramCount,
          geometryCount: dump.maxRenderFrame.geometryCount,
          textureCount: dump.maxRenderFrame.textureCount,
          positionZ: dump.maxRenderFrame.positionZ,
          nearestGpu: nearestGpu(
            dump.environment?.recentGpuSamples,
            dump.maxRenderFrame.timeMs,
          ),
        }
      : null,
    firstThrust: firstThrust
      ? {
          timeMs: firstThrust.timeMs,
          frame: firstThrust.frame,
          renderMs: firstThrust.renderMs,
          cpuWorkMs: firstThrust.cpuWorkMs,
          rafIntervalMs: firstThrust.rafIntervalMs,
          physicsStepMs: firstThrust.physicsStepMs,
          positionZ: firstThrust.positionZ,
          shaderProgramCount: firstThrust.shaderProgramCount,
          geometryCount: firstThrust.geometryCount,
          textureCount: firstThrust.textureCount,
          programDelta,
          geometryDelta,
          textureDelta,
          nearestGpu: nearestGpu(
            dump.environment?.recentGpuSamples,
            firstThrust.timeMs,
          ),
          previousRenderMs: beforeThrust?.renderMs,
          nextRafIntervalMs: afterThrust?.rafIntervalMs,
        }
      : null,
    heavyRenders,
    spikeWindows: (dump.spikeWindows ?? []).map((window) => {
      const peak = [...window.frames].sort(
        (a, b) => b.renderMs - a.renderMs,
      )[0];
      return {
        centerTimeMs: window.centerTimeMs,
        spikeRafIntervalMs: window.spikeRafIntervalMs,
        earlySpike: window.earlySpike,
        peakRenderMs: peak?.renderMs ?? 0,
        peakThrustBecameActive: Boolean(peak?.thrustBecameActive),
        peakThrustActive: Boolean(peak?.thrustActive),
        peakProgramCount: peak?.shaderProgramCount,
        nearestGpu: nearestGpu(
          dump.environment?.recentGpuSamples,
          window.centerTimeMs,
        ),
      };
    }),
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

export async function writeSpikePrewarmSummaryFromDisk(
  evidenceDir = path.resolve("docs/evidence"),
) {
  const missing: string[] = [];
  const loaded: Record<string, ReturnType<typeof analyzeCase>> = {};
  for (const [key, fileName] of Object.entries(SPIKE_PREWARM_CASES)) {
    const full = path.join(evidenceDir, fileName);
    if (!(await fileExists(full))) {
      missing.push(fileName);
      continue;
    }
    const file = JSON.parse(await readFile(full, "utf8")) as EvidenceFile;
    loaded[key] = analyzeCase(path.join("docs/evidence", fileName), file);
  }
  if (missing.length) {
    return { written: false as const, missing, summary: undefined };
  }

  const a = loaded.a!;
  const b = loaded.b!;
  const verdict = (() => {
    const aHeavy = a.heavyRenders.length;
    const bHeavy = b.heavyRenders.length;
    const aMaxRender = a.maxRenderFrame?.renderMs ?? 0;
    const bMaxRender = b.maxRenderFrame?.renderMs ?? 0;
    const aFirstRender = a.firstThrust?.renderMs ?? Infinity;
    const bFirstRender = b.firstThrust?.renderMs ?? Infinity;
    if (a.spikes[0] > 0 && b.spikes.every((n) => n === 0) && bMaxRender < 15)
      return "prewarm removed early RAF spikes and kept PLAY render under 15ms — first-use WebGL init is likely";
    if (aHeavy > 0 && bHeavy === 0)
      return "prewarm eliminated >20ms render stalls — first-use WebGL init is likely";
    if (aFirstRender > 15 && bFirstRender < 5)
      return "first-throttle render cost dropped after prewarm — shader/buffer first-use likely";
    if (aMaxRender > 20 && bMaxRender < 15 && b.shaderPrewarmEnabled)
      return "max PLAY render dropped after prewarm — cost moved to prewarmMs";
    if (aHeavy > 0 && bHeavy > 0)
      return "prewarm did not remove render stalls — investigate buffer upload / driver sync beyond compileAsync";
    return "inconclusive — compare firstThrust and heavyRenders manually";
  })();

  const summary = {
    note: "Thruster初スロットル / Shader Prewarm A/B。ディスク上の prewarm-a/b からのみ生成。",
    generatedAt: new Date().toISOString(),
    verdict,
    a,
    b,
  };

  await mkdir(evidenceDir, { recursive: true });
  const outPath = path.join(evidenceDir, "spike-prewarm-summary.json");
  await writeFile(outPath, JSON.stringify(summary, null, 2));
  return { written: true as const, missing: [], summary, outPath };
}
