import { afterEach, expect, it, vi } from "vitest";
import {
  createProceduralWorld,
  type GeneratorInput,
} from "../../packages/world-generator/src/index";
import { WorldRuntime } from "../../packages/world-system/src/runtime";
import {
  handlePrepareRequest,
  type PrepareChunkRequest,
  type WorkerOutbound,
} from "../../packages/world-generator/src/worker";

// postMessageの構造化コピーとFIFOを再現し、Worker専用contextの更新を検証する。
class TestWorker {
  static instances: TestWorker[] = [];
  onmessage?: (event: { data: WorkerOutbound }) => void;
  onerror?: () => void;
  design?: GeneratorInput["design"];
  messages: { type: string; hash?: string }[] = [];
  terminated = false;
  constructor() {
    TestWorker.instances.push(this);
  }
  postMessage(
    message:
      | PrepareChunkRequest
      | {
          type: "generation-context";
          hash: string;
          design?: GeneratorInput["design"];
        },
  ) {
    const copy = structuredClone(message);
    this.messages.push(copy);
    queueMicrotask(() => {
      if (this.terminated) return;
      if (copy.type === "generation-context") {
        this.design = copy.design;
        return;
      }
      this.onmessage?.({
        data: handlePrepareRequest({
          ...copy,
          input: { ...copy.input, design: this.design },
        }),
      });
    });
  }
  terminate() {
    this.terminated = true;
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  TestWorker.instances = [];
});

it.each([false, true])(
  "同じDesign参照を編集してreloadすると地形・道路cacheが更新される forceSync=%s",
  async (forceSyncWorkers) => {
    vi.stubGlobal("Worker", TestWorker);
    const world = createProceduralWorld({ preset: "toy-islands" });
    if (world.source.kind !== "procedural" || !world.source.design)
      throw new Error("Missing design");
    const design = world.source.design;
    const runtime = new WorldRuntime(world, {
      forceSyncWorkers,
      workerCount: 2,
    });
    try {
      const generate = async (key = "-14,-11") => {
        runtime.requestChunk(key, "P2_VISIBLE_RENDER");
        await vi.waitFor(() =>
          expect(runtime.peekPreparedChunk(key)).toBeDefined(),
        );
        return runtime.peekPreparedChunk(key)!;
      };
      const before = await generate();
      await generate("-13,-11");
      const sampledBefore = runtime.sampleHeight(-430, -352);
      const road = design.roads[0];
      road.width = 28;
      road.controlPoints.forEach((point) => {
        point[1] += 15;
      });
      runtime.reload(world);
      expect(world.source.design).toBe(design);
      const after = await generate();
      expect([...after.heights]).not.toEqual([...before.heights]);
      expect(runtime.sampleHeight(-430, -352)).not.toBe(sampledBefore);
      expect(runtime.debugDesignAt(-430, -352)).toBeDefined();
      if (!forceSyncWorkers) {
        for (const worker of TestWorker.instances) {
          const contexts = worker.messages.filter(
            (m) => m.type === "generation-context",
          );
          expect(contexts).toHaveLength(2);
          expect(contexts[0].hash).not.toBe(contexts[1].hash);
        }
      }
      runtime.reload(world);
      expect([...(await generate()).heights]).toEqual([...after.heights]);
      if (!forceSyncWorkers) {
        expect(
          TestWorker.instances.every(
            (w) =>
              w.messages.filter((m) => m.type === "generation-context")
                .length === 2,
          ),
        ).toBe(true);
        world.source.generatorVersion++;
        runtime.reload(world);
        expect(
          TestWorker.instances.every(
            (w) =>
              w.messages.filter((m) => m.type === "generation-context")
                .length === 3,
          ),
        ).toBe(true);
      }
    } finally {
      runtime.dispose();
    }
  },
);

it("reload直前のWorker応答が新generationの同一Chunkを上書きしない", async () => {
  vi.stubGlobal("Worker", TestWorker);
  const world = createProceduralWorld({ preset: "toy-islands" });
  if (world.source.kind !== "procedural" || !world.source.design)
    throw new Error("Missing design");
  const runtime = new WorldRuntime(world, {
    forceSyncWorkers: false,
    workerCount: 1,
  });
  try {
    runtime.requestChunk("-14,-11", "P2_VISIBLE_RENDER");
    world.source.design.roads[0].controlPoints.forEach((point) => {
      point[1] += 20;
    });
    runtime.reload(world);
    runtime.requestChunk("-14,-11", "P2_VISIBLE_RENDER");
    await vi.waitFor(() =>
      expect(runtime.peekPreparedChunk("-14,-11")).toBeDefined(),
    );
    const expected = handlePrepareRequest({
      type: "prepare-chunk",
      jobId: 99,
      runtimeGeneration: 1,
      chunkKey: "-14,-11",
      input: { ...world.source, chunkX: -14, chunkZ: -11 },
    });
    expect([...runtime.peekPreparedChunk("-14,-11")!.heights]).toEqual([
      ...expected.prepared.heights,
    ]);
    expect(runtime.stats().workerInFlight).toBe(0);
  } finally {
    runtime.dispose();
  }
});
