/**
 * 同一 PLAY 中に Damped ↔ Instant Camera follow を切り替え、
 * 軽量指標だけを記録する（大きな診断システムの代替）。
 */

export type CameraFollowMode = "damped" | "instant";

export interface CameraFollowToggleSample {
  timeMs: number;
  rafMs: number;
  mode: CameraFollowMode;
  vehicleToTargetDistance: number;
  vehicleScreenDelta: number;
  physicsStepsThisFrame: number;
  interpolationAlpha: number;
}

export interface CameraFollowToggleDump {
  exportedAtMs: number;
  autoToggleMs: number;
  toggleCount: number;
  note: string;
  samples: CameraFollowToggleSample[];
  byMode: {
    damped: {
      sampleCount: number;
      vehicleToTargetDistanceP95: number;
      vehicleScreenDeltaP95: number;
    };
    instant: {
      sampleCount: number;
      vehicleToTargetDistanceP95: number;
      vehicleScreenDeltaP95: number;
    };
  };
}

const MAX_SAMPLES = 2400;

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

function modeStats(samples: CameraFollowToggleSample[], mode: CameraFollowMode) {
  const list = samples.filter((s) => s.mode === mode);
  return {
    sampleCount: list.length,
    vehicleToTargetDistanceP95: percentile(
      list.map((s) => s.vehicleToTargetDistance),
      95,
    ),
    vehicleScreenDeltaP95: percentile(
      list.map((s) => s.vehicleScreenDelta),
      95,
    ),
  };
}

export class CameraFollowToggleLog {
  /** PLAY 中に有効化すると自動切替＋記録する。 */
  enabled = false;
  autoToggleMs = 3000;
  private samples: CameraFollowToggleSample[] = [];
  private lastToggleAtMs = 0;
  private toggleCount = 0;
  private lastScreen?: [number, number];
  private suppressAutoUntilManual = false;

  reset() {
    this.samples = [];
    this.lastToggleAtMs = 0;
    this.toggleCount = 0;
    this.lastScreen = undefined;
    this.suppressAutoUntilManual = false;
  }

  get mode(): CameraFollowMode {
    return this._instant ? "instant" : "damped";
  }

  private _instant = true;

  /** renderer の Instant follow 状態と同期する（!useDampedCameraFollow）。 */
  syncFromRenderer(instant: boolean) {
    this._instant = instant;
  }

  setMode(instant: boolean, nowMs: number) {
    this._instant = instant;
    this.lastToggleAtMs = nowMs;
    this.toggleCount++;
  }

  /** 手動トグル（Vキー）。自動切替タイマもリセット。 */
  toggleManual(nowMs: number) {
    this.setMode(!this._instant, nowMs);
    this.suppressAutoUntilManual = false;
    return this.mode;
  }

  maybeAutoToggle(nowMs: number): boolean {
    if (!this.enabled || this.suppressAutoUntilManual) return false;
    if (!this.lastToggleAtMs) {
      this.lastToggleAtMs = nowMs;
      return false;
    }
    if (nowMs - this.lastToggleAtMs < this.autoToggleMs) return false;
    this.setMode(!this._instant, nowMs);
    return true;
  }

  record(input: {
    timeMs: number;
    rafMs: number;
    physicsStepsThisFrame: number;
    interpolationAlpha: number;
    vehicleRenderPosition: [number, number, number];
    cameraTarget: [number, number, number];
    vehicleScreenXY: [number, number];
  }) {
    if (!this.enabled) return;
    const vehicleToTargetDistance = Math.hypot(
      input.vehicleRenderPosition[0] - input.cameraTarget[0],
      input.vehicleRenderPosition[1] - input.cameraTarget[1],
      input.vehicleRenderPosition[2] - input.cameraTarget[2],
    );
    const vehicleScreenDelta = this.lastScreen
      ? Math.hypot(
          input.vehicleScreenXY[0] - this.lastScreen[0],
          input.vehicleScreenXY[1] - this.lastScreen[1],
        )
      : 0;
    this.lastScreen = [
      input.vehicleScreenXY[0],
      input.vehicleScreenXY[1],
    ];
    this.samples.push({
      timeMs: input.timeMs,
      rafMs: input.rafMs,
      mode: this.mode,
      vehicleToTargetDistance,
      vehicleScreenDelta,
      physicsStepsThisFrame: input.physicsStepsThisFrame,
      interpolationAlpha: input.interpolationAlpha,
    });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  dump(): CameraFollowToggleDump {
    return {
      exportedAtMs: performance.now(),
      autoToggleMs: this.autoToggleMs,
      toggleCount: this.toggleCount,
      note: "同一PLAY中の Damped↔Instant Camera follow（回帰比較）。Production既定はInstant。Physics未変更。Vで手動切替、約3秒で自動切替。",
      samples: [...this.samples],
      byMode: {
        damped: modeStats(this.samples, "damped"),
        instant: modeStats(this.samples, "instant"),
      },
    };
  }
}
