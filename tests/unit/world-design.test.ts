import { describe, expect, it } from "vitest";
import {
  emptyProject,
  parseProject,
  worldDesignSchema,
} from "../../packages/project-schema/src/index";
import {
  createProceduralWorld,
  deriveSeed,
  generateChunk,
  sampleGeneratedHeight,
  toyIslandsDesign,
  SemanticLayers,
  type GeneratorInput,
} from "../../packages/world-generator/src/index";
import { evaluateRoad } from "../../packages/world-generator/src/semantic";
import { validateWorld } from "../../packages/world-generator/src/validate";
import { buildIslandProxies } from "../../packages/world-generator/src/far-proxy";
import { WorldRuntime } from "../../packages/world-system/src/runtime";
import { prepareChunk } from "../../packages/world-generator/src/prepare";
const design = toyIslandsDesign();
const input = (x = 1, z = 1, seed = 42): GeneratorInput => ({
  seed,
  generatorVersion: 2,
  preset: "toy-islands",
  chunkX: x,
  chunkZ: z,
  chunkSize: 32,
  chunkResolution: 33,
  design,
});
const world = () => ({
  ...emptyProject().world,
  ...createProceduralWorld({ preset: "toy-islands", seed: 42 }),
});

describe("World Designと生成互換性", () => {
  it("Schemaで保存され、v6の既存Projectは変更されない", () => {
    const legacy = emptyProject();
    expect(parseProject(legacy)).toEqual(legacy);
    const p = { ...legacy, world: world() };
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(p.schemaVersion).toBe(6);
    expect(
      worldDesignSchema.safeParse({
        ...design,
        islands: [...design.islands, design.islands[0]],
      }).success,
    ).toBe(false);
  });
  it("同じseedで地形・配置が一致し、seed変更はMacroを維持して細部を変える", () => {
    const a = generateChunk(input(2, 2));
    generateChunk(input(-2, 4));
    expect(generateChunk(input(2, 2))).toEqual(a);
    expect(generateChunk(input(2, 2, 100)).heights).not.toEqual(a.heights);
    expect(generateChunk(input(2, 2, 100)).entities).not.toEqual(a.entities);
    expect(new SemanticLayers(design, 100).sampleIslandMask(10, 10)).toBe(
      new SemanticLayers(design, 42).sampleIslandMask(10, 10),
    );
  });
  it("Seed Namespaceは安定し無関係な系列に影響しない", () => {
    const tree = deriveSeed(42, "tree", "a");
    deriveSeed(42, "rock", "changed");
    expect(deriveSeed(42, "tree", "a")).toBe(tree);
    expect(deriveSeed(42, "tree", "b")).not.toBe(tree);
    expect(deriveSeed(42, "rock", "a")).not.toBe(tree);
    expect(deriveSeed(42, "tree", 1)).not.toBe(deriveSeed(42, "tree", "1"));
  });
  it.each([
    [1, 1],
    [-14, -11],
  ])("地形と道路はChunk共有辺で完全一致する %i %i", (x, z) => {
    const a = generateChunk(input(x, z)),
      b = generateChunk(input(x + 1, z));
    for (let i = 0; i < 33; i++)
      expect(a.heights[i * 33 + 32]).toBe(b.heights[i * 33]);
  });
  it("道路中心へ地形が追従し、路肩は滑らか", () => {
    const layers = new SemanticLayers(design, 42);
    for (let i = 0; i <= 20; i++) {
      const p = evaluateRoad(design.roads[0], i / 20);
      expect(layers.sampleHeight(p[0], p[2])).toBeCloseTo(p[1], 1);
    }
    const x = -460,
      z = -355;
    expect(
      Math.abs(layers.sampleHeight(x, z) - layers.sampleHeight(x + 0.01, z)),
    ).toBeLessThan(0.05);
  });
  it("No-Spawn・水面・傾斜・道路距離・隣接Chunk間隔を守る", () => {
    const layers = new SemanticLayers(design, 42);
    const chunks = Array.from({ length: 36 }, (_, i) =>
      input((i % 6) - 3, Math.floor(i / 6) - 3),
    );
    const entities = chunks
      .flatMap((i) => generateChunk(i).entities)
      .filter((e) => !e.landmark);
    expect(entities.length).toBeGreaterThan(15);
    for (const e of entities) {
      const [x, y, z] = e.position;
      expect(layers.sampleNoSpawnMask(x, z)).toBe(false);
      expect(y).toBeGreaterThan(0);
      const rule = design.islands[0].propRules.find(
        (r) => r.assetSlot === e.assetSlot,
      )!;
      expect(layers.sampleSlope(x, z)).toBeLessThanOrEqual(rule.slopeMax);
      expect(layers.sampleRoadInfluence(x, z).distance).toBeGreaterThanOrEqual(
        rule.minDistanceFromRoad,
      );
      for (const other of entities)
        if (other.id !== e.id) {
          const otherRule = design.islands[0].propRules.find(
            (r) => r.assetSlot === other.assetSlot,
          )!;
          expect(
            Math.hypot(x - other.position[0], z - other.position[2]),
          ).toBeGreaterThanOrEqual(
            Math.max(rule.minSpacing, otherRule.minSpacing),
          );
        }
    }
    expect(
      chunks
        .reverse()
        .flatMap((i) => generateChunk(i).entities)
        .map((e) => e.id)
        .sort(),
    ).toEqual(
      chunks
        .flatMap((i) => generateChunk(i).entities)
        .map((e) => e.id)
        .sort(),
    );
  });
  it("急斜面と滑走路ではPropを生成しない", () => {
    const constrained = structuredClone(design);
    constrained.islands[0].propRules.forEach((r) => {
      r.slopeMax = 0;
    });
    expect(
      generateChunk({ ...input(2, 2), design: constrained }).entities.filter(
        (e) => !e.landmark,
      ),
    ).toHaveLength(0);
    const runway = generateChunk(input(3, -15));
    const layers = new SemanticLayers(design, 42);
    expect(
      runway.entities
        .filter((e) => !e.landmark)
        .every((e) => !layers.sampleRunwayMask(e.position[0], e.position[2])),
    ).toBe(true);
  });
  it("編集OverlayとTombstoneをunload/reload後も維持する", () => {
    const w = world(),
      runtime = new WorldRuntime(w, { forceSyncWorkers: true });
    const chunk = runtime.getChunk("2,2")!;
    expect(chunk.entities.length).toBeGreaterThan(0);
    w.edits.generatedEntityTombstones.push(chunk.entities[0].id);
    w.edits.terrainChunks["2,2"] = {
      heightDeltas: { "0": 3 },
      colors: { "0": "#ffffff" },
    };
    runtime.reload(w);
    const after = runtime.getChunk("2,2")!;
    expect(after.entities.some((e) => e.id === chunk.entities[0].id)).toBe(
      false,
    );
    expect(after.heights[0]).toBeCloseTo(chunk.heights[0] + 3);
    expect(after.colors[0]).toBe("#ffffff");
    expect(runtime.sampleHeight(70, 70)).toBeGreaterThan(0);
    runtime.dispose();
    const prepared = prepareChunk({
      ...input(2, 2),
      terrainEdit: { heightDeltas: { "0": 3 } },
    });
    expect(prepared.heights[0]).toBeCloseTo(
      sampleGeneratedHeight({ ...input(2, 2), x: 64, z: 64 }) + 3,
    );
  });
  it("遠景Proxyは5島を表し、除外セルが32mChunkに一致する", () => {
    const proxies = buildIslandProxies(design, 42);
    expect(proxies).toHaveLength(5);
    for (const p of proxies) {
      expect(p.indices.length).toBe(p.cellKeys.length * 6);
      expect([...p.normals].every(Number.isFinite)).toBe(true);
      expect(
        Math.max(...p.positions.filter((_, i) => i % 3 === 1)),
      ).toBeGreaterThan(0);
    }
  });
  it("Validatorは不正Spawn・Landmark・Checkpoint・MissingAssetを区別する", () => {
    const w = world();
    w.spawnPoints = [[0, -2, 0]];
    if (w.source.kind !== "procedural" || !w.source.design)
      throw new Error("Missing design");
    w.source.design.landmarks[0].position = [900, -1, 900];
    w.source.design.landmarks[0].snapToTerrain = false;
    const issues = validateWorld(w, {
      courses: [
        {
          id: "c",
          name: "c",
          start: [0, 0, 0],
          goal: [0, 0, 0],
          path: [],
          checkpoints: [{ id: "bad", position: [0, -1, 0] }],
          obstacles: [],
          respawnPoints: [],
          metadata: {},
        },
      ],
    });
    expect(issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([
        "spawn-water",
        "spawn-underground",
        "landmark-water",
        "checkpoint-position",
        "missing-asset",
      ]),
    );
    const valid = validateWorld(world(), { canResolve: () => true });
    expect(valid.filter((i) => i.severity === "error")).toEqual([]);
  });
});

it("Validatorは急勾配warningとRunway/No-Spawn/陸地errorを検出する", () => {
  const w = world();
  if (w.source.kind !== "procedural" || !w.source.design)
    throw new Error("Missing design");
  w.source.design.roads[0].controlPoints = [
    [-450, 5, -350],
    [-440, 95, -350],
  ];
  const entities = [
    {
      id: "bad-prop",
      name: "bad",
      kind: "tree" as const,
      assetSlot: "nature.tree.temperate",
      position: [120, 6, -470] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    },
  ];
  const issues = validateWorld(w, { entities, canResolve: () => true });
  expect(issues).toContainEqual(
    expect.objectContaining({ severity: "warning", code: "road-slope" }),
  );
  expect(issues.map((i) => i.code)).toEqual(
    expect.arrayContaining(["prop-runway", "prop-no-spawn"]),
  );
  w.water.height = 1000;
  expect(
    validateWorld(w, { canResolve: () => true }).some(
      (i) => i.code === "island-no-land",
    ),
  ).toBe(true);
});
