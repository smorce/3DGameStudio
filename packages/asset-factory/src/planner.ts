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
          ...new Set(
            design.islands.flatMap((i) =>
              i.propRules
                .filter((r) => r.assetSlot === assetSlot)
                .map((r) => r.biome),
            ),
          ),
        ].sort(),
        style: "stylized-low-poly",
      })),
    };
  }
}
