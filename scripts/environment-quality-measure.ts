import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { parseProject } from "../packages/project-schema/src/index";
import {
  generateChunk,
  type GeneratorInput,
} from "../packages/world-generator/src/index";
import {
  runtimeIO,
  triangleCount,
} from "../packages/asset-pipeline/src/runtime";

/** 正式証跡更新時だけ実行する。近景カメラの比較と生成時間・素材容量を記録する。 */
const baseline = JSON.parse(
  await readFile(
    "docs/environment-quality/baseline/performance-summary.json",
    "utf8",
  ),
);
const final = JSON.parse(
  await readFile(
    "docs/environment-quality/phase4/performance-summary.json",
    "utf8",
  ),
);
const project = parseProject(
  JSON.parse(await readFile("demos/worlds/alpine-village.json", "utf8")),
);
if (project.world.source.kind !== "procedural")
  throw new Error("Expected procedural source");
const distribution = (values: number[]) => {
  const sorted = values.sort((a, b) => a - b),
    rank = (p: number) =>
      sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
  return {
    samples: sorted.length,
    median: rank(0.5),
    p95: rank(0.95),
    max: sorted.at(-1) ?? null,
  };
};
const generation = (source: Omit<GeneratorInput, "chunkX" | "chunkZ">) => {
  const times = [];
  // 両入力とも同じ順に1回ウォームアップしてから、同じ100Chunkを測る。
  generateChunk({ ...source, chunkX: 0, chunkZ: 0 });
  for (let z = -5; z < 5; z++)
    for (let x = -5; x < 5; x++) {
      const start = performance.now();
      generateChunk({ ...source, chunkX: x, chunkZ: z });
      times.push(performance.now() - start);
    }
  return distribution(times);
};
const originalSource = JSON.parse(
  await readFile("docs/environment-quality/baseline/world-source.json", "utf8"),
);
const measurements = [];
for (const asset of project.assets.filter((a) =>
  a.catalog?.slots.some((s) => s.includes(".quality.")),
)) {
  const lods = [];
  for (const lod of asset.runtimeInfo?.lods ?? []) {
    const bytes = await readFile(
      `demos/sample-worlds/assets/${path.basename(lod.file)}`,
    );
    const doc = await runtimeIO().readBinary(new Uint8Array(bytes));
    lods.push({
      level: lod.level,
      distance: lod.distance,
      bytes: bytes.length,
      triangles: triangleCount(doc),
      materials: doc.getRoot().listMaterials().length,
      textures: doc.getRoot().listTextures().length,
    });
  }
  measurements.push({
    slot: asset.catalog?.slots[0],
    assetId: asset.id,
    source: asset.source,
    license: asset.license,
    bounds: asset.runtimeInfo?.bounds,
    collider: asset.runtimeInfo?.collider,
    textureMemoryEstimateBytes: asset.runtimeInfo?.optimization?.textureBytes,
    lods,
  });
}
type View = { view: string; [key: string]: unknown };
const views = (data: typeof final): View[] =>
  data.runs.find((r: { id: string }) => r.id === "alpine-village").views;
const comparisons = views(final).map((view) => ({
  view: view.view,
  before: views(baseline).find((before) => before.view === view.view) ?? null,
  after: view,
  comparable:
    views(baseline).some((before) => before.view === view.view) &&
    view.view !== "driving",
}));
await writeFile(
  "docs/environment-quality/phase4/performance-comparison.json",
  JSON.stringify(
    {
      baselineCommit: "f72cf94",
      beforeEnvironment: baseline.environment,
      afterEnvironment: final.environment,
      backend: final.backend,
      limitation:
        "SwiftShader software GPU; not real hardware FPS. Camera and viewport matched for named views. Baseline geometry/texture counters were unavailable. Added village-square has no baseline camera. Short sampling windows limit p95 accuracy.",
      chunkGenerationMs: {
        before: generation(originalSource),
        after: generation(project.world.source),
      },
      assetMeasurements: measurements,
      views: comparisons,
    },
    null,
    2,
  ) + "\n",
);
