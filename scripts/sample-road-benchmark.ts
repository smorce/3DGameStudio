import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { sampleWorldCatalog } from "../packages/sample-worlds/src/builders";
import {
  generateChunk,
  SemanticLayers,
} from "../packages/world-generator/src/index";
import { bruteRoadInfluence } from "../tests/fixtures/road-reference";
import { fingerprint } from "../packages/asset-catalog/src/index";

// 同一プロセスで索引化前の二重走査と現在の実装を交互に計測する。
const indexedRoad = SemanticLayers.prototype.sampleRoadInfluence;
const indexedTerrain = SemanticLayers.prototype.sampleTerrain;
const modes = ["before", "after"] as const;
const report = [];
try {
  for (const descriptor of sampleWorldCatalog) {
    const source = descriptor.buildProject().world.source;
    if (source.kind !== "procedural" || !source.design) continue;
    const timings: Record<string, number[]> = { before: [], after: [] };
    const hashes = new Map<string, string>();
    for (let round = 0; round < 3; round++)
      for (const mode of round % 2 ? [...modes].reverse() : modes) {
        SemanticLayers.prototype.sampleRoadInfluence =
          mode === "before" ? bruteRoadInfluence : indexedRoad;
        SemanticLayers.prototype.sampleTerrain =
          mode === "after"
            ? indexedTerrain
            : function (this: SemanticLayers, x, z) {
                return {
                  height: this.sampleHeight(x, z),
                  roadInfluence: this.sampleRoadInfluence(x, z, true),
                  biome: this.sampleBiome(x, z),
                };
              };
        for (let z = -5; z < 5; z++)
          for (let x = -5; x < 5; x++) {
            const start = performance.now();
            const chunk = generateChunk({ ...source, chunkX: x, chunkZ: z });
            const duration = performance.now() - start;
            if (round > 0) timings[mode].push(duration);
            const key = `${x},${z}`;
            const hash = fingerprint(chunk);
            if (hashes.has(key) && hashes.get(key) !== hash)
              throw new Error(
                `Road optimization changed chunk: ${descriptor.id}/${key}`,
              );
            hashes.set(key, hash);
          }
      }
    const stats = (values: number[]) => {
      values.sort((a, b) => a - b);
      return {
        samples: values.length,
        medianMs: values[Math.floor(values.length / 2)],
        p95Ms: values[Math.floor(values.length * 0.95)],
      };
    };
    report.push({
      id: descriptor.id,
      identicalChunks: hashes.size,
      before: stats(timings.before),
      after: stats(timings.after),
    });
  }
} finally {
  SemanticLayers.prototype.sampleRoadInfluence = indexedRoad;
  SemanticLayers.prototype.sampleTerrain = indexedTerrain;
}
const result = {
  method:
    "Same-process alternating full-scan/double-query versus grid/shared sample; 100 warm-up chunks per mode, then 2 x 100 chunks; geometry, colors and entities fingerprinted outside timing",
  worlds: report,
};
await writeFile(
  "docs/evidence/sample-worlds-road-performance.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
