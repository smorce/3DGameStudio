import { alpineNoise } from "./alpine-landscape";
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
      [-110, 26],
      [-65, 25],
      [-35, 20],
      [-27, 62],
      [-22, 110],
      [-33, 139],
      [-98, 153],
      [-175, 160],
      [-164, 95],
    ],
  },
  {
    id: "wheat-east",
    crop: "wheat",
    points: [
      [35, -5],
      [83, -22],
      [145, -30],
      [158, 10],
      [170, 55],
      [128, 69],
      [87, 73],
      [50, 85],
      [43, 45],
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
  cache?: Map<string, number>,
) {
  const field = alpineFieldAt(x, z);
  if (field) {
    const stripe = Math.sin((x + z * 0.18) * Math.PI) > 0;
    return field.crop === "wheat"
      ? stripe
        ? "#bcaa65"
        : "#b7a460"
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
  const variation = alpineNoise(x, z, 55, 42, cache);
  if (height < 65)
    return variation > 0.15
      ? "#718b45"
      : variation < -0.2
        ? "#839750"
        : "#7c914b";
  if (height > 210 + variation * 25) return "#dedfd7";
  if (height > 130 + variation * 30)
    return variation > 0 ? "#9b9c90" : "#878d80";
  return height > 80 ? "#778568" : fallback;
}
