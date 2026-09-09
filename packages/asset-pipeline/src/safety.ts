import type { JSONDocument } from "@gltf-transform/core";
import type { assetLimits } from "../../asset-core/src/limits";
export function validateDocumentHeader(
  json: JSONDocument["json"],
  limits: ReturnType<typeof assetLimits>,
) {
  let decodedBytes = 0;
  for (const buffer of json.buffers ?? []) {
    if (!Number.isSafeInteger(buffer.byteLength) || buffer.byteLength < 0)
      throw new Error("Invalid buffer size");
    decodedBytes += buffer.byteLength;
  }
  if (decodedBytes > limits.aggregateBytes)
    throw new Error("Decoded asset exceeds aggregate size limit");
  for (const accessor of json.accessors ?? []) {
    if (
      !Number.isSafeInteger(accessor.count) ||
      accessor.count < 0 ||
      accessor.count > limits.triangles * 3
    )
      throw new Error("Mesh exceeds triangle limit (accessor safety check)");
  }
  let decompressedBytes = 0;
  for (const view of json.bufferViews ?? []) {
    const extension = view.extensions?.EXT_meshopt_compression as
      { count?: number; byteStride?: number } | undefined;
    if (!extension) continue;
    const size = Number(extension.count) * Number(extension.byteStride);
    if (!Number.isSafeInteger(size) || size < 0)
      throw new Error("Invalid mesh compression size");
    decompressedBytes += size;
  }
  if (decompressedBytes > limits.aggregateBytes)
    throw new Error("Decoded mesh exceeds aggregate size limit");
}
