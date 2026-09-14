/**
 * 旋回 Motion Smoothness 診断。
 * Frame Performance（RAF/GPU）ではなく、Physics Step / 補間 / Camera の角速度連続性を見る。
 * Production Physics・機体パラメータは変更しない（観測と描画経路の診断切替のみ）。
 */

export type MotionDiagMode = "a" | "b" | "c";

export type Quat4 = [number, number, number, number];
export type Vec3 = [number, number, number];

/** Fixed Physics Step 1回ごとの記録（必須）。 */
export interface TurnPhysicsStepSample {
  timeMs: number;
  /** 同一 RAF 内での step 連番（0始まり）。 */
  stepIndexInFrame: number;
  frameTimeMs: number;
  steering: number;
  physicsQuaternion: Quat4;
  physicsAngularVelocity: Vec3;
  /** 直前 Physics Step との姿勢差 [deg]。 */
  physicsStepAngularDeltaDeg: number;
}

/** 1 RAF ごとの記録。 */
export interface TurnRafSample {
  timeMs: number;
  rafMs: number;
  physicsStepsThisFrame: number;
  interpolationAlpha: number;
  steering: number;
  physicsQuaternion: Quat4;
  physicsPreviousQuaternion: Quat4;
  renderQuaternion: Quat4;
  physicsAngularVelocity: Vec3;
  cameraPosition: Vec3;
  cameraTarget: Vec3;
  cameraQuaternion: Quat4;
  physicsAngularDeltaDeg: number;
  renderAngularDeltaDeg: number;
  cameraAngularDeltaDeg: number;
  renderAngularVelocityDegPerSec: number;
  renderAngularAcceleration: number;
  renderAngularJerk: number;
}

export interface TurnMotionVerdict {
  suspicionOrder: string[];
  physicsStairStepLikely: boolean;
  renderStairStepLikely: boolean;
  cameraOnlyJumpLikely: boolean;
  alphaOscillationLikely: boolean;
  physicsStepsAlternatingLikely: boolean;
  notes: string[];
  /** 分離判定（最終報告用）。録画は環境メタで別途確認。 */
  separation: {
    physics: "likely" | "unlikely" | "inconclusive";
    interpolation: "likely" | "unlikely" | "inconclusive";
    camera: "likely" | "unlikely" | "inconclusive";
    recording: "not_assessed_here";
  };
}

export interface TurnMotionDump {
  exportedAtMs: number;
  mode: MotionDiagMode;
  modeLabel: string;
  queryHint: string;
  turnStartTimeMs: number | null;
  window: { preTurnMs: number; turnMs: number };
  verdict: TurnMotionVerdict;
  /** 旋回開始前1秒＋旋回中5秒の RAF 要約行。 */
  turnWindowFrames: Array<{
    time: number;
    rafMs: number;
    physicsSteps: number;
    alpha: number;
    steering: number;
    physicsAngularDeltaDeg: number;
    renderAngularDeltaDeg: number;
    cameraAngularDeltaDeg: number;
  }>;
  /** 同窓の Physics Step 全件。 */
  turnWindowPhysicsSteps: TurnPhysicsStepSample[];
  /** 同窓の RAF 全件（詳細）。 */
  turnWindowRaf: TurnRafSample[];
  stats: {
    rafCount: number;
    physicsStepCount: number;
    steeringPeak: number;
    physicsDeltaP50: number;
    physicsDeltaP95: number;
    renderDeltaP50: number;
    renderDeltaP95: number;
    cameraDeltaP50: number;
    cameraDeltaP95: number;
    alphaLowHighTransitions: number;
    physicsStepsHistogram: Record<string, number>;
  };
}

const PRE_TURN_MS = 1000;
const TURN_MS = 5000;
const STEERING_ENTER = 0.25;
const STEERING_HOLD_FRAMES = 4;
const MAX_RAF = 900;
const MAX_STEPS = 2400;

export function motionDiagModeLabel(mode: MotionDiagMode): string {
  if (mode === "b") return "B: Rotation interpolation OFF";
  if (mode === "c") return "C: Camera follow OFF";
  return "A: Current (physics interpolation + camera follow)";
}

export function motionDiagQueryHint(mode: MotionDiagMode): string {
  if (mode === "b") return "?motionDiag=b";
  if (mode === "c") return "?motionDiag=c";
  return "?motionDiag=a（または無し）";
}

export function parseMotionDiagMode(
  raw: string | null | undefined,
): MotionDiagMode {
  const v = (raw ?? "a").toLowerCase();
  if (v === "b" || v === "rotnointerp" || v === "rotation-off") return "b";
  if (v === "c" || v === "camerafollowoff" || v === "camera-off") return "c";
  return "a";
}

