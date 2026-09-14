/**
 * 旋回 Motion Smoothness 診断。
 * Frame Performance（RAF/GPU）ではなく、Physics Step / 補間 / Camera 追従の連続性を見る。
 * Production Physics・機体パラメータは変更しない（観測と描画経路の診断切替のみ）。
 *
 * Camera は回転角ではなく、位置・Target・画面投影の移動で診断する
 * （OrbitControls の平行追従では cameraQuaternion がほぼ変わらないため）。
 */

export type MotionDiagMode = "a" | "b" | "c";

export type Quat4 = [number, number, number, number];
export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

/** Fixed Physics Step 1回ごとの記録（必須）。 */
export interface TurnPhysicsStepSample {
  timeMs: number;
  /** 同一 RAF 内での step 連番（0始まり）。 */
  stepIndexInFrame: number;
  frameTimeMs: number;
  steering: number;
  physicsQuaternion: Quat4;
  physicsAngularVelocity: Vec3;
  /** 直前 Physics Step との姿勢差 [deg]（正規化後）。 */
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
  /** 機体の補間済み描画位置。 */
  vehicleRenderPosition: Vec3;
  cameraPosition: Vec3;
  /** controls.target */
  cameraTarget: Vec3;
  cameraQuaternion: Quat4;
  /** |vehicle - controls.target| */
  vehicleToTargetDistance: number;
  /** |camera.position - prev| */
  cameraPositionDelta: number;
  /** |controls.target - prev| */
  cameraTargetDelta: number;
  /** 機体の画面座標（CSS px）。 */
  vehicleScreenXY: Vec2;
  /** 画面上の1フレーム移動量 [px]。 */
  vehicleScreenDelta: number;
  physicsAngularDeltaDeg: number;
  renderAngularDeltaDeg: number;
  /** 参考値。平行追従ではほぼ0になりうる（主判定には使わない）。 */
  cameraAngularDeltaDeg: number;
  renderAngularVelocityDegPerSec: number;
  renderAngularAcceleration: number;
  renderAngularJerk: number;
}

export interface TurnMotionVerdict {
  suspicionOrder: string[];
  physicsStairStepLikely: boolean;
  renderStairStepLikely: boolean;
  /** 画面位置 / Target 追従遅れに基づく Camera 疑い。 */
  cameraFollowLagLikely: boolean;
  alphaOscillationLikely: boolean;
  physicsStepsAlternatingLikely: boolean;
  notes: string[];
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
  windowLocked: boolean;
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
    vehicleToTargetDistance: number;
    cameraPositionDelta: number;
    cameraTargetDelta: number;
    vehicleScreenDelta: number;
  }>;
  turnWindowPhysicsSteps: TurnPhysicsStepSample[];
  turnWindowRaf: TurnRafSample[];
  stats: {
    rafCount: number;
    physicsStepCount: number;
    steeringPeak: number;
    physicsDeltaP50: number;
    physicsDeltaP95: number;
    renderDeltaP50: number;
    renderDeltaP95: number;
    vehicleToTargetDistanceP50: number;
    vehicleToTargetDistanceP95: number;
    cameraPositionDeltaP50: number;
    cameraPositionDeltaP95: number;
    cameraTargetDeltaP50: number;
    cameraTargetDeltaP95: number;
    vehicleScreenDeltaP50: number;
    vehicleScreenDeltaP95: number;
    alphaLowHighTransitions: number;
    physicsStepsHistogram: Record<string, number>;
  };
}

const PRE_TURN_MS = 1000;
const TURN_MS = 5000;
const STEERING_ENTER = 0.25;
const STEERING_HOLD_FRAMES = 4;
/** 旋回検出前のリング（約2秒分。検出瞬間に窓へコピーする）。 */
const PRE_RAF_CAP = 150;
const PRE_STEP_CAP = 400;

export function motionDiagModeLabel(mode: MotionDiagMode): string {
  if (mode === "b") return "B: Rotation interpolation OFF";
  if (mode === "c")
    return "C: Legacy damped camera follow（回帰比較用）";
  return "A: Current (physics interpolation + instant camera follow)";
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
  if (
    v === "c" ||
    v === "dampedfollow" ||
    v === "legacy-damped" ||
    v === "legacydamped" ||
    // 旧 alias（Instant は Production 既定になったため A へ）
    v === "camerafollowoff" ||
    v === "camera-off"
  )
    return "c";
  // instantFollow / nodamping は現行 Production（A）
  return "a";
}

