import { isAlpineVillage, alpineSurfaceColor } from "./alpine-farmland";
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
    const minX = Math.floor((island.center[0] - island.radius) / chunkSize),
      maxX = Math.ceil((island.center[0] + island.radius) / chunkSize);
    const minZ = Math.floor((island.center[2] - island.radius) / chunkSize),
      maxZ = Math.ceil((island.center[2] + island.radius) / chunkSize);
    const width = maxX - minX + 1,
      positions: number[] = [],
      colors: string[] = [],
      indices: number[] = [],
      cellKeys: string[] = [];
    for (let z = minZ; z <= maxZ; z++)
      for (let x = minX; x <= maxX; x++) {
        colors.push(
          biomeSurfaceColor(
            layers.sampleBiome(x * chunkSize, z * chunkSize),
            layers.sampleHeight(x * chunkSize, z * chunkSize),
            layers.sampleSlope(x * chunkSize, z * chunkSize),
            x * chunkSize,
            z * chunkSize,
            seed,
            biomeProfileVersion,
          ),
        );
        if (isAlpineVillage(design))
          colors[colors.length - 1] = alpineSurfaceColor(
            x * chunkSize,
            z * chunkSize,
            layers.sampleHeight(x * chunkSize, z * chunkSize),
            colors[colors.length - 1],
          );
        positions.push(
          x * chunkSize,
          layers.sampleHeight(x * chunkSize, z * chunkSize) - 0.08,
          z * chunkSize,
        );
      }
    for (let z = minZ; z < maxZ; z++)
      for (let x = minX; x < maxX; x++) {
        const a = (z - minZ) * width + x - minX,
          b = a + width;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
        cellKeys.push(`${x},${z}`);
      }
    const vertices = new Float32Array(positions),
      triangles = new Uint32Array(indices);
    const forest: IslandProxyData["forest"] = [];
    if (isAlpineVillage(design))
      for (let z = -810; z < -150; z += 14)
        for (let x = -950; x <= 950; x += 14) {
          const px = x + Math.sin(x * 3.17 + z) * 6,
            pz = z + Math.cos(z * 1.39 + x) * 6;
          const h = layers.sampleHeight(px, pz);
          if (h < 110 && layers.sampleRoadInfluence(px, pz, true).distance > 8)
            forest.push({
              position: [px, h, pz],
              scale: 13 + (Math.sin(x + z) + 1) * 4,
              key: `${Math.floor(px / chunkSize)},${Math.floor(pz / chunkSize)}`,
              pine: (x + z) % 3 !== 0,
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
