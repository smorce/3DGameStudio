import type {
  RoadDefinition,
  Vec3,
  WorldDesign,
} from "../../project-schema/src/index";
import { deriveSeed, seedUnit } from "./seed";

export const smooth = (t: number) => {
  const n = Math.max(0, Math.min(1, t));
  return n * n * (3 - 2 * n);
};
const distance = (x: number, z: number, p: Vec3) =>
  Math.hypot(x - p[0], z - p[2]);
export function evaluateRoad(road: RoadDefinition, t: number): Vec3 {
  const points = road.closed
    ? [
        road.controlPoints.at(-1)!,
        ...road.controlPoints,
        road.controlPoints[0],
        road.controlPoints[1],
      ]
    : road.controlPoints;
  if (road.closed)
    t =
      (1 + Math.max(0, Math.min(1, t)) * road.controlPoints.length) /
      (points.length - 1);
  const u = Math.max(0, Math.min(points.length - 1, t * (points.length - 1)));
  const i = Math.min(points.length - 2, Math.floor(u)),
    f = u - i;
  return [0, 1, 2].map((axis) => {
    const a = points[Math.max(0, i - 1)][axis],
      b = points[i][axis];
    const c = points[i + 1][axis],
      d = points[Math.min(points.length - 1, i + 2)][axis];
    return (
      0.5 *
      (2 * b +
        (-a + c) * f +
        (2 * a - 5 * b + 4 * c - d) * f * f +
        (-a + 3 * b - 3 * c + d) * f * f * f)
    );
  }) as Vec3;
}
function detail(x: number, z: number, seed: number) {
  const ix = Math.floor(x / 12),
    iz = Math.floor(z / 12);
  const u = smooth(x / 12 - ix),
    v = smooth(z / 12 - iz);
  const n = (a: number, b: number) =>
    seedUnit(seed, "micro", `${a},${b}`) * 2 - 1;
  return (
    (n(ix, iz) * (1 - u) + n(ix + 1, iz) * u) * (1 - v) +
    (n(ix, iz + 1) * (1 - u) + n(ix + 1, iz + 1) * u) * v
  );
}

