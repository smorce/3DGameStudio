import { afterEach, expect, it, vi } from "vitest";
import {
  biomeSurfaceCatalog,
  biomeSurfaceColor,
  biomeSurfaceProfilesV1,
} from "../../packages/world-generator/src/biome-surface";
import { generateChunk } from "../../packages/world-generator/src/index";
import { buildIslandProxies } from "../../packages/world-generator/src/far-proxy";
import { sampleWorldCatalog } from "../../packages/sample-worlds/src/builders";
import { WorldRuntime } from "../../packages/world-system/src/runtime";
import { FarWorldProxy } from "../../packages/renderer-three/src/far-proxy";
import {
  handlePrepareRequest,
  type PrepareChunkRequest,
} from "../../packages/world-generator/src/worker";
import type { WorldDesign } from "../../packages/project-schema/src/index";

// 将来版を模擬し、v1の見た目が最新版追加後も変わらないことを確かめる。
function installFutureProfile() {
  Object.defineProperty(biomeSurfaceCatalog, 2, {
    configurable: true,
    value: Object.fromEntries(
      Object.entries(biomeSurfaceProfilesV1).map(([key, p]) => [
        key,
        {
          ...p,
          underwaterColor: "#123456",
          shoreColor: "#123456",
          lowlandColors: ["#123456"],
          highlandColor: "#123456",
          rockColor: "#123456",
          snowColor: "#123456",
        },
      ]),
    ),
  });
}
afterEach(() => {
  Reflect.deleteProperty(biomeSurfaceCatalog, 2);
  vi.unstubAllGlobals();
});
const descriptor = sampleWorldCatalog.find((w) => w.id === "snow-island")!;
it("近景・遠景は指定版を使い、旧データはv1、未対応版は明示的に拒否する", () => {
  const source = descriptor.buildProject().world.source;
  if (source.kind !== "procedural" || !source.design)
    throw new Error("Missing design");
  const input = { ...source, chunkX: -2, chunkZ: -2 };
  const before = generateChunk(input);
  const farBefore = buildIslandProxies(source.design, source.seed);
  installFutureProfile();
  expect(generateChunk({ ...input, biomeProfileVersion: 1 })).toEqual(before);
  expect(generateChunk(input)).toEqual(before);
  expect(buildIslandProxies(source.design, source.seed, 32, 1)).toEqual(
    farBefore,
  );
  expect(generateChunk({ ...input, biomeProfileVersion: 2 }).colors).toContain(
    "#123456",
  );
  expect(
    buildIslandProxies(source.design, source.seed, 32, 2)[0].colors.every(
      (c) => c === "#123456",
    ),
  ).toBe(true);
  expect(() => generateChunk({ ...input, biomeProfileVersion: 999 })).toThrow(
    "Unsupported biome profile version: 999",
  );
  expect(() =>
    buildIslandProxies(source.design!, source.seed, 32, 999),
  ).toThrow(/Unsupported biome profile/);
  expect(() => biomeSurfaceColor("snow", 5, 0, 0, 0, 42, 999)).toThrow(
    /Unsupported biome profile/,
  );
});

it.each([true, false])(
  "Manifest→Runtime→生成入力を接続し版変更でcacheを更新する sync=%s",
  async (forceSyncWorkers) => {
    installFutureProfile();
    const messages: unknown[] = [];
    class WorkerMock {
      onmessage?: (event: { data: unknown }) => void;
      design?: WorldDesign;
      postMessage(
        message:
          | PrepareChunkRequest
          | { type: "generation-context"; design?: WorldDesign },
      ) {
        const copy = structuredClone(message);
        messages.push(copy);
        queueMicrotask(() => {
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
      terminate() {}
    }
    vi.stubGlobal("Worker", WorkerMock);
    const project = descriptor.buildProject();
    // Runtime入力の契約だけを検証するため、実PreparedのManifestを使う。
    const { readFileSync } = await import("node:fs");
    project.world.buildManifest = JSON.parse(
      readFileSync("demos/worlds/snow-island.json", "utf8"),
    ).world.buildManifest;
    const runtime = new WorldRuntime(project.world, {
      forceSyncWorkers,
      workerCount: 1,
    });
    const generate = async () => {
      runtime.requestChunk("-2,-2", "P2_VISIBLE_RENDER");
      await vi.waitFor(() =>
        expect(runtime.peekPreparedChunk("-2,-2")).toBeDefined(),
      );
      return runtime.getChunk("-2,-2")!;
    };
    try {
      const v1 = await generate();
      project.world.buildManifest!.biomeProfileVersion = 2;
      runtime.reload(project.world);
      const v2 = await generate();
      expect(v2.colors).toContain("#123456");
      expect(v2.colors).not.toEqual(v1.colors);
      project.world.buildManifest!.biomeProfileVersion = 1;
      runtime.reload(project.world);
      expect((await generate()).colors).toEqual(v1.colors);
      if (!forceSyncWorkers) {
        const requests = messages.filter(
          (m): m is PrepareChunkRequest =>
            (m as { type: string }).type === "prepare-chunk",
        );
        expect(requests.map((m) => m.input.biomeProfileVersion)).toEqual([
          1, 2, 1,
        ]);
      }
    } finally {
      runtime.dispose();
    }
  },
);
it("Far ProxyのWorker要求にもManifestの版を渡す", async () => {
  const requests: { biomeProfileVersion: number }[] = [];
  vi.stubGlobal(
    "Worker",
    class {
      postMessage(m: { biomeProfileVersion: number }) {
        requests.push(m);
      }
      terminate() {}
    },
  );
  const { readFileSync } = await import("node:fs");
  const project = JSON.parse(
    readFileSync("demos/worlds/snow-island.json", "utf8"),
  );
  project.world.buildManifest.biomeProfileVersion = 2;
  const proxy = new FarWorldProxy(project.world);
  try {
    expect(requests[0].biomeProfileVersion).toBe(2);
  } finally {
    proxy.dispose();
  }
});
