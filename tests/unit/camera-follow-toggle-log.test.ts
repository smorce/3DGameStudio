import { describe, expect, it } from "vitest";
import { CameraFollowToggleLog } from "../../packages/engine-core/src/camera-follow-toggle-log";

describe("camera-follow-toggle-log", () => {
  it("約3秒で mode が切り替わり、指標を記録する", () => {
    const log = new CameraFollowToggleLog();
    log.enabled = true;
    log.autoToggleMs = 3000;
    let t = 1000;
    for (let i = 0; i < 400; i++) {
      t += 16.7;
      log.maybeAutoToggle(t);
      const mode = log.mode;
      const lag = mode === "damped" ? 2 + (i % 5) * 0.5 : 0.01;
      const screen = mode === "damped" ? 5 + (i % 7) : 0.2;
      log.record({
        timeMs: t,
        rafMs: 16.7,
        physicsStepsThisFrame: 1,
        interpolationAlpha: 0.5,
        vehicleRenderPosition: [i, 0, 0],
        cameraTarget: [i - lag, 0, 0],
        vehicleScreenXY: [100 + screen, 200],
      });
    }
    const dump = log.dump();
    expect(dump.toggleCount).toBeGreaterThan(1);
    expect(dump.byMode.damped.sampleCount).toBeGreaterThan(50);
    expect(dump.byMode.instant.sampleCount).toBeGreaterThan(50);
    expect(dump.byMode.damped.vehicleToTargetDistanceP95).toBeGreaterThan(
      dump.byMode.instant.vehicleToTargetDistanceP95,
    );
    expect(dump.samples[0]).toMatchObject({
      mode: expect.stringMatching(/damped|instant/),
      vehicleToTargetDistance: expect.any(Number),
      vehicleScreenDelta: expect.any(Number),
      physicsStepsThisFrame: 1,
      interpolationAlpha: 0.5,
    });
  });
});
