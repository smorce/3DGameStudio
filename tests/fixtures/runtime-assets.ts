import { Document, Accessor, NodeIO } from "@gltf-transform/core";
import { SphereGeometry } from "three";
import sharp from "sharp";
export async function detailedGlb(texture = false) {
  const geometry = new SphereGeometry(2, 64, 32),
    doc = new Document(),
    buffer = doc.createBuffer();
  const primitive = doc.createPrimitive();
  for (const [name, attribute] of [
    ["POSITION", "position"],
    ["NORMAL", "normal"],
    ["TEXCOORD_0", "uv"],
  ]) {
    const data = geometry.getAttribute(attribute);
    primitive.setAttribute(
      name,
      doc
        .createAccessor()
        .setType(data.itemSize === 3 ? Accessor.Type.VEC3 : Accessor.Type.VEC2)
        .setArray(new Float32Array(data.array))
        .setBuffer(buffer),
    );
  }
  primitive.setIndices(
    doc
      .createAccessor()
      .setType(Accessor.Type.SCALAR)
      .setArray(new Uint32Array(geometry.index!.array))
      .setBuffer(buffer),
  );
  const material = doc.createMaterial().setRoughnessFactor(0.8);
  if (texture) {
    const image = await sharp({
      create: {
        width: 2048,
        height: 2048,
        channels: 4,
        background: { r: 128, g: 170, b: 100, alpha: 1 },
      },
    })
      .composite([
        {
          input: Buffer.from(
            '<svg width="2048" height="2048"><rect width="1024" height="2048" fill="#235678"/></svg>',
          ),
        },
      ])
      .png()
      .toBuffer();
    material.setBaseColorTexture(
      doc.createTexture().setImage(image).setMimeType("image/png"),
    );
  }
  primitive.setMaterial(material);
  doc
    .createScene()
    .addChild(
      doc.createNode().setMesh(doc.createMesh().addPrimitive(primitive)),
    );
  geometry.dispose();
  return new NodeIO().writeBinary(doc);
}
export const runtimeCandidate = {
  id: "dense-rock",
  name: "検証用の岩",
  provider: "local",
  sourceUrl: "local:dense-rock",
  author: "Studio",
  license: "CC0",
  thumbnail: "",
  category: "rock",
};
export async function rampGlb() {
  const doc = new Document(),
    buffer = doc.createBuffer();
  const position = doc
    .createAccessor()
    .setType(Accessor.Type.VEC3)
    .setBuffer(buffer)
    .setArray(
      new Float32Array([
        -4, 1.5, -5, 4, 1.5, -5, -4, 1.5, 35, 4, 1.5, 35, -4, 2, -5, 4, 2, -5,
        -4, 4, 35, 4, 4, 35,
      ]),
    );
  const indices = doc
    .createAccessor()
    .setType(Accessor.Type.SCALAR)
    .setBuffer(buffer)
    .setArray(
      new Uint16Array([
        4, 6, 5, 5, 6, 7, 0, 1, 2, 1, 3, 2, 0, 4, 1, 1, 4, 5, 2, 3, 6, 3, 7, 6,
        0, 2, 4, 2, 6, 4, 1, 5, 3, 3, 5, 7,
      ]),
    );
  const primitive = doc
    .createPrimitive()
    .setAttribute("POSITION", position)
    .setIndices(indices)
    .setMaterial(doc.createMaterial().setBaseColorFactor([0.6, 0.5, 0.4, 1]));
  doc
    .createScene()
    .addChild(
      doc.createNode().setMesh(doc.createMesh().addPrimitive(primitive)),
    );
  return new NodeIO().writeBinary(doc);
}
