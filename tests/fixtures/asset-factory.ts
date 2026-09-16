import type { AssetStorage } from "../../packages/storage/src/index";
import { deflateRawSync } from "node:zlib";
import { crc32 } from "../../packages/asset-pipeline/src/archive";
export function memoryAssetStorage(): AssetStorage & {
  data: Map<string, Uint8Array>;
} {
  const data = new Map<string, Uint8Array>();
  return {
    data,
    async save(key, bytes) {
      data.set(key, bytes.slice());
    },
    async load(key) {
      const bytes = data.get(key);
      if (!bytes) throw new Error("Missing asset file");
      return bytes;
    },
    async exists(key) {
      return data.has(key);
    },
    async remove(key) {
      data.delete(key);
    },
    getUrl(key) {
      return `/api/files/${key}`;
    },
  };
}
export function zipFixture(files: Record<string, Uint8Array>, deflate = false) {
  const local: Buffer[] = [],
    directory: Buffer[] = [];
  let offset = 0;
  for (const [name, bytes] of Object.entries(files)) {
    const filename = Buffer.from(name),
      compressed = deflate ? deflateRawSync(bytes) : Buffer.from(bytes),
      checksum = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(deflate ? 8 : 0, 8);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const dir = Buffer.concat(directory),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(directory.length / 2, 8);
  end.writeUInt16LE(directory.length / 2, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dir, end]);
}
