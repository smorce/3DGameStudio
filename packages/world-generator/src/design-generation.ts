import { settlementEntities } from "./settlement-generation";
import type {
  WorldDesign,
  PropRule,
  Vec3,
} from "../../project-schema/src/index";
import type { GeneratedEntity, GeneratorInput } from "./types";
import { SemanticLayers } from "./semantic";
import { deriveSeed, seedUnit } from "./seed";

/** Worker内で同一contextを共有する。永続データは変更せず、寿命はWorld Design参照に従う。 */
const contexts = new WeakMap<WorldDesign, Map<number, SemanticLayers>>();
export function semanticContext(design: WorldDesign, seed: number) {
  let seeds = contexts.get(design);
  if (!seeds) {
    seeds = new Map();
    contexts.set(design, seeds);
  }
  let layers = seeds.get(seed);
  if (!layers) {
    layers = new SemanticLayers(design, seed);
    seeds.set(seed, layers);
  }
  return layers;
}
interface Placement {
  x: number;
  z: number;
  priority: number;
  id: string;
  rule: PropRule;
  islandId: string;
}
export function generateDesignEntities(
  input: GeneratorInput,
  layers: SemanticLayers,
): GeneratedEntity[] {
  const design = layers.design;
  const entries = design.islands.flatMap((island) =>
    island.propRules.map((rule, index) => ({
      rule,
      island,
      key: `${island.id}:${rule.assetSlot}:${index}`,
    })),
  );
  const maxSpacing = Math.max(1, ...entries.map((e) => e.rule.minSpacing));
  const originX = input.chunkX * input.chunkSize,
    originZ = input.chunkZ * input.chunkSize;
  const candidates: Placement[] = [];
  for (const { rule, island, key } of entries) {
    const cell = rule.minSpacing;
    if (
      originX + input.chunkSize + maxSpacing <
        island.center[0] - island.radius ||
      originX - maxSpacing > island.center[0] + island.radius ||
      originZ + input.chunkSize + maxSpacing <
        island.center[2] - island.radius ||
      originZ - maxSpacing > island.center[2] + island.radius
    )
      continue;
    const seed = deriveSeed(input.seed, "prop", key);
    for (
      let cz = Math.floor((originZ - maxSpacing) / cell);
      cz <= Math.floor((originZ + input.chunkSize + maxSpacing) / cell);
      cz++
    ) {
      for (
        let cx = Math.floor((originX - maxSpacing) / cell);
        cx <= Math.floor((originX + input.chunkSize + maxSpacing) / cell);
        cx++
      ) {
        const id = `${key}:${cx}:${cz}`;
        if (seedUnit(seed, "density", id) >= rule.density) continue;
        const x = (cx + seedUnit(seed, "jitter-x", id)) * cell,
          z = (cz + seedUnit(seed, "jitter-z", id)) * cell;
        if (
          layers.islandAt(x, z)?.id !== island.id ||
          layers.sampleBiome(x, z) !== rule.biome ||
          layers.sampleNoSpawnMask(x, z)
        )
          continue;
        const height = layers.sampleHeight(x, z);
        if (
          height < Math.max(0.1, rule.altitudeMin) ||
          height > rule.altitudeMax ||
          layers.sampleSlope(x, z) > rule.slopeMax ||
          layers.waterDistance(x, z) < rule.minDistanceFromWater ||
          layers.sampleRoadInfluence(x, z).distance <
            rule.minDistanceFromRoad ||
          layers.landmarkDistance(x, z) < rule.minDistanceFromLandmark
        )
          continue;
        candidates.push({
          x,
          z,
          priority: seedUnit(seed, "priority", id),
          id,
          rule,
          islandId: island.id,
        });
      }
    }
  }
  const result: GeneratedEntity[] = [];
  for (const p of candidates) {
    if (
      p.x < originX ||
      p.x >= originX + input.chunkSize ||
      p.z < originZ ||
      p.z >= originZ + input.chunkSize
    )
      continue;
    if (
      candidates.some(
        (q) =>
          q !== p &&
          (q.priority < p.priority ||
            (q.priority === p.priority && q.id < p.id)) &&
          Math.hypot(q.x - p.x, q.z - p.z) <
            Math.max(p.rule.minSpacing, q.rule.minSpacing),
      )
    )
      continue;
    const scale =
      p.rule.scaleRange[0] +
      seedUnit(input.seed, "scale", p.id) *
        (p.rule.scaleRange[1] - p.rule.scaleRange[0]);
    result.push({
      id: `gen:${input.generatorVersion}:${input.seed}:prop:${p.id}`,
      name: p.rule.assetSlot,
      assetSlot: p.rule.assetSlot,
      biome: p.rule.biome,
      kind: p.rule.assetSlot.includes("tree")
        ? "tree"
        : p.rule.assetSlot.includes("rock")
          ? "rock"
          : "building",
      position: [p.x, layers.sampleHeight(p.x, p.z), p.z],
      rotation: [
        0,
        p.rule.rotationMode === "yaw"
          ? seedUnit(input.seed, "rotation", p.id) * Math.PI * 2
          : 0,
        0,
      ],
      scale: [scale, scale, scale],
    });
  }
  for (const building of settlementEntities(input, layers)) {
    const [x, , z] = building.position;
    if (
      x >= originX &&
      x < originX + input.chunkSize &&
      z >= originZ &&
      z < originZ + input.chunkSize
    )
      result.push(structuredClone(building));
  }
  for (const l of design.landmarks) {
    const [x, , z] = l.position;
    if (
      x < originX ||
      x >= originX + input.chunkSize ||
      z < originZ ||
      z >= originZ + input.chunkSize
    )
      continue;
    const position: Vec3 = [...l.position];
    if (l.snapToTerrain)
      position[1] = layers.sampleHeight(x, z) + l.position[1];
    result.push({
      id: `gen:${input.generatorVersion}:${input.seed}:landmark:${l.id}`,
      name: l.id,
      assetSlot: l.assetSlot,
      biome: layers.sampleBiome(x, z),
      kind: "building",
      position,
      rotation: l.rotation,
      scale: l.scale,
      landmark: true,
    });
  }
  return result.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
