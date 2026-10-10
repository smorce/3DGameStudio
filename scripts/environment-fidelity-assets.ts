import { getBounds } from "@gltf-transform/functions";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { parseProject } from "../packages/project-schema/src/index";
import { generateChunk } from "../packages/world-generator/src/index";
import {
  runtimeIO,
  triangleCount,
} from "../packages/asset-pipeline/src/runtime";

/** 正式測定時に明示実行し、モデルとChunk生成の内訳を保存する。 */
const phase = process.argv[2];
if (!["before", "phase-a", "phase-b", "phase-c"].includes(phase))
  throw new Error("Expected fidelity phase");
const project = parseProject(
  JSON.parse(await readFile("demos/worlds/alpine-village.json", "utf8")),
);
if (project.world.source.kind !== "procedural")
  throw new Error("Expected procedural source");
const assets = [];
for (const asset of project.assets.filter((a) =>
  a.catalog?.slots.some((s) => s.includes(".quality.")),
)) {
  const lods = [];
  for (const lod of asset.runtimeInfo?.lods ?? []) {
    const bytes = await readFile(
      `demos/sample-worlds/assets/${path.basename(lod.file)}`,
    );
    const doc = await runtimeIO().readBinary(new Uint8Array(bytes));
    const leaves = doc
      .getRoot()
      .listMeshes()
      .flatMap((m) => m.listPrimitives())
      .filter((p) =>
        ["leaf", "needle"].includes(p.getMaterial()?.getName() ?? ""),
      );
    lods.push({
      level: lod.level,
      distance: lod.distance,
      bytes: bytes.length,
      triangles: triangleCount(doc),
      bounds: getBounds(doc.getRoot().listScenes()[0]),
      recipeSeed: doc.getRoot().listScenes()[0].getExtras().environmentSeed,
      materials: doc.getRoot().listMaterials().length,
      textures: doc.getRoot().listTextures().length,
      leafCards: leaves.reduce(
        (sum, p) =>
          sum +
          (p.getIndices()?.getCount() ??
            p.getAttribute("POSITION")?.getCount() ??
            0) /
            6,
        0,
      ),
    });
  }
  assets.push({ slot: asset.catalog?.slots[0], lods });
}
const runs = [];
for (let run = 0; run < 3; run++) {
  generateChunk({ ...project.world.source, chunkX: 0, chunkZ: 0 });
  const times = [];
  for (let z = -5; z < 5; z++)
    for (let x = -5; x < 5; x++) {
      const start = performance.now();
      generateChunk({ ...project.world.source, chunkX: x, chunkZ: z });
      times.push(performance.now() - start);
    }
  times.sort((a, b) => a - b);
  runs.push({
    samples: times.length,
    median: times[49],
    p95: times[94],
    min: times[0],
    max: times.at(-1),
  });
}
const output = `docs/environment-quality/fidelity-optimization/${phase}`;
await mkdir(output, { recursive: true });
await writeFile(
  `${output}/asset-measurements.json`,
  JSON.stringify(
    {
      assets,
      chunkGenerationMs: runs,
      limitation:
        "Generator CPU measurement excludes Renderer grass setup, GLB loads and GPU upload; browser may be concurrently rendering.",
    },
    null,
    2,
  ) + "\n",
);
