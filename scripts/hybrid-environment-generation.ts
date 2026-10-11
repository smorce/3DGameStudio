import { mkdir, readdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { environmentModelGlb } from "../packages/ai-dummy/src/environment-models";
import * as surfaces from "../packages/ai-dummy/src/environment-materials";
import {
  generateRuntime,
  runtimeIO,
} from "../packages/asset-pipeline/src/runtime";

const output = process.argv[2] ?? "test-results/hybrid-generation.json";
const measurements = [];
for (const kind of ["oak", "pine", "house"] as const)
  for (const level of [0, 1, 2]) {
    await environmentModelGlb(kind, 42, level);
    for (let repetition = 0; repetition < 3; repetition++) {
      const start = performance.now();
      const bytes = await environmentModelGlb(kind, 42, level);
      const geometryAndGlbMs = performance.now() - start;
      const pipelineStart = performance.now();
      const runtime = await generateRuntime(
        await runtimeIO().readBinary(bytes),
      );
      measurements.push({
        kind,
        level,
        repetition,
        geometryAndGlbMs,
        pipelineMs: performance.now() - pipelineStart,
        originalBytes: bytes.length,
        runtimeBytes: runtime.levels[0].bytes.length,
        triangles: runtime.levels[0].triangles,
      });
    }
  }
const textures = [];
if ("generatedSurfacePng" in surfaces) {
  const generate = surfaces.generatedSurfacePng as (
    surface: surfaces.EnvironmentSurface,
    seed: number,
  ) => Promise<Uint8Array>;
  for (const surface of ["wood", "stone", "roof", "plaster", "glass"] as const)
    for (let repetition = 0; repetition < 3; repetition++) {
      const start = performance.now();
      const bytes = await generate(surface, 42);
      textures.push({
        surface,
        repetition,
        pngMs: performance.now() - start,
        bytes: bytes.length,
      });
    }
}
const files = await readdir("demos/sample-worlds/assets");
const fileBytes = await Promise.all(
  files.map(async (file) => ({
    file,
    bytes: (await stat(path.join("demos/sample-worlds/assets", file))).size,
  })),
);
const library = JSON.parse(
  await readFile("demos/sample-worlds/library.json", "utf8"),
);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(
  output,
  JSON.stringify(
    {
      seed: 42,
      node: process.version,
      measurements,
      textures,
      totalSavedBytes: fileBytes.reduce((n, f) => n + f.bytes, 0),
      files: fileBytes,
      assets: library.filter((a: { catalog?: { slots: string[] } }) =>
        a.catalog?.slots.some((s) => s.includes(".quality.")),
      ),
    },
    null,
    2,
  ),
);
console.log(`Saved generation measurement: ${output}`);
