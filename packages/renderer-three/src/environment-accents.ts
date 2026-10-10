import type { AssetRecord, WorldDesign } from "../../project-schema/src/index";
import { semanticContext } from "../../world-generator/src/design-generation";
import { alpineEnvironmentAccentEntities } from "../../world-generator/src/environment-accents";

/** 配置確認用の互換関数。実描画はWorld GeneratorのEntityだけを使用する。 */
export function alpineEnvironmentAccents(
  design: WorldDesign,
  seed: number,
  assets: AssetRecord[],
  key: string,
  chunkSize: number,
) {
  const asset = assets.find((a) =>
    a.catalog?.slots.includes("nature.tree.quality.oak"),
  );
  if (!asset) return [];
  const [chunkX, chunkZ] = key.split(",").map(Number);
  return alpineEnvironmentAccentEntities(
    {
      seed,
      generatorVersion: 2,
      preset: "designed-world",
      chunkX,
      chunkZ,
      chunkSize,
      chunkResolution: 17,
      design,
    },
    () => semanticContext(design, seed),
  ).map((e) => ({ ...e, assetId: asset.id }));
}
