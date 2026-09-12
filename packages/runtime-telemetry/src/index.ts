export type TelemetryVec3 = [number, number, number];
export type TelemetryQuat = [number, number, number, number];

export interface WheelTelemetrySample {
  id: string;
  inContact?: boolean;
  suspensionLengthM: number;
  suspensionForceN?: number;
}
export interface RoleAerodynamicTelemetry {
  appliedLiftVerticalN: number;
  appliedDragN: number;
  appliedAerodynamicForceN: number;
  angleOfAttackRad: number;
  liftCoefficient: number;
  dragCoefficient: number;
  pitchMomentNm: number;
  panelCount: number;
}

export interface MachineTelemetrySample {
  version: 1;
  step: number;
  timeSeconds: number;
  machineId: string;
  position: TelemetryVec3;
  rotation: TelemetryQuat;
  linearVelocityMps: TelemetryVec3;
  angularVelocityRadPerSecond: TelemetryVec3;
  worldSpeedMps: number;
  horizontalSpeedMps: number;
  forwardSpeedMps: number;
  verticalSpeedMps: number;
  throttle: number;
  steering: number;
  brake: boolean;
  pitchRad: number;
  yawRad: number;
  rollRad: number;
  totalLiftN: number;
  liftVerticalN: number;
  totalDragN: number;
  totalAerodynamicForceN: number;
  rawLiftVerticalN: number;
  rawDragN: number;
  appliedAerodynamicForceWorldN: TelemetryVec3;
  appliedAerodynamicVerticalN: number;
  appliedAerodynamicToWeightRatio: number;
  aerodynamicPitchMomentNm: number;
  aerodynamicPitchMomentByRoleNm: Record<string, number>;
  aerodynamicByRole: Record<string, RoleAerodynamicTelemetry>;
  totalThrusterForceN: number;
  thrusterPitchMomentNm: number;
  totalPitchMomentNm: number;
  thrusterForceWorldN: TelemetryVec3;
  averageAngleOfAttackRad: number;
  averageLiftCoefficient: number;
  averageDragCoefficient: number;
  liftToWeightRatio: number;
  massKg: number;
  weightN: number;
  terrainAvailable: boolean;
  terrainHeightM: number | null;
  heightAboveTerrainM: number | null;
  contactStatusAvailable: boolean;
  groundedWheelCount: number;
  wheels: WheelTelemetrySample[];
}

export const DEFAULT_TELEMETRY_CAPACITY = 3600;
export const GRAVITY_ACCELERATION_MPS2 = 9.81;

const magnitude = (value: readonly number[]) => Math.hypot(...value);

export function worldSpeedMps(linearVelocityMps: readonly number[]) {
  return magnitude(linearVelocityMps);
}

export function speedKphFromMps(speedMps: number) {
  return speedMps * 3.6;
}

export function horizontalSpeedMps(linearVelocityMps: readonly number[]) {
  return Math.hypot(linearVelocityMps[0], linearVelocityMps[2]);
}

export function forwardSpeedMps(
  linearVelocityMps: readonly number[],
  forward: readonly number[],
) {
  return (
    linearVelocityMps[0] * forward[0] +
    linearVelocityMps[1] * forward[1] +
    linearVelocityMps[2] * forward[2]
  );
}

export function vectorMagnitude(value: readonly number[]) {
  return magnitude(value);
}

export interface StableForwardTakeoffOptions {
  minAltitudeM?: number;
  minHeightAboveTerrainM?: number;
  minWorldSpeedMps?: number;
  minGroundRollSteps?: number;
  minGroundedWheelCount?: number;
  windowSteps?: number;
  minSustainedFlightSteps?: number;
  maxPitchRad?: number;
  maxAltitudeDropM?: number;
  minAverageVerticalSpeedMps?: number;
}

export interface StableForwardTakeoff {
  groundRollStartIndex: number;
  groundRollSteps: number;
  liftoffIndex: number;
  liftoffStep: number;
  liftoffTimeSeconds: number;
  liftoffAltitudeM: number;
  liftoffHeightAboveTerrainM: number;
  finalAltitudeM: number;
  finalHeightAboveTerrainM: number;
  averageVerticalSpeedMps: number;
  windowSteps: number;
  durationSeconds: number;
}

const hasTerrainHeight = (
  sample: MachineTelemetrySample,
): sample is MachineTelemetrySample & {
  terrainHeightM: number;
  heightAboveTerrainM: number;
} =>
  sample.terrainAvailable &&
  sample.terrainHeightM !== null &&
  sample.heightAboveTerrainM !== null;

const isGroundRollSample = (
  sample: MachineTelemetrySample,
  minGroundedWheelCount: number,
) =>
  hasTerrainHeight(sample) &&
  sample.forwardSpeedMps > 0 &&
  sample.groundedWheelCount >= minGroundedWheelCount;

const isForwardFlightSample = (
  sample: MachineTelemetrySample,
  minHeightAboveTerrainM: number,
  minWorldSpeedMps: number,
  maxPitchRad: number,
) =>
  hasTerrainHeight(sample) &&
  sample.contactStatusAvailable &&
  sample.groundedWheelCount === 0 &&
  sample.heightAboveTerrainM >= minHeightAboveTerrainM &&
  sample.worldSpeedMps >= minWorldSpeedMps &&
  sample.forwardSpeedMps > 0 &&
  Math.abs(sample.pitchRad) <= maxPitchRad;

