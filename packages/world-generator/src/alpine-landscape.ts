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
/** 草地の開口部と林の群落を近景・遠景で共有する。 */
export function alpineForestDensity(
  x: number,
  z: number,
  height: number,
  seed: number,
  cache?: Map<string, number>,
) {
  if (height > 150) return 0;
  const foothill = smooth((-z - 135) / 135);
  const treeline = 1 - smooth((height - 75) / 75);
  if (foothill === 0) return 0.035 * treeline;
  const patch =
    alpineNoise(x, z, 95, seed + 23, cache) * 0.7 +
    alpineNoise(x, z, 38, seed + 41, cache) * 0.3;
  const woodland = smooth((patch + 0.25) / 0.65);
  return (0.035 + woodland * foothill * 0.94) * treeline;
}
