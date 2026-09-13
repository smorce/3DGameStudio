import type { Vec3 } from "../../project-schema/src/index";

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

export function visibleChunksWithPrefetch(
  position: Vec3,
  size: number,
  radius: number,
  velocity?: Vec3,
) {
  const keys = visibleChunks(position, size, radius);
  if (!velocity) return keys;
  const speed = Math.hypot(velocity[0], velocity[2]);
  if (speed < 8) return keys;
  const ahead = Math.min(4, Math.ceil(speed / 24));
  const nx = velocity[0] / speed,
    nz = velocity[2] / speed;
  const [cx, cz] = chunkCoordinate(position, size);
  const ax = Math.round(nx * ahead),
    az = Math.round(nz * ahead);
  for (let i = cx + ax - 1; i <= cx + ax + 1; i++)
    for (let j = cz + az - 1; j <= cz + az + 1; j++) keys.add(`${i},${j}`);
  return keys;
}