function copyQuat(q: Quat4): Quat4 {
  return [q[0], q[1], q[2], q[3]];
}

function copyVec3(v: Vec3): Vec3 {
  return [v[0], v[1], v[2]];
}

/** 2つの単位クォータニオン間の最短角 [deg]。 */
export function quatAngularDeltaDeg(a: Quat4, b: Quat4): number {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  dot = Math.min(1, Math.max(-1, Math.abs(dot)));
  return (2 * Math.acos(dot) * 180) / Math.PI;
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function variance(values: number[]) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return mean(values.map((v) => (v - m) ** 2));
}

function isStairLike(deltas: number[]) {
  if (deltas.length < 12) return false;
  const sorted = [...deltas].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  // 多くがほぼ0で、まれに大きいジャンプ → 階段状。
  const nearZero = deltas.filter((d) => d < 0.05).length / deltas.length;
  return nearZero > 0.35 && p95 > Math.max(0.4, p50 * 6 + 0.2);
}

function countAlphaOscillations(alphas: number[]) {
  let transitions = 0;
  let zone: "low" | "mid" | "high" | null = null;
  for (const a of alphas) {
    const next: "low" | "mid" | "high" =
      a < 0.2 ? "low" : a > 0.8 ? "high" : "mid";
    if (zone && zone !== "mid" && next !== "mid" && next !== zone) transitions++;
    if (next !== "mid") zone = next;
  }
  return transitions;
}

function alternatingStepsLikely(steps: number[]) {
  if (steps.length < 16) return false;
  let alt02 = 0;
  let alt01 = 0;
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1] ?? 0;
    const b = steps[i] ?? 0;
    if ((a === 0 && b === 2) || (a === 2 && b === 0)) alt02++;
    if ((a === 0 && b === 1) || (a === 1 && b === 0)) alt01++;
  }
  const pairs = steps.length - 1;
  return alt02 / pairs > 0.45 || alt01 / pairs > 0.55;
}

function analyze(
  raf: TurnRafSample[],
  steps: TurnPhysicsStepSample[],
): TurnMotionVerdict {
  const steeringRaf = raf.filter((f) => Math.abs(f.steering) >= STEERING_ENTER);
  const physicsDeltas = steeringRaf.map((f) => f.physicsAngularDeltaDeg);
  const renderDeltas = steeringRaf.map((f) => f.renderAngularDeltaDeg);
  const cameraDeltas = steeringRaf.map((f) => f.cameraAngularDeltaDeg);
  const stepDeltas = steps
    .filter((s) => Math.abs(s.steering) >= STEERING_ENTER)
    .map((s) => s.physicsStepAngularDeltaDeg);

  const physicsStair =
    isStairLike(physicsDeltas) || isStairLike(stepDeltas);
  const renderStair = isStairLike(renderDeltas);
  const physicsSmooth =
    !physicsStair &&
    percentile([...physicsDeltas].sort((a, b) => a - b), 95) < 3;
  const renderSmooth =
    !renderStair &&
    percentile([...renderDeltas].sort((a, b) => a - b), 95) < 3;
  const cameraJumpy =
    percentile([...cameraDeltas].sort((a, b) => a - b), 95) >
    Math.max(
      1.5,
      percentile([...renderDeltas].sort((a, b) => a - b), 95) * 2,
    );
  const cameraOnly = physicsSmooth && renderSmooth && cameraJumpy;
  const renderOnlyStair = physicsSmooth && renderStair;
  const alphaOsc =
    countAlphaOscillations(steeringRaf.map((f) => f.interpolationAlpha)) >= 8;
  const stepsAlt = alternatingStepsLikely(
    steeringRaf.map((f) => f.physicsStepsThisFrame),
  );

  const notes: string[] = [];
  if (physicsStair)
    notes.push(
      "Physics Quaternion / Step 角速度差が階段状。① Physics 旋回角速度を最優先で疑う。",
    );
  if (renderOnlyStair)
    notes.push(
      "Physicsは比較的滑らかだが Render Quaternion だけ階段状。② Fixed Step/補間を疑う。",
    );
  if (cameraOnly)
    notes.push(
      "Vehicleは滑らかだが Camera 角差だけ大きい。③ Camera follow を疑う。",
    );
  if (alphaOsc)
    notes.push(
      "interpolationAlpha が 0付近と1付近を不規則に往復している可能性。",
    );
  if (stepsAlt)
    notes.push(
      "physicsStepsThisFrame が 0/1 または 0/2 の周期的交互になっている可能性。",
    );
  if (!notes.length)
    notes.push(
      "自動判定では明確な階段・カメラ単独ジャンプは弱い。A/B（b=rot補間OFF / c=camera follow OFF）と目視を突き合わせること。",
    );

  const separation = {
    physics: physicsStair
      ? ("likely" as const)
      : physicsSmooth
        ? ("unlikely" as const)
        : ("inconclusive" as const),
    interpolation:
      renderOnlyStair || alphaOsc || stepsAlt
        ? ("likely" as const)
        : renderSmooth && !alphaOsc
          ? ("unlikely" as const)
          : ("inconclusive" as const),
    camera: cameraOnly
      ? ("likely" as const)
      : !cameraJumpy
        ? ("unlikely" as const)
        : ("inconclusive" as const),
    recording: "not_assessed_here" as const,
  };

  return {
    suspicionOrder: [
      "① Physicsの旋回角速度そのもの",
      "② Fixed Step / 補間",
      "③ Camera follow",
    ],
    physicsStairStepLikely: physicsStair,
    renderStairStepLikely: renderOnlyStair || (renderStair && !physicsStair),
    cameraOnlyJumpLikely: cameraOnly,
    alphaOscillationLikely: alphaOsc,
    physicsStepsAlternatingLikely: stepsAlt,
    notes,
    separation,
  };
}

