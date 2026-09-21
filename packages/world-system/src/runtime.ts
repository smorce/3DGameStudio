import { semanticContext } from "../../world-generator/src/design-generation";
import { AssetCatalog, fingerprint } from "../../asset-catalog/src/index";
import type { Project, WorldDesign } from "../../project-schema/src/index";
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
  type GeneratorInput,
} from "../../world-generator/src/index";
import type { PreparedChunk } from "../../world-generator/src/prepare";
import { prepareChunk } from "../../world-generator/src/prepare";
import { rebaseDelta } from "./coordinates";
import { ChunkWorkerPool, type ChunkPriority } from "./chunk-worker-pool";
import { terrainChunks, type TerrainChunk } from "./streaming";

export type WorldConsumer = "renderer" | "physics" | "editor";

export type ChunkLifecycleState =
  "ABSENT" | "QUEUED" | "GENERATING" | "READY" | "COMMITTED" | "EVICTABLE";

export type WorldRuntimeLifecycleEventName =
  "world.chunk.queued" | "world.chunk.ready" | "world.chunk.committed";

export interface WorldRuntimeLifecycleEvent {
  name: WorldRuntimeLifecycleEventName;
  chunkKey: string;
  generation: number;
  timestampMs: number;
  fromWorker?: boolean;
  generationMs?: number;
  commitReason?: "render" | "physics" | "prefetch" | "sync";
}

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
  preparedChunks: number;
  pendingGenerationCount: number;
  pendingQueueCount: number;
  readyRenderCount: number;
  readyPhysicsCount: number;
  workerQueued: number;
  workerInFlight: number;
  workerCount: number;
  generationLatencyMs: number;
  maxGenerationLatencyMs: number;
  lastCommitBatchMs: number;
  streamingRequestMs: number;
  streamingCommitMs: number;
  renderChunkCommitMs: number;
  physicsChunkCommitMs: number;
  workerGenerationMs: number;
  cacheHitRate: number;
  rebaseCount: number;
  syncGenerationCount: number;
  syncFallbackCount: number;
  syncGenerationFallbackCount: number;
  prefetchGenerationCount: number;
  cancelledJobs: number;
  chunksRequested: number;
  chunksCommittedRender: number;
  chunksCommittedPhysics: number;
}

export interface WorldRuntimeOptions {
  assets?: Project["assets"];
  cacheLimit?: number;
  debug?: boolean;
  workerCount?: number;
  forceSyncWorkers?: boolean;
  streamingCommitBudgetMs?: number;
  maxRenderChunksPerFrame?: number;
  maxPhysicsChunksPerFixedStep?: number;
  onLifecycleEvent?: (event: WorldRuntimeLifecycleEvent) => void;
}

export interface ChunkRequest {
  key: string;
  priority: ChunkPriority;
}

export interface CommitBudgetOptions {
  budgetMs?: number;
  maxChunks?: number;
  now?: () => number;
  /** Frame が既に遅れている場合に Render Commit を skip する。 */
  skip?: boolean;
}

interface CacheEntry {
  chunk: RuntimeChunk;
  prepared?: PreparedChunk;
  refs: Map<WorldConsumer, number>;
  lastHit: number;
  state: ChunkLifecycleState;
}

export const STREAMING_COMMIT_BUDGET_MS = 2.0;
export const MAX_RENDER_CHUNKS_PER_FRAME = 2;
export const MAX_PHYSICS_CHUNKS_PER_FIXED_STEP = 4;

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

/** Simulation 座標（origin 相対）のメッシュ。後方互換用。 */
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

/** Chunk-local 頂点 + translation で Physics/Render が共有できる。 */
export function preparedChunkLocalOrigin(
  prepared: PreparedChunk,
  worldOrigin: Vec3,
): Vec3 {
  return [
    prepared.chunkX * prepared.size - worldOrigin[0],
    0,
    prepared.chunkZ * prepared.size - worldOrigin[2],
  ];
}

