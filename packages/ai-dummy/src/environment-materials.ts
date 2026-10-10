import { Document, type Material } from "@gltf-transform/core";
import sharp from "sharp";

export type EnvironmentSurface =
  | "bark"
  | "leaf"
  | "needle"
  | "wood"
  | "stone"
  | "roof"
  | "grass"
  | "plaster"
  | "glass";

/** 外部画像を使わない、版固定の決定的な素材レシピ。色画像だけがsRGB。 */
export const environmentRecipeVersion = 2;
export function surfacePixels(surface: EnvironmentSurface, size = 128) {
  const color = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  const palette: Record<EnvironmentSurface, number[]> = {
    bark: [103, 83, 57],
    wood: [130, 99, 65],
    stone: [166, 162, 143],
    roof: [144, 78, 53],
    leaf: [99, 139, 48],
    needle: [58, 104, 61],
    grass: [130, 155, 65],
    plaster: [218, 209, 184],
    glass: [71, 105, 115],
  };
  const height = (x: number, y: number) => {
    const u = x / size,
      v = y / size;
    const grain = Math.sin(u * Math.PI * 32 + Math.sin(v * Math.PI * 4) * 1.5);
    if (surface === "bark" || surface === "wood")
      return grain * 0.6 + Math.sin(u * Math.PI * 76) * 0.15;
    if (surface === "glass")
      return 0.12 * Math.exp(-(((u + v - 0.85) * 5) ** 2)) - v * 0.06;
    if (surface === "plaster") return Math.sin(x * 9.3 + y * 17.7) * 0.025;
    if (surface === "stone" || surface === "roof") {
      const rows = surface === "stone" ? 4 : 8;
      const row = Math.floor(v * rows);
      const mortar =
        (v * rows) % 1 < 0.055 || (u * 4 + (row % 2) * 0.5) % 1 < 0.035;
      return mortar ? -1 : Math.sin((x + y) * 1.7) * 0.1;
    }
    return Math.sin(u * Math.PI * 12) * Math.sin(v * Math.PI * 18) * 0.15;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4,
        h = height(x, y);
      const hash = (a: number, b: number) => {
        const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
        return n - Math.floor(n);
      };
      const noise = hash(x, y) - 0.5;
      const row = Math.floor((y / size) * (surface === "roof" ? 8 : 4));
      const cell = Math.floor((x / size) * 4 + (row % 2) * 0.5);
      const variation =
        surface === "stone" || surface === "roof"
          ? (hash(cell, row) - 0.5) * 0.28
          : Math.sin((x / size) * 7 + Math.sin((y / size) * 5)) * 0.055;
      let alpha = 255;
      if (surface === "leaf" || surface === "needle" || surface === "grass") {
        alpha = 0;
        // 葉の小群を一枚のカードに収め、透明な余白を抑える。
        const count = surface === "grass" ? 8 : surface === "leaf" ? 62 : 22;
        for (let k = 0; k < count; k++) {
          const cx = 0.12 + ((k * 0.61803398875) % 1) * 0.76;
          const cy =
            surface === "grass"
              ? 0.58
              : 0.12 +
                ((k * (surface === "leaf" ? 0.754877666 : 0.381966)) % 1) *
                  0.76;
          const dx = x / size - cx,
            dy = y / size - cy;
          const rx =
            surface === "grass" ? 0.02 : surface === "needle" ? 0.035 : 0.058;
          const ry =
            surface === "grass" ? 0.41 : surface === "needle" ? 0.22 : 0.042;
          if (
            (dx + dy * Math.sin(k * 2.4) * 0.5) ** 2 / rx ** 2 +
              dy ** 2 / ry ** 2 <
            1
          )
            alpha = 255;
        }
      }
      for (let c = 0; c < 3; c++)
        color[i + c] = Math.max(
          0,
          Math.min(
            255,
            palette[surface][c] * (0.96 + h * 0.18 + noise * 0.09 + variation),
          ),
        );
      color[i + 3] = alpha;
      const dx =
        surface === "glass" ? 0 : (height(x + 1, y) - height(x - 1, y)) * 0.65;
      const dy =
        surface === "glass" ? 0 : (height(x, y + 1) - height(x, y - 1)) * 0.65;
      const len = Math.hypot(dx, dy, 1);
      normal.set(
        [128 - (dx / len) * 127, 128 - (dy / len) * 127, 128 + 127 / len, 255],
        i,
      );
      // glTF metallic-roughness: G=粗さ、B=金属度。数値画像は線形。
      roughness.set([255, 210 + h * 20, 0, 255], i);
    }
  return { color, normal, roughness };
}

/** 文書内の同種素材はMaterial/Textureを共有し、GLBに画像を埋め込む。 */
export class EnvironmentMaterials {
  private materials = new Map<EnvironmentSurface, Promise<Material>>();
  constructor(private doc: Document) {}
  get(surface: EnvironmentSurface) {
    let result = this.materials.get(surface);
    if (!result) {
      result = this.create(surface);
      this.materials.set(surface, result);
    }
    return result;
  }
  private async create(surface: EnvironmentSurface) {
    const pixels = surfacePixels(surface);
    const texture = async (key: keyof typeof pixels) =>
      this.doc
        .createTexture(`${surface}-${key}-v${environmentRecipeVersion}`)
        .setMimeType("image/png")
        .setImage(
          await sharp(pixels[key], {
            raw: { width: 128, height: 128, channels: 4 },
          })
            .png()
            .toBuffer(),
        );
    const material = this.doc
      .createMaterial(surface)
      .setMetallicFactor(0)
      .setRoughnessFactor(surface === "glass" ? 0.32 : 1)
      .setBaseColorTexture(await texture("color"));
    if (["leaf", "needle", "grass"].includes(surface))
      material.setAlphaMode("MASK").setAlphaCutoff(0.5).setDoubleSided(true);
    else
      material
        .setNormalTexture(await texture("normal"))
        .setMetallicRoughnessTexture(await texture("roughness"));
    return material;
  }
}
