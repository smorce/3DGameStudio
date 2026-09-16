import { expect, it } from "vitest";
import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core";
import { assetSchema } from "../../packages/project-schema/src/index";
import {
  extractAssetArchive,
  crc32,
} from "../../packages/asset-pipeline/src/archive";
import {
  importAsset,
  placeholderGlb,
  validateGlb,
} from "../../packages/asset-pipeline/src/index";
import { memoryAssetStorage, zipFixture } from "../fixtures/asset-factory";
const candidate = {
  id: "texture",
  name: "PBR texture set",
  provider: "ambientcg",
  sourceUrl: "https://ambientcg.com/view?id=test",
  author: "ambientCG",
  license: "CC0",
  thumbnail: "",
  category: "material",
};
const option = {
  id: "zip",
  format: "zip" as const,
  url: "local:test",
  size: 0,
};
const text = new TextEncoder().encode("license");
it("CRC32は既知値と一致する", () => {
  expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
});
it.each([
  "../bad.txt",
  "/bad.txt",
  "folder/../../bad.txt",
  "C:/bad.txt",
  "folder\\bad.txt",
])("ZIPの危険なパスを拒否する %s", async (name) => {
  await expect(
    extractAssetArchive(zipFixture({ [name]: text })),
  ).rejects.toThrow("Unsafe archive path");
});
it("ZIP展開サイズ・件数・入れ子・MIME不一致を拒否する", async () => {
  await expect(
    extractAssetArchive(zipFixture({ "a.txt": text }), {
      expandedBytes: 2,
      fileCount: 5,
    }),
  ).rejects.toThrow("expanded size");
  await expect(
    extractAssetArchive(zipFixture({ "a.txt": text, "b.txt": text }), {
      expandedBytes: 100,
      fileCount: 1,
    }),
  ).rejects.toThrow("file count");
  await expect(
    extractAssetArchive(zipFixture({ "a.zip": zipFixture({ "b.txt": text }) })),
  ).rejects.toThrow("Nested archive");
  await expect(
    extractAssetArchive(zipFixture({ "a.bin": zipFixture({ "b.txt": text }) })),
  ).rejects.toThrow("Nested archive");
  await expect(
    extractAssetArchive(zipFixture({ "a.png": text })),
  ).rejects.toThrow();
});
it("改ざんした展開サイズとチェックサムを拒否する", async () => {
  const bytes = zipFixture({ "a.txt": new Uint8Array(5000).fill(65) }, true);
  const end = bytes.length - 22,
    dir = bytes.readUInt32LE(end + 16);
  bytes.writeUInt32LE(1, dir + 24);
  await expect(extractAssetArchive(bytes)).rejects.toThrow();
  const bad = zipFixture({ "a.txt": text });
  bad[35] ^= 1;
  await expect(extractAssetArchive(bad)).rejects.toThrow("checksum");
});
it("PBR ZIPはTexture Assetとして原本と画像を保存しRenderer未対応を明示する", async () => {
  const image = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const archive = zipFixture(
    {
      "Material_Color.png": image,
      "Material_Roughness.png": image,
      "License.txt": text,
    },
    true,
  );
  const storage = memoryAssetStorage();
  const record = await importAsset(candidate, archive, storage, option);
  expect(assetSchema.parse(record)).toEqual(record);
  expect(record.type).toBe("texture");
  expect(record.textureInfo?.state).toBe("unsupported");
  expect(record.textureInfo?.files).toHaveLength(2);
  expect(record.runtimeInfo).toBeUndefined();
  expect([...storage.data.keys()].some((k) => k.endsWith(".glb"))).toBe(false);
  expect(await storage.load(`${record.id}/source.zip`)).toEqual(archive);
  expect(record.source.author).toBe("ambientCG");
  expect(record.license.id).toBe("CC0");
});
it("ZIP内GLBは既存ProcessorのLOD・Collider・サムネイルを生成する", async () => {
  const original = await placeholderGlb(),
    archive = zipFixture({ "model.glb": original }, true),
    storage = memoryAssetStorage();
  const record = await importAsset(candidate, archive, storage, option);
  expect(record.type).toBe("model");
  expect(record.runtimeInfo?.lods?.[0].level).toBe(0);
  expect(record.runtimeInfo?.colliderFile).toContain("collider.json");
  expect(record.files.thumbnail).toContain("thumbnail.svg");
  validateGlb(await storage.load(`${record.id}/runtime.glb`));
  expect(record.files.original).toContain("source.zip");
});
it("ZIP内glTFの相対resourceはネットワークなしで解決する", async () => {
  const io = new NodeIO(),
    document = await io.readBinary(await placeholderGlb()),
    json = await io.writeJSON(document);
  const archive = zipFixture({
    "folder/model.gltf": new TextEncoder().encode(JSON.stringify(json.json)),
    ...Object.fromEntries(
      Object.entries(json.resources).map(([name, data]) => [
        `folder/${name}`,
        data,
      ]),
    ),
  });
  const storage = memoryAssetStorage();
  const record = await importAsset(candidate, archive, storage, option, {
    allowNetwork: false,
  });
  validateGlb(await storage.load(`${record.id}/runtime.glb`));
});
it("複数モデルの曖昧なZIPと失敗時の保存残骸を拒否する", async () => {
  const glb = await placeholderGlb(),
    storage = memoryAssetStorage();
  await expect(
    importAsset(
      candidate,
      zipFixture({ "a.glb": glb, "b.glb": glb }),
      storage,
      option,
    ),
  ).rejects.toThrow("Ambiguous");
  expect(storage.data.size).toBe(0);
});

it("再処理時に同一ファイルを再利用し、異なる既存ファイルを上書きしない", async () => {
  const bytes = await placeholderGlb(),
    storage = memoryAssetStorage();
  await importAsset(candidate, bytes, storage, undefined, {
    assetId: "stable",
  });
  const original = await storage.load("stable/original.glb");
  await importAsset(candidate, bytes, storage, undefined, {
    assetId: "stable",
  });
  storage.data.set("stable/runtime.glb", new Uint8Array([1]));
  await expect(
    importAsset(candidate, bytes, storage, undefined, { assetId: "stable" }),
  ).rejects.toThrow("overwrite");
  expect(await storage.load("stable/original.glb")).toEqual(original);
  expect(await storage.load("stable/runtime.glb")).toEqual(new Uint8Array([1]));
});
