/** Prepared Terrainと同じ対角線で高さを補間し、草の根を実際の描画面へ接地する。 */
export function vegetationGroundHeight(
  positions: ArrayLike<number>,
  resolution: number,
  size: number,
  x: number,
  z: number,
) {
  const u = Math.max(
      0,
      Math.min(resolution - 1, (x / size) * (resolution - 1)),
    ),
    v = Math.max(0, Math.min(resolution - 1, (z / size) * (resolution - 1)));
  const ix = Math.min(resolution - 2, Math.floor(u)),
    iz = Math.min(resolution - 2, Math.floor(v));
  const a = u - ix,
    b = v - iz,
    index = iz * resolution + ix;
  const h00 = positions[index * 3 + 1],
    h10 = positions[(index + 1) * 3 + 1],
    h01 = positions[(index + resolution) * 3 + 1],
    h11 = positions[(index + resolution + 1) * 3 + 1];
  return a + b <= 1
    ? h00 * (1 - a - b) + h10 * a + h01 * b
    : h11 * (a + b - 1) + h10 * (1 - b) + h01 * (1 - a);
}
/** 接地面の傾斜。草ごとに地形の手続き生成を再実行しない。 */
export function vegetationGroundSlope(
  positions: ArrayLike<number>,
  resolution: number,
  size: number,
  x: number,
  z: number,
) {
  const u = Math.max(
      0,
      Math.min(resolution - 1, (x / size) * (resolution - 1)),
    ),
    v = Math.max(0, Math.min(resolution - 1, (z / size) * (resolution - 1)));
  const ix = Math.min(resolution - 2, Math.floor(u)),
    iz = Math.min(resolution - 2, Math.floor(v)),
    index = iz * resolution + ix;
  const h00 = positions[index * 3 + 1],
    h10 = positions[(index + 1) * 3 + 1],
    h01 = positions[(index + resolution) * 3 + 1],
    h11 = positions[(index + resolution + 1) * 3 + 1];
  const lower = u - ix + v - iz <= 1,
    step = size / (resolution - 1);
  return (
    (Math.atan(
      Math.hypot(lower ? h10 - h00 : h11 - h01, lower ? h01 - h00 : h11 - h10) /
        step,
    ) *
      180) /
    Math.PI
  );
}
