import { RingBuffer } from "./ring-buffer";
import type {
  AnomalyWindow,
  ObservationRunManifest,
  TelemetryEvent,
  TelemetryEventSource,
  TelemetryEventType,
} from "./schema";

export const DEFAULT_OBSERVATION_EVENT_CAPACITY = 8000;
export const DEFAULT_ANOMALY_WINDOW_CAPACITY = 32;
export const DEFAULT_PRE_ANOMALY_MS = 500;
export const DEFAULT_POST_ANOMALY_MS = 500;

export interface ObservationHubOptions {
  capacity?: number;
  anomalyWindowCapacity?: number;
  spikeCandidateMs?: number;
  spikeDetailMs?: number;
  spikeHighMs?: number;
}

export interface EmitEventInput {
  name: string;
  source: TelemetryEventSource;
  type: TelemetryEventType;
  data?: Record<string, unknown>;
  timestampMs?: number;
  frame?: number;
  physicsStep?: number;
  entityId?: string;
  chunkKey?: string;
  correlationId?: string;
  scenarioId?: string;
}

/**
 * 共通観測ハブ。ホットパスでは Ring Buffer への push のみ行い、
 * 同期ファイル書き込みはしない。
 */
export class ObservationHub {
  readonly events: RingBuffer<TelemetryEvent>;
  readonly anomalyWindows: RingBuffer<AnomalyWindow>;
  private manifest: ObservationRunManifest | undefined;
  private readonly spikeCandidateMs: number;
  private readonly spikeDetailMs: number;
  private readonly spikeHighMs: number;
  private pendingPostCaptures: Array<{
    windowId: string;
    triggerTimestampMs: number;
    afterUntilMs: number;
    after: TelemetryEvent[];
    sealed: boolean;
  }> = [];
  private errorFingerprintCounts = new Map<string, number>();

  constructor(options: ObservationHubOptions = {}) {
    this.events = new RingBuffer(
      options.capacity ?? DEFAULT_OBSERVATION_EVENT_CAPACITY,
    );
    this.anomalyWindows = new RingBuffer(
      options.anomalyWindowCapacity ?? DEFAULT_ANOMALY_WINDOW_CAPACITY,
    );
    this.spikeCandidateMs = options.spikeCandidateMs ?? 20;
    this.spikeDetailMs = options.spikeDetailMs ?? 33.3;
    this.spikeHighMs = options.spikeHighMs ?? 50;
  }

  get runManifest() {
    return this.manifest;
  }

  get runId() {
    return this.manifest?.runId;
  }

  beginRun(manifest: ObservationRunManifest) {
    this.manifest = { ...manifest };
    this.events.clear();
    this.anomalyWindows.clear();
    this.pendingPostCaptures = [];
    this.errorFingerprintCounts.clear();
    this.emit({
      name: "engine.play.started",
      source: "engine",
      type: "event",
      data: { scenarioId: manifest.scenarioId },
      timestampMs: Date.parse(manifest.startedAt) || performance.now(),
    });
  }

  endRun(
    result: "pass" | "fail" | "error",
    completedAt = new Date().toISOString(),
  ) {
    if (!this.manifest) return;
    this.manifest = {
      ...this.manifest,
      completedAt,
      result,
      durationMs: (() => {
        const duration =
          Date.parse(completedAt) - Date.parse(this.manifest.startedAt);
        return Number.isFinite(duration) ? duration : undefined;
      })(),
    };
    this.emit({
      name: "engine.play.stopped",
      source: "engine",
      type: "event",
      data: { result },
      timestampMs: Date.parse(completedAt) || performance.now(),
    });
    this.sealPendingWindows(Number.POSITIVE_INFINITY);
  }

  emit(input: EmitEventInput): TelemetryEvent | undefined {
    if (!this.manifest) return undefined;
    const event: TelemetryEvent = {
      schemaVersion: 1,
      runId: this.manifest.runId,
      scenarioId: input.scenarioId ?? this.manifest.scenarioId,
      timestampMs: input.timestampMs ?? performance.now(),
      frame: input.frame,
      physicsStep: input.physicsStep,
      source: input.source,
      type: input.type,
      name: input.name,
      entityId: input.entityId,
      chunkKey: input.chunkKey,
      correlationId: input.correlationId,
      data: input.data ?? {},
    };
    this.events.push(event);
    this.capturePostAnomaly(event);
    this.maybeOpenAnomalyWindow(event);
    return event;
  }

  emitMetric(
    name: string,
    source: TelemetryEventSource,
    data: Record<string, unknown>,
    meta: Omit<EmitEventInput, "name" | "source" | "type" | "data"> = {},
  ) {
    return this.emit({ ...meta, name, source, type: "metric", data });
  }

  emitState(
    name: string,
    source: TelemetryEventSource,
    data: Record<string, unknown>,
    meta: Omit<EmitEventInput, "name" | "source" | "type" | "data"> = {},
  ) {
    return this.emit({ ...meta, name, source, type: "state", data });
  }

