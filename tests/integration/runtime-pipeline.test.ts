import { createHash } from "node:crypto";
import { it, expect, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { Mesh } from "three";
import { LocalAssetStorage } from "../../packages/storage/src/local";
import {
  importAsset,
  placeholderGlb,
} from "../../packages/asset-pipeline/src/index";
import {
  runtimeIO,
  generateRuntime,
} from "../../packages/asset-pipeline/src/runtime";
import { detailedGlb, runtimeCandidate } from "../fixtures/runtime-assets";
import { createApp } from "../../apps/server/src/app";
import {
  emptyProject,
  identity,
} from "../../packages/project-schema/src/index";
import { RapierPhysics } from "../../packages/physics-rapier/src/index";
const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function storage() {
  const dir = await mkdtemp(path.join(tmpdir(), "world-runtime-"));
  dirs.push(dir);
  return new LocalAssetStorage(dir);
}
it("Originalの完全一致、LOD三段階の削減、MeshoptのThree.jsデコードと再生成", async () => {
  const store = await storage(),
    original = await detailedGlb(),
    record = await importAsset(runtimeCandidate, original, store);
  expect(await store.load(`${record.id}/original.glb`)).toEqual(original);
  const lods = record.runtimeInfo!.lods!;
  expect(lods.map((l) => l.level)).toEqual([0, 1, 2]);
  expect(lods[1].triangles).toBeLessThan(lods[0].triangles);
  expect(lods[2].triangles).toBeLessThan(lods[1].triangles);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  for (const lod of lods) {
    const bytes = await store.load(lod.file.replace("/api/files/", ""));
    const gltf = await loader.parseAsync(bytes.slice().buffer, "");
    let triangles = 0;
    gltf.scene.traverse((o) => {
      if (o instanceof Mesh)
        triangles +=
          (o.geometry.index?.count ??
            o.geometry.getAttribute("position").count) / 3;
    });
    expect(triangles).toBe(lod.triangles);
    expect(bytes.length).toBeLessThan(original.length);
  }
  const regenerated = await generateRuntime(
    await runtimeIO().readBinary(await store.load(`${record.id}/original.glb`)),
  );
  expect(regenerated.levels.map((l) => l.triangles)).toEqual(
    lods.map((l) => l.triangles),
  );
  await writeFile(
    "docs/evidence/runtime-optimization.json",
    JSON.stringify(
      {
        sourceBytes: original.length,
        lods: lods.map(({ level, triangles, distance, bytes }) => ({
          level,
          triangles,
          distance,
          bytes,
        })),
        profile: record.runtimeInfo!.optimization!.profile,
      },
      null,
      2,
    ) + "\n",
  );
});
it("performanceのRuntime Textureだけを縮小し元PNGを保持する", async () => {
  const store = await storage(),
    original = await detailedGlb(true),
    record = await importAsset(runtimeCandidate, original, store, undefined, {
      profile: "performance",
    });
  expect(await store.load(`${record.id}/original.glb`)).toEqual(original);
  const doc = await runtimeIO().readBinary(
    await store.load(`${record.id}/runtime.glb`),
  );
  const texture = doc.getRoot().listTextures()[0];
  expect(texture.getMimeType()).toBe("image/webp");
  expect(texture.getSize()).toEqual([1024, 1024]);
  expect(
    (await runtimeIO().readBinary(original))
      .getRoot()
      .listTextures()[0]
      .getSize(),
  ).toEqual([2048, 2048]);
});
it("保存Budgetは更新と削除を計上し上限超過Importの途中ファイルを回収する", async () => {
  const root = (await storage()).root,
    store = new LocalAssetStorage(root, 10);
  await store.save("a", new Uint8Array(8));
  await expect(store.save("b", new Uint8Array(3))).rejects.toThrow("budget");
  await store.save("a", new Uint8Array(4));
  await store.save("b", new Uint8Array(6));
  await store.remove("a");
  await store.save("c", new Uint8Array(4));
});
it("バイナリUploadは4MiBを超えて成功し設定した安全上限とMIMEを拒否する", async () => {
  const root = (await storage()).root;
  vi.stubEnv("ASSET_MAX_SOURCE_MB", "6");
  vi.stubEnv("ASSET_MAX_AGGREGATE_MB", "12");
  const app = await createApp(root),
    server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const query = new URLSearchParams({
    name: "large.glb",
    provider: "local",
    sourceUrl: "user-supplied",
    license: "unknown",
  });
  const upload = (bytes: Uint8Array, type = "model/gltf-binary") =>
    fetch(`${base}/api/upload?${query}`, {
      method: "POST",
      headers: { "Content-Type": type },
      body: Buffer.from(bytes),
    });
  try {
    const source = await placeholderGlb(),
      view = new DataView(source.buffer, source.byteOffset, source.byteLength),
      jsonLength = view.getUint32(12, true),
      padding = 5 * 1048576;
    const large = new Uint8Array(source.length + padding);
    large.set(source.subarray(0, 20 + jsonLength));
    large.fill(32, 20 + jsonLength, 20 + jsonLength + padding);
    large.set(source.subarray(20 + jsonLength), 20 + jsonLength + padding);
    const header = new DataView(large.buffer);
    header.setUint32(8, large.length, true);
    header.setUint32(12, jsonLength + padding, true);
    const response = await upload(large);
    expect(response.status).toBe(200);
    const record = await response.json();
    const saved = await (
      await fetch(base + record.files.original)
    ).arrayBuffer();
    expect(
      createHash("sha256").update(new Uint8Array(saved)).digest("hex"),
    ).toBe(createHash("sha256").update(large).digest("hex"));
    expect((await upload(new Uint8Array(7 * 1048576))).status).toBe(400);
    expect((await upload(source, "text/plain")).status).toBe(400);
    vi.stubEnv("ASSET_MAX_AGGREGATE_MB", "0.00001");
    expect((await upload(source)).status).toBe(400);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}, 20000);
it("生成したHull/TrimeshをRapierに反映し、破損ColliderはBoxへ戻す", async () => {
  const store = await storage(),
    original = await placeholderGlb();
  const hull = await importAsset(runtimeCandidate, original, store),
    mesh = await importAsset(
      { ...runtimeCandidate, category: "building" },
      original,
      store,
    );
  const broken = structuredClone(hull);
  broken.id = "broken";
  broken.runtimeInfo!.colliderFile = "/api/files/broken/collider.json";
  const p = emptyProject();
  p.assets = [hull, mesh, broken];
  p.world.entities = p.assets.map((a, i) => ({
    id: `placed-${i}`,
    name: "検証",
    kind: "asset",
    assetId: a.id,
    transform: {
      ...identity(),
      position: [2 + i * 5, 0, 0],
      rotation: [0, 0.5, 0],
      scale: [2, 1, 0.5],
    },
  }));
  const physics = new RapierPhysics();
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (typeof input === "string" && input.startsWith("/api/files/")) {
      try {
        return new Response(
          Buffer.from(await store.load(input.replace("/api/files/", ""))),
        );
      } catch {
        return new Response("missing", { status: 404 });
      }
    }
    return realFetch(input, init);
  });
  await physics.load(p);
  try {
    const shapes = new Map<number, number>();
    physics.world.colliders.forEach((c) => {
      if (c.translation().x >= 0 && c.translation().x <= 12)
        shapes.set(Math.round(c.translation().x), c.shapeType());
    });
    expect(shapes.get(2)).toBe(9);
    expect(shapes.get(7)).toBe(6);
    expect(shapes.get(12)).toBe(1);
  } finally {
    physics.dispose();
  }
});
it("設定したtriangle・textureの安全上限を維持する", async () => {
  const store = await storage(),
    source = await detailedGlb(true);
  vi.stubEnv("ASSET_MAX_TRIANGLES", "100");
  await expect(importAsset(runtimeCandidate, source, store)).rejects.toThrow(
    "triangle limit",
  );
  vi.stubEnv("ASSET_MAX_TRIANGLES", "2000000");
  vi.stubEnv("ASSET_MAX_TEXTURE_DIMENSION", "512");
  await expect(importAsset(runtimeCandidate, source, store)).rejects.toThrow(
    "dimension limit",
  );
});
it("LODに不向きなモデルはLOD0だけを生成し元データは変更しない", async () => {
  const source = await detailedGlb(),
    doc = await runtimeIO().readBinary(source);
  doc.createAnimation("保存済みのアニメーション");
  const generated = await generateRuntime(doc);
  expect(generated.levels.map((l) => l.level)).toEqual([0]);
  expect(doc.getRoot().listAnimations()).toHaveLength(1);
});
it("Runtime保存途中の失敗はOriginalを含めた未完了Importを回収する", async () => {
  const original = await placeholderGlb(),
    root = (await storage()).root;
  const store = new LocalAssetStorage(root, original.length + 16);
  await expect(importAsset(runtimeCandidate, original, store)).rejects.toThrow(
    "budget",
  );
  const { readdir } = await import("node:fs/promises");
  for (const dir of await readdir(root))
    expect(await readdir(path.join(root, dir))).toHaveLength(0);
});
it("Collider読込中の停止は解放済みWorldを再利用しない", async () => {
  const store = await storage(),
    record = await importAsset(runtimeCandidate, await placeholderGlb(), store);
  const project = emptyProject();
  project.assets = [record];
  project.world.entities = [
    {
      id: "pending-entity",
      name: "岩",
      kind: "asset",
      assetId: record.id,
      transform: identity(),
    },
  ];
  const physics = new RapierPhysics();
  let finish!: (response: Response) => void;
  const request = vi.spyOn(globalThis, "fetch").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const loading = physics.load(project);
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
  physics.dispose();
  finish(
    new Response(Buffer.from(await store.load(`${record.id}/collider.json`))),
  );
  await loading;
  expect(physics.stats.colliders).toBe(0);
  expect(physics.stats.physicsChunksLoaded).toBe(0);
});
it("退化したConvex HullはRapier生成時にもBoxへフォールバックする", async () => {
  const store = await storage(),
    record = await importAsset(runtimeCandidate, await placeholderGlb(), store);
  const project = emptyProject();
  project.assets = [record];
  project.world.entities = [
    {
      id: "degenerate-entity",
      name: "退化した岩",
      kind: "asset",
      assetId: record.id,
      transform: { ...identity(), position: [5, 0, 0] },
    },
  ];
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        version: 1,
        vertices: [0, 0, 0, 0, 0, 0, 0, 0, 0],
        indices: [0, 1, 2],
      }),
    ),
  );
  const physics = new RapierPhysics();
  await physics.load(project);
  try {
    const shapes: number[] = [];
    physics.world.colliders.forEach((c) => {
      if (c.translation().x === 5) shapes.push(c.shapeType());
    });
    expect(shapes).toEqual([1]);
  } finally {
    physics.dispose();
  }
});
