/**
 * WebGL2 非同期 GPU 時間計測（EXT_disjoint_timer_query_webgl2）。
 * 結果は数フレーム遅れて届く。未対応・disjoint 時はサンプルを捨てる。
 * 各 Query に frame / timeMs を付け、Render Stall との対応付けを可能にする。
 */

export interface GpuTimerSample {
  gpuMs: number;
  frame: number;
  timeMs: number;
}

export interface GpuTimerSnapshot {
  supported: boolean;
  sampleCount: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  lastMs: number;
  /** 時刻付きサンプル（新しい順・最大 capacity）。 */
  recentSamples: GpuTimerSample[];
  /** 最大 GPU 時間のサンプル（対応フレーム特定用）。 */
  maxSample?: GpuTimerSample;
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

type TimerExt = {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
};

type PendingQuery = {
  query: WebGLQuery;
  frame: number;
  timeMs: number;
};

export class DisjointGpuTimer {
  private readonly gl: WebGL2RenderingContext | null;
  private readonly ext: TimerExt | null;
  private readonly pending: PendingQuery[] = [];
  private readonly samples: GpuTimerSample[] = [];
  private readonly capacity: number;
  private maxSample?: GpuTimerSample;
  private lastMs = 0;
  private active: PendingQuery | null = null;
  private enabled = true;

  constructor(gl: WebGL2RenderingContext | null, capacity = 240) {
    this.gl = gl;
    this.capacity = Math.max(60, capacity);
    const ext = gl?.getExtension("EXT_disjoint_timer_query_webgl2") as
      | TimerExt
      | null
      | undefined;
    this.ext = ext ?? null;
  }

  get supported() {
    return Boolean(this.gl && this.ext);
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.reset();
  }

  begin(meta: { frame: number; timeMs: number } = { frame: 0, timeMs: 0 }) {
    this.poll();
    if (!this.enabled || !this.gl || !this.ext || this.active) return;
    const query = this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = { query, frame: meta.frame, timeMs: meta.timeMs };
  }

  end() {
    if (!this.enabled || !this.gl || !this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** 利用可能なクエリ結果を取り込み、古いものを破棄する。 */
  poll() {
    if (!this.gl || !this.ext) return;
    const gl = this.gl;
    const ext = this.ext;
    while (this.pending.length) {
      const pending = this.pending[0];
      if (!pending) break;
      const available = gl.getQueryParameter(
        pending.query,
        gl.QUERY_RESULT_AVAILABLE,
      );
      if (!available) break;
      this.pending.shift();
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(pending.query, gl.QUERY_RESULT) as number;
      gl.deleteQuery(pending.query);
      if (disjoint || !Number.isFinite(ns)) continue;
      const ms = ns / 1e6;
      const sample: GpuTimerSample = {
        gpuMs: ms,
        frame: pending.frame,
        timeMs: pending.timeMs,
      };
      this.lastMs = ms;
      if (!this.maxSample || ms > this.maxSample.gpuMs) this.maxSample = sample;
      this.samples.push(sample);
      if (this.samples.length > this.capacity) this.samples.shift();
    }
  }

  snapshot(): GpuTimerSnapshot {
    this.poll();
    const values = this.samples.map((sample) => sample.gpuMs);
    const sorted = [...values].sort((a, b) => a - b);
    return {
      supported: this.supported,
      sampleCount: this.samples.length,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      maxMs: this.maxSample?.gpuMs ?? 0,
      lastMs: this.lastMs,
      recentSamples: [...this.samples].reverse(),
      maxSample: this.maxSample,
    };
  }

  reset() {
    if (this.gl) {
      for (const pending of this.pending) this.gl.deleteQuery(pending.query);
      if (this.active) this.gl.deleteQuery(this.active.query);
    }
    this.pending.length = 0;
    this.active = null;
    this.samples.length = 0;
    this.maxSample = undefined;
    this.lastMs = 0;
  }

  dispose() {
    this.reset();
  }
}
