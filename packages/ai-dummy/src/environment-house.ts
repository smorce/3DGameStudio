import {
  BoxGeometry,
  Shape,
  ShapeGeometry,
  Vector3,
  Quaternion,
  type BufferGeometry,
} from "three";
import type { EnvironmentSurface } from "./environment-materials";
import type { HouseRules } from "./environment-rules";

/** 全LODで同じ建築外形を使い、細部だけを間引く。 */
export function buildHouse(
  r: HouseRules,
  level: number,
  add: (s: EnvironmentSurface, g: BufferGeometry) => void,
) {
  const box = (
    s: EnvironmentSurface,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    angle = 0,
  ) => {
    const g = new BoxGeometry(w, h, d);
    g.rotateZ(angle);
    g.translate(x, y, z);
    add(s, g);
  };
  const beam = (a: Vector3, b: Vector3, thickness: number) => {
    const delta = b.clone().sub(a);
    const g = new BoxGeometry(thickness, delta.length(), thickness);
    g.applyQuaternion(
      new Quaternion().setFromUnitVectors(
        new Vector3(0, 1, 0),
        delta.normalize(),
      ),
    );
    g.translate(...a.clone().add(b).multiplyScalar(0.5).toArray());
    add("wood", g);
  };
  const height = r.floors * r.floorHeight;
  for (let floor = 0; floor < r.floors; floor++) {
    const overhang = floor > 0 ? r.upperFloorOverhang : 0;
    const w = r.width + 2 * overhang,
      d = r.depth + 2 * overhang;
    if (r.buildingType === "barn") box("stone", w, 0.4, d, 0, 0.2, 0);
    box(
      r.buildingType === "barn" ? "wood" : floor ? "plaster" : "stone",
      w,
      r.floorHeight,
      d,
      0,
      (floor + 0.5) * r.floorHeight,
      0,
    );
    for (const side of [-1, 1]) {
      box(
        "wood",
        w + 0.12,
        0.18,
        0.18,
        0,
        floor * r.floorHeight + 0.12,
        side * (d / 2 + 0.02),
      );
      box(
        "wood",
        0.18,
        0.18,
        d + 0.12,
        side * (w / 2 + 0.02),
        floor * r.floorHeight + 0.12,
        0,
      );
      if (level < 2) {
        for (const x of [-w / 2, -w / 4, 0, w / 4, w / 2])
          box(
            "wood",
            0.16,
            r.floorHeight,
            0.18,
            x,
            (floor + 0.5) * r.floorHeight,
            side * (d / 2 + 0.03),
          );
        for (const z of [-d / 2, 0, d / 2])
          box(
            "wood",
            0.18,
            r.floorHeight,
            0.16,
            side * (w / 2 + 0.03),
            (floor + 0.5) * r.floorHeight,
            z,
          );
        if (floor)
          for (const x of [-w * 0.375, w * 0.375]) {
            const y = floor * r.floorHeight;
            beam(
              new Vector3(x - w / 9, y + 0.2, side * (d / 2 + 0.06)),
              new Vector3(
                x + w / 9,
                y + r.floorHeight - 0.2,
                side * (d / 2 + 0.06),
              ),
              0.14,
            );
            if (r.timberFrameStyle === "cross" && level === 0)
              beam(
                new Vector3(x + w / 9, y + 0.2, side * (d / 2 + 0.06)),
                new Vector3(
                  x - w / 9,
                  y + r.floorHeight - 0.2,
                  side * (d / 2 + 0.06),
                ),
                0.12,
              );
          }
      }
      if (floor && level < 2)
        for (const z of [-d * 0.375, d * 0.375]) {
          const y = floor * r.floorHeight;
          beam(
            new Vector3(side * (w / 2 + 0.06), y + 0.2, z - d / 9),
            new Vector3(
              side * (w / 2 + 0.06),
              y + r.floorHeight - 0.2,
              z + d / 9,
            ),
            0.14,
          );
        }
      const window = (horizontal: number, flank: boolean) => {
        const y = (floor + 0.6) * r.floorHeight;
        const panel = (
          s: EnvironmentSurface,
          ww: number,
          hh: number,
          dd: number,
          dx: number,
          dy: number,
          offset: number,
        ) => {
          if (flank)
            box(
              s,
              dd,
              hh,
              ww,
              side * (w / 2 + offset),
              y + dy,
              horizontal + dx,
            );
          else
            box(
              s,
              ww,
              hh,
              dd,
              horizontal + dx,
              y + dy,
              side * (d / 2 + offset),
            );
        };
        panel("glass", 0.78, 1.02, 0.035, 0, 0, 0.05);
        if (level === 2) return;
        for (const dx of [-0.46, 0.46])
          panel("wood", 0.14, 1.3, 0.14, dx, 0, 0.1);
        for (const dy of [-0.58, 0.58])
          panel("wood", 1.06, 0.14, 0.14, 0, dy, 0.1);
        panel("wood", 1.22, 0.1, 0.4, 0, -0.7, 0.13);
        if (level === 0) {
          panel("wood", 0.055, 1.05, 0.06, 0, 0, 0.17);
          panel("wood", 0.82, 0.055, 0.06, 0, 0, 0.17);
        }
      };
      for (const x of floor && r.windowLayout === "paired"
        ? [-w / 8, w / 8]
        : [-w * 0.375, w * 0.375])
        window(x, false);
      for (const z of [-d / 4, d / 4]) window(z, true);
    }
  }
  const half =
    r.width / 2 + (r.floors > 1 ? r.upperFloorOverhang : 0) + r.roofOverhang;
  const depth =
    r.depth +
    (r.floors > 1 ? r.upperFloorOverhang * 2 : 0) +
    r.roofOverhang * 2;
  const slope = (r.roofPitch * Math.PI) / 180,
    rise = Math.tan(slope) * half;
  for (const side of [-1, 1]) {
    box(
      "roof",
      Math.hypot(half, rise),
      0.23,
      depth,
      (side * half) / 2,
      height + rise / 2,
      0,
      -side * slope,
    );
    box("wood", 0.18, 0.25, depth, side * half, height - 0.05, 0);
    const shape = new Shape();
    shape.moveTo(-half + r.roofOverhang, 0);
    shape.lineTo(0, rise);
    shape.lineTo(half - r.roofOverhang, 0);
    shape.closePath();
    const g = new ShapeGeometry(shape);
    if (side < 0) g.rotateY(Math.PI);
    g.translate(0, height, side * (depth / 2 - r.roofOverhang));
    add("plaster", g);
    box(
      "wood",
      half * 2 - r.roofOverhang,
      0.18,
      0.22,
      0,
      height,
      side * (depth / 2 - r.roofOverhang),
    );
  }
  box("roof", 0.28, 0.24, depth + 0.1, 0, height + rise, 0);
  const doorX =
    r.doorPlacement === "left"
      ? -r.width / 4
      : r.doorPlacement === "right"
        ? r.width / 4
        : 0;
  box(
    "wood",
    r.buildingType === "barn" ? 2.8 : 1.15,
    r.buildingType === "barn" ? 3 : 2.25,
    0.2,
    doorX,
    r.buildingType === "barn" ? 1.5 : 1.125,
    r.depth / 2 + 0.13,
  );
  box("stone", 1.65, 0.16, 0.58, doorX, 0.08, r.depth / 2 + 0.25);
  if (r.buildingType !== "barn")
    box(
      "stone",
      0.8,
      3,
      0.8,
      r.seed % 2 ? -r.width / 4 : r.width / 4,
      height + rise * 0.45,
      0,
    );
}
