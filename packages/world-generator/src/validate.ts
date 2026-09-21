import { settlementEntities } from "./settlement-generation";
import type { Project, World } from "../../project-schema/src/index";
import type { GeneratedEntity } from "./types";
import { SemanticLayers } from "./semantic";
export interface WorldValidationIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  subject?: string;
}
export interface WorldValidationOptions {
  spawnSurface?: "land" | "water";
  entities?: GeneratedEntity[];
  courses?: Project["courses"];
  canResolve?: (slot: string, biome?: string) => boolean;
}
/** 生成と同じSemantic Layersを使用し、修復や外部取得は行わない。 */
export function validateWorld(
  world: World,
  options: WorldValidationOptions = {},
): WorldValidationIssue[] {
  if (world.source.kind !== "procedural" || !world.source.design)
    return [
      {
        severity: "info",
        code: "legacy-world",
        message: "World Design validation is not applicable",
      },
    ];
  const layers = new SemanticLayers(world.source.design, world.source.seed),
    issues: WorldValidationIssue[] = [];
  const add = (
    severity: WorldValidationIssue["severity"],
    code: string,
    message: string,
    subject?: string,
  ) => issues.push({ severity, code, message, subject });
  const sea = world.water.enabled ? world.water.height : -Infinity;
  world.spawnPoints.forEach((p, i) => {
    if (
      p[1] <= sea ||
      (options.spawnSurface !== "water" &&
        layers.sampleHeight(p[0], p[2]) <= sea)
    )
      add("error", "spawn-water", "Spawn point is underwater", String(i));
    if (p[1] < layers.sampleHeight(p[0], p[2]))
      add(
        "error",
        "spawn-underground",
        "Spawn point is below terrain",
        String(i),
      );
  });
  for (const { road, points } of layers.roads)
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i];
      if (
        Math.abs(
          layers.sampleHeight(b[0], b[2]) - layers.sampleHeight(a[0], a[2]),
        ) /
          (Math.hypot(b[0] - a[0], b[2] - a[2]) || 1) >
        0.35
      ) {
        add("warning", "road-slope", "Road grade exceeds 35 percent", road.id);
        break;
      }
    }
  for (const island of layers.design.islands) {
    let land = false;
    for (let z = -4; z <= 4; z++)
      for (let x = -4; x <= 4; x++)
        if (
          layers.sampleHeight(
            island.center[0] + (x * island.radius) / 4,
            island.center[2] + (z * island.radius) / 4,
          ) > sea
        )
          land = true;
    if (!land)
      add("error", "island-no-land", "Island has no valid land", island.id);
  }
  for (const l of layers.design.landmarks) {
    const y =
      l.position[1] +
      (l.snapToTerrain ? layers.sampleHeight(l.position[0], l.position[2]) : 0);
    if (y <= sea)
      add("error", "landmark-water", "Landmark is underwater", l.id);
  }
  for (const e of options.entities ?? []) {
    if (!e.position.every(Number.isFinite))
      add("error", "prop-position", "Prop position is not finite", e.id);
    if (
      world.spawnPoints.some(
        (p) => Math.hypot(p[0] - e.position[0], p[2] - e.position[2]) < 3,
      )
    )
      add("error", "spawn-prop", "Prop overlaps spawn clearance", e.id);
    if (!e.landmark) {
      const [x, y, z] = e.position;
      if (layers.sampleRoadInfluence(x, z, true).distance < 0)
        add("error", "prop-road", "Prop intersects road", e.id);
      if (layers.sampleRunwayMask(x, z))
        add("error", "prop-runway", "Prop intersects runway", e.id);
      if (layers.sampleNoSpawnMask(x, z, e.settlementId))
        add("error", "prop-no-spawn", "Prop intersects no-spawn region", e.id);
      if (y <= sea && e.assetSlot?.includes("tree"))
        add("error", "tree-water", "Tree is underwater", e.id);
    }
  }
  // 部分Chunkの観測だけでも、町全体の配置可能数を同じ生成器で検査する。
  const buildings = settlementEntities(
    { ...world.source, chunkX: 0, chunkZ: 0 },
    layers,
  );
  for (const settlement of layers.design.settlements)
    settlement.buildingRules.forEach((rule, index) => {
      const count = buildings.filter(
        (e) =>
          e.settlementId === settlement.id && e.settlementRuleIndex === index,
      ).length;
      if (count !== rule.count)
        add(
          "error",
          "settlement-building-count",
          `Settlement requires ${rule.count} buildings but has ${count}`,
          `${settlement.id}:${index}`,
        );
    });
  const requirements = [
    ...layers.design.islands.flatMap((i) =>
      i.propRules.map((r) => ({ slot: r.assetSlot, biome: r.biome })),
    ),
    ...layers.design.landmarks.map((l) => ({
      slot: l.assetSlot,
      biome: layers.sampleBiome(l.position[0], l.position[2]),
    })),
    ...layers.design.settlements.flatMap((s) =>
      s.buildingRules.map((r) => ({
        slot: r.assetSlot,
        biome: layers.sampleBiome(s.center[0], s.center[2]),
      })),
    ),
  ];
  const checked = new Set<string>();
  for (const { slot, biome } of requirements) {
    const key = `${slot}:${biome}`;
    if (checked.has(key)) continue;
    checked.add(key);
    if (!options.canResolve?.(slot, biome))
      add(
        "error",
        "missing-asset",
        "Required asset slot cannot be resolved",
        slot,
      );
  }
  for (const course of options.courses ?? [])
    for (const checkpoint of [
      ...course.checkpoints,
      { id: `${course.id}:start`, position: course.start },
      { id: `${course.id}:goal`, position: course.goal },
      ...course.respawnPoints.map((position, index) => ({
        id: `${course.id}:respawn:${index}`,
        position,
      })),
    ]) {
      const [x, y, z] = checkpoint.position;
      if (
        !checkpoint.position.every(Number.isFinite) ||
        y <= sea ||
        y < layers.sampleHeight(x, z)
      )
        add(
          "error",
          "checkpoint-position",
          "Course checkpoint has an invalid position",
          checkpoint.id,
        );
    }
  if (!options.entities?.length)
    add(
      "info",
      "props-not-sampled",
      "No generated props were supplied for validation",
    );
  if (!issues.some((i) => i.severity === "error"))
    add("info", "world-valid", "World validation passed");
  return issues;
}
