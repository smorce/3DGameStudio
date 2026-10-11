import { expect, it } from "vitest";
import {
  createAgentObservationApi,
  type EngineObservationHost,
} from "../../packages/engine-core/src/agent-observation";
import { ObservationHub } from "../../packages/runtime-telemetry/src/index";

it("現在フレームの時間を返し、過去のSpikeを中央値用のサンプルに混ぜない", () => {
  const host = {
    mode: "PLAY",
    respawnWithPhysicsReady: async () => {},
    position: [0, 0, 0],
    currentTelemetry: undefined,
    playFramePublic: 100,
    latestFrameTiming: {
      rafIntervalMs: 16.7,
      cpuWorkMs: 5,
      physicsStepMs: 2,
      renderMs: 3,
    },
    recentSpikes: [
      { rafIntervalMs: 900, cpuWorkMs: 600, physicsStepMs: 400, renderMs: 200 },
    ],
    renderer: { fastStats: {}, useDampedCameraFollow: false },
  } as EngineObservationHost;
  const api = createAgentObservationApi(host, new ObservationHub());
  expect(api.getState().frame).toMatchObject({
    rafMs: 16.7,
    cpuWorkMs: 5,
    physicsMs: 2,
    renderMs: 3,
  });
  host.latestFrameTiming = {
    rafIntervalMs: 20,
    cpuWorkMs: 7,
    physicsStepMs: 3,
    renderMs: 4,
  };
  expect(api.getState().frame.rafMs).toBe(20);
  delete host.latestFrameTiming;
  expect(api.getState().frame.rafMs).toBeNull();
});