export class WorldRuntime {
  generation = 0;
  worldOrigin: Vec3 = [0, 0, 0];
  rebaseCount = 0;
  readonly debugEvents: string[] = [];
  private readonly cache = new Map<string, CacheEntry>();
  private readonly prepared = new Map<string, PreparedChunk>();
  private readonly refs = new Map<WorldConsumer, Set<string>>();
  private readonly lifecycle = new Map<string, ChunkLifecycleState>();
  private readonly readyRender: string[] = [];
  private readonly readyPhysics: string[] = [];
  private readonly readyRenderSet = new Set<string>();
  private readonly readyPhysicsSet = new Set<string>();
  /** Request 時点の用途。Ready Queue 振り分けに使う。 */
  private readonly wantsPhysics = new Set<string>();
  private readonly wantsRender = new Set<string>();
  private hits = 0;
  private misses = 0;
  private lastLatency = 0;
  private maxLatency = 0;
  private lastCommitBatchMs = 0;
  private streamingRequestMs = 0;
  private streamingCommitMs = 0;
  private renderChunkCommitMs = 0;
  private physicsChunkCommitMs = 0;
  private syncGenerations = 0;
  private syncFallbacks = 0;
  private prefetchGenerations = 0;
  private chunksRequested = 0;
  private chunksCommittedRender = 0;
  private chunksCommittedPhysics = 0;
  private clock = 0;
  private pending = 0;
  private readonly prefetchQueue: string[] = [];
  private readonly prefetchQueued = new Set<string>();
  private finiteMeshes?: Map<string, TerrainChunk>;
  private cacheLimit: number;
  private debug: boolean;
  private catalog: AssetCatalog;
  private readonly pool: ChunkWorkerPool;
  private generationContextHash = "";
  private generationDesign?: WorldDesign;
  private playHotPath = false;
  private commitBudgetMs: number;
  private maxRenderPerFrame: number;
  private maxPhysicsPerStep: number;
  private readonly onLifecycleEvent?: (
    event: WorldRuntimeLifecycleEvent,
  ) => void;

  constructor(
    public world: World,
    options: WorldRuntimeOptions = {},
  ) {
    this.catalog = new AssetCatalog({ assets: options.assets ?? [] });
    this.cacheLimit = options.cacheLimit ?? DEFAULT_CACHE_LIMIT;
    this.debug = options.debug ?? false;
    this.commitBudgetMs =
      options.streamingCommitBudgetMs ?? STREAMING_COMMIT_BUDGET_MS;
    this.maxRenderPerFrame =
      options.maxRenderChunksPerFrame ?? MAX_RENDER_CHUNKS_PER_FRAME;
    this.maxPhysicsPerStep =
      options.maxPhysicsChunksPerFixedStep ?? MAX_PHYSICS_CHUNKS_PER_FIXED_STEP;
    this.onLifecycleEvent = options.onLifecycleEvent;
    this.pool = new ChunkWorkerPool({
      workerCount: options.workerCount,
      forceSync: options.forceSyncWorkers ?? typeof Worker === "undefined",
      onResult: (result) => {
        this.pending = Math.max(0, this.pending - 1);
        if (result.runtimeGeneration !== this.generation) return;
        this.acceptPrepared(
          result.prepared,
          result.generationMs,
          result.fromWorker,
        );
      },
    });
    this.refreshGenerationContext();
    for (const consumer of ["renderer", "physics", "editor"] as WorldConsumer[])
      this.refs.set(consumer, new Set());
  }

  private resolveGenerated(entities: GeneratedEntity[]) {
    const seed =
      this.world.source.kind === "procedural" ? this.world.source.seed : 0;
    return entities.map((entity) => {
      if (!entity.assetSlot) return entity;
      const resolution = this.catalog.resolveAssetSlot(
        entity.assetSlot,
        {
          seed,
          stablePlacementId: entity.id,
          biome: entity.biome,
          style: "stylized-low-poly",
        },
        this.world.buildManifest,
      );
      return resolution.status === "resolved"
        ? { ...entity, assetId: resolution.asset.id, missingAsset: false }
        : { ...entity, missingAsset: true };
    });
  }

