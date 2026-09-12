import { expect, it } from "vitest";
import {
  RingBuffer,
  RuntimeTelemetry,
  findStableForwardTakeoff,
  horizontalSpeedMps,
  speedKphFromMps,
  worldSpeedMps,
  type MachineTelemetrySample,
} from "../../packages/runtime-telemetry/src/index";

const sample = (step: number): MachineTelemetrySample => ({
  version: 1,
  step,
  timeSeconds: step / 60,
  machineId: "machine",
  position: [0, 0, step],
  rotation: [0, 0, 0, 1],
  linearVelocityMps: [3, 4, 0],
  angularVelocityRadPerSecond: [0, 0, 0],
  worldSpeedMps: 5,
  horizontalSpeedMps: 3,
  forwardSpeedMps: 0,
  verticalSpeedMps: 4,
  throttle: 1,
  steering: 0,
  brake: false,
  pitchRad: 0,
  yawRad: 0,
  rollRad: 0,
  totalLiftN: 0,
  liftVerticalN: 0,
  totalDragN: 0,
  totalAerodynamicForceN: 0,
  totalThrusterForceN: 0,
  thrusterForceWorldN: [0, 0, 0],
  averageAngleOfAttackRad: 0,
  averageLiftCoefficient: 0,
  averageDragCoefficient: 0,
  liftToWeightRatio: 0,
  massKg: 1,
  weightN: 9.81,
  contactStatusAvailable: false,
  groundedWheelCount: 0,
  wheels: [],
});

it("速度をWorld Spaceの線速度から計算し、km/hへ変換する", () => {
  expect(worldSpeedMps([3, 4, 0])).toBe(5);
  expect(horizontalSpeedMps([3, 4, 12])).toBe(12.36931687685298);
  expect(speedKphFromMps(5)).toBe(18);
});

it("RingBufferは古いSampleから上限を超えて破棄する", () => {
  const buffer = new RingBuffer<number>(3);
  buffer.push(1);
  buffer.push(2);
  buffer.push(3);
  buffer.push(4);
  expect(buffer.size).toBe(3);
  expect(buffer.toArray()).toEqual([2, 3, 4]);
  buffer.clear();
  expect(buffer.toArray()).toEqual([]);
});

it("RuntimeTelemetryは記録状態と現在値を分離して管理する", () => {
  const telemetry = new RuntimeTelemetry({ capacity: 2 });
  telemetry.record(sample(0));
  expect(telemetry.current()?.step).toBe(0);
  expect(telemetry.samples()).toEqual([]);

  telemetry.start();
  telemetry.record(sample(1));
  telemetry.record(sample(2));
  telemetry.record(sample(3));
  telemetry.stop();
  telemetry.record(sample(4));

  expect(telemetry.recording).toBe(false);
  expect(telemetry.current()?.step).toBe(4);
  expect(telemetry.samples().map(({ step }) => step)).toEqual([2, 3]);
  expect(telemetry.exportJson()).toContain('"samples"');
  expect(telemetry.exportJsonLines().split("\n")).toHaveLength(2);

  telemetry.clear();
  expect(telemetry.current()).toBeUndefined();
  expect(telemetry.samples()).toEqual([]);
});

it("前進方向と持続高度を満たす離陸だけを安定離陸と判定する", () => {
  const samples = Array.from({ length: 90 }, (_, index) => ({
    ...sample(index + 1),
    position: [0, 2, index] as [number, number, number],
    linearVelocityMps: [0, 0, 21] as [number, number, number],
    worldSpeedMps: 21,
    horizontalSpeedMps: 21,
    forwardSpeedMps: 21,
    verticalSpeedMps: 0,
    contactStatusAvailable: true,
    groundedWheelCount: 0,
  }));
  expect(findStableForwardTakeoff(samples)?.windowSteps).toBe(90);
  expect(
    findStableForwardTakeoff(
      samples.map((value) => ({ ...value, forwardSpeedMps: -21 })),
    ),
  ).toBeUndefined();
  expect(
    findStableForwardTakeoff(
      samples.map((value, index) => ({
        ...value,
        position: [0, index < 45 ? 2 : 0.5, index] as [number, number, number],
      })),
    ),
  ).toBeUndefined();
  expect(
    findStableForwardTakeoff(
      samples.map((value) => ({ ...value, contactStatusAvailable: false })),
    ),
  ).toBeUndefined();
});
