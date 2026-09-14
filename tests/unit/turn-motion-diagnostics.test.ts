import { describe, expect, it } from "vitest";
import {
  TurnMotionDiagnostics,
  quatAngularDeltaDeg,
  parseMotionDiagMode,
} from "../../packages/engine-core/src/turn-motion-diagnostics";

describe("turn-motion-diagnostics", () => {
  it("parseMotionDiagMode が a/b/c を解釈する", () => {
    expect(parseMotionDiagMode(null)).toBe("a");
    expect(parseMotionDiagMode("b")).toBe("b");
    expect(parseMotionDiagMode("rotNoInterp")).toBe("b");
    expect(parseMotionDiagMode("c")).toBe("c");
  });

  it("quatAngularDeltaDeg が同一姿勢で0、90度回転で約90", () => {
    expect(quatAngularDeltaDeg([0, 0, 0, 1], [0, 0, 0, 1])).toBeCloseTo(0, 5);
    // 90deg about Y: (0, sin45, 0, cos45)
    const s = Math.SQRT1_2;
    expect(quatAngularDeltaDeg([0, 0, 0, 1], [0, s, 0, s])).toBeCloseTo(90, 4);
  });

  it("Physics Step と RAF を記録し、旋回窓を切り出せる", () => {
    const diag = new TurnMotionDiagnostics();
    diag.mode = "a";
    const identity: [number, number, number, number] = [0, 0, 0, 1];
    const s = Math.SQRT1_2;
    let yaw = 0;
    for (let i = 0; i < 120; i++) {
      const timeMs = i * 16.7;
      const steering = i >= 60 ? 1 : 0;
      if (steering) yaw += 0.02;
      const q: [number, number, number, number] = [
        0,
        Math.sin(yaw / 2),
        0,
        Math.cos(yaw / 2),
      ];
      diag.recordPhysicsStep({
        timeMs,
        stepIndexInFrame: 0,
        frameTimeMs: 16.7,
        steering,
        physicsQuaternion: q,
        physicsAngularVelocity: [0, steering ? 1.2 : 0, 0],
      });
      diag.recordRaf({
        timeMs,
        rafMs: 16.7,
        physicsStepsThisFrame: 1,
        interpolationAlpha: 0.4,
        steering,
        physicsQuaternion: q,
        physicsPreviousQuaternion: identity,
        renderQuaternion: q,
        physicsAngularVelocity: [0, steering ? 1.2 : 0, 0],
        cameraPosition: [0, 5, 0],
        cameraTarget: [0, 0, 0],
        cameraQuaternion: [0, s, 0, s],
      });
    }
    const dump = diag.dump();
    expect(dump.turnStartTimeMs).not.toBeNull();
    expect(dump.turnWindowPhysicsSteps.length).toBeGreaterThan(10);
    expect(dump.turnWindowFrames.length).toBeGreaterThan(10);
    expect(dump.turnWindowFrames[0]).toHaveProperty("physicsAngularDeltaDeg");
    expect(dump.verdict.suspicionOrder[0]).toContain("Physics");
    expect(dump.verdict.separation.recording).toBe("not_assessed_here");
  });
});
