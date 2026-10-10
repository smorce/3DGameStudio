import type { GeneratorInput, GeneratedEntity } from "./types";
import type { SemanticLayers } from "./semantic";
import { isAlpineVillage } from "./alpine-farmland";
import { settlementEntities } from "./settlement-generation";

/** 絶対座標の所有Chunkだけで景観樹木を生成し、描画と静的Colliderで共有する。 */
export function alpineEnvironmentAccentEntities(
  input: GeneratorInput,
  getLayers: () => SemanticLayers,
): GeneratedEntity[] {
  if (!input.design || !isAlpineVillage(input.design)) return [];
  const { chunkX: cx, chunkZ: cz, chunkSize } = input;
  const locations = [
    [-8, -88],
    [30, -25],
  ];
  if (
    !locations.some(
      ([x, z]) =>
        Math.floor(x / chunkSize) === cx && Math.floor(z / chunkSize) === cz,
    )
  )
    return [];
  const layers = getLayers();
  const buildings = settlementEntities(input, layers);
  return locations.flatMap(([x, z], i) => {
    const settlementId = input.design!.settlements.find(
      (s) => Math.hypot(x - s.center[0], z - s.center[2]) <= s.radius,
    )?.id;
    if (
      Math.floor(x / chunkSize) !== cx ||
      Math.floor(z / chunkSize) !== cz ||
      layers.sampleNoSpawnMask(x, z, settlementId) ||
      layers.sampleRoadInfluence(x, z, true).distance < 5 ||
      buildings.some(
        (b) => Math.hypot(x - b.position[0], z - b.position[2]) < 9,
      )
    )
      return [];
    return [
      {
        id: `environment-accent-oak-${i}`,
        name: "景観用の広葉樹",
        kind: "tree" as const,
        settlementId,
        assetSlot: "nature.tree.quality.oak",
        position: [x, layers.sampleHeight(x, z), z],
        rotation: [0, i * 1.7, 0],
        scale: [1.3, 1.3, 1.3],
      },
    ];
  });
}
