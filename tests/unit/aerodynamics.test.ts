import { describe, expect, it } from "vitest";
import {
  computePanelAerodynamicForce,
  PANEL_CD_MIN,
} from "../../packages/aerodynamics/src/index";

const input = {
  center: [0, 0, 0] as [number, number, number],
  normal: [0, 1, 0] as [number, number, number],
  windVelocity: [0, 0, 0] as [number, number, number],
  area: 1,
};

describe("Panel surface aerodynamics", () => {
  it("速度ゼロでは空力を発生させない", () => {
    expect(
      computePanelAerodynamicForce({
        ...input,
        velocity: [0, 0, 0],
      }).force,
    ).toEqual([0, 0, 0]);
  });

  it("流れと平行なPanelは小さな抗力だけを受ける", () => {
    const result = computePanelAerodynamicForce({
      ...input,
      velocity: [0, 0, 10],
    });
    expect(result.lift[1]).toBeCloseTo(0);
    expect(result.drag[2]).toBeLessThan(0);
    expect(result.dragCoefficient).toBeCloseTo(PANEL_CD_MIN);
  });

  it("正負のTiltで揚力方向が反転する", () => {
    // 前縁上げ(法線が後方へ傾く)が正の迎角・上向き揚力。
    const positive = computePanelAerodynamicForce({
      ...input,
      normal: [0, Math.cos(0.12), -Math.sin(0.12)],
      velocity: [0, 0, 10],
    });
    const negative = computePanelAerodynamicForce({
      ...input,
      normal: [0, Math.cos(0.12), Math.sin(0.12)],
      velocity: [0, 0, 10],
    });
    expect(positive.lift[1]).toBeGreaterThan(0);
    expect(negative.lift[1]).toBeLessThan(0);
    expect(positive.drag[2]).toBeLessThan(0);
    expect(negative.drag[2]).toBeLessThan(0);
  });

  it("Panelが流れに正対すると抗力が大きく揚力が小さい", () => {
    const result = computePanelAerodynamicForce({
      ...input,
      normal: [0, 0, 1],
      velocity: [0, 0, 10],
    });
    expect(Math.abs(result.lift[1])).toBeLessThan(1e-6);
    expect(result.dragCoefficient).toBeGreaterThan(PANEL_CD_MIN * 10);
  });

  it("速度を2倍にすると力は概ね4倍になる", () => {
    const slow = computePanelAerodynamicForce({
      ...input,
      normal: [0, Math.cos(0.12), -Math.sin(0.12)],
      velocity: [0, 0, 5],
    });
    const fast = computePanelAerodynamicForce({
      ...input,
      normal: [0, Math.cos(0.12), -Math.sin(0.12)],
      velocity: [0, 0, 10],
    });
    expect(fast.force[1] / slow.force[1]).toBeCloseTo(4, 1);
  });

  it("主翼の正の迎角は上向き揚力を生む", () => {
    const zeroAngle = computePanelAerodynamicForce({
        ...input,
        velocity: [0, 0, 20],
      }),
      positiveAngle = computePanelAerodynamicForce({
        ...input,
        normal: [0, Math.cos(0.18), -Math.sin(0.18)],
        velocity: [0, 0, 20],
      });
    expect(Math.abs(zeroAngle.lift[1])).toBeLessThan(1e-6);
    expect(positiveAngle.angleOfAttack).toBeGreaterThan(0);
    expect(positiveAngle.lift[1]).toBeGreaterThan(0);
  });

  it("速度方向を反転すると迎角と揚力Yの符号も反転する", () => {
    const forward = computePanelAerodynamicForce({
        ...input,
        normal: [0, Math.cos(0.18), -Math.sin(0.18)],
        velocity: [0, 0, 20],
      }),
      backward = computePanelAerodynamicForce({
        ...input,
        normal: [0, Math.cos(0.18), -Math.sin(0.18)],
        velocity: [0, 0, -20],
      });
    expect(forward.angleOfAttack).toBeGreaterThan(0);
    expect(backward.angleOfAttack).toBeLessThan(0);
    expect(forward.lift[1]).toBeGreaterThan(0);
    expect(backward.lift[1]).toBeLessThan(0);
    expect(forward.liftCoefficient).toBeGreaterThan(0);
    expect(backward.liftCoefficient).toBeLessThan(0);
    expect(forward.drag[2]).toBeLessThan(0);
    expect(backward.drag[2]).toBeGreaterThan(0);
  });
});