export class TurnMotionDiagnostics {
  mode: MotionDiagMode = "a";
  private rafSamples: TurnRafSample[] = [];
  private stepSamples: TurnPhysicsStepSample[] = [];
  private lastPhysicsQuat?: Quat4;
  private lastRenderQuat?: Quat4;
  private lastCameraQuat?: Quat4;
  private lastRenderVel = 0;
  private lastRenderAcc = 0;
  private steeringHold = 0;
  private turnStartTimeMs: number | null = null;

  reset() {
    this.rafSamples = [];
    this.stepSamples = [];
    this.lastPhysicsQuat = undefined;
    this.lastRenderQuat = undefined;
    this.lastCameraQuat = undefined;
    this.lastRenderVel = 0;
    this.lastRenderAcc = 0;
    this.steeringHold = 0;
    this.turnStartTimeMs = null;
  }

  recordPhysicsStep(input: {
    timeMs: number;
    stepIndexInFrame: number;
    frameTimeMs: number;
    steering: number;
    physicsQuaternion: Quat4;
    physicsAngularVelocity: Vec3;
  }) {
    const delta = this.lastPhysicsQuat
      ? quatAngularDeltaDeg(this.lastPhysicsQuat, input.physicsQuaternion)
      : 0;
    // Physics Step でも lastPhysicsQuat を進める（RAF側の「前フレーム」とは別系統）。
    // RAF の physicsPrevious は RAF 境界で別途保持する。
    const sample: TurnPhysicsStepSample = {
      timeMs: input.timeMs,
      stepIndexInFrame: input.stepIndexInFrame,
      frameTimeMs: input.frameTimeMs,
      steering: input.steering,
      physicsQuaternion: copyQuat(input.physicsQuaternion),
      physicsAngularVelocity: copyVec3(input.physicsAngularVelocity),
      physicsStepAngularDeltaDeg: delta,
    };
    this.stepSamples.push(sample);
    if (this.stepSamples.length > MAX_STEPS) this.stepSamples.shift();
    this.lastPhysicsQuat = copyQuat(input.physicsQuaternion);
  }

