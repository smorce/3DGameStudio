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
      for (const level of [1, 2]) {
        const doc = await runtimeIO().readBinary(
          await environmentModelGlb(quality, variant, level),
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
