import { describe, expect, it } from "vitest";
import { sampleWorldCatalog } from "../../packages/sample-worlds/src/index";
import { planSampleWorldAssets } from "../../packages/sample-worlds/src/prepare";
import {
  parseProject,
  worldDesignSchema,
} from "../../packages/project-schema/src/index";
import {
  generateChunk,
  SemanticLayers,
} from "../../packages/world-generator/src/index";
import { evaluateRoad } from "../../packages/world-generator/src/semantic";
import {
  biomeSurfaceColor,
  biomeSurfaceProfilesV1,
} from "../../packages/world-generator/src/biome-surface";
import { buildIslandProxies } from "../../packages/world-generator/src/far-proxy";

describe("Sample World Catalog", () => {
  it("8個のID・表示順がuniqueで全DraftをSchemaで読める", () => {
    expect(sampleWorldCatalog).toHaveLength(8);
    expect(new Set(sampleWorldCatalog.map((w) => w.id)).size).toBe(8);
    expect(new Set(sampleWorldCatalog.map((w) => w.sortOrder)).size).toBe(8);
    for (const w of sampleWorldCatalog) {
      const project = parseProject(w.buildProject());
      expect(w.buildProject()).toEqual(project);
      expect(project.machines).toHaveLength(1);
      const s = project.world.source;
      if (s.kind === "procedural" && s.design)
        expect(worldDesignSchema.safeParse(s.design).success).toBe(true);
    }
  });
  it.each(sampleWorldCatalog)(
    "$id の地形とPropは決定的でMacroはseedによらない",
    (descriptor) => {
      const p = descriptor.buildProject();
      const source = p.world.source;
      if (source.kind !== "procedural") throw new Error("Missing source");
      const input = { ...source, chunkX: 2, chunkZ: 2 };
      const a = generateChunk(input);
      expect(generateChunk(input)).toEqual(a);
      expect(generateChunk({ ...input, seed: 79 }).heights).not.toEqual(
        a.heights,
      );
      if (source.design) {
        expect(
          new SemanticLayers(source.design, 42).sampleIslandMask(100, 100),
        ).toBe(
          new SemanticLayers(source.design, 79).sampleIslandMask(100, 100),
        );
        expect(buildIslandProxies(source.design, 42)).toHaveLength(
          source.design.islands.length,
        );
      }
    },
  );
  it("Biomeは決定的で砂漠に草色を使わず、雪線・南国paletteを使う", () => {
    const grass = new Set([
      ...biomeSurfaceProfilesV1.temperate.lowlandColors,
      ...biomeSurfaceProfilesV1.grassland.lowlandColors,
    ]);
    for (let y = -8; y < 130; y++) {
      const color = biomeSurfaceColor("desert", y, 0, 4, 7, 42);
      expect(color).toBe(biomeSurfaceColor("desert", y, 0, 4, 7, 42));
      expect(grass.has(color)).toBe(false);
    }
    expect(biomeSurfaceColor("snow", 24, 60, 0, 0, 42)).toBe(
      biomeSurfaceProfilesV1.snow.snowColor,
    );
    expect(biomeSurfaceColor("snow", 23.9, 0, 0, 0, 42)).not.toBe(
      biomeSurfaceProfilesV1.snow.snowColor,
    );
    expect(biomeSurfaceProfilesV1.tropical.lowlandColors).toContain(
      biomeSurfaceColor("tropical", 8, 0, 0, 0, 42),
    );
  });
  it("閉道路の位置・接線・地形Conformが継ぎ目で連続する", () => {
    const p = sampleWorldCatalog
      .find((w) => w.id === "race-island")!
      .buildProject();
    if (p.world.source.kind !== "procedural" || !p.world.source.design)
      throw new Error("Missing design");
    const layers = new SemanticLayers(p.world.source.design, 42);
    const road = layers.design.roads[0];
    expect(road.closed).toBe(true);
    expect(evaluateRoad(road, 0)).toEqual(evaluateRoad(road, 1));
    const a = evaluateRoad(road, 0.00001),
      b = evaluateRoad(road, 0.99999),
      start = evaluateRoad(road, 0);
    for (let i = 0; i < 3; i++)
      expect(a[i] - start[i]).toBeCloseTo(start[i] - b[i], 5);
    expect(layers.sampleHeight(a[0], a[2])).toBeCloseTo(
      layers.sampleHeight(b[0], b[2]),
      3,
    );
    expect(layers.sampleRoadInfluence(start[0], start[2]).weight).toBe(1);
    expect(p.settings.activeCourseId).toBe(p.courses[0].id);
  });
  it("Requirement unionはSlotを重複させず複数WorldのBiomeを保持する", async () => {
    const plan = await planSampleWorldAssets();
    expect(new Set(plan.requirements.map((r) => r.assetSlot)).size).toBe(
      plan.requirements.length,
    );
    expect(
      plan.requirements.find((r) => r.assetSlot === "nature.tree.alpine")
        ?.biomes,
    ).toEqual(["alpine", "snow"]);
    expect(
      plan.requirements.find((r) => r.assetSlot === "landmark.observatory")
        ?.biomes,
    ).toEqual(["alpine", "snow"]);
  });
});

