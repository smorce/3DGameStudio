import type { Project, Vec3 } from "../../project-schema/src/index";
export const chunkCoordinate = (p: Vec3, size: number) => [
  Math.floor(p[0] / size),
  Math.floor(p[2] / size),
];
export function visibleChunks(position: Vec3, size: number, radius = 2) {
  const [x, z] = chunkCoordinate(position, size);
  const result = new Set<string>();
  for (let i = x - radius; i <= x + radius; i++)
    for (let j = z - radius; j <= z + radius; j++) result.add(`${i},${j}`);
  return result;
}
export function groupInstances(project: Project) {
  const groups = new Map<string, Project["world"]["entities"]>();
  for (const e of project.world.entities) {
    const key = `${chunkCoordinate(e.transform.position, project.world.chunkSize)}:${e.assetId ?? e.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return groups;
}
