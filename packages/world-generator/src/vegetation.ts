import type { Vec3 } from "../../project-schema/src/index";
import { seedUnit } from "./seed";
import type { GeneratedEntity } from "./types";

export interface VegetationPlacement {
  position: Vec3;
  yaw: number;
  scale: number;
  kind: number;
}
export interface VegetationArea {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}
/** 配置と地表模様が同じ絶対座標セルの被覆分布を使う。 */
export function vegetationCoverage(
  seed: number,
  x: number,
  z: number,
  roadDistance: number | undefined,
  spacing = 1.2,
) {
  const id = `${Math.floor(x / spacing)},${Math.floor(z / spacing)}`;
  return roadDistance !== undefined &&
    roadDistance > 6 &&
    seedUnit(seed, "grass-cover", id) < 0.22
    ? 0
    : 1;
}
export function vegetationArea(value: unknown): VegetationArea | undefined {
  if (!value || typeof value !== "object") return;
  const area = value as VegetationArea;
  if (
    [area.minX, area.minZ, area.maxX, area.maxZ].every(
      (v) => typeof v === "number" && Number.isFinite(v),
    ) &&
    area.minX < area.maxX &&
    area.minZ < area.maxZ
  )
    return area;
}
/** 素材だけを置き換え、地形・位置・Seed・道路を保つ。既存Schemaのparametersで任意Worldから指定可能。 */
export function remapEnvironmentAssets(
  entities: GeneratedEntity[],
  value: unknown,
): GeneratedEntity[] {
  if (Array.isArray(value))
    return value.reduce<GeneratedEntity[]>(
      (current, region) => remapEnvironmentAssets(current, region),
      entities,
    );
  if (!value || typeof value !== "object") return entities;
  const config = value as { area?: unknown; slots?: unknown };
  const area = vegetationArea(config.area);
  if (!area || !config.slots || typeof config.slots !== "object")
    return entities;
  const slots = config.slots as Record<string, unknown>;
  return entities.map((entity) => {
    const [x, , z] = entity.position,
      target = slots[entity.assetSlot ?? ""];
    return typeof target === "string" &&
      target.length > 0 &&
      x >= area.minX &&
      x < area.maxX &&
      z >= area.minZ &&
      z < area.maxZ
      ? { ...entity, assetSlot: target }
      : entity;
  });
}
/** 絶対座標セルごとに揺らすため、Chunk境界と生成順に依存しない。 */
export function vegetationPlacements(options: {
  seed: number;
  bounds: VegetationArea;
  area: VegetationArea;
  height: (x: number, z: number) => number;
  allowed: (x: number, z: number) => boolean;
  roadside?: (x: number, z: number) => boolean;
  roadDistance?: (x: number, z: number) => number;
  spacing?: number;
}) {
  const { seed, bounds, area, height, allowed, spacing = 1.2 } = options;
  const result: VegetationPlacement[] = [];
  for (
    let iz = Math.floor(bounds.minZ / spacing);
    iz < Math.ceil(bounds.maxZ / spacing);
    iz++
  )
    for (
      let ix = Math.floor(bounds.minX / spacing);
      ix < Math.ceil(bounds.maxX / spacing);
      ix++
    ) {
      const id = `${ix},${iz}`;
      const x = (ix + 0.1 + seedUnit(seed, "grass-x", id) * 0.8) * spacing;
      const z = (iz + 0.1 + seedUnit(seed, "grass-z", id) * 0.8) * spacing;
      if (
        x < bounds.minX ||
        x >= bounds.maxX ||
        z < bounds.minZ ||
        z >= bounds.maxZ ||
        x < area.minX ||
        x >= area.maxX ||
        z < area.minZ ||
        z >= area.maxZ ||
        !allowed(x, z)
      )
        continue;
      const y = height(x, z);
      if (!Number.isFinite(y)) continue;
      const distance = options.roadDistance?.(x, z);
      // 道路外側へ株の覆いを集中し、森林内部は同じ候補セルから間引く。
      if (!vegetationCoverage(seed, x, z, distance, spacing)) continue;
      result.push({
        position: [x, y, z],
        yaw: seedUnit(seed, "grass-yaw", id) * Math.PI * 2,
        scale:
          (0.65 + seedUnit(seed, "grass-scale", id) * 0.65) *
          (distance !== undefined && distance < 2.5 ? 0.65 : 1),
        kind: options.roadside?.(x, z)
          ? 4
          : Math.floor(seedUnit(seed, "grass-kind", id) * 4),
      });
    }
  return result;
}
