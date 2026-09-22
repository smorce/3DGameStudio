import {
  emptyProject,
  parseProject,
  type Project,
  type WorldDesign,
  type EnvironmentPreset,
  type Vec3,
} from "../../project-schema/src/index";
import {
  CURRENT_BIOME_PROFILE_VERSION,
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
import {
  sampleWorldCatalog as metadata,
  type SampleWorldMetadata,
} from "./metadata";
export interface SampleWorldDescriptor extends SampleWorldMetadata {
  /** Prepared Manifestの biomeProfileVersion と一致させる。 */
  biomeProfileVersion: number;
  buildProject(): Project;
}
/** Worldを組み立てる入力。biomeProfileVersionはDescriptor側の属性。 */
interface Definition extends SampleWorldMetadata {
  preset?: EnvironmentPreset;
  design?: () => WorldDesign;
  sky: string;
  lighting?: Project["world"]["lighting"];
  spawn?: Vec3;
  course?: boolean;
}
const configurations: Record<
  string,
  Omit<Definition, keyof SampleWorldMetadata>
> = {
  "starter-grassland": {
    preset: "grassland",
    sky: "#c8e6f5",
  },
  airfield: {
    preset: "airfield",
    sky: "#c8e6f5",
  },
  "tropical-archipelago": {
    design: tropicalDesign,
    sky: "#9fdde9",
    spawn: [0, 1.2, 245],
  },
  "toy-islands": {
    preset: "toy-islands",
    sky: "#c8e6f5",
  },
  "mountain-island": {
    design: mountainDesign,
    sky: "#c4d3df",
  },
  "desert-island": {
    design: desertDesign,
    sky: "#efdbc0",
    lighting: { intensity: 2.2, timeOfDay: 13 },
  },
  "snow-island": {
    design: snowDesign,
    sky: "#dce8f2",
    lighting: { intensity: 1.8, timeOfDay: 14 },
  },
  "race-island": {
    design: raceDesign,
    sky: "#b8ddec",
    course: true,
  },
};
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
export const sampleWorldCatalog: readonly SampleWorldDescriptor[] =
  metadata.map((item) => ({
    ...item,
    biomeProfileVersion: CURRENT_BIOME_PROFILE_VERSION,
    buildProject: () => build({ ...item, ...configurations[item.id] }),
  }));
export const findSampleWorld = (id: string) =>
  sampleWorldCatalog.find((world) => world.id === id);
