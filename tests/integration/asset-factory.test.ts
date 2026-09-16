import { afterEach, expect, it, vi } from "vitest";
import {
  emptyProject,
  parseProject,
} from "../../packages/project-schema/src/index";
import { makeRecord } from "../../packages/asset-core/src/index";
import { AssetCatalog } from "../../packages/asset-catalog/src/index";
import {
  AssetFactory,
  DummyAssetRequirementPlanner,
} from "../../packages/asset-factory/src/index";
import { bakeWorld, validateBake } from "../../packages/asset-factory/src/bake";
import { DummyAstraAssetGenerator } from "../../packages/ai-dummy/src/asset-generator";
import {
  createProceduralWorld,
  generateChunk,
  toyIslandsDesign,
} from "../../packages/world-generator/src/index";
import { validateWorld } from "../../packages/world-generator/src/validate";
import { LocalLibraryProvider } from "../../packages/asset-providers/src/index";
import { placeholderGlb } from "../../packages/asset-pipeline/src/index";
import { WorldRuntime } from "../../packages/world-system/src/runtime";
import { memoryAssetStorage } from "../fixtures/asset-factory";
afterEach(() => vi.restoreAllMocks());
const candidate = {
  id: "rock",
  name: "small rock",
  category: "rock",
  provider: "local",
  license: "CC0",
  author: "test",
  sourceUrl: "local:test",
  thumbnail: "",
};
const requirement = {
  assetSlot: "nature.rock.small",
  minVariants: 2,
  biomes: [],
  style: "stylized-low-poly",
};
it("Catalog検索・fingerprint・Slot解決は順序に依存せずMissingAssetを返す", () => {
  const project = emptyProject();
  const catalog = new AssetCatalog(project);
  for (const id of ["b", "a"]) {
    const a = makeRecord(candidate, id);
    a.catalog = {
      slots: [requirement.assetSlot],
      tags: ["rock"],
      biomes: ["temperate"],
      style: requirement.style,
      contentHash: id,
      status: "ready",
    };
    catalog.register(a);
  }
  expect(project.assets).toHaveLength(2);
  expect(catalog.query({ tags: ["rock"], biome: "temperate" })).toHaveLength(2);
  expect(catalog.query({ biome: "tropical" })).toHaveLength(0);
  expect(catalog.resolveAssetSlot("missing", { seed: 42 }).status).toBe(
    "missing",
  );
  const before = catalog.fingerprint(),
    resolved = catalog.resolveAssetSlot(requirement.assetSlot, {
      seed: 42,
      stablePlacementId: "cell",
    });
  project.assets.reverse();
  catalog.reindex();
  expect(catalog.fingerprint()).toBe(before);
  expect(
    catalog.resolveAssetSlot(requirement.assetSlot, {
      seed: 42,
      stablePlacementId: "cell",
    }),
  ).toEqual(resolved);
  project.assets[0].catalog!.contentHash = "changed";
  expect(catalog.fingerprint()).not.toBe(before);
});
it("Dummy PlannerはDesign内のSlotを抽出し静的variant policyを適用する", async () => {
  const planner = new DummyAssetRequirementPlanner(),
    design = toyIslandsDesign();
  const plan = await planner.plan(design);
  expect(plan.requirements).toHaveLength(10);
  expect(
    plan.requirements.find((r) => r.assetSlot === "nature.tree.tropical")
      ?.minVariants,
  ).toBe(5);
  design.landmarks.push({
    ...design.landmarks[0],
    id: "new",
    assetSlot: "landmark.new",
  });
  expect(
    (await planner.plan(design)).requirements.some(
      (r) => r.assetSlot === "landmark.new",
    ),
  ).toBe(true);
});
it("dry-runは不足だけを報告しProviderもDummyも呼ばない", async () => {
  const provider = new LocalLibraryProvider(),
    search = vi.spyOn(provider, "search"),
    generator = new DummyAstraAssetGenerator(),
    spy = vi.spyOn(generator, "generate"),
    storage = memoryAssetStorage();
  const result = await new AssetFactory(
    new AssetCatalog(emptyProject()),
    storage,
    [provider],
    generator,
  ).fulfill({ planner: "dummy", requirements: [requirement] }, "dry-run");
  expect(result.missing).toEqual([
    { assetSlot: requirement.assetSlot, count: 2 },
  ]);
  expect(search).not.toHaveBeenCalled();
  expect(spy).not.toHaveBeenCalled();
  expect(storage.data.size).toBe(0);
});
it("offlineはLocalを優先しunknown licenseを除外、外部Providerを呼ばない", async () => {
  const provider = new LocalLibraryProvider(
    [candidate, { ...candidate, id: "unknown", license: "unknown" }],
    new Map([["rock", await placeholderGlb()]]),
  );
  const external = new LocalLibraryProvider();
  external.id = "polyhaven";
  const search = vi.spyOn(external, "search"),
    network = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Network forbidden"));
  const project = emptyProject();
  const result = await new AssetFactory(
    new AssetCatalog(project),
    memoryAssetStorage(),
    [external, provider],
    new DummyAstraAssetGenerator(),
  ).fulfill({ planner: "dummy", requirements: [requirement] }, "offline");
  expect(result.missing).toEqual([]);
  expect(project.assets.map((a) => a.source.provider)).toEqual([
    "local",
    "dummy-astra",
  ]);
  expect(search).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
  expect(project.assets.every((a) => a.license.id !== "unknown")).toBe(true);
});
it("toy-islands → Planner → offline Factory → Processor → Catalog → Runtime → Validator → Bakeが通る", async () => {
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Network forbidden"));
  const project = emptyProject();
  project.world = {
    ...project.world,
    ...createProceduralWorld({ preset: "toy-islands", id: "toy" }),
  };
  const source = project.world.source;
  if (source.kind !== "procedural" || !source.design)
    throw new Error("Missing design");
  const catalog = new AssetCatalog(project),
    plan = await new DummyAssetRequirementPlanner().plan(source.design),
    storage = memoryAssetStorage();
  const factory = new AssetFactory(
    catalog,
    storage,
    [],
    new DummyAstraAssetGenerator(),
  );
  const result = await factory.fulfill(plan, "offline");
  expect(result.errors).toEqual([]);
  expect(result.missing).toEqual([]);
  expect(project.assets).toHaveLength(28);
  expect(
    project.assets.every(
      (a) =>
        a.runtimeInfo?.lods?.[0].level === 0 &&
        a.ai?.provider === "dummy-astra" &&
        a.ai.model === "dummy",
    ),
  ).toBe(true);
  expect((await factory.fulfill(plan, "offline")).registered).toHaveLength(0);
  const entities = generateChunk({ ...source, chunkX: 2, chunkZ: 2 }).entities;
  expect(entities.length).toBeGreaterThan(0);
  expect(
    entities.every(
      (e) =>
        !!e.assetSlot &&
        catalog.resolveAssetSlot(e.assetSlot, {
          seed: 42,
          stablePlacementId: e.id,
        }).status === "resolved",
    ),
  ).toBe(true);
  expect(
    validateWorld(project.world, {
      entities,
      canResolve: (slot) =>
        catalog.resolveAssetSlot(slot, { seed: 42 }).status === "resolved",
    }).filter((i) => i.severity === "error"),
  ).toEqual([]);
  const manifest = bakeWorld(project, catalog);
  expect(bakeWorld(project, catalog)).toEqual(manifest);
  validateBake(project);
  const selected = catalog.resolveAssetSlot(
    entities[0].assetSlot!,
    { seed: 42, stablePlacementId: entities[0].id },
    manifest,
  );
  const extra = structuredClone(
    project.assets.find((a) =>
      a.catalog?.slots.includes(entities[0].assetSlot!),
    )!,
  );
  extra.id = "new-asset";
  catalog.register(extra);
  expect(
    catalog.resolveAssetSlot(
      entities[0].assetSlot!,
      { seed: 42, stablePlacementId: entities[0].id },
      manifest,
    ),
  ).toEqual(selected);
  validateBake(project);
  expect(
    parseProject(JSON.parse(JSON.stringify(project))).world.buildManifest,
  ).toEqual(manifest);
  const runtime = new WorldRuntime(project.world, {
    assets: project.assets,
    forceSyncWorkers: true,
  });
  expect(
    runtime
      .getChunk("2,2")!
      .entities.every((e) => !!e.assetId && !e.missingAsset),
  ).toBe(true);
  runtime.dispose();
  project.assets[0].catalog!.contentHash = "tampered";
  expect(() => validateBake(project)).toThrow("modified");
  expect(network).not.toHaveBeenCalled();
});

