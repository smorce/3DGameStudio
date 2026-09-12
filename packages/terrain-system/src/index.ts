import type { Terrain } from "../../project-schema/src/index";
export type Brush =
  "raise" | "lower" | "smooth" | "flatten" | "paint" | "noise";
export function brushTerrain(
  t: Terrain,
  mode: Brush,
  x: number,
  z: number,
  radius: number,
  strength: number,
  color = "#c7b68b",
) {
  const old = [...t.heights];
  for (let j = 0; j < t.resolution; j++)
    for (let i = 0; i < t.resolution; i++) {
      const px = (i / (t.resolution - 1) - 0.5) * t.size,
        pz = (j / (t.resolution - 1) - 0.5) * t.size,
        d = Math.hypot(px - x, pz - z);
      if (d > radius) continue;
      const k = j * t.resolution + i,
        w = (1 - d / radius) * strength;
      if (mode === "raise") t.heights[k] += w;
      if (mode === "lower") t.heights[k] -= w;
      if (mode === "flatten") t.heights[k] += (0 - old[k]) * Math.min(1, w);
      if (mode === "paint") t.colors[k] = color;
      if (mode === "noise")
        t.heights[k] += Math.sin(i * 12.9898 + j * 78.233 + t.seed) * w;
      if (mode === "smooth") {
        const ns = [
          old[k - 1],
          old[k + 1],
          old[k - t.resolution],
          old[k + t.resolution],
        ].filter((n) => n !== undefined);
        t.heights[k] +=
          (ns.reduce((a, b) => a + b, 0) / ns.length - old[k]) * Math.min(1, w);
      }
    }
}
export function heightAt(t: Terrain, x: number, z: number) {
  const u = Math.max(
      0,
      Math.min(t.resolution - 1, (x / t.size + 0.5) * (t.resolution - 1)),
    ),
    v = Math.max(
      0,
      Math.min(t.resolution - 1, (z / t.size + 0.5) * (t.resolution - 1)),
    );
  const i = Math.floor(u),
    j = Math.floor(v),
    i1 = Math.min(i + 1, t.resolution - 1),
    j1 = Math.min(j + 1, t.resolution - 1),
    a = u - i,
    b = v - j;
  return (
    (1 - b) *
      ((1 - a) * t.heights[j * t.resolution + i] +
        a * t.heights[j * t.resolution + i1]) +
    b *
      ((1 - a) * t.heights[j1 * t.resolution + i] +
        a * t.heights[j1 * t.resolution + i1])
  );
}

export function terrainContainsPoint(t: Terrain, x: number, z: number) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const halfSize = t.size / 2;
  return x >= -halfSize && x <= halfSize && z >= -halfSize && z <= halfSize;
}

export function heightAtIfInside(
  t: Terrain,
  x: number,
  z: number,
): number | undefined {
  return terrainContainsPoint(t, x, z) ? heightAt(t, x, z) : undefined;
}
