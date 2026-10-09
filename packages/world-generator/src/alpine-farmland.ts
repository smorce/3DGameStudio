import type { WorldDesign } from "../../project-schema/src/index";

/** 内陸ワールドだけに適用する景観定義。既存Schemaの拡張は不要。 */
export const isAlpineVillage = (design: WorldDesign) =>
  design.islands.some((island) => island.id === "alpine-mainland");
export const alpineFields = [
  {
    id: "wheat-west",
    crop: "wheat",
    points: [
      [-150, 35],
      [-35, 20],
      [-22, 130],
      [-175, 160],
    ],
  },
  {
    id: "wheat-east",
    crop: "wheat",
    points: [
      [35, -5],
      [145, -30],
      [170, 55],
      [50, 85],
    ],
  },
  {
    id: "meadow",
    crop: "grass",
    points: [
      [-175, -45],
      [-65, -35],
      [-60, 8],
      [-155, 20],
    ],
  },
  {
    id: "stubble",
    crop: "stubble",
    points: [
      [55, 105],
      [180, 80],
      [205, 170],
      [75, 190],
    ],
  },
  {
    id: "soil",
    crop: "soil",
    points: [
      [-230, 70],
      [-185, 55],
      [-207, 180],
      [-265, 155],
    ],
  },
] as const;
export function alpineFieldAt(x: number, z: number) {
  return alpineFields.find(({ points }) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i],
        b = points[j];
      if (
        a[1] > z !== b[1] > z &&
        x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]
      )
        inside = !inside;
    }
    return inside;
  });
}
export function alpineSurfaceColor(
  x: number,
  z: number,
  height: number,
  fallback: string,
) {
  const field = alpineFieldAt(x, z);
  if (field) {
    const stripe = Math.floor((x + z * 0.18) / 2) % 2 === 0;
    return field.crop === "wheat"
      ? stripe
        ? "#d5bf6d"
        : "#b5a358"
      : field.crop === "stubble"
        ? stripe
          ? "#b39b67"
          : "#918255"
        : field.crop === "soil"
          ? stripe
            ? "#826342"
            : "#675339"
          : "#9ab76d";
  }
  if (height < 65) return "#789756";
  return height > 145 ? "#c3ccce" : height > 75 ? "#95a3a2" : fallback;
}
