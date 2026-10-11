import { Accessor, Document, NodeIO } from "@gltf-transform/core";
import {
  BoxGeometry,
  CylinderGeometry,
  PlaneGeometry,
  Vector3,
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

import { buildTree } from "./environment-tree";
import { buildHouse } from "./environment-house";
import {
  environmentGeometryVersion,
  treeRules,
  houseRules,
  type TreeRules,
  type HouseRules,
} from "./environment-rules";

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
  rules?: TreeRules | HouseRules,
) {
  if (
    !Number.isSafeInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff ||
    ![0, 1, 2].includes(level)
  )
    throw new Error("Invalid environment seed or LOD level");
  const recipe =
    rules ??
    (kind === "house"
      ? houseRules(seed)
      : kind === "oak" || kind === "pine"
        ? treeRules(kind, seed)
        : undefined);
  if (recipe) {
    if (
      recipe.seed !== seed ||
      Object.values(recipe).some(
        (value) => typeof value === "number" && !Number.isFinite(value),
      )
    )
      throw new Error("Invalid environment rule parameters");
    if (kind === "house") {
      const r = recipe as HouseRules;
      if (
        r.width <= 0 ||
        r.depth <= 0 ||
        r.floorHeight <= 0 ||
        !Number.isInteger(r.floors) ||
        r.floors < 1 ||
        r.floors > 4 ||
        r.roofPitch <= 0 ||
        r.roofPitch >= 80 ||
        r.upperFloorOverhang < 0 ||
        r.roofOverhang < 0
      )
        throw new Error("Invalid house dimensions");
    } else if (kind === "oak" || kind === "pine") {
      const r = recipe as TreeRules;
      if (
        r.kind !== kind ||
        r.height <= 0 ||
        r.trunkRadius <= 0 ||
        r.crownRadius <= 0 ||
        !Number.isInteger(r.branches) ||
        r.branches < 1 ||
        r.branches > 128 ||
        !Number.isInteger(r.crownDensity) ||
        r.crownDensity < 1 ||
        r.crownDensity > 512
      )
        throw new Error("Invalid tree dimensions");
    }
  }
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
    buildTree(recipe as TreeRules, level, add);
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
    buildHouse(recipe as HouseRules, level, add);
  }
  const doc = new Document(),
    buffer = doc.createBuffer(),
    scene = doc.createScene().setExtras({
      environmentRecipeVersion,
      environmentSeed: seed,
      environmentGeometryVersion,
      environmentRules:
        rules ??
        (kind === "house"
          ? houseRules(seed)
          : kind === "oak" || kind === "pine"
            ? treeRules(kind, seed)
            : { seed, kind }),
      environmentLod: level,
    }),
    materials = new EnvironmentMaterials(
      doc,
      kind === "house" ? (recipe as HouseRules).materialPalette : "warm",
    );
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