export function findStableForwardTakeoff(
  samples: readonly MachineTelemetrySample[],
  options: StableForwardTakeoffOptions = {},
): StableForwardTakeoff | undefined {
  const minHeightAboveTerrainM =
    options.minHeightAboveTerrainM ?? options.minAltitudeM ?? 0.25;
  const minWorldSpeedMps = options.minWorldSpeedMps ?? 0;
  const minGroundRollSteps = options.minGroundRollSteps ?? 45;
  const minGroundedWheelCount = options.minGroundedWheelCount ?? 2;
  const windowSteps =
    options.minSustainedFlightSteps ?? options.windowSteps ?? 180;
  const maxPitchRad = options.maxPitchRad ?? 0.8;
  const maxAltitudeDropM = options.maxAltitudeDropM ?? 0.5;
  const minAverageVerticalSpeedMps = options.minAverageVerticalSpeedMps ?? -0.5;
  if (
    minGroundRollSteps <= 0 ||
    !Number.isInteger(minGroundRollSteps) ||
    minGroundedWheelCount <= 0 ||
    !Number.isInteger(minGroundedWheelCount) ||
    windowSteps <= 0 ||
    !Number.isInteger(windowSteps)
  )
    return undefined;

  for (
    let index = minGroundRollSteps;
    index + windowSteps <= samples.length;
    index++
  ) {
    const liftoff = samples[index];
    const previous = samples[index - 1];
    const groundRoll = samples.slice(index - minGroundRollSteps, index);
    if (
      previous.groundedWheelCount <= 0 ||
      liftoff.groundedWheelCount !== 0 ||
      groundRoll.length !== minGroundRollSteps ||
      groundRoll.some(
        (sample) => !isGroundRollSample(sample, minGroundedWheelCount),
      )
    )
      continue;
    if (
      !isForwardFlightSample(
        liftoff,
        minHeightAboveTerrainM,
        minWorldSpeedMps,
        maxPitchRad,
      )
    )
      continue;
    if (!hasTerrainHeight(liftoff)) continue;
    const window = samples.slice(index, index + windowSteps);
    if (
      window.some((sample) => {
        if (!hasTerrainHeight(sample)) return true;
        if (
          !isForwardFlightSample(
            sample,
            minHeightAboveTerrainM,
            minWorldSpeedMps,
            maxPitchRad,
          )
        )
          return true;
        return (
          sample.heightAboveTerrainM <
          liftoff.heightAboveTerrainM - maxAltitudeDropM
        );
      })
    )
      continue;
    const final = window.at(-1)!;
    if (!hasTerrainHeight(final)) continue;
    const averageVerticalSpeedMps =
      window.reduce((total, sample) => total + sample.verticalSpeedMps, 0) /
      window.length;
    if (
      final.position[1] < liftoff.position[1] &&
      averageVerticalSpeedMps < minAverageVerticalSpeedMps
    )
      continue;
    return {
      groundRollStartIndex: index - minGroundRollSteps,
      groundRollSteps: minGroundRollSteps,
      liftoffIndex: index,
      liftoffStep: liftoff.step,
      liftoffTimeSeconds: liftoff.timeSeconds,
      liftoffAltitudeM: liftoff.position[1],
      liftoffHeightAboveTerrainM: liftoff.heightAboveTerrainM,
      finalAltitudeM: final.position[1],
      finalHeightAboveTerrainM: final.heightAboveTerrainM,
      averageVerticalSpeedMps,
      windowSteps,
      durationSeconds: final.timeSeconds - liftoff.timeSeconds,
    };
  }
  return undefined;
}

export class RingBuffer<T> {
  private readonly values: Array<T | undefined>;
  private start = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0)
      throw new Error("Telemetry buffer capacity must be a positive integer");
    this.values = new Array<T | undefined>(capacity);
  }

  get size() {
    return this.count;
  }

  push(value: T) {
    const index = (this.start + this.count) % this.capacity;
    this.values[index] = value;
    if (this.count === this.capacity)
      this.start = (this.start + 1) % this.capacity;
    else this.count++;
  }

  clear() {
    this.values.fill(undefined);
    this.start = 0;
    this.count = 0;
  }

  toArray() {
    return Array.from(
      { length: this.count },
      (_, index) => this.values[(this.start + index) % this.capacity]!,
    );
  }
}

export interface TelemetryRecorderOptions {
  capacity?: number;
}

export class RuntimeTelemetry {
  readonly buffer: RingBuffer<MachineTelemetrySample>;
  private latest?: MachineTelemetrySample;
  private readonly latestByMachine = new Map<string, MachineTelemetrySample>();
  private active = false;

  constructor(options: TelemetryRecorderOptions = {}) {
    this.buffer = new RingBuffer(
      options.capacity ?? DEFAULT_TELEMETRY_CAPACITY,
    );
  }

  get recording() {
    return this.active;
  }

  start() {
    this.active = true;
  }

  stop() {
    this.active = false;
  }

  clear() {
    this.buffer.clear();
    this.latest = undefined;
    this.latestByMachine.clear();
  }

  record(sample: MachineTelemetrySample) {
    this.latest = sample;
    this.latestByMachine.set(sample.machineId, sample);
    if (this.active) this.buffer.push(sample);
  }

  current(machineId?: string) {
    return machineId ? this.latestByMachine.get(machineId) : this.latest;
  }

  samples() {
    return this.buffer.toArray();
  }

  exportJson() {
    return JSON.stringify({
      version: 1,
      samples: this.samples(),
    });
  }

  exportJsonLines() {
    return this.samples()
      .map((sample) => JSON.stringify(sample))
      .join("\n");
  }
}
