import { inflateRawSync } from "node:zlib";
import sharp from "sharp";
import { assetLimits } from "../../asset-core/src/limits";

export interface ArchiveLimits {
  expandedBytes: number;
  fileCount: number;
}
export interface ArchiveFile {
  name: string;
  bytes: Uint8Array;
  mime: string;
}
export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function safeArchivePath(name: string) {
  if (
    !name ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes(":") ||
    name.includes("\0") ||
    name.split("/").some((s) => s === ".." || s === ".") ||
    !/^[a-zA-Z0-9_./ -]+$/.test(name)
  )
    throw new Error("Unsafe archive path");
  return name;
}
async function validateFile(name: string, bytes: Uint8Array): Promise<string> {
  const ext = name.split(".").pop()?.toLowerCase();
  const head = Buffer.from(bytes.subarray(0, 8));
  if (
    /^(zip|gz|tar|7z|rar|bz2|xz|jar)$/.test(ext ?? "") ||
    head.subarray(0, 2).equals(Buffer.from("PK")) ||
    head.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b])) ||
    head.subarray(0, 4).toString() === "Rar!" ||
    head
      .subarray(0, 6)
      .equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) ||
    head
      .subarray(0, 6)
      .equals(Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0])) ||
    head.subarray(0, 3).toString() === "BZh" ||
    Buffer.from(bytes.subarray(257, 262)).toString() === "ustar"
  )
    throw new Error("Nested archive is forbidden");
  if (ext === "glb" && head.subarray(0, 4).toString() === "glTF")
    return "model/gltf-binary";
  if (ext === "gltf") {
    const json = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (json.asset?.version !== "2.0")
      throw new Error("Invalid glTF archive entry");
    return "model/gltf+json";
  }
  if (["png", "jpg", "jpeg", "webp"].includes(ext ?? "")) {
    const metadata = await sharp(bytes, {
      limitInputPixels: assetLimits().textureDimension ** 2,
    }).metadata();
    const expected = ext === "jpg" ? "jpeg" : ext;
    if (
      metadata.format !== expected ||
      !metadata.width ||
      !metadata.height ||
      Math.max(metadata.width, metadata.height) > assetLimits().textureDimension
    )
      throw new Error("Invalid archive image type or dimensions");
    return `image/${expected}`;
  }
  if (ext === "bin") return "application/octet-stream";
  if (ext === "txt" || ext === "json") {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\0")) throw new Error("Invalid archive text");
    if (ext === "json") JSON.parse(text);
    return ext === "json" ? "application/json" : "text/plain";
  }
  throw new Error(`Unsupported archive file type: ${ext}`);
}

/** メモリ内でのみ展開。ZIP64・暗号化・リンクは明示的に拒否する。 */
export async function extractAssetArchive(
  bytes: Uint8Array,
  limits: ArchiveLimits = {
    expandedBytes: assetLimits().aggregateBytes,
    fileCount: 256,
  },
): Promise<ArchiveFile[]> {
  if (bytes.length > assetLimits().sourceBytes)
    throw new Error("Archive exceeds source size limit");
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--)
    if (
      data.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + data.readUInt16LE(i + 20) === data.length
    ) {
      end = i;
      break;
    }
  if (end < 0) throw new Error("Invalid ZIP end record");
  const count = data.readUInt16LE(end + 10),
    start = data.readUInt32LE(end + 16),
    size = data.readUInt32LE(end + 12);
  if (
    data.readUInt16LE(end + 4) ||
    data.readUInt16LE(end + 6) ||
    data.readUInt16LE(end + 8) !== count ||
    count === 65535 ||
    start === 0xffffffff ||
    start + size !== end
  )
    throw new Error("Unsupported ZIP layout");
  if (count > limits.fileCount)
    throw new Error("Archive exceeds file count limit");
  const entries: {
    name: string;
    offset: number;
    compressed: number;
    expanded: number;
    method: number;
    crc: number;
  }[] = [];
  const names = new Set<string>();
  let cursor = start,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || data.readUInt32LE(cursor) !== 0x02014b50)
      throw new Error("Invalid ZIP directory");
    const flags = data.readUInt16LE(cursor + 8),
      method = data.readUInt16LE(cursor + 10),
      compressed = data.readUInt32LE(cursor + 20),
      expanded = data.readUInt32LE(cursor + 24);
    const nameLength = data.readUInt16LE(cursor + 28),
      extra = data.readUInt16LE(cursor + 30),
      comment = data.readUInt16LE(cursor + 32),
      local = data.readUInt32LE(cursor + 42);
    if (
      cursor + 46 + nameLength + extra + comment > end ||
      flags & ~0x080e ||
      ![0, 8].includes(method) ||
      data.readUInt16LE(cursor + 34) ||
      ((data.readUInt32LE(cursor + 38) >>> 16) & 0xf000) === 0xa000
    )
      throw new Error("Unsupported ZIP entry");
    const name = safeArchivePath(
      new TextDecoder("utf-8", { fatal: true }).decode(
        data.subarray(cursor + 46, cursor + 46 + nameLength),
      ),
    );
    if (names.has(name.toLowerCase()))
      throw new Error("Duplicate archive path");
    names.add(name.toLowerCase());
    total += expanded;
    if (total > limits.expandedBytes)
      throw new Error("Archive exceeds expanded size limit");
    if (
      local + 30 > start ||
      data.readUInt32LE(local) !== 0x04034b50 ||
      data.readUInt16LE(local + 6) !== flags ||
      data.readUInt16LE(local + 8) !== method
    )
      throw new Error("Invalid ZIP local header");
    const localNameLength = data.readUInt16LE(local + 26),
      offset = local + 30 + localNameLength + data.readUInt16LE(local + 28);
    if (
      offset + compressed > start ||
      data
        .subarray(local + 30, local + 30 + localNameLength)
        .toString("utf8") !== name
    )
      throw new Error("ZIP header mismatch");
    if (name.endsWith("/")) {
      if (expanded || compressed)
        throw new Error("Invalid ZIP directory entry");
    } else
      entries.push({
        name,
        offset,
        compressed,
        expanded,
        method,
        crc: data.readUInt32LE(cursor + 16),
      });
    cursor += 46 + nameLength + extra + comment;
  }
  if (cursor !== end) throw new Error("Invalid ZIP directory size");
  const files: ArchiveFile[] = [];
  for (const entry of entries) {
    const compressed = data.subarray(
      entry.offset,
      entry.offset + entry.compressed,
    );
    const expanded =
      entry.method === 0
        ? compressed
        : inflateRawSync(compressed, {
            maxOutputLength: Math.max(1, entry.expanded),
          });
    if (expanded.length !== entry.expanded || crc32(expanded) !== entry.crc)
      throw new Error("ZIP size or checksum mismatch");
    files.push({
      name: entry.name,
      bytes: expanded,
      mime: await validateFile(entry.name, expanded),
    });
  }
  return files;
}
