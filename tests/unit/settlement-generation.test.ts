import { expect, it } from "vitest";
import {
  createProceduralWorld,
  generateChunk,
  SemanticLayers,
} from "../../packages/world-generator/src/index";
import { validateWorld } from "../../packages/world-generator/src/validate";
import { DummyAssetRequirementPlanner } from "../../packages/asset-factory/src/planner";

it("町から8棟を決定的に生成し、距離・地表・Chunk境界・Planner・Validatorをつなぐ", async () => {
  const world = createProceduralWorld({ preset: "toy-islands", seed: 42 });
  if (world.source.kind !== "procedural" || !world.source.design)
    throw new Error("Missing design");
  const source = world.source,
    design = world.source.design;
  const keys = [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ];
  const generate = (seed = 42) =>
    keys.flatMap(
      ([x, z]) =>
        generateChunk({ ...source, seed, chunkX: x, chunkZ: z }).entities,
    );
  const all = generate(),
    buildings = all.filter((e) => e.settlementId === "village");
  expect(buildings).toHaveLength(8);
  expect(new Set(buildings.map((e) => e.id)).size).toBe(8);
  const layers = new SemanticLayers(design, source.seed);
  for (const a of buildings) {
    const [x, y, z] = a.position;
    expect(layers.sampleSettlementMask(x, z)).toBe(true);
    expect(layers.sampleNoSpawnMask(x, z, "village")).toBe(false);
    expect(y).toBeCloseTo(layers.sampleHeight(x, z));
    expect(a.assetSlot).toBe("building.village.house");
    for (const b of buildings)
      if (a !== b)
        expect(
          Math.hypot(x - b.position[0], z - b.position[2]),
        ).toBeGreaterThanOrEqual(12);
  }
  const sorted = () => generate().sort((a, b) => a.id.localeCompare(b.id));
  const before = sorted();
  keys.reverse();
  expect(sorted()).toEqual(before);
  expect(generate(43).filter((e) => e.settlementId)).not.toEqual(buildings);
  expect(
    (await new DummyAssetRequirementPlanner().plan(design)).requirements,
  ).toContainEqual(
    expect.objectContaining({
      assetSlot: "building.village.house",
      minVariants: 3,
    }),
  );
  expect(
    validateWorld(world, { entities: all, canResolve: () => true }).filter(
      (i) => i.severity === "error",
    ),
  ).toEqual([]);
  design.settlements[0].buildingRules[0].count = 100;
  expect(
    validateWorld(world, { entities: all, canResolve: () => true }),
  ).toContainEqual(
    expect.objectContaining({
      code: "settlement-building-count",
      severity: "error",
    }),
  );
});

it("町の建物も明示No-Spawnと滑走路を避け、配置不可能ならValidatorが不足を報告する", () => {
  const world = createProceduralWorld({ preset: "toy-islands" });
  if (world.source.kind !== "procedural" || !world.source.design)
    throw new Error("Missing design");
  const source = world.source,
    design = world.source.design;
  design.noSpawnRegions.push({
    id: "closed-town",
    center: [45, 0, 30],
    radius: 30,
  });
  const entities = generateChunk({ ...source, chunkX: 1, chunkZ: 0 }).entities;
  expect(entities.filter((e) => e.settlementId)).toHaveLength(0);
  expect(
    validateWorld(world, { entities, canResolve: () => true }),
  ).toContainEqual(
    expect.objectContaining({ code: "settlement-building-count" }),
  );
});
