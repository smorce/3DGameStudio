import type {
  Project,
  WorldBuildManifest,
} from "../../project-schema/src/index";
import {
  AssetCatalog,
  worldContentFingerprint,
  assertBakedProject,
  assetMetadataHash,
} from "../../asset-catalog/src/index";
import { CURRENT_BIOME_PROFILE_VERSION } from "../../world-generator/src/index";
import { requiredSlots } from "./planner";
export const worldFingerprint = worldContentFingerprint;
/** 解決候補集合を固定する。個別配置の選択は同じseedとstable IDで再現する。 */
export function bakeWorld(
  project: Project,
  catalog = new AssetCatalog(project),
): WorldBuildManifest {
  const source = project.world.source;
  if (source.kind !== "procedural" || !source.design)
    throw new Error("World Design is required for bake");
  const resolvedSlots: Record<string, string[]> = {},
    assets = new Set<string>();
  for (const slot of requiredSlots(source.design)) {
    const candidates = catalog.query({
      slot,
      type: "model",
      status: "ready",
      style: "stylized-low-poly",
    });
    if (!candidates.length) throw new Error(`MissingAsset: ${slot}`);
    resolvedSlots[slot] = candidates.map((a) => a.id);
    candidates.forEach((a) => assets.add(a.id));
  }
  const manifest: WorldBuildManifest = {
    biomeProfileVersion: CURRENT_BIOME_PROFILE_VERSION,
    worldDesignVersion: source.design.version,
    worldId: project.world.id,
    seed: source.seed,
    generatorVersion: source.generatorVersion,
    assetCatalogFingerprint: catalog.fingerprint(),
    worldFingerprint: worldFingerprint(project),
    requiredAssets: [...assets].sort().map((id) => ({
      id,
      metadataHash: assetMetadataHash(project.assets.find((a) => a.id === id)!),
      contentHash: project.assets.find((a) => a.id === id)!.catalog!
        .contentHash,
    })),
    resolvedSlots,
  };
  project.world.buildManifest = manifest;
  return manifest;
}
export function validateBake(project: Project) {
  const manifest = project.world.buildManifest;
  if (!manifest) throw new Error("World has no build manifest");
  assertBakedProject(project);
}
