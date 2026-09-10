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

type WorldEntity = Project["world"]["entities"][number];
type StarterWorldPatch = Pick<Project["world"], "terrain" | "entities">;

function sampleTerrainHeight(
  t: Project["world"]["terrain"],
  x: number,
  z: number,
) {
  const u = Math.max(
      0,
      Math.min(t.resolution - 1, (x / t.size + 0.5) * (t.resolution - 1)),
    ),
    v = Math.max(
      0,
      Math.min(t.resolution - 1, (z / t.size + 0.5) * (t.resolution - 1)),
    ),
    i = Math.floor(u),
    j = Math.floor(v),
    i1 = Math.min(i + 1, t.resolution - 1),
    j1 = Math.min(j + 1, t.resolution - 1),
    a = u - i,
    b = v - j;
  return (
    (1 - b) *
      ((1 - a) * t.heights[j * t.resolution + i] +
        a * t.heights[j * t.resolution + i1]) +
    b *
      ((1 - a) * t.heights[j1 * t.resolution + i] +
        a * t.heights[j1 * t.resolution + i1])
  );
}

export function starterWorldPatch(world: Project["world"]): StarterWorldPatch {
  const terrain = structuredClone(world.terrain);
  for (let j = 0; j < terrain.resolution; j++)
    for (let i = 0; i < terrain.resolution; i++) {
      const x = (i / (terrain.resolution - 1) - 0.5) * terrain.size,
        z = (j / (terrain.resolution - 1) - 0.5) * terrain.size,
        distance = Math.hypot(x, z),
        edgeFade = Math.min(1, Math.max(0, (distance - 8) / 18)),
        mountainA = 9 * Math.exp(-((x + 28) ** 2 / 180 + (z + 24) ** 2 / 260)),
        mountainB = 7 * Math.exp(-((x - 30) ** 2 / 230 + (z + 14) ** 2 / 320)),
        mountainC = 5 * Math.exp(-((x + 25) ** 2 / 280 + (z - 30) ** 2 / 220)),
        rolling =
          1.8 * Math.exp(-((x + 8) ** 2 / 260 + (z - 18) ** 2 / 260)) +
          1.4 * Math.exp(-((x - 12) ** 2 / 220 + (z + 15) ** 2 / 240)),
        height = edgeFade * (mountainA + mountainB + mountainC + rolling);
      const k = j * terrain.resolution + i;
      terrain.heights[k] = height;
      terrain.colors[k] =
        height > 5 ? "#6d8f5e" : height > 2 ? "#759a63" : "#7cab68";
    }

  const entity = (
    id: string,
    name: string,
    kind: WorldEntity["kind"],
    x: number,
    z: number,
    scale: Vec3,
  ): WorldEntity => ({
    id,
    name,
    kind,
    transform: {
      position: [
        x,
        sampleTerrainHeight(terrain, x, z) +
          (kind === "rock" ? scale[1] * 0.25 : 0),
        z,
      ],
      rotation: [0, 0, 0],
      scale,
    },
  });

  return {
    terrain,
    entities: [
      entity("starter-tree-01", "並木の木", "tree", -8, -10, [1, 1.1, 1]),
      entity("starter-tree-02", "並木の木", "tree", 8, -8, [1.1, 1.3, 1.1]),
      entity("starter-tree-03", "並木の木", "tree", -10, 4, [0.9, 1, 0.9]),
      entity("starter-tree-04", "並木の木", "tree", 10, 8, [1.2, 1.4, 1.2]),
      entity("starter-tree-05", "並木の木", "tree", -9, 19, [1, 1.2, 1]),
      entity("starter-tree-06", "並木の木", "tree", 9, 23, [1.1, 1.5, 1.1]),
      entity("starter-tree-07", "並木の木", "tree", -16, -2, [1, 1.2, 1]),
      entity("starter-tree-08", "並木の木", "tree", 16, 13, [0.9, 1.1, 0.9]),
      entity(
        "starter-building-01",
        "丘のビル",
        "building",
        -12,
        -6,
        [1.5, 1.2, 1.5],
      ),
      entity(
        "starter-building-02",
        "丘のビル",
        "building",
        12,
        -7,
        [1.3, 1.4, 1.3],
      ),
      entity(
        "starter-building-03",
        "丘のビル",
        "building",
        14,
        12,
        [1.6, 1.1, 1.6],
      ),
      entity("starter-mountain-01", "遠くの山", "rock", -24, -18, [8, 5, 8]),
      entity("starter-mountain-02", "遠くの山", "rock", 24, -16, [7, 4, 8]),
      entity("starter-mountain-03", "遠くの山", "rock", -23, 24, [6, 3.5, 7]),
      entity("starter-mountain-04", "遠くの山", "rock", 25, 24, [9, 5.5, 9]),
    ],
  };
}
