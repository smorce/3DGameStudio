import type { Vec3 } from "../../project-schema/src/index";

export interface WaterSurface {
  enabled: boolean;
  height: number;
}
export function submergedDepth(surface: WaterSurface, y: number) {
  return surface.enabled ? Math.max(0, surface.height - y) : 0;
}

export const WATER_DENSITY = 1000;
export const WATER_LINEAR_DRAG = 80;
export const WATER_VERTICAL_DRAG = 1500;

export interface BoxBuoyancyInput {
  waterHeight: number;
  center: Vec3;
  size: Vec3;
  axes: {
    x: Vec3;
    y: Vec3;
    z: Vec3;
  };
  fluidDensity?: number;
  gravity: number;
}

export interface BoxBuoyancyResult {
  submergedFraction: number;
  displacedVolume: number;
  force: Vec3;
  applicationPoint: Vec3;
  verticalHalfExtent: number;
  bottomY: number;
  topY: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const finite = (value: number, fallback = 0) =>
  Number.isFinite(value) ? value : fallback;

const finiteVec3 = (value: Vec3): Vec3 =>
  value.map((component) => finite(component)) as Vec3;

export function computeBoxBuoyancy(input: BoxBuoyancyInput): BoxBuoyancyResult {
  const center = finiteVec3(input.center),
    size = input.size.map((value) => Math.max(0, finite(value))) as Vec3,
    axes = {
      x: finiteVec3(input.axes.x),
      y: finiteVec3(input.axes.y),
      z: finiteVec3(input.axes.z),
    },
    verticalHalfExtent =
      0.5 *
      (Math.abs(axes.x[1]) * size[0] +
        Math.abs(axes.y[1]) * size[1] +
        Math.abs(axes.z[1]) * size[2]),
    bottomY = center[1] - verticalHalfExtent,
    topY = center[1] + verticalHalfExtent,
    height = Math.max(topY - bottomY, Number.EPSILON),
    submergedDepth = clamp(finite(input.waterHeight) - bottomY, 0, height),
    submergedFraction = clamp(submergedDepth / height, 0, 1),
    displacedVolume = size[0] * size[1] * size[2] * submergedFraction,
    density = Math.max(
      0,
      finite(input.fluidDensity ?? WATER_DENSITY, WATER_DENSITY),
    ),
    gravity = Math.abs(finite(input.gravity)),
    forceMagnitude = density * gravity * displacedVolume,
    applicationPoint: Vec3 = [
      center[0],
      bottomY + submergedDepth / 2,
      center[2],
    ];
  return {
    submergedFraction,
    displacedVolume,
    force: [0, forceMagnitude, 0],
    applicationPoint,
    verticalHalfExtent,
    bottomY,
    topY,
  };
}
