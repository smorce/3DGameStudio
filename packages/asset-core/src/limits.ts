export function assetLimits(env: NodeJS.ProcessEnv = process.env) {
  const value = (name: string, fallback: number) => {
    const n = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isFinite(n) || n <= 0)
      throw new Error(`Invalid asset limit: ${name}`);
    return n;
  };
  return {
    sourceBytes: Math.floor(value("ASSET_MAX_SOURCE_MB", 128) * 1048576),
    aggregateBytes: Math.floor(value("ASSET_MAX_AGGREGATE_MB", 512) * 1048576),
    textureDimension: Math.floor(value("ASSET_MAX_TEXTURE_DIMENSION", 8192)),
    triangles: Math.floor(value("ASSET_MAX_TRIANGLES", 2000000)),
    storageBytes: Math.floor(value("ASSET_STORAGE_BUDGET_MB", 4096) * 1048576),
  };
}