  /**
   * RAF 境界用に Physics previous をスナップショットする。
   * （Step 連打のあと、描画に使う previous/current を明示的に渡す）
   */
  recordRaf(input: {
    timeMs: number;
    rafMs: number;
    physicsStepsThisFrame: number;
    interpolationAlpha: number;
    steering: number;
    physicsQuaternion: Quat4;
    physicsPreviousQuaternion: Quat4;
    renderQuaternion: Quat4;
    physicsAngularVelocity: Vec3;
    cameraPosition: Vec3;
    cameraTarget: Vec3;
    cameraQuaternion: Quat4;
  }) {
    if (Math.abs(input.steering) >= STEERING_ENTER) this.steeringHold++;
    else this.steeringHold = 0;
    if (
      this.turnStartTimeMs === null &&
      this.steeringHold >= STEERING_HOLD_FRAMES
    ) {
      this.turnStartTimeMs = input.timeMs;
    }

    const physicsDelta = quatAngularDeltaDeg(
      input.physicsPreviousQuaternion,
      input.physicsQuaternion,
    );
    const renderDelta = this.lastRenderQuat
      ? quatAngularDeltaDeg(this.lastRenderQuat, input.renderQuaternion)
      : 0;
    const cameraDelta = this.lastCameraQuat
      ? quatAngularDeltaDeg(this.lastCameraQuat, input.cameraQuaternion)
      : 0;
    const dtSec = Math.max(1e-4, input.rafMs / 1000);
    const renderVel = renderDelta / dtSec;
    const renderAcc = (renderVel - this.lastRenderVel) / dtSec;
    const renderJerk = (renderAcc - this.lastRenderAcc) / dtSec;

    const sample: TurnRafSample = {
      timeMs: input.timeMs,
      rafMs: input.rafMs,
      physicsStepsThisFrame: input.physicsStepsThisFrame,
      interpolationAlpha: input.interpolationAlpha,
      steering: input.steering,
      physicsQuaternion: copyQuat(input.physicsQuaternion),
      physicsPreviousQuaternion: copyQuat(input.physicsPreviousQuaternion),
      renderQuaternion: copyQuat(input.renderQuaternion),
      physicsAngularVelocity: copyVec3(input.physicsAngularVelocity),
      cameraPosition: copyVec3(input.cameraPosition),
      cameraTarget: copyVec3(input.cameraTarget),
      cameraQuaternion: copyQuat(input.cameraQuaternion),
      physicsAngularDeltaDeg: physicsDelta,
      renderAngularDeltaDeg: renderDelta,
      cameraAngularDeltaDeg: cameraDelta,
      renderAngularVelocityDegPerSec: renderVel,
      renderAngularAcceleration: renderAcc,
      renderAngularJerk: renderJerk,
    };
    this.rafSamples.push(sample);
    if (this.rafSamples.length > MAX_RAF) this.rafSamples.shift();

    this.lastRenderQuat = copyQuat(input.renderQuaternion);
    this.lastCameraQuat = copyQuat(input.cameraQuaternion);
    this.lastRenderVel = renderVel;
    this.lastRenderAcc = renderAcc;
  }

  private sliceWindow() {
    const turnStart = this.turnStartTimeMs;
    if (turnStart === null) {
      return {
        turnStartTimeMs: null as number | null,
        raf: [] as TurnRafSample[],
        steps: [] as TurnPhysicsStepSample[],
      };
    }
    const from = turnStart - PRE_TURN_MS;
    const to = turnStart + TURN_MS;
    return {
      turnStartTimeMs: turnStart,
      raf: this.rafSamples.filter((s) => s.timeMs >= from && s.timeMs <= to),
      steps: this.stepSamples.filter((s) => s.timeMs >= from && s.timeMs <= to),
    };
  }

  dump(): TurnMotionDump {
    const sliced = this.sliceWindow();
    const raf = sliced.raf;
    const steps = sliced.steps;
    const physicsDeltas = raf.map((f) => f.physicsAngularDeltaDeg).sort((a, b) => a - b);
    const renderDeltas = raf.map((f) => f.renderAngularDeltaDeg).sort((a, b) => a - b);
    const cameraDeltas = raf.map((f) => f.cameraAngularDeltaDeg).sort((a, b) => a - b);
    const histogram: Record<string, number> = {};
    for (const f of raf) {
      const key = String(f.physicsStepsThisFrame);
      histogram[key] = (histogram[key] ?? 0) + 1;
    }
    const steeringPeak = raf.reduce(
      (m, f) => Math.max(m, Math.abs(f.steering)),
      0,
    );
    return {
      exportedAtMs: performance.now(),
      mode: this.mode,
      modeLabel: motionDiagModeLabel(this.mode),
      queryHint: motionDiagQueryHint(this.mode),
      turnStartTimeMs: sliced.turnStartTimeMs,
      window: { preTurnMs: PRE_TURN_MS, turnMs: TURN_MS },
      verdict: analyze(raf, steps),
      turnWindowFrames: raf.map((f) => ({
        time: f.timeMs,
        rafMs: f.rafMs,
        physicsSteps: f.physicsStepsThisFrame,
        alpha: f.interpolationAlpha,
        steering: f.steering,
        physicsAngularDeltaDeg: f.physicsAngularDeltaDeg,
        renderAngularDeltaDeg: f.renderAngularDeltaDeg,
        cameraAngularDeltaDeg: f.cameraAngularDeltaDeg,
      })),
      turnWindowPhysicsSteps: steps,
      turnWindowRaf: raf,
      stats: {
        rafCount: raf.length,
        physicsStepCount: steps.length,
        steeringPeak,
        physicsDeltaP50: percentile(physicsDeltas, 50),
        physicsDeltaP95: percentile(physicsDeltas, 95),
        renderDeltaP50: percentile(renderDeltas, 50),
        renderDeltaP95: percentile(renderDeltas, 95),
        cameraDeltaP50: percentile(cameraDeltas, 50),
        cameraDeltaP95: percentile(cameraDeltas, 95),
        alphaLowHighTransitions: countAlphaOscillations(
          raf.map((f) => f.interpolationAlpha),
        ),
        physicsStepsHistogram: histogram,
      },
    };
  }
}
