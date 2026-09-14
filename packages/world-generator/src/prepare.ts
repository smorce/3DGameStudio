import {
  chunkKey,
  generateChunk,
  type GeneratorInput,
  type TerrainEditOverlay,
} from "./index";

export interface PreparedChunk {
  key: string;
  chunkX: number;
  chunkZ: number;
  size: number;
  resolution: number;
  heights: Float32Array;
  /** Chunk-local 座標 (0..size)。Origin Rebase で頂点再生成しない。 */
  positions: Float32Array;
  normals: Float32Array;
  /** RGB 各 0..1 の Float32Array。 */
  colors: Float32Array;
  indices: Uint32Array;
  entities: ReturnType<typeof generateChunk>["entities"];
  /** 後方互換用の hex 色配列。 */
  colorHex: string[];
  biome: ReturnType<typeof generateChunk>["biome"];
  generationTimingMs: number;
}

/** heights / hex colors へ Edit Overlay を適用する（破壊的）。 */
export function applyTerrainEditOverlay(
  heights: Float32Array,
  colors: string[],
  edit?: TerrainEditOverlay,
) {
  if (!edit) return;
  if (edit.heightDeltas)
    for (const [index, delta] of Object.entries(edit.heightDeltas)) {
      const i = Number(index);
      if (Number.isInteger(i) && i >= 0 && i < heights.length)
        heights[i] += delta;
    }
  if (edit.colors)
    for (const [index, color] of Object.entries(edit.colors)) {
      const i = Number(index);
      if (Number.isInteger(i) && i >= 0 && i < colors.length) colors[i] = color;
    }
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.startsWith("#") ? hex.slice(1) : hex;
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) return [0.5, 0.5, 0.5];
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
}

/** Indexed mesh から頂点法線を計算する（Three.js computeVertexNormals 相当）。 */
export function computeIndexedNormals(
  positions: Float32Array,
  indices: Uint32Array,
): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ax = positions[a],
      ay = positions[a + 1],
      az = positions[a + 2];
    const bx = positions[b],
      by = positions[b + 1],
      bz = positions[b + 2];
    const cx = positions[c],
      cy = positions[c + 1],
      cz = positions[c + 2];
    const abx = bx - ax,
      aby = by - ay,
      abz = bz - az;
    const acx = cx - ax,
      acy = cy - ay,
      acz = cz - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    normals[a] += nx;
    normals[a + 1] += ny;
    normals[a + 2] += nz;
    normals[b] += nx;
    normals[b + 1] += ny;
    normals[b + 2] += nz;
    normals[c] += nx;
    normals[c + 1] += ny;
    normals[c + 2] += nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i],
      y = normals[i + 1],
      z = normals[i + 2];
    const len = Math.hypot(x, y, z) || 1;
    normals[i] = x / len;
    normals[i + 1] = y / len;
    normals[i + 2] = z / len;
  }
  return normals;
}

/**
 * Worker / Main 双方で使える純関数。
 * Geometry は Chunk-local (x,z ∈ [0, size])。
 * terrainEdit がある場合は適用後に positions / normals / colors を作る。
 */
export function prepareChunk(input: GeneratorInput): PreparedChunk {
  const started =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const generated = generateChunk(input);
  const { resolution, size, entities, biome } = generated;
  const heights = new Float32Array(generated.heights);
  const colors = generated.colors.slice();
  applyTerrainEditOverlay(heights, colors, input.terrainEdit);
  const cell = size / (resolution - 1);
  const vertexCount = resolution * resolution;
  const positions = new Float32Array(vertexCount * 3);
  const colorRgb = new Float32Array(vertexCount * 3);
  for (let j = 0; j < resolution; j++)
    for (let i = 0; i < resolution; i++) {
      const k = j * resolution + i;
      const o = k * 3;
      positions[o] = i * cell;
      positions[o + 1] = heights[k];
      positions[o + 2] = j * cell;
      const [r, g, b] = hexToRgb(colors[k]);
      colorRgb[o] = r;
      colorRgb[o + 1] = g;
      colorRgb[o + 2] = b;
    }
  const indices = new Uint32Array((resolution - 1) * (resolution - 1) * 6);
  let cursor = 0;
  for (let j = 0; j < resolution - 1; j++)
    for (let i = 0; i < resolution - 1; i++) {
      const a = j * resolution + i;
      const b = a + resolution;
      const c = a + 1;
      const d = b + 1;
      indices[cursor++] = a;
      indices[cursor++] = b;
      indices[cursor++] = c;
      indices[cursor++] = c;
      indices[cursor++] = b;
      indices[cursor++] = d;
    }
  const normals = computeIndexedNormals(positions, indices);
  const ended =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  return {
    key: chunkKey(input.chunkX, input.chunkZ),
    chunkX: input.chunkX,
    chunkZ: input.chunkZ,
    size,
    resolution,
    heights,
    positions,
    normals,
    colors: colorRgb,
    indices,
    entities,
    colorHex: colors,
    biome,
    generationTimingMs: ended - started,
  };
}

/** Transferable 用に underlying buffer を列挙する。 */
export function preparedChunkTransferList(chunk: PreparedChunk): ArrayBuffer[] {
  return [
    chunk.heights.buffer,
    chunk.positions.buffer,
    chunk.normals.buffer,
    chunk.colors.buffer,
    chunk.indices.buffer,
  ] as ArrayBuffer[];
}
