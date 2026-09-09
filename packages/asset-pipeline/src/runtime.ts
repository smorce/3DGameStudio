import { NodeIO, type Document } from "@gltf-transform/core";
import sharp from "sharp";
import {
  runtimeProfiles,
  type RuntimeProfile,
} from "../../asset-core/src/profiles";
import {
  ALL_EXTENSIONS,
  EXTMeshoptCompression,
} from "@gltf-transform/extensions";
import {
  simplify,
  weld,
  textureCompress,
  dedup,
  prune,
  normals,
} from "@gltf-transform/functions";
import {
  MeshoptDecoder,
  MeshoptEncoder,
  MeshoptSimplifier,
} from "meshoptimizer";
export const runtimeIO = () =>
  new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    "meshopt.decoder": MeshoptDecoder,
    "meshopt.encoder": MeshoptEncoder,
  });
export function triangleCount(doc: Document) {
  let count = 0;
  doc
    .getRoot()
    .listScenes()[0]
    ?.traverse((node) => {
      for (const primitive of node.getMesh()?.listPrimitives() ?? [])
        if (primitive.getMode() === 4)
          count +=
            (primitive.getIndices()?.getCount() ??
              primitive.getAttribute("POSITION")?.getCount() ??
              0) / 3;
    });
  return Math.floor(count);
}
export async function generateRuntime(
  doc: Document,
  profile: RuntimeProfile = "balanced",
) {
  await Promise.all([
    MeshoptDecoder.ready,
    MeshoptEncoder.ready,
    MeshoptSimplifier.ready,
  ]);
  const io = runtimeIO(),
    source = await io.writeBinary(doc),
    settings = runtimeProfiles[profile];
  const warnings: string[] = [];
  const optimized = await io.readBinary(source);
  await optimized.transform(dedup(), prune());
  const primitives = optimized
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives());
  if (
    primitives.every((p) => p.getMode() === 4) &&
    primitives.some((p) => !p.getAttribute("NORMAL"))
  )
    await optimized.transform(normals());
  await optimized.transform(weld());
  try {
    await optimized.transform(
      textureCompress({
        encoder: sharp,
        targetFormat: "webp",
        resize: [settings.textureDimension, settings.textureDimension],
        quality: settings.textureQuality,
      }),
    );
  } catch {
    warnings.push("Texture optimization failed; source textures retained");
  }
  const compress = async (document: Document) => {
    const backup = await io.writeBinary(document);
    try {
      document
        .createExtension(EXTMeshoptCompression)
        .setRequired(true)
        .setEncoderOptions({
          method: EXTMeshoptCompression.EncoderMethod.QUANTIZE,
        });
      return await io.writeBinary(document);
    } catch {
      warnings.push("Mesh compression failed; uncompressed runtime retained");
      return backup;
    }
  };
  const lodSource = await io.writeBinary(optimized);
  const textureBytes = optimized
    .getRoot()
    .listTextures()
    .reduce((sum, t) => {
      const size = t.getSize();
      return sum + (size ? (size[0] * size[1] * 4 * 4) / 3 : 0);
    }, 0);
  const levels = [
    {
      level: 0,
      bytes: await compress(optimized),
      triangles: triangleCount(optimized),
      distance: 0,
    },
  ];
  if (
    doc.getRoot().listSkins().length ||
    doc.getRoot().listAnimations().length ||
    doc
      .getRoot()
      .listMeshes()
      .some((m) =>
        m
          .listPrimitives()
          .some((p) => p.listTargets().length || p.getMode() !== 4),
      )
  )
    return { levels, warnings, textureBytes: Math.ceil(textureBytes) };
  try {
    for (const [level, ratio, distance] of [
      [1, settings.ratios[0], 60],
      [2, settings.ratios[1], 150],
    ]) {
      const lod = await io.readBinary(lodSource);
      await lod.transform(
        weld(),
        simplify({
          simplifier: MeshoptSimplifier,
          ratio,
          error: level === 1 ? 0.01 : 0.05,
        }),
      );
      const triangles = triangleCount(lod);
      if (triangles < levels.at(-1)!.triangles)
        levels.push({ level, bytes: await compress(lod), triangles, distance });
    }
  } catch {
    warnings.push("LOD generation failed; available levels retained");
  }
  return { levels, warnings, textureBytes: Math.ceil(textureBytes) };
}