  debugDesignAt(x: number, z: number) {
    const source = this.world.source;
    if (source.kind !== "procedural" || !source.design) return undefined;
    const c = worldToChunk(x, z, source.chunkSize),
      key = chunkKey(c.chunkX, c.chunkZ);
    return {
      ...semanticContext(this.generationDesign!, source.seed).debugSample(x, z),
      chunkKey: key,
      chunkBounds: [
        c.chunkX * source.chunkSize,
        c.chunkZ * source.chunkSize,
        (c.chunkX + 1) * source.chunkSize,
        (c.chunkZ + 1) * source.chunkSize,
      ],
      props:
        this.peekChunk(key)?.entities.map((e) => ({
          id: e.id,
          position: e.position,
          assetSlot: e.assetSlot,
          assetId: e.assetId,
          missingAsset: e.missingAsset,
        })) ?? [],
    };
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
  get workerPool() {
    return this.pool;
  }

  /** PLAY hot path では同期 generate を禁止する。 */
  setPlayHotPath(enabled: boolean) {
    this.playHotPath = enabled;
  }

  get isPlayHotPath() {
    return this.playHotPath;
  }

  isCurrent(ticket: number) {
    return ticket === this.generation;
  }

  private refreshGenerationContext() {
    const source = this.world.source;
    const design = source.kind === "procedural" ? source.design : undefined;
    const hash = fingerprint({
      generatorVersion:
        source.kind === "procedural" ? source.generatorVersion : 1,
      worldDesign: design,
      biomeProfileVersion: this.world.buildManifest?.biomeProfileVersion ?? 1,
    });
    if (hash === this.generationContextHash) return;
    // reload時だけhashとsnapshotを作り、Chunkごとの全Design走査・コピーを避ける。
    // Main ThreadのSemantic cacheも、変更前の参照を使い続けない。
    this.generationContextHash = hash;
    this.generationDesign = design ? structuredClone(design) : undefined;
    this.pool.setGenerationContext(hash, this.generationDesign);
  }

  reload(world: World) {
    this.generation++;
    this.pool.cancelAll();
    this.world = world;
    this.refreshGenerationContext();
    this.cache.clear();
    this.prepared.clear();
    this.lifecycle.clear();
    this.clearReadyQueues();
    this.clearPrefetchQueue();
    this.finiteMeshes = undefined;
    for (const held of this.refs.values()) held.clear();
    this.hits = 0;
    this.misses = 0;
    this.pending = 0;
    this.lastLatency = 0;
    this.maxLatency = 0;
    this.lastCommitBatchMs = 0;
    this.syncGenerations = 0;
    this.syncFallbacks = 0;
    this.prefetchGenerations = 0;
    this.chunksRequested = 0;
    this.chunksCommittedRender = 0;
    this.chunksCommittedPhysics = 0;
    this.worldOrigin = [0, 0, 0];
    this.log("reload");
  }

  dispose() {
    this.generation++;
    this.pool.dispose();
    this.cache.clear();
    this.prepared.clear();
    this.lifecycle.clear();
    this.clearReadyQueues();
    this.clearPrefetchQueue();
    this.finiteMeshes = undefined;
    for (const held of this.refs.values()) held.clear();
  }

  acquire(consumer: WorldConsumer, keys: Iterable<string>) {
    const next = new Set(keys);
    const held = this.refs.get(consumer)!;
    for (const key of held) {
      if (next.has(key)) continue;
      held.delete(key);
      const entry = this.cache.get(key);
      if (entry) {
        const count = (entry.refs.get(consumer) ?? 1) - 1;
        if (count <= 0) entry.refs.delete(consumer);
        else entry.refs.set(consumer, count);
        if (entry.refs.size === 0) entry.state = "EVICTABLE";
      }
    }
    const missing: string[] = [];
    for (const key of next) {
      if (held.has(key)) continue;
      held.add(key);
      const entry = this.cache.get(key);
      if (entry) {
        entry.refs.set(consumer, (entry.refs.get(consumer) ?? 0) + 1);
        entry.state = "COMMITTED";
        continue;
      }
      missing.push(key);
    }
    if (missing.length) this.enqueuePrefetch(missing);
    return missing;
  }

  /**
   * Physics 緊急用。PLAY hot path では prepared を待つだけで同期生成しない。
   * 非 PLAY または forceSync 時のみ同期生成する。
   */
  ensureChunks(keys: Iterable<string>, forceSync = false) {
    for (const key of keys) {
      if (this.cache.has(key) || this.prepared.has(key)) continue;
      if (this.playHotPath && !forceSync) {
        this.requestChunk(key, "P0_PHYSICS_CRITICAL");
        continue;
      }
      this.getChunk(key);
    }
  }

  requestChunk(key: string, priority: ChunkPriority = "P3_RENDER_PREFETCH") {
    this.requestChunks([{ key, priority }]);
  }

  requestChunks(requests: readonly ChunkRequest[]) {
    if (!this.procedural) return;
    const started = performance.now();
    for (const request of requests) {
      this.noteRequestNeeds(request.key, request.priority);
      if (this.cache.has(request.key) || this.prepared.has(request.key)) {
        this.promoteReady(request.key);
        continue;
      }
      const state = this.lifecycle.get(request.key);
      if (state === "GENERATING" || state === "QUEUED") {
        this.pool.enqueue({
          chunkKey: request.key,
          input: this.generatorInput(request.key),
          generationContextHash: this.generationContextHash,
          priority: request.priority,
          runtimeGeneration: this.generation,
        });
        continue;
      }
      this.chunksRequested++;
      this.lifecycle.set(request.key, "QUEUED");
      this.emitLifecycle({
        name: "world.chunk.queued",
        chunkKey: request.key,
      });
      this.pending++;
      const generation = this.generation;
      void this.pool
        .enqueue({
          chunkKey: request.key,
          input: this.generatorInput(request.key),
          generationContextHash: this.generationContextHash,
          priority: request.priority,
          runtimeGeneration: generation,
        })
        .then((result) => {
          if (generation !== this.generation) return;
          // onResult で accept 済み。ここは stale / error 時の pending 調整のみ。
          if (!result) {
            this.pending = Math.max(0, this.pending - 1);
            this.lifecycle.delete(request.key);
          }
        })
        .catch(() => {
          if (generation !== this.generation) return;
          this.pending = Math.max(0, this.pending - 1);
          this.lifecycle.delete(request.key);
        });
      this.lifecycle.set(request.key, "GENERATING");
    }
    this.streamingRequestMs = performance.now() - started;
  }

  enqueuePrefetch(keys: Iterable<string>) {
    const requests: ChunkRequest[] = [];
    for (const key of keys) {
      if (this.cache.has(key) || this.prepared.has(key)) continue;
      if (this.prefetchQueued.has(key)) continue;
      this.prefetchQueued.add(key);
      this.prefetchQueue.push(key);
      requests.push({ key, priority: "P3_RENDER_PREFETCH" });
    }
    if (requests.length) this.requestChunks(requests);
  }

  /**
   * 先読み待ち行列と Ready Queue を予算内で処理する。
   * Worker 化後は主に Ready Commit と sync fallback の入口。
   */
  pumpGeneration(budgetMs = 3, maxChunks = 2) {
    const started = performance.now();
    let built = 0;
    // まだ Worker 結果が無いキーは、テスト/EDIT 用に同期 prepare を予算内で行う。
    while (
      this.prefetchQueue.length &&
      built < maxChunks &&
      performance.now() - started < budgetMs
    ) {
      const key = this.prefetchQueue.shift()!;
      this.prefetchQueued.delete(key);
      if (this.cache.has(key) || this.prepared.has(key)) continue;
      if (this.playHotPath) {
        this.requestChunk(key, "P3_RENDER_PREFETCH");
        continue;
      }
      this.commitPreparedSync(key, "prefetch");
      built++;
    }
    this.lastCommitBatchMs = performance.now() - started;
    return built;
  }

  takeReadyRenderChunks(options: CommitBudgetOptions = {}) {
    if (options.skip) return [] as PreparedChunk[];
    return this.takeReady(
      this.readyRender,
      this.readyRenderSet,
      options.budgetMs ?? this.commitBudgetMs,
      options.maxChunks ?? this.maxRenderPerFrame,
      options.now ?? (() => performance.now()),
      "render",
    );
  }

  takeReadyPhysicsChunks(options: CommitBudgetOptions = {}) {
    return this.takeReady(
      this.readyPhysics,
      this.readyPhysicsSet,
      options.budgetMs ?? this.commitBudgetMs,
      options.maxChunks ?? this.maxPhysicsPerStep,
      options.now ?? (() => performance.now()),
      "physics",
    );
  }

  /** Fixed step 境界で Physics Critical を commit する。 */
  commitPhysicsCriticalReady(options: CommitBudgetOptions = {}) {
    this.pool.flush();
    const started = performance.now();
    const ready = this.takeReadyPhysicsChunks(options);
    for (const prepared of ready)
      this.commitPreparedToCache(prepared, "physics");
    this.physicsChunkCommitMs = performance.now() - started;
    this.streamingCommitMs =
      this.physicsChunkCommitMs + this.renderChunkCommitMs;
    return ready;
  }

  /** Frame 予算内で Render Ready を commit する。 */
  commitGeneralWithinBudget(options: CommitBudgetOptions = {}) {
    this.pool.flush();
    const started = performance.now();
    const ready = this.takeReadyRenderChunks(options);
    for (const prepared of ready)
      this.commitPreparedToCache(prepared, "render");
    this.renderChunkCommitMs = performance.now() - started;
    this.streamingCommitMs =
      this.physicsChunkCommitMs + this.renderChunkCommitMs;
    return ready;
  }

  /**
   * 必要 Physics Chunk が揃うまで待つ Barrier。
   * Play 開始 / Respawn / Teleport 用。
   */
  async ensurePhysicsReady(
    position: Vec3,
    radius = 1,
    timeoutMs = 5000,
  ): Promise<boolean> {
    const keys = [...this.keysAround(position, radius)];
    for (const key of keys) this.requestChunk(key, "P0_PHYSICS_CRITICAL");
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      for (const key of keys) {
        if (this.prepared.has(key) && !this.cache.has(key))
          this.commitPreparedToCache(this.prepared.get(key)!, "physics");
      }
      // sync 環境では即 prepare する。
      if (!this.playHotPath || this.pool.stats.workerCount === 0) {
        for (const key of keys)
          if (!this.cache.has(key)) this.commitPreparedSync(key, "sync");
      }
      if (keys.every((key) => this.cache.has(key) || this.prepared.has(key))) {
        for (const key of keys) {
          const prepared = this.prepared.get(key);
          if (prepared && !this.cache.has(key))
            this.commitPreparedToCache(prepared, "physics");
        }
        return keys.every((key) => this.cache.has(key));
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return false;
  }

  isPending(key: string) {
    const state = this.lifecycle.get(key);
    return state === "QUEUED" || state === "GENERATING";
  }

  isReady(key: string) {
    return this.prepared.has(key) || this.cache.has(key);
  }

  peekPreparedChunk(key: string) {
    return this.prepared.get(key) ?? this.cache.get(key)?.prepared;
  }

  getChunk(key: string): RuntimeChunk | undefined {
    const cached = this.cache.get(key);
    if (cached) {
      this.hits++;
      cached.lastHit = ++this.clock;
      return cached.chunk;
    }
    this.misses++;
    if (this.prepared.has(key)) {
      return this.commitPreparedToCache(this.prepared.get(key)!, "prefetch");
    }
    if (this.playHotPath) {
      this.syncFallbacks++;
      this.requestChunk(key, "P0_PHYSICS_CRITICAL");
      return undefined;
    }
    return this.commitPreparedSync(key, "sync");
  }

  peekChunk(key: string) {
    return this.cache.get(key)?.chunk;
  }

  sampleHeight(x: number, z: number): number | undefined {
    if (!isProceduralWorld(this.world))
      return heightAtIfInside(this.world.terrain, x, z);
    const source = this.world.source;
    const { chunkX, chunkZ } = worldToChunk(x, z, this.chunkSize);
    const key = chunkKey(chunkX, chunkZ);
    const hasEdit = Boolean(this.world.edits.terrainChunks[key]);
    // Edit がある場合は軽量サンプルでは再現できないため Cache を使う。
    const chunk =
      this.peekChunk(key) ??
      (hasEdit && !this.playHotPath ? this.getChunk(key) : undefined);
    if (!chunk) {
      // Cache miss では Full Chunk 生成せず軽量サンプルを使う。
      return sampleGeneratedHeight({
        design: this.generationDesign,
        seed: source.seed,
        generatorVersion: source.generatorVersion,
        biomeProfileVersion: this.world.buildManifest?.biomeProfileVersion ?? 1,
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
      const chunk = this.peekChunk(key) ?? this.getChunk(key);
      if (!chunk) continue;
      for (const entity of chunk.entities)
        if (!tomb.has(entity.id)) result.push(generatedToWorldEntity(entity));
    }
    for (const entity of this.world.entities) {
      const wt = worldToChunk(
        entity.transform.position[0],
        entity.transform.position[2],
        this.chunkSize,
      );
      const key = chunkKey(wt.chunkX, wt.chunkZ);
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
    const prepared = this.peekPreparedChunk(key);
    if (prepared) {
      const origin = preparedChunkLocalOrigin(prepared, this.worldOrigin);
      const vertices = new Array<number>(prepared.positions.length);
      for (let i = 0; i < prepared.positions.length; i += 3) {
        vertices[i] = prepared.positions[i] + origin[0];
        vertices[i + 1] = prepared.positions[i + 1];
        vertices[i + 2] = prepared.positions[i + 2] + origin[2];
      }
      return {
        key,
        vertices,
        indices: [...prepared.indices],
        colors: prepared.colorHex,
      };
    }
    const chunk = this.playHotPath ? this.peekChunk(key) : this.getChunk(key);
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
    const pool = this.pool.stats;
    return {
      currentChunk: chunkKey(chunk.chunkX, chunk.chunkZ),
      worldOrigin: [...this.worldOrigin] as Vec3,
      loadedRenderChunks: this.refs.get("renderer")!.size,
      loadedPhysicsChunks: this.refs.get("physics")!.size,
      loadedEditorChunks: this.refs.get("editor")!.size,
      cachedChunks: this.cache.size,
      preparedChunks: this.prepared.size,
      pendingGenerationCount: this.pending,
      pendingQueueCount: this.prefetchQueue.length + pool.queued,
      readyRenderCount: this.readyRender.length,
      readyPhysicsCount: this.readyPhysics.length,
      workerQueued: pool.queued,
      workerInFlight: pool.inFlight,
      workerCount: pool.workerCount,
      generationLatencyMs: this.lastLatency,
      maxGenerationLatencyMs: this.maxLatency,
      lastCommitBatchMs: this.lastCommitBatchMs,
      streamingRequestMs: this.streamingRequestMs,
      streamingCommitMs: this.streamingCommitMs,
      renderChunkCommitMs: this.renderChunkCommitMs,
      physicsChunkCommitMs: this.physicsChunkCommitMs,
      workerGenerationMs: pool.lastWorkerGenerationMs,
      cacheHitRate: total ? this.hits / total : 1,
      rebaseCount: this.rebaseCount,
      syncGenerationCount: this.syncGenerations,
      syncFallbackCount: this.syncFallbacks,
      syncGenerationFallbackCount: this.syncFallbacks,
      prefetchGenerationCount: this.prefetchGenerations,
      cancelledJobs: pool.cancelled,
      chunksRequested: this.chunksRequested,
      chunksCommittedRender: this.chunksCommittedRender,
      chunksCommittedPhysics: this.chunksCommittedPhysics,
    };
  }

  invalidateEdits() {
    const edited = Object.keys(this.world.edits.terrainChunks);
    for (const key of edited) {
      this.prepared.delete(key);
      this.cache.delete(key);
      this.lifecycle.delete(key);
      this.removeFromReadyQueues(key);
      this.wantsPhysics.delete(key);
      this.wantsRender.delete(key);
    }
    // 編集キーは再生成し、Prepared に Edit を焼き込む。
    for (const key of edited) this.requestChunk(key, "P2_VISIBLE_RENDER");
  }

  private takeReady(
    queue: string[],
    set: Set<string>,
    budgetMs: number,
    maxChunks: number,
    now: () => number,
    kind: "render" | "physics",
  ) {
    const started = now();
    const result: PreparedChunk[] = [];
    while (
      queue.length &&
      result.length < maxChunks &&
      now() - started < budgetMs
    ) {
      const key = queue.shift()!;
      set.delete(key);
      if (this.cache.has(key)) continue;
      const prepared = this.prepared.get(key);
      if (!prepared) continue;
      result.push(prepared);
    }
    if (kind === "render") this.renderChunkCommitMs = now() - started;
    else this.physicsChunkCommitMs = now() - started;
    return result;
  }

  private noteRequestNeeds(key: string, priority: ChunkPriority) {
    if (
      priority === "P0_PHYSICS_CRITICAL" ||
      priority === "P1_PHYSICS_PREFETCH"
    )
      this.wantsPhysics.add(key);
    if (
      priority === "P2_VISIBLE_RENDER" ||
      priority === "P3_RENDER_PREFETCH" ||
      priority === "P4_EDITOR"
    )
      this.wantsRender.add(key);
  }

  private promoteReady(key: string) {
    if (this.cache.has(key)) return;
    if (this.wantsPhysics.has(key) && !this.readyPhysicsSet.has(key)) {
      this.readyPhysics.push(key);
      this.readyPhysicsSet.add(key);
    }
    if (this.wantsRender.has(key) && !this.readyRenderSet.has(key)) {
      this.readyRender.push(key);
      this.readyRenderSet.add(key);
    }
  }

  private acceptPrepared(
    prepared: PreparedChunk,
    generationMs: number,
    fromWorker: boolean,
  ) {
    this.lastLatency = generationMs;
    this.maxLatency = Math.max(this.maxLatency, generationMs);
    this.prepared.set(prepared.key, prepared);
    this.lifecycle.set(prepared.key, "READY");
    this.prefetchQueued.delete(prepared.key);
    const queuedAt = this.prefetchQueue.indexOf(prepared.key);
    if (queuedAt >= 0) this.prefetchQueue.splice(queuedAt, 1);
    // Request 時に記録した Physics / Render 用途だけへ振り分ける。
    this.promoteReady(prepared.key);
    this.log(`ready:${prepared.key}`);
    this.emitLifecycle({
      name: "world.chunk.ready",
      chunkKey: prepared.key,
      fromWorker,
      generationMs,
    });
    this.evictPrepared();
  }

  private commitPreparedSync(key: string, reason: "sync" | "prefetch") {
    if (reason === "sync") {
      this.syncGenerations++;
      if (this.playHotPath) this.syncFallbacks++;
    }
    const started = performance.now();
    this.pending++;
    const ticket = this.generation;
    const prepared = this.procedural
      ? prepareChunk(this.generatorInput(key))
      : undefined;
    this.pending--;
    this.lastLatency = performance.now() - started;
    this.maxLatency = Math.max(this.maxLatency, this.lastLatency);
    if (!prepared || ticket !== this.generation) {
      // finite world fallback
      const built = this.buildChunk(key);
      if (!built || ticket !== this.generation) return undefined;
      const chunk = applyEditOverlay(built, this.world.edits);
      this.cache.set(key, {
        chunk,
        refs: this.refsFor(key),
        lastHit: ++this.clock,
        state: "COMMITTED",
      });
      this.lifecycle.set(key, "COMMITTED");
      this.emitLifecycle({
        name: "world.chunk.committed",
        chunkKey: key,
        commitReason: reason === "sync" ? "sync" : "prefetch",
      });
      if (reason === "prefetch") this.prefetchGenerations++;
      return chunk;
    }
    this.prepared.set(key, prepared);
    this.lifecycle.set(key, "READY");
    this.emitLifecycle({
      name: "world.chunk.ready",
      chunkKey: key,
      fromWorker: false,
      generationMs: this.lastLatency,
    });
    return this.commitPreparedToCache(
      prepared,
      reason === "sync" ? "physics" : "prefetch",
    );
  }

  private commitPreparedToCache(
    prepared: PreparedChunk,
    reason: "render" | "physics" | "prefetch",
  ) {
    const existing = this.cache.get(prepared.key);
    if (existing) {
      existing.prepared = prepared;
      existing.lastHit = ++this.clock;
      return existing.chunk;
    }
    const tomb = new Set(this.world.edits.generatedEntityTombstones);
    // PreparedChunk 側で terrainEdit 済み。二重適用しない。
    const chunk: RuntimeChunk = {
      key: prepared.key,
      chunkX: prepared.chunkX,
      chunkZ: prepared.chunkZ,
      size: prepared.size,
      resolution: prepared.resolution,
      heights: prepared.heights,
      colors: prepared.colorHex,
      entities: this.resolveGenerated(
        prepared.entities.filter((entity) => !tomb.has(entity.id)),
      ),
      lodLevel: 0,
    };
    this.cache.set(prepared.key, {
      chunk,
      prepared,
      refs: this.refsFor(prepared.key),
      lastHit: ++this.clock,
      state: "COMMITTED",
    });
    this.lifecycle.set(prepared.key, "COMMITTED");
    this.removeFromReadyQueues(prepared.key);
    this.wantsPhysics.delete(prepared.key);
    this.wantsRender.delete(prepared.key);
    if (reason === "render") this.chunksCommittedRender++;
    if (reason === "physics") this.chunksCommittedPhysics++;
    if (reason === "prefetch") this.prefetchGenerations++;
    this.log(`commit:${prepared.key}`);
    this.emitLifecycle({
      name: "world.chunk.committed",
      chunkKey: prepared.key,
      commitReason: reason,
    });
    this.evict();
    return chunk;
  }

  private refsFor(key: string) {
    const refs = new Map<WorldConsumer, number>();
    for (const [consumer, held] of this.refs)
      if (held.has(key)) refs.set(consumer, 1);
    return refs;
  }

  private generatorInput(key: string): GeneratorInput {
    const [chunkX, chunkZ] = parseChunkKey(key);
    if (!isProceduralWorld(this.world)) {
      return {
        seed: 0,
        generatorVersion: 1,
        preset: "grassland",
        chunkX,
        chunkZ,
        chunkSize: this.chunkSize,
        chunkResolution: this.chunkResolution,
      };
    }
    const source = this.world.source;
    const edit = this.world.edits.terrainChunks[key];
    return {
      seed: source.seed,
      generatorVersion: source.generatorVersion,
      biomeProfileVersion: this.world.buildManifest?.biomeProfileVersion ?? 1,
      preset: source.preset,
      chunkX,
      chunkZ,
      chunkSize: source.chunkSize,
      chunkResolution: source.chunkResolution,
      parameters: source.parameters,
      design: this.generationDesign,
      terrainEdit: edit
        ? {
            heightDeltas: edit.heightDeltas,
            colors: edit.colors,
          }
        : undefined,
    };
  }

  private keysAround(position: Vec3, radius: number) {
    const { chunkX, chunkZ } = worldToChunk(
      position[0],
      position[2],
      this.chunkSize,
    );
    const keys = new Set<string>();
    for (let i = chunkX - radius; i <= chunkX + radius; i++)
      for (let j = chunkZ - radius; j <= chunkZ + radius; j++)
        keys.add(chunkKey(i, j));
    return keys;
  }

  private clearPrefetchQueue() {
    this.prefetchQueue.length = 0;
    this.prefetchQueued.clear();
  }

  private clearReadyQueues() {
    this.readyRender.length = 0;
    this.readyPhysics.length = 0;
    this.readyRenderSet.clear();
    this.readyPhysicsSet.clear();
    this.wantsPhysics.clear();
    this.wantsRender.clear();
  }

  private removeFromReadyQueues(key: string) {
    this.readyRenderSet.delete(key);
    this.readyPhysicsSet.delete(key);
    for (let i = this.readyRender.length - 1; i >= 0; i--)
      if (this.readyRender[i] === key) this.readyRender.splice(i, 1);
    for (let i = this.readyPhysics.length - 1; i >= 0; i--)
      if (this.readyPhysics[i] === key) this.readyPhysics.splice(i, 1);
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
      biomeProfileVersion: this.world.buildManifest?.biomeProfileVersion ?? 1,
      preset: source.preset,
      chunkX,
      chunkZ,
      chunkSize: source.chunkSize,
      chunkResolution: source.chunkResolution,
      parameters: source.parameters,
      design: this.generationDesign,
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
      entities: this.resolveGenerated(
        generated.entities.filter((entity) => !tomb.has(entity.id)),
      ),
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
      this.lifecycle.set(key, "EVICTABLE");
      this.log(`evict:${key}`);
    }
  }

  private evictPrepared() {
    if (this.prepared.size <= this.cacheLimit * 2) return;
    for (const key of this.prepared.keys()) {
      if (this.prepared.size <= this.cacheLimit) break;
      if (this.cache.has(key)) continue;
      if (this.readyRenderSet.has(key) || this.readyPhysicsSet.has(key))
        continue;
      this.prepared.delete(key);
      this.lifecycle.delete(key);
    }
  }

  private log(event: string) {
    if (!this.debug) return;
    this.debugEvents.push(event);
    if (this.debugEvents.length > 200) this.debugEvents.shift();
  }

  private emitLifecycle(
    event: Omit<WorldRuntimeLifecycleEvent, "generation" | "timestampMs">,
  ) {
    this.onLifecycleEvent?.({
      ...event,
      generation: this.generation,
      timestampMs: performance.now(),
    });
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
    design: world.source.design,
    seed: world.source.seed,
    generatorVersion: world.source.generatorVersion,
    preset: world.source.preset,
    chunkSize: world.source.chunkSize,
    chunkResolution: world.source.chunkResolution,
    x,
    z,
  });
}
