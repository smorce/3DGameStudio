import * as THREE from "three";

/** 高解像度Chunkと粗い遠景の辺の高さ差を、地面より下の裾で隠す。 */
export function addAlpineTerrainSkirt(
  geometry: THREE.BufferGeometry,
  resolution: number,
) {
  const sourcePosition = geometry.getAttribute("position"),
    sourceColor = geometry.getAttribute("color"),
    sourceNormal = geometry.getAttribute("normal");
  const positions = Array.from(sourcePosition.array),
    colors = Array.from(sourceColor.array),
    normals = Array.from(sourceNormal.array),
    indices = Array.from(geometry.index!.array);
  for (let edge = 0; edge < 4; edge++)
    for (let i = 0; i < resolution - 1; i++) {
      const index = (t: number) =>
        edge === 0
          ? t
          : edge === 1
            ? t * resolution + resolution - 1
            : edge === 2
              ? (resolution - 1) * resolution + resolution - 1 - t
              : (resolution - 1 - t) * resolution;
      const a = index(i),
        b = index(i + 1),
        base = positions.length / 3;
      for (const [vertex, lower] of [
        [a, false],
        [b, false],
        [a, true],
        [b, true],
      ] as const) {
        positions.push(
          sourcePosition.getX(vertex),
          sourcePosition.getY(vertex) - (lower ? 32 : 0),
          sourcePosition.getZ(vertex),
        );
        colors.push(
          sourceColor.getX(vertex),
          sourceColor.getY(vertex),
          sourceColor.getZ(vertex),
        );
        normals.push(
          edge === 1 ? 1 : edge === 3 ? -1 : 0,
          0,
          edge === 0 ? -1 : edge === 2 ? 1 : 0,
        );
      }
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
}

/** 遠景の三角形補間へ外周を合わせ、同じサンプラーでも生じるLOD間の隙間を閉じる。 */
export function alignAlpineTerrainBoundary(
  geometry: THREE.BufferGeometry,
  resolution: number,
  size: number,
  originX: number,
  originZ: number,
  height: (x: number, z: number) => number,
) {
  const position = geometry.getAttribute("position");
  // PreparedChunkの物理用Bufferを変更しない。
  const adjusted = new THREE.Float32BufferAttribute(
    new Float32Array(position.array),
    3,
  );
  const step = size / 4;
  const samples = new Map<string, number>();
  const sample = (x: number, z: number) => {
    const key = `${x},${z}`;
    let value = samples.get(key);
    if (value === undefined) {
      value = height(x, z);
      samples.set(key, value);
    }
    return value;
  };
  const coarse = (x: number, z: number) => {
    const cx = Math.floor(x / step) * step,
      cz = Math.floor(z / step) * step;
    const u = (x - cx) / step,
      v = (z - cz) / step;
    const a = sample(cx, cz),
      b = sample(cx + step, cz),
      c = sample(cx, cz + step),
      d = sample(cx + step, cz + step);
    return u + v <= 1
      ? a * (1 - u - v) + b * u + c * v
      : d * (u + v - 1) + c * (1 - u) + b * (1 - v);
  };
  for (let z = 0; z < resolution; z++)
    for (let x = 0; x < resolution; x++) {
      const edge = Math.min(x, z, resolution - 1 - x, resolution - 1 - z);
      if (edge >= 3) continue;
      const i = z * resolution + x;
      const target = coarse(
        originX + position.getX(i),
        originZ + position.getZ(i),
      );
      const weight = 1 - edge / 3;
      adjusted.setY(i, position.getY(i) * (1 - weight) + target * weight);
    }
  geometry.setAttribute("position", adjusted);
}
