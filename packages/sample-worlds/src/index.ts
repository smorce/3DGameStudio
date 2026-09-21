import {
  emptyProject,
  parseProject,
  type Project,
  type WorldDesign,
  type EnvironmentPreset,
  type Vec3,
} from "../../project-schema/src/index";
import {
  createProceduralWorld,
  SemanticLayers,
  sampleGeneratedHeight,
} from "../../world-generator/src/index";
import { evaluateRoad } from "../../world-generator/src/semantic";
import {
  starterCarTemplate,
  planeTemplate,
  boatTemplate,
  liftMachineToGround,
} from "../../machine-system/src/index";
import {
  tropicalDesign,
  mountainDesign,
  desertDesign,
  snowDesign,
  raceDesign,
} from "./designs";
export interface SampleWorldDescriptor {
  id: string;
  name: string;
  shortDescription: string;
  icon: string;
  tags: string[];
  recommendedMachine: "car" | "plane" | "boat";
  sortOrder: number;
  buildProject(): Project;
}
interface Definition extends Omit<SampleWorldDescriptor, "buildProject"> {
  preset?: EnvironmentPreset;
  design?: () => WorldDesign;
  sky: string;
  lighting?: Project["world"]["lighting"];
  spawn?: Vec3;
  course?: boolean;
}
const definitions: Definition[] = [
  {
    id: "starter-grassland",
    name: "はじまりの草原",
    shortDescription: "くるまで緩やかな丘を自由に走ろう",
    icon: "🌱",
    tags: ["grassland", "free-drive"],
    recommendedMachine: "car",
    sortOrder: 1,
    preset: "grassland",
    sky: "#c8e6f5",
  },
  {
    id: "airfield",
    name: "飛行場",
    shortDescription: "ひこうきで滑走路から空へ",
    icon: "✈️",
    tags: ["grassland", "flight"],
    recommendedMachine: "plane",
    sortOrder: 2,
    preset: "airfield",
    sky: "#c8e6f5",
  },
  {
    id: "tropical-archipelago",
    name: "南国の群島",
    shortDescription: "ボートで白い砂浜と5つの島をめぐろう",
    icon: "🌴",
    tags: ["tropical", "boat"],
    recommendedMachine: "boat",
    sortOrder: 3,
    design: tropicalDesign,
    sky: "#9fdde9",
    spawn: [0, 1.2, 245],
  },
  {
    id: "toy-islands",
    name: "おもちゃの5島",
    shortDescription: "おもちゃの群島で5つの島をたんけんしよう",
    icon: "🏝️",
    tags: ["temperate", "explore"],
    recommendedMachine: "car",
    sortOrder: 4,
    preset: "toy-islands",
    sky: "#c8e6f5",
  },
  {
    id: "mountain-island",
    name: "山岳島",
    shortDescription: "山腹道路を登り、観測所と展望地点へ",
    icon: "⛰️",
    tags: ["alpine", "climb"],
    recommendedMachine: "car",
    sortOrder: 5,
    design: mountainDesign,
    sky: "#c4d3df",
  },
  {
    id: "desert-island",
    name: "砂漠",
    shortDescription: "砂丘と前哨基地をつなぐ道でジャンプ",
    icon: "🌵",
    tags: ["desert", "jump"],
    recommendedMachine: "car",
    sortOrder: 6,
    design: desertDesign,
    sky: "#efdbc0",
    lighting: { intensity: 2.2, timeOfDay: 13 },
  },
  {
    id: "snow-island",
    name: "雪山",
    shortDescription: "雪の峠を登り、山頂の観測施設へ",
    icon: "❄️",
    tags: ["snow", "climb"],
    recommendedMachine: "car",
    sortOrder: 7,
    design: snowDesign,
    sky: "#dce8f2",
    lighting: { intensity: 1.8, timeOfDay: 14 },
  },
  {
    id: "race-island",
    name: "レースアイランド",
    shortDescription: "チェックポイントを通って島を一周",
    icon: "🏁",
    tags: ["temperate", "race"],
    recommendedMachine: "car",
    sortOrder: 8,
    design: raceDesign,
    sky: "#b8ddec",
    course: true,
  },
];
function build(definition: Definition): Project {
  const p = emptyProject();
  p.id = `sample-${definition.id}`;
  p.name = definition.name;
  p.world = {
    ...p.world,
    ...createProceduralWorld({
      id: definition.id,
      name: definition.name,
      preset: definition.preset ?? "designed-world",
      seed: 42,
    }),
  };
  const source = p.world.source;
  if (source.kind !== "procedural")
    throw new Error("Procedural source is required");
  if (definition.design) {
    source.design = definition.design();
    source.generatorVersion = 2;
  }
  const layers = source.design
    ? new SemanticLayers(source.design, source.seed)
    : undefined;
  const height = (x: number, z: number) =>
    layers
      ? layers.sampleHeight(x, z)
      : sampleGeneratedHeight({ ...source, x, z });
  const spawn: Vec3 = definition.spawn ?? [0, height(0, 0) + 2, 0];
  p.world.spawnPoints = [spawn];
  p.world.environment = {
    sky: definition.sky,
    fog: layers ? 0.00065 : p.world.environment.fog,
  };
  if (layers) p.world.water = { enabled: true, height: 0 };
  p.world.lighting = definition.lighting ?? { intensity: 2, timeOfDay: 14 };
  const templates = {
    car: starterCarTemplate,
    plane: planeTemplate,
    boat: boatTemplate,
  };
  const machine = templates[definition.recommendedMachine]();
  machine.id = `sample-${definition.id}-machine`;
  // Designのマシンは局所座標に置き、PhysicsがWorldのSpawnへ移動する。
  liftMachineToGround(machine, layers ? () => 0 : height);
  p.machines = [machine];
  if (definition.course && layers) {
    const path = Array.from({ length: 65 }, (_, i) => {
      const point = evaluateRoad(layers.design.roads[0], i / 64);
      point[1] = layers.sampleHeight(point[0], point[2]) + 0.2;
      return point;
    });
    p.courses = [
      {
        id: "island-race",
        name: "島を一周レース",
        path,
        start: [path[0][0], path[0][1] + 2, path[0][2]],
        goal: path.at(-1)!,
        checkpoints: [16, 32, 48].map((i) => ({
          id: `checkpoint-${i}`,
          position: path[i],
        })),
        // ランプはWorld DesignのAsset Slotから一度だけ配置する。
        obstacles: [],
        respawnPoints: [path[0]],
        metadata: {},
      },
    ];
  }
  if (definition.course) p.settings.activeCourseId = p.courses[0].id;
  // テンプレートが発行したUUIDを参照先・複合joint IDも含めて固定する。
  const ids = new Map<string, string>();
  return parseProject(
    JSON.parse(
      JSON.stringify(p, (_key, value) => {
        if (typeof value !== "string") return value;
        return value.replace(
          /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g,
          (id) => {
            if (!ids.has(id))
              ids.set(id, `sample-${definition.id}-${ids.size}`);
            return ids.get(id)!;
          },
        );
      }),
    ),
  );
}
export const sampleWorldCatalog: readonly SampleWorldDescriptor[] = [
  ...definitions,
]
  .sort((a, b) => a.sortOrder - b.sortOrder)
  .map((definition) => ({
    id: definition.id,
    name: definition.name,
    shortDescription: definition.shortDescription,
    icon: definition.icon,
    tags: definition.tags,
    recommendedMachine: definition.recommendedMachine,
    sortOrder: definition.sortOrder,
    buildProject: () => build(definition),
  }));
export const findSampleWorld = (id: string) =>
  sampleWorldCatalog.find((world) => world.id === id);
