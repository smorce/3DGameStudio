import {
  isProceduralWorld,
  worldChunkResolution,
  worldChunkSize,
  type Vec3,
  type World,
  type WorldEdits,
} from "../../project-schema/src/index";
import { heightAt, heightAtIfInside } from "../../terrain-system/src/index";
import {
  DEFAULT_CACHE_LIMIT,
  bilinearHeight,
  chunkKey,
  chunkOrigin,
  generateChunk,
  generatedToWorldEntity,
  parseChunkKey,
  sampleGeneratedHeight,
  worldToChunk,
  type GeneratedChunk,
  type GeneratedEntity,
} from "../../world-generator/src/index";
import { rebaseDelta } from "./coordinates";
import { terrainChunks, type TerrainChunk } from "./streaming";

export type WorldConsumer = "renderer" | "physics" | "editor";

export interface RuntimeChunk {
  key: string;
  chunkX: number;
  chunkZ: number;
  size: number;
  resolution: number;
  heights: Float32Array;
  colors: string[];
  entities: GeneratedEntity[];
  lodLevel: 0 | 1 | 2;
}

export interface OriginRebasePlan {
  delta: Vec3;
  originBefore: Vec3;
  originAfter: Vec3;
}

export interface WorldRuntimeStats {
  currentChunk: string;
  worldOrigin: Vec3;
  loadedRenderChunks: number;
  loadedPhysicsChunks: number;
  loadedEditorChunks: number;
  cachedChunks: number;
  pendingGenerationCount: number;
  generationLatencyMs: number;
  maxGenerationLatencyMs: number;
  cacheHitRate: number;
  rebaseCount: number;
  syncGenerationCount: number;
}

export interface WorldRuntimeOptions {
  cacheLimit?: number;
  debug?: boolean;
}

interface CacheEntry {
  chunk: RuntimeChunk;
  refs: Map<WorldConsumer, number>;
  lastHit: number;
}

export function applyEditOverlay(
  chunk: RuntimeChunk,
  edits: WorldEdits,
): RuntimeChunk {
  const edit = edits.terrainChunks[chunk.key];
  if (!edit) return chunk;
  const heights = new Float32Array(chunk.heights);
  const colors = chunk.colors.slice();
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
  return { ...chunk, heights, colors };
}

export function runtimeChunkMesh(
  chunk: RuntimeChunk,
  origin: Vec3,
): TerrainChunk {
  const vertices: number[] = [];
  const colors: string[] = [];
  const indices: number[] = [];
  const cell = chunk.size / (chunk.resolution - 1);
  const ox = chunk.chunkX * chunk.size;
  const oz = chunk.chunkZ * chunk.size;
  for (let j = 0; j < chunk.resolution; j++)
    for (let i = 0; i < chunk.resolution; i++) {
      vertices.push(
        ox + i * cell - origin[0],
        chunk.heights[j * chunk.resolution + i],
        oz + j * cell - origin[2],
      );
      colors.push(chunk.colors[j * chunk.resolution + i]);
    }
  for (let j = 0; j < chunk.resolution - 1; j++)
    for (let i = 0; i < chunk.resolution - 1; i++) {
      const a = j * chunk.resolution + i;
      const b = a + chunk.resolution;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, b, c, c, b, d);
    }
  return { key: chunk.key, vertices, indices, colors };
}

export class WorldRuntime {
  generation = 0;
  worldOrigin: Vec3 = [0, 0, 0];
  rebaseCount = 0;
  readonly debugEvents: string[] = [];
  private readonly cache = new Map<string, CacheEntry>();
  private readonly refs = new Map<WorldConsumer, Set<string>>();
  private hits = 0;
  private misses = 0;
  private lastLatency = 0;
  private maxLatency = 0;
  private syncGenerations = 0;
  private clock = 0;
  private pending = 0;
  private finiteMeshes?: Map<string, TerrainChunk>;
  private cacheLimit: number;
  private debug: boolean;

  constructor(
    public world: World,
    private options: WorldRuntimeOptions = {},
  ) {
    this.cacheLimit = options.cacheLimit ?? DEFAULT_CACHE_LIMIT;
    this.debug = options.debug ?? false;
    this.refs.set("renderer", new Set());
    this.refs.set("physics", new Set());
    this.refs.set("editor", new Set());
  }

  get ticket() {
    return this.generation;
  }

  get chunkSize() {
    return worldChunkSize(this.world);
  }

  get chunkResolution() {
    return worldChunkResolution(this.world);
  }

  get procedural() {
    return isProceduralWorld(this.world);
  }

  get seaLevel() {
    return this.world.water;
  }

  reload(world: World) {
    this.generation++;
    this.world = world;
    this.cache.clear();
    this.finiteMeshes = undefined;
    for (const set of this.refs.values()) set.clear();
    this.hits = 0;
    this.misses = 0;
    this.pending = 0;
    this.lastLatency = 0;
    this.maxLatency = 0;
    this.syncGenerations = 0;
    this.worldOrigin = [0, 0, 0];
    this.rebaseCount = 0;
    this.log("reload");
  }

