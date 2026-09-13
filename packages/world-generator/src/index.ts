import {
  GENERATOR_VERSION,
  identity,
  type EnvironmentPreset,
  type Vec3,
  type World,
} from "../../project-schema/src/index";

export const DEFAULT_CHUNK_SIZE = 32;
export const DEFAULT_CHUNK_RESOLUTION = 33;
export const DEFAULT_CACHE_LIMIT = 256;
export const RENDER_CHUNK_RADIUS = 6;
export const PHYSICS_CHUNK_RADIUS = 3;
export const EDITOR_CHUNK_RADIUS = 5;
export const REBASE_CHUNK_DISTANCE = 3;

export interface GeneratorInput {
  seed: number;
  generatorVersion: number;
  preset: EnvironmentPreset;
  chunkX: number;
  chunkZ: number;
  chunkSize: number;
  chunkResolution: number;
  parameters?: Record<string, unknown>;
}

export interface GeneratedEntity {
  id: string;
  name: string;
  kind: "rock" | "tree" | "building";
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface GeneratedChunk {
  chunkX: number;
  chunkZ: number;
  size: number;
  resolution: number;
  heights: Float32Array;
  colors: string[];
  entities: GeneratedEntity[];
  biome: EnvironmentPreset;
}

const GRASS = ["#7cab68", "#759a63", "#6d8f5e", "#8a9a6a"] as const;
const SAND = "#c7b68b";
const ROCK = "#8a8478";
const WATER_BED = "#3d6b62";

export function chunkKey(chunkX: number, chunkZ: number) {
  return `${chunkX},${chunkZ}`;
}

export function parseChunkKey(key: string): [number, number] {
  const [x, z] = key.split(",").map(Number);
  return [x, z];
}

/** 負座標でも正しい整数除算になるよう floor を使う。 */
export function worldToChunk(x: number, z: number, chunkSize: number) {
  const chunkX = Math.floor(x / chunkSize);
  const chunkZ = Math.floor(z / chunkSize);
  return {
    chunkX,
    chunkZ,
    localX: x - chunkX * chunkSize,
    localZ: z - chunkZ * chunkSize,
  };
}

export function chunkOrigin(chunkX: number, chunkZ: number, chunkSize: number) {
  return { x: chunkX * chunkSize, z: chunkZ * chunkSize };
}

export function globalGridCoordinate(
  chunkX: number,
  chunkZ: number,
  i: number,
  j: number,
  resolution: number,
) {
  return {
    gx: chunkX * (resolution - 1) + i,
    gz: chunkZ * (resolution - 1) + j,
  };
}

export function gridWorldPosition(
  gx: number,
  gz: number,
  chunkSize: number,
  resolution: number,
) {
  const cell = chunkSize / (resolution - 1);
  return { x: gx * cell, z: gz * cell };
}

function hashU32(x: number, z: number, seed: number) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263);
  n = Math.imul(n + (seed | 0), 1274126177);
  n ^= n >>> 13;
  n = Math.imul(n, 1274126177);
  n ^= n >>> 16;
  return n >>> 0;
}

export function hash01(x: number, z: number, seed: number) {
  return hashU32(x, z, seed) / 4294967296;
}

function fade(t: number) {
  return t * t * (3 - 2 * t);
}

export function valueNoise2(
  x: number,
  z: number,
  seed: number,
  frequency: number,
) {
  const px = x * frequency,
    pz = z * frequency,
    x0 = Math.floor(px),
    z0 = Math.floor(pz),
    tx = fade(px - x0),
    tz = fade(pz - z0),
    n00 = hash01(x0, z0, seed),
    n10 = hash01(x0 + 1, z0, seed),
    n01 = hash01(x0, z0 + 1, seed),
    n11 = hash01(x0 + 1, z0 + 1, seed);
  return (
    (n00 * (1 - tx) + n10 * tx) * (1 - tz) + (n01 * (1 - tx) + n11 * tx) * tz
  );
}

export function fbm2(
  x: number,
  z: number,
  seed: number,
  octaves: number,
  frequency: number,
  persistence = 0.5,
) {
  let sum = 0,
    amp = 1,
    norm = 0,
    freq = frequency;
  for (let i = 0; i < octaves; i++) {
    sum += (valueNoise2(x, z, seed + i * 101, freq) * 2 - 1) * amp;
    norm += amp;
    amp *= persistence;
    freq *= 2;
  }
  return sum / norm;
}

export function generatedEntityId(
  input: Pick<
    GeneratorInput,
    "generatorVersion" | "preset" | "chunkX" | "chunkZ"
  >,
  index: number,
) {
  return `gen:${input.generatorVersion}:${input.preset}:${input.chunkX}:${input.chunkZ}:${index}`;
}

function inCircle(x: number, z: number, radius: number) {
  return x * x + z * z <= radius * radius;
}

function inRunway(x: number, z: number) {
  return Math.abs(x) <= 20 && z >= -40 && z <= 360;
}

function spawnSafety(preset: EnvironmentPreset, x: number, z: number) {
  if (preset === "grassland") return inCircle(x, z, 14);
  if (preset === "airfield") return inRunway(x, z) || inCircle(x, z, 18);
  return inCircle(x, z, 24);
}

