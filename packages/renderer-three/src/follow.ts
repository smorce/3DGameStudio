import type { Vec3 } from "../../project-schema/src/index";

/** 60fpsで旧lerp(0.08)に近い時定数。1-exp(-5/60) ≈ 0.08。 */
export const CAMERA_FOLLOW_LAMBDA = 5;
/** Player周辺のShadow Frustum半幅。巨大化して誤魔化さない。 */
export const SHADOW_EXTENT_M = 48;
export const SHADOW_LIGHT_DISTANCE_M = 40;

export function cameraFollowAlpha(dt: number, lambda = CAMERA_FOLLOW_LAMBDA) {
  return 1 - Math.exp(-lambda * Math.max(0, dt));
}

export function sunDirectionFromTimeOfDay(timeOfDay: number): Vec3 {
  const angle = ((timeOfDay - 6) / 12) * Math.PI;
  const raw: Vec3 = [
    Math.cos(angle) * 25,
    Math.max(2, Math.sin(angle) * 25),
    8,
  ];
  const length = Math.hypot(...raw) || 1;
  return [raw[0] / length, raw[1] / length, raw[2] / length];
}

export function sunFollowPose(
  focus: Vec3,
  timeOfDay: number,
  distance = SHADOW_LIGHT_DISTANCE_M,
) {
  const direction = sunDirectionFromTimeOfDay(timeOfDay);
  return {
    position: [
      focus[0] + direction[0] * distance,
      focus[1] + direction[1] * distance,
      focus[2] + direction[2] * distance,
    ] as Vec3,
    target: [...focus] as Vec3,
    direction,
  };
}
