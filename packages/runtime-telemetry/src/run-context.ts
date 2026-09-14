import type {
  ObservationApplication,
  ObservationEnvironmentMode,
  ObservationRunManifest,
} from "./schema";

export function createRunId(prefix = "run") {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

/** 決定的な短いハッシュ（ブラウザ/Node両対応）。 */
export function hashScenarioDefinition(value: unknown) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createObservationManifest(input: {
  scenarioId: string;
  seed?: number;
  scenarioDefinitionHash?: string;
  mode?: ObservationEnvironmentMode;
  app?: ObservationApplication;
  browser?: string;
  viewport?: [number, number];
  devicePixelRatio?: number;
  runId?: string;
  startedAt?: string;
  gitCommit?: string;
  gitBranch?: string;
  workingTreeDirty?: boolean;
}): ObservationRunManifest {
  return {
    schemaVersion: 1,
    runId: input.runId ?? createRunId(input.scenarioId),
    scenarioId: input.scenarioId,
    startedAt: input.startedAt ?? new Date().toISOString(),
    gitCommit: input.gitCommit ?? "unknown",
    gitBranch: input.gitBranch ?? "unknown",
    workingTreeDirty: input.workingTreeDirty ?? false,
    seed: input.seed,
    scenarioDefinitionHash: input.scenarioDefinitionHash,
    environment: {
      mode: input.mode ?? "node",
      app: input.app,
      browser: input.browser,
      viewport: input.viewport,
      devicePixelRatio: input.devicePixelRatio,
    },
  };
}