it("BakeはBiome別候補を保持し、World変更を検出する", () => {
  const p = emptyProject();
  p.world = { ...p.world, ...createProceduralWorld({ preset: "toy-islands" }) };
  const catalog = new AssetCatalog(p);
  const a = makeRecord(candidate, "temperate"),
    b = makeRecord(candidate, "tropical");
  for (const asset of [a, b]) {
    asset.catalog = {
      slots: [requirement.assetSlot],
      tags: [],
      biomes: [asset.id],
      style: requirement.style,
      contentHash: asset.id,
      status: "ready",
    };
    catalog.register(asset);
  }
  const source = p.world.source;
  if (source.kind !== "procedural" || !source.design)
    throw new Error("Missing design");
  source.design.islands = [source.design.islands[0]];
  source.design.islands[0].propRules = [source.design.islands[0].propRules[1]];
  source.design.landmarks = [];
  source.design.settlements = [];
  const manifest = bakeWorld(p, catalog);
  const resolution = catalog.resolveAssetSlot(
    requirement.assetSlot,
    { seed: 42, biome: "temperate" },
    manifest,
  );
  expect(resolution.status === "resolved" && resolution.asset.id).toBe(
    "temperate",
  );
  source.seed++;
  expect(() => validateBake(p)).toThrow("rebake");
});

