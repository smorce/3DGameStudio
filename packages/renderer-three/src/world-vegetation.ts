import { insideEnvironmentPlaza } from "./environment-plaza";
import { isAlpineVillage } from "../../world-generator/src/alpine-farmland";
import type { BufferGeometry, MeshStandardMaterial } from "three";
import type {
  Project,
  AssetRecord,
  Vec3,
} from "../../project-schema/src/index";
import type { PreparedChunk } from "../../world-generator/src/prepare";
import { semanticContext } from "../../world-generator/src/design-generation";
import { settlementEntities } from "../../world-generator/src/settlement-generation";
import { remapEnvironmentAssets } from "../../world-generator/src/vegetation";
import { createVegetationChunk, vegetationArea } from "./vegetation";
import {
  vegetationGroundHeight,
  vegetationGroundSlope,
} from "./vegetation-ground";

/** Worldの既存意味レイヤーとCatalogの境界を草の配置条件へ接続する。物理Entityは追加しない。 */
export function worldVegetationChunk(
  source: Extract<Project["world"]["source"], { kind: "procedural" }>,
  assets: AssetRecord[],
  prepared: PreparedChunk,
  geo: BufferGeometry,
  waterHeight: number,
  landCoverAllowed: (x: number, z: number) => boolean = () => true,
  groundMaterial?: MeshStandardMaterial,
  initialMode?: "A0" | "A1" | "A2" | "A3",
) {
  if (!source.design) return;
  const alpinePlaza = isAlpineVillage(source.design);
  const area = vegetationArea(source.parameters?.vegetationArea);
  const originX = prepared.chunkX * prepared.size,
    originZ = prepared.chunkZ * prepared.size;
  if (
    area &&
    originX < area.maxX &&
    originX + prepared.size > area.minX &&
    originZ < area.maxZ &&
    originZ + prepared.size > area.minZ
  ) {
    const layers = semanticContext(source.design!, source.seed);
    const boundsBySlot = new Map(
      assets.flatMap((asset) =>
        asset.runtimeInfo
          ? (asset.catalog?.slots ?? []).map(
              (slot) => [slot, asset.runtimeInfo!.bounds] as const,
            )
          : [],
      ),
    );
    const footprint = (
      placement: {
        assetSlot?: string;
        position: Vec3;
        rotation: Vec3;
        scale: Vec3;
      },
      margin: number,
    ) => {
      const bounds = boundsBySlot.get(placement.assetSlot ?? "");
      const halfX =
        (bounds
          ? ((bounds.max[0] - bounds.min[0]) * placement.scale[0]) / 2
          : 5) + margin;
      const halfZ =
        (bounds
          ? ((bounds.max[2] - bounds.min[2]) * placement.scale[2]) / 2
          : 5) + margin;
      const centerX = bounds
        ? ((bounds.max[0] + bounds.min[0]) * placement.scale[0]) / 2
        : 0;
      const centerZ = bounds
        ? ((bounds.max[2] + bounds.min[2]) * placement.scale[2]) / 2
        : 0;
      const radius = Math.hypot(halfX, halfZ) + Math.hypot(centerX, centerZ);
      const cos = Math.cos(placement.rotation[1]),
        sin = Math.sin(placement.rotation[1]);
      return {
        placement,
        radius,
        contains: (x: number, z: number) => {
          const dx = x - placement.position[0],
            dz = z - placement.position[2];
          return (
            Math.abs(dx * cos - dz * sin - centerX) < halfX &&
            Math.abs(dx * sin + dz * cos - centerZ) < halfZ
          );
        },
      };
    };
    // 境界を跨ぐ建物も両側のChunkで同じ除外輪郭を使う。
    const neighborhood = [-1, 0, 1].flatMap((dx) =>
      [-1, 0, 1].flatMap((dz) =>
        settlementEntities(
          {
            ...source,
            chunkX: prepared.chunkX + dx,
            chunkZ: prepared.chunkZ + dz,
          },
          layers,
        ),
      ),
    );
    const buildings = remapEnvironmentAssets(
      neighborhood,
      source.parameters?.environmentAssets,
    ).map((b) => footprint(b, 0.35));
    const obstacles = [
      ...buildings,
      ...source.design.landmarks
        .filter((l) => !l.assetSlot.startsWith("nature.tree."))
        .map((l) => footprint(l, 0.4)),
    ].filter(
      (o) =>
        o.placement.position[0] + o.radius >= originX - 2 &&
        o.placement.position[0] - o.radius < originX + prepared.size + 2 &&
        o.placement.position[2] + o.radius >= originZ - 2 &&
        o.placement.position[2] - o.radius < originZ + prepared.size + 2,
    );
    const semanticAllowed = (x: number, z: number) =>
      layers.sampleRoadInfluence(x, z, true).distance > 1 &&
      !source.design!.noSpawnRegions.some(
        (r) => Math.hypot(x - r.center[0], z - r.center[2]) <= r.radius,
      ) &&
      !layers.sampleRunwayMask(x, z) &&
      landCoverAllowed(x, z) &&
      !(alpinePlaza && insideEnvironmentPlaza(x, z)) &&
      !obstacles.some((o) => o.contains(x, z));
    // マスク余白も絶対座標を所有する地形セルで評価する。高さキャッシュは作成後に空にする。
    const heights = new Map<string, number>();
    const absoluteHeight = (x: number, z: number) => {
      const key = `${x},${z}`;
      let value = heights.get(key);
      if (value === undefined) {
        value = Math.fround(layers.sampleHeight(x, z));
        heights.set(key, value);
      }
      return value;
    };
    const coverageTerrain = (x: number, z: number) => {
      const step = prepared.size / (prepared.resolution - 1);
      const ox = Math.floor(x / prepared.size) * prepared.size,
        oz = Math.floor(z / prepared.size) * prepared.size;
      const u = (x - ox) / step,
        v = (z - oz) / step,
        ix = Math.floor(u),
        iz = Math.floor(v),
        a = u - ix,
        b = v - iz;
      const x0 = ox + ix * step,
        z0 = oz + iz * step;
      const h00 = absoluteHeight(x0, z0),
        h10 = absoluteHeight(x0 + step, z0),
        h01 = absoluteHeight(x0, z0 + step),
        h11 = absoluteHeight(x0 + step, z0 + step);
      const lower = a + b <= 1;
      const height = lower
        ? h00 * (1 - a - b) + h10 * a + h01 * b
        : h11 * (a + b - 1) + h10 * (1 - b) + h01 * (1 - a);
      const slope =
        (Math.atan(
          Math.hypot(
            lower ? h10 - h00 : h11 - h01,
            lower ? h01 - h00 : h11 - h10,
          ) / step,
        ) *
          180) /
        Math.PI;
      return { height, slope };
    };
    return createVegetationChunk({
      seed: source.seed,
      groundMaterial,
      initialMode,
      area,
      originX,
      originZ,
      bounds: {
        minX: originX,
        minZ: originZ,
        maxX: originX + prepared.size,
        maxZ: originZ + prepared.size,
      },
      height: (x, z) =>
        vegetationGroundHeight(
          geo.getAttribute("position").array,
          prepared.resolution,
          prepared.size,
          x - originX,
          z - originZ,
        ),
      roadDistance: (x, z) => layers.sampleRoadInfluence(x, z, true).distance,
      roadside: (x, z) => layers.sampleRoadInfluence(x, z, true).distance < 6,
      finishCoverage: () => heights.clear(),
      coverageAllowed: (x, z) => {
        const { height, slope } = coverageTerrain(x, z);
        return (
          slope < 32 && height > waterHeight + 0.5 && semanticAllowed(x, z)
        );
      },
      allowed: (x, z) =>
        vegetationGroundSlope(
          geo.getAttribute("position").array,
          prepared.resolution,
          prepared.size,
          x - originX,
          z - originZ,
        ) < 32 &&
        vegetationGroundHeight(
          geo.getAttribute("position").array,
          prepared.resolution,
          prepared.size,
          x - originX,
          z - originZ,
        ) >
          waterHeight + 0.5 &&
        semanticAllowed(x, z),
    });
  }
}
