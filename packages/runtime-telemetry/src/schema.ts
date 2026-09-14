/** Observation / Telemetry 共通スキーマ（schemaVersion: 1）。 */

export type ObservationEnvironmentMode = "browser" | "node";
export type ObservationApplication = "studio" | "player";

export type TelemetryEventSource =
  | "engine"
  | "physics"
  | "renderer"
  | "world"
  | "camera"
  | "input"
  | "browser"
  | "test"
  | "diagnostic";

export type TelemetryEventType = "event" | "metric" | "state" | "assertion";

export interface ObservationRunManifest {
  schemaVersion: 1;
  runId: string;
  scenarioId: string;
  startedAt: string;
  completedAt?: string;
  gitCommit: string;
  gitBranch: string;
  workingTreeDirty: boolean;
  seed?: number;
  scenarioDefinitionHash?: string;
  environment: {
    mode: ObservationEnvironmentMode;
    app?: ObservationApplication;
    browser?: string;
    viewport?: [number, number];
    devicePixelRatio?: number;
  };
  result?: "pass" | "fail" | "error";
  durationMs?: number;
}

export interface TelemetryEvent {
  schemaVersion: 1;
  runId: string;
  scenarioId?: string;
  timestampMs: number;
  frame?: number;
  physicsStep?: number;
  source: TelemetryEventSource;
  type: TelemetryEventType;
  name: string;
  entityId?: string;
  chunkKey?: string;
  correlationId?: string;
  data: Record<string, unknown>;
}

export interface AnomalyWindow {
  id: string;
  triggerName: string;
  triggerFrame?: number;
  triggerTimestampMs: number;
  before: TelemetryEvent[];
  trigger: TelemetryEvent;
  after: TelemetryEvent[];
}

export interface ObservationRunSummary {
  schemaVersion: 1;
  runId: string;
  scenario: string;
  result: "pass" | "fail" | "error";
  durationMs: number;
  frame: {
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
    maxMs: number | null;
    sampleCount: number;
  };
  spikes: {
    over20Ms: number;
    over33Ms: number;
    over50Ms: number;
  };
  physics: {
    p50Ms: number | null;
    p95Ms: number | null;
    maxMs: number | null;
  };
  render: {
    p50Ms: number | null;
    p95Ms: number | null;
    maxMs: number | null;
  };
  gpu: {
    p50Ms: number | null;
    p95Ms: number | null;
    maxMs: number | null;
  };
  streaming: {
    maxWorkerQueue: number | null;
    maxCommitMs: number | null;
    syncFallback: number | null;
  };
  rebase: {
    count: number;
  };
  drawCalls: {
    max: number | null;
  };
  triangles: {
    max: number | null;
  };
  assertions: {
    passed: number;
    failed: number;
  };
  notableEvents: string[];
  metrics: Record<string, number | null>;
}

export interface ObservationCompareResult {
  schemaVersion: 1;
  beforeRunId: string;
  afterRunId: string;
  scenarioId: string;
  sameScenario: boolean;
  deltas: Record<
    string,
    {
      before: number | null;
      after: number | null;
      delta: number | null;
      improved: boolean | null;
    }
  >;
  assertion: {
    before: "pass" | "fail" | "error";
    after: "pass" | "fail" | "error";
  };
  warnings: string[];
}

export interface ObservationExplainSuspect {
  name: string;
  confidence: number;
  evidence: Record<string, unknown>;
}

export interface ObservationExplainResult {
  schemaVersion: 1;
  runId: string;
  suspects: ObservationExplainSuspect[];
}
