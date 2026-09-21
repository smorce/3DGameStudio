import type {
  WorldDesign,
  PropRule,
  Vec3,
  RoadDefinition,
} from "../../project-schema/src/index";
const rule = (assetSlot: string, biome: string): PropRule => ({
  assetSlot,
  biome,
  density: 0.32,
  altitudeMin: 2,
  altitudeMax: 120,
  slopeMax: 30,
  minDistanceFromRoad: 6,
  minDistanceFromWater: 8,
  minDistanceFromLandmark: 12,
  minSpacing: 13,
  scaleRange: [0.9, 1.3],
  rotationMode: "yaw",
});
const road = (controlPoints: Vec3[], closed = false): RoadDefinition => ({
  id: "main-road",
  controlPoints,
  closed,
  curve: "catmull-rom",
  width: 10,
  shoulderWidth: 4,
  terrainFalloff: 24,
  elevationMode: "absolute",
});
const landmark = (
  assetSlot: string,
  position: Vec3,
): WorldDesign["landmarks"][number] => ({
  id: assetSlot,
  assetSlot,
  position,
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  snapToTerrain: true,
});
function islandDesign(biome: string, slots: string[]): WorldDesign {
  return {
    version: 2,
    islands: [
      {
        id: "main",
        center: [0, 0, 0],
        radius: 320,
        coastWidth: 60,
        baseHeight: 8,
        biome,
        mountains: [],
        propRules: slots.map((s) => rule(s, biome)),
      },
    ],
    roads: [],
    settlements: [],
    airports: [],
    landmarks: [],
    biomeRegions: [],
    noSpawnRegions: [{ id: "spawn", center: [0, 0, 0], radius: 20 }],
    gameplayRegions: [],
  };
}
export function tropicalDesign() {
  const d = islandDesign("tropical", [
    "nature.tree.tropical",
    "nature.rock.small",
    "nature.rock.large",
  ]);
  d.islands[0].radius = 230;
  for (const [i, x, z, radius] of [
    [1, 400, 100, 140],
    [2, -370, 200, 125],
    [3, 80, -380, 145],
    [4, -330, -260, 100],
  ])
    d.islands.push({
      ...structuredClone(d.islands[0]),
      id: `island-${i}`,
      center: [x, 0, z],
      radius,
      coastWidth: 40,
    });
  d.settlements = [
    {
      id: "village",
      center: [65, 8, 40],
      radius: 36,
      height: 8,
      buildingRules: [
        { assetSlot: "building.village.house", count: 8, minSpacing: 12 },
      ],
    },
  ];
  d.landmarks = [
    landmark("landmark.lighthouse", [150, 0, 0]),
    landmark("road.sign", [30, 0, 20]),
  ];
  d.noSpawnRegions = [{ id: "harbor", center: [0, 0, 245], radius: 22 }];
  return d;
}
export function mountainDesign() {
  const d = islandDesign("alpine", [
    "nature.tree.alpine",
    "nature.rock.large",
    "nature.rock.small",
  ]);
  d.islands[0].mountains = [
    { center: [70, 0, 70], radius: 170, height: 100, falloff: 1.4 },
    { center: [-130, 0, 90], radius: 90, height: 42, falloff: 1.6 },
  ];
  d.roads = [
    road([
      [0, 8, 0],
      [-90, 14, -70],
      [-150, 22, 20],
      [-70, 38, 120],
      [30, 62, 115],
      [70, 74, 70],
    ]),
  ];
  d.landmarks = [
    landmark("landmark.observatory", [95, 0, 65]),
    landmark("road.sign", [-140, 0, 35]),
  ];
  d.gameplayRegions = [
    { id: "viewpoint", center: [70, 90, 70], radius: 25, purpose: "explore" },
  ];
  return d;
}
export function desertDesign() {
  const d = islandDesign("desert", [
    "nature.plant.cactus",
    "nature.rock.desert",
    "nature.rock.large",
  ]);
  d.islands[0].mountains = [
    { center: [100, 0, 100], radius: 135, height: 24, falloff: 1.2 },
    { center: [-150, 0, -80], radius: 85, height: 35, falloff: 0.8 },
    { center: [160, 0, -110], radius: 95, height: 16, falloff: 1.3 },
  ];
  d.roads = [
    road([
      [0, 8, 0],
      [0, 9, 90],
      [90, 14, 170],
      [190, 12, 100],
      [210, 9, -80],
      [100, 8, -190],
    ]),
  ];
  d.settlements = [
    {
      id: "outpost",
      center: [-65, 8, 35],
      radius: 32,
      height: 8,
      buildingRules: [
        { assetSlot: "building.desert.outpost", count: 4, minSpacing: 16 },
      ],
    },
  ];
  d.landmarks = [
    landmark("course.jump_ramp", [0, 0, 65]),
    landmark("road.sign", [15, 0, 45]),
  ];
  return d;
}
export function snowDesign() {
  const d = islandDesign("snow", [
    "nature.tree.alpine",
    "nature.rock.snow",
    "nature.rock.large",
  ]);
  d.islands[0].mountains = [
    { center: [60, 0, 105], radius: 170, height: 110, falloff: 1.3 },
    { center: [-130, 0, 90], radius: 100, height: 45, falloff: 1.5 },
  ];
  d.roads = [
    road([
      [0, 8, 0],
      [100, 16, -65],
      [190, 24, 15],
      [160, 38, 100],
      [80, 52, 180],
      [-10, 66, 145],
      [50, 76, 105],
    ]),
  ];
  d.landmarks = [
    landmark("landmark.observatory", [75, 0, 110]),
    landmark("road.sign", [180, 0, 35]),
  ];
  return d;
}
export function raceDesign() {
  const d = islandDesign("temperate", [
    "nature.tree.temperate",
    "nature.rock.small",
  ]);
  d.roads = [
    road(
      [
        [0, 8, 0],
        [0, 8, 110],
        [110, 14, 170],
        [200, 20, 70],
        [170, 12, -80],
        [50, 8, -130],
      ],
      true,
    ),
  ];
  d.islands[0].mountains = [
    { center: [100, 0, 60], radius: 95, height: 20, falloff: 1.5 },
  ];
  d.landmarks = [
    landmark("course.jump_ramp", [0, 0, 70]),
    landmark("road.sign", [15, 0, 35]),
  ];
  d.gameplayRegions = [
    { id: "race", center: [90, 8, 20], radius: 180, purpose: "race" },
  ];
  return d;
}
