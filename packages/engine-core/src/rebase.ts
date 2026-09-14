import type { Vec3 } from "../../project-schema/src/index";
import type { RapierPhysics } from "../../physics-rapier/src/index";
import type {
  OriginRebasePlan,
  WorldRuntime,
} from "../../world-system/src/index";
import type { RebaseTimingBreakdown } from "./spike-diagnostics";

export type OriginShiftRenderer = {
  shiftOrigin(delta: Vec3): void;
  lastRebaseBreakdown?: { chunkCount: number; lodBatchCount: number };
};

let lastOriginShiftTiming: RebaseTimingBreakdown | undefined;

export function takeLastOriginShiftTiming():
  | RebaseTimingBreakdown
  | undefined {
  const timing = lastOriginShiftTiming;
  lastOriginShiftTiming = undefined;
  return timing;
}

export function peekLastOriginShiftTiming():
  | RebaseTimingBreakdown
  | undefined {
  return lastOriginShiftTiming;
}

export function commitWorldOriginShift(
  runtime: WorldRuntime,
  physics: RapierPhysics,
  renderer: OriginShiftRenderer | undefined,
  focusGlobal: Vec3,
): OriginRebasePlan | undefined {
  const plan = runtime.planRebase(focusGlobal);
  if (!plan) return undefined;
  const totalStarted = performance.now();
  const physicsStarted = performance.now();
  physics.shiftOrigin(plan.delta);
  const physicsRebaseMs = performance.now() - physicsStarted;
  const rendererStarted = performance.now();
  renderer?.shiftOrigin(plan.delta);
  const rendererRebaseMs = performance.now() - rendererStarted;
  const commitStarted = performance.now();
  runtime.commitRebase(plan);
  const runtimeCommitRebaseMs = performance.now() - commitStarted;
  const telemetryStarted = performance.now();
  physics.syncOriginTelemetry();
  const telemetrySyncMs = performance.now() - telemetryStarted;
  const physicsBreakdown = physics.lastRebaseBreakdown;
  const rendererBreakdown = renderer?.lastRebaseBreakdown ?? {
    chunkCount: 0,
    lodBatchCount: 0,
  };
  lastOriginShiftTiming = {
    rebaseTotalMs: performance.now() - totalStarted,
    physicsRebaseMs,
    rendererRebaseMs,
    runtimeCommitRebaseMs,
    telemetrySyncMs,
    physics: { ...physicsBreakdown },
    renderer: { ...rendererBreakdown },
    rebaseCountAfter: runtime.rebaseCount,
    positionZ: focusGlobal[2],
    timeMs: totalStarted,
  };
  return plan;
}
