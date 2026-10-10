import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { findSampleWorld } from "../../packages/sample-worlds/src/index";
import {
  parseProject,
  worldChunkSize,
} from "../../packages/project-schema/src/index";
import {
  generateChunk,
  SemanticLayers,
} from "../../packages/world-generator/src/index";
import {
  alpineFields,
  alpineFieldAt,
} from "../../packages/world-generator/src/alpine-farmland";
import { AssetCatalog } from "../../packages/asset-catalog/src/index";
import { requiredSlots } from "../../packages/asset-factory/src/planner";
import { validateBake } from "../../packages/asset-factory/src/bake";
import { validateWorld } from "../../packages/world-generator/src/validate";
import { WorldRuntime } from "../../packages/world-system/src/runtime";
import {
  alpineChimneySmoke,
  alpineClouds,
} from "../../packages/renderer-three/src/alpine-atmosphere";
import { disposeTemplate } from "../../packages/renderer-three/src/instances";

const project = () =>
  parseProject(
    JSON.parse(readFileSync("demos/worlds/alpine-village.json", "utf8")),
  );
const source = () => {
  const s = project().world.source;
  if (s.kind !== "procedural" || !s.design)
    throw new Error("Missing Alpine Village design");
  return { ...s, design: s.design };
};
describe("Alpine Village", () => {
  it("正式Catalogから読み込め、Schema・Manifest・すべての必須Slotが整合する", () => {
    const p = project(),
      descriptor = findSampleWorld("alpine-village")!;
    expect(descriptor.recommendedMachine).toBe("car");
    expect(descriptor.buildProject().world.id).toBe(p.world.id);
    expect(() => validateBake(p)).not.toThrow();
    const catalog = new AssetCatalog(p),
      s = source();
    for (const slot of requiredSlots(s.design))
      expect(
        catalog.resolveAssetSlot(
          slot,
          { seed: s.seed, biome: "temperate", style: "stylized-low-poly" },
          p.world.buildManifest,
        ).status,
      ).toBe("resolved");
    expect(p.world.water.enabled).toBe(false);
    expect(worldChunkSize(p.world)).toBe(s.chunkSize);
  });
  it("地形・建物・農地はSeedとChunk順に対して決定的で、必須景観を持つ", () => {
    const s = source();
    const keys = Array.from({ length: 64 }, (_, i) => [
      (i % 8) - 4,
      Math.floor(i / 8) - 3,
    ]);
    const chunks = keys.map(([chunkX, chunkZ]) =>
      generateChunk({ ...s, chunkX, chunkZ }),
    );
    const fresh = { ...s, design: structuredClone(s.design) };
    const reversed = new Map(
      [...keys]
        .reverse()
        .map(([chunkX, chunkZ]) => [
          `${chunkX},${chunkZ}`,
          generateChunk({ ...fresh, chunkX, chunkZ }),
        ]),
    );
    for (const chunk of chunks)
      expect(reversed.get(`${chunk.chunkX},${chunk.chunkZ}`)).toEqual(chunk);
    const entities = chunks.flatMap((c) => c.entities);
    expect(new Set(entities.map((e) => e.id)).size).toBe(entities.length);
    expect(
      entities.filter((e) => e.settlementId && e.kind === "building"),
    ).toHaveLength(14);
    expect(entities.some((e) => e.assetSlot?.endsWith(".windmill"))).toBe(true);
    expect(entities.some((e) => e.assetSlot?.endsWith(".wheat"))).toBe(true);
    expect(entities.some((e) => e.assetSlot?.endsWith(".wall"))).toBe(true);
    expect(s.design.islands[0].mountains.length).toBeGreaterThan(10);
    expect(alpineFields).toHaveLength(5);
    expect(new Set(alpineFields.map((f) => f.crop)).size).toBe(4);
    expect(alpineFieldAt(-80, 80)?.crop).toBe("wheat");
    const otherSeed = generateChunk({ ...s, seed: 79, chunkX: 0, chunkZ: -2 });
    expect(otherSeed).not.toEqual(
      chunks.find((c) => c.chunkX === 0 && c.chunkZ === -2),
    );
  });
  it("車の開始点・道路・石垣・建物が交差せず、道路の高さが連続する", () => {
    const p = project(),
      s = source(),
      layers = new SemanticLayers(s.design, s.seed);
    const spawn = p.world.spawnPoints[0];
    expect(spawn[1]).toBeGreaterThan(layers.sampleHeight(spawn[0], spawn[2]));
    expect(
      layers.sampleRoadInfluence(spawn[0], spawn[2]).distance,
    ).toBeLessThan(0);
    for (const { points } of layers.roads)
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i];
        expect(
          Math.abs(
            layers.sampleHeight(a[0], a[2]) - layers.sampleHeight(b[0], b[2]),
          ) / Math.max(0.01, Math.hypot(a[0] - b[0], a[2] - b[2])),
        ).toBeLessThan(0.15);
      }
    for (const wall of s.design.landmarks.filter((l) =>
      l.assetSlot.endsWith(".wall"),
    ))
      expect(
        layers.sampleRoadInfluence(wall.position[0], wall.position[2]).distance,
      ).toBeGreaterThan(1.8);
    expect(
      validateWorld(p.world, { canResolve: () => true }).filter(
        (i) => i.severity === "error",
      ),
    ).toEqual([]);
  });
  it("Origin Rebaseでも全景観の絶対位置と再読込結果を保つ", () => {
    const p = project();
    const runtime = new WorldRuntime(p.world, {
      assets: p.assets,
      forceSyncWorkers: true,
    });
    const before = structuredClone(runtime.getChunk("-2,1")!);
    runtime.maybeRebase([450, 14, 400]);
    for (const e of before.entities) {
      const restored = runtime.toGlobal(runtime.toSimulation(e.position));
      e.position.forEach((value, axis) =>
        expect(restored[axis]).toBeCloseTo(value, 10),
      );
    }
    expect(runtime.getChunk("-2,1")).toEqual(before);
    runtime.dispose();
    const reloaded = new WorldRuntime(p.world, {
      assets: p.assets,
      forceSyncWorkers: true,
    });
    expect(reloaded.getChunk("-2,1")).toEqual(before);
    reloaded.dispose();
  });
  it("煙はChunk内の相対位置で更新し、雲と煙のリソースを解放できる", () => {
    const s = source(),
      houses = generateChunk({ ...s, chunkX: 0, chunkZ: -2 }).entities;
    const smoke = alpineChimneySmoke(houses, [0, 0, -128]);
    expect(smoke).toBeDefined();
    smoke!.userData.alpineTick(12);
    expect([...smoke!.instanceMatrix.array].every(Number.isFinite)).toBe(true);
    const clouds = alpineClouds();
    expect(clouds.children).toHaveLength(1);
    disposeTemplate(clouds);
    disposeTemplate(smoke!);
    smoke!.dispose();
  });
});