function sampleBaseHeight(
  preset: EnvironmentPreset,
  x: number,
  z: number,
  seed: number,
) {
  if (preset === "airfield") {
    const plains = fbm2(x, z, seed, 4, 0.008) * 2.4;
    const mountains = Math.max(0, fbm2(x, z, seed + 17, 5, 0.0022) - 0.15) * 28;
    const distance = Math.hypot(x, z);
    const far = Math.min(1, Math.max(0, (distance - 220) / 280));
    let height = plains * (0.35 + 0.65 * far) + mountains * far;
    if (inRunway(x, z)) height = 0;
    else {
      const edge = Math.min(
        1,
        Math.max(
          0,
          (Math.max(Math.abs(x) - 20, 0) +
            Math.max(-40 - z, 0) +
            Math.max(z - 360, 0)) /
            24,
        ),
      );
      height *= edge;
    }
    return height;
  }
  if (preset === "archipelago") {
    const island = fbm2(x, z, seed, 5, 0.0045);
    const detail = fbm2(x, z, seed + 9, 3, 0.02) * 1.2;
    const ridge = fbm2(x, z, seed + 31, 4, 0.0018);
    let height = island * 9 + detail + Math.max(0, ridge - 0.25) * 16 - 3.8;
    if (inCircle(x, z, 24)) height = Math.min(height, -5);
    return height;
  }
  const rolling = fbm2(x, z, seed, 5, 0.012) * 2.2;
  const hills = fbm2(x, z, seed + 5, 4, 0.005) * 4.5;
  const mountains = Math.max(0, fbm2(x, z, seed + 21, 5, 0.0024) - 0.2) * 22;
  const distance = Math.hypot(x, z);
  const far = Math.min(1, Math.max(0, (distance - 40) / 90));
  let height = rolling * 0.7 + hills * (0.25 + 0.75 * far) + mountains * far;
  if (inCircle(x, z, 14))
    height *= Math.min(1, Math.max(0, (Math.hypot(x, z) - 6) / 8));
  return height;
}

function colorFor(
  preset: EnvironmentPreset,
  height: number,
  x: number,
  z: number,
  seed: number,
) {
  if (preset === "archipelago") {
    if (height < -1.2) return WATER_BED;
    if (height < 0.35) return SAND;
    if (height > 7) return ROCK;
    return GRASS[hashU32(Math.floor(x), Math.floor(z), seed) & 3];
  }
  if (preset === "airfield" && inRunway(x, z)) return "#9aa187";
  if (height > 8) return ROCK;
  if (height > 4) return GRASS[2];
  if (height > 1.5) return GRASS[1];
  return GRASS[0];
}

function placeEntities(
  input: GeneratorInput,
  heights: Float32Array,
): GeneratedEntity[] {
  const { preset, chunkX, chunkZ, chunkSize, chunkResolution, seed } = input;
  const entities: GeneratedEntity[] = [];
  const origin = chunkOrigin(chunkX, chunkZ, chunkSize);
  const density = preset === "airfield" ? 1 : preset === "archipelago" ? 2 : 3;
  const count = hashU32(chunkX, chunkZ, seed + 99) % (density + 1);
  for (let index = 0; index < count; index++) {
    const u = hash01(chunkX, index, seed + 3);
    const v = hash01(chunkZ, index, seed + 7);
    const x = origin.x + 2 + u * (chunkSize - 4);
    const z = origin.z + 2 + v * (chunkSize - 4);
    if (spawnSafety(preset, x, z)) continue;
    const i = Math.min(
      chunkResolution - 1,
      Math.max(
        0,
        Math.round(((x - origin.x) / chunkSize) * (chunkResolution - 1)),
      ),
    );
    const j = Math.min(
      chunkResolution - 1,
      Math.max(
        0,
        Math.round(((z - origin.z) / chunkSize) * (chunkResolution - 1)),
      ),
    );
    const height = heights[j * chunkResolution + i];
    if (preset === "archipelago" && height < 0.4) continue;
    if (preset === "airfield" && height < 0.2) continue;
    const roll = hash01(chunkX + index, chunkZ, seed + 13);
    const kind: GeneratedEntity["kind"] =
      preset === "archipelago"
        ? roll > 0.7
          ? "rock"
          : "tree"
        : roll > 0.82
          ? "building"
          : roll > 0.45
            ? "rock"
            : "tree";
    const scale: Vec3 =
      kind === "building"
        ? [1.3 + u * 0.4, 1.1 + v * 0.5, 1.3]
        : kind === "rock"
          ? [0.8 + u, 0.5 + v * 0.6, 0.8 + u]
          : [0.9 + u * 0.3, 1 + v * 0.4, 0.9 + u * 0.3];
    entities.push({
      id: generatedEntityId(input, index),
      name: kind === "building" ? "小屋" : kind === "rock" ? "岩" : "木",
      kind,
      position: [x, height + (kind === "rock" ? scale[1] * 0.25 : 0), z],
      rotation: [0, hash01(index, chunkZ, seed) * Math.PI * 2, 0],
      scale,
    });
  }
  return entities;
}

