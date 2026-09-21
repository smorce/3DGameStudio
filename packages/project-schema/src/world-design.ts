import { z } from "zod";

const point = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
const positive = z.number().finite().positive();
const nonnegative = z.number().finite().nonnegative();
export const propRuleSchema = z
  .object({
    assetSlot: z.string().min(1),
    biome: z.string(),
    density: z.number().min(0).max(1),
    altitudeMin: z.number().finite(),
    altitudeMax: z.number().finite(),
    slopeMax: nonnegative,
    minDistanceFromRoad: nonnegative,
    minDistanceFromWater: nonnegative,
    minDistanceFromLandmark: nonnegative,
    minSpacing: positive.min(1),
    scaleRange: z.tuple([positive, positive]),
    rotationMode: z.enum(["none", "yaw"]),
  })
  .refine(
    (r) => r.altitudeMin <= r.altitudeMax && r.scaleRange[0] <= r.scaleRange[1],
    "Invalid prop range",
  );
export const mountainDefinitionSchema = z.object({
  center: point,
  radius: positive,
  height: nonnegative,
  falloff: positive,
});
export const islandDefinitionSchema = z
  .object({
    id: z.string().min(1),
    center: point,
    radius: positive,
    baseHeight: positive,
    coastWidth: positive,
    biome: z.string(),
    mountains: z.array(mountainDefinitionSchema),
    propRules: z.array(propRuleSchema),
  })
  .refine((i) => i.coastWidth <= i.radius, "Coast exceeds island radius");
export const roadDefinitionSchema = z.object({
  id: z.string().min(1),
  controlPoints: z.array(point).min(2),
  curve: z.literal("catmull-rom"),
  closed: z.boolean().optional(),
  width: positive,
  shoulderWidth: nonnegative,
  terrainFalloff: positive,
  elevationMode: z.enum(["absolute", "terrain"]),
});
export const landmarkDefinitionSchema = z.object({
  id: z.string().min(1),
  assetSlot: z.string().min(1),
  position: point,
  rotation: point,
  scale: point.refine(
    (v) => v.every((n) => n > 0 && n <= 100),
    "Invalid landmark scale",
  ),
  snapToTerrain: z.boolean(),
});
const region = z.object({
  id: z.string().min(1),
  center: point,
  radius: positive,
});
export const settlementBuildingRuleSchema = z.object({
  assetSlot: z.string().min(1),
  count: z.number().int().min(1).max(256),
  minSpacing: positive.min(1),
  minDistanceFromRoad: nonnegative.optional(),
  scaleRange: z
    .tuple([positive, positive])
    .refine((v) => v[0] <= v[1], "Invalid scale range")
    .optional(),
  rotationMode: z.enum(["none", "yaw"]).optional(),
});
export const settlementDefinitionSchema = region.extend({
  height: z.number().finite(),
  buildingRules: z.array(settlementBuildingRuleSchema),
});
export type SettlementBuildingRule = z.infer<
  typeof settlementBuildingRuleSchema
>;
export type SettlementDefinition = z.infer<typeof settlementDefinitionSchema>;
export const worldDesignSchema = z
  .object({
    version: z.number().int().positive(),
    islands: z.array(islandDefinitionSchema),
    roads: z.array(roadDefinitionSchema),
    settlements: z.array(settlementDefinitionSchema),
    airports: z.array(
      z.object({
        id: z.string().min(1),
        center: point,
        width: positive,
        length: positive,
        rotation: z.number().finite(),
        height: z.number().finite(),
      }),
    ),
    landmarks: z.array(landmarkDefinitionSchema),
    biomeRegions: z.array(region.extend({ biome: z.string() })),
    noSpawnRegions: z.array(region),
    gameplayRegions: z.array(region.extend({ purpose: z.string() })),
  })
  .superRefine((d, ctx) => {
    for (const items of [
      d.islands,
      d.roads,
      d.settlements,
      d.airports,
      d.landmarks,
      d.biomeRegions,
      d.noSpawnRegions,
      d.gameplayRegions,
    ]) {
      const ids = new Set<string>();
      for (const item of items) {
        if (ids.has(item.id))
          ctx.addIssue({ code: "custom", message: "Duplicate design ID" });
        ids.add(item.id);
      }
    }
  });
export type WorldDesign = z.infer<typeof worldDesignSchema>;
export type IslandDefinition = z.infer<typeof islandDefinitionSchema>;
export type MountainDefinition = z.infer<typeof mountainDefinitionSchema>;
export type RoadDefinition = z.infer<typeof roadDefinitionSchema>;
export type LandmarkDefinition = z.infer<typeof landmarkDefinitionSchema>;
export type PropRule = z.infer<typeof propRuleSchema>;

export const worldBuildManifestSchema = z.object({
  biomeProfileVersion: z.number().int().positive().optional(),
  worldDesignVersion: z.number().int(),
  worldId: z.string(),
  seed: z.number().int(),
  generatorVersion: z.number().int(),
  assetCatalogFingerprint: z.string(),
  worldFingerprint: z.string(),
  requiredAssets: z.array(
    z.object({
      id: z.string(),
      contentHash: z.string(),
      metadataHash: z.string().optional(),
    }),
  ),
  resolvedSlots: z.record(z.string(), z.array(z.string()).min(1)),
});
export type WorldBuildManifest = z.infer<typeof worldBuildManifestSchema>;