it("旧3Presetの地形・色・Propは333a736の出力と完全一致する", async () => {
  const { createHash } = await import("node:crypto");
  const { default: baselines } =
    await import("../fixtures/legacy-world-baseline.json");
  for (const baseline of baselines) {
    const c = generateChunk({
      ...baseline.input,
      preset: baseline.input.preset as "grassland" | "airfield" | "archipelago",
    });
    expect(
      createHash("sha256")
        .update(
          JSON.stringify({
            heights: [...c.heights],
            colors: c.colors,
            entities: c.entities,
          }),
        )
        .digest("hex"),
    ).toBe(baseline.hash);
  }
});

it("Settlementの道路距離・縮尺・回転を反映して建物を配置する", () => {
  const source = sampleWorldCatalog
    .find((w) => w.id === "desert-island")!
    .buildProject().world.source;
  if (source.kind !== "procedural" || !source.design)
    throw new Error("Missing design");
  const rule = source.design.settlements[0].buildingRules[0];
  rule.minDistanceFromRoad = 20;
  rule.scaleRange = [1.5, 1.5];
  rule.rotationMode = "none";
  const layers = new SemanticLayers(source.design, source.seed);
  const buildings = [];
  for (let z = -1; z < 3; z++)
    for (let x = -4; x < 0; x++)
      buildings.push(
        ...generateChunk({ ...source, chunkX: x, chunkZ: z }).entities.filter(
          (e) => e.settlementId,
        ),
      );
  expect(buildings).toHaveLength(4);
  for (const b of buildings) {
    expect(b.scale).toEqual([1.5, 1.5, 1.5]);
    expect(b.rotation).toEqual([0, 0, 0]);
    expect(
      layers.sampleRoadInfluence(b.position[0], b.position[2]).distance,
    ).toBeGreaterThanOrEqual(20);
    for (const other of buildings)
      if (other.id !== b.id)
        expect(
          Math.hypot(
            other.position[0] - b.position[0],
            other.position[2] - b.position[2],
          ),
        ).toBeGreaterThanOrEqual(rule.minSpacing);
  }
});
it.each(["absolute", "terrain"] as const)(
  "閉道路%sのChunk共有辺と継ぎ目は連続する",
  (elevationMode) => {
    const source = sampleWorldCatalog
      .find((w) => w.id === "race-island")!
      .buildProject().world.source;
    if (source.kind !== "procedural" || !source.design)
      throw new Error("Missing design");
    const road = source.design.roads[0];
    road.elevationMode = elevationMode;
    const layers = new SemanticLayers(source.design, source.seed);
    const first = evaluateRoad(road, 0),
      last = evaluateRoad(road, 1);
    expect(layers.sampleHeight(first[0], first[2])).toBe(
      layers.sampleHeight(last[0], last[2]),
    );
    const a = generateChunk({ ...source, chunkX: -1, chunkZ: 0 }),
      b = generateChunk({ ...source, chunkX: 0, chunkZ: 0 });
    for (let z = 0; z < source.chunkResolution; z++) {
      expect(
        a.heights[z * source.chunkResolution + source.chunkResolution - 1],
      ).toBe(b.heights[z * source.chunkResolution]);
      expect(
        a.colors[z * source.chunkResolution + source.chunkResolution - 1],
      ).toBe(b.colors[z * source.chunkResolution]);
    }
  },
);

it("実Chunkの砂漠・雪・南国と遠景にもBiomeの色を反映する", () => {
  const colors = (id: string, chunkX: number, chunkZ: number) => {
    const source = sampleWorldCatalog.find((w) => w.id === id)!.buildProject()
      .world.source;
    if (source.kind !== "procedural" || !source.design)
      throw new Error("Missing design");
    return {
      chunk: generateChunk({ ...source, chunkX, chunkZ }),
      proxies: buildIslandProxies(source.design, source.seed),
    };
  };
  const desert = colors("desert-island", 1, 1),
    snow = colors("snow-island", 2, 3),
    tropical = colors("tropical-archipelago", 2, 2);
  for (const c of [
    ...desert.chunk.colors,
    ...desert.proxies.flatMap((p) => p.colors),
  ])
    expect(biomeSurfaceProfilesV1.temperate.lowlandColors).not.toContain(c);
  expect(snow.chunk.colors).toContain(biomeSurfaceProfilesV1.snow.snowColor);
  expect(snow.proxies[0].colors).toContain(
    biomeSurfaceProfilesV1.snow.snowColor,
  );
  expect(
    tropical.chunk.colors.some((c) =>
      biomeSurfaceProfilesV1.tropical.lowlandColors.includes(c),
    ),
  ).toBe(true);
});
