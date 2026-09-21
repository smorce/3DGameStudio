import { assertPreparedSampleCurrent } from "../../packages/sample-worlds/src/freshness";
import { expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { createApp } from "../../apps/server/src/app";
import { sampleWorldCatalog } from "../../packages/sample-worlds/src/index";
import { planSampleWorldAssets } from "../../packages/sample-worlds/src/prepare";
import {
  emptyProject,
  parseProject,
} from "../../packages/project-schema/src/index";
import { AssetCatalog } from "../../packages/asset-catalog/src/index";
import {
  AssetFactory,
  requiredSlots,
} from "../../packages/asset-factory/src/index";
import { bakeWorld, validateBake } from "../../packages/asset-factory/src/bake";
import { DummyAstraAssetGenerator } from "../../packages/ai-dummy/src/asset-generator";
import { validateWorld } from "../../packages/world-generator/src/validate";
import { WorldRuntime } from "../../packages/world-system/src/runtime";
import { memoryAssetStorage } from "../fixtures/asset-factory";

it("全8Worldをoffline Factory→Catalog→Bake→Validator→Runtimeで検証する", async () => {
  const noNetwork = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("External network is prohibited");
  });
  try {
    const library = emptyProject();
    const storage = memoryAssetStorage();
    const factory = new AssetFactory(
      new AssetCatalog(library),
      storage,
      [],
      new DummyAstraAssetGenerator(true),
    );
    const result = await factory.fulfill(
      await planSampleWorldAssets(),
      "offline",
      42,
    );
    expect(result.errors).toEqual([]);
    expect(result.missing).toEqual([]);
    for (const descriptor of sampleWorldCatalog) {
      const p = descriptor.buildProject();
      const source = p.world.source;
      if (source.kind !== "procedural") throw new Error("Missing source");
      if (source.design) {
        const slots = requiredSlots(source.design);
        p.assets = library.assets.filter((a) =>
          a.catalog?.slots.some((s) => slots.includes(s)),
        );
        bakeWorld(p);
        validateBake(p);
        expect(p.world.buildManifest?.biomeProfileVersion).toBe(1);
      }
      expect(() => parseProject(p)).not.toThrow();
      const catalog = new AssetCatalog(p);
      const runtime = new WorldRuntime(p.world, {
        forceSyncWorkers: true,
        assets: p.assets,
      });
      try {
        const spawn = p.world.spawnPoints[0];
        const chunk = runtime.getChunk(
          `${Math.floor(spawn[0] / source.chunkSize)},${Math.floor(spawn[2] / source.chunkSize)}`,
        );
        if (!chunk) throw new Error("Missing runtime chunk");
        expect(Array.from(chunk.heights).every(Number.isFinite)).toBe(true);
        expect(chunk.entities.every((e) => !e.missingAsset)).toBe(true);
        expect(
          validateWorld(p.world, {
            spawnSurface:
              descriptor.recommendedMachine === "boat" ? "water" : "land",
            courses: p.courses,
            entities: chunk.entities,
            canResolve: (slot, biome) =>
              catalog.resolveAssetSlot(
                slot,
                { biome, seed: 42, style: "stylized-low-poly" },
                p.world.buildManifest,
              ).status === "resolved",
          }).filter((i) => i.severity === "error"),
        ).toEqual([]);
      } finally {
        runtime.dispose();
      }
    }
    expect(noNetwork).not.toHaveBeenCalled();
  } finally {
    noNetwork.mockRestore();
  }
});

it("空data directoryの汎用APIは8Worldと共有ファイルを返し不正IDを拒否する", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sample-api-"));
  const app = await createApp(dir),
    server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing server address");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    expect(await (await fetch(`${base}/api/worlds`)).json()).toHaveLength(8);
    for (const descriptor of sampleWorldCatalog) {
      const response = await fetch(`${base}/api/worlds/${descriptor.id}`);
      expect(response.status).toBe(200);
      const p = parseProject(await response.json());
      expect(() => assertPreparedSampleCurrent(descriptor, p)).not.toThrow();
      for (const asset of p.assets) {
        const urls = [
          asset.files.original,
          asset.files.runtime,
          asset.runtimeInfo?.colliderFile,
          ...(asset.runtimeInfo?.lods?.map((l) => l.file) ?? []),
        ].filter((s): s is string => !!s);
        for (const url of new Set(urls)) {
          const r = await fetch(base + url);
          expect(r.status).toBe(200);
          const bytes = new Uint8Array(await r.arrayBuffer());
          expect(createHash("sha256").update(bytes).digest("hex")).toBe(
            path.basename(url).split(".")[0],
          );
        }
      }
    }
    expect((await fetch(`${base}/api/worlds/unknown`)).status).toBe(404);
    expect((await fetch(`${base}/api/worlds/%2e%2e%2fsecret`)).status).toBe(
      404,
    );
    const checked = JSON.parse(
      await readFile("demos/worlds/race-island.json", "utf8"),
    );
    expect(checked.settings.activeCourseId).toBeTruthy();
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
