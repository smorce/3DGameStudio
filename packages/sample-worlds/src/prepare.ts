import { sampleWorldCatalog } from "./builders";
import {
  DummyAssetRequirementPlanner,
  type AssetRequirement,
  type AssetRequirementPlan,
} from "../../asset-factory/src/planner";
/** オフライン準備用。ブラウザーのCatalogからはimportしない。 */
export async function planSampleWorldAssets(): Promise<AssetRequirementPlan> {
  const union = new Map<string, AssetRequirement>();
  for (const descriptor of sampleWorldCatalog) {
    const source = descriptor.buildProject().world.source;
    if (source.kind !== "procedural" || !source.design) continue;
    const plan = await new DummyAssetRequirementPlanner().plan(source.design);
    for (const requirement of plan.requirements) {
      const previous = union.get(requirement.assetSlot);
      union.set(requirement.assetSlot, {
        ...requirement,
        minVariants: Math.max(
          previous?.minVariants ?? 0,
          requirement.minVariants,
        ),
        biomes: [
          ...new Set([...(previous?.biomes ?? []), ...requirement.biomes]),
        ].sort(),
      });
    }
  }
  return {
    planner: "sample-world-union",
    requirements: [...union.values()].sort((a, b) =>
      a.assetSlot.localeCompare(b.assetSlot),
    ),
  };
}
