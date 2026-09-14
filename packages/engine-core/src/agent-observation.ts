import {
  ObservationHub,
  createObservationManifest,
  getObservationScenario,
  hashScenarioDefinition,
  listObservationScenarios,
} from "../../runtime-telemetry/src/index";
import type {
  MachineTelemetrySample,
  TelemetryEvent,
} from "../../runtime-telemetry/src/index";
import type { ObservationApplication } from "../../runtime-telemetry/src/index";
import type { Vec3 } from "../../project-schema/src/index";

export interface AgentEventFilter {
  source?: string;
  name?: string;
  type?: string;
  frame?: number;
  limit?: number;
}

export interface AgentGameState {
  engine: {
    mode: string;
    frame: number;
  };
  machine: {
    id: string | null;
    position: [number, number, number] | null;
    simulationPosition: [number, number, number] | null;
    worldOrigin: [number, number, number] | null;
    rotation: [number, number, number, number] | null;
    velocity: [number, number, number] | null;
    speed: number | null;
    groundedWheelCount: number | null;
    controls: Record<string, number> | null;
  };
  camera: {
    position: [number, number, number] | null;
    target: [number, number, number] | null;
    followMode: string | null;
  };
  world: {
    currentChunk: string | null;
    loadedRenderChunks: number | null;
    loadedPhysicsChunks: number | null;
    readyQueues: { render: number; physics: number } | null;
    generationQueue: number | null;
    workerQueued: number | null;
    workerInFlight: number | null;
    cacheHitRate: number | null;
    rebaseCount: number | null;
  };
  renderer: {
    drawCalls: number | null;
    triangles: number | null;
    geometries: number | null;
    textures: number | null;
    gpuTimingMs: number | null;
  };
  frame: {
    rafMs: number | null;
    cpuWorkMs: number | null;
    physicsMs: number | null;
    renderMs: number | null;
    streamingRequestMs: number | null;
    streamingCommitMs: number | null;
  };
}

export interface MachineStudioAgentApi {
  version: 1;
  getState(): AgentGameState;
  getTelemetrySummary(): unknown;
  queryRecent(filter?: AgentEventFilter): unknown[];
  getEvents(): TelemetryEvent[];
  recordAssertion(
    assertion: string,
    expected: unknown,
    actual: unknown,
    passed: boolean,
  ): unknown;
  getRunInfo(): unknown;
  listScenarios(): unknown[];
  resetScenario(): Promise<void>;
  beginObservation(scenarioId?: string): unknown;
  endObservation(result?: "pass" | "fail" | "error"): unknown;
}

/** Engine との循環 import を避けるための観測ホスト契約。 */
export interface EngineObservationHost {
  mode: string;
  position: Vec3;
  observation?: ObservationHub;
  currentTelemetry: MachineTelemetrySample | undefined;
  recentSpikes: ReadonlyArray<{
    rafIntervalMs: number;
    cpuWorkMs: number;
    physicsStepMs: number;
    renderMs: number;
  }>;
  playFramePublic: number;
  worldRuntime?: {
    stats(current?: Vec3): {
      currentChunk: string;
      loadedRenderChunks: number;
      loadedPhysicsChunks: number;
      readyRenderCount: number;
      readyPhysicsCount: number;
      pendingQueueCount: number;
      workerQueued: number;
      workerInFlight: number;
      cacheHitRate: number;
      rebaseCount: number;
      streamingRequestMs: number;
      streamingCommitMs: number;
    };
  };
  renderer: {
    fastStats: Record<string, number>;
    useDampedCameraFollow: boolean;
    getMotionProbe?: () => {
      position: [number, number, number];
      target: [number, number, number];
    };
    diagnosticsEnvironment?: {
      recentGpuSamples?: Array<{ timeMs?: number }>;
    };
  };
  observationApp?: ObservationApplication;
  flushObservationDiagnostics?: () => void;
  respawnWithPhysicsReady(): Promise<void>;
}

export function shouldInstallAgentApi(
  search = typeof location !== "undefined" ? location.search : "",
  env: Record<string, string | undefined> = {},
) {
  const params = new URLSearchParams(search);
  if (params.get("agent") === "1" || params.get("observe") === "1") return true;
  if (env.MACHINE_STUDIO_AGENT === "1") return true;
  if (env.MODE === "test" || env.MODE === "development") return true;
  if (typeof import.meta !== "undefined") {
    const metaEnv = (
      import.meta as ImportMeta & { env?: Record<string, string> }
    ).env;
    if (metaEnv?.MODE === "development" || metaEnv?.MODE === "test")
      return true;
    if (metaEnv?.VITE_MACHINE_STUDIO_AGENT === "1") return true;
  }
  return false;
}

