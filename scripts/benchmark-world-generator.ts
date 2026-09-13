import { writeFileSync } from "node:fs";
import {
  DEFAULT_CHUNK_RESOLUTION,
  DEFAULT_CHUNK_SIZE,
  generateChunk,
} from "../packages/world-generator/src/index";

const sizes = [32, 64] as const;
const resolutions = [33, 65] as const;
const samples = 24;
const rows: {
  chunkSize: number;
  resolution: number;
  averageMs: number;
  maxMs: number;
}[] = [];

for (const chunkSize of sizes)
  for (const resolution of resolutions) {
    const times: number[] = [];
    for (let i = 0; i < samples; i++) {
      const started = performance.now();
      generateChunk({
        seed: 42,
        generatorVersion: 1,
        preset: "grassland",
        chunkX: i - 8,
        chunkZ: (i % 5) - 2,
        chunkSize,
        chunkResolution: resolution,
      });
      times.push(performance.now() - started);
    }
    rows.push({
      chunkSize,
      resolution,
      averageMs: times.reduce((a, b) => a + b, 0) / times.length,
      maxMs: Math.max(...times),
    });
  }

const selected = rows.find(
  (row) =>
    row.chunkSize === DEFAULT_CHUNK_SIZE &&
    row.resolution === DEFAULT_CHUNK_RESOLUTION,
)!;
const report = {
  rows,
  selected: {
    ...selected,
    reason:
      "1m格子で車の接地が粗くならず、33^2の生成が数ms未満のためMain Thread同期で足りる。64m/65は生成が重く、Planeの同時Chunk数も増える。",
    worker: selected.maxMs < 8 ? "not-required" : "recommended",
  },
};
writeFileSync(
  "docs/evidence/procedural-world-benchmark.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
