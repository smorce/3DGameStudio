import { assetLimits } from "../../asset-core/src/limits";
import { get } from "node:https";
import { z } from "zod";
import {
  type AssetCandidate,
  type AssetProvider,
  type DownloadOption,
  candidateSchema,
} from "../../asset-core/src/index";
const USER_AGENT = "MachineStudio/0.1 (browser-game-studio)";
export async function safeFetch(
  url: string,
  maxBytes = assetLimits().sourceBytes,
): Promise<Uint8Array> {
  const u = new URL(url);
  if (
    u.protocol !== "https:" ||
    ![
      "api.polyhaven.com",
      "dl.polyhaven.org",
      "cdn.polyhaven.com",
      "ambientcg.com",
      "acg-download.struffelproductions.com",
    ].includes(u.hostname)
  )
    throw new Error("Download host is not allowed");
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const request = get(
      u,
      { family: 4, headers: { "User-Agent": USER_AGENT } },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Provider HTTP ${response.statusCode}`));
          return;
        }
        if (Number(response.headers["content-length"]) > maxBytes) {
          response.destroy();
          reject(new Error("Asset exceeds size limit"));
          return;
        }
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            response.destroy(new Error("Asset exceeds size limit"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const result = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
          }
          resolve(result);
        });
        response.on("error", reject);
      },
    );
    const timer = setTimeout(
      () => request.destroy(new Error("Provider request timed out")),
      30000,
    );
    request.on("close", () => clearTimeout(timer));
    request.on("error", reject);
  });
}

const cache = new Map<string, { expires: number; value: unknown }>();
export async function providerJson(url: string): Promise<unknown> {
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.value;
  let error: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const value: unknown = JSON.parse(
        new TextDecoder().decode(await safeFetch(url, 16 * 1024 * 1024)),
      );
      cache.set(url, { value, expires: Date.now() + 300000 });
      return value;
    } catch (e) {
      error = e;
    }
  }
  throw error;
}
const polyItem = z
  .object({
    name: z.string(),
    authors: z.record(z.string(), z.unknown()).optional(),
    categories: z.array(z.string()).optional(),
    category: z.string().optional(),
    thumbnail_url: z.string().optional(),
  })
  .passthrough();
export function normalizePoly(input: unknown) {
  const data = z.record(z.string(), polyItem).parse(input);
  return Object.entries(data).map(([id, a]) =>
    candidateSchema.parse({
      id,
      name: a.name,
      provider: "polyhaven",
      sourceUrl: `https://polyhaven.com/a/${id}`,
      author: Object.keys(a.authors ?? {}).join(", "),
      license: "CC0",
      thumbnail:
        a.thumbnail_url ??
        `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256`,
      category: a.category ?? a.categories?.join(" ") ?? "model",
    }),
  );
}
export class PolyHavenProvider implements AssetProvider {
  id = "polyhaven";
  displayName = "Poly Haven";
  async search(q: string, filters?: { category?: string }) {
    const all = normalizePoly(
      await providerJson("https://api.polyhaven.com/assets?type=models"),
    );
    return all
      .filter(
        (a) =>
          `${a.name} ${a.id} ${a.category}`
            .toLowerCase()
            .includes(q.toLowerCase()) &&
          (!filters?.category ||
            a.category.toLowerCase().includes(filters.category.toLowerCase())),
      )
      .slice(0, 24);
  }
  async getAsset(id: string) {
    const all = normalizePoly(
      await providerJson("https://api.polyhaven.com/assets?type=models"),
    );
    const a = all.find((a) => a.id === id);
    if (!a) throw new Error("Asset not found");
    return a;
  }
  async getDownloadOptions(id: string) {
    const json = await providerJson(
      `https://api.polyhaven.com/files/${encodeURIComponent(id)}`,
    );
    const root = z.record(z.string(), z.unknown()).parse(json);
    const gltf = z
      .record(
        z.string(),
        z.record(
          z.string(),
          z.object({
            url: z.string(),
            size: z.number(),
            include: z
              .record(z.string(), z.object({ url: z.string() }))
              .optional(),
          }),
        ),
      )
      .parse(root.gltf ?? {});
    return Object.entries(gltf)
      .flatMap(([resolution, formats]) =>
        Object.entries(formats)
          .filter(([format]) => format === "gltf" || format === "glb")
          .map(([format, v]) => ({
            id: `${resolution}-${format}`,
            url: v.url,
            size: v.size,
            format: format as "gltf" | "glb",
            resources: v.include,
          })),
      )
      .sort((a, b) => parseInt(a.id) - parseInt(b.id) || a.size - b.size);
  }
  async download(_id: string, option: DownloadOption) {
    return safeFetch(option.url);
  }
}
const ambientItem = z
  .object({
    assetId: z.string(),
    displayName: z.string().optional(),
    displayCategory: z.string().optional(),
    previewImage: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();
export function normalizeAmbient(input: unknown) {
  return z
    .object({ foundAssets: z.array(ambientItem) })
    .parse(input)
    .foundAssets.map((a) => ({
      id: a.assetId,
      name: a.displayName ?? a.assetId,
      provider: "ambientcg",
      sourceUrl: `https://ambientcg.com/view?id=${a.assetId}`,
      author: "ambientCG",
      license: "CC0",
      thumbnail: Object.values(a.previewImage ?? {})[0] ?? "",
      category: a.displayCategory ?? "material",
    }));
}
export class AmbientCGProvider implements AssetProvider {
  id = "ambientcg";
  displayName = "ambientCG";
  async search(q: string) {
    return normalizeAmbient(
      await providerJson(
        `https://ambientcg.com/api/v2/full_json?q=${encodeURIComponent(q)}&limit=24&include=previewData`,
      ),
    );
  }
  async getAsset(id: string) {
    const a = normalizeAmbient(
      await providerJson(
        `https://ambientcg.com/api/v2/full_json?id=${encodeURIComponent(id)}&include=previewData`,
      ),
    )[0];
    if (!a) throw new Error("Asset not found");
    return a;
  }
  async getDownloadOptions(id: string) {
    const data = await providerJson(
      `https://ambientcg.com/api/v2/full_json?id=${encodeURIComponent(id)}&include=downloadData`,
    );
    const found: DownloadOption[] = [];
    function walk(v: unknown) {
      if (!v || typeof v !== "object") return;
      const o = v as Record<string, unknown>;
      if (typeof o.downloadLink === "string" && typeof o.fileName === "string")
        found.push({
          id: o.fileName,
          url: o.downloadLink,
          size: Number(o.size ?? 0),
          format: o.fileName.endsWith(".glb") ? "glb" : "zip",
        });
      for (const val of Object.values(o)) walk(val);
    }
    walk(data);
    return found;
  }
  async download(_id: string, option: DownloadOption) {
    return safeFetch(option.url);
  }
}
export class LocalLibraryProvider implements AssetProvider {
  id = "local";
  displayName = "Local Library";
  constructor(
    protected catalog: AssetCandidate[] = [],
    private binaries = new Map<string, Uint8Array>(),
  ) {}
  async search(q: string) {
    return this.catalog.filter((a) =>
      `${a.name} ${a.category}`.toLowerCase().includes(q.toLowerCase()),
    );
  }
  async getAsset(id: string) {
    const a = this.catalog.find((a) => a.id === id);
    if (!a) throw new Error("Asset not found");
    return a;
  }
  async getDownloadOptions(id: string): Promise<DownloadOption[]> {
    return [
      {
        id,
        url: `local:${id}`,
        format: "glb",
        size: this.binaries.get(id)?.length ?? 0,
      },
    ];
  }
  async download(id: string) {
    const a = this.binaries.get(id);
    if (!a) throw new Error("Local asset file not found");
    return a;
  }
}
export class KenneyPackProvider extends LocalLibraryProvider {
  override id = "kenney";
  override displayName = "Kenney Pack";
}
