import { Accessor, Document, NodeIO } from "@gltf-transform/core";
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  Color,
  Shape,
  ExtrudeGeometry,
  Float32BufferAttribute,
  type BufferGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** 独自の完成用素材。頂点色と1素材で、インスタンス描画のDraw Callを抑える。 */
export async function alpineModelGlb(slot: string, variant = 0, level = 0) {
  const groups = new Map<string, BufferGeometry[]>();
  const add = (
    g: BufferGeometry,
    color: string,
    x = 0,
    y = 0,
    z = 0,
    rz = 0,
  ) => {
    g.rotateZ(rz);
    g.translate(x, y, z);
    const list = groups.get(color) ?? [];
    list.push(g);
    groups.set(color, list);
  };
  const box = (
    w: number,
    h: number,
    d: number,
    color: string,
    x = 0,
    y = h / 2,
    z = 0,
    rz = 0,
  ) => add(new BoxGeometry(w, h, d), color, x, y, z, rz);
  const timber = "#57412c",
    stone = "#c6c0a6",
    roof = variant % 2 ? "#636e70" : "#8e4e36";
  if (slot.includes(".pine")) {
    add(new CylinderGeometry(0.23, 0.45, 5, 7), timber, 0, 2.5);
    for (let i = 0; i < 4; i++)
      add(
        new ConeGeometry(2.2 - i * 0.4, 3.5, 8),
        i % 2 ? "#426c3e" : "#365a3b",
        0,
        3.3 + i * 1.45,
      );
  } else if (slot.includes(".oak")) {
    add(new CylinderGeometry(0.3, 0.55, 4.8, 7), timber, 0, 2.4);
    for (let i = 0; i < (level > 1 ? 3 : level ? 5 : 7); i++) {
      const angle = i * 2.4;
      const g = new IcosahedronGeometry(1.8 + (i % 3) * 0.3, level ? 0 : 1);
      g.scale(1, 1.15, 0.9);
      add(
        g,
        i % 2 ? "#567e37" : "#6a913e",
        Math.cos(angle) * 1.5,
        4.7 + (i % 3) * 0.7,
        Math.sin(angle) * 1.5,
      );
    }
  } else if (slot.includes(".wall")) {
    if (level > 0) box(3, 0.7, 0.6, "#9d9a8e");
    else
      for (let row = 0; row < 3; row++)
        for (let i = 0; i < 5; i++) {
          const g = new IcosahedronGeometry(0.45, 0);
          g.scale(0.79, 0.45, 0.7);
          add(
            g,
            row % 2 ? "#8e8b7f" : (i + row) % 3 ? "#aba798" : "#7f8470",
            -1.2 + i * 0.6 + (row % 2 ? 0.12 : 0),
            0.16 + row * 0.25,
            ((i % 2) - 0.5) * 0.07,
          );
        }
  } else if (slot.includes(".fence")) {
    // 3mの横木と杭。遠景は横木だけにして杭の細部を省く。
    const rail = "#7a5f40",
      post = "#5f4930";
    if (level < 2)
      for (const x of [-1.38, 1.38]) box(0.13, 1.15, 0.13, post, x, 0.575, 0);
    for (const y of level < 2 ? [0.52, 0.94] : [0.75])
      box(3, level < 2 ? 0.09 : 0.32, 0.06, rail, 0, y, 0);
  } else if (slot.includes(".well")) {
    const segments = level ? 8 : 14;
    add(new CylinderGeometry(1, 1.08, 0.85, segments), "#9b988c", 0, 0.425);
    add(new CylinderGeometry(0.82, 0.82, 0.04, segments), "#2f4a55", 0, 0.8);
    for (const x of [-0.95, 0.95]) box(0.14, 2.1, 0.14, timber, x, 1.05);
    box(2.1, 0.1, 0.1, timber, 0, 1.75);
    const shape = new Shape();
    shape.moveTo(-1.35, 0);
    shape.lineTo(0, 0.75);
    shape.lineTo(1.35, 0);
    shape.closePath();
    const cover = new ExtrudeGeometry(shape, {
      depth: 1.6,
      bevelEnabled: false,
    });
    cover.translate(0, 0, -0.8);
    add(cover, roof, 0, 2.05);
  } else if (slot.includes(".sheep")) {
    const wool = "#ebe7dc",
      face = "#3d3631";
    add(
      new IcosahedronGeometry(0.55, level ? 0 : 1).scale(1.3, 0.85, 0.85),
      wool,
      0,
      0.78,
      0,
    );
    box(0.3, 0.32, 0.26, face, 0.78, 0.92, 0);
    if (level < 2)
      for (const [x, z] of [
        [0.38, 0.2],
        [0.38, -0.2],
        [-0.38, 0.2],
        [-0.38, -0.2],
      ])
        box(0.09, 0.42, 0.09, face, x, 0.21, z);
  } else if (slot.includes(".wheat")) {
    // 4m四方に畝と穂の小群を作り、近景で立体感を保つ。
    const count = level > 1 ? 1 : level ? 3 : 7;
    for (let x = 0; x < count; x++)
      for (let z = 0; z < count; z++) {
        const px =
            count === 1
              ? 0
              : -1.75 +
                (x * 3.5) / (count - 1) +
                Math.sin(x * 17 + z * 9) * 0.12,
          pz =
            count === 1
              ? 0
              : -1.75 +
                (z * 3.5) / (count - 1) +
                Math.cos(x * 13 + z * 7) * 0.12;
        const h = 0.75 + ((x * 13 + z * 7) % 5) * 0.06;
        add(new ConeGeometry(0.025, h, 3), "#bba357", px, h / 2, pz);
        add(
          new IcosahedronGeometry(0.12, 0).scale(0.55, 1.65, 0.55),
          "#ddc77a",
          px + 0.02,
          h,
          pz,
        );
      }
  } else if (slot.includes(".windmill")) {
    add(new CylinderGeometry(2.5, 3.6, 12, 12), stone, 0, 6);
    add(new ConeGeometry(3.3, 3.4, 12), roof, 0, 13.3);
    box(1.5, 2.8, 0.3, timber, 0, 1.4, 3.3);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const g = new BoxGeometry(0.28, 8.7, 0.28);
      g.translate(0, 3.5, 0);
      add(g, timber + "|rotor", 0, 10.5, 3.05, a);
      for (let j = 0; j < 10; j++) {
        const blade = new BoxGeometry(1.5, 0.12, 0.18);
        blade.translate(0.5, 2 + j * 0.58, 0);
        add(blade, "#d6ccb1|rotor", 0, 10.5, 3.13, a);
      }
    }
    add(
      new CylinderGeometry(0.45, 0.45, 0.5, 8).rotateX(Math.PI / 2),
      timber,
      0,
      10.5,
      3.3,
    );
  } else {
    const barn = slot.includes(".barn"),
      wooden = slot.includes(".timber");
    const w = barn ? 9 : 6.8,
      d = barn ? 6.5 : 5.7,
      h = barn ? 4 : 5.2;
    box(w, h, d, wooden || barn ? "#a58057" : stone);
    // 実際の切妻屋根を三角柱で生成する。
    const shape = new Shape();
    shape.moveTo(-(w + 1) / 2, 0);
    shape.lineTo(0, 2.4);
    shape.lineTo((w + 1) / 2, 0);
    shape.closePath();
    const g = new ExtrudeGeometry(shape, { depth: d + 1, bevelEnabled: false });
    g.translate(0, 0, -(d + 1) / 2);
    add(g, roof, 0, h);
    box(w + 0.25, 0.2, d + 0.25, timber, 0, h - 0.2);
    box(1.2, 2.4, 0.18, timber, 0, 1.2, d / 2 + 0.05);
    for (const side of [-1, 1])
      for (const x of [-w * 0.3, w * 0.3]) {
        box(1.25, 1.55, 0.18, timber, x, 3.1, side * (d / 2 + 0.05));
        box(0.85, 1.15, 0.2, "#607b7c", x, 3.1, side * (d / 2 + 0.13));
        box(0.1, 1.2, 0.24, stone, x, 3.1, side * (d / 2 + 0.15));
      }
    if (wooden) {
      for (const x of [-w / 2, 0, w / 2]) box(0.18, h, d + 0.2, timber, x);
    }
    if (!barn) box(0.8, 3, 0.8, "#96917f", w * 0.27, h + 1, 0);
    if (barn) {
      box(3.3, 3.5, 0.22, timber, 0, 1.75, d / 2 + 0.17);
    }
  }
  // 色を頂点へ移して1素材に統合し、色別Draw Callを増やさない。
  const components = new Map<string, BufferGeometry[]>();
  for (const [color, list] of groups) {
    const key = color.includes("|rotor")
      ? "alpine-windmill-rotor"
      : "alpine-body";
    const rgb = new Color(color.split("|")[0]).toArray();
    for (const part of list) {
      const flat = part.index ? part.toNonIndexed() : part;
      const colors = new Float32Array(flat.getAttribute("position").count * 3);
      for (let i = 0; i < colors.length; i += 3) colors.set(rgb, i);
      flat.setAttribute("color", new Float32BufferAttribute(colors, 3));
      const geometries = components.get(key) ?? [];
      geometries.push(flat);
      components.set(key, geometries);
      if (flat !== part) part.dispose();
    }
  }
  const doc = new Document(),
    buffer = doc.createBuffer(),
    scene = doc.createScene();
  const material = doc
    .createMaterial()
    .setBaseColorFactor([1, 1, 1, 1])
    .setRoughnessFactor(1)
    .setMetallicFactor(0);
  for (const [name, list] of components) {
    const g = mergeGeometries(list)!;
    const primitive = doc.createPrimitive().setMaterial(material);
    for (const [attribute, semantic] of [
      ["position", "POSITION"],
      ["normal", "NORMAL"],
      ["color", "COLOR_0"],
    ])
      primitive.setAttribute(
        semantic,
        doc
          .createAccessor()
          .setType(Accessor.Type.VEC3)
          .setArray(new Float32Array(g.getAttribute(attribute).array))
          .setBuffer(buffer),
      );
    scene.addChild(
      doc
        .createNode()
        .setName(name)
        .setMesh(doc.createMesh().addPrimitive(primitive)),
    );
    g.dispose();
    list.forEach((part) => part.dispose());
  }
  return new NodeIO().writeBinary(doc);
}
