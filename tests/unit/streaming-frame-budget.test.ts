import { describe, expect, it } from "vitest";
import {
  PrefetchDirectionState,
  visibleChunks,
  visibleChunksWithPrefetch,
} from "../../packages/world-system/src/chunks";
import { ChunkStreamer } from "../../packages/world-system/src/streaming";
import { WorldRuntime } from "../../packages/world-system/src/runtime";
import { createStarterWorld } from "../../packages/world-system/src/index";
import { chunkKey } from "../../packages/world-generator/src/index";

describe("streaming frame budget", () => {
  it("境界で必要 Chunk が増えても 1 update の create は予算内", () => {
    const created: string[] = [];
    const streamer = new ChunkStreamer(
      (key) => {
        created.push(key);
        return key;
      },
      () => {},
      32,
      6,
      7,
      { maxCreatesPerUpdate: 2, budgetMs: 50, urgentRadius: 0 },
    );
    streamer.update([0, 0, 50]);
    created.length = 0;
    streamer.update([0, 0, 70]);
    expect(created.length).toBeLessThanOrEqual(2);
    expect(streamer.stats.pending).toBeGreaterThan(0);
    streamer.dispose();
  });

  it("Physics urgent 半径内は必ず loaded になる", () => {
    const streamer = new ChunkStreamer(
      (key) => key,
      () => {},
      32,
      3,
      4,
      { maxCreatesPerUpdate: 1, budgetMs: 1, urgentRadius: 1 },
    );
    streamer.update([0, 0, 0]);
    for (const key of visibleChunks([0, 0, 0], 32, 1))
      expect(streamer.loaded.has(key)).toBe(true);
    expect(streamer.stats.urgentCreated).toBeGreaterThanOrEqual(9);
    streamer.dispose();
  });

  it("先読み方向は微小ノイズで振動しない", () => {
    const direction = new PrefetchDirectionState();
    const base = visibleChunksWithPrefetch([0, 0, 0], 32, 2, [0, 0, 40], {
      direction,
      aheadMax: 4,
    });
    const noisy = visibleChunksWithPrefetch([0, 0, 0], 32, 2, [3, 0, 40], {
      direction,
      aheadMax: 4,
    });
    expect([...noisy].sort().join("|")).toBe([...base].sort().join("|"));
    const turned = visibleChunksWithPrefetch([0, 0, 0], 32, 2, [40, 0, 0], {
      direction,
      aheadMax: 4,
    });
    expect([...turned].sort().join("|")).not.toBe([...base].sort().join("|"));
  });

  it("acquire は同期一括生成せず prefetch queue に積む", () => {
    const runtime = new WorldRuntime(
      createStarterWorld({ preset: "airfield" }),
      { forceSyncWorkers: true },
    );
    const keys = Array.from({ length: 13 }, (_, i) => chunkKey(0, i));
    runtime.acquire("renderer", keys);
    expect(runtime.stats().cachedChunks).toBe(0);
    expect(runtime.stats().pendingQueueCount).toBeGreaterThanOrEqual(13);
    const built = runtime.pumpGeneration(50, 2);
    expect(built).toBe(2);
    expect(runtime.stats().cachedChunks).toBe(2);
    expect(runtime.stats().prefetchGenerationCount).toBe(2);
    expect(runtime.stats().syncFallbackCount).toBe(0);
    runtime.ensureChunks([keys[0]]);
    expect(runtime.stats().syncFallbackCount).toBe(0);
    // 非 PLAY の getChunk は意図的 sync であり fallback ではない。
    runtime.getChunk(keys[5]);
    expect(runtime.stats().syncGenerationCount).toBeGreaterThanOrEqual(1);
    expect(runtime.stats().syncFallbackCount).toBe(0);
    runtime.setPlayHotPath(true);
    runtime.getChunk(chunkKey(9, 9));
    expect(runtime.stats().syncFallbackCount).toBe(1);
    runtime.dispose();
  });

  it("Z=50→80 と Z=305→335 で 1 frame に 13 create しない", () => {
    const run = (fromZ: number, toZ: number) => {
      const created: number[] = [];
      const streamer = new ChunkStreamer(
        (key) => key,
        () => {},
        32,
        6,
        7,
        { maxCreatesPerUpdate: 2, budgetMs: 50, urgentRadius: 0 },
      );
      streamer.update([0, 0, fromZ]);
      for (let z = fromZ; z <= toZ; z += 1) {
        const before = streamer.loaded.size;
        const stats = streamer.update([0, 0, z], [0, 0, 30]);
        created.push(stats.created);
        expect(streamer.loaded.size).toBeGreaterThanOrEqual(before);
      }
      streamer.dispose();
      return Math.max(...created);
    };
    expect(run(50, 80)).toBeLessThanOrEqual(2);
    expect(run(305, 335)).toBeLessThanOrEqual(2);
  });

  it("create が undefined のとき予算を消費せず Ready 済みを優先する", () => {
    const ready = new Set(["0,0"]);
    const created: string[] = [];
    const streamer = new ChunkStreamer(
      (key) => {
        if (!ready.has(key)) return undefined;
        created.push(key);
        return key;
      },
      () => {},
      32,
      1,
      2,
      { maxCreatesPerUpdate: 2, budgetMs: 50, urgentRadius: 0 },
    );
    // 半径1で 9 Chunk が active。先頭が未準備でも Ready 済みを作れる。
    const stats = streamer.update([0, 0, 0]);
    expect(created).toEqual(["0,0"]);
    expect(stats.created).toBe(1);
    expect(streamer.pending.has("1,0") || streamer.pending.size > 0).toBe(true);
    expect(streamer.loaded.has("0,0")).toBe(true);
    streamer.dispose();
  });
});
