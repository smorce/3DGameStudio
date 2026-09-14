/**
 * WebGL2 非同期 GPU 時間計測（EXT_disjoint_timer_query_webgl2）。
 * 結果は数フレーム遅れて届く。未対応・disjoint 時はサンプルを捨てる。
 */

export interface GpuTimerSnapshot {
  supported: boolean;
  sampleCount: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  lastMs: number;
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

export class DisjointGpuTimer {
  private readonly gl: WebGL2RenderingContext | null;
  private readonly ext: TimerExt | null;
  private readonly pending: WebGLQuery[] = [];
  private readonly samples: number[] = [];
  private readonly capacity: number;
  private maxMs = 0;
  private lastMs = 0;
  private active: WebGLQuery | null = null;

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

  begin() {
    this.poll();
    if (!this.gl || !this.ext || this.active) return;
    const query = this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = query;
  }

  end() {
    if (!this.gl || !this.ext || !this.active) return;
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
      const query = this.pending[0];
      if (!query) break;
      const available = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE);
      if (!available) break;
      this.pending.shift();
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
      gl.deleteQuery(query);
      if (disjoint || !Number.isFinite(ns)) continue;
      const ms = ns / 1e6;
      this.lastMs = ms;
      this.maxMs = Math.max(this.maxMs, ms);
      this.samples.push(ms);
      if (this.samples.length > this.capacity) this.samples.shift();
    }
  }

  snapshot(): GpuTimerSnapshot {
    this.poll();
    const sorted = [...this.samples].sort((a, b) => a - b);
    return {
      supported: this.supported,
      sampleCount: this.samples.length,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      maxMs: this.maxMs,
      lastMs: this.lastMs,
    };
  }

  reset() {
    if (this.gl) {
      for (const query of this.pending) this.gl.deleteQuery(query);
      if (this.active) this.gl.deleteQuery(this.active);
    }
    this.pending.length = 0;
    this.active = null;
    this.samples.length = 0;
    this.maxMs = 0;
    this.lastMs = 0;
  }

  dispose() {
    this.reset();
  }
}
