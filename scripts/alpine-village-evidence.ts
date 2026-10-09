import { runtimeIO } from "../packages/asset-pipeline/src/runtime";
import { parseProject } from "../packages/project-schema/src/index";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { AgentGameState } from "../packages/engine-core/src/agent-observation";
import { findSampleWorld } from "../packages/sample-worlds/src/index";
import { generateChunk } from "../packages/world-generator/src/index";

/** nearest-rank法。nullや取得できない値を0として数えない。 */
function distribution(values: (number | null | undefined)[]) {
  const sorted = values
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  const rank = (p: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
  return {
    samples: sorted.length,
    median: rank(0.5),
    p95: rank(0.95),
    max: sorted.at(-1) ?? null,
  };
}
let output: string | undefined;
for (const root of ["test-results/alpine-isolated", "test-results"]) {
  let directories: string[];
  try {
    directories = await readdir(root);
  } catch {
    continue;
  }
  for (const folder of directories.filter((name) =>
    name.startsWith("alpine-village-Alpine-Village-"),
  )) {
    const candidate = path.join(root, folder);
    try {
      await readFile(path.join(candidate, "performance.json"));
      output = candidate;
      break;
    } catch {
      continue;
    }
  }
  if (output) break;
}
if (!output) throw new Error("Alpine Village browser evidence was not found");
const raw = JSON.parse(
  await readFile(path.join(output, "performance.json"), "utf8"),
) as {
  environment: unknown;
  backend: string;
  sampleWindowMs: number;
  runs: {
    id: string;
    states: {
      view: string;
      samples: AgentGameState[];
      memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
      } | null;
    }[];
    before: AgentGameState;
    after: AgentGameState;
    chunkEvents?: unknown[];
  }[];
};
const alpine = parseProject(
  JSON.parse(await readFile("demos/worlds/alpine-village.json", "utf8")),
);
const assetMeasurements = [];
for (const slot of new Set(
  alpine.assets.flatMap((asset) => asset.catalog?.slots ?? []),
)) {
  const variants = alpine.assets.filter((asset) =>
      asset.catalog?.slots.includes(slot),
    ),
    asset = variants[0];
  const doc = await runtimeIO().readBinary(
    new Uint8Array(
      await readFile(
        `demos/sample-worlds/assets/${path.basename(asset.files.runtime)}`,
      ),
    ),
  );
  assetMeasurements.push({
    slot,
    variants: variants.length,
    source: asset.source.sourceUrl,
    license: asset.license.id,
    runtimeBytes: asset.runtimeInfo?.optimization?.runtimeBytes,
    triangles: asset.runtimeInfo?.triangles,
    materials: doc.getRoot().listMaterials().length,
    textures: doc.getRoot().listTextures().length,
    bounds: asset.runtimeInfo?.bounds,
    collider: asset.runtimeInfo?.collider,
    lods: asset.runtimeInfo?.lods,
  });
}
const result = {
  assetMeasurements,
  method:
    "Nearest-rank median/p95 over distinct rendered frames; renderMs is CPU submission time. Frame RAF includes GPU/software rasterization, scheduling and other work. Initial is the first short window after wheels contact, not cold page-load time.",
  backend: raw.backend,
  environment: raw.environment,
  requestedSampleWindowMs: raw.sampleWindowMs,
  runs: raw.runs.map((run) => {
    const source = findSampleWorld(run.id)!.buildProject().world.source;
    if (source.kind !== "procedural")
      throw new Error("Procedural source is required");
    const generation = [];
    // 各ワールドの標準Chunk幅・同じ頂点数を使い、100Chunkを座標順に1回ずつ測る。
    for (let z = -5; z < 5; z++)
      for (let x = -5; x < 5; x++) {
        const start = performance.now();
        generateChunk({ ...source, chunkX: x, chunkZ: z });
        generation.push(performance.now() - start);
      }
    return {
      id: run.id,
      chunkSize: source.chunkSize,
      chunkResolution: source.chunkResolution,
      chunkGenerationMs: distribution(generation),
      views: run.states.map(({ view, samples: observed, memory }) => {
        const samples = [
          ...new Map(
            observed.map((sample) => [sample.engine.frame, sample]),
          ).values(),
        ];
        return {
          jsHeapBytes: memory ?? null,
          view,
          renderSubmissionMs: distribution(
            samples.map((s) => s.frame.renderMs),
          ),
          frameIntervalMs: distribution(samples.map((s) => s.frame.rafMs)),
          gpuMs: distribution(samples.map((s) => s.renderer.gpuTimingMs)),
          drawCalls: distribution(samples.map((s) => s.renderer.drawCalls)),
          triangles: distribution(samples.map((s) => s.renderer.triangles)),
          geometries: distribution(samples.map((s) => s.renderer.geometries)),
          textures: distribution(samples.map((s) => s.renderer.textures)),
          originRebaseCountMax: Math.max(
            0,
            ...samples.map((s) => s.world.rebaseCount ?? 0),
          ),
        };
      }),
      driveDistanceM: Math.hypot(
        run.after.machine.position![0] - run.before.machine.position![0],
        run.after.machine.position![2] - run.before.machine.position![2],
      ),
      browserChunkEvents: run.chunkEvents?.length ?? 0,
    };
  }),
};
await writeFile(
  path.join(output, "performance-summary.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
