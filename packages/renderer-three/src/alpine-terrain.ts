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