function copyQuat(q: Quat4): Quat4 {
  return [q[0], q[1], q[2], q[3]];
}

function copyVec3(v: Vec3): Vec3 {
  return [v[0], v[1], v[2]];
}

function copyVec2(v: Vec2): Vec2 {
  return [v[0], v[1]];
}

function vec3Distance(a: Vec3, b: Vec3) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function vec2Distance(a: Vec2, b: Vec2) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Quaternion を単位長へ正規化する。 */
export function normalizeQuat(q: Quat4): Quat4 {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!(len > 1e-12)) return [0, 0, 0, 1];
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

/** 両方正規化してから最短角 [deg] を返す。 */
export function quatAngularDeltaDeg(a: Quat4, b: Quat4): number {
  const na = normalizeQuat(a);
  const nb = normalizeQuat(b);
  let dot = na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2] + na[3] * nb[3];
  // double-cover: 同じ向きでも符号が逆になりうる。
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

function isStairLike(deltas: number[], nearZeroThreshold = 0.05) {
  if (deltas.length < 12) return false;
  const sorted = [...deltas].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const nearZero =
    deltas.filter((d) => d < nearZeroThreshold).length / deltas.length;
  return nearZero > 0.35 && p95 > Math.max(0.4, p50 * 6 + 0.2);
}