it("既存8ワールドのPreparedデータをfa71e23から変更しない", async () => {
  const { createHash } = await import("node:crypto");
  const { default: baseline } =
    await import("../fixtures/pre-alpine-worlds.json");
  for (const [id, hash] of Object.entries(baseline.worldFiles))
    expect(
      createHash("sha256")
        .update(readFileSync(`demos/worlds/${id}.json`))
        .digest("hex"),
    ).toBe(hash);
});

it("麦・石垣・広葉樹のLODを明示的に軽量化し、風車のピボットを保持する", async () => {
  const p = project();
  for (const suffix of [".wheat", ".wall", ".oak"]) {
    const asset = p.assets.find((a) => a.catalog?.slots[0].endsWith(suffix))!;
    const lods = asset.runtimeInfo!.lods!;
    expect(lods.map((l) => l.level)).toEqual([0, 1, 2]);
    expect(lods[2].triangles!).toBeLessThan(lods[0].triangles! * 0.5);
  }
  const THREE = await import("three");
  const { alpineRotorTick } =
    await import("../../packages/renderer-three/src/alpine-rotor");
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
    1,
  );
  const base = new THREE.Matrix4().makeTranslation(-205, 12, -65);
  mesh.setMatrixAt(0, base);
  const tick = alpineRotorTick(mesh);
  tick(12);
  const rotated = new THREE.Matrix4();
  mesh.getMatrixAt(0, rotated);
  expect(rotated.elements).not.toEqual(base.elements);
  const pivot = new THREE.Vector3(0, 10.5, 3.1);
  expect(
    pivot
      .clone()
      .applyMatrix4(rotated)
      .distanceTo(pivot.clone().applyMatrix4(base)),
  ).toBeLessThan(0.00001);
  disposeTemplate(mesh);
  mesh.dispose();
});