  dispose() {
    this.generation++;
    this.cache.clear();
    this.finiteMeshes = undefined;
    for (const set of this.refs.values()) set.clear();
    this.worldOrigin = [0, 0, 0];
    this.rebaseCount = 0;
    this.log("dispose");
  }

  isCurrent(ticket: number) {
    return ticket === this.generation;
  }

  acquire(consumer: WorldConsumer, keys: Iterable<string>) {
    const held = this.refs.get(consumer)!;
    const next = new Set(keys);
    for (const key of next) {
      if (!held.has(key)) {
        held.add(key);
        this.getChunk(key);
        const entry = this.cache.get(key);
        if (entry)
          entry.refs.set(consumer, (entry.refs.get(consumer) ?? 0) + 1);
      }
    }
    for (const key of [...held])
      if (!next.has(key)) {
        held.delete(key);
        const entry = this.cache.get(key);
        if (entry) {
          const count = (entry.refs.get(consumer) ?? 1) - 1;
          if (count <= 0) entry.refs.delete(consumer);
          else entry.refs.set(consumer, count);
        }
      }
    this.evict();
  }

  getChunk(key: string): RuntimeChunk | undefined {
    const cached = this.cache.get(key);
    if (cached) {
      this.hits++;
      cached.lastHit = ++this.clock;
      return cached.chunk;
    }
    this.misses++;
    this.syncGenerations++;
    const started = performance.now();
    this.pending++;
    const ticket = this.generation;
    const generated = this.buildChunk(key);
    this.pending--;
    this.lastLatency = performance.now() - started;
    this.maxLatency = Math.max(this.maxLatency, this.lastLatency);
    if (!generated || ticket !== this.generation) return undefined;
    const chunk = applyEditOverlay(generated, this.world.edits);
    this.cache.set(key, {
      chunk,
      refs: new Map(),
      lastHit: ++this.clock,
    });
    this.log(`generate:${key}`);
    this.evict();
    return chunk;
  }

  peekChunk(key: string) {
    return this.cache.get(key)?.chunk;
  }

  sampleHeight(x: number, z: number): number | undefined {
    if (!isProceduralWorld(this.world))
      return heightAtIfInside(this.world.terrain, x, z);
    const source = this.world.source;
    const { chunkX, chunkZ } = worldToChunk(x, z, this.chunkSize);
    const chunk = this.getChunk(chunkKey(chunkX, chunkZ));
    if (!chunk) {
      return sampleGeneratedHeight({
        seed: source.seed,
        generatorVersion: source.generatorVersion,
        preset: source.preset,
        chunkSize: source.chunkSize,
        chunkResolution: source.chunkResolution,
        x,
        z,
      });
    }
    const origin = chunkOrigin(chunkX, chunkZ, this.chunkSize);
    return bilinearHeight(
      chunk.heights,
      chunk.resolution,
      x - origin.x,
      z - origin.z,
      chunk.size,
    );
  }

  sampleHeightOrZero(x: number, z: number) {
    return this.sampleHeight(x, z) ?? 0;
  }

  visibleEntities(keys: Iterable<string>) {
    const tomb = new Set(this.world.edits.generatedEntityTombstones);
    const result = [];
    for (const key of keys) {
      const chunk = this.getChunk(key);
      if (!chunk) continue;
      for (const entity of chunk.entities)
        if (!tomb.has(entity.id)) result.push(generatedToWorldEntity(entity));
    }
    for (const entity of this.world.entities) {
      const key = chunkKey(
        worldToChunk(
          entity.transform.position[0],
          entity.transform.position[2],
          this.chunkSize,
        ).chunkX,
        worldToChunk(
          entity.transform.position[0],
          entity.transform.position[2],
          this.chunkSize,
        ).chunkZ,
      );
      if (new Set(keys).has(key)) result.push(entity);
    }
    return result;
  }

  meshFor(key: string): TerrainChunk | undefined {
    if (!this.procedural) {
      const finite = this.finiteMeshMap().get(key);
      if (!finite) return undefined;
      if (this.worldOrigin[0] === 0 && this.worldOrigin[2] === 0) return finite;
      return {
        ...finite,
        vertices: finite.vertices.map((value, index) =>
          index % 3 === 0
            ? value - this.worldOrigin[0]
            : index % 3 === 2
              ? value - this.worldOrigin[2]
              : value,
        ),
      };
    }
    const chunk = this.getChunk(key);
    return chunk ? runtimeChunkMesh(chunk, this.worldOrigin) : undefined;
  }

  toSimulation(global: Vec3): Vec3 {
    return [
      global[0] - this.worldOrigin[0],
      global[1] - this.worldOrigin[1],
      global[2] - this.worldOrigin[2],
    ];
  }

  toGlobal(simulation: Vec3): Vec3 {
    return [
      simulation[0] + this.worldOrigin[0],
      simulation[1] + this.worldOrigin[1],
      simulation[2] + this.worldOrigin[2],
    ];
  }

