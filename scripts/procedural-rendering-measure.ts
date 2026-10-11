import { mkdir, readFile, writeFile, stat, readdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { generateChunk } from "../packages/world-generator/src/index";
import { parseProject } from "../packages/project-schema/src/index";
import { grassGeometry } from "../packages/renderer-three/src/vegetation";
import { vegetationPlacements } from "../packages/world-generator/src/vegetation";

/** 生成時間はブラウザの描画時間と混ぜず、通常測定の出力へ記録する。 */
const project = parseProject(
  JSON.parse(await readFile("demos/worlds/alpine-village.json", "utf8")),
);
const source = project.world.source;
if (source.kind !== "procedural") throw new Error("Expected procedural world");
const distribution = (values: number[]) => {
  const sorted = values.sort((a, b) => a - b);
  return {
    samples: sorted.length,
    median: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
};
const chunk = [];
const placement = [];
const geometry: Record<string, number[]> = { A0: [], A2: [] };
for (let repetition = -1; repetition < 3; repetition++) {
  for (let z = -5; z < 5; z++)
    for (let x = -5; x < 5; x++) {
      const started = performance.now();
      generateChunk({ ...source, chunkX: x, chunkZ: z });
      if (repetition >= 0) chunk.push(performance.now() - started);
    }
  for (const broad of [false, true]) {
    const started = performance.now();
    const geometries = [grassGeometry(8, broad), grassGeometry(3, broad)];
    if (repetition >= 0)
      geometry[broad ? "A2" : "A0"].push(performance.now() - started);
    geometries.forEach((g) => g.dispose());
  }
  const start = performance.now();
  vegetationPlacements({
    seed: source.seed,
    bounds: { minX: -128, minZ: -128, maxX: 0, maxZ: 0 },
    area: { minX: -128, minZ: -128, maxX: 0, maxZ: 0 },
    height: () => 0,
    allowed: () => true,
  });
  if (repetition >= 0) placement.push(performance.now() - start);
}
let assetBytes = 0;
for (const name of await readdir("demos/sample-worlds/assets"))
  assetBytes += (await stat(`demos/sample-worlds/assets/${name}`)).size;
await mkdir("test-results/procedural-measure", { recursive: true });
await writeFile(
  "test-results/procedural-measure/generation.json",
  JSON.stringify(
    {
      node: process.version,
      seed: source.seed,
      generatorVersion: source.generatorVersion,
      chunkGenerationMs: distribution(chunk),
      flatUnrestrictedPlacementMs: distribution(placement),
      grassGeometryGenerationMs: Object.fromEntries(
        Object.entries(geometry).map(([key, value]) => [
          key,
          distribution(value),
        ]),
      ),
      sampleWorldAssetBytes: assetBytes,
      limitations:
        "CPU Node measurements; one warm-up then three repetitions. Placement uses flat unrestricted terrain and is not browser chunk preparation. Asset bytes include all sample worlds and are unchanged by diagnostic grass modes. A1 masks are generated lazily in the renderer and require a separate browser preparation measurement.",
    },
    null,
    2,
  ),
);
