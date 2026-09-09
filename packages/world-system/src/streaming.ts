import type { Project, Vec3 } from "../../project-schema/src/index";
import { chunkCoordinate, visibleChunks } from "./index";
export interface TerrainChunk {
  key: string;
  vertices: number[];
  indices: number[];
  colors: string[];
}
export function terrainChunks(project: Project): TerrainChunk[] {
  const t = project.world.terrain;
  const chunks = new Map<string, TerrainChunk>();
  for (let z = 0; z < t.resolution - 1; z++)
    for (let x = 0; x < t.resolution - 1; x++) {
      const px = (x / (t.resolution - 1) - 0.5) * t.size,
        pz = (z / (t.resolution - 1) - 0.5) * t.size,
        key = chunkCoordinate([px, 0, pz], project.world.chunkSize).join(",");
      let chunk = chunks.get(key);
      if (!chunk) {
        chunk = { key, vertices: [], indices: [], colors: [] };
        chunks.set(key, chunk);
      }
      const base = chunk.vertices.length / 3;
      for (const [i, j] of [
        [x, z],
        [x, z + 1],
        [x + 1, z],
        [x + 1, z + 1],
      ]) {
        chunk.vertices.push(
          (i / (t.resolution - 1) - 0.5) * t.size,
          t.heights[j * t.resolution + i],
          (j / (t.resolution - 1) - 0.5) * t.size,
        );
        chunk.colors.push(t.colors[j * t.resolution + i]);
      }
      chunk.indices.push(
        base,
        base + 1,
        base + 2,
        base + 2,
        base + 1,
        base + 3,
      );
    }
  return [...chunks.values()];
}
export class ChunkStreamer<T> {
  readonly loaded = new Map<string, T>();
  constructor(
    private create: (key: string) => T | undefined,
    private destroy: (value: T) => void,
    private size: number,
    private radius = 2,
    private unloadRadius = radius + 1,
  ) {}
  update(position: Vec3) {
    const active = visibleChunks(position, this.size, this.radius);
    for (const key of active)
      if (!this.loaded.has(key)) {
        const value = this.create(key);
        if (value !== undefined) this.loaded.set(key, value);
      }
    const retained = visibleChunks(position, this.size, this.unloadRadius);
    for (const [key, value] of this.loaded)
      if (!retained.has(key)) {
        this.destroy(value);
        this.loaded.delete(key);
      }
  }
  dispose() {
    this.loaded.forEach(this.destroy);
    this.loaded.clear();
  }
}

export const physicsStreaming = { loadRadius: 2, unloadRadius: 3 };
