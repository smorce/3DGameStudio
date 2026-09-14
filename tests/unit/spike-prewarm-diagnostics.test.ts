import { describe, expect, it } from "vitest";
import { DisjointGpuTimer } from "../../packages/renderer-three/src/gpu-timer";
import { SpikeDiagnostics } from "../../packages/engine-core/src/spike-diagnostics";

describe("GPU Timer 時刻付きサンプル", () => {
  it("未対応 GL でも snapshot が時刻配列を返す", () => {
    const timer = new DisjointGpuTimer(null);
    const snap = timer.snapshot();
    expect(snap.supported).toBe(false);
    expect(snap.recentSamples).toEqual([]);
    expect(snap.maxSample).toBeUndefined();
  });
});

describe("Spike FrameTrace の初スロットル字段", () => {
  it("thrustBecameActive と program 数を記録できる", () => {
    const diag = new SpikeDiagnostics();
    diag.recordFrame({
      timeMs: 1000,
      frame: 1,
      rafIntervalMs: 16.6,
      cpuWorkMs: 2,
      uiUpdateMs: 0.1,
      physicsStepMs: 1,
      renderMs: 1.2,
      renderCommitMs: 0,
      physicsCommitMs: 0,
      streamingRequestMs: 0,
      streamingCommitMs: 0,
      chunksCreated: 0,
      syncGenDelta: 0,
      rebaseCount: 0,
      rebaseThisFrame: false,
      rebaseTotalMs: 0,
      physicsRebaseMs: 0,
      rendererRebaseMs: 0,
      runtimeCommitRebaseMs: 0,
      telemetrySyncMs: 0,
      moveRigidBodiesMs: 0,
      moveStandaloneCollidersMs: 0,
      propagateCollidersMs: 0,
      ccdToggleMs: 0,
      rigidBodyCount: 1,
      colliderCount: 1,
      standaloneColliderCount: 0,
      chunkCount: 1,
      lodBatchCount: 0,
      workerQueued: 0,
      workerInFlight: 0,
      drawCalls: 10,
      triangles: 1000,
      positionZ: 0,
      thrustActive: false,
      thrustBecameActive: false,
      shaderProgramCount: 12,
      geometryCount: 40,
      textureCount: 8,
    });
    diag.recordFrame({
      timeMs: 1016,
      frame: 2,
      rafIntervalMs: 16.6,
      cpuWorkMs: 28,
      uiUpdateMs: 0.1,
      physicsStepMs: 1,
      renderMs: 27,
      renderCommitMs: 0,
      physicsCommitMs: 0,
      streamingRequestMs: 0,
      streamingCommitMs: 0,
      chunksCreated: 0,
      syncGenDelta: 0,
      rebaseCount: 0,
      rebaseThisFrame: false,
      rebaseTotalMs: 0,
      physicsRebaseMs: 0,
      rendererRebaseMs: 0,
      runtimeCommitRebaseMs: 0,
      telemetrySyncMs: 0,
      moveRigidBodiesMs: 0,
      moveStandaloneCollidersMs: 0,
      propagateCollidersMs: 0,
      ccdToggleMs: 0,
      rigidBodyCount: 1,
      colliderCount: 1,
      standaloneColliderCount: 0,
      chunkCount: 1,
      lodBatchCount: 0,
      workerQueued: 0,
      workerInFlight: 0,
      drawCalls: 14,
      triangles: 1200,
      positionZ: 0,
      thrustActive: true,
      thrustBecameActive: true,
      shaderProgramCount: 14,
      geometryCount: 42,
      textureCount: 8,
    });
    const frames = diag.recentFrames;
    expect(frames[1]?.thrustBecameActive).toBe(true);
    expect(frames[1]?.shaderProgramCount).toBe(14);
    expect(
      (frames[1]?.shaderProgramCount ?? 0) - (frames[0]?.shaderProgramCount ?? 0),
    ).toBe(2);
    expect(diag.dump({
      originRebaseEnabled: true,
      spikeCount20ms: 0,
      spikeCount33ms: 0,
      spikeCount50ms: 0,
      earlySpikeCount20ms: 0,
      earlySpikeCount33ms: 0,
      earlySpikeCount50ms: 0,
      frameP50Ms: 16,
      frameP95Ms: 16,
      frameP99Ms: 16,
      frameMaxMs: 16,
    }).firstThrustFrame?.thrustBecameActive).toBe(true);
  });
});
