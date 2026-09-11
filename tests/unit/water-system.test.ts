import { describe, expect, it } from "vitest";
import {
  computeBoxBuoyancy,
  WATER_DENSITY,
} from "../../packages/water-system/src/index";

const axes = {
  x: [1, 0, 0] as [number, number, number],
  y: [0, 1, 0] as [number, number, number],
  z: [0, 0, 1] as [number, number, number],
};

describe("排水体積ベースの浮力", () => {
  it("水上では浮力と排水体積がゼロになる", () => {
    const result = computeBoxBuoyancy({
      waterHeight: 0,
      center: [0, 2, 0],
      size: [2, 2, 2],
      axes,
      gravity: 9.81,
    });
    expect(result.submergedFraction).toBe(0);
    expect(result.displacedVolume).toBe(0);
    expect(result.force).toEqual([0, 0, 0]);
  });

  it("半分水没では体積の半分を押しのける", () => {
    const result = computeBoxBuoyancy({
      waterHeight: 1,
      center: [0, 1, 0],
      size: [2, 2, 2],
      axes,
      gravity: 9.81,
    });
    expect(result.submergedFraction).toBeCloseTo(0.5);
    expect(result.displacedVolume).toBeCloseTo(4);
    expect(result.force[1]).toBeCloseTo(WATER_DENSITY * 9.81 * 4);
  });

  it("完全水没では全体積を押しのける", () => {
    const result = computeBoxBuoyancy({
      waterHeight: 3,
      center: [0, 1, 0],
      size: [2, 2, 2],
      axes,
      gravity: 9.81,
    });
    expect(result.submergedFraction).toBe(1);
    expect(result.displacedVolume).toBe(8);
  });

  it("体積・水密度・重力に比例して浮力が変化する", () => {
    const base = computeBoxBuoyancy({
        waterHeight: 2,
        center: [0, 0, 0],
        size: [1, 1, 1],
        axes,
        gravity: 9.81,
      }),
      doubledVolume = computeBoxBuoyancy({
        waterHeight: 2,
        center: [0, 0, 0],
        size: [2, 1, 1],
        axes,
        gravity: 9.81,
      }),
      doubledDensity = computeBoxBuoyancy({
        waterHeight: 2,
        center: [0, 0, 0],
        size: [1, 1, 1],
        axes,
        fluidDensity: WATER_DENSITY * 2,
        gravity: 9.81,
      }),
      doubledGravity = computeBoxBuoyancy({
        waterHeight: 2,
        center: [0, 0, 0],
        size: [1, 1, 1],
        axes,
        gravity: 9.81 * 2,
      });
    expect(doubledVolume.force[1]).toBeCloseTo(base.force[1] * 2);
    expect(doubledDensity.force[1]).toBeCloseTo(base.force[1] * 2);
    expect(doubledGravity.force[1]).toBeCloseTo(base.force[1] * 2);
  });

  it("傾いたBoxでも有限値と0〜1の水没率を返す", () => {
    const result = computeBoxBuoyancy({
      waterHeight: 0.2,
      center: [0, 0, 0],
      size: [2, 1, 3],
      axes: {
        x: [0.94, 0.1, 0.3],
        y: [-0.1, 0.98, 0.05],
        z: [-0.3, -0.05, 0.94],
      },
      gravity: 9.81,
    });
    expect(result.submergedFraction).toBeGreaterThanOrEqual(0);
    expect(result.submergedFraction).toBeLessThanOrEqual(1);
    expect(
      [
        result.submergedFraction,
        result.displacedVolume,
        ...result.force,
        ...result.applicationPoint,
      ].every(Number.isFinite),
    ).toBe(true);
  });
});
