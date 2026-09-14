import type {
  ObservationCompareResult,
  ObservationExplainResult,
  ObservationRunSummary,
  TelemetryEvent,
} from "./schema";

const percentile = (sorted: number[], ratio: number): number | null => {
  if (sorted.length === 0) return null;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );
  return sorted[index]!;
};

const numbersFrom = (
  events: readonly TelemetryEvent[],
  name: string,
  field: string,
) =>
  events
    .filter((event) => event.name === name)
    .map((event) => Number(event.data[field]))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

const maxOf = (values: number[]) =>
  values.length ? Math.max(...values) : null;

const timingStats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: maxOf(sorted),
    sampleCount: sorted.length,
  };
};

export function buildRunSummary(input: {
  runId: string;
  scenarioId: string;
  result: "pass" | "fail" | "error";
  durationMs: number;
  events: readonly TelemetryEvent[];
  extraMetrics?: Record<string, number | null>;
}): ObservationRunSummary {
  const { events } = input;
  const raf = numbersFrom(events, "renderer.frame", "rafMs");
  const physics = numbersFrom(events, "renderer.frame", "physicsMs");
  const render = numbersFrom(events, "renderer.frame", "renderMs");
  const gpu = numbersFrom(events, "renderer.frame", "gpuMs");
  const commit = numbersFrom(events, "renderer.frame", "streamingCommitMs");
  const workerQueues = numbersFrom(
    events,
    "world.streaming.stats",
    "workerQueued",
  );
  const syncFallback = numbersFrom(
    events,
    "world.streaming.stats",
    "syncFallback",
  );
  const drawCalls = numbersFrom(
    events,
    "renderer.resource.changed",
    "drawCalls",
  );
  const triangles = numbersFrom(
    events,
    "renderer.resource.changed",
    "triangles",
  );
  const frame = timingStats(raf);
  const spikes = {
    over20Ms: raf.filter((value) => value > 20).length,
    over33Ms: raf.filter((value) => value > 33.3).length,
    over50Ms: raf.filter((value) => value > 50).length,
  };
  const assertionPassed = events.filter(
    (event) => event.name === "test.assertion.passed",
  ).length;
  const assertionFailed = events.filter(
    (event) => event.name === "test.assertion.failed",
  ).length;
  const notable = [
    ...new Set(
      events
        .filter((event) =>
          [
            "diagnostic.frame.spike",
            "world.origin.rebase.completed",
            "world.chunk.committed",
            "test.assertion.failed",
            "engine.respawn",
          ].includes(event.name),
        )
        .map((event) => event.name),
    ),
  ];
  const rebaseCount = events.filter(
    (event) => event.name === "world.origin.rebase.completed",
  ).length;

  return {
    schemaVersion: 1,
    runId: input.runId,
    scenario: input.scenarioId,
    result: input.result,
    durationMs: input.durationMs,
    frame: {
      p50Ms: frame.p50Ms,
      p95Ms: frame.p95Ms,
      p99Ms: frame.p99Ms,
      maxMs: frame.maxMs,
      sampleCount: frame.sampleCount,
    },
    spikes,
    physics: {
      p50Ms: percentile(
        [...physics].sort((a, b) => a - b),
        0.5,
      ),
      p95Ms: percentile(
        [...physics].sort((a, b) => a - b),
        0.95,
      ),
      maxMs: maxOf(physics),
    },
    render: {
      p50Ms: percentile(
        [...render].sort((a, b) => a - b),
        0.5,
      ),
      p95Ms: percentile(
        [...render].sort((a, b) => a - b),
        0.95,
      ),
      maxMs: maxOf(render),
    },
    gpu: {
      p50Ms: percentile(
        [...gpu].sort((a, b) => a - b),
        0.5,
      ),
      p95Ms: percentile(
        [...gpu].sort((a, b) => a - b),
        0.95,
      ),
      maxMs: maxOf(gpu),
    },
    streaming: {
      maxWorkerQueue: maxOf(workerQueues),
      maxCommitMs: maxOf(commit),
      syncFallback: maxOf(syncFallback),
    },
    rebase: { count: rebaseCount },
    drawCalls: { max: maxOf(drawCalls) },
    triangles: { max: maxOf(triangles) },
    assertions: { passed: assertionPassed, failed: assertionFailed },
    notableEvents: notable,
    metrics: input.extraMetrics ?? {},
  };
}

