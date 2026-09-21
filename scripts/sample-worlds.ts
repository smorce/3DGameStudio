import {
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { sampleWorldCatalog } from "../packages/sample-worlds/src/index";
import { planSampleWorldAssets } from "../packages/sample-worlds/src/prepare";
import {
  emptyProject,
  parseProject,
} from "../packages/project-schema/src/index";
import { AssetCatalog } from "../packages/asset-catalog/src/index";
import {
  AssetFactory,
  requiredSlots,
} from "../packages/asset-factory/src/index";
import { bakeWorld, validateBake } from "../packages/asset-factory/src/bake";
import { DummyAstraAssetGenerator } from "../packages/ai-dummy/src/asset-generator";
import { LocalAssetStorage } from "../packages/storage/src/local";
import { validateWorld } from "../packages/world-generator/src/validate";
import { generateChunk } from "../packages/world-generator/src/index";
const root = "demos/sample-worlds";
if (!["prepare", "validate"].includes(process.argv[2]))
  throw new Error("Expected prepare or validate");
if (process.argv[2] === "prepare") {
  const library = emptyProject();
  const temp = ".data/sample-world-prepare";
  await mkdir(`${root}/assets`, { recursive: true });
  await mkdir("demos/worlds", { recursive: true });
  const result = await new AssetFactory(
    new AssetCatalog(library),
    new LocalAssetStorage(temp),
    [],
    new DummyAstraAssetGenerator(true),
  ).fulfill(await planSampleWorldAssets(), "offline", 42);
  if (result.errors.length || result.missing.length)
    throw new Error(JSON.stringify(result));
  const preparedFiles = new Set<string>();
  // 同じ実ファイルはcontent hashで1回だけ保存する。
  const rewriteFiles = async (object: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(object)) {
      if (typeof value === "string" && value.startsWith("/api/files/")) {
        const from = path.join(temp, value.replace("/api/files/", ""));
        const bytes = await readFile(from);
        const hash = createHash("sha256").update(bytes).digest("hex");
        const file = `${hash}${path.extname(from)}`;
        if (!preparedFiles.has(file))
          await copyFile(from, `${root}/assets/${file}`);
        preparedFiles.add(file);
        object[key] = `/api/files/sample-worlds/${file}`;
      } else if (value && typeof value === "object")
        await rewriteFiles(value as Record<string, unknown>);
      else if (
        ["retrievedAt", "importedAt", "optimizedAt"].includes(key) &&
        value
      )
        object[key] = "2026-01-01T00:00:00.000Z";
    }
  };
  for (const asset of library.assets)
    await rewriteFiles(asset as unknown as Record<string, unknown>);
  for (const descriptor of sampleWorldCatalog) {
    const p = descriptor.buildProject();
    const source = p.world.source;
    if (source.kind === "procedural" && source.design) {
      const slots = requiredSlots(source.design);
      p.assets = library.assets.filter((a) =>
        a.catalog?.slots.some((s) => slots.includes(s)),
      );
      bakeWorld(p);
    }
    await writeFile(
      `demos/worlds/${descriptor.id}.json`,
      JSON.stringify(parseProject(p), null, 2) + "\n",
    );
  }
  await writeFile(
    `${root}/library.json`,
    JSON.stringify(library.assets, null, 2) + "\n",
  );
  for (const file of await readdir(`${root}/assets`)) {
    if (!preparedFiles.has(file)) await rm(`${root}/assets/${file}`);
  }
  await rm(temp, { recursive: true, force: true });
}
const report = [];
const assets = new Set<string>(),
  files = new Set<string>();
let references = 0;
const verifiedFiles = new Map<string, string>();
async function verifyFiles(value: unknown): Promise<void> {
  if (typeof value === "string" && value.startsWith("/api/files/")) {
    if (!/^\/api\/files\/sample-worlds\/[a-f0-9]{64}\.[a-z0-9]+$/.test(value))
      throw new Error(`Unshared sample asset URL: ${value}`);
    if (verifiedFiles.has(value)) return;
    const file = path.basename(value);
    const bytes = await readFile(`${root}/assets/${file}`);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== file.split(".")[0])
      throw new Error(`Corrupt sample asset: ${file}`);
    verifiedFiles.set(value, hash);
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value)) await verifyFiles(child);
  }
}
for (const descriptor of sampleWorldCatalog) {
  const p = parseProject(
    JSON.parse(await readFile(`demos/worlds/${descriptor.id}.json`, "utf8")),
  );
  const source = p.world.source;
  if (source.kind !== "procedural")
    throw new Error("Expected procedural world");
  const catalog = new AssetCatalog(p);
  const samples: number[] = [];
  const entities = [];
  for (let z = -5; z < 5; z++)
    for (let x = -5; x < 5; x++) {
      const start = performance.now();
      const chunk = generateChunk({ ...source, chunkX: x, chunkZ: z });
      samples.push(performance.now() - start);
      if (!Array.from(chunk.heights).every(Number.isFinite))
        throw new Error("Non-finite terrain");
      entities.push(...chunk.entities);
    }
  const issues = validateWorld(p.world, {
    entities,
    courses: p.courses,
    spawnSurface: descriptor.recommendedMachine === "boat" ? "water" : "land",
    canResolve: (slot, biome) =>
      catalog.resolveAssetSlot(
        slot,
        { seed: source.seed, biome, style: "stylized-low-poly" },
        p.world.buildManifest,
      ).status === "resolved",
  });
  if (issues.some((i) => i.severity === "error"))
    throw new Error(`${descriptor.id}: ${JSON.stringify(issues)}`);
  if (source.design) validateBake(p);
  for (const asset of p.assets) {
    assets.add(asset.id);
    files.add(asset.files.runtime);
    references++;
    await verifyFiles(asset);
    if (verifiedFiles.get(asset.files.runtime) !== asset.catalog?.contentHash)
      throw new Error(`Invalid runtime hash: ${asset.id}`);
  }
  samples.sort((a, b) => a - b);
  report.push({
    id: descriptor.id,
    chunks: 100,
    medianMs: samples[50],
    p95Ms: samples[95],
    maxMs: samples[99],
    entityCount: entities.length,
    issues,
  });
}
await mkdir("docs/evidence", { recursive: true });
const result = {
  worlds: report,
  uniqueAssetCount: assets.size,
  uniqueRuntimeFileCount: files.size,
  totalLogicalReferences: references,
};
await writeFile(
  "docs/evidence/sample-worlds.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
