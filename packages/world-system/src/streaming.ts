import type { Vec3, World } from "../../project-schema/src/index";
import {
  PrefetchDirectionState,
  chunkCoordinate,
  visibleChunks,
  visibleChunksWithPrefetch,
  type PrefetchOptions,
} from "./chunks";

export interface TerrainChunk {
  key: string;
  vertices: number[];
  indices: number[];
  colors: string[];
}

export function terrainChunks(project: {
  world: Pick<World, "terrain" | "chunkSize">;
}): TerrainChunk[] {
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

export interface ChunkStreamerOptions {
  /** 1 update あたりの最大 create 数。既定 Infinity（後方互換）。 */
  maxCreatesPerUpdate?: number;
  /** create に使える時間予算(ms)。既定 Infinity。 */
  budgetMs?: number;
  /**
   * この半径内の不足 Chunk は予算を無視して必ず同期作成する。
   * Renderer は 0、Physics は 1 を想定。
   */
  urgentRadius?: number;
  prefetch?: PrefetchOptions;
}

export interface ChunkStreamerUpdateStats {
  created: number;
  pending: number;
  commitMs: number;
  syncFallback: number;
  urgentCreated: number;
}

const unlimited = Number.POSITIVE_INFINITY;

export class ChunkStreamer<T> {
  readonly loaded = new Map<string, T>();
  readonly pending = new Set<string>();
  readonly direction = new PrefetchDirectionState();
  private lastStats: ChunkStreamerUpdateStats = {
    created: 0,
    pending: 0,
    commitMs: 0,
    syncFallback: 0,
    urgentCreated: 0,
  };
  private syncFallbackTotal = 0;
  private readonly maxCreates: number;
  private readonly budgetMs: number;
  private readonly urgentRadius: number;
  private readonly prefetchOptions: PrefetchOptions;

  constructor(
    private create: (key: string) => T | undefined,
    private destroy: (value: T) => void,
    private size: number,
    private radius = 2,
    private unloadRadius = radius + 1,
    options: ChunkStreamerOptions = {},
  ) {
    this.maxCreates = options.maxCreatesPerUpdate ?? unlimited;
    this.budgetMs = options.budgetMs ?? unlimited;
    this.urgentRadius = options.urgentRadius ?? unlimited;
    this.prefetchOptions = {
      ...options.prefetch,
      direction: options.prefetch?.direction ?? this.direction,
    };
  }

  get stats(): ChunkStreamerUpdateStats & { syncFallbackTotal: number } {
    return { ...this.lastStats, syncFallbackTotal: this.syncFallbackTotal };
  }

  update(position: Vec3, velocity?: Vec3): ChunkStreamerUpdateStats {
    const active = visibleChunksWithPrefetch(
      position,
      this.size,
      this.radius,
      velocity,
      this.prefetchOptions,
    );
    for (const key of active) if (!this.loaded.has(key)) this.pending.add(key);
    for (const key of [...this.pending])
      if (!active.has(key) || this.loaded.has(key)) this.pending.delete(key);

    const [cx, cz] = chunkCoordinate(position, this.size);
    const urgent =
      this.urgentRadius < unlimited
        ? visibleChunks(position, this.size, this.urgentRadius)
        : active;

    const started = performance.now();
    let created = 0;
    let urgentCreated = 0;
    let syncFallback = 0;

    /** created=成功, skip=未準備など, budget=予算切れで打ち切り */
    const tryCreate = (
      key: string,
      force: boolean,
    ): "created" | "skip" | "budget" => {
      if (this.loaded.has(key)) {
        this.pending.delete(key);
        return "skip";
      }
      if (
        !force &&
        (created >= this.maxCreates ||
          performance.now() - started >= this.budgetMs)
      )
        return "budget";
      const value = this.create(key);
      // 未準備なら pending を残し、予算も消費しない（Ready 済みを優先）。
      if (value === undefined) return "skip";
      this.pending.delete(key);
      this.loaded.set(key, value);
      created++;
      if (force && this.urgentRadius < unlimited) {
        urgentCreated++;
        if (this.maxCreates < unlimited || this.budgetMs < unlimited) {
          syncFallback++;
          this.syncFallbackTotal++;
        }
      }
      return "created";
    };

    for (const key of urgent) tryCreate(key, true);

    const ranked = [...this.pending].sort((a, b) => {
      const pa = priority(a, cx, cz, velocity, this.direction);
      const pb = priority(b, cx, cz, velocity, this.direction);
      return pa - pb;
    });
    for (const key of ranked) {
      if (tryCreate(key, false) === "budget") break;
    }

    const retained = visibleChunks(position, this.size, this.unloadRadius);
    for (const [key, value] of this.loaded)
      if (!retained.has(key)) {
        this.destroy(value);
        this.loaded.delete(key);
        this.pending.delete(key);
      }

    this.lastStats = {
      created,
      pending: this.pending.size,
      commitMs: performance.now() - started,
      syncFallback,
      urgentCreated,
    };
    return this.lastStats;
  }

  /**
   * Physics Critical 用: urgent 半径内の不足 Chunk だけ Collider を作る。
   * Prefetch / 予算付き一般 Create は行わない。
   */
  commitUrgent(position: Vec3, velocity?: Vec3): ChunkStreamerUpdateStats {
    const urgent =
      this.urgentRadius < unlimited
        ? visibleChunks(position, this.size, this.urgentRadius)
        : visibleChunksWithPrefetch(
            position,
            this.size,
            this.radius,
            velocity,
            this.prefetchOptions,
          );
    const started = performance.now();
    let created = 0;
    for (const key of urgent) {
      if (this.loaded.has(key)) continue;
      const value = this.create(key);
      if (value === undefined) continue;
      this.pending.delete(key);
      this.loaded.set(key, value);
      created++;
    }
    this.lastStats = {
      created,
      pending: this.pending.size,
      commitMs: performance.now() - started,
      syncFallback: 0,
      urgentCreated: created,
    };
    return this.lastStats;
  }

  dispose() {
    this.loaded.forEach(this.destroy);
    this.loaded.clear();
    this.pending.clear();
    this.direction.reset();
  }
}

function priority(
  key: string,
  cx: number,
  cz: number,
  velocity: Vec3 | undefined,
  direction: PrefetchDirectionState,
) {
  const [x, z] = key.split(",").map(Number);
  const dx = x - cx;
  const dz = z - cz;
  const dist = dx * dx + dz * dz;
  const resolved = direction.active
    ? { nx: direction.nx, nz: direction.nz }
    : velocity && Math.hypot(velocity[0], velocity[2]) >= 8
      ? {
          nx: velocity[0] / Math.hypot(velocity[0], velocity[2]),
          nz: velocity[2] / Math.hypot(velocity[0], velocity[2]),
        }
      : undefined;
  const ahead = resolved ? -(dx * resolved.nx + dz * resolved.nz) : 0;
  return dist + ahead * 0.25;
}

export const physicsStreaming = {
  loadRadius: 2,
  unloadRadius: 3,
  /** 進行線先読みの上限（チャンク数）。 */
  prefetchAheadMax: 6,
  urgentRadius: 1,
  maxCreatesPerUpdate: 2,
  budgetMs: 2,
  futureHorizonsSec: [0.5, 1.0, 1.5, 2.0],
  retentionSec: 0.75,
};

export const renderStreaming = {
  maxCreatesPerUpdate: 2,
  budgetMs: 2,
  urgentRadius: 0,
  prefetchAheadMax: 5,
  futureHorizonsSec: [0.5, 1.0, 1.5, 2.0],
  retentionSec: 0.75,
};
