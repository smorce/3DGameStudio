import type { AssetRecord } from "../../project-schema/src/index";
import type { AssetStorage } from "../../storage/src/index";
import { alpineModelGlb } from "../../ai-dummy/src/alpine-models";
import { generateRuntime, runtimeIO } from "../../asset-pipeline/src/runtime";

/** 小さな独立した穂・石は自動Simplifyで残るため、遠景用の形状を明示する。 */
export async function prepareAlpineLods(
  assets: AssetRecord[],
  storage: AssetStorage,
) {
  for (const asset of assets) {
    const slot = asset.catalog?.slots[0];
    if (
      !slot?.includes("alpine-village") ||
      ![".wheat", ".wall", ".oak"].some((suffix) => slot.endsWith(suffix)) ||
      !asset.runtimeInfo
    )
      continue;
    const lods = [asset.runtimeInfo.lods![0]];
    for (const level of [1, 2]) {
      const doc = await runtimeIO().readBinary(
        await alpineModelGlb(slot, 0, level),
      );
      const runtime = await generateRuntime(doc);
      const lod = runtime.levels[0],
        key = `${asset.id}/alpine-lod${level}.glb`;
      await storage.save(key, lod.bytes);
      lods.push({
        level,
        file: `/api/files/${key}`,
        distance: level === 1 ? 60 : 150,
        triangles: lod.triangles,
        bytes: lod.bytes.length,
      });
    }
    asset.runtimeInfo.lods = lods;
    asset.runtimeInfo.lodLevels = [0, 1, 2];
  }
}
