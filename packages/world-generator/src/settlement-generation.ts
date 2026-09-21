import type { GeneratedEntity, GeneratorInput } from "./types";
import type { SemanticLayers } from "./semantic";
import { deriveSeed, seedUnit } from "./seed";

interface BuildingPlacement {
  x: number;
  z: number;
  spacing: number;
  entity: GeneratedEntity;
}
const layouts = new WeakMap<SemanticLayers, Map<number, GeneratedEntity[]>>();

/** 町全体で配置を決めてからChunkで切り出すため、読込順や境界で建物数が変わらない。 */
export function settlementEntities(
  input: GeneratorInput,
  layers: SemanticLayers,
) {
  let versions = layouts.get(layers);
  if (!versions) {
    versions = new Map();
    layouts.set(layers, versions);
  }
  const cached = versions.get(input.generatorVersion);
  if (cached) return cached;
  const placed: BuildingPlacement[] = [];
  for (const settlement of [...layers.design.settlements].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    settlement.buildingRules.forEach((rule, ruleIndex) => {
      const key = `${settlement.id}:${rule.assetSlot}:${ruleIndex}`;
      const seed = deriveSeed(input.seed, "settlement", key);
      const cell = rule.minSpacing * 1.1;
      const radius = Math.ceil(settlement.radius / cell);
      // 異常に広い・密なRuleによる無制限な探索を防ぐ。不足はValidatorでエラーにする。
      if ((radius * 2 + 1) ** 2 > 100000) return;
      const candidates: {
        x: number;
        z: number;
        id: string;
        priority: number;
      }[] = [];
      for (let cz = -radius; cz <= radius; cz++)
        for (let cx = -radius; cx <= radius; cx++) {
          const id = `${key}:${cx}:${cz}`;
          const x =
            settlement.center[0] +
            (cx + (seedUnit(seed, "x", id) - 0.5) * 0.08) * cell;
          const z =
            settlement.center[2] +
            (cz + (seedUnit(seed, "z", id) - 0.5) * 0.08) * cell;
          if (
            Math.hypot(x - settlement.center[0], z - settlement.center[2]) >
              settlement.radius ||
            layers.sampleNoSpawnMask(x, z, settlement.id) ||
            layers.sampleHeight(x, z) <= 0.1 ||
            layers.sampleSlope(x, z) > 10 ||
            layers.sampleRoadInfluence(x, z).distance <
              (rule.minDistanceFromRoad ?? rule.minSpacing / 2) ||
            layers.landmarkDistance(x, z) < rule.minSpacing
          )
            continue;
          candidates.push({
            x,
            z,
            id,
            priority: seedUnit(seed, "priority", id),
          });
        }
      candidates.sort(
        (a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1),
      );
      let count = 0;
      for (const p of candidates) {
        if (count >= rule.count) break;
        if (
          placed.some(
            (other) =>
              Math.hypot(other.x - p.x, other.z - p.z) <
              Math.max(other.spacing, rule.minSpacing),
          )
        )
          continue;
        const range = rule.scaleRange ?? [1, 1];
        const scale =
          range[0] + seedUnit(seed, "scale", p.id) * (range[1] - range[0]);
        placed.push({
          x: p.x,
          z: p.z,
          spacing: rule.minSpacing,
          entity: {
            id: `gen:${input.generatorVersion}:${input.seed}:settlement:${p.id}`,
            name: `${settlement.id}:${rule.assetSlot}`,
            kind: "building",
            assetSlot: rule.assetSlot,
            biome: layers.sampleBiome(p.x, p.z),
            settlementId: settlement.id,
            settlementRuleIndex: ruleIndex,
            position: [p.x, layers.sampleHeight(p.x, p.z), p.z],
            rotation: [
              0,
              rule.rotationMode === "none"
                ? 0
                : seedUnit(seed, "rotation", p.id) * Math.PI * 2,
              0,
            ],
            scale: [scale, scale, scale],
          },
        });
        count++;
      }
    });
  }
  const result = placed.map((p) => p.entity);
  versions.set(input.generatorVersion, result);
  return result;
}
