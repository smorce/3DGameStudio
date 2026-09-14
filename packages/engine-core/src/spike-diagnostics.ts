/** Spike / Origin Rebase 診断用の計測型とリングバッファ。 */

export interface PhysicsRebaseBreakdown {
  moveRigidBodiesMs: number;
  moveStandaloneCollidersMs: number;
  propagateCollidersMs: number;
  ccdToggleMs: number;
  rigidBodyCount: number;
  colliderCount: number;
  standaloneColliderCount: number;
}

export interface RendererRebaseBreakdown {
  chunkCount: number;
  lodBatchCount: number;
}

export interface RebaseTimingBreakdown {
  rebaseTotalMs: number;
  physicsRebaseMs: number;
  rendererRebaseMs: number;
  runtimeCommitRebaseMs: number;
  telemetrySyncMs: number;
  physics: PhysicsRebaseBreakdown;
  renderer: RendererRebaseBreakdown;
  rebaseCountAfter: number;
  positionZ: number;
  timeMs: number;
}

/** 毎フレームの軽量トレース（スパイク前後切り出し用）。 */
export interface FrameTraceSample {
  timeMs: number;
  rafIntervalMs: number;
  cpuWorkMs: number;
  uiUpdateMs: number;
  physicsStepMs: number;
  renderMs: number;
  renderCommitMs: number;
  physicsCommitMs: number;
  streamingRequestMs: number;
  streamingCommitMs: number;
  chunksCreated: number;
  syncGenDelta: number;
  rebaseCount: number;
  rebaseThisFrame: boolean;
  rebaseTotalMs: number;
  physicsRebaseMs: number;
  rendererRebaseMs: number;
  runtimeCommitRebaseMs: number;
  telemetrySyncMs: number;
  moveRigidBodiesMs: number;
  moveStandaloneCollidersMs: number;
  propagateCollidersMs: number;
  ccdToggleMs: number;
  rigidBodyCount: number;
  colliderCount: number;
  standaloneColliderCount: number;
  chunkCount: number;
  lodBatchCount: number;
  workerQueued: number;
  workerInFlight: number;
  drawCalls: number;
  triangles: number;
  positionZ: number;
}

export interface SpikeWindow {
  /** スパイク閾値（超過した最大帯）。 */
  thresholdMs: 20 | 33.3 | 50;
  spikeRafIntervalMs: number;
  centerTimeMs: number;
  rebaseCountAtSpike: number;
  earlySpike: boolean;
  frames: FrameTraceSample[];
}

/** ブラウザ / GPU / Canvas 側の環境スナップショット（JS 外要因切り分け用）。 */
export interface SpikeEnvironmentSnapshot {
  visibilityState: string;
  hasFocus: boolean;
  devicePixelRatio: number;
  canvasCssWidth: number;
  canvasCssHeight: number;
  drawingBufferWidth: number;
  drawingBufferHeight: number;
  webglVendor: string;
  webglRenderer: string;
  longAnimationFrameCount: number;
  recentLongAnimationFrames: { durationMs: number; startTime: number }[];
  shadowMapEnabled: boolean;
  effectivePixelRatio: number;
  antialias: boolean;
  shadowMapSize: number;
  gpuTimerSupported: boolean;
  gpuFrameSampleCount: number;
  gpuFrameP50Ms: number;
  gpuFrameP95Ms: number;
  gpuFrameMaxMs: number;
  gpuFrameLastMs: number;
}

export interface SpikeDiagnosticsDump {
  exportedAtMs: number;
  originRebaseEnabled: boolean;
  spikeCount20ms: number;
  spikeCount33ms: number;
  spikeCount50ms: number;
  earlySpikeCount20ms: number;
  earlySpikeCount33ms: number;
  earlySpikeCount50ms: number;
  frameP50Ms: number;
  frameP95Ms: number;
  frameP99Ms: number;
  frameMaxMs: number;
  lastRebase?: RebaseTimingBreakdown;
  recentRebases: RebaseTimingBreakdown[];
  recentFrames: FrameTraceSample[];
  spikeWindows: SpikeWindow[];
  /** export 時点の表示・GPU 環境。Engine 側で付与する。 */
  environment?: SpikeEnvironmentSnapshot;
}

const FRAME_HISTORY = 96;
const SPIKE_BEFORE = 3;
const SPIKE_AFTER = 3;
const MAX_SPIKE_WINDOWS = 24;
const MAX_REBASE_HISTORY = 16;

