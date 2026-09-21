import type {
  WorldDesign,
  PropRule,
  Vec3,
} from "../../project-schema/src/index";
const rule = (assetSlot: string, biome: string, minSpacing = 9): PropRule => ({
  assetSlot,
  biome,
  density: 0.48,
  altitudeMin: 1,
  altitudeMax: 120,
  slopeMax: 28,
  minDistanceFromRoad: 5,
  minDistanceFromWater: 8,
  minDistanceFromLandmark: 12,
  minSpacing,
  scaleRange: [0.85, 1.3],
  rotationMode: "yaw",
});
/** 島の位置と意味を保存する独自群島。細部と配置だけをseedで変化させる。 */
export function toyIslandsDesign(): WorldDesign {
  const islands = [
    {
      id: "central",
      center: [0, 0, 0] as Vec3,
      radius: 190,
      baseHeight: 6,
      coastWidth: 45,
      biome: "temperate",
      mountains: [],
      propRules: [
        rule("nature.tree.temperate", "temperate"),
        rule("nature.rock.small", "temperate", 7),
      ],
    },
    {
      id: "tropical",
      center: [470, 0, 220] as Vec3,
      radius: 165,
      baseHeight: 7,
      coastWidth: 45,
      biome: "tropical",
      mountains: [],
      propRules: [rule("nature.tree.tropical", "tropical")],
    },
    {
      id: "mountain",
      center: [-430, 0, 310] as Vec3,
      radius: 200,
      baseHeight: 8,
      coastWidth: 50,
      biome: "alpine",
      mountains: [
        {
          center: [-440, 0, 330] as Vec3,
          radius: 135,
          height: 85,
          falloff: 1.4,
        },
      ],
      propRules: [rule("nature.rock.large", "alpine", 12)],
    },
    {
      id: "airfield",
      center: [120, 0, -470] as Vec3,
      radius: 220,
      baseHeight: 6,
      coastWidth: 45,
      biome: "grassland",
      mountains: [],
      propRules: [rule("nature.rock.small", "grassland")],
    },
    {
      id: "race",
      center: [-410, 0, -340] as Vec3,
      radius: 175,
      baseHeight: 8,
      coastWidth: 45,
      biome: "temperate",
      mountains: [
        {
          center: [-440, 0, -380] as Vec3,
          radius: 90,
          height: 16,
          falloff: 1.5,
        },
      ],
      propRules: [rule("nature.tree.temperate", "temperate")],
    },
  ];
  return {
    version: 2,
    islands,
    roads: [
      {
        id: "race-road",
        controlPoints: [
          [-500, 9, -340],
          [-450, 12, -360],
          [-390, 10, -325],
          [-320, 8, -335],
        ],
        curve: "catmull-rom",
        width: 8,
        shoulderWidth: 3,
        terrainFalloff: 16,
        elevationMode: "absolute",
      },
    ],
    settlements: [
      {
        id: "village",
        center: [45, 6, 30],
        radius: 22,
        height: 6,
        buildingRules: [
          { assetSlot: "building.village.house", count: 8, minSpacing: 12 },
        ],
      },
    ],
    airports: [
      {
        id: "runway",
        center: [120, 6, -470],
        width: 28,
        length: 270,
        rotation: 0,
        height: 6,
      },
    ],
    landmarks: [
      {
        id: "lighthouse",
        assetSlot: "landmark.lighthouse",
        position: [550, 0, 235] as Vec3,
      },
      {
        id: "observatory",
        assetSlot: "landmark.observatory",
        position: [-440, 0, 330] as Vec3,
      },
      {
        id: "tower",
        assetSlot: "airport.control_tower",
        position: [155, 0, -470] as Vec3,
      },
      {
        id: "ramp",
        assetSlot: "course.jump_ramp",
        position: [-390, 0, -325] as Vec3,
      },
      { id: "sign", assetSlot: "road.sign", position: [-485, 0, -327] as Vec3 },
    ].map((l) => ({
      ...l,
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      snapToTerrain: true,
    })),
    biomeRegions: [],
    noSpawnRegions: [{ id: "spawn", center: [0, 0, 0], radius: 18 }],
    gameplayRegions: [
      {
        id: "race-course",
        center: [-410, 0, -340],
        radius: 120,
        purpose: "race",
      },
    ],
  };
}
