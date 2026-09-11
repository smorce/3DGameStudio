export const THRUSTER_STEERING_MIX = 0.65;
export const FORWARD_THRUSTER_DOT_THRESHOLD = 0.6;

export interface ThrusterMixerInput {
  throttle: number;
  steering: number;
  lateralOffsets: number[];
  steeringMix?: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function mixThrusterCommands(input: ThrusterMixerInput): number[] {
  const base = clamp(
      Number.isFinite(input.throttle) ? input.throttle : 0,
      -1,
      1,
    ),
    steeringAmount = clamp(
      Number.isFinite(input.steering) ? input.steering : 0,
      -1,
      1,
    ),
    maxLateralOffset = Math.max(
      0,
      ...input.lateralOffsets.map((offset) =>
        Math.abs(Number.isFinite(offset) ? offset : 0),
      ),
    ),
    steeringMix = clamp(
      Number.isFinite(input.steeringMix ?? THRUSTER_STEERING_MIX)
        ? (input.steeringMix ?? THRUSTER_STEERING_MIX)
        : THRUSTER_STEERING_MIX,
      0,
      1,
    );
  if (maxLateralOffset < Number.EPSILON || base === 0)
    return input.lateralOffsets.map(() => base);
  return input.lateralOffsets.map((offset) => {
    const normalizedSide =
      (Number.isFinite(offset) ? offset : 0) / maxLateralOffset;
    return clamp(
      base + steeringAmount * Math.abs(base) * steeringMix * normalizedSide,
      -1,
      1,
    );
  });
}

export function isForwardThruster(
  localDirection: [number, number, number],
  threshold = FORWARD_THRUSTER_DOT_THRESHOLD,
) {
  const length = Math.hypot(...localDirection);
  if (!Number.isFinite(length) || length < Number.EPSILON) return false;
  return localDirection[2] / length > threshold;
}
