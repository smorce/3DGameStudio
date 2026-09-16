import { createHash } from "node:crypto";
import type {
  AssetProvider,
  AssetGenerator,
  AssetCandidate,
  DownloadOption,
} from "../../asset-core/src/index";
import type { AssetRecord } from "../../project-schema/src/index";
import type { AssetStorage } from "../../storage/src/index";
import { AssetCatalog } from "../../asset-catalog/src/index";
import { importAsset } from "../../asset-pipeline/src/index";
import type { AssetRequirementPlan, AssetRequirement } from "./planner";
export * from "./planner";
export type FactoryMode = "offline" | "dry-run" | "acquire";
export const PROVIDER_PRIORITY = [
  "local",
  "kenney",
  "polyhaven",
  "ambientcg",
  "kaykit-local",
  "dummy-astra",
] as const;
export interface AcquisitionPolicy {
  allowedLicenses: string[];
  allowedProviders: string[];
}
export const defaultAcquisitionPolicy: AcquisitionPolicy = {
  allowedLicenses: ["CC0", "project-owned"],
  allowedProviders: [...PROVIDER_PRIORITY],
};
export interface FactoryResult {
  mode: FactoryMode;
  missing: { assetSlot: string; count: number }[];
  registered: string[];
  unsupported: string[];
  errors: string[];
}
export class AssetFactory {
  constructor(
    private catalog: AssetCatalog,
    private storage: AssetStorage,
    private providers: AssetProvider[],
    private generator: AssetGenerator,
    private policy = defaultAcquisitionPolicy,
  ) {}
  async fulfill(
    plan: AssetRequirementPlan,
    mode: FactoryMode,
    seed = 42,
  ): Promise<FactoryResult> {
    const result: FactoryResult = {
      mode,
      missing: [],
      registered: [],
      unsupported: [],
      errors: [],
    };
    const providers = this.providers
      .filter(
        (p) =>
          this.policy.allowedProviders.includes(p.id) &&
          (mode === "acquire" || p.id === "local"),
      )
      .sort(
        (a, b) =>
          PROVIDER_PRIORITY.indexOf(
            a.id as (typeof PROVIDER_PRIORITY)[number],
          ) -
          PROVIDER_PRIORITY.indexOf(b.id as (typeof PROVIDER_PRIORITY)[number]),
      );
    for (const requirement of plan.requirements) {
      const ready = () =>
        this.catalog
          .query({
            slot: requirement.assetSlot,
            style: requirement.style,
            type: "model",
            status: "ready",
          })
          .filter(
            (a) =>
              this.policy.allowedLicenses.includes(a.license.id) &&
              requirement.biomes.every(
                (b) =>
                  !a.catalog?.biomes.length || a.catalog.biomes.includes(b),
              ),
          );
      const deficit = Math.max(0, requirement.minVariants - ready().length);
      if (!deficit) continue;
      if (mode === "dry-run") {
        result.missing.push({
          assetSlot: requirement.assetSlot,
          count: deficit,
        });
        continue;
      }
      const attempted = new Set<string>();
      for (const provider of providers) {
        if (ready().length >= requirement.minVariants) break;
        try {
          const parts = requirement.assetSlot.split(".");
          const query = (
            parts[0] === "nature" ? parts[1] : parts.at(-1)!
          ).replaceAll("_", " ");
          const candidates = await provider.search(query);
          for (const candidate of candidates) {
            if (ready().length >= requirement.minVariants) break;
            const key = `${provider.id}:${candidate.id}`;
            if (
              candidate.provider !== provider.id ||
              !this.policy.allowedLicenses.includes(candidate.license) ||
              attempted.has(key) ||
              this.catalog.project.assets.some(
                (a) =>
                  a.source.provider === provider.id &&
                  a.source.sourceAssetId === candidate.id,
              )
            )
              continue;
            attempted.add(key);
            try {
              const options = await provider.getDownloadOptions(candidate.id);
              const option = options.find((o) =>
                ["glb", "gltf", "zip"].includes(o.format),
              );
              if (!option) continue;
              const bytes = await provider.download(candidate.id, option);
              await this.process(
                candidate,
                bytes,
                option,
                requirement,
                result,
                null,
                mode === "acquire",
              );
            } catch (error) {
              result.errors.push(`${key}: ${String(error)}`);
            }
          }
        } catch (error) {
          result.errors.push(`${provider.id}: ${String(error)}`);
        }
      }
      if (
        this.policy.allowedProviders.includes("dummy-astra") &&
        this.policy.allowedLicenses.includes("project-owned")
      ) {
        const maxAttempts =
          this.catalog.project.assets.length + requirement.minVariants;
        for (
          let i = 0;
          i < maxAttempts && ready().length < requirement.minVariants;
          i++
        ) {
          try {
            const artifact = await this.generator.generate({
              assetSlot: requirement.assetSlot,
              variantIndex: i,
              seed,
              style: requirement.style,
            });
            if (
              this.catalog.project.assets.some(
                (a) =>
                  a.source.provider === artifact.candidate.provider &&
                  a.source.sourceAssetId === artifact.candidate.id,
              )
            )
              continue;
            await this.process(
              artifact.candidate,
              artifact.bytes,
              artifact.option,
              requirement,
              result,
              artifact.ai,
            );
          } catch (error) {
            result.errors.push(`dummy-astra: ${String(error)}`);
            break;
          }
        }
      }
      const remaining = requirement.minVariants - ready().length;
      if (remaining > 0)
        result.missing.push({
          assetSlot: requirement.assetSlot,
          count: remaining,
        });
    }
    return result;
  }
  private async process(
    candidate: AssetCandidate,
    bytes: Uint8Array,
    option: DownloadOption,
    requirement: AssetRequirement,
    result: FactoryResult,
    ai?: AssetRecord["ai"],
    allowNetwork = false,
  ) {
    if (!this.policy.allowedLicenses.includes(candidate.license))
      throw new Error("Asset license is not allowed");
    const assetId = `factory-${createHash("sha256").update(candidate.provider).update(candidate.id).update(bytes).digest("hex").slice(0, 32)}`;
    const record = await importAsset(candidate, bytes, this.storage, option, {
      allowNetwork,
      assetId,
    });
    const runtime = await this.storage.load(
      record.files.runtime.replace("/api/files/", ""),
    );
    record.catalog = {
      slots: [requirement.assetSlot],
      tags: requirement.assetSlot.split("."),
      biomes: requirement.biomes,
      style: requirement.style,
      variantGroup: requirement.assetSlot,
      contentHash: createHash("sha256").update(runtime).digest("hex"),
      status: record.type === "texture" ? "unsupported" : "ready",
    };
    if (ai) record.ai = ai;
    this.catalog.register(record);
    (record.type === "texture" ? result.unsupported : result.registered).push(
      record.id,
    );
  }
}
