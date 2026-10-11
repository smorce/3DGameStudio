import { environmentShadowGlb } from "./environment-shadow";
import {
  generatedSurfacePng,
  type EnvironmentSurface,
} from "./environment-materials";
import {
  environmentGeometryVersion,
  type TreeRules,
  type HouseRules,
} from "./environment-rules";
import type { AssetRecord } from "../../project-schema/src/index";
import type { AssetStorage } from "../../storage/src/index";
import { generateRuntime, runtimeIO } from "../../asset-pipeline/src/runtime";
import {
  environmentModelGlb,
  qualityModelKind,
  environmentTreeCollider,
} from "./environment-models";

/** 手続き環境素材の明示LODと幹Colliderを既存Pipelineへ追加する。任意Worldから再利用可能。 */
export async function prepareEnvironmentAssets(
  assets: AssetRecord[],
  storage: AssetStorage,
) {
  for (const asset of assets) {
    const slot = asset.catalog?.slots[0];
    const quality = slot ? qualityModelKind(slot) : undefined;
    if (quality && asset.runtimeInfo) {
      if (quality === "oak" || quality === "pine") {
        const collider = environmentTreeCollider(quality),
          key = `${asset.id}/quality-trunk.json`;
        await storage.save(key, collider);
        asset.runtimeInfo.collider = "convexHull";
        asset.runtimeInfo.colliderFile = `/api/files/${key}`;
        asset.runtimeInfo.colliderBytes = collider.length;
      }
      const lods = [asset.runtimeInfo.lods![0]];
      const original = await runtimeIO().readBinary(
        await storage.load(asset.files.original.replace("/api/files/", "")),
      );
      const variant = original
        .getRoot()
        .listScenes()[0]
        ?.getExtras().environmentSeed;
      if (typeof variant !== "number" || !Number.isInteger(variant))
        throw new Error("Missing environment recipe seed");
      const extras = original.getRoot().listScenes()[0].getExtras();
      const rules = extras.environmentRules as
        TreeRules | HouseRules | undefined;
      if (extras.environmentGeometryVersion !== environmentGeometryVersion)
        throw new Error(
          "Stale environment geometry recipe; regenerate through Asset Factory",
        );
      if (asset.catalog)
        asset.catalog.generation = {
          kind: quality,
          version: environmentGeometryVersion,
          seed: variant,
          parameters: rules ? { ...rules } : {},
          materials:
            quality === "house"
              ? ["wood", "stone", "roof", "plaster", "glass"]
              : quality === "oak"
                ? ["bark", "leaf"]
                : quality === "pine"
                  ? ["bark", "needle"]
                  : [quality],
        };
      if (quality === "oak" || quality === "pine") {
        asset.runtimeInfo.environmentShadowLods = [];
        for (const level of [1, 2] as const) {
          const runtime = await generateRuntime(
            await runtimeIO().readBinary(
              await environmentShadowGlb(rules as TreeRules, level),
            ),
          );
          const key = `${asset.id}/shadow-lod${level}.glb`,
            bytes = runtime.levels[0].bytes;
          await storage.save(key, bytes);
          asset.runtimeInfo.environmentShadowLods.push({
            level,
            file: `/api/files/${key}`,
            distance: level === 1 ? 35 : 80,
            bytes: bytes.length,
          });
        }
      }
      if (quality === "house") {
        asset.runtimeInfo.environmentMaterials = {};
        for (const surface of [
          "wood",
          "stone",
          "roof",
          "plaster",
          "glass",
        ] as EnvironmentSurface[]) {
          const key = `${asset.id}/generated-${surface}.png`;
          await storage.save(key, await generatedSurfacePng(surface, variant));
          asset.runtimeInfo.environmentMaterials[surface] = `/api/files/${key}`;
        }
      }
      for (const level of [1, 2]) {
        const doc = await runtimeIO().readBinary(
          await environmentModelGlb(quality, variant, level, rules),
        );
        const runtime = await generateRuntime(doc);
        const key = `${asset.id}/quality-lod${level}.glb`,
          lod = runtime.levels[0];
        await storage.save(key, lod.bytes);
        lods.push({
          level,
          file: `/api/files/${key}`,
          distance: level === 1 ? 45 : 110,
          triangles: lod.triangles,
          bytes: lod.bytes.length,
        });
      }
      asset.runtimeInfo.lods = lods;
      asset.runtimeInfo.lodLevels = [0, 1, 2];
    }
  }
}
