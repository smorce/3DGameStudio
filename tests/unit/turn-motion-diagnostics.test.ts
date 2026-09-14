import { describe, expect, it } from "vitest";
import {
  TurnMotionDiagnostics,
  quatAngularDeltaDeg,
  normalizeQuat,
  parseMotionDiagMode,
} from "../../packages/engine-core/src/turn-motion-diagnostics";

describe("turn-motion-diagnostics", () => {
  it("parseMotionDiagMode が a/b/c を解釈する", () => {
    expect(parseMotionDiagMode(null)).toBe("a");
    expect(parseMotionDiagMode("b")).toBe("b");
    expect(parseMotionDiagMode("instantFollow")).toBe("c");
  });

  it("normalizeQuat + quatAngularDeltaDeg が非正規化でも正しい角を返す", () => {
    expect(normalizeQuat([0, 0, 0, 2])).toEqual([0, 0, 0, 1]);
    // 90deg about Y（長さ2の非正規化）
    const s = Math.SQRT1_2;
    expect(
      quatAngularDeltaDeg([0, 0, 0, 2], [0, 2 * s, 0, 2 * s]),
    ).toBeCloseTo(90, 4);
  });

  it("旋回検出後は専用配列へ固定し、リング廃棄で欠落しない", () => {
    const diag = new TurnMotionDiagnostics();
    diag.mode = "c";
    const identity: [number, number, number, number] = [0, 0, 0, 1];
    let yaw = 0;
    // 長時間記録しても窓が固定されること（旧Cの55フレーム問題の回帰防止）。
    for (let i = 0; i < 900; i++) {
      const timeMs = i * 16.7;
      const steering = i >= 60 && i < 400 ? 1 : 0;
      if (steering) yaw += 0.02;
      const q: [number, number, number, number] = [
        0,
        Math.sin(yaw / 2),
        0,
        Math.cos(yaw / 2),
      ];
      const pos: [number, number, number] = [i * 0.1, 10, i * 0.2];
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
        vehicleRenderPosition: pos,
        cameraPosition: [pos[0], pos[1] + 5, pos[2] - 8],
        cameraTarget: [...pos],
        cameraQuaternion: identity,
        vehicleScreenXY: [640 + Math.sin(i * 0.2) * (steering ? 20 : 1), 360],
      });
    }
    const dump = diag.dump();
    expect(dump.modeLabel).toContain("Instant camera follow");
    expect(dump.turnStartTimeMs).not.toBeNull();
    expect(dump.windowLocked).toBe(true);
    // 約6秒 @16.7ms ≈ 360。リング廃棄されても十分残る。
    expect(dump.stats.rafCount).toBeGreaterThan(200);
    expect(dump.stats.physicsStepCount).toBeGreaterThan(200);
    expect(dump.turnWindowFrames[0]).toHaveProperty("vehicleScreenDelta");
    expect(dump.verdict).toHaveProperty("cameraFollowLagLikely");
  });
});
