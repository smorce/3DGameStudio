export type TelemetryVec3 = [number, number, number];
export type TelemetryQuat = [number, number, number, number];

export interface WheelTelemetrySample {
  id: string;
  inContact?: boolean;
  suspensionLengthM: number;
  suspensionForceN?: number;
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
  totalThrusterForceN: number;
  thrusterForceWorldN: TelemetryVec3;
  averageAngleOfAttackRad: number;
  averageLiftCoefficient: number;
  averageDragCoefficient: number;
  liftToWeightRatio: number;
  massKg: number;
  weightN: number;
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
  minWorldSpeedMps?: number;
  windowSteps?: number;
  maxPitchRad?: number;
  maxAltitudeDropM?: number;
  minAverageVerticalSpeedMps?: number;
}

export interface StableForwardTakeoff {
  liftoffIndex: number;
  liftoffStep: number;
  liftoffTimeSeconds: number;
  liftoffAltitudeM: number;
  finalAltitudeM: number;
  averageVerticalSpeedMps: number;
  windowSteps: number;
  durationSeconds: number;
}

const isForwardFlightSample = (
  sample: MachineTelemetrySample,
  minAltitudeM: number,
  minWorldSpeedMps: number,
  maxPitchRad: number,
) =>
  sample.contactStatusAvailable &&
  sample.groundedWheelCount === 0 &&
  sample.position[1] >= minAltitudeM &&
  sample.worldSpeedMps >= minWorldSpeedMps &&
  sample.forwardSpeedMps > 0 &&
  Math.abs(sample.pitchRad) <= maxPitchRad;

export function findStableForwardTakeoff(
  samples: readonly MachineTelemetrySample[],
  options: StableForwardTakeoffOptions = {},
): StableForwardTakeoff | undefined {
  const minAltitudeM = options.minAltitudeM ?? 1.5;
  const minWorldSpeedMps = options.minWorldSpeedMps ?? 20;
  const windowSteps = options.windowSteps ?? 90;
  const maxPitchRad = options.maxPitchRad ?? 0.8;
  const maxAltitudeDropM = options.maxAltitudeDropM ?? 0.5;
  const minAverageVerticalSpeedMps = options.minAverageVerticalSpeedMps ?? -0.5;
  if (windowSteps <= 0 || !Number.isInteger(windowSteps)) return undefined;

  for (let index = 0; index + windowSteps <= samples.length; index++) {
    const liftoff = samples[index];
    if (
      !isForwardFlightSample(
        liftoff,
        minAltitudeM,
        minWorldSpeedMps,
        maxPitchRad,
      )
    )
      continue;
    const window = samples.slice(index, index + windowSteps);
    if (
      window.some(
        (sample) =>
          !isForwardFlightSample(
            sample,
            minAltitudeM,
            minWorldSpeedMps,
            maxPitchRad,
          ) || sample.position[1] < liftoff.position[1] - maxAltitudeDropM,
      )
    )
      continue;
    const final = window.at(-1)!;
    const averageVerticalSpeedMps =
      window.reduce((total, sample) => total + sample.verticalSpeedMps, 0) /
      window.length;
    if (
      final.position[1] < liftoff.position[1] &&
      averageVerticalSpeedMps < minAverageVerticalSpeedMps
    )
      continue;
    return {
      liftoffIndex: index,
      liftoffStep: liftoff.step,
      liftoffTimeSeconds: liftoff.timeSeconds,
      liftoffAltitudeM: liftoff.position[1],
      finalAltitudeM: final.position[1],
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
