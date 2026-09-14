import { expect, it } from "vitest";
import {
  ObservationHub,
  buildRunSummary,
  compareRunSummaries,
  createObservationManifest,
  createRunId,
  explainRun,
  hashScenarioDefinition,
  listObservationScenarios,
  parseJsonlEvents,
  queryEvents,
  type TelemetryEvent,
} from "../../packages/runtime-telemetry/src/index";

it("Run Context は runId と schemaVersion を持つ", () => {
  const manifest = createObservationManifest({
    scenarioId: "starter-plane-straight",
    seed: 42,
    scenarioDefinitionHash: hashScenarioDefinition({ id: "x" }),
  });
  expect(manifest.schemaVersion).toBe(1);
  expect(manifest.runId).toContain("starter-plane-straight");
  expect(createRunId("demo")).toMatch(/^demo-/);
});

it("ObservationHub は Event を Ring Buffer に蓄積し JSONL 出力できる", () => {
  const hub = new ObservationHub({ capacity: 4 });
  hub.beginRun(
    createObservationManifest({ scenarioId: "starter-plane-straight" }),
  );
  hub.recordFrameTiming({ frame: 1, rafMs: 16 });
  hub.recordFrameTiming({ frame: 2, rafMs: 40 });
  const lines = hub.exportJsonLines("metric");
  const events = parseJsonlEvents(lines);
  expect(events.length).toBeGreaterThanOrEqual(1);
  expect(events.every((event) => event.schemaVersion === 1)).toBe(true);
  expect(
    hub.allEvents().some((event) => event.name === "diagnostic.frame.spike"),
  ).toBe(true);
});

it("query は source/name/frame と前後 Window で絞り込める", () => {
  const events: TelemetryEvent[] = [
    {
      schemaVersion: 1,
      runId: "r1",
      timestampMs: 1000,
      source: "world",
      type: "event",
      name: "world.chunk.committed",
      data: {},
    },
    {
      schemaVersion: 1,
      runId: "r1",
      timestampMs: 1500,
      frame: 10,
      source: "diagnostic",
      type: "event",
      name: "diagnostic.frame.spike",
      data: { rafMs: 48 },
    },
    {
      schemaVersion: 1,
      runId: "r1",
      timestampMs: 1700,
      source: "physics",
      type: "metric",
      name: "renderer.frame",
      data: { rafMs: 18 },
    },
  ];
  expect(queryEvents(events, { source: "world" })).toHaveLength(1);
  expect(queryEvents(events, { frame: 10 })[0]?.name).toBe(
    "diagnostic.frame.spike",
  );
  const windowed = queryEvents(events, {
    name: "diagnostic.frame.spike",
    beforeMs: 600,
    afterMs: 300,
  });
  expect(windowed.map((event) => event.name)).toEqual([
    "world.chunk.committed",
    "diagnostic.frame.spike",
    "renderer.frame",
  ]);
});

it("summary / compare / explain が決定的に動く", () => {
  const events: TelemetryEvent[] = [
    {
      schemaVersion: 1,
      runId: "before",
      timestampMs: 1,
      source: "renderer",
      type: "metric",
      name: "renderer.frame",
      data: { rafMs: 16, physicsMs: 2, renderMs: 4, streamingCommitMs: 1 },
    },
    {
      schemaVersion: 1,
      runId: "before",
      timestampMs: 2,
      frame: 9,
      source: "diagnostic",
      type: "event",
      name: "diagnostic.frame.spike",
      data: {
        rafMs: 45,
        physicsMs: 3,
        renderMs: 5,
        streamingCommitMs: 30,
      },
    },
  ];
  const summary = buildRunSummary({
    runId: "before",
    scenarioId: "starter-plane-turn-left",
    result: "pass",
    durationMs: 1000,
    events,
  });
  expect(summary.spikes.over33Ms).toBeGreaterThanOrEqual(0);
  expect(summary.frame.sampleCount).toBe(1);
  const after = {
    ...summary,
    runId: "after",
    frame: { ...summary.frame, p95Ms: 10 },
  };
  const comparison = compareRunSummaries(summary, after);
  expect(comparison.sameScenario).toBe(true);
  expect(comparison.deltas["frame.p95Ms"]?.improved).toBe(true);
  const explained = explainRun({ runId: "before", events });
  expect(explained.suspects[0]?.name).toBe("world.streaming.commit");
});

it("Compare はScenarioと実行環境の不一致を拒否する", () => {
  const summary = buildRunSummary({
    runId: "before",
    scenarioId: "starter-plane-straight",
    result: "pass",
    durationMs: 100,
    events: [],
  });
  const beforeManifest = createObservationManifest({
    scenarioId: "starter-plane-straight",
    seed: 42,
    scenarioDefinitionHash: hashScenarioDefinition({
      id: "starter-plane-straight",
      seed: 42,
    }),
    mode: "browser",
    app: "studio",
    viewport: [1280, 720],
    devicePixelRatio: 1,
  });
  const afterManifest = {
    ...beforeManifest,
    runId: "after",
    seed: 7,
    environment: {
      ...beforeManifest.environment,
      viewport: [1440, 900] as [number, number],
    },
  };
  const after = { ...summary, runId: "after" };
  const comparison = compareRunSummaries(summary, after, {
    beforeManifest,
    afterManifest,
  });
  expect(comparison.sameScenario).toBe(false);
  expect(comparison.deltas).toEqual({});
  expect(comparison.warnings).toEqual(
    expect.arrayContaining([
      expect.stringContaining("seed"),
      expect.stringContaining("environment.viewport"),
    ]),
  );
  expect(
    compareRunSummaries(summary, after, {
      beforeManifest,
      afterManifest,
      force: true,
    }).deltas["frame.p50Ms"],
  ).toBeDefined();
});

it("scenario registry に11件が揃っている", () => {
  const scenarios = listObservationScenarios();
  expect(scenarios).toHaveLength(11);
  expect(scenarios.map((scenario) => scenario.id).sort()).toEqual(
    [
      "camera-follow-turn",
      "origin-rebase-200m",
      "origin-rebase-flight",
      "starter-plane-straight",
      "starter-plane-takeoff",
      "starter-plane-turn-left",
      "starter-plane-turn-right",
      "terrain-entry",
      "world-streaming-fast-flight",
      "world-streaming-forward",
      "world-streaming-turn",
    ].sort(),
  );
});
