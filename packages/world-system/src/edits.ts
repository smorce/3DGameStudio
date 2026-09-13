import type { Brush } from "../../terrain-system/src/index";
import type { World } from "../../project-schema/src/index";
import {
  chunkKey,
  generateChunk,
  worldToChunk,
} from "../../world-generator/src/index";

function vertexWorld(
  chunkX: number,
  chunkZ: number,
  i: number,
  j: number,
  chunkSize: number,
  resolution: number,
) {
  const cell = chunkSize / (resolution - 1);
  return {
    x: chunkX * chunkSize + i * cell,
    z: chunkZ * chunkSize + j * cell,
  };
}

export function chunksOverlappingBrush(
  x: number,
  z: number,
  radius: number,
  chunkSize: number,
) {
  const min = worldToChunk(x - radius, z - radius, chunkSize);
  const max = worldToChunk(x + radius, z + radius, chunkSize);
  const keys: string[] = [];
  for (let cx = min.chunkX; cx <= max.chunkX; cx++)
    for (let cz = min.chunkZ; cz <= max.chunkZ; cz++)
      keys.push(chunkKey(cx, cz));
  return keys;
}

export function applyProceduralBrush(
  world: World,
  mode: Brush,
  x: number,
  z: number,
  radius: number,
  strength: number,
  color = "#c7b68b",
) {
  if (world.source.kind !== "procedural") return;
  const { chunkSize, chunkResolution, seed, generatorVersion, preset } =
    world.source;
  for (const key of chunksOverlappingBrush(x, z, radius, chunkSize)) {
    const [chunkX, chunkZ] = key.split(",").map(Number);
    const generated = generateChunk({
      seed,
      generatorVersion,
      preset,
      chunkX,
      chunkZ,
      chunkSize,
      chunkResolution,
    });
    const current = world.edits.terrainChunks[key] ?? {
      heightDeltas: {},
      colors: {},
    };
    const heightDeltas = { ...current.heightDeltas };
    const colors = { ...(current.colors ?? {}) };
    const old = generated.heights.map((base, index) => {
      return base + (heightDeltas[String(index)] ?? 0);
    });
    for (let j = 0; j < chunkResolution; j++)
      for (let i = 0; i < chunkResolution; i++) {
        const p = vertexWorld(chunkX, chunkZ, i, j, chunkSize, chunkResolution);
        const d = Math.hypot(p.x - x, p.z - z);
        if (d > radius) continue;
        const k = j * chunkResolution + i,
          w = (1 - d / radius) * strength;
        if (mode === "paint") {
          colors[String(k)] = color;
          continue;
        }
        let next = old[k];
        if (mode === "raise") next += w;
        if (mode === "lower") next -= w;
        if (mode === "flatten") next += (0 - old[k]) * Math.min(1, w);
        if (mode === "noise")
          next += Math.sin(i * 12.9898 + j * 78.233 + seed) * w;
        if (mode === "smooth") {
          const ns = [
            old[k - 1],
            old[k + 1],
            old[k - chunkResolution],
            old[k + chunkResolution],
          ].filter((n) => n !== undefined);
          next +=
            (ns.reduce((a, b) => a + b, 0) / ns.length - old[k]) *
            Math.min(1, w);
        }
        const delta = next - generated.heights[k];
        if (Math.abs(delta) < 1e-6) delete heightDeltas[String(k)];
        else heightDeltas[String(k)] = delta;
      }
    if (
      Object.keys(heightDeltas).length === 0 &&
      Object.keys(colors).length === 0
    )
      delete world.edits.terrainChunks[key];
    else
      world.edits.terrainChunks[key] = {
        heightDeltas,
        colors: Object.keys(colors).length ? colors : undefined,
      };
  }
}
