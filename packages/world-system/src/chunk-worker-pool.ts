import type { GeneratorInput } from "../../world-generator/src/index";
import {
  CHUNK_PRIORITY_ORDER,
  handlePrepareRequest,
  higherPriority,
  prepareChunkOnThisThread,
  type ChunkPriority,
  type PrepareChunkRequest,
  type PreparedChunk,
  type WorkerOutbound,
} from "../../world-generator/src/worker";

export type { ChunkPriority, PreparedChunk };

export interface ChunkJobRequest {
  chunkKey: string;
  input: GeneratorInput;
  priority: ChunkPriority;
  runtimeGeneration: number;
}

export interface ChunkJobResult {
  chunkKey: string;
  jobId: number;
  runtimeGeneration: number;
  prepared: PreparedChunk;
  fromWorker: boolean;
  generationMs: number;
}

export interface ChunkWorkerPoolOptions {
  workerCount?: number;
  /** 実 Worker が使えない環境では同スレッドで実行する。 */
  forceSync?: boolean;
  /** Job 完了時に同期的に呼ばれる（Ready Queue へ即反映するため）。 */
  onResult?: (result: ChunkJobResult) => void;
}

export interface ChunkWorkerPoolStats {
  workerCount: number;
  queued: number;
  inFlight: number;
  completed: number;
  cancelled: number;
  syncFallback: number;
  maxQueueLength: number;
  maxWorkerGenerationMs: number;
  lastWorkerGenerationMs: number;
}

interface QueuedJob {
  jobId: number;
  chunkKey: string;
  input: GeneratorInput;
  priority: ChunkPriority;
  runtimeGeneration: number;
  resolve: (result: ChunkJobResult | undefined) => void;
  reject: (error: Error) => void;
}

function defaultWorkerCount() {
  const cores =
    typeof navigator !== "undefined" ? (navigator.hardwareConcurrency ?? 4) : 2;
  return Math.max(1, Math.min(4, cores - 2));
}

function canUseWorkers(forceSync?: boolean) {
  if (forceSync) return false;
  if (typeof Worker === "undefined") return false;
  if (typeof import.meta === "undefined" || !import.meta.url) return false;
  return true;
}

export class ChunkWorkerPool {
  private readonly workers: Worker[] = [];
  private readonly busy = new Set<Worker>();
  /** Worker が処理中の Job。onerror 時の回収に使う。 */
  private readonly jobByWorker = new Map<Worker, QueuedJob>();
  private readonly queue: QueuedJob[] = [];
  private readonly pendingByKey = new Map<string, QueuedJob>();
  private readonly inFlightByKey = new Map<string, QueuedJob>();
  private nextJobId = 1;
  private disposed = false;
  private completed = 0;
  private cancelled = 0;
  private syncFallback = 0;
  private maxQueueLength = 0;
  private maxWorkerGenerationMs = 0;
  private lastWorkerGenerationMs = 0;
  private readonly useWorkers: boolean;
  private readonly desiredCount: number;
  private syncPumpScheduled = false;
  private readonly onResult?: (result: ChunkJobResult) => void;

  constructor(options: ChunkWorkerPoolOptions = {}) {
    this.desiredCount = options.workerCount ?? defaultWorkerCount();
    this.useWorkers = canUseWorkers(options.forceSync);
    this.onResult = options.onResult;
    if (this.useWorkers) this.spawnWorkers(this.desiredCount);
  }

  get stats(): ChunkWorkerPoolStats {
    return {
      workerCount: this.useWorkers ? this.workers.length : 0,
      queued: this.queue.length,
      inFlight: this.inFlightByKey.size,
      completed: this.completed,
      cancelled: this.cancelled,
      syncFallback: this.syncFallback,
      maxQueueLength: this.maxQueueLength,
      maxWorkerGenerationMs: this.maxWorkerGenerationMs,
      lastWorkerGenerationMs: this.lastWorkerGenerationMs,
    };
  }

