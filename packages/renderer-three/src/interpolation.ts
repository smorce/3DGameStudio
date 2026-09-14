import { lerp, slerp } from "../../machine-system/src/math";
import type {
  PhysicsRenderState,
  Pose,
  WheelRenderState,
} from "../../physics-rapier/src/index";

export function interpolatePose(
  previous: Pose,
  current: Pose,
  alpha: number,
  options?: { disableRotationInterpolation?: boolean },
): Pose {
  return {
    position: lerp(previous.position, current.position, alpha),
    rotation: options?.disableRotationInterpolation
      ? ([...current.rotation] as Pose["rotation"])
      : slerp(previous.rotation, current.rotation, alpha),
  };
}

export function interpolatePhysicsRenderState(
  previous: PhysicsRenderState,
  current: PhysicsRenderState,
  alpha: number,
  options?: { disableRotationInterpolation?: boolean },
): PhysicsRenderState {
  const poses = new Map<string, Pose>();
  for (const [id, pose] of current.poses) {
    const before = previous.poses.get(id);
    poses.set(
      id,
      before ? interpolatePose(before, pose, alpha, options) : pose,
    );
  }
  const wheels = new Map<string, WheelRenderState>();
  for (const [id, wheel] of current.wheels) {
    const before = previous.wheels.get(id);
    wheels.set(
      id,
      before
        ? {
            ...wheel,
            pose: interpolatePose(before.pose, wheel.pose, alpha, options),
            suspensionLengthM:
              before.suspensionLengthM +
              (wheel.suspensionLengthM - before.suspensionLengthM) * alpha,
          }
        : wheel,
    );
  }
  return { poses, wheels };
}
