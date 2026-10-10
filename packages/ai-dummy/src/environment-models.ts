import { Accessor, Document, NodeIO } from "@gltf-transform/core";
import {
  BoxGeometry,
  CylinderGeometry,
  PlaneGeometry,
  Vector3,
  Quaternion,
  Shape,
  ShapeGeometry,
  ExtrudeGeometry,
  Path,
  IcosahedronGeometry,
  Color,
  Float32BufferAttribute,
  type BufferGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  EnvironmentMaterials,
  surfacePixels,
  type EnvironmentSurface,
  environmentRecipeVersion,
} from "./environment-materials";

export type EnvironmentModel = "oak" | "pine" | "house" | "grass" | "market";
export function qualityModelKind(slot: string): EnvironmentModel | undefined {
  if (slot === "nature.tree.quality.oak") return "oak";
  if (slot === "nature.tree.quality.pine") return "pine";
  if (slot === "building.quality.house") return "house";
  if (slot === "nature.grass.quality.grass") return "grass";
  if (slot === "prop.quality.market") return "market";
}
/** 葉や樹冠でプレイヤーを遮らず、幹だけを既存Collider経路へ渡す。 */
export function environmentTreeCollider(kind: "oak" | "pine") {
  const geometry = new CylinderGeometry(
    kind === "pine" ? 0.14 : 0.2,
    kind === "pine" ? 0.3 : 0.42,
    kind === "pine" ? 10 : 7.7,
    8,
  );
  geometry.translate(0.065, kind === "pine" ? 5 : 3.85, 0.05);
  const collider = {
    version: 1,
    vertices: Array.from(geometry.getAttribute("position").array),
    indices: Array.from(geometry.index!.array),
  };
  geometry.dispose();
  return new TextEncoder().encode(JSON.stringify(collider));
}
/** メートル単位。Seedと明示LODから再生成でき、Alpineの地形には依存しない。 */
export async function environmentModelGlb(
  kind: EnvironmentModel,
  seed = 0,
  level = 0,
) {
  const parts = new Map<EnvironmentSurface, BufferGeometry[]>();
  const farTree = level === 2 && (kind === "oak" || kind === "pine");
  const averageColors = new Map<EnvironmentSurface, number[]>();
  const averageColor = (surface: EnvironmentSurface) => {
    const cached = averageColors.get(surface);
    if (cached) return cached;
    const pixels = surfacePixels(surface, 128).color;
    const color = new Color(),
      rgb = [0, 0, 0];
    for (let i = 0; i < pixels.length; i += 4) {
      color
        .setRGB(pixels[i] / 255, pixels[i + 1] / 255, pixels[i + 2] / 255)
        .convertSRGBToLinear();
      rgb[0] += color.r;
      rgb[1] += color.g;
      rgb[2] += color.b;
    }
    const result = rgb.map((value) => value / (pixels.length / 4));
    averageColors.set(surface, result);
    return result;
  };
  let state = (seed + 1) >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const add = (surface: EnvironmentSurface, geometry: BufferGeometry) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    const farHouseWood =
      kind === "house" && level === 2 && ["wood", "glass"].includes(surface);
    if (farTree || farHouseWood) {
      const rgb = farHouseWood
        ? averageColor(surface)
        : new Color(
            surface === "bark"
              ? "#675339"
              : surface === "needle"
                ? "#3a683d"
                : "#638b30",
          ).toArray();
      const colors = new Float32Array(flat.getAttribute("position").count * 3);
      for (let i = 0; i < colors.length; i += 3) colors.set(rgb, i);
      flat.setAttribute("color", new Float32BufferAttribute(colors, 3));
    }
    const key = farTree ? "leaf" : farHouseWood ? "wood" : surface;
    const list = parts.get(key) ?? [];
    list.push(flat);
    parts.set(key, list);
  };
  const branch = (a: Vector3, b: Vector3, radius: number) => {
    const delta = b.clone().sub(a);
    const geometry = new CylinderGeometry(
      radius * 0.48,
      radius,
      delta.length(),
      level === 2 ? 5 : 8,
    );
    geometry.applyQuaternion(
      new Quaternion().setFromUnitVectors(
        new Vector3(0, 1, 0),
        delta.normalize(),
      ),
    );
    geometry.translate(...a.clone().add(b).multiplyScalar(0.5).toArray());
    add("bark", geometry);
  };
  const card = (
    surface: EnvironmentSurface,
    p: Vector3,
    width: number,
    height: number,
  ) => {
    const g = new PlaneGeometry(
      width * (0.8 + random() * 0.4),
      height * (0.85 + random() * 0.3),
    );
    const vertices = g.getAttribute("position");
    vertices.setZ(0, width * 0.08);
    vertices.setZ(3, -width * 0.06);
    g.computeVertexNormals();
    g.rotateX((random() - 0.5) * 1.9);
    g.rotateY(random() * Math.PI * 2);
    g.rotateZ((random() - 0.5) * 0.7);
    g.translate(...p.toArray());
    add(surface, g);
  };
  if (kind === "oak" || kind === "pine") {
    const pine = kind === "pine",
      top = pine ? 10 : 7.7;
    branch(new Vector3(), new Vector3(0.13, top, 0.1), pine ? 0.3 : 0.42);
    {
      const count = pine ? 32 : 13;
      for (let i = 0; i < count; i++) {
        // 枝の骨格はLODを跨いでも同じSeedから生成する。
        state =
          (Math.imul(seed + 1, 2654435761) + Math.imul(i + 1, 2246822519)) >>>
          0;
        const angle = i * 2.399963 + random() * 0.55;
        const y = pine ? 1.9 + (i / count) * 7.4 : 2.8 + random() * 3.4;
        const radius = pine ? (1 - i / count) * 3 + 0.3 : 1.8 + random() * 1.5;
        const a = new Vector3(0.05, y, 0),
          b = new Vector3(
            Math.cos(angle) * radius,
            y + (pine ? 0.1 : 1.0),
            Math.sin(angle) * radius,
          );
        if (farTree && (pine ? i % 4 !== 0 : i % 3 === 2)) continue;
        if (!farTree) branch(a, b, pine ? 0.085 : 0.12);
        if (farTree) {
          // 全LODで同じ枝先を使い、樹冠の中心と張り出しを揃える。
          const g = new IcosahedronGeometry(1, 0);
          const canopyRadius = pine ? (1 - i / count) * 2.8 + 0.4 : 1.65;
          g.scale(canopyRadius, pine ? 1.0 : 1.8, canopyRadius);

          const p = a
            .clone()
            .lerp(b, pine ? 0.13 : 0.78)
            .add(new Vector3(0, pine ? 0.6 : 0.75, 0));
          g.rotateY(angle);
          g.translate(...p.toArray());
          add(pine ? "needle" : "leaf", g);
          continue;
        }
        if (pine && level === 2 && i % 2) continue;
        const cards =
          level === 2
            ? pine
              ? 3
              : 5
            : level === 1
              ? pine
                ? 8
                : 14
              : pine
                ? 14
                : 28;
        for (let j = 0; j < cards; j++) {
          const t = 0.6 + random() * 0.4;
          const p = a
            .clone()
            .lerp(b, t)
            .add(
              new Vector3(
                (random() - 0.5) * 1.6,
                random() * (pine ? 0.8 : 1.9),
                (random() - 0.5) * 1.6,
              ),
            );
          card(
            pine ? "needle" : "leaf",
            p,
            (pine ? 1.7 : 1.55) * (level === 2 ? 1.65 : level === 1 ? 1.15 : 1),
            (pine ? 0.85 : 1.25) *
              (level === 2 ? 1.65 : level === 1 ? 1.15 : 1),
          );
        }
        if (!pine && level < 2)
          branch(
            b.clone().lerp(a, 0.3),
            b.clone().add(new Vector3(0.3, 1.1, -0.3)),
            0.045,
          );
      }
    }
  } else if (kind === "grass") {
    for (let i = 0; i < (level === 2 ? 1 : level === 1 ? 4 : 10); i++)
      card(
        "grass",
        new Vector3((random() - 0.5) * 1.1, 0.35, (random() - 0.5) * 1.1),
        0.6,
        0.7,
      );
  } else if (kind === "market") {
    const box = (
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      surface: EnvironmentSurface = "wood",
    ) => add(surface, new BoxGeometry(w, h, d).translate(x, y, z));
    box(2.6, 0.16, 1.25, 0, 1.0, 0);
    for (const x of [-1.15, 1.15])
      for (const z of [-0.5, 0.5]) box(0.12, 2.4, 0.12, x, 1.2, z);
    box(2.9, 0.12, 1.7, 0, 2.4, 0, "roof");
    if (level < 2) {
      for (const x of [-0.75, 0, 0.75]) box(0.58, 0.3, 0.62, x, 1.2, 0);
      const barrel = new CylinderGeometry(0.4, 0.36, 0.85, level ? 6 : 12);
      barrel.translate(1.9, 0.425, 0);
      add("wood", barrel);
      box(1.3, 0.7, 0.85, -1.9, 0.35, 0.2);
    }
  } else {
    const box = (
      surface: EnvironmentSurface,
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      angle = 0,
    ) => {
      const g = new BoxGeometry(w, h, d);
      if (["roof", "stone", "wood"].includes(surface)) {
        const uv = g.getAttribute("uv");
        for (let i = 0; i < uv.count; i++)
          uv.setXY(
            i,
            uv.getX(i) * (surface === "roof" ? 3 : surface === "stone" ? 2 : 1),
            uv.getY(i) * (surface === "roof" ? 3 : surface === "stone" ? 2 : 1),
          );
      }
      g.rotateZ(angle);
      g.translate(x, y, z);
      add(surface, g);
    };
    box("stone", 6.8, 2.6, 5.7, 0, 1.3, 0);
    box("plaster", 6.8, 2.6, 5.7, 0, 3.9, 0);
    const shape = new Shape();
    const roofRise = 2.4 + ((seed % 3) - 1) * 0.18;
    shape.moveTo(-3.9, 0);
    shape.lineTo(0, roofRise);
    shape.lineTo(3.9, 0);
    shape.closePath();
    const slope = Math.atan2(roofRise, 3.9);
    for (const side of [-1, 1]) {
      box(
        "roof",
        Math.hypot(3.9, roofRise),
        0.23,
        6.9,
        side * 1.95,
        5.2 + roofRise / 2,
        0,
        -side * slope,
      );
      const gable = new ShapeGeometry(shape);
      if (side < 0) gable.rotateY(Math.PI);
      gable.translate(0, 5.2, side * 2.87);
      add("plaster", gable);
      box("wood", 0.16, roofRise, 0.2, 0, 5.2 + roofRise / 2, side * 2.9);
      box("wood", 7.2, 0.16, 0.24, 0, 5.22, side * 2.9);
    }
    // 棟と破風・軒先は全LODに残し、切替時の輪郭を揃える。
    box("roof", 0.28, 0.24, 7.05, 0, 5.2 + roofRise, 0);
    for (const side of [-1, 1]) {
      box("wood", 0.18, 0.25, 6.95, side * 3.9, 5.15, 0);
      for (const end of [-1, 1])
        box(
          "wood",
          Math.hypot(3.9, roofRise),
          0.22,
          0.18,
          side * 1.95,
          5.2 + roofRise / 2,
          end * 3.46,
          -side * slope,
        );
    }
    const window = (
      horizontal: number,
      y: number,
      side: number,
      flank: boolean,
    ) => {
      const panel = (
        surface: EnvironmentSurface,
        w: number,
        h: number,
        depth: number,
        offset: number,
        dy = 0,
      ) => {
        if (flank)
          box(surface, depth, h, w, side * (3.4 + offset), y + dy, horizontal);
        else
          box(surface, w, h, depth, horizontal, y + dy, side * (2.85 + offset));
      };
      // 中央を空けた枠にして、ガラスを奥へ置き、ガラス裏の木材描画を省く。
      const shape = new Shape();
      shape.moveTo(-0.525, -0.65);
      shape.lineTo(0.525, -0.65);
      shape.lineTo(0.525, 0.65);
      shape.lineTo(-0.525, 0.65);
      shape.closePath();
      const opening = new Path();
      opening.moveTo(-0.39, -0.51);
      opening.lineTo(-0.39, 0.51);
      opening.lineTo(0.39, 0.51);
      opening.lineTo(0.39, -0.51);
      opening.closePath();
      shape.holes.push(opening);
      const frame = new ExtrudeGeometry(shape, {
        depth: 0.14,
        bevelEnabled: false,
        steps: 1,
      });
      const uv = frame.getAttribute("uv");
      for (let i = 0; i < uv.count; i++)
        uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 3);
      frame.translate(0, 0, 0.07);
      frame.rotateY(flank ? (side * Math.PI) / 2 : side < 0 ? Math.PI : 0);
      frame.translate(
        flank ? side * 3.4 : horizontal,
        y,
        flank ? horizontal : side * 2.85,
      );
      add("wood", frame);
      panel("glass", 0.78, 1.02, 0.035, 0.15);
      panel("wood", 1.22, 0.1, 0.4, 0.13, -0.7);
      if (level < 2) {
        panel("wood", 0.055, 1.08, 0.05, 0.2);
        panel("wood", 0.83, 0.055, 0.05, 0.2);
      }
    };
    for (const side of [-1, 1]) {
      for (const x of [-3.4, -1.7, 0, 1.7, 3.4])
        box("wood", 0.18, 5.2, 0.2, x, 2.6, side * 2.87);
      for (const y of [0.25, 2.6, 5.1])
        box("wood", 6.9, 0.18, 0.22, 0, y, side * 2.89);
      for (const x of [-2.55, 2.55]) {
        box("wood", 0.16, 2.85, 0.2, x, 3.85, side * 2.9, x > 0 ? -0.6 : 0.6);
        window(x, 1.65, side, false);
      }
      // 正面の上階は2窓、背面は1窓。補強材の間の区画へ配置する。
      for (const x of side > 0 ? [-0.85, 0.85] : [0.85])
        window(x, 3.85, side, false);
      for (const z of [-2.85, -1.4, 0, 1.4, 2.85])
        box("wood", 0.22, 5.2, 0.18, side * 3.42, 2.6, z);
      for (const y of [0.25, 2.6, 5.1])
        box("wood", 0.22, 0.18, 5.8, side * 3.42, y, 0);
      for (const z of [-0.7, 0.7]) {
        window(z, 3.85, side, true);
        if (side > 0 || z < 0) window(z, 1.55, side, true);
      }
      for (const z of [-2.12, 2.12]) {
        const brace = new BoxGeometry(0.2, 2.8, 0.15);
        brace.rotateX(z > 0 ? 0.48 : -0.48);
        brace.translate(side * 3.43, 3.85, z);
        add("wood", brace);
      }
    }
    box("wood", 1.15, 2.25, 0.2, ((seed % 3) - 1) * 0.3, 1.125, 2.98);
    const doorX = ((seed % 3) - 1) * 0.3;
    box("wood", 1.42, 0.15, 0.32, doorX, 2.32, 3.02);
    for (const dx of [-0.66, 0.66])
      box("wood", 0.14, 2.3, 0.32, doorX + dx, 1.15, 3.02);
    box("stone", 1.65, 0.16, 0.58, doorX, 0.08, 3.1);
    box("stone", 0.8, 3, 0.8, seed % 2 ? -1.83 : 1.83, 6.2, 0);
  }
  const doc = new Document(),
    buffer = doc.createBuffer(),
    scene = doc
      .createScene()
      .setExtras({ environmentRecipeVersion, environmentSeed: seed }),
    materials = new EnvironmentMaterials(doc);
  for (const [surface, list] of parts) {
    const geometry = mergeGeometries(list)!;
    const farHouseWood = kind === "house" && level === 2 && surface === "wood";
    const primitive = doc.createPrimitive().setMaterial(
      farTree || farHouseWood
        ? doc
            .createMaterial(
              farTree ? "environment-far" : "environment-house-far-wood",
            )
            .setBaseColorFactor([1, 1, 1, 1])
            .setRoughnessFactor(1)
            .setMetallicFactor(0)
        : await materials.get(surface),
    );
    for (const [name, semantic, type] of [
      ["position", "POSITION", Accessor.Type.VEC3],
      ["normal", "NORMAL", Accessor.Type.VEC3],
      ["uv", "TEXCOORD_0", Accessor.Type.VEC2],
    ] as const)
      primitive.setAttribute(
        semantic,
        doc
          .createAccessor()
          .setType(type)
          .setArray(new Float32Array(geometry.getAttribute(name).array))
          .setBuffer(buffer),
      );
    if (farTree || farHouseWood)
      primitive.setAttribute(
        "COLOR_0",
        doc
          .createAccessor()
          .setType(Accessor.Type.VEC3)
          .setArray(new Float32Array(geometry.getAttribute("color").array))
          .setBuffer(buffer),
      );
    scene.addChild(
      doc
        .createNode(`${kind}-${surface}`)
        .setMesh(doc.createMesh().addPrimitive(primitive)),
    );
    geometry.dispose();
    list.forEach((g) => g.dispose());
  }
  return new NodeIO().writeBinary(doc);
}
