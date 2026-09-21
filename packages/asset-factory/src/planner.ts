import { SemanticLayers } from "../../world-generator/src/semantic";
import type { WorldDesign } from "../../project-schema/src/index";
export interface AssetRequirement {
  assetSlot: string;
  minVariants: number;
  biomes: string[];
  style: string;
}
export interface AssetRequirementPlan {
  planner: string;
  requirements: AssetRequirement[];
}
export interface AssetRequirementPlanner {
  plan(worldDesign: WorldDesign): Promise<AssetRequirementPlan>;
}
export function requiredSlots(design: WorldDesign) {
  return [
    ...new Set([
      ...design.islands.flatMap((i) => i.propRules.map((r) => r.assetSlot)),
      ...design.landmarks.map((l) => l.assetSlot),
      ...design.settlements.flatMap((s) =>
        s.buildingRules.map((r) => r.assetSlot),
      ),
    ]),
  ].sort();
}
export class DummyAssetRequirementPlanner implements AssetRequirementPlanner {
  async plan(design: WorldDesign): Promise<AssetRequirementPlan> {
    const layers = new SemanticLayers(design, 0);
    return {
      planner: "dummy",
      requirements: requiredSlots(design).map((assetSlot) => ({
        assetSlot,
        minVariants: assetSlot.startsWith("nature.tree.")
          ? 5
          : assetSlot.startsWith("nature.rock.")
            ? 4
            : assetSlot.startsWith("building.") ||
                assetSlot === "course.jump_ramp"
              ? 3
              : 1,
        biomes: [
          ...new Set([
            ...design.landmarks
              .filter((l) => l.assetSlot === assetSlot)
              .map((l) => layers.sampleBiome(l.position[0], l.position[2])),
            ...design.settlements
              .filter((s) =>
                s.buildingRules.some((r) => r.assetSlot === assetSlot),
              )
              .map((s) => layers.sampleBiome(s.center[0], s.center[2])),
            ...design.islands.flatMap((i) =>
              i.propRules
                .filter((r) => r.assetSlot === assetSlot)
                .map((r) => r.biome),
            ),
          ]),
        ].sort(),
        style: "stylized-low-poly",
      })),
    };
  }
}
