import { z } from "zod";
import type { AssetRecord } from "../../project-schema/src/index";
export const candidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  sourceUrl: z.string(),
  author: z.string(),
  license: z.string(),
  thumbnail: z.string(),
  category: z.string(),
});
export type AssetCandidate = z.infer<typeof candidateSchema>;
export interface DownloadOption {
  id: string;
  url: string;
  format: "gltf" | "glb" | "zip";
  size: number;
  resources?: Record<string, { url: string }>;
}
export interface AssetProvider {
  id: string;
  displayName: string;
  search(
    query: string,
    filters?: { category?: string; usableOnly?: boolean },
  ): Promise<AssetCandidate[]>;
  getAsset(id: string): Promise<AssetCandidate>;
  getDownloadOptions(id: string): Promise<DownloadOption[]>;
  download(id: string, option: DownloadOption): Promise<Uint8Array>;
}
export function makeRecord(c: AssetCandidate, id: string): AssetRecord {
  const now = new Date().toISOString();
  return {
    id,
    name: c.name,
    type: "model",
    source: {
      provider: c.provider,
      sourceAssetId: c.id,
      sourceUrl: c.sourceUrl,
      author: c.author,
      retrievedAt: now,
    },
    license: {
      id: c.license,
      name: c.license,
      url:
        c.license === "CC0"
          ? "https://creativecommons.org/publicdomain/zero/1.0/"
          : "",
      attributionRequired: c.license !== "CC0",
      attributionText:
        c.license === "CC0"
          ? ""
          : `License verification required: ${c.sourceUrl}`,
    },
    files: {
      original: `/api/files/${id}/original.glb`,
      runtime: `/api/files/${id}/runtime.glb`,
      thumbnail: c.thumbnail,
    },
    processing: { importedAt: now, optimizedAt: null, pipelineVersion: "1" },
    ai: null,
  };
}
export async function resolveAssets(providers: AssetProvider[], query: string) {
  const results = await Promise.allSettled(
    providers.map((p) => p.search(query)),
  );
  return {
    candidates: results.flatMap((r) =>
      r.status === "fulfilled" ? r.value : [],
    ),
    health: providers.map((p, i) => ({
      id: p.id,
      status: results[i].status === "fulfilled" ? "available" : "unavailable",
      error:
        results[i].status === "rejected"
          ? String((results[i] as PromiseRejectedResult).reason)
          : undefined,
    })),
  };
}