  emitAssertion(
    assertion: string,
    expected: unknown,
    actual: unknown,
    passed: boolean,
    meta: Omit<EmitEventInput, "name" | "source" | "type" | "data"> = {},
  ) {
    return this.emit({
      ...meta,
      name: passed ? "test.assertion.passed" : "test.assertion.failed",
      source: "test",
      type: "assertion",
      data: { assertion, expected, actual },
    });
  }

  /**
   * 同一エラーの大量重複を抑える。同じ fingerprint は最大回数まで記録。
   */
  emitError(
    name: string,
    fingerprint: string,
    data: Record<string, unknown>,
    maxDuplicates = 3,
  ) {
    const count = this.errorFingerprintCounts.get(fingerprint) ?? 0;
    if (count >= maxDuplicates) return undefined;
    this.errorFingerprintCounts.set(fingerprint, count + 1);
    return this.emit({
      name,
      source: "browser",
      type: "event",
      data: { ...data, fingerprint, duplicateIndex: count },
    });
  }

  recordFrameTiming(input: {
    frame: number;
    rafMs: number;
    physicsMs?: number;
    renderMs?: number;
    gpuMs?: number;
    streamingCommitMs?: number;
    timestampMs?: number;
  }) {
    const event = this.emitMetric(
      "renderer.frame",
      "renderer",
      {
        rafMs: input.rafMs,
        physicsMs: input.physicsMs ?? null,
        renderMs: input.renderMs ?? null,
        gpuMs: input.gpuMs ?? null,
        streamingCommitMs: input.streamingCommitMs ?? null,
      },
      { frame: input.frame, timestampMs: input.timestampMs },
    );
    if (!event) return;
    if (input.rafMs >= this.spikeCandidateMs) {
      this.emit({
        name: "diagnostic.frame.spike",
        source: "diagnostic",
        type: "event",
        frame: input.frame,
        timestampMs: event.timestampMs,
        correlationId: `spike-${input.frame}`,
        data: {
          rafMs: input.rafMs,
          physicsMs: input.physicsMs ?? null,
          renderMs: input.renderMs ?? null,
          gpuMs: input.gpuMs ?? null,
          streamingCommitMs: input.streamingCommitMs ?? null,
          severity:
            input.rafMs >= this.spikeHighMs
              ? "high"
              : input.rafMs >= this.spikeDetailMs
                ? "detail"
                : "candidate",
        },
      });
    }
  }

  allEvents() {
    return this.events.toArray();
  }

  allAnomalyWindows() {
    return this.anomalyWindows.toArray();
  }

  exportJsonLines(type?: TelemetryEventType) {
    const events = this.allEvents().filter((event) =>
      type ? event.type === type : true,
    );
    return events.map((event) => JSON.stringify(event)).join("\n");
  }

  private maybeOpenAnomalyWindow(event: TelemetryEvent) {
    if (event.name !== "diagnostic.frame.spike") return;
    const rafMs = Number(event.data.rafMs ?? 0);
    if (rafMs < this.spikeDetailMs) return;
    const before = this.eventsInRange(
      event.timestampMs - DEFAULT_PRE_ANOMALY_MS,
      event.timestampMs,
    ).filter((candidate) => candidate !== event);
    const windowId = `anomaly-${event.frame ?? event.timestampMs}`;
    this.pendingPostCaptures.push({
      windowId,
      triggerTimestampMs: event.timestampMs,
      afterUntilMs: event.timestampMs + DEFAULT_POST_ANOMALY_MS,
      after: [],
      sealed: false,
    });
    this.anomalyWindows.push({
      id: windowId,
      triggerName: event.name,
      triggerFrame: event.frame,
      triggerTimestampMs: event.timestampMs,
      before,
      trigger: event,
      after: [],
    });
  }

  private capturePostAnomaly(event: TelemetryEvent) {
    for (const pending of this.pendingPostCaptures) {
      if (pending.sealed) continue;
      if (event.timestampMs > pending.afterUntilMs) {
        pending.sealed = true;
        continue;
      }
      if (event.timestampMs > pending.triggerTimestampMs)
        pending.after.push(event);
    }
    this.sealPendingWindows(event.timestampMs);
  }

  private sealPendingWindows(nowMs: number) {
    const remaining: typeof this.pendingPostCaptures = [];
    for (const pending of this.pendingPostCaptures) {
      if (!pending.sealed && nowMs <= pending.afterUntilMs) {
        remaining.push(pending);
        continue;
      }
      const windows = this.anomalyWindows.toArray();
      const target = windows.find((window) => window.id === pending.windowId);
      if (target) target.after = [...pending.after];
    }
    this.pendingPostCaptures = remaining;
  }

  private eventsInRange(fromMs: number, toMs: number) {
    return this.allEvents().filter(
      (event) => event.timestampMs >= fromMs && event.timestampMs <= toMs,
    );
  }
}