  planRebase(focusGlobal: Vec3): OriginRebasePlan | undefined {
    if (!this.procedural) return undefined;
    const delta = rebaseDelta(focusGlobal, this.worldOrigin, this.chunkSize, 3);
    if (!delta) return undefined;
    const originBefore: Vec3 = [...this.worldOrigin];
    const originAfter: Vec3 = [
      originBefore[0] + delta[0],
      originBefore[1] + delta[1],
      originBefore[2] + delta[2],
    ];
    return { delta, originBefore, originAfter };
  }

  commitRebase(plan: OriginRebasePlan) {
    this.worldOrigin = [...plan.originAfter];
    this.rebaseCount++;
    this.log(`rebase:${this.worldOrigin[0]},${this.worldOrigin[2]}`);
  }

  /** 判定とcommitを一度に行う。Physics/Engineの通常経路では使わない。 */
  maybeRebase(focusGlobal: Vec3): Vec3 | undefined {
    const plan = this.planRebase(focusGlobal);
    if (!plan) return undefined;
    this.commitRebase(plan);
    return plan.delta;
  }

  stats(current: Vec3 = [0, 0, 0]): WorldRuntimeStats {
    const chunk = worldToChunk(current[0], current[2], this.chunkSize);
    const total = this.hits + this.misses;
    return {
      currentChunk: chunkKey(chunk.chunkX, chunk.chunkZ),
      worldOrigin: [...this.worldOrigin] as Vec3,
      loadedRenderChunks: this.refs.get("renderer")!.size,
      loadedPhysicsChunks: this.refs.get("physics")!.size,
      loadedEditorChunks: this.refs.get("editor")!.size,
      cachedChunks: this.cache.size,
      pendingGenerationCount: this.pending,
      generationLatencyMs: this.lastLatency,
      maxGenerationLatencyMs: this.maxLatency,
      cacheHitRate: total ? this.hits / total : 1,
      rebaseCount: this.rebaseCount,
      syncGenerationCount: this.syncGenerations,
    };
  }

  invalidateEdits() {
    for (const [key, entry] of this.cache) {
      const built = this.buildChunk(key);
      if (built) entry.chunk = applyEditOverlay(built, this.world.edits);
    }
  }

  private buildChunk(key: string): RuntimeChunk | undefined {
    const [chunkX, chunkZ] = parseChunkKey(key);
    if (!isProceduralWorld(this.world)) {
      const mesh = this.finiteMeshMap().get(key);
      if (!mesh) return undefined;
      return meshToRuntime(mesh, chunkX, chunkZ, this.chunkSize);
    }
    const source = this.world.source;
    const generated: GeneratedChunk = generateChunk({
      seed: source.seed,
      generatorVersion: source.generatorVersion,
      preset: source.preset,
      chunkX,
      chunkZ,
      chunkSize: source.chunkSize,
      chunkResolution: source.chunkResolution,
      parameters: source.parameters,
    });
    const tomb = new Set(this.world.edits.generatedEntityTombstones);
    return {
      key,
      chunkX,
      chunkZ,
      size: generated.size,
      resolution: generated.resolution,
      heights: generated.heights,
      colors: generated.colors,
      entities: generated.entities.filter((entity) => !tomb.has(entity.id)),
      lodLevel: 0,
    };
  }

  private finiteMeshMap() {
    if (!this.finiteMeshes) {
      this.finiteMeshes = new Map(
        terrainChunks({ world: this.world }).map((chunk) => [chunk.key, chunk]),
      );
    }
    return this.finiteMeshes;
  }

  private evict() {
    if (this.cache.size <= this.cacheLimit) return;
    const unused = [...this.cache.entries()]
      .filter(([, entry]) => entry.refs.size === 0)
      .sort((a, b) => a[1].lastHit - b[1].lastHit);
    for (const [key] of unused) {
      if (this.cache.size <= this.cacheLimit) break;
      this.cache.delete(key);
      this.log(`evict:${key}`);
    }
  }

  private log(event: string) {
    if (!this.debug) return;
    this.debugEvents.push(event);
    if (this.debugEvents.length > 200) this.debugEvents.shift();
  }
}

function meshToRuntime(
  mesh: TerrainChunk,
  chunkX: number,
  chunkZ: number,
  chunkSize: number,
): RuntimeChunk {
  const resolution = 2;
  return {
    key: mesh.key,
    chunkX,
    chunkZ,
    size: chunkSize,
    resolution,
    heights: new Float32Array([0, 0, 0, 0]),
    colors: ["#7cab68", "#7cab68", "#7cab68", "#7cab68"],
    entities: [],
    lodLevel: 0,
  };
}

export function sampleWorldHeight(world: World, x: number, z: number) {
  if (!isProceduralWorld(world)) return heightAt(world.terrain, x, z);
  return sampleGeneratedHeight({
    seed: world.source.seed,
    generatorVersion: world.source.generatorVersion,
    preset: world.source.preset,
    chunkSize: world.source.chunkSize,
    chunkResolution: world.source.chunkResolution,
    x,
    z,
  });
}
