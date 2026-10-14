import type { Vec3 } from "../../project-schema/src/index";

/** FogExp2(density) を線形フォグ near/far で近似する係数（density で割って使う）。 */
const EXP2_LINEAR_NEAR = 0.13;
const EXP2_LINEAR_FAR = 1.56;
/** これより長く作られない Chunk（空・範囲外）は読込前線から外す。 */
const STALE_PENDING_MS = 1500;

export interface WorldRevealFrame {
  near: number;
  far: number;
  /** 空ドーム・雲の不透明度へ掛ける 0..1。 */
  sky: number;
  done: boolean;
}

export interface WorldRevealOptions {
  /** カメラから注視点（機体）までの距離。 */
  cameraDistance: number;
  /** 演出後に戻す FogExp2 の density。 */
  fogDensity: number;
  now: number;
  introMs?: number;
  timeoutMs?: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * PLAY開始時、機体の周りから霧が晴れていく演出。
 * 霧の縁を「未読込 Chunk の手前」に保ち、Streaming 中の欠けや出現を霧の中へ隠す。
 * 読込が滞っても timeoutMs で必ず晴れきる。
 */
export class WorldReveal {
  private far: number;
  private last: number;
  private readonly started: number;
  private readonly cameraDistance: number;
  private readonly startFar: number;
  private readonly introFar: number;
  private readonly finalNear: number;
  private readonly finalFar: number;
  private readonly introMs: number;
  private readonly timeoutMs: number;

  constructor(options: WorldRevealOptions) {
    const density = Math.max(options.fogDensity, 1e-5);
    this.cameraDistance = Math.max(1, options.cameraDistance);
    this.startFar = this.cameraDistance * 0.35;
    this.introFar = this.cameraDistance + 24;
    this.finalFar = Math.max(EXP2_LINEAR_FAR / density, this.introFar * 2);
    this.finalNear = Math.min(EXP2_LINEAR_NEAR / density, this.finalFar * 0.5);
    this.introMs = options.introMs ?? 650;
    this.timeoutMs = options.timeoutMs ?? 6000;
    this.started = this.last = options.now;
    this.far = this.startFar;
  }

  /** frontier は注視点から最寄りの未読込 Chunk までの水平距離（無ければ Infinity）。 */
  update(now: number, frontier: number): WorldRevealFrame {
    const t = now - this.started;
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const loaded =
      frontier === Number.POSITIVE_INFINITY
        ? this.finalFar
        : Math.min(this.finalFar, this.cameraDistance + frontier);
    if (t < this.introMs) {
      const intro =
        this.startFar +
        (this.introFar - this.startFar) * easeOutCubic(t / this.introMs);
      this.far = Math.max(this.far, Math.min(intro, loaded));
    } else if (loaded > this.far) {
      this.far += (loaded - this.far) * (1 - Math.exp(-dt * 3));
    }
    const forced = clamp01(
      (t - this.introMs) / (this.timeoutMs - this.introMs),
    );
    this.far = Math.max(
      this.far,
      this.startFar +
        (this.finalFar - this.startFar) * forced * forced * forced,
    );
    const progress = clamp01(
      Math.log(this.far / this.startFar) /
        Math.log(this.finalFar / this.startFar),
    );
    const ratio = 0.5 + (this.finalNear / this.finalFar - 0.5) * progress;
    return {
      near: this.far * ratio,
      far: this.far,
      sky: smoothstep(0.3, 0.9, progress),
      done: this.far >= this.finalFar * 0.985,
    };
  }
}

/**
 * 注視点から最寄りの未読込 Chunk 境界までの水平距離。
 * firstSeen で長く作られない Chunk を除外し、空 Chunk で演出が止まらないようにする。
 */
export function revealFrontier(
  pending: Iterable<string>,
  focus: Vec3,
  chunkSize: number,
  now: number,
  firstSeen: Map<string, number>,
) {
  let nearest = Number.POSITIVE_INFINITY;
  const current = new Set<string>();
  for (const key of pending) {
    current.add(key);
    const seen = firstSeen.get(key) ?? now;
    if (!firstSeen.has(key)) firstSeen.set(key, now);
    if (now - seen > STALE_PENDING_MS) continue;
    const [cx, cz] = key.split(",").map(Number);
    const minX = cx * chunkSize,
      minZ = cz * chunkSize;
    const dx = Math.max(minX - focus[0], 0, focus[0] - (minX + chunkSize));
    const dz = Math.max(minZ - focus[2], 0, focus[2] - (minZ + chunkSize));
    nearest = Math.min(nearest, Math.hypot(dx, dz));
  }
  for (const key of firstSeen.keys())
    if (!current.has(key)) firstSeen.delete(key);
  return nearest;
}