/** 全生成段階が共有する座標サンプラー。Splineはcontext作成時に一度だけ評価する。 */
export class SemanticLayers {
  readonly roads: { road: RoadDefinition; points: Vec3[]; bounds: number[] }[];
  private readonly terrainSeed: number;
  private readonly roadGrid = new Map<
    string,
    { roadIndex: number; pointIndex: number }[]
  >();
  private readonly roadGridSize = 32;
  constructor(
    readonly design: WorldDesign,
    readonly seed: number,
  ) {
    this.terrainSeed = deriveSeed(seed, "terrain");
    this.roads = design.roads.map((road) => {
      const length = road.controlPoints
        .slice(1)
        .reduce(
          (sum, p, i) => sum + distance(p[0], p[2], road.controlPoints[i]),
          0,
        );
      const closingLength = road.closed
        ? distance(
            road.controlPoints[0][0],
            road.controlPoints[0][2],
            road.controlPoints.at(-1)!,
          )
        : 0;
      const count = Math.max(16, Math.ceil((length + closingLength) / 3));
      const points = Array.from({ length: count + 1 }, (_, i) =>
        evaluateRoad(road, i / count),
      );
      const margin = road.width / 2 + road.shoulderWidth + road.terrainFalloff;
      return {
        road,
        points,
        bounds: [
          Math.min(...points.map((p) => p[0])) - margin,
          Math.max(...points.map((p) => p[0])) + margin,
          Math.min(...points.map((p) => p[2])) - margin,
          Math.max(...points.map((p) => p[2])) + margin,
        ],
      };
    });
    // 他の道路の影響を打ち消す近い線分も含め、最大の路肩・減衰幅まで索引化する。
    const influenceRange = Math.max(
      0,
      ...design.roads.map((r) => r.shoulderWidth + r.terrainFalloff),
    );
    this.roads.forEach(({ road, points }, roadIndex) => {
      const margin = road.width / 2 + influenceRange;
      for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
        const a = points[pointIndex - 1],
          b = points[pointIndex];
        const minX = Math.floor(
          (Math.min(a[0], b[0]) - margin) / this.roadGridSize,
        );
        const maxX = Math.floor(
          (Math.max(a[0], b[0]) + margin) / this.roadGridSize,
        );
        const minZ = Math.floor(
          (Math.min(a[2], b[2]) - margin) / this.roadGridSize,
        );
        const maxZ = Math.floor(
          (Math.max(a[2], b[2]) + margin) / this.roadGridSize,
        );
        for (let z = minZ; z <= maxZ; z++)
          for (let x = minX; x <= maxX; x++) {
            const key = `${x},${z}`;
            let segments = this.roadGrid.get(key);
            if (!segments) this.roadGrid.set(key, (segments = []));
            segments.push({ roadIndex, pointIndex });
          }
      }
    });
  }
  islandAt(x: number, z: number) {
    return this.design.islands.find(
      (i) => distance(x, z, i.center) <= i.radius,
    );
  }
  sampleIslandMask(x: number, z: number) {
    return Math.max(
      0,
      ...this.design.islands.map((i) =>
        smooth((i.radius - distance(x, z, i.center)) / i.coastWidth),
      ),
    );
  }
  sampleCoastMask(x: number, z: number) {
    const m = this.sampleIslandMask(x, z);
    return 4 * m * (1 - m);
  }
  sampleHeightMask(x: number, z: number) {
    let height = -8;
    for (const island of this.design.islands) {
      const mask = smooth(
        (island.radius - distance(x, z, island.center)) / island.coastWidth,
      );
      if (!mask) continue;
      let mountain = 0;
      for (const m of island.mountains)
        mountain +=
          m.height *
          Math.pow(smooth(1 - distance(x, z, m.center) / m.radius), m.falloff);
      height = Math.max(
        height,
        -8 +
          (8 +
            island.baseHeight +
            mountain +
            detail(x, z, this.terrainSeed) * 0.8) *
            mask,
      );
    }
    return height;
  }
  sampleBiome(x: number, z: number) {
    return (
      this.design.biomeRegions.find((r) => distance(x, z, r.center) <= r.radius)
        ?.biome ??
      this.islandAt(x, z)?.biome ??
      "ocean"
    );
  }
  sampleRoadInfluence(x: number, z: number, influenceOnly = false) {
    let nearest = { distance: Infinity, weight: 0, height: 0, roadId: "" };
    if (!this.roads.length) return nearest;
    if (
      influenceOnly &&
      !this.roads.some(
        ({ bounds }) =>
          x >= bounds[0] && x <= bounds[1] && z >= bounds[2] && z <= bounds[3],
      )
    )
      return nearest;
    const inspect = (roadIndex: number, pointIndex: number) => {
      const { road, points, bounds } = this.roads[roadIndex];
      if (
        influenceOnly &&
        (x < bounds[0] || x > bounds[1] || z < bounds[2] || z > bounds[3])
      )
        return;
      const a = points[pointIndex - 1],
        b = points[pointIndex],
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
    };
    if (influenceOnly) {
      const segments = this.roadGrid.get(
        `${Math.floor(x / this.roadGridSize)},${Math.floor(z / this.roadGridSize)}`,
      );
      for (const segment of segments ?? [])
        inspect(segment.roadIndex, segment.pointIndex);
    } else {
      // 配置の道路距離には、影響範囲外も含む正確な最近傍を返す。
      this.roads.forEach(({ points }, roadIndex) => {
        for (let i = 1; i < points.length; i++) inspect(roadIndex, i);
      });
    }
    return nearest;
  }
  runwayDistance(
    x: number,
    z: number,
    airport: WorldDesign["airports"][number],
  ) {
    const dx = x - airport.center[0],
      dz = z - airport.center[2],
      c = Math.cos(airport.rotation),
      s = Math.sin(airport.rotation);
    return Math.max(
      Math.abs(c * dx + s * dz) - airport.width / 2,
      Math.abs(-s * dx + c * dz) - airport.length / 2,
    );
  }
  sampleRunwayMask(x: number, z: number) {
    return this.design.airports.some((a) => this.runwayDistance(x, z, a) <= 4);
  }
  sampleSettlementMask(x: number, z: number) {
    return this.design.settlements.some(
      (r) => distance(x, z, r.center) <= r.radius,
    );
  }
  sampleLandmarkMask(x: number, z: number) {
    return this.landmarkDistance(x, z) <= 5;
  }
  sampleGameplayMask(x: number, z: number) {
    return this.design.gameplayRegions.some(
      (r) => distance(x, z, r.center) <= r.radius,
    );
  }
  sampleNoSpawnMask(x: number, z: number, allowedSettlementId?: string) {
    return (
      this.design.noSpawnRegions.some(
        (r) => distance(x, z, r.center) <= r.radius,
      ) ||
      this.sampleRunwayMask(x, z) ||
      this.design.settlements.some(
        (r) =>
          r.id !== allowedSettlementId && distance(x, z, r.center) <= r.radius,
      )
    );
  }
  landmarkDistance(x: number, z: number) {
    return Math.min(
      Infinity,
      ...this.design.landmarks.map((l) => distance(x, z, l.position)),
    );
  }
  waterDistance(x: number, z: number) {
    // 高さ0の等高線までを保守的に扱い、細部ノイズの幅も差し引く。
    return Math.max(
      0,
      ...this.design.islands.map(
        (i) => i.radius - i.coastWidth * 0.7 - distance(x, z, i.center),
      ),
    );
  }
  sampleHeight(
    x: number,
    z: number,
    road = this.sampleRoadInfluence(x, z, true),
  ) {
    let h = this.sampleHeightMask(x, z);
    h += (road.height - h) * road.weight;
    for (const region of this.design.settlements) {
      const w =
        1 - smooth((distance(x, z, region.center) - region.radius) / 12);
      h += (region.height - h) * w;
    }
    for (const airport of this.design.airports) {
      const w = 1 - smooth(this.runwayDistance(x, z, airport) / 18);
      h += (airport.height - h) * w;
    }
    return h;
  }
  sampleTerrain(x: number, z: number) {
    const roadInfluence = this.sampleRoadInfluence(x, z, true);
    return {
      height: this.sampleHeight(x, z, roadInfluence),
      roadInfluence,
      biome: this.sampleBiome(x, z),
    };
  }
  sampleSlope(x: number, z: number) {
    return (
      (Math.atan(
        Math.hypot(
          (this.sampleHeight(x + 1, z) - this.sampleHeight(x - 1, z)) / 2,
          (this.sampleHeight(x, z + 1) - this.sampleHeight(x, z - 1)) / 2,
        ),
      ) *
        180) /
      Math.PI
    );
  }
  debugSample(x: number, z: number) {
    return {
      island: this.sampleIslandMask(x, z),
      biome: this.sampleBiome(x, z),
      road: this.sampleRoadInfluence(x, z),
      noSpawn: this.sampleNoSpawnMask(x, z),
      height: this.sampleHeight(x, z),
    };
  }
}
