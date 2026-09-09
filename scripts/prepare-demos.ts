import { mkdir, readFile, writeFile, cp, access } from "node:fs/promises";
import path from "node:path";
import {
  emptyProject,
  identity,
  parseProject,
  type AssetRecord,
} from "../packages/project-schema/src/index";
import { carTemplate } from "../packages/machine-system/src/index";
import { courseTemplate } from "../packages/course-system/src/index";
await mkdir("demos", { recursive: true });
await mkdir("tests/fixtures", { recursive: true });
const car = emptyProject();
car.id = "demo-simple-car";
car.name = "板と4輪のくるま";
car.machines.push(carTemplate());
const island = structuredClone(car);
island.id = "demo-island-course";
island.name = "島のジャンプコース";
island.world.name = "みどりの島";
island.world.water = { enabled: true, height: -0.3 };
const t = island.world.terrain;
for (let z = 0; z < t.resolution; z++)
  for (let x = 0; x < t.resolution; x++) {
    const px = (x / (t.resolution - 1) - 0.5) * t.size,
      pz = (z / (t.resolution - 1) - 0.5) * t.size,
      r = Math.hypot(px, pz - 15);
    t.heights[z * t.resolution + x] =
      r < 38 ? 0 : Math.max(-3, -(r - 38) * 0.3);
    t.colors[z * t.resolution + x] = r > 34 ? "#cbb986" : "#7cab68";
  }
const course = courseTemplate("straight");
course.obstacles.push({
  id: "island-jump",
  kind: "jump",
  position: [0, 0, 8],
  size: [4, 1, 5],
});
island.courses.push(course);
for (let i = 0; i < 14; i++) {
  const a = (i / 14) * Math.PI * 2;
  island.world.entities.push({
    id: `tree-${i}`,
    name: "島の木",
    kind: "tree",
    transform: {
      ...identity(),
      position: [Math.cos(a) * 25, 0, 15 + Math.sin(a) * 20],
    },
  });
}
const assetWorld = structuredClone(car);
assetWorld.id = "demo-asset-world";
assetWorld.name = "Poly Havenの岩がある世界";
try {
  const asset = JSON.parse(
    await readFile("demos/external-asset-record.json", "utf8"),
  ) as AssetRecord;
  const dir = `.data/assets/${asset.id}`;
  await access(dir);
  assetWorld.assets.push(asset);
  for (let i = 0; i < 5; i++)
    assetWorld.world.entities.push({
      id: `asset-rock-${i}`,
      name: asset.name,
      kind: "asset",
      assetId: asset.id,
      transform: {
        ...identity(),
        position: [(i - 2) * 4, 0, 6],
        scale: [2, 2, 2],
      },
    });
  await mkdir("demos/assets", { recursive: true });
  await cp(dir, path.join("demos/assets", asset.id), { recursive: true });
  await writeFile(
    "demos/assets/library.json",
    JSON.stringify([asset], null, 2),
  );
} catch (error) {
  throw new Error(`External asset demo is not ready: ${String(error)}`);
}
for (const p of [car, island, assetWorld])
  await writeFile(
    `demos/${p.id}.json`,
    JSON.stringify(parseProject(p), null, 2),
  );
const fixtures: Record<string, unknown> = {
  "minimal-project": emptyProject(),
  "simple-car": car,
  "island-world": island,
  "simple-course": { ...car, courses: [courseTemplate("straight")] },
  "sample-assets": assetWorld,
  "broken-project": { schemaVersion: 1, broken: true },
  "old-schema-project": { ...car, schemaVersion: 0 },
};
for (const [name, data] of Object.entries(fixtures))
  await writeFile(`tests/fixtures/${name}.json`, JSON.stringify(data, null, 2));
console.log("Prepared 3 demo projects and 7 fixtures.");