export function createAgentObservationApi(
  engine: EngineObservationHost,
  hub: ObservationHub,
  options: { app?: ObservationApplication } = {},
): MachineStudioAgentApi {
  return {
    version: 1,
    getState(): AgentGameState {
      const sample = engine.currentTelemetry;
      const world = engine.worldRuntime?.stats(engine.position);
      const render = engine.renderer.fastStats;
      const probe = engine.renderer.getMotionProbe?.();
      const gpu = engine.renderer.diagnosticsEnvironment?.recentGpuSamples;
      const lastGpu = gpu?.at(-1);
      return {
        engine: {
          mode: engine.mode,
          frame: engine.playFramePublic,
        },
        machine: {
          id: sample?.machineId ?? null,
          position: sample?.position ?? null,
          simulationPosition: sample?.simulationPosition ?? null,
          worldOrigin: sample?.worldOrigin ?? null,
          rotation: sample?.rotation ?? null,
          velocity: sample?.linearVelocityMps ?? null,
          speed: sample?.worldSpeedMps ?? null,
          groundedWheelCount: sample?.groundedWheelCount ?? null,
          controls: sample
            ? {
                throttle: sample.throttle,
                steering: sample.steering,
                ...(sample.controlChannels ?? {}),
              }
            : null,
        },
        camera: {
          position: probe?.position ?? null,
          target: probe?.target ?? null,
          followMode: engine.renderer.useDampedCameraFollow
            ? "damped"
            : "instant",
        },
        world: {
          currentChunk: world?.currentChunk ?? null,
          loadedRenderChunks: world?.loadedRenderChunks ?? null,
          loadedPhysicsChunks: world?.loadedPhysicsChunks ?? null,
          readyQueues: world
            ? {
                render: world.readyRenderCount,
                physics: world.readyPhysicsCount,
              }
            : null,
          generationQueue: world?.pendingQueueCount ?? null,
          workerQueued: world?.workerQueued ?? null,
          workerInFlight: world?.workerInFlight ?? null,
          cacheHitRate: world?.cacheHitRate ?? null,
          rebaseCount: world?.rebaseCount ?? null,
        },
        renderer: {
          drawCalls: render.drawCalls ?? null,
          triangles: render.triangles ?? null,
          geometries: render.geometries ?? null,
          textures: render.textures ?? null,
          gpuTimingMs: lastGpu?.timeMs ?? null,
        },
        frame: {
          rafMs: engine.recentSpikes.at(-1)?.rafIntervalMs ?? null,
          cpuWorkMs: engine.recentSpikes.at(-1)?.cpuWorkMs ?? null,
          physicsMs: engine.recentSpikes.at(-1)?.physicsStepMs ?? null,
          renderMs: engine.recentSpikes.at(-1)?.renderMs ?? null,
          streamingRequestMs: world?.streamingRequestMs ?? null,
          streamingCommitMs: world?.streamingCommitMs ?? null,
        },
      };
    },
    getTelemetrySummary() {
      const events = hub.allEvents();
      const spikes = events.filter(
        (event) => event.name === "diagnostic.frame.spike",
      );
      return {
        runId: hub.runId ?? null,
        eventCount: events.length,
        spikeCount: spikes.length,
        anomalyWindows: hub.allAnomalyWindows().length,
        current: engine.currentTelemetry ?? null,
      };
    },
    queryRecent(filter: AgentEventFilter = {}) {
      let events = hub.allEvents();
      if (filter.source)
        events = events.filter((event) => event.source === filter.source);
      if (filter.name)
        events = events.filter((event) => event.name === filter.name);
      if (filter.type)
        events = events.filter((event) => event.type === filter.type);
      if (filter.frame !== undefined)
        events = events.filter((event) => event.frame === filter.frame);
      if (filter.limit !== undefined) events = events.slice(-filter.limit);
      else events = events.slice(-200);
      return events;
    },
    getEvents() {
      return hub.allEvents();
    },
    recordAssertion(assertion, expected, actual, passed) {
      return hub.emitAssertion(assertion, expected, actual, passed);
    },
    getRunInfo() {
      return hub.runManifest ?? null;
    },
    listScenarios() {
      return listObservationScenarios();
    },
    async resetScenario() {
      await engine.respawnWithPhysicsReady();
    },
    beginObservation(scenarioId = "ad-hoc") {
      const scenario = getObservationScenario(scenarioId);
      const manifest = createObservationManifest({
        scenarioId,
        seed: scenario?.seed,
        scenarioDefinitionHash: scenario
          ? hashScenarioDefinition(scenario)
          : undefined,
        mode: "browser",
        app: options.app ?? engine.observationApp,
        browser:
          typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        viewport:
          typeof window !== "undefined"
            ? [window.innerWidth, window.innerHeight]
            : undefined,
        devicePixelRatio:
          typeof devicePixelRatio === "number" ? devicePixelRatio : undefined,
      });
      hub.beginRun(manifest);
      return manifest;
    },
    endObservation(result: "pass" | "fail" | "error" = "pass") {
      engine.flushObservationDiagnostics?.();
      hub.endRun(result);
      return hub.runManifest ?? null;
    },
  };
}

export function installAgentObservationApi(
  engine: EngineObservationHost,
  options: { app?: ObservationApplication } = {},
) {
  if (typeof window === "undefined") return undefined;
  if (!shouldInstallAgentApi()) return undefined;
  const hub = engine.observation ?? new ObservationHub({ capacity: 30000 });
  engine.observation = hub;
  const api = createAgentObservationApi(engine, hub, options);
  (
    window as unknown as { __MACHINE_STUDIO_AGENT__?: MachineStudioAgentApi }
  ).__MACHINE_STUDIO_AGENT__ = api;
  return api;
}
