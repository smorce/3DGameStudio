import { seedUnit } from "./seed";
import { isAlpineVillage } from "./alpine-farmland";
import {
  biomeSurfaceColor,
  CURRENT_BIOME_PROFILE_VERSION,
} from "./biome-surface";
import type { WorldDesign } from "../../project-schema/src/index";
import { SemanticLayers } from "./semantic";
import { computeIndexedNormals } from "./prepare";
export interface IslandProxyData {
  id: string;
  positions: Float32Array;
  colors: string[];
  normals: Float32Array;
  indices: Uint32Array;
  cellKeys: string[];
  forest?: {
    position: [number, number, number];
    scale: number;
    key: string;
    pine: boolean;
  }[];
}
/** 32m境界に揃えた低解像度mesh。近景Chunk単位で三角形を除外できる。 */
export function buildIslandProxies(
  design: WorldDesign,
  seed: number,
  chunkSize = 32,
  biomeProfileVersion = CURRENT_BIOME_PROFILE_VERSION,
): IslandProxyData[] {
  const layers = new SemanticLayers(design, seed);
  return design.islands.map((island) => {
    const subdivisions = isAlpineVillage(design) ? 4 : 1;
    const step = chunkSize / subdivisions;
    const minX =
        Math.floor((island.center[0] - island.radius) / chunkSize) *
        subdivisions,
      maxX =
        Math.ceil((island.center[0] + island.radius) / chunkSize) *
        subdivisions;
    const minZ =
        Math.floor((island.center[2] - island.radius) / chunkSize) *
        subdivisions,
      maxZ =
        Math.ceil((island.center[2] + island.radius) / chunkSize) *
        subdivisions;
    const width = maxX - minX + 1,
      positions: number[] = [],
      colors: string[] = [],
      indices: number[] = [],
      cellKeys: string[] = [];
    for (let z = minZ; z <= maxZ; z++)
      for (let x = minX; x <= maxX; x++) {
        colors.push(
          biomeSurfaceColor(
            layers.sampleBiome(x * step, z * step),
            layers.sampleHeight(x * step, z * step),
            layers.sampleSlope(x * step, z * step),
            x * step,
            z * step,
            seed,
            biomeProfileVersion,
          ),
        );
        if (isAlpineVillage(design))
          colors[colors.length - 1] = layers.sampleAlpineSurfaceColor(
            x * step,
            z * step,
            layers.sampleHeight(x * step, z * step),
            colors[colors.length - 1],
          );
        positions.push(
          x * step,
          layers.sampleHeight(x * step, z * step) - 0.08,
          z * step,
        );
      }
    for (let z = minZ; z < maxZ; z++)
      for (let x = minX; x < maxX; x++) {
        const a = (z - minZ) * width + x - minX,
          b = a + width;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
        cellKeys.push(
          `${Math.floor(x / subdivisions)},${Math.floor(z / subdivisions)}`,
        );
      }
    const vertices = new Float32Array(positions),
      triangles = new Uint32Array(indices);
    const forest: IslandProxyData["forest"] = [];
    if (isAlpineVillage(design))
      for (let z = -810; z < -150; z += 12)
        for (let x = -950; x <= 950; x += 12) {
          const px = x + Math.sin(x * 3.17 + z) * 6,
            pz = z + Math.cos(z * 1.39 + x) * 6;
          const h = layers.sampleHeight(px, pz);
          if (
            seedUnit(seed, "forest", `${x},${z}`) <
              layers.sampleAlpineForestDensity(px, pz, h) &&
            layers.sampleSlope(px, pz) < 37 &&
            layers.sampleRoadInfluence(px, pz, true).distance > 8
          )
            forest.push({
              position: [px, h, pz],
              scale: 10 + seedUnit(seed, "forest-scale", `${x},${z}`) * 12,
              key: `${Math.floor(px / chunkSize)},${Math.floor(pz / chunkSize)}`,
              pine:
                seedUnit(seed, "forest-species", `${x},${z}`) < 0.4 + h / 220,
            });
        }
    return {
      ...(forest.length ? { forest } : {}),
      id: island.id,
      positions: vertices,
      colors,
      normals: computeIndexedNormals(vertices, triangles),
      indices: triangles,
      cellKeys,
    };
  });
}
