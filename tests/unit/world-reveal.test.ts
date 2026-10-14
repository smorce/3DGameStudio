import { describe, expect, it } from "vitest";
import {
  WorldReveal,
  revealFrontier,
} from "../../packages/renderer-three/src/world-reveal";

const step = (
  reveal: WorldReveal,
  from: number,
  to: number,
  frontier: number,
) => {
  let frame = reveal.update(from, frontier);
  for (let t = from; t <= to; t += 16) frame = reveal.update(t, frontier);
  return frame;
};

describe("world-reveal", () => {
  it("開始時は機体より手前で霧に包まれ、空は見せない", () => {
    const reveal = new WorldReveal({
      cameraDistance: 12,
      fogDensity: 0.00065,
      now: 0,
    });
    const frame = reveal.update(0, 0);
    expect(frame.far).toBeLessThan(12);
    expect(frame.sky).toBe(0);
    expect(frame.done).toBe(false);
  });

  it("霧の縁は未読込 Chunk の手前に留まる", () => {
    const reveal = new WorldReveal({
      cameraDistance: 12,
      fogDensity: 0.00065,
      now: 0,
    });
    const frame = step(reveal, 0, 1500, 40);
    expect(frame.far).toBeLessThanOrEqual(12 + 40 + 1e-6);
    expect(frame.near).toBeLessThan(frame.far);
  });

  it("読込完了後は FogExp2 相当まで晴れて終了する", () => {
    const reveal = new WorldReveal({
      cameraDistance: 12,
      fogDensity: 0.00065,
      now: 0,
    });
    step(reveal, 0, 800, 200);
    const frame = step(reveal, 800, 3500, Number.POSITIVE_INFINITY);
    expect(frame.done).toBe(true);
    expect(frame.sky).toBe(1);
  });

  it("読込が進まなくても timeout で必ず晴れる", () => {
    const reveal = new WorldReveal({
      cameraDistance: 12,
      fogDensity: 0.003,
      now: 0,
      timeoutMs: 3000,
    });
    expect(step(reveal, 0, 3100, 0).done).toBe(true);
  });

  it("読込前線は Chunk 境界までの水平距離で、長く残る Chunk は除外する", () => {
    const seen = new Map<string, number>();
    // 注視点 (10, 0, 10)。Chunk "1,0" は x=64 から始まる。
    expect(
      revealFrontier(["1,0", "3,3"], [10, 0, 10], 64, 0, seen),
    ).toBeCloseTo(54);
    expect(revealFrontier(["0,0"], [10, 0, 10], 64, 0, seen)).toBe(0);
    expect(revealFrontier(["0,0"], [10, 0, 10], 64, 5000, seen)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});
