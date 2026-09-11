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
