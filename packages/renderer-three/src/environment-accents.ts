import type { AssetRecord, WorldDesign } from "../../project-schema/src/index";
import type { GeneratedEntity } from "../../world-generator/src/types";
import { semanticContext } from "../../world-generator/src/design-generation";
import { settlementEntities } from "../../world-generator/src/settlement-generation";

/** 代表住宅と広場の2本だけを描画へ加える。物理Worldへは渡さない。 */
export function alpineEnvironmentAccents(
  design: WorldDesign,
  seed: number,
  assets: AssetRecord[],
  key: string,
  chunkSize: number,
): GeneratedEntity[] {
  const asset = assets.find((a) =>
    a.catalog?.slots.includes("nature.tree.quality.oak"),
  );
  if (!asset) return [];
  const layers = semanticContext(design, seed);
  const buildings = settlementEntities(
    {
      seed,
      generatorVersion: 2,
      preset: "designed-world",
      chunkX: 0,
      chunkZ: 0,
      chunkSize,
      chunkResolution: 17,
      design,
    },
    layers,
  );
  const [cx, cz] = key.split(",").map(Number);
  return [
    [-8, -88],
    [30, -25],
  ].flatMap(([x, z], i) => {
    if (
      Math.floor(x / chunkSize) !== cx ||
      Math.floor(z / chunkSize) !== cz ||
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
        assetId: asset.id,
        assetSlot: "nature.tree.quality.oak",
        position: [x, layers.sampleHeight(x, z), z],
        rotation: [0, i * 1.7, 0],
        scale: [1.3, 1.3, 1.3],
      },
    ];
  });
}