function countAlphaOscillations(alphas: number[]) {
  let transitions = 0;
  let lastExtreme: "low" | "high" | null = null;
  for (const a of alphas) {
    const extreme: "low" | "high" | null =
      a < 0.2 ? "low" : a > 0.8 ? "high" : null;
    if (extreme && lastExtreme && extreme !== lastExtreme) transitions++;
    if (extreme) lastExtreme = extreme;
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
  const stepDeltas = steps
    .filter((s) => Math.abs(s.steering) >= STEERING_ENTER)
    .map((s) => s.physicsStepAngularDeltaDeg);
  const screenDeltas = steeringRaf.map((f) => f.vehicleScreenDelta);
  const targetLag = steeringRaf.map((f) => f.vehicleToTargetDistance);
  const cameraPosDeltas = steeringRaf.map((f) => f.cameraPositionDelta);
  const targetDeltas = steeringRaf.map((f) => f.cameraTargetDelta);

  const physicsStair = isStairLike(physicsDeltas) || isStairLike(stepDeltas);
  const renderStair = isStairLike(renderDeltas);
  const physicsSmooth =
    !physicsStair &&
    percentile([...physicsDeltas].sort((a, b) => a - b), 95) < 3;
  const renderSmooth =
    !renderStair &&
    percentile([...renderDeltas].sort((a, b) => a - b), 95) < 3;

  const screenStair = isStairLike(screenDeltas, 0.5);
  const screenP95 = percentile([...screenDeltas].sort((a, b) => a - b), 95);
  const lagP95 = percentile([...targetLag].sort((a, b) => a - b), 95);
  const camPosP95 = percentile([...cameraPosDeltas].sort((a, b) => a - b), 95);
  const targetMoveP95 = percentile([...targetDeltas].sort((a, b) => a - b), 95);
  // 画面上で止まる→飛ぶ、または Target が機体から遅れ続ける。
  const cameraFollowLag =
    screenStair ||
    screenP95 > 8 ||
    lagP95 > 0.35 ||
    (camPosP95 > Math.max(0.15, targetMoveP95 * 1.8) && lagP95 > 0.08);

  const cameraOnly = physicsSmooth && renderSmooth && cameraFollowLag;
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
  if (cameraOnly || cameraFollowLag)
    notes.push(
      "Camera 位置/Target/画面投影の移動が不均一。③ 旧 Damped follow 残存や切替ジャンプを疑う（A=Instant / C=Legacy Damped と比較）。",
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
      "自動判定は弱い。A/B目視を優先すること。cameraAngularDelta は主判定に使わない。単発の引っかかりは Camera 以外の可能性が高い。",
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
    camera: cameraFollowLag
      ? ("likely" as const)
      : lagP95 < 0.05 && screenP95 < 2
        ? ("unlikely" as const)
        : ("inconclusive" as const),
    recording: "not_assessed_here" as const,
  };

  return {
    suspicionOrder: [
      "① Physicsの旋回角速度そのもの",
      "② Fixed Step / 補間",
      "③ 旧 Camera follow damping（A=Instant / C=Legacy Damped）",
    ],
    physicsStairStepLikely: physicsStair,
    renderStairStepLikely: renderOnlyStair || (renderStair && !physicsStair),
    cameraFollowLagLikely: cameraFollowLag,
    alphaOscillationLikely: alphaOsc,
    physicsStepsAlternatingLikely: stepsAlt,
    notes,
    separation,
  };
}

export class TurnMotionDiagnostics {
  mode: MotionDiagMode = "a";
  /** 旋回検出前の短いリング。 */
  private preRaf: TurnRafSample[] = [];
  private preSteps: TurnPhysicsStepSample[] = [];
  /** 検出後に固定する6秒窓（後からリングで捨てない）。 */
  private frozenRaf: TurnRafSample[] | null = null;
  private frozenSteps: TurnPhysicsStepSample[] | null = null;
  private captureUntilMs: number | null = null;
  private windowLocked = false;

  private lastPhysicsQuat?: Quat4;
  private lastRenderQuat?: Quat4;
  private lastCameraQuat?: Quat4;
  private lastCameraPosition?: Vec3;
  private lastCameraTarget?: Vec3;
  private lastVehicleScreen?: Vec2;
  private lastRenderVel = 0;
  private lastRenderAcc = 0;
  private steeringHold = 0;
  private turnStartTimeMs: number | null = null;

  reset() {
    this.preRaf = [];
    this.preSteps = [];
    this.frozenRaf = null;
    this.frozenSteps = null;
    this.captureUntilMs = null;
    this.windowLocked = false;
    this.lastPhysicsQuat = undefined;
    this.lastRenderQuat = undefined;
    this.lastCameraQuat = undefined;
    this.lastCameraPosition = undefined;
    this.lastCameraTarget = undefined;
    this.lastVehicleScreen = undefined;
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
    const sample: TurnPhysicsStepSample = {
      timeMs: input.timeMs,
      stepIndexInFrame: input.stepIndexInFrame,
      frameTimeMs: input.frameTimeMs,
      steering: input.steering,
      physicsQuaternion: copyQuat(normalizeQuat(input.physicsQuaternion)),
      physicsAngularVelocity: copyVec3(input.physicsAngularVelocity),
      physicsStepAngularDeltaDeg: delta,
    };
    this.lastPhysicsQuat = copyQuat(input.physicsQuaternion);

    if (this.windowLocked && this.frozenSteps) return;
    if (this.frozenSteps && this.captureUntilMs !== null) {
      if (sample.timeMs <= this.captureUntilMs) this.frozenSteps.push(sample);
      return;
    }
    this.preSteps.push(sample);
    if (this.preSteps.length > PRE_STEP_CAP) this.preSteps.shift();
  }

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
    vehicleRenderPosition: Vec3;
    cameraPosition: Vec3;
    cameraTarget: Vec3;
    cameraQuaternion: Quat4;
    vehicleScreenXY: Vec2;
  }) {
    if (Math.abs(input.steering) >= STEERING_ENTER) this.steeringHold++;
    else this.steeringHold = 0;

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
    const cameraPositionDelta = this.lastCameraPosition
      ? vec3Distance(this.lastCameraPosition, input.cameraPosition)
      : 0;
    const cameraTargetDelta = this.lastCameraTarget
      ? vec3Distance(this.lastCameraTarget, input.cameraTarget)
      : 0;
    const vehicleScreenDelta = this.lastVehicleScreen
      ? vec2Distance(this.lastVehicleScreen, input.vehicleScreenXY)
      : 0;
    const vehicleToTargetDistance = vec3Distance(
      input.vehicleRenderPosition,
      input.cameraTarget,
    );
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
      physicsQuaternion: copyQuat(normalizeQuat(input.physicsQuaternion)),
      physicsPreviousQuaternion: copyQuat(
        normalizeQuat(input.physicsPreviousQuaternion),
      ),
      renderQuaternion: copyQuat(normalizeQuat(input.renderQuaternion)),
      physicsAngularVelocity: copyVec3(input.physicsAngularVelocity),
      vehicleRenderPosition: copyVec3(input.vehicleRenderPosition),
      cameraPosition: copyVec3(input.cameraPosition),
      cameraTarget: copyVec3(input.cameraTarget),
      cameraQuaternion: copyQuat(normalizeQuat(input.cameraQuaternion)),
      vehicleToTargetDistance,
      cameraPositionDelta,
      cameraTargetDelta,
      vehicleScreenXY: copyVec2(input.vehicleScreenXY),
      vehicleScreenDelta,
      physicsAngularDeltaDeg: physicsDelta,
      renderAngularDeltaDeg: renderDelta,
      cameraAngularDeltaDeg: cameraDelta,
      renderAngularVelocityDegPerSec: renderVel,
      renderAngularAcceleration: renderAcc,
      renderAngularJerk: renderJerk,
    };

    this.lastRenderQuat = copyQuat(input.renderQuaternion);
    this.lastCameraQuat = copyQuat(input.cameraQuaternion);
    this.lastCameraPosition = copyVec3(input.cameraPosition);
    this.lastCameraTarget = copyVec3(input.cameraTarget);
    this.lastVehicleScreen = copyVec2(input.vehicleScreenXY);
    this.lastRenderVel = renderVel;
    this.lastRenderAcc = renderAcc;

    // 旋回検出 → 専用配列へ固定コピー（以降リングから捨てない）。
    if (
      this.turnStartTimeMs === null &&
      this.steeringHold >= STEERING_HOLD_FRAMES
    ) {
      this.turnStartTimeMs = input.timeMs;
      const from = input.timeMs - PRE_TURN_MS;
      this.captureUntilMs = input.timeMs + TURN_MS;
      this.frozenRaf = this.preRaf.filter((s) => s.timeMs >= from);
      this.frozenSteps = this.preSteps.filter((s) => s.timeMs >= from);
      this.preRaf = [];
      this.preSteps = [];
    }

    if (this.windowLocked) return;

    if (this.frozenRaf && this.captureUntilMs !== null) {
      if (sample.timeMs <= this.captureUntilMs) {
        this.frozenRaf.push(sample);
      } else {
        this.windowLocked = true;
      }
      return;
    }

    this.preRaf.push(sample);
    if (this.preRaf.length > PRE_RAF_CAP) this.preRaf.shift();
  }

  dump(): TurnMotionDump {
    const raf = this.frozenRaf ?? [];
    const steps = this.frozenSteps ?? [];
    const physicsDeltas = raf
      .map((f) => f.physicsAngularDeltaDeg)
      .sort((a, b) => a - b);
    const renderDeltas = raf
      .map((f) => f.renderAngularDeltaDeg)
      .sort((a, b) => a - b);
    const lag = raf
      .map((f) => f.vehicleToTargetDistance)
      .sort((a, b) => a - b);
    const camPos = raf.map((f) => f.cameraPositionDelta).sort((a, b) => a - b);
    const camTarget = raf.map((f) => f.cameraTargetDelta).sort((a, b) => a - b);
    const screen = raf.map((f) => f.vehicleScreenDelta).sort((a, b) => a - b);
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
      turnStartTimeMs: this.turnStartTimeMs,
      window: { preTurnMs: PRE_TURN_MS, turnMs: TURN_MS },
      windowLocked: this.windowLocked || this.frozenRaf !== null,
      verdict: analyze(raf, steps),
      turnWindowFrames: raf.map((f) => ({
        time: f.timeMs,
        rafMs: f.rafMs,
        physicsSteps: f.physicsStepsThisFrame,
        alpha: f.interpolationAlpha,
        steering: f.steering,
        physicsAngularDeltaDeg: f.physicsAngularDeltaDeg,
        renderAngularDeltaDeg: f.renderAngularDeltaDeg,
        vehicleToTargetDistance: f.vehicleToTargetDistance,
        cameraPositionDelta: f.cameraPositionDelta,
        cameraTargetDelta: f.cameraTargetDelta,
        vehicleScreenDelta: f.vehicleScreenDelta,
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
        vehicleToTargetDistanceP50: percentile(lag, 50),
        vehicleToTargetDistanceP95: percentile(lag, 95),
        cameraPositionDeltaP50: percentile(camPos, 50),
        cameraPositionDeltaP95: percentile(camPos, 95),
        cameraTargetDeltaP50: percentile(camTarget, 50),
        cameraTargetDeltaP95: percentile(camTarget, 95),
        vehicleScreenDeltaP50: percentile(screen, 50),
        vehicleScreenDeltaP95: percentile(screen, 95),
        alphaLowHighTransitions: countAlphaOscillations(
          raf.map((f) => f.interpolationAlpha),
        ),
        physicsStepsHistogram: histogram,
      },
    };
  }
}
