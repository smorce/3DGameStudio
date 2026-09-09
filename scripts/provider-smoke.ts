import {
  PolyHavenProvider,
  AmbientCGProvider,
} from "../packages/asset-providers/src/index";
import { importAsset } from "../packages/asset-pipeline/src/index";
import { LocalAssetStorage } from "../packages/storage/src/local";
import { writeFile, mkdir } from "node:fs/promises";
const evidence: unknown[] = [];
for (const provider of [new PolyHavenProvider(), new AmbientCGProvider()]) {
  try {
    const results = await provider.search("rock");
    if (!results.length) throw new Error("Search returned no assets");
    const asset = await provider.getAsset(
      provider.id === "polyhaven" ? "rock_07" : results[0].id,
    );
    const item: Record<string, unknown> = {
      provider: provider.id,
      status: "PASS",
      count: results.length,
      asset,
    };
    if (provider.id === "polyhaven" && process.env.IMPORT_ASSET === "1") {
      const option = (await provider.getDownloadOptions(asset.id))[0];
      if (!option) throw new Error("No download option");
      const record = await importAsset(
        asset,
        await provider.download(asset.id, option),
        new LocalAssetStorage(".data/assets"),
        option,
      );
      await mkdir("demos", { recursive: true });
      await writeFile(
        "demos/external-asset-record.json",
        JSON.stringify(record, null, 2),
      );
      item.imported = record;
    }
    evidence.push(item);
    console.log(
      `${provider.displayName}: PASS (${results.length} results, ${asset.id})`,
    );
  } catch (error) {
    evidence.push({
      provider: provider.id,
      status: "FAIL",
      error: String(error),
    });
    console.error(`${provider.displayName}: FAIL: ${String(error)}`);
    process.exitCode = 1;
  }
}
await mkdir("docs/evidence", { recursive: true });
await writeFile(
  "docs/evidence/providers.json",
  JSON.stringify(
    { checkedAt: new Date().toISOString(), results: evidence },
    null,
    2,
  ),
);