it("低FPSで一般Commitを省略しても準備済みChunkの風車を解決し、未準備の同期生成を避ける", async () => {
  const { alpineRenderChunk } =
    await import("../../packages/renderer-three/src/alpine-ready");
  const p = project(),
    runtime = new WorldRuntime(p.world, {
      assets: p.assets,
      forceSyncWorkers: true,
    });
  runtime.setPlayHotPath(true);
  expect(alpineRenderChunk(runtime, "-4,-2")).toBeUndefined();
  expect(runtime.stats().syncFallbackCount).toBe(0);
  runtime.requestChunk("-4,-2", "P2_VISIBLE_RENDER");
  await Promise.resolve();
  runtime.workerPool.flush();
  expect(runtime.peekPreparedChunk("-4,-2")).toBeDefined();
  runtime.commitGeneralWithinBudget({ skip: true });
  expect(runtime.peekChunk("-4,-2")).toBeUndefined();
  const chunk = alpineRenderChunk(runtime, "-4,-2")!;
  expect(
    chunk.entities.find((e) => e.assetSlot?.endsWith(".windmill"))?.assetId,
  ).toBeDefined();
  expect(runtime.stats().syncFallbackCount).toBe(0);
  runtime.dispose();
});

it("地形の裾は上面と物理用の準備済みBufferを変えず、遠景との隙間を覆う", async () => {
  const THREE = await import("three");
  const { prepareChunk } =
    await import("../../packages/world-generator/src/prepare");
  const { addAlpineTerrainSkirt } =
    await import("../../packages/renderer-three/src/alpine-terrain");
  const data = prepareChunk({ ...source(), chunkX: 0, chunkZ: 0 });
  const geometry = new THREE.BufferGeometry();
  for (const [name, values] of [
    ["position", data.positions],
    ["color", data.colors],
    ["normal", data.normals],
  ] as const)
    geometry.setAttribute(name, new THREE.BufferAttribute(values, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  const before = data.positions.slice(),
    triangles = data.indices.length;
  addAlpineTerrainSkirt(geometry, data.resolution);
  expect(data.positions).toEqual(before);
  expect([
    ...geometry.getAttribute("position").array.slice(0, before.length),
  ]).toEqual([...before]);
  expect(geometry.index!.count).toBe(triangles + 4 * (data.resolution - 1) * 6);
  expect(
    [...geometry.getAttribute("position").array].every(Number.isFinite),
  ).toBe(true);
  geometry.dispose();
});

it("既存の頂点色GLBは1素材・非金属・Textureなしを維持する", async () => {
  const { runtimeIO } =
    await import("../../packages/asset-pipeline/src/runtime");
  const { MeshoptDecoder } = await import("meshoptimizer");
  await MeshoptDecoder.ready;
  const assets = project().assets.filter(
    (asset) => !asset.catalog?.slots.some((slot) => slot.includes(".quality.")),
  );
  const files = new Set(assets.map((a) => a.files.runtime));
  for (const file of files) {
    const doc = await runtimeIO().readBinary(
      new Uint8Array(
        readFileSync(`demos/sample-worlds/assets/${file.split("/").at(-1)}`),
      ),
    );
    expect(doc.getRoot().listMaterials()).toHaveLength(1);
    expect(doc.getRoot().listTextures()).toHaveLength(0);
    expect(doc.getRoot().listMaterials()[0].getMetallicFactor()).toBe(0);
    for (const mesh of doc.getRoot().listMeshes())
      for (const primitive of mesh.listPrimitives())
        expect(primitive.getAttribute("COLOR_0")).not.toBeNull();
  }
});

it("改修山脈のChunk境界は連続し、遠景も同じ高さ関数を使う", async () => {
  const { buildIslandProxies } =
    await import("../../packages/world-generator/src/far-proxy");
  const s = source(),
    layers = new SemanticLayers(s.design, s.seed);
  for (let z = -1100; z <= 200; z += 32)
    for (let x = -1000; x <= 1000; x += 64) {
      const h = layers.sampleHeight(x, z);
      expect(Number.isFinite(h)).toBe(true);
      expect(
        Math.abs(
          layers.sampleHeight(x - 0.001, z) - layers.sampleHeight(x + 0.001, z),
        ),
      ).toBeLessThan(0.01);
    }
  const left = generateChunk({ ...s, chunkX: 0, chunkZ: -12 });
  const right = generateChunk({ ...s, chunkX: 1, chunkZ: -12 });
  for (let z = 0; z < left.resolution; z++) {
    expect(left.heights[z * left.resolution + left.resolution - 1]).toBe(
      right.heights[z * right.resolution],
    );
  }
  const proxy = buildIslandProxies(s.design, s.seed, s.chunkSize)[0];
  for (let i = 0; i < proxy.positions.length; i += 291) {
    const [x, y, z] = proxy.positions.slice(i, i + 3);
    expect(y).toBeCloseTo(layers.sampleHeight(x, z) - 0.08, 3);
  }
  expect(proxy.cellKeys.length * 6).toBe(proxy.indices.length);
}, 30000);

it("森林密度に群落・空き地・樹木限界がありSeedで再現する", async () => {
  const { alpineForestDensity } =
    await import("../../packages/world-generator/src/alpine-landscape");
  const values = [],
    otherSeedValues = [];
  for (let z = -600; z < -200; z += 25)
    for (let x = -600; x < 600; x += 25) {
      const density = alpineForestDensity(x, z, 40, 42);
      expect(density).toBe(alpineForestDensity(x, z, 40, 42));
      expect(density).toBeGreaterThanOrEqual(0);
      expect(density).toBeLessThanOrEqual(1);
      values.push(density);
      otherSeedValues.push(alpineForestDensity(x, z, 40, 79));
    }
  expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.7);
  expect(alpineForestDensity(100, -500, 151, 42)).toBe(0);
  expect(values).not.toEqual(otherSeedValues);
});

it("LOD接続は描画外周だけを補間し、物理Bufferと内部の地形を保持する", async () => {
  const THREE = await import("three");
  const { prepareChunk } =
    await import("../../packages/world-generator/src/prepare");
  const { alignAlpineTerrainBoundary } =
    await import("../../packages/renderer-three/src/alpine-terrain");
  const s = source(),
    data = prepareChunk({ ...s, chunkX: 0, chunkZ: -12 });
  const layers = new SemanticLayers(s.design, s.seed);
  const before = data.positions.slice();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(data.positions, 3),
  );
  alignAlpineTerrainBoundary(
    geometry,
    data.resolution,
    data.size,
    0,
    -12 * data.size,
    (x, z) => layers.sampleHeight(x, z),
  );
  expect(data.positions).toEqual(before);
  const position = geometry.getAttribute("position");
  expect([...position.array].every(Number.isFinite)).toBe(true);
  for (let i = 0; i < data.resolution; i += 8) {
    expect(position.getY(i)).toBeCloseTo(
      layers.sampleHeight(position.getX(i), -12 * data.size),
      3,
    );
  }
  const middle = Math.floor(data.resolution / 2) * (data.resolution + 1);
  expect(position.getY(middle)).toBe(before[middle * 3 + 1]);
  geometry.dispose();
});

it("ノイズ値の再利用とキャッシュ上限によって景観の値が変わらない", async () => {
  const { alpineNoise, alpineMountainHeight, alpineForestDensity } =
    await import("../../packages/world-generator/src/alpine-landscape");
  const cache = new Map(
    Array.from({ length: 32768 }, (_, i) => [`old:${i}`, 1] as const),
  );
  for (const [x, z] of [
    [-83.2, -360.5],
    [128, -840],
    [0, 0],
    [1024, -135],
  ]) {
    expect(alpineNoise(x, z, 55, 42, cache)).toBe(alpineNoise(x, z, 55, 42));
    expect(alpineMountainHeight(x, z, 42, cache)).toBe(
      alpineMountainHeight(x, z, 42),
    );
    expect(alpineForestDensity(x, z, 40, 42, cache)).toBe(
      alpineForestDensity(x, z, 40, 42),
    );
  }
  expect(cache.size).toBeLessThan(32768);
  expect(cache.has("old:0")).toBe(false);
});
