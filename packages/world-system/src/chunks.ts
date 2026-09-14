import type { Vec3 } from "../../project-schema/src/index";

export const chunkCoordinate = (p: Vec3, size: number) => [
  Math.floor(p[0] / size),
  Math.floor(p[2] / size),
];

export function visibleChunks(position: Vec3, size: number, radius = 2) {
  const [x, z] = chunkCoordinate(position, size);
  const result = new Set<string>();
  for (let i = x - radius; i <= x + radius; i++)
    for (let j = z - radius; j <= z + radius; j++) result.add(`${i},${j}`);
  return result;
}

/** 旋回時に prefetch 方向が瞬間ジャンプしないよう保持する。 */
export class PrefetchDirectionState {
  nx = 0;
  nz = 1;
  active = false;

  reset() {
    this.nx = 0;
    this.nz = 1;
    this.active = false;
  }

  /**
   * 速度から単位方向を取る。前回方向とのドットが閾値未満になるまで保持する。
   */
  resolve(
    velocity: Vec3 | undefined,
    hysteresisDot = 0.72,
  ): { nx: number; nz: number; speed: number } | undefined {
    if (!velocity) return undefined;
    const speed = Math.hypot(velocity[0], velocity[2]);
    if (speed < 8) return undefined;
    const nx = velocity[0] / speed;
    const nz = velocity[2] / speed;
    if (!this.active) {
      this.nx = nx;
      this.nz = nz;
      this.active = true;
      return { nx: this.nx, nz: this.nz, speed };
    }
    const dot = this.nx * nx + this.nz * nz;
    if (dot < hysteresisDot) {
      this.nx = nx;
      this.nz = nz;
    }
    return { nx: this.nx, nz: this.nz, speed };
  }
}

export interface PrefetchOptions {
  /** 保持する方向状態。省略時はヒステリシスなしでその場の速度を使う。 */
  direction?: PrefetchDirectionState;
  /** 先読みチャンク数の上限（既定 4、Physics は伸ばす）。 */
  aheadMax?: number;
  /** 進行線の両脇に足す幅（チャンク単位、既定 1）。 */
  corridorHalfWidth?: number;
  /** ヒステリシス閾値（ドット積）。 */
  hysteresisDot?: number;
}

/**
 * 可視半径に加え、進行予測線に沿った Chunk 列を先読みする。
 * Math.round(nx*ahead) の 3x3 ジャンプは使わない。
 */
export function visibleChunksWithPrefetch(
  position: Vec3,
  size: number,
  radius: number,
  velocity?: Vec3,
  options: PrefetchOptions = {},
) {
  const keys = visibleChunks(position, size, radius);
  const resolved = options.direction
    ? options.direction.resolve(velocity, options.hysteresisDot)
    : resolveImmediate(velocity);
  if (!resolved) return keys;
  const aheadMax = options.aheadMax ?? 4;
  const half = options.corridorHalfWidth ?? 1;
  const ahead = Math.min(aheadMax, Math.ceil(resolved.speed / 24) + 1);
  const [cx, cz] = chunkCoordinate(position, size);
  const px = -resolved.nz;
  const pz = resolved.nx;
  for (let t = 1; t <= ahead; t++) {
    const bx = cx + Math.round(resolved.nx * t);
    const bz = cz + Math.round(resolved.nz * t);
    for (let w = -half; w <= half; w++) {
      keys.add(`${bx + Math.round(px * w)},${bz + Math.round(pz * w)}`);
    }
  }
  return keys;
}

function resolveImmediate(velocity?: Vec3) {
  if (!velocity) return undefined;
  const speed = Math.hypot(velocity[0], velocity[2]);
  if (speed < 8) return undefined;
  return {
    nx: velocity[0] / speed,
    nz: velocity[2] / speed,
    speed,
  };
}
