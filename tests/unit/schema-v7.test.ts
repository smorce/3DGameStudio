import { expect, it } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  emptyProject,
  parseProject,
} from "../../packages/project-schema/src/index";
import { createProceduralWorld } from "../../packages/world-generator/src/index";
import { makeRecord } from "../../packages/asset-core/src/index";

it("v6有限Worldは内容を保持してv7へ移行し、保存・再読込が冪等になる", () => {
  const legacy = { ...emptyProject(), schemaVersion: 6 };
  const copy = structuredClone(legacy);
  const migrated = parseProject(legacy);
  expect(CURRENT_SCHEMA_VERSION).toBe(7);
  expect(migrated).toEqual({ ...legacy, schemaVersion: 7 });
  expect(legacy).toEqual(copy);
  expect(parseProject(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
  expect(() => parseProject({ ...legacy, schemaVersion: 8 })).toThrow();
});

it.each([false, true])(
  "v6のSettlement Slotを移行し固定の家との重複を避ける fixed=%s",
  (fixed) => {
    const project = emptyProject();
    project.world = createProceduralWorld({ preset: "toy-islands" });
    if (
      project.world.source.kind !== "procedural" ||
      !project.world.source.design
    )
      throw new Error("Missing design");
    const design = project.world.source.design;
    const settlement = design.settlements[0];
    if (fixed)
      design.landmarks.push({
        id: "old-house",
        assetSlot: "building.village.house",
        position: [45, 0, 30],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        snapToTerrain: true,
      });
    project.world.edits.generatedEntityTombstones.push("existing-tombstone");
    project.world.buildManifest = {
      worldDesignVersion: 1,
      worldId: project.world.id,
      seed: 42,
      generatorVersion: 2,
      assetCatalogFingerprint: "old",
      worldFingerprint: "old",
      requiredAssets: [],
      resolvedSlots: {},
    };
    const asset = makeRecord(
      {
        id: "texture",
        name: "PBR",
        provider: "ambientcg",
        sourceUrl: "https://ambientcg.com/",
        license: "CC0",
        author: "ambientCG",
        thumbnail: "",
        category: "texture",
      },
      "texture",
    );
    asset.type = "texture";
    asset.catalog = {
      slots: [],
      tags: [],
      biomes: [],
      style: "unverified",
      status: "unsupported",
      contentHash: "source-hash",
    };
    asset.textureInfo = {
      state: "unsupported",
      reason: "Texture rendering is not supported",
      files: [],
    };
    project.assets = [asset];
    const legacySettlement = {
      id: settlement.id,
      center: settlement.center,
      radius: settlement.radius,
      height: settlement.height,
    };
    const legacy = {
      ...project,
      schemaVersion: 6,
      world: {
        ...project.world,
        source: {
          ...project.world.source,
          design: {
            ...design,
            settlements: [
              { ...legacySettlement, assetSlot: "building.village.house" },
            ],
          },
        },
      },
    };
    const migrated = parseProject(legacy);
    if (
      migrated.world.source.kind !== "procedural" ||
      !migrated.world.source.design
    )
      throw new Error("Missing design");
    expect(migrated.world.source.design.settlements[0].buildingRules).toEqual(
      fixed
        ? []
        : [{ assetSlot: "building.village.house", count: 1, minSpacing: 12 }],
    );
    expect(migrated.world.source.design.landmarks).toEqual(design.landmarks);
    expect(migrated.world.edits).toEqual(project.world.edits);
    expect(migrated.assets).toEqual(project.assets);
    expect(migrated.world.buildManifest).toBeUndefined();
    expect(parseProject(JSON.parse(JSON.stringify(migrated)))).toEqual(
      migrated,
    );
  },
);