  /** 同一 Chunk の Job を重複させず、より高い Priority へ昇格する。 */
  enqueue(request: ChunkJobRequest): Promise<ChunkJobResult | undefined> {
    if (this.disposed) return Promise.resolve(undefined);
    const existing =
      this.pendingByKey.get(request.chunkKey) ??
      this.inFlightByKey.get(request.chunkKey);
    if (existing) {
      existing.priority = higherPriority(existing.priority, request.priority);
      existing.runtimeGeneration = request.runtimeGeneration;
      existing.input = request.input;
      this.reheap();
      return new Promise((resolve, reject) => {
        const previousResolve = existing.resolve;
        const previousReject = existing.reject;
        existing.resolve = (result) => {
          previousResolve(result);
          resolve(result);
        };
        existing.reject = (error) => {
          previousReject(error);
          reject(error);
        };
      });
    }
    return new Promise((resolve, reject) => {
      const job: QueuedJob = {
        jobId: this.nextJobId++,
        chunkKey: request.chunkKey,
        input: request.input,
        priority: request.priority,
        runtimeGeneration: request.runtimeGeneration,
        resolve,
        reject,
      };
      this.queue.push(job);
      this.pendingByKey.set(job.chunkKey, job);
      this.reheap();
      this.maxQueueLength = Math.max(this.maxQueueLength, this.queue.length);
      this.schedulePump();
    });
  }

  /** 同ティック合流後に必ず消化する。Frame / Fixed Step 境界から呼ぶ。 */
  flush() {
    this.syncPumpScheduled = false;
    this.pump();
  }

  cancelAll(runtimeGeneration?: number) {
    const dropQueued = [...this.queue];
    this.queue.length = 0;
    this.pendingByKey.clear();
    for (const job of dropQueued) {
      if (
        runtimeGeneration !== undefined &&
        job.runtimeGeneration === runtimeGeneration
      )
        continue;
      this.cancelled++;
      job.resolve(undefined);
    }
    for (const [key, job] of this.inFlightByKey) {
      if (
        runtimeGeneration !== undefined &&
        job.runtimeGeneration === runtimeGeneration
      )
        continue;
      this.inFlightByKey.delete(key);
      this.cancelled++;
      job.resolve(undefined);
    }
    this.jobByWorker.clear();
  }

  dispose() {
    this.disposed = true;
    this.cancelAll();
    for (const worker of this.workers) worker.terminate();
    this.workers.length = 0;
    this.busy.clear();
    this.jobByWorker.clear();
  }

  private spawnWorkers(count: number) {
    for (let i = 0; i < count; i++) this.spawnOneWorker();
  }