export class SpikeDiagnostics {
  private readonly frames: FrameTraceSample[] = [];
  private readonly spikeWindows: SpikeWindow[] = [];
  private readonly rebaseHistory: RebaseTimingBreakdown[] = [];
  private pendingAfter = 0;
  private lastSealedSpikeTimeMs = -1;
  lastRebase?: RebaseTimingBreakdown;

  recordFrame(sample: FrameTraceSample) {
    this.frames.push(sample);
    if (this.frames.length > FRAME_HISTORY) this.frames.shift();
    if (this.pendingAfter > 0) {
      this.pendingAfter--;
      if (this.pendingAfter === 0) this.sealSpikeWindow();
    }
  }

  /** RAF が閾値を超えたときに呼ぶ。直後フレームを待ってウィンドウを確定する。 */
  noteSpike(rafIntervalMs: number) {
    if (this.frames.length === 0) return;
    if (this.pendingAfter > 0) {
      // 連続スパイクは同じウィンドウ延長で拾う。
      this.pendingAfter = SPIKE_AFTER;
      return;
    }
    this.pendingAfter = SPIKE_AFTER;
    void rafIntervalMs;
  }

  recordRebase(timing: RebaseTimingBreakdown) {
    this.lastRebase = timing;
    this.rebaseHistory.push(timing);
    if (this.rebaseHistory.length > MAX_REBASE_HISTORY) this.rebaseHistory.shift();
  }

  private sealSpikeWindow() {
    if (this.frames.length === 0) return;
    // スパイク中心 = 直後待ち開始時点のフレーム（現在末尾から SPIKE_AFTER 前）。
    const centerOffsetFromEnd = SPIKE_AFTER;
    const centerIndex = Math.max(
      0,
      this.frames.length - 1 - centerOffsetFromEnd,
    );
    const center = this.frames[centerIndex];
    if (!center) return;
    if (center.timeMs === this.lastSealedSpikeTimeMs) return;
    // 中心付近で最も大きい RAF をスパイクとして採用（連続スパイク対策）。
    const from = Math.max(0, centerIndex - SPIKE_BEFORE);
    const to = Math.min(this.frames.length, centerIndex + SPIKE_AFTER + 1);
    const windowFrames = this.frames.slice(from, to);
    let peak = windowFrames[0];
    for (const frame of windowFrames) {
      if (frame.rafIntervalMs > (peak?.rafIntervalMs ?? 0)) peak = frame;
    }
    if (!peak || peak.rafIntervalMs <= 20) return;
    this.lastSealedSpikeTimeMs = peak.timeMs;
    const thresholdMs: 20 | 33.3 | 50 =
      peak.rafIntervalMs > 50 ? 50 : peak.rafIntervalMs > 33.3 ? 33.3 : 20;
    this.spikeWindows.push({
      thresholdMs,
      spikeRafIntervalMs: peak.rafIntervalMs,
      centerTimeMs: peak.timeMs,
      rebaseCountAtSpike: peak.rebaseCount,
      earlySpike: peak.rebaseCount === 0,
      frames: windowFrames,
    });
    if (this.spikeWindows.length > MAX_SPIKE_WINDOWS) this.spikeWindows.shift();
  }

  /** 未確定の直後待ちを強制確定（PLAY 終了・export 時）。 */
  flush() {
    if (this.pendingAfter > 0) {
      this.pendingAfter = 0;
      this.sealSpikeWindow();
    }
  }

  reset() {
    this.frames.length = 0;
    this.spikeWindows.length = 0;
    this.rebaseHistory.length = 0;
    this.pendingAfter = 0;
    this.lastSealedSpikeTimeMs = -1;
    this.lastRebase = undefined;
  }

  dump(meta: {
    originRebaseEnabled: boolean;
    spikeCount20ms: number;
    spikeCount33ms: number;
    spikeCount50ms: number;
    earlySpikeCount20ms: number;
    earlySpikeCount33ms: number;
    earlySpikeCount50ms: number;
    frameP50Ms: number;
    frameP95Ms: number;
    frameP99Ms: number;
    frameMaxMs: number;
  }): SpikeDiagnosticsDump {
    this.flush();
    return {
      exportedAtMs: performance.now(),
      ...meta,
      lastRebase: this.lastRebase,
      recentRebases: [...this.rebaseHistory],
      recentFrames: [...this.frames],
      spikeWindows: [...this.spikeWindows],
    };
  }

  get recentSpikeWindows(): readonly SpikeWindow[] {
    return this.spikeWindows;
  }

  get recentFrames(): readonly FrameTraceSample[] {
    return this.frames;
  }
}
