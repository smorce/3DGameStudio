import { writeFile } from "node:fs/promises";
import {
  createProceduralWorld,
  generateChunk,
  chunkHash,
  type GeneratorInput,
} from "../packages/world-generator/src/index";
import { WorldRuntime } from "../packages/world-system/src/runtime";

const baselinePath = process.argv
  .find((a) => a.startsWith("--baseline="))
  ?.slice(11);
const baseline = baselinePath
  ? ((await import(baselinePath)) as { generateChunk: typeof generateChunk })
  : undefined;
const measure = (generate: typeof generateChunk, inputs: GeneratorInput[]) => {
  inputs.slice(0, 10).forEach(generate);
  const samples: number[] = [];
  let props = 0;
  for (const input of inputs) {
    const start = performance.now(),
      result = generate(input);
    samples.push(performance.now() - start);
    props += result.entities.length;
  }
  samples.sort((a, b) => a - b);
  return {
    count: inputs.length,
    p50Ms: samples[Math.floor(samples.length * 0.5)],
    p95Ms: samples[Math.floor(samples.length * 0.95)],
    maxMs: samples.at(-1),
    generatedProps: props,
  };
};
const results: Record<string, unknown> = {};
for (const preset of [
  "grassland",
  "airfield",
  "archipelago",
  "toy-islands",
] as const) {
  const world = createProceduralWorld({ preset, id: "benchmark", seed: 42 });
  if (world.source.kind !== "procedural")
    throw new Error("Expected procedural world");
  const source = world.source;
  const inputs = Array.from({ length: 100 }, (_, i) => ({
    ...source,
    chunkX: (i % 10) - 5,
    chunkZ: Math.floor(i / 10) - 5,
  }));
  const hashesMatch =
    preset !== "toy-islands" && baseline
      ? inputs.every((i) => {
          const current = generateChunk(i),
            previous = baseline.generateChunk(i);
          return (
            chunkHash(current) === chunkHash(previous) &&
            current.heights.every(
              (h, index) => h === previous.heights[index],
            ) &&
            JSON.stringify(current.colors) ===
              JSON.stringify(previous.colors) &&
            JSON.stringify(current.entities) ===
              JSON.stringify(previous.entities)
          );
        })
      : undefined;
  results[preset] = {
    before:
      preset !== "toy-islands" && baseline
        ? measure(baseline.generateChunk, inputs)
        : undefined,
    after: measure(generateChunk, inputs),
    baselineMatches: hashesMatch,
  };
}
const runtime = new WorldRuntime(
  createProceduralWorld({ preset: "toy-islands" }),
  { forceSyncWorkers: true },
);
await runtime.ensurePhysicsReady([0, 9, 0], 1);
const stats = runtime.stats();
runtime.dispose();
const result = {
  environment:
    "Node synchronous generation; browser WebGL/frame latency excluded",
  node: process.version,
  presets: results,
  streaming: {
    cachedChunks: stats.cachedChunks,
    workerQueued: stats.workerQueued,
    workerInFlight: stats.workerInFlight,
    commitMs: stats.streamingCommitMs,
    maxGenerationMs: stats.maxGenerationLatencyMs,
  },
};
await writeFile(
  "docs/evidence/world-generation-performance.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
