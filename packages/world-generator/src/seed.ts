/** 区切りと型を含む安定した名前空間。旧Generatorのseed派生は互換性のため維持する。 */
export function deriveSeed(
  worldSeed: number,
  namespace: string,
  stableId: string | number = "",
): number {
  let hash = 2166136261;
  for (const char of JSON.stringify([worldSeed, namespace, stableId])) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
export const seedUnit = (
  seed: number,
  namespace: string,
  id: string | number,
) => deriveSeed(seed, namespace, id) / 4294967296;
