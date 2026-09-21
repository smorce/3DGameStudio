import { Accessor, Document, NodeIO } from "@gltf-transform/core";
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  type BufferGeometry,
} from "three";
/** プロジェクト所有の低ポリ素材。外部モデル・画像を取得しない。 */
export async function demoPrimitiveGlb(slot: string) {
  const document = new Document(),
    buffer = document.createBuffer(),
    scene = document.createScene();
  const add = (
    geometry: BufferGeometry,
    color: number[],
    position: number[] = [0, 0, 0],
  ) => {
    const material = document
      .createMaterial()
      .setBaseColorFactor([...color, 1] as [number, number, number, number])
      .setRoughnessFactor(1);
    const primitive = document.createPrimitive().setMaterial(material);
    for (const [attribute, semantic] of [
      ["position", "POSITION"],
      ["normal", "NORMAL"],
    ]) {
      const data = geometry.getAttribute(attribute);
      if (data)
        primitive.setAttribute(
          semantic,
          document
            .createAccessor()
            .setType(Accessor.Type.VEC3)
            .setArray(new Float32Array(data.array))
            .setBuffer(buffer),
        );
    }
    if (geometry.index)
      primitive.setIndices(
        document
          .createAccessor()
          .setType(Accessor.Type.SCALAR)
          .setArray(new Uint16Array(geometry.index.array))
          .setBuffer(buffer),
      );
    scene.addChild(
      document
        .createNode()
        .setMesh(document.createMesh().addPrimitive(primitive))
        .setTranslation(position as [number, number, number]),
    );
    geometry.dispose();
  };
  const box = (
    w: number,
    h: number,
    d: number,
    color: number[],
    x = 0,
    y = h / 2,
    z = 0,
  ) => add(new BoxGeometry(w, h, d), color, [x, y, z]);
  const trunk = [0.39, 0.26, 0.14],
    green = [0.27, 0.49, 0.27],
    stone = [0.5, 0.53, 0.55];
  if (slot.includes("tree")) {
    add(new CylinderGeometry(0.22, 0.35, 4, 6), trunk, [0, 2, 0]);
    if (slot.includes("tropical")) {
      for (let i = 0; i < 6; i++) {
        const leaf = new ConeGeometry(0.85, 3.6, 4);
        leaf.rotateZ(Math.PI / 2.7);
        leaf.translate(1.1, 0, 0);
        leaf.rotateY((i * Math.PI) / 3);
        add(leaf, [0.23, 0.58, 0.34], [0, 4.2, 0]);
      }
    } else if (slot.includes("alpine")) {
      for (let i = 0; i < 3; i++)
        add(new ConeGeometry(1.7 - i * 0.35, 2.8, 7), green, [
          0,
          2.4 + i * 1.3,
          0,
        ]);
    } else add(new IcosahedronGeometry(2, 0), green, [0, 4, 0]);
  } else if (slot.includes("cactus")) {
    const cactus = [0.34, 0.49, 0.27];
    add(new CylinderGeometry(0.35, 0.4, 3.6, 6), cactus, [0, 1.8, 0]);
    box(1.6, 0.45, 0.45, cactus, 0.6, 1.8);
    box(0.4, 1.5, 0.4, cactus, 1.25, 2.3);
  } else if (slot.includes("rock")) {
    const geometry = new IcosahedronGeometry(
      slot.includes("large") ? 2.6 : 1.1,
      0,
    );
    geometry.scale(1.2, 0.7, 0.9);
    add(
      geometry,
      slot.includes("desert")
        ? [0.64, 0.39, 0.23]
        : slot.includes("snow")
          ? [0.77, 0.83, 0.87]
          : stone,
      [0, slot.includes("large") ? 1.5 : 0.6, 0],
    );
  } else if (slot.includes("jump_ramp")) {
    const geometry = new BoxGeometry(6, 1.5, 8);
    const p = geometry.getAttribute("position");
    for (let i = 0; i < p.count; i++)
      p.setY(i, p.getY(i) > 0 ? ((p.getZ(i) + 4) / 8) * 1.5 : 0);
    geometry.computeVertexNormals();
    add(geometry, [0.72, 0.48, 0.24]);
  } else if (slot.includes("lighthouse")) {
    add(new CylinderGeometry(1.3, 2, 11, 8), [0.91, 0.87, 0.73], [0, 5.5, 0]);
    add(
      new CylinderGeometry(1.65, 1.65, 1.5, 8),
      [0.73, 0.25, 0.19],
      [0, 10.5, 0],
    );
    add(new ConeGeometry(2, 2, 8), [0.39, 0.45, 0.52], [0, 12, 0]);
  } else if (slot.includes("observatory")) {
    box(7, 4, 7, [0.72, 0.76, 0.78]);
    add(new IcosahedronGeometry(3.5, 1), [0.85, 0.9, 0.92], [0, 4, 0]);
  } else if (slot.includes("control_tower")) {
    box(3, 8, 3, [0.68, 0.7, 0.65]);
    box(5, 2, 5, [0.3, 0.5, 0.58], 0, 9);
  } else if (slot.includes("building")) {
    box(5, 3.5, 4, [0.78, 0.66, 0.46]);
    const roof = new ConeGeometry(4, 2, 4);
    roof.rotateY(Math.PI / 4);
    add(roof, [0.59, 0.29, 0.2], [0, 4.4, 0]);
  } else {
    box(0.2, 2.5, 0.2, trunk);
    box(1.6, 0.8, 0.15, [0.95, 0.76, 0.3], 0, 2.4);
  }
  return new NodeIO().writeBinary(document);
}
