import type {
  AssetRecord,
  Project,
  Vec3,
  WorldBuildManifest,
} from "../../project-schema/src/index";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
/** 内容識別用の決定的fingerprint。ファイル改変の検証には別途SHA-256を使用する。 */
export function fingerprint(value: unknown) {
  const text = canonical(value);
  let a = 2166136261,
    b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b ^ text.charCodeAt(i), 2246822519);
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}
export function assetMetadataHash(asset: AssetRecord) {
  return fingerprint({
    catalog: asset.catalog,
    type: asset.type,
    runtime: asset.files.runtime,
    license: asset.license,
  });
}
export interface AssetQuery {
  slot?: string;
  biome?: string;
  style?: string;
  tags?: string[];
  type?: AssetRecord["type"];
  status?: "ready" | "unsupported";
}
export interface ResolutionContext {
  seed: number;
  stablePlacementId?: string;
  biome?: string;
  position?: Vec3;
  style?: string;
  variantIndex?: number;
}
export type AssetResolution =
  | { status: "resolved"; slot: string; asset: AssetRecord }
  | { status: "missing"; slot: string; reason: "MissingAsset" };

/** Project.assetsが正本。登録後は同じ配列を更新し、検索indexだけを再構築する。 */
export class AssetCatalog {
  private slots = new Map<string, AssetRecord[]>();
  private metadataHashes = new Map<string, string>();
  constructor(readonly project: Pick<Project, "assets">) {
    this.reindex();
  }
  reindex() {
    this.slots.clear();
    this.metadataHashes.clear();
    for (const asset of this.project.assets)
      this.metadataHashes.set(asset.id, assetMetadataHash(asset));
    for (const asset of this.project.assets)
      for (const slot of new Set(asset.catalog?.slots ?? [])) {
        const list = this.slots.get(slot) ?? [];
        list.push(asset);
        this.slots.set(slot, list);
      }
  }
  register(asset: AssetRecord) {
    if (!asset.catalog || !asset.catalog.contentHash)
      throw new Error("Processed catalog metadata is required");
    if (!["CC0", "project-owned"].includes(asset.license.id))
      throw new Error("Asset license is not allowed");
    const index = this.project.assets.findIndex((a) => a.id === asset.id);
    if (index < 0) this.project.assets.push(asset);
    else this.project.assets[index] = asset;
    this.reindex();
  }
  query(query: AssetQuery = {}) {
    return (
      query.slot ? (this.slots.get(query.slot) ?? []) : this.project.assets
    )
      .filter((a) => {
        const c = a.catalog;
        return (
          (!query.type || a.type === query.type) &&
          (!query.status || c?.status === query.status) &&
          (!query.biome ||
            !c?.biomes.length ||
            c.biomes.includes(query.biome)) &&
          (!query.style || c?.style === query.style) &&
          (!query.tags || query.tags.every((t) => c?.tags.includes(t)))
        );
      })
      .slice()
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  fingerprint() {
    return fingerprint(
      this.query().map((a) => ({
        id: a.id,
        type: a.type,
        catalog: a.catalog,
        runtime: a.files.runtime,
        license: a.license,
      })),
    );
  }
  resolveAssetSlot(
    slot: string,
    context: ResolutionContext,
    manifest?: WorldBuildManifest,
  ): AssetResolution {
    let candidates = this.query({
      slot,
      style: context.style,
      type: "model",
      status: "ready",
    });
    if (manifest) {
      const locked = manifest.resolvedSlots[slot];
      if (!locked) return { status: "missing", slot, reason: "MissingAsset" };
      candidates = locked
        .map((id) =>
          candidates.find(
            (a) =>
              a.id === id &&
              manifest.requiredAssets.some(
                (r) =>
                  r.id === id &&
                  r.contentHash === a.catalog?.contentHash &&
                  (!r.metadataHash ||
                    r.metadataHash === this.metadataHashes.get(a.id)),
              ),
          ),
        )
        .filter((a): a is AssetRecord => !!a);
      if (candidates.length !== locked.length)
        return { status: "missing", slot, reason: "MissingAsset" };
    }
    candidates = candidates.filter(
      (a) =>
        !context.biome ||
        !a.catalog?.biomes.length ||
        a.catalog.biomes.includes(context.biome),
    );
    if (!candidates.length)
      return { status: "missing", slot, reason: "MissingAsset" };
    const hash = parseInt(
      fingerprint([
        context.seed,
        slot,
        context.stablePlacementId ?? context.position ?? "",
        context.variantIndex ?? 0,
      ]).slice(0, 8),
      16,
    );
    return {
      status: "resolved",
      slot,
      asset: candidates[hash % candidates.length],
    };
  }
}
export function resolveAssetSlot(
  catalog: AssetCatalog,
  slot: string,
  context: ResolutionContext,
  manifest?: WorldBuildManifest,
) {
  return catalog.resolveAssetSlot(slot, context, manifest);
}

export function worldContentFingerprint(
  project: Pick<Project, "world" | "courses">,
) {
  const world = { ...project.world };
  delete world.buildManifest;
  return fingerprint({ world, courses: project.courses });
}
export function assertBakedProject(project: Project) {
  const manifest = project.world.buildManifest;
  if (!manifest) return;
  if (worldContentFingerprint(project) !== manifest.worldFingerprint)
    throw new Error("Baked world has changed; rebake is required");
  const catalog = new AssetCatalog(project);
  for (const [slot, ids] of Object.entries(manifest.resolvedSlots)) {
    const candidates = catalog.query({
      slot,
      type: "model",
      status: "ready",
      style: "stylized-low-poly",
    });
    if (
      ids.some(
        (id) =>
          !candidates.some(
            (a) =>
              a.id === id &&
              manifest.requiredAssets.some(
                (r) =>
                  r.id === id &&
                  r.contentHash === a.catalog?.contentHash &&
                  (!r.metadataHash || r.metadataHash === assetMetadataHash(a)),
              ),
          ),
      )
    )
      throw new Error(`Missing or modified baked asset: ${slot}`);
  }
}
