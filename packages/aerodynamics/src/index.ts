import type { Vec3 } from "../../project-schema/src/index";

export const AIR_DENSITY = 1.225;
export const PANEL_CL_MAX = 1.1;
export const PANEL_CD_MIN = 0.03;
export const PANEL_CD_ANGLE = 1.25;
export const PANEL_MAX_FORCE = 2500;
const SPEED_EPSILON = 1e-5;

export interface PanelAerodynamicsInput {
  center: Vec3;
  normal: Vec3;
  velocity: Vec3;
  windVelocity: Vec3;
  area: number;
  airDensity?: number;
}

export interface PanelAerodynamicsResult {
  force: Vec3;
  lift: Vec3;
  drag: Vec3;
  appliedLift: Vec3;
  appliedDrag: Vec3;
  relativeAirVelocity: Vec3;
  angleOfAttack: number;
  dynamicPressure: number;
  liftCoefficient: number;
  dragCoefficient: number;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
const scale = (a: Vec3, n: number): Vec3 => [a[0] * n, a[1] * n, a[2] * n];
const length = (a: Vec3) => Math.hypot(...a);
const normalize = (a: Vec3): Vec3 => {
  const size = length(a);
  return size > SPEED_EPSILON ? scale(a, 1 / size) : [0, 0, 0];
};
const finiteVec3 = (a: Vec3) => a.every(Number.isFinite);
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

export function computePanelAerodynamicForce(
  input: PanelAerodynamicsInput,
): PanelAerodynamicsResult {
  const relativeAirVelocity = subtract(input.velocity, input.windVelocity);
  const speed = length(relativeAirVelocity);
  const normal = normalize(input.normal);
  if (
    speed <= SPEED_EPSILON ||
    !finiteVec3(relativeAirVelocity) ||
    length(normal) <= SPEED_EPSILON
  ) {
    return {
      force: [0, 0, 0],
      lift: [0, 0, 0],
      drag: [0, 0, 0],
      appliedLift: [0, 0, 0],
      appliedDrag: [0, 0, 0],
      relativeAirVelocity,
      angleOfAttack: 0,
      dynamicPressure: 0,
      liftCoefficient: 0,
      dragCoefficient: 0,
    };
  }

  const flowDirection = scale(relativeAirVelocity, 1 / speed);
  const normalAlongFlow = clamp(dot(normal, flowDirection), -1, 1);
  const projectedNormal = subtract(
    normal,
    scale(flowDirection, normalAlongFlow),
  );
  const projectedLength = length(projectedNormal);
  const angleOfAttack = Math.atan2(normalAlongFlow, projectedLength);
  const dynamicPressure =
    0.5 *
    Math.max(
      0,
      Number.isFinite(input.airDensity ?? AIR_DENSITY)
        ? (input.airDensity ?? AIR_DENSITY)
        : AIR_DENSITY,
    ) *
    speed *
    speed;
  const liftCoefficient = clamp(
    PANEL_CL_MAX * Math.sin(2 * angleOfAttack),
    -PANEL_CL_MAX,
    PANEL_CL_MAX,
  );
  const dragCoefficient = clamp(
    PANEL_CD_MIN + PANEL_CD_ANGLE * normalAlongFlow * normalAlongFlow,
    PANEL_CD_MIN,
    PANEL_CD_MIN + PANEL_CD_ANGLE,
  );
  const liftDirection: Vec3 =
    projectedLength > SPEED_EPSILON
      ? scale(projectedNormal, 1 / projectedLength)
      : [0, 0, 0];
  const lift = scale(
    liftDirection,
    dynamicPressure * Math.max(0, input.area) * liftCoefficient,
  );
  const drag = scale(
    flowDirection,
    -dynamicPressure * Math.max(0, input.area) * dragCoefficient,
  );
  const rawForce = [
    lift[0] + drag[0],
    lift[1] + drag[1],
    lift[2] + drag[2],
  ] as Vec3;
  const forceLength = length(rawForce);
  const rawForceIsFinite = finiteVec3(rawForce),
    forceScale =
      !rawForceIsFinite || !Number.isFinite(forceLength)
        ? 0
        : forceLength > PANEL_MAX_FORCE
          ? PANEL_MAX_FORCE / forceLength
          : 1,
    force = rawForceIsFinite
      ? scale(rawForce, forceScale)
      : ([0, 0, 0] as Vec3);
  return {
    force,
    lift,
    drag,
    appliedLift: rawForceIsFinite
      ? scale(lift, forceScale)
      : ([0, 0, 0] as Vec3),
    appliedDrag: rawForceIsFinite
      ? scale(drag, forceScale)
      : ([0, 0, 0] as Vec3),
    relativeAirVelocity,
    angleOfAttack,
    dynamicPressure,
    liftCoefficient,
    dragCoefficient,
  };
}
