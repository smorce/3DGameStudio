import { biomeSurfaceColor } from "./biome-surface";
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
}
/** 32m境界に揃えた低解像度mesh。近景Chunk単位で三角形を除外できる。 */
export function buildIslandProxies(
  design: WorldDesign,
  seed: number,
  chunkSize = 32,
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
          ),
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
    return {
      id: island.id,
      positions: vertices,
      colors,
      normals: computeIndexedNormals(vertices, triangles),
      indices: triangles,
      cellKeys,
    };
  });
}
