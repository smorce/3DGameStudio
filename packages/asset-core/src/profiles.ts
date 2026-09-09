export const runtimeProfiles = {
  quality: {
    textureDimension: 4096,
    textureQuality: 95,
    ratios: [0.6, 0.25],
    loadedAssetBytes: 512 * 1048576,
    textureBytes: 1024 * 1048576,
    triangles: 2000000,
    drawCalls: 1500,
  },
  balanced: {
    textureDimension: 2048,
    textureQuality: 85,
    ratios: [0.45, 0.12],
    loadedAssetBytes: 256 * 1048576,
    textureBytes: 512 * 1048576,
    triangles: 1000000,
    drawCalls: 750,
  },
  performance: {
    textureDimension: 1024,
    textureQuality: 75,
    ratios: [0.3, 0.08],
    loadedAssetBytes: 128 * 1048576,
    textureBytes: 256 * 1048576,
    triangles: 500000,
    drawCalls: 400,
  },
} as const;
export type RuntimeProfile = keyof typeof runtimeProfiles;
export function evaluateRuntimeBudget(
  profile: RuntimeProfile,
  usage: {
    loadedAssetBytes: number;
    textureBytes: number;
    triangles: number;
    drawCalls: number;
  },
) {
  const budget = runtimeProfiles[profile];
  return (Object.keys(usage) as (keyof typeof usage)[]).filter(
    (key) => usage[key] > budget[key],
  );
}