  private spawnOneWorker(): Worker | undefined {
    try {
      const worker = new Worker(
        new URL("../../world-generator/src/worker-entry.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (event: MessageEvent<WorkerOutbound>) =>
        this.onWorkerMessage(worker, event.data);
      worker.onerror = () => this.onWorkerError(worker);
      this.workers.push(worker);
      return worker;
    } catch {
      // Worker 生成に失敗したら同スレッドへフォールバックする。
      return undefined;
    }
  }

  private onWorkerError(worker: Worker) {
    const job = this.jobByWorker.get(worker);
    this.jobByWorker.delete(worker);
    this.busy.delete(worker);
    const index = this.workers.indexOf(worker);
    if (index >= 0) this.workers.splice(index, 1);
    try {
      worker.terminate();
    } catch {
      /* ignore terminate failure */
    }
    if (job) {
      this.inFlightByKey.delete(job.chunkKey);
      // 再試行のため Queue へ戻す。永久 in-flight を避ける。
      this.queue.push(job);
      this.pendingByKey.set(job.chunkKey, job);
      this.reheap();
    }
    if (!this.disposed && this.useWorkers) this.spawnOneWorker();
    this.pump();
  }

  private schedulePump() {
    if (this.useWorkers && this.workers.length > 0) {
      this.pump();
      return;
    }
    if (this.syncPumpScheduled) return;
    this.syncPumpScheduled = true;
    queueMicrotask(() => {
      this.syncPumpScheduled = false;
      this.pump();
    });
  }

  private pump() {
    if (this.disposed) return;
    if (!this.useWorkers || this.workers.length === 0) {
      this.pumpSync();
      return;
    }
    for (const worker of this.workers) {
      if (this.busy.has(worker)) continue;
      const job = this.queue.shift();
      if (!job) return;
      this.pendingByKey.delete(job.chunkKey);
      this.inFlightByKey.set(job.chunkKey, job);
      this.busy.add(worker);
      this.jobByWorker.set(worker, job);
      const message: PrepareChunkRequest = {
        type: "prepare-chunk",
        jobId: job.jobId,
        runtimeGeneration: job.runtimeGeneration,
        chunkKey: job.chunkKey,
        input: job.input,
      };
      worker.postMessage(message);
    }
  }

  private pumpSync() {
    while (this.queue.length) {
      const job = this.queue.shift()!;
      this.pendingByKey.delete(job.chunkKey);
      this.inFlightByKey.set(job.chunkKey, job);
      this.syncFallback++;
      try {
        const started = performance.now();
        const prepared = prepareChunkOnThisThread(job.input);
        const generationMs = performance.now() - started;
        this.lastWorkerGenerationMs = generationMs;
        this.maxWorkerGenerationMs = Math.max(
          this.maxWorkerGenerationMs,
          generationMs,
        );
        this.inFlightByKey.delete(job.chunkKey);
        this.completed++;
        const result: ChunkJobResult = {
          chunkKey: job.chunkKey,
          jobId: job.jobId,
          runtimeGeneration: job.runtimeGeneration,
          prepared,
          fromWorker: false,
          generationMs,
        };
        this.onResult?.(result);
        job.resolve(result);
      } catch (error) {
        this.inFlightByKey.delete(job.chunkKey);
        job.reject(
          error instanceof Error ? error : new Error("Sync prepare failed"),
        );
      }
    }
  }

  private onWorkerMessage(worker: Worker, data: WorkerOutbound) {
    this.busy.delete(worker);
    this.jobByWorker.delete(worker);
    const job = this.inFlightByKey.get(data.chunkKey);
    if (!job || job.jobId !== data.jobId) {
      this.cancelled++;
      this.pump();
      return;
    }
    this.inFlightByKey.delete(data.chunkKey);
    if (data.type === "prepared-chunk-error") {
      job.reject(new Error(data.message));
      this.pump();
      return;
    }
    const generationMs = data.prepared.generationTimingMs;
    this.lastWorkerGenerationMs = generationMs;
    this.maxWorkerGenerationMs = Math.max(
      this.maxWorkerGenerationMs,
      generationMs,
    );
    this.completed++;
    const result: ChunkJobResult = {
      chunkKey: data.chunkKey,
      jobId: data.jobId,
      runtimeGeneration: data.runtimeGeneration,
      prepared: data.prepared,
      fromWorker: true,
      generationMs,
    };
    this.onResult?.(result);
    job.resolve(result);
    this.pump();
  }

  private reheap() {
    this.queue.sort(
      (a, b) =>
        CHUNK_PRIORITY_ORDER[a.priority] - CHUNK_PRIORITY_ORDER[b.priority] ||
        a.jobId - b.jobId,
    );
  }
}

/** 単体テスト用: Fake Clock で commit 予算を検証するヘルパ。 */
export function commitWithinBudget<T>(
  items: T[],
  options: {
    now: () => number;
    budgetMs: number;
    maxItems: number;
    commitCostMs?: number;
    commit: (item: T) => void;
  },
) {
  const started = options.now();
  const cost = options.commitCostMs ?? 0;
  let committed = 0;
  let simulated = 0;
  while (
    items.length &&
    committed < options.maxItems &&
    options.now() + simulated - started < options.budgetMs
  ) {
    const item = items.shift()!;
    options.commit(item);
    committed++;
    simulated += cost;
  }
  return committed;
}

export { handlePrepareRequest, higherPriority, CHUNK_PRIORITY_ORDER };
