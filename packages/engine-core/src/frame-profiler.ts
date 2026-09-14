/** 直近フレームの時間分布を ring buffer で集計する。 */
export interface FrameTimingSnapshot {
  currentMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  over16_7: number;
  over33_3: number;
  over50: number;
  sampleCount: number;
}

export interface LongAnimationFrameSample {
  durationMs: number;
  startTime: number;
}

const DEFAULT_CAPACITY = 900;

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

export class FrameProfiler {
  private readonly samples: number[];
  private readonly capacity: number;
  private write = 0;
  private filled = 0;
  private maxMs = 0;
  private over16_7 = 0;
  private over33_3 = 0;
  private over50 = 0;
  private longFrames: LongAnimationFrameSample[] = [];
  private observer?: PerformanceObserver;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = Math.max(60, capacity);
    this.samples = new Array(this.capacity).fill(0);
  }

  /** 対応ブラウザのみ Long Animation Frame を収集する。 */
  startLongFrameObserver() {
    if (typeof PerformanceObserver === "undefined") return;
    const supported = PerformanceObserver.supportedEntryTypes ?? [];
    if (!supported.includes("long-animation-frame")) return;
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.longFrames.push({
            durationMs: entry.duration,
            startTime: entry.startTime,
          });
          if (this.longFrames.length > 64) this.longFrames.shift();
        }
      });
      this.observer.observe({
        type: "long-animation-frame",
        buffered: true,
      } as PerformanceObserverInit);
    } catch {
      this.observer = undefined;
    }
  }

  record(frameTimeMs: number) {
    if (!Number.isFinite(frameTimeMs) || frameTimeMs < 0) return;
    if (this.filled === this.capacity) {
      const old = this.samples[this.write];
      if (old > 16.7) this.over16_7--;
      if (old > 33.3) this.over33_3--;
      if (old > 50) this.over50--;
    } else this.filled++;
    this.samples[this.write] = frameTimeMs;
    this.write = (this.write + 1) % this.capacity;
    this.maxMs = Math.max(this.maxMs, frameTimeMs);
    if (frameTimeMs > 16.7) this.over16_7++;
    if (frameTimeMs > 33.3) this.over33_3++;
    if (frameTimeMs > 50) this.over50++;
  }

  snapshot(currentMs = 0): FrameTimingSnapshot {
    const values = this.samples.slice(0, this.filled).sort((a, b) => a - b);
    return {
      currentMs,
      p50Ms: percentile(values, 50),
      p95Ms: percentile(values, 95),
      p99Ms: percentile(values, 99),
      maxMs: this.maxMs,
      over16_7: this.over16_7,
      over33_3: this.over33_3,
      over50: this.over50,
      sampleCount: this.filled,
    };
  }

  get recentLongFrames(): readonly LongAnimationFrameSample[] {
    return this.longFrames;
  }

  reset() {
    this.write = 0;
    this.filled = 0;
    this.maxMs = 0;
    this.over16_7 = 0;
    this.over33_3 = 0;
    this.over50 = 0;
    this.samples.fill(0);
    this.longFrames = [];
  }

  dispose() {
    this.observer?.disconnect();
    this.observer = undefined;
    this.reset();
  }
}