export function generateChunk(input: GeneratorInput): GeneratedChunk {
  const resolution = input.chunkResolution;
  const heights = new Float32Array(resolution * resolution);
  const colors: string[] = new Array(resolution * resolution);
  for (let j = 0; j < resolution; j++)
    for (let i = 0; i < resolution; i++) {
      const { gx, gz } = globalGridCoordinate(
        input.chunkX,
        input.chunkZ,
        i,
        j,
        resolution,
      );
      const { x, z } = gridWorldPosition(gx, gz, input.chunkSize, resolution);
      const height = sampleBaseHeight(input.preset, x, z, input.seed);
      const k = j * resolution + i;
      heights[k] = height;
      colors[k] = colorFor(input.preset, height, x, z, input.seed);
    }
  return {
    chunkX: input.chunkX,
    chunkZ: input.chunkZ,
    size: input.chunkSize,
    resolution,
    heights,
    colors,
    entities: placeEntities(input, heights),
    biome: input.preset,
  };
}

export function sampleGeneratedHeight(
  input: Omit<GeneratorInput, "chunkX" | "chunkZ"> & { x: number; z: number },
) {
  return sampleBaseHeight(input.preset, input.x, input.z, input.seed);
}

export function chunkHash(chunk: GeneratedChunk) {
  let h = 2166136261;
  for (let i = 0; i < chunk.heights.length; i++) {
    const y = Math.round(chunk.heights[i] * 1000);
    h ^= y + i * 17;
    h = Math.imul(h, 16777619);
  }
  h ^= chunk.entities.length;
  return (h >>> 0).toString(16);
}

export function bilinearHeight(
  heights: ArrayLike<number>,
  resolution: number,
  localX: number,
  localZ: number,
  chunkSize: number,
) {
  const u = Math.max(
      0,
      Math.min(resolution - 1, (localX / chunkSize) * (resolution - 1)),
    ),
    v = Math.max(
      0,
      Math.min(resolution - 1, (localZ / chunkSize) * (resolution - 1)),
    ),
    i = Math.floor(u),
    j = Math.floor(v),
    i1 = Math.min(i + 1, resolution - 1),
    j1 = Math.min(j + 1, resolution - 1),
    a = u - i,
    b = v - j;
  return (
    (1 - b) *
      ((1 - a) * heights[j * resolution + i] +
        a * heights[j * resolution + i1]) +
    b *
      ((1 - a) * heights[j1 * resolution + i] +
        a * heights[j1 * resolution + i1])
  );
}

export function starterWorldName(preset: EnvironmentPreset) {
  if (preset === "airfield") return "滑走路の平原";
  if (preset === "archipelago") return "群島の海";
  return "はじまりの草原";
}

export function starterWater(preset: EnvironmentPreset) {
  if (preset === "archipelago") return { enabled: true, height: 0 };
  return { enabled: false, height: -0.4 };
}

export function starterSpawn(preset: EnvironmentPreset): Vec3 {
  if (preset === "archipelago") return [0, 1.2, 0];
  if (preset === "airfield") return [0, 2, 8];
  return [0, 2, 0];
}

export function createProceduralWorld(options: {
  preset: EnvironmentPreset;
  seed?: number;
  generatorVersion?: number;
  chunkSize?: number;
  chunkResolution?: number;
  id?: string;
  name?: string;
}): Pick<
  World,
  | "id"
  | "name"
  | "source"
  | "edits"
  | "terrain"
  | "water"
  | "entities"
  | "chunkSize"
  | "lighting"
  | "spawnPoints"
  | "environment"
> {
  const preset = options.preset;
  const seed = options.seed ?? 42;
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunkResolution = options.chunkResolution ?? DEFAULT_CHUNK_RESOLUTION;
  const n = 33;
  return {
    id: options.id ?? crypto.randomUUID(),
    name: options.name ?? starterWorldName(preset),
    source: {
      kind: "procedural",
      seed,
      generatorVersion: options.generatorVersion ?? GENERATOR_VERSION,
      preset,
      chunkSize,
      chunkResolution,
      parameters: {},
    },
    edits: { terrainChunks: {}, generatedEntityTombstones: [] },
    terrain: {
      resolution: n,
      size: 128,
      heights: Array(n * n).fill(0),
      colors: Array(n * n).fill("#7cab68"),
      seed,
    },
    water: starterWater(preset),
    entities: [],
    chunkSize,
    lighting: { intensity: 2, timeOfDay: 14 },
    spawnPoints: [starterSpawn(preset)],
    environment: {
      sky: preset === "archipelago" ? "#9fd4e6" : "#c8e6f5",
      fog: preset === "airfield" ? 0.0018 : 0.003,
    },
  };
}

export function generatedToWorldEntity(entity: GeneratedEntity) {
  return {
    id: entity.id,
    name: entity.name,
    kind: entity.kind,
    transform: {
      ...identity(),
      position: entity.position,
      rotation: entity.rotation,
      scale: entity.scale,
    },
  };
}
