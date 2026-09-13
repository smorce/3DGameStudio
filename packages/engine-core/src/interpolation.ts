import type { Vec3 } from "../../project-schema/src/index";
import type {
  PhysicsRenderState,
  Pose,
  WheelRenderState,
} from "../../physics-rapier/src/index";

export function shiftPose(pose: Pose, delta: Vec3): Pose {
  return {
    position: [
      pose.position[0] - delta[0],
      pose.position[1] - delta[1],
      pose.position[2] - delta[2],
    ],
    rotation: pose.rotation,
  };
}

export function shiftPhysicsRenderState(
  state: PhysicsRenderState,
  delta: Vec3,
): PhysicsRenderState {
  const poses = new Map<string, Pose>();
  for (const [id, pose] of state.poses) poses.set(id, shiftPose(pose, delta));
  const wheels = new Map<string, WheelRenderState>();
  for (const [id, wheel] of state.wheels)
    wheels.set(id, { ...wheel, pose: shiftPose(wheel.pose, delta) });
  return { poses, wheels };
}