it("acquireは許可Providerだけを優先順に使い失敗を記録してfallbackする", async () => {
  const order: string[] = [];
  const local = new LocalLibraryProvider();
  vi.spyOn(local, "search").mockImplementation(async () => {
    order.push("local");
    return [];
  });
  const external = new LocalLibraryProvider();
  external.id = "polyhaven";
  vi.spyOn(external, "search").mockImplementation(async () => {
    order.push("polyhaven");
    throw new Error("Provider unavailable");
  });
  const forbidden = new LocalLibraryProvider();
  forbidden.id = "unapproved";
  const search = vi.spyOn(forbidden, "search");
  const p = emptyProject(),
    result = await new AssetFactory(
      new AssetCatalog(p),
      memoryAssetStorage(),
      [external, forbidden, local],
      new DummyAstraAssetGenerator(),
    ).fulfill(
      { planner: "dummy", requirements: [{ ...requirement, minVariants: 1 }] },
      "acquire",
    );
  expect(order).toEqual(["local", "polyhaven"]);
  expect(search).not.toHaveBeenCalled();
  expect(result.errors[0]).toContain("Provider unavailable");
  expect(result.missing).toEqual([]);
});

it("途中のvariantが削除されても重複を数えず不足分を補充する", async () => {
  const p = emptyProject(),
    catalog = new AssetCatalog(p),
    storage = memoryAssetStorage();
  const factory = new AssetFactory(
    catalog,
    storage,
    [],
    new DummyAstraAssetGenerator(),
  );
  const plan = { planner: "dummy", requirements: [requirement] };
  await factory.fulfill(plan, "offline");
  p.assets.splice(0, 1);
  catalog.reindex();
  const result = await factory.fulfill(plan, "offline");
  expect(result.missing).toEqual([]);
  expect(result.errors).toEqual([]);
  expect(new Set(p.assets.map((a) => a.source.sourceAssetId)).size).toBe(2);
  p.assets[0].catalog!.slots.push(requirement.assetSlot);
  catalog.reindex();
  expect(catalog.query({ slot: requirement.assetSlot })).toHaveLength(2);
});

it("Bake後のvariantのBiome metadata変更を検出する", async () => {
  const p = emptyProject();
  p.world = { ...p.world, ...createProceduralWorld({ preset: "toy-islands" }) };
  const source = p.world.source;
  if (source.kind !== "procedural" || !source.design)
    throw new Error("Missing design");
  const catalog = new AssetCatalog(p);
  await new AssetFactory(
    catalog,
    memoryAssetStorage(),
    [],
    new DummyAstraAssetGenerator(),
  ).fulfill(
    await new DummyAssetRequirementPlanner().plan(source.design),
    "offline",
  );
  bakeWorld(p, catalog);
  p.assets[0].catalog!.biomes = ["changed"];
  expect(() => validateBake(p)).toThrow("modified");
});
