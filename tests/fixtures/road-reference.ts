import {
  SemanticLayers,
  smooth,
} from "../../packages/world-generator/src/semantic";
// 索引導入前の全線分走査を、形状・色・配置の比較基準として残す。
export function bruteRoadInfluence(
  this: SemanticLayers,
  x: number,
  z: number,
  influenceOnly = false,
) {
  let nearest = { distance: Infinity, weight: 0, height: 0, roadId: "" };
  for (const { road, points, bounds } of this.roads) {
    if (
      influenceOnly &&
      (x < bounds[0] || x > bounds[1] || z < bounds[2] || z > bounds[3])
    )
      continue;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        dx = b[0] - a[0],
        dz = b[2] - a[2];
      const t = Math.max(
        0,
        Math.min(
          1,
          ((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz || 1),
        ),
      );
      const px = a[0] + dx * t,
        pz = a[2] + dz * t;
      const edgeDistance = Math.hypot(x - px, z - pz) - road.width / 2;
      if (edgeDistance < nearest.distance)
        nearest = {
          distance: edgeDistance,
          weight:
            1 -
            smooth((edgeDistance - road.shoulderWidth) / road.terrainFalloff),
          height:
            road.elevationMode === "absolute"
              ? a[1] + (b[1] - a[1]) * t
              : this.sampleHeightMask(px, pz),
          roadId: road.id,
        };
    }
  }
  return nearest;
}
