import type { Vec3 } from "../../project-schema/src/index";
import { worldToChunk } from "../../world-generator/src/index";

export interface WorldPosition {
  chunkX: number;
  chunkZ: number;
  localX: number;
  y: number;
  localZ: number;
}

export function toWorldPosition(
  position: Vec3,
  chunkSize: number,
): WorldPosition {
  const chunk = worldToChunk(position[0], position[2], chunkSize);
  return {
    chunkX: chunk.chunkX,
    chunkZ: chunk.chunkZ,
    localX: chunk.localX,
    y: position[1],
    localZ: chunk.localZ,
  };
}

export function fromWorldPosition(
  position: WorldPosition,
  chunkSize: number,
): Vec3 {
  return [
    position.chunkX * chunkSize + position.localX,
    position.y,
    position.chunkZ * chunkSize + position.localZ,
  ];
}

export function chunkKeyFromPosition(position: Vec3, chunkSize: number) {
  const chunk = worldToChunk(position[0], position[2], chunkSize);
  return `${chunk.chunkX},${chunk.chunkZ}`;
}

export function simulationPosition(global: Vec3, origin: Vec3): Vec3 {
  return [global[0] - origin[0], global[1] - origin[1], global[2] - origin[2]];
}

export function globalPosition(simulation: Vec3, origin: Vec3): Vec3 {
  return [
    simulation[0] + origin[0],
    simulation[1] + origin[1],
    simulation[2] + origin[2],
  ];
}

export function rebaseDelta(
  focus: Vec3,
  origin: Vec3,
  chunkSize: number,
  distance = 3,
): Vec3 | undefined {
  const focusChunk = worldToChunk(focus[0], focus[2], chunkSize);
  const originChunk = worldToChunk(origin[0], origin[2], chunkSize);
  if (
    Math.abs(focusChunk.chunkX - originChunk.chunkX) < distance &&
    Math.abs(focusChunk.chunkZ - originChunk.chunkZ) < distance
  )
    return undefined;
  return [
    focusChunk.chunkX * chunkSize - origin[0],
    0,
    focusChunk.chunkZ * chunkSize - origin[2],
  ];
}
