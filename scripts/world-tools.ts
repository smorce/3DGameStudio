import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  emptyProject,
  assetSchema,
  parseProject,
  type Project,
} from "../packages/project-schema/src/index";
import {
  createProceduralWorld,
  generateChunk,
  SemanticLayers,
} from "../packages/world-generator/src/index";
import { validateWorld } from "../packages/world-generator/src/validate";
import { AssetCatalog } from "../packages/asset-catalog/src/index";
import {
  AssetFactory,
  DummyAssetRequirementPlanner,
  type FactoryMode,
} from "../packages/asset-factory/src/index";
import { bakeWorld, validateBake } from "../packages/asset-factory/src/bake";
import { DummyAstraAssetGenerator } from "../packages/ai-dummy/src/asset-generator";
import {
  LocalLibraryProvider,
  KenneyPackProvider,
  PolyHavenProvider,
  AmbientCGProvider,
  KayKitLocalPackProvider,
} from "../packages/asset-providers/src/index";
import { LocalAssetStorage } from "../packages/storage/src/local";
import {
  starterCarTemplate,
  liftMachineToGround,
} from "../packages/machine-system/src/index";
import { evaluateRoad } from "../packages/world-generator/src/semantic";

const command = process.argv[2];
const option = (name: string, fallback: string) =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? fallback;
const root = option("data-dir", process.env.ASSET_DATA_DIR ?? ".data");
const file = option("project", path.join(root, "worlds/toy-islands.json"));
let project: Project;
try {
  project = parseProject(JSON.parse(await readFile(file, "utf8")));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  project = emptyProject();
  project.id = "toy-islands-project";
  project.world = {
    ...project.world,
    ...createProceduralWorld({
      preset: "toy-islands",
      id: "toy-islands",
      seed: 42,
    }),
  };
  const source = project.world.source;
  if (source.kind !== "procedural" || !source.design)
    throw new Error("Missing World Design");
  const layers = new SemanticLayers(source.design, source.seed);
  const machine = starterCarTemplate();
  liftMachineToGround(machine, () => 0);
  project.machines = [machine];
  const road = source.design.roads[0];
  const coursePath = Array.from({ length: 41 }, (_, i) => {
    const p = evaluateRoad(road, i / 40);
    p[1] = layers.sampleHeight(p[0], p[2]) + 0.15;
    return p;
  });
  project.courses = [
    {
      id: "toy-race",
      name: "群島の丘めぐり",
      path: coursePath,
      start: [coursePath[0][0], coursePath[0][1] + 2, coursePath[0][2]],
      goal: coursePath.at(-1)!,
      checkpoints: [10, 20, 30].map((i) => ({
        id: `race-check-${i}`,
        position: coursePath[i],
      })),
      obstacles: [],
      respawnPoints: [coursePath[0]],
      metadata: {},
    },
  ];
}
if (project.world.source.kind !== "procedural" || !project.world.source.design)
  throw new Error("World Design is required");
const source = project.world.source,
  design = source.design!;
const catalog = new AssetCatalog(project);
const plan = await new DummyAssetRequirementPlanner().plan(design);
const save = async () => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(project, null, 2));
};
if (command === "plan") console.log(JSON.stringify(plan, null, 2));
else if (command === "factory") {
  const mode = option("mode", "dry-run");
  if (!["offline", "dry-run", "acquire"].includes(mode))
    throw new Error("Invalid factory mode");
  const storage = new LocalAssetStorage(path.join(root, "assets"));
  let local = new LocalLibraryProvider();
  if (mode !== "dry-run") {
    try {
      const records = assetSchema
        .array()
        .parse(
          JSON.parse(await readFile(path.join(root, "library.json"), "utf8")),
        )
        .filter((a) => a.type === "model");
      const files = new Map(
        records.map((a) => [a.id, a.files.runtime.replace("/api/files/", "")]),
      );
      local = new LocalLibraryProvider(
        records.map((a) => ({
          id: a.id,
          name: a.name,
          provider: "local",
          sourceUrl: a.source.sourceUrl,
          author: a.source.author,
          license: a.license.id,
          thumbnail: a.files.thumbnail,
          style: a.catalog?.style,
          styleReview:
            a.catalog?.styleAssessment === "reviewed" ? "reviewed" : undefined,
          category: [
            ...(a.catalog?.tags ?? []),
            ...(a.catalog?.slots ?? []),
          ].join(" "),
        })),
        new Map(),
        async (id) => {
          const file = files.get(id);
          if (!file) throw new Error("Local asset file not found");
          return storage.load(file);
        },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const factory = new AssetFactory(
    catalog,
    storage,
    [
      local,
      new KenneyPackProvider(),
      new PolyHavenProvider(),
      new AmbientCGProvider(),
      new KayKitLocalPackProvider(),
    ],
    new DummyAstraAssetGenerator(),
  );
  const result = await factory.fulfill(plan, mode as FactoryMode, source.seed);
  if (mode !== "dry-run") await save();
  console.log(JSON.stringify(result, null, 2));
  if (mode !== "dry-run" && result.missing.length) process.exitCode = 1;
} else if (command === "validate" || command === "bake") {
  const entities = design.islands.flatMap((island) => {
    const generated = [];
    for (
      let z = Math.floor((island.center[2] - island.radius) / source.chunkSize);
      z <= Math.floor((island.center[2] + island.radius) / source.chunkSize);
      z++
    )
      for (
        let x = Math.floor(
          (island.center[0] - island.radius) / source.chunkSize,
        );
        x <= Math.floor((island.center[0] + island.radius) / source.chunkSize);
        x++
      )
        generated.push(
          ...generateChunk({ ...source, chunkX: x, chunkZ: z }).entities,
        );
    return generated;
  });
  const issues = validateWorld(project.world, {
    entities,
    courses: project.courses,
    canResolve: (slot, biome) =>
      catalog.resolveAssetSlot(slot, {
        seed: source.seed,
        biome,
        style: "stylized-low-poly",
      }).status === "resolved",
  });
  console.log(
    JSON.stringify(
      { world: project.world.id, generatedProps: entities.length, issues },
      null,
      2,
    ),
  );
  if (issues.some((i) => i.severity === "error")) process.exitCode = 1;
  else if (command === "bake") {
    console.log(JSON.stringify(bakeWorld(project, catalog), null, 2));
    validateBake(project);
    await save();
  }
} else throw new Error("Unknown world command");
