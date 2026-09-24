import {
  worldChunkSize,
  type EnvironmentPreset,
  type Project,
} from "../../project-schema/src/index";
import { createProceduralWorld } from "../../world-generator/src/index";
import { chunkCoordinate } from "./chunks";
export function groupInstances(project: Project) {
  const groups = new Map<string, Project["world"]["entities"]>();
  for (const e of project.world.entities) {
    const key = `${chunkCoordinate(e.transform.position, worldChunkSize(project.world))}:${e.assetId ?? e.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return groups;
}

export function createStarterWorld(options: {
  preset: EnvironmentPreset;
  seed?: number;
}) {
  return createProceduralWorld(options);
}

/** @deprecated createStarterWorld({ preset: "airfield" }) を使う。 */
export function starterPlaneWorldPatch(world: Project["world"]) {
  return createStarterWorld({
    preset: "airfield",
    seed: world.terrain.seed,
  });
}

/** @deprecated createStarterWorld({ preset: "grassland" }) を使う。 */
export function starterWorldPatch(world: Project["world"]) {
  return createStarterWorld({
    preset: "grassland",
    seed: world.terrain.seed,
  });
}

export * from "./chunks";
export * from "./chunk-worker-pool";
export * from "./coordinates";
export * from "./edits";
export * from "./entities";
export * from "./runtime";
export * from "./streaming";