export function compareRunSummaries(
  before: ObservationRunSummary,
  after: ObservationRunSummary,
  options: { force?: boolean } = {},
): ObservationCompareResult {
  const warnings: string[] = [];
  const sameScenario = before.scenario === after.scenario;
  if (!sameScenario && !options.force)
    warnings.push(
      `Scenario mismatch: ${before.scenario} vs ${after.scenario}. Use --force to compare anyway.`,
    );
  if (!sameScenario && !options.force) {
    return {
      schemaVersion: 1,
      beforeRunId: before.runId,
      afterRunId: after.runId,
      scenarioId: before.scenario,
      sameScenario: false,
      deltas: {},
      assertion: { before: before.result, after: after.result },
      warnings,
    };
  }

  const lowerIsBetter = (key: string) =>
    !key.includes("pass") && !key.includes("assertions.passed");

  const pair = (
    key: string,
    beforeValue: number | null,
    afterValue: number | null,
  ) => {
    const delta =
      beforeValue === null || afterValue === null
        ? null
        : afterValue - beforeValue;
    const improved =
      delta === null ? null : lowerIsBetter(key) ? delta < 0 : delta > 0;
    return { before: beforeValue, after: afterValue, delta, improved };
  };

  return {
    schemaVersion: 1,
    beforeRunId: before.runId,
    afterRunId: after.runId,
    scenarioId: after.scenario,
    sameScenario,
    deltas: {
      "frame.p50Ms": pair("frame.p50Ms", before.frame.p50Ms, after.frame.p50Ms),
      "frame.p95Ms": pair("frame.p95Ms", before.frame.p95Ms, after.frame.p95Ms),
      "frame.p99Ms": pair("frame.p99Ms", before.frame.p99Ms, after.frame.p99Ms),
      "frame.maxMs": pair("frame.maxMs", before.frame.maxMs, after.frame.maxMs),
      "spikes.over20Ms": pair(
        "spikes.over20Ms",
        before.spikes.over20Ms,
        after.spikes.over20Ms,
      ),
      "spikes.over33Ms": pair(
        "spikes.over33Ms",
        before.spikes.over33Ms,
        after.spikes.over33Ms,
      ),
      "spikes.over50Ms": pair(
        "spikes.over50Ms",
        before.spikes.over50Ms,
        after.spikes.over50Ms,
      ),
      "physics.maxMs": pair(
        "physics.maxMs",
        before.physics.maxMs,
        after.physics.maxMs,
      ),
      "render.maxMs": pair(
        "render.maxMs",
        before.render.maxMs,
        after.render.maxMs,
      ),
      "gpu.maxMs": pair("gpu.maxMs", before.gpu.maxMs, after.gpu.maxMs),
      "streaming.maxCommitMs": pair(
        "streaming.maxCommitMs",
        before.streaming.maxCommitMs,
        after.streaming.maxCommitMs,
      ),
      "streaming.maxWorkerQueue": pair(
        "streaming.maxWorkerQueue",
        before.streaming.maxWorkerQueue,
        after.streaming.maxWorkerQueue,
      ),
      "streaming.syncFallback": pair(
        "streaming.syncFallback",
        before.streaming.syncFallback,
        after.streaming.syncFallback,
      ),
      "drawCalls.max": pair(
        "drawCalls.max",
        before.drawCalls.max,
        after.drawCalls.max,
      ),
      "triangles.max": pair(
        "triangles.max",
        before.triangles.max,
        after.triangles.max,
      ),
      "rebase.count": pair(
        "rebase.count",
        before.rebase.count,
        after.rebase.count,
      ),
      "assertions.failed": pair(
        "assertions.failed",
        before.assertions.failed,
        after.assertions.failed,
      ),
    },
    assertion: { before: before.result, after: after.result },
    warnings,
  };
}

export function explainRun(input: {
  runId: string;
  events: readonly TelemetryEvent[];
}): ObservationExplainResult {
  const spikes = input.events.filter(
    (event) => event.name === "diagnostic.frame.spike",
  );
  const suspects: ObservationExplainResult["suspects"] = [];

  for (const spike of spikes.slice(-5)) {
    const rafMs = Number(spike.data.rafMs ?? 0);
    const streamingCommitMs = Number(spike.data.streamingCommitMs ?? 0);
    const renderMs = Number(spike.data.renderMs ?? 0);
    const physicsMs = Number(spike.data.physicsMs ?? 0);
    const parts = [
      { name: "world.streaming.commit", value: streamingCommitMs },
      { name: "renderer.render", value: renderMs },
      { name: "physics.step", value: physicsMs },
    ].sort((a, b) => b.value - a.value);
    const top = parts[0];
    if (!top || top.value <= 0) continue;
    const confidence = Math.min(
      0.99,
      0.4 + (top.value / Math.max(rafMs, 1)) * 0.6,
    );
    suspects.push({
      name: top.name,
      confidence: Number(confidence.toFixed(2)),
      evidence: {
        frame: spike.frame ?? null,
        rafMs,
        streamingCommitMs,
        renderMs,
        physicsMs,
      },
    });
  }

  const rebaseNearSpike = input.events.some(
    (event) =>
      event.name === "world.origin.rebase.completed" &&
      spikes.some(
        (spike) => Math.abs(spike.timestampMs - event.timestampMs) < 100,
      ),
  );
  if (rebaseNearSpike)
    suspects.unshift({
      name: "world.origin.rebase",
      confidence: 0.85,
      evidence: { note: "rebase completed near frame spike" },
    });

  const failed = input.events.filter(
    (event) => event.name === "test.assertion.failed",
  );
  for (const assertion of failed.slice(0, 3)) {
    suspects.push({
      name: "test.assertion",
      confidence: 0.95,
      evidence: assertion.data,
    });
  }

  suspects.sort((a, b) => b.confidence - a.confidence);
  return {
    schemaVersion: 1,
    runId: input.runId,
    suspects: suspects.slice(0, 8),
  };
}
