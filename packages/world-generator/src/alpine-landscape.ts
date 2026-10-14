import { seedUnit } from "./seed";

const smooth = (v: number) => {
  const t = Math.max(0, Math.min(1, v));
  return t * t * (3 - 2 * t);
};
/** 絶対座標の滑らかな多尺度ノイズ。ChunkとLODに依存しない。 */
export function alpineNoise(
  x: number,
  z: number,
  scale: number,
  seed: number,
  cache?: Map<string, number>,
) {
  const u = x / scale,
    v = z / scale;
  const ix = Math.floor(u),
    iz = Math.floor(v);
  const a = smooth(u - ix),
    b = smooth(v - iz);
  const n = (dx: number, dz: number) => {
    const cell = `${ix + dx},${iz + dz}`,
      key = `${seed}:${cell}`;
    const previous = cache?.get(key);
    if (previous !== undefined) return previous;
    const value = seedUnit(seed, "alpine", cell) * 2 - 1;
    // サンプラー所有の有限キャッシュ。破棄・再計算しても出力は変わらない。
    if (cache) {
      if (cache.size >= 32768) cache.clear();
      cache.set(key, value);
    }
    return value;
  };
  return (
    (n(0, 0) * (1 - a) + n(1, 0) * a) * (1 - b) +
    (n(0, 1) * (1 - a) + n(1, 1) * a) * b
  );
}
/** 曲がった主稜線と前衛山脈。裾は谷底へ滑らかにつなぐ。 */
export function alpineMountainHeight(
  x: number,
  z: number,
  seed: number,
  cache?: Map<string, number>,
) {
  if (z >= -205) return 0;
  const warp = alpineNoise(x, z, 170, seed, cache) * 35;
  const ridgeZ = -840 + Math.sin(x / 240) * 55 + Math.sin(x / 97) * 20;
  const cross = (z + warp - ridgeZ) / 300;
  const envelope = Math.exp(-cross * cross * 1.7);
  const peaks =
    185 +
    48 * alpineNoise(x, ridgeZ, 120, seed + 3, cache) +
    32 * Math.sin(x / 69) +
    18 * Math.sin(x / 31);
  const ribs = 1 - Math.abs(alpineNoise(x + z * 0.28, z, 58, seed + 7, cache));
  const main =
    envelope *
    (peaks + ribs * 36 + alpineNoise(x, z, 25, seed + 11, cache) * 9);
  const front =
    Math.exp(-Math.pow((z + 520 + Math.sin(x / 150) * 60) / 165, 2)) *
    (38 + 22 * alpineNoise(x, z, 100, seed + 19, cache));
  return (main + front) * smooth((-z - 205) / 160);
}
/** 東の窪地にある湖。水面は描画専用で、物理と配置は湖底の地形だけを参照する。 */
export const alpineLake = {
  center: [265, 5] as const,
  radius: 66,
  waterLevel: 8.6,
  depth: 3.4,
};
/** 湖心0・汀線1となる正規化距離。角度ごとの揺らぎで円形の輪郭を崩す。 */
export function alpineLakeDistance(x: number, z: number) {
  const dx = x - alpineLake.center[0],
    dz = z - alpineLake.center[1];
  const angle = Math.atan2(dz, dx);
  const shore =
    alpineLake.radius *
    (1 +
      0.16 * Math.sin(angle * 2 + 1.1) +
      0.09 * Math.sin(angle * 3 + 2.3) +
      0.05 * Math.sin(angle * 5 + 0.4));
  return Math.hypot(dx, dz) / shore;
}
/** 汀線の外側は緩い浜、内側は湖底へ下げる。範囲外では元の高さを返す。 */
export function alpineLakeHeight(x: number, z: number, height: number) {
  const t = alpineLakeDistance(x, z);
  if (t >= 1.35) return height;
  const target =
    alpineLake.waterLevel -
    alpineLake.depth * smooth((1 - t) / 0.55) +
    Math.max(0, t - 1) * 7;
  const weight = 1 - smooth((t - 1) / 0.35);
  return height + (Math.min(height, target) - height) * weight;
}
/** 草地の開口部と林の群落を近景・遠景で共有する。 */
export function alpineForestDensity(
  x: number,
  z: number,
  height: number,
  seed: number,
  cache?: Map<string, number>,
) {
  const lake = alpineLakeDistance(x, z);
  if (height > 150 || lake < 1.12) return 0;
  // 湖の北岸だけ林を寄せ、水面越しに森が見える岸辺を作る。
  const grove =
    smooth((2.4 - lake) / 0.9) *
    smooth((alpineLake.center[1] + 15 - z) / 45) *
    0.75;
  const foothill = Math.max(smooth((-z - 135) / 135), grove);
  const treeline = 1 - smooth((height - 75) / 75);
  if (foothill === 0) return 0.035 * treeline;
  const patch =
    alpineNoise(x, z, 95, seed + 23, cache) * 0.7 +
    alpineNoise(x, z, 38, seed + 41, cache) * 0.3;
  const woodland = smooth((patch + 0.25) / 0.65);
  return (0.035 + woodland * foothill * 0.94) * treeline;
}
