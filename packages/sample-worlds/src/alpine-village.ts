import { SemanticLayers } from "../../world-generator/src/semantic";
import type {
  WorldDesign,
  PropRule,
  Vec3,
} from "../../project-schema/src/index";
import { alpineFields } from "../../world-generator/src/alpine-farmland";

/** 大きな陸地の内側を活動範囲にし、既存の島生成を内陸景観へ再利用する。 */
export function alpineVillageDesign(): WorldDesign {
  const tree = (assetSlot: string, density: number): PropRule => ({
    assetSlot,
    biome: "temperate",
    density,
    altitudeMin: 3,
    altitudeMax: assetSlot.endsWith(".oak") ? 80 : 150,
    slopeMax: 37,
    minDistanceFromRoad: 5,
    minDistanceFromWater: 10,
    minDistanceFromLandmark: 4,
    minSpacing: 9,
    scaleRange: [0.85, 1.9],
    rotationMode: "yaw",
  });
  const d: WorldDesign = {
    version: 2,
    islands: [
      {
        id: "alpine-mainland",
        center: [0, 0, -100],
        radius: 1600,
        coastWidth: 100,
        baseHeight: 12,
        biome: "temperate",
        mountains: Array.from({ length: 13 }, (_, i) => ({
          center: [-900 + i * 150, 0, -780 - (i % 3) * 80] as Vec3,
          radius: 185 + (i % 4) * 22,
          height: 135 + (i % 5) * 24,
          falloff: 1.1 + (i % 3) * 0.25,
        })).concat([
          { center: [-240, 0, -240], radius: 130, height: 27, falloff: 1.5 },
          { center: [240, 0, -180], radius: 160, height: 36, falloff: 1.5 },
        ]),
        propRules: [
          tree("nature.tree.alpine-village.pine", 0.87),
          tree("nature.tree.alpine-village.oak", 0.74),
        ],
      },
    ],
    roads: [
      {
        id: "village-lane",
        controlPoints: [
          [0, 12, 220],
          [12, 12, 110],
          [0, 12, 35],
          [-20, 12, -25],
          [0, 12, -80],
          [70, 12, -135],
          [150, 12, -155],
        ],
        curve: "catmull-rom",
        width: 9,
        shoulderWidth: 2,
        terrainFalloff: 16,
        elevationMode: "absolute",
      },
      {
        id: "mill-lane",
        controlPoints: [
          [-20, 12, -25],
          [-90, 12, -12],
          [-180, 13, -22],
          [-225, 17, -90],
        ],
        curve: "catmull-rom",
        width: 7,
        shoulderWidth: 2,
        terrainFalloff: 14,
        elevationMode: "absolute",
      },
    ],
    settlements: [
      {
        id: "alpine-village",
        center: [0, 12, -83],
        radius: 57,
        height: 12,
        buildingRules: ["stone", "timber", "barn"].map((kind, i) => ({
          assetSlot: `building.alpine-village.${kind}`,
          count: i === 2 ? 4 : 5,
          minSpacing: 18,
          minDistanceFromRoad: 9,
          scaleRange: [1.2, 1.45],
          rotationMode: "yaw" as const,
        })),
      },
    ],
    landmarks: [
      {
        id: "alpine-windmill",
        assetSlot: "landmark.alpine-village.windmill",
        position: [-205, 0, -65],
        rotation: [0, 0.12, 0],
        scale: [1.6, 1.6, 1.6],
        snapToTerrain: true,
      },
    ],
    airports: [],
    biomeRegions: [],
    noSpawnRegions: [
      { id: "arrival", center: [0, 0, 60], radius: 16 },
      { id: "mill-clearing", center: [-205, 0, -65], radius: 24 },
    ],
    gameplayRegions: [
      {
        id: "village-exploration",
        center: [0, 12, -80],
        radius: 320,
        purpose: "explore",
      },
    ],
  };
  const layers = new SemanticLayers(d, 42);
  for (const field of alpineFields) {
    field.points.forEach((a, i) => {
      const b = field.points[(i + 1) % field.points.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const count = Math.ceil(length / 3);
      for (let j = 0; j < count; j++) {
        const t = (j + 0.5) / count;
        const x = a[0] + (b[0] - a[0]) * t,
          z = a[1] + (b[1] - a[1]) * t;
        if (layers.sampleRoadInfluence(x, z, true).distance < 2.3) continue;
        d.landmarks.push({
          id: `${field.id}-wall-${i}-${j}`,
          assetSlot: "landscape.alpine-village.wall",
          position: [x, -0.12, z],
          rotation: [0, -Math.atan2(b[1] - a[1], b[0] - a[0]), 0],
          scale: [length / count / 3, 1.5 + (j % 3) * 0.12, 1.7],
          snapToTerrain: true,
        });
      }
    });
  }
  // 作物の配置はChunk生成で行い、Plannerには密度0のRuleで必要Slotを宣言する。
  d.islands[0].propRules.push({
    ...tree("landscape.alpine-village.wheat", 0),
    scaleRange: [1, 1],
  });
  return d;
}
