import { describe, expect, it } from "vitest";
import {
  FrameProfiler,
  SpikeDiagnostics,
} from "../../packages/engine-core/src/index";
import {
  prepareChunk,
  preparedChunkTransferList,
} from "../../packages/world-generator/src/prepare";
import { generateChunk } from "../../packages/world-generator/src/index";
import {
  ChunkWorkerPool,
  commitWithinBudget,
  higherPriority,
} from "../../packages/world-system/src/chunk-worker-pool";
import {
  PrefetchRetentionState,
  visibleChunksWithPrefetch,
} from "../../packages/world-system/src/chunks";
import { WorldRuntime } from "../../packages/world-system/src/runtime";
import { createStarterWorld } from "../../packages/world-system/src/index";
import { chunkKey } from "../../packages/world-generator/src/index";

const sampleInput = {
  seed: 42,
  generatorVersion: 1,
  preset: "airfield" as const,
  chunkX: 0,
  chunkZ: 1,
  chunkSize: 32,
  chunkResolution: 33,
};

describe("async streaming foundations", () => {
  it("FrameProfiler が p50/p95 と over 閾値を集計する", () => {
    const profiler = new FrameProfiler(100);
    for (let i = 0; i < 100; i++) profiler.record(10 + (i % 5));
    profiler.record(40);
    const snap = profiler.snapshot(40);
    expect(snap.sampleCount).toBe(100);
    expect(snap.p50Ms).toBeGreaterThan(0);
    expect(snap.over33_3).toBeGreaterThanOrEqual(1);
    expect(snap.maxMs).toBeGreaterThanOrEqual(40);
  });

  it("SpikeDiagnostics がスパイク前後フレームを JSON dump に残す", () => {
    const diagnostics = new SpikeDiagnostics();
    const base = {
      cpuWorkMs: 1,
      uiUpdateMs: 0,
      physicsStepMs: 1,
      renderMs: 1,
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
      rigidBodyCount: 2,
      colliderCount: 4,
      standaloneColliderCount: 1,
      chunkCount: 8,
      lodBatchCount: 3,
      workerQueued: 0,
      workerInFlight: 0,
      drawCalls: 10,
      triangles: 100,
      positionZ: 10,
      frame: 0,
      thrustActive: false,
      thrustBecameActive: false,
      shaderProgramCount: 8,
      geometryCount: 20,
      textureCount: 4,
    };
    for (let i = 0; i < 5; i++) {
      diagnostics.recordFrame({
        ...base,
        timeMs: i * 16.7,
        rafIntervalMs: 16.7,
        positionZ: i,
      });
    }
    diagnostics.recordFrame({
      ...base,
      timeMs: 100,
      rafIntervalMs: 48,
      rebaseThisFrame: true,
      rebaseTotalMs: 12,
      physicsRebaseMs: 10,
      rebaseCount: 1,
      positionZ: 185,
    });
    diagnostics.noteSpike(48);
    for (let i = 0; i < 3; i++) {
      diagnostics.recordFrame({
        ...base,
        timeMs: 116 + i * 16.7,
        rafIntervalMs: 16.7,
        rebaseCount: 1,
        positionZ: 190 + i,
      });
    }
    const dump = diagnostics.dump({
      originRebaseEnabled: true,
      spikeCount20ms: 1,
      spikeCount33ms: 1,
      spikeCount50ms: 0,
      earlySpikeCount20ms: 0,
      earlySpikeCount33ms: 0,
      earlySpikeCount50ms: 0,
      frameP50Ms: 16.7,
      frameP95Ms: 16.8,
      frameP99Ms: 48,
      frameMaxMs: 48,
    });
    expect(dump.spikeWindows.length).toBe(1);
    expect(dump.spikeWindows[0]?.spikeRafIntervalMs).toBe(48);
    expect(dump.spikeWindows[0]?.frames.some((f) => f.rebaseThisFrame)).toBe(
      true,
    );
    expect(dump.spikeWindows[0]?.frames.length).toBeGreaterThanOrEqual(4);
    // environment は Engine.exportSpikeDiagnostics 側で付与する。
    expect(dump.environment).toBeUndefined();
  });

  it("prepareChunk は sync generateChunk と heights/entities が一致する", () => {
    const generated = generateChunk(sampleInput);
    const prepared = prepareChunk(sampleInput);
    expect([...prepared.heights]).toEqual([...generated.heights]);
    expect(prepared.entities.map((e) => e.id)).toEqual(
      generated.entities.map((e) => e.id),
    );
    expect(prepared.entities.map((e) => e.position)).toEqual(
      generated.entities.map((e) => e.position),
    );
    expect(prepared.entities.map((e) => e.rotation)).toEqual(
      generated.entities.map((e) => e.rotation),
    );
    expect(prepared.entities.map((e) => e.scale)).toEqual(
      generated.entities.map((e) => e.scale),
    );
    expect(prepared.indices.length).toBe(
      (sampleInput.chunkResolution - 1) ** 2 * 6,
    );
  });

  it("Prepared data は finite で normal 長が異常でない", () => {
    const prepared = prepareChunk(sampleInput);
    expect(prepared.positions.length).toBe(33 * 33 * 3);
    expect(prepared.normals.length).toBe(prepared.positions.length);
    expect(prepared.colors.length).toBe(prepared.positions.length);
    for (let i = 0; i < prepared.positions.length; i++) {
      expect(Number.isFinite(prepared.positions[i])).toBe(true);
      expect(Number.isFinite(prepared.normals[i])).toBe(true);
      expect(Number.isFinite(prepared.colors[i])).toBe(true);
    }
    for (let i = 0; i < prepared.normals.length; i += 3) {
      const len = Math.hypot(
        prepared.normals[i],
        prepared.normals[i + 1],
        prepared.normals[i + 2],
      );
      expect(len).toBeGreaterThan(0.5);
      expect(len).toBeLessThan(1.5);
    }
    const maxIndex = prepared.positions.length / 3;
    for (const index of prepared.indices) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(maxIndex);
    }
  });

  it("Transfer list は underlying buffer を列挙する", () => {
    const prepared = prepareChunk(sampleInput);
    const list = preparedChunkTransferList(prepared);
    expect(list).toContain(prepared.heights.buffer);
    expect(list).toContain(prepared.positions.buffer);
    expect(list).toContain(prepared.normals.buffer);
    expect(list).toContain(prepared.colors.buffer);
    expect(list).toContain(prepared.indices.buffer);
  });

  it("Fake Clock の commit budget は 2 Chunk で止め 3 個目を残す", () => {
    let now = 0;
    const items = ["a", "b", "c", "d"];
    const committed: string[] = [];
    const count = commitWithinBudget(items, {
      now: () => now,
      budgetMs: 2,
      maxItems: 10,
      commitCostMs: 0.8,
      commit: (item) => {
        committed.push(item);
        now += 0.8;
      },
    });
    expect(count).toBe(2);
    expect(committed).toEqual(["a", "b"]);
    expect(items).toEqual(["c", "d"]);
  });

  it("Priority 昇格はより高い方を残す", () => {
    expect(higherPriority("P3_RENDER_PREFETCH", "P0_PHYSICS_CRITICAL")).toBe(
      "P0_PHYSICS_CRITICAL",
    );
    expect(higherPriority("P2_VISIBLE_RENDER", "P4_EDITOR")).toBe(
      "P2_VISIBLE_RENDER",
    );
  });

  it("Worker Pool は同一 Chunk を dedupe する", async () => {
    const pool = new ChunkWorkerPool({ forceSync: true, workerCount: 1 });
    const input = { ...sampleInput, chunkX: 2, chunkZ: 2 };
    const key = chunkKey(2, 2);
    const a = pool.enqueue({
      chunkKey: key,
      input,
      priority: "P3_RENDER_PREFETCH",
      runtimeGeneration: 1,
    });
    const b = pool.enqueue({
      chunkKey: key,
      input,
      priority: "P0_PHYSICS_CRITICAL",
      runtimeGeneration: 1,
    });
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra?.prepared.key).toBe(key);
    expect(rb?.prepared.key).toBe(key);
    expect(pool.stats.completed).toBe(1);
    pool.dispose();
  });

  it("sampleHeight は cache miss で Full Chunk を作らない", () => {
    const runtime = new WorldRuntime(
      createStarterWorld({ preset: "airfield" }),
      { forceSyncWorkers: true },
    );
    runtime.setPlayHotPath(true);
    const before = runtime.stats().cachedChunks;
    const height = runtime.sampleHeight(100, 100);
    expect(Number.isFinite(height)).toBe(true);
    expect(runtime.stats().cachedChunks).toBe(before);
    expect(runtime.stats().syncGenerationFallbackCount).toBe(0);
    runtime.dispose();
  });

  it("PLAY hot path の getChunk miss は sync fallback を数え Ready Request する", () => {
    const runtime = new WorldRuntime(
      createStarterWorld({ preset: "airfield" }),
      { forceSyncWorkers: true },
    );
    runtime.setPlayHotPath(true);
    const miss = runtime.getChunk(chunkKey(5, 5));
    expect(miss).toBeUndefined();
    expect(runtime.stats().syncGenerationFallbackCount).toBe(1);
    runtime.dispose();
  });

  it("Ready Commit は maxChunks を超えて無制限に処理しない", () => {
    const runtime = new WorldRuntime(
      createStarterWorld({ preset: "airfield" }),
      { forceSyncWorkers: true },
    );
    for (let i = 0; i < 8; i++) {
      const key = chunkKey(0, i);
      runtime.requestChunk(key, "P2_VISIBLE_RENDER");
    }
    // sync pool は即 ready になる
    const committed = runtime.commitGeneralWithinBudget({
      budgetMs: 50,
      maxChunks: 2,
      now: (() => {
        let t = 0;
        return () => t++;
      })(),
    });
    expect(committed.length).toBeLessThanOrEqual(2);
    runtime.dispose();
  });

  it("prepareChunk は terrainEdit を heights/positions に反映する", () => {
    const base = prepareChunk(sampleInput);
    const edited = prepareChunk({
      ...sampleInput,
      terrainEdit: {
        heightDeltas: { "0": 5 },
        colors: { "0": "#ff0000" },
      },
    });
    expect(edited.heights[0]).toBeCloseTo(base.heights[0] + 5);
    expect(edited.positions[1]).toBeCloseTo(base.positions[1] + 5);
    expect(edited.colorHex[0]).toBe("#ff0000");
    expect(edited.colors[0]).toBeCloseTo(1);
  });

  it("Ready Queue は Request Priority に従って Physics/Render を分離する", async () => {
    const runtime = new WorldRuntime(
      createStarterWorld({ preset: "airfield" }),
      { forceSyncWorkers: true },
    );
    const physicsKey = chunkKey(3, 0);
    const renderKey = chunkKey(3, 1);
    runtime.requestChunk(physicsKey, "P0_PHYSICS_CRITICAL");
    runtime.requestChunk(renderKey, "P2_VISIBLE_RENDER");
    await Promise.resolve();
    const physicsReady = runtime.commitPhysicsCriticalReady({
      budgetMs: 50,
      maxChunks: 8,
    });
    expect(physicsReady.map((c) => c.key)).toContain(physicsKey);
    expect(physicsReady.map((c) => c.key)).not.toContain(renderKey);
    const renderReady = runtime.commitGeneralWithinBudget({
      budgetMs: 50,
      maxChunks: 8,
    });
    expect(renderReady.map((c) => c.key)).toContain(renderKey);
    expect(renderReady.map((c) => c.key)).not.toContain(physicsKey);
    runtime.dispose();
  });

  it("境界往復でも Retention が効いて領域が急減しない", () => {
    const retention = new PrefetchRetentionState();
    const a = visibleChunksWithPrefetch([31.9, 0, 0], 32, 1, [20, 0, 0], {
      retention,
      retentionSec: 1,
      futureHorizonsSec: [0.5],
    });
    const b = visibleChunksWithPrefetch([32.1, 0, 0], 32, 1, [-20, 0, 0], {
      retention,
      retentionSec: 1,
      futureHorizonsSec: [0.5],
    });
    const intersection = [...a].filter((key) => b.has(key));
    expect(intersection.length).toBeGreaterThan(0);
    expect(b.size).toBeGreaterThanOrEqual(a.size - 2);
  });

  it("stale generation の結果は discard される", async () => {
    const runtime = new WorldRuntime(
      createStarterWorld({ preset: "airfield" }),
      { forceSyncWorkers: true },
    );
    runtime.requestChunk(chunkKey(1, 1), "P2_VISIBLE_RENDER");
    runtime.reload(createStarterWorld({ preset: "airfield" }));
    await new Promise((r) => setTimeout(r, 0));
    // reload 後は旧 Ready を commit しない
    expect(runtime.peekPreparedChunk(chunkKey(1, 1))).toBeUndefined();
    runtime.dispose();
  });
});
