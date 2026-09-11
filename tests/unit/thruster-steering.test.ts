import { describe, expect, it } from "vitest";
import {
  isForwardThruster,
  mixThrusterCommands,
  THRUSTER_STEERING_MIX,
} from "../../packages/physics-rapier/src/thruster-steering";

describe("一般化Thruster Steering Mixer", () => {
  it("直進時は左右の出力が同じになる", () => {
    expect(
      mixThrusterCommands({
        throttle: 1,
        steering: 0,
        lateralOffsets: [-2, 2],
      }),
    ).toEqual([1, 1]);
  });

  it("正負の操舵で左右出力の差が反転する", () => {
    const left = mixThrusterCommands({
        throttle: 1,
        steering: 1,
        lateralOffsets: [-2, 2],
      }),
      right = mixThrusterCommands({
        throttle: 1,
        steering: -1,
        lateralOffsets: [-2, 2],
      });
    expect(left[0]).toBeLessThan(left[1]);
    expect(right[0]).toBeGreaterThan(right[1]);
    expect(left[0]).toBeCloseTo(1 - THRUSTER_STEERING_MIX);
    expect(right[1]).toBeCloseTo(1 - THRUSTER_STEERING_MIX);
  });

  it("throttleがゼロなら操舵推力もゼロになる", () => {
    expect(
      mixThrusterCommands({
        throttle: 0,
        steering: 1,
        lateralOffsets: [-2, 2],
      }),
    ).toEqual([0, 0]);
  });

  it("中央の単一Thrusterは操舵で出力が変わらない", () => {
    expect(
      mixThrusterCommands({
        throttle: 0.8,
        steering: 1,
        lateralOffsets: [0],
      }),
    ).toEqual([0.8]);
  });

  it("前向き判定はLocal +Zを基準にする", () => {
    expect(isForwardThruster([0, 0, 1])).toBe(true);
    expect(isForwardThruster([0, 0, 0.5])).toBe(true);
    expect(isForwardThruster([0, 0, -1])).toBe(false);
    expect(isForwardThruster([0, 1, 0])).toBe(false);
  });
});
