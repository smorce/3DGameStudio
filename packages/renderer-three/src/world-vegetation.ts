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
    const buildings = remapEnvironmentAssets(
      settlementEntities(
        { ...source, chunkX: prepared.chunkX, chunkZ: prepared.chunkZ },
        layers,
      ),
      source.parameters?.environmentAssets,
    ).map((b) => footprint(b, 0.35));
    const obstacles = [
      ...buildings,
      ...source.design.landmarks
        .filter((l) => !l.assetSlot.startsWith("nature.tree."))
        .map((l) => footprint(l, 0.4)),
    ].filter(
      (o) =>
        o.placement.position[0] + o.radius >= originX &&
        o.placement.position[0] - o.radius < originX + prepared.size &&
        o.placement.position[2] + o.radius >= originZ &&
        o.placement.position[2] - o.radius < originZ + prepared.size,
    );
    return createVegetationChunk({
      seed: source.seed,
      groundMaterial,
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
      allowed: (x, z) =>
        layers.sampleRoadInfluence(x, z, true).distance > 1 &&
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
        !source.design!.noSpawnRegions.some(
          (r) => Math.hypot(x - r.center[0], z - r.center[2]) <= r.radius,
        ) &&
        !layers.sampleRunwayMask(x, z) &&
        landCoverAllowed(x, z) &&
        !(alpinePlaza && insideEnvironmentPlaza(x, z)) &&
        !obstacles.some((o) => o.contains(x, z)),
    });
  }
}
