export const EFFECT_CONFIG = {
  vapor: {
    minSpeed: 18,
    maxSpeed: 35,
    rate: 200,
    lifetime: 0.65,
    size: 0.34,
    opacity: 0.22,
  },
  contact: { minSpeed: 5, maxSpeed: 30, rate: 16 },
  wash: {
    minThrust: 0.15,
    distance: 3.5,
    interval: 1 / 12,
    rayBudget: 4,
    rate: 24,
  },
  smoke: {
    lifetime: 1.1,
    size: 0.55,
    opacity: 0.1,
    rise: 0.35,
    spread: 1.0,
    growth: 1.5,
    groundOffset: 0.08,
  },
  flame: { flicker: 0.07, frequency: 24, tailOpacity: 0.24, bodyOpacity: 0.6 },
  maxDt: 0.05,
} as const;
export const EFFECT_CAPACITY = {
  quality: [512, 384],
  balanced: [256, 192],
  performance: [128, 96],
} as const;
export type EffectQuality = keyof typeof EFFECT_CAPACITY;
const ramp = (value: number, min: number, max: number) =>
  Number.isFinite(value)
    ? Math.max(0, Math.min(1, (value - min) / (max - min)))
    : 0;
export const vaporEmission = (speed: number) =>
  EFFECT_CONFIG.vapor.rate *
  ramp(speed, EFFECT_CONFIG.vapor.minSpeed, EFFECT_CONFIG.vapor.maxSpeed);
export const contactEmission = (speed: number, inContact: boolean) =>
  inContact
    ? EFFECT_CONFIG.contact.rate *
      ramp(
        speed,
        EFFECT_CONFIG.contact.minSpeed,
        EFFECT_CONFIG.contact.maxSpeed,
      )
    : 0;
export const washEmission = (thrust: number, hit: boolean) =>
  hit && Math.abs(thrust) > EFFECT_CONFIG.wash.minThrust
    ? EFFECT_CONFIG.wash.rate * Math.min(1, Math.abs(thrust))
    : 0;
