import type { Vec3 } from "../../project-schema/src/index";
import type { RapierPhysics } from "../../physics-rapier/src/index";
import type {
  OriginRebasePlan,
  WorldRuntime,
} from "../../world-system/src/index";

export function commitWorldOriginShift(
  runtime: WorldRuntime,
  physics: RapierPhysics,
  renderer: { shiftOrigin(delta: Vec3): void } | undefined,
  focusGlobal: Vec3,
): OriginRebasePlan | undefined {
  const plan = runtime.planRebase(focusGlobal);
  if (!plan) return undefined;
  physics.shiftOrigin(plan.delta);
  renderer?.shiftOrigin(plan.delta);
  runtime.commitRebase(plan);
  return plan;
}
