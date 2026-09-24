import * as THREE from "three";
import {
  worldChunkSize,
  type Project,
  type Vec3,
} from "../../../project-schema/src/index";
import type { PhysicsRenderState } from "../../../physics-rapier/src/index";
import {
  EFFECT_CAPACITY,
  EFFECT_CONFIG,
  contactEmission,
  vaporEmission,
  washEmission,
  type EffectQuality,
} from "./effect-config";
import { chunkKey, worldToChunk } from "../../../world-generator/src/index";
import { EffectParticleSystem } from "./particle-system";

const ZERO_ORIGIN: Vec3 = [0, 0, 0];

type EmitterKind = "vapor" | "contact" | "wash";
interface Emitter {
  id: string;
  kind: EmitterKind;
  visual: THREE.Object3D;
  anchor: THREE.Vector3;
  previous: THREE.Vector3;
  hit: THREE.Vector3;
  initialized: boolean;
  carry: number;
  checkedAt: number;
  hasHit: boolean;
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 既存描画姿勢を読むだけのVFX層。物理ワールドへの参照・書き戻しは持たない。 */
export class VisualEffects {
  readonly group = new THREE.Group();
  readonly vapor: EffectParticleSystem;
  readonly smoke: EffectParticleSystem;
  private emitters: Emitter[] = [];
  private chunkSize = 32;
  private readonly point = new THREE.Vector3();
  private readonly spawn = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly ray = new THREE.Raycaster();
  private readonly hits: THREE.Intersection[] = [];
  time = 0;
  vaporEmitters = 0;
  groundSmokeEmitters = 0;
  constructor(quality: EffectQuality = "balanced") {
    const [vapor, smoke] = EFFECT_CAPACITY[quality];
    this.vapor = new EffectParticleSystem(vapor);
    this.smoke = new EffectParticleSystem(smoke, true);
    this.group.name = "visual-effects";
    this.group.add(this.vapor.points, this.smoke.points);
  }
  load(project: Project, visuals: Map<string, THREE.Object3D>) {
    this.clear();
    this.emitters = [];
    this.chunkSize = worldChunkSize(project.world);
    this.vaporEmitters = 0;
    this.groundSmokeEmitters = 0;
    for (const machine of project.machines)
      for (const part of machine.parts) {
        const visual = visuals.get(part.id);
        if (!visual || visual.userData.ghost) continue;
        const metadata = part.metadata.visualEffects;
        const vapor = record(metadata) ? metadata.wingVapor : undefined;
        let kind: EmitterKind;
        const anchor = new THREE.Vector3();
        if (
          part.definitionId === "Panel" &&
          (vapor === true || (record(vapor) && vapor.enabled === true))
        ) {
          kind = "vapor";
          const side = record(vapor) && vapor.side === -1 ? -1 : 1;
          anchor.set(
            (side * part.physics.size[0]) / 2,
            0,
            -part.physics.size[2] / 2,
          );
          this.vaporEmitters++;
        } else if (part.definitionId === "Wheel") {
          kind = "contact";
        } else if (part.definitionId === "Thruster") {
          kind = "wash";
          anchor.z = -part.physics.size[2] * 0.42;
        } else continue;
        if (kind !== "vapor") this.groundSmokeEmitters++;
        this.emitters.push({
          id: part.id,
          kind,
          visual,
          anchor,
          previous: new THREE.Vector3(),
          hit: new THREE.Vector3(),
          initialized: false,
          carry: 0,
          checkedAt: -Infinity,
          hasHit: false,
        });
      }
  }
  update(
    state: PhysicsRenderState | undefined,
    dt: number,
    chunks: Map<string, THREE.Group>,
    viewportHeight: number,
    worldOrigin: Vec3 = ZERO_ORIGIN,
  ) {
    if (!state) {
      this.clear();
      return;
    }
    dt = Number.isFinite(dt)
      ? Math.max(0, Math.min(EFFECT_CONFIG.maxDt, dt))
      : 0;
    this.time += dt;
    let rays = 0;
    for (const emitter of this.emitters) {
      const input = state.effectInputs?.get(emitter.id);
      const speed = input?.velocity ? Math.hypot(...input.velocity) : 0;
      const thrust = input?.thrust ?? 0;
      emitter.visual.updateWorldMatrix(true, false);
      this.point.copy(emitter.anchor).applyMatrix4(emitter.visual.matrixWorld);
      let rate = 0;
      if (emitter.kind === "vapor") rate = vaporEmission(speed);
      else if (emitter.kind === "contact") {
        const wheel = state.wheels.get(emitter.id);
        rate = contactEmission(speed, wheel?.inContact === true);
        if (wheel) {
          this.point.fromArray(wheel.pose.position);
          this.direction.fromArray(wheel.suspensionDirectionWorld);
          if (
            !Number.isFinite(this.direction.lengthSq()) ||
            this.direction.lengthSq() === 0
          )
            this.direction.set(0, -1, 0);
          this.point.addScaledVector(
            this.direction.normalize(),
            wheel.wheelRadiusM ?? 0,
          );
          this.point.y += EFFECT_CONFIG.smoke.groundOffset;
        }
      } else {
        const active = Math.abs(thrust) > EFFECT_CONFIG.wash.minThrust;
        if (!active) emitter.hasHit = false;
        if (
          active &&
          this.time - emitter.checkedAt >= EFFECT_CONFIG.wash.interval &&
          rays < EFFECT_CONFIG.wash.rayBudget
        ) {
          rays++;
          emitter.checkedAt = this.time;
          emitter.hasHit = false;
          this.direction
            .set(0, 0, -1)
            .transformDirection(emitter.visual.matrixWorld);
          this.ray.set(this.point, this.direction);
          this.ray.far = EFFECT_CONFIG.wash.distance;
          this.hits.length = 0;
          // Chunkのキーはグローバル座標。Rebase済み描画座標を戻して近傍だけ検索する。
          const { chunkX, chunkZ } = worldToChunk(
            this.point.x + worldOrigin[0],
            this.point.z + worldOrigin[2],
            this.chunkSize,
          );
          for (let x = chunkX - 1; x <= chunkX + 1; x++) {
            for (let z = chunkZ - 1; z <= chunkZ + 1; z++) {
              const chunk = chunks.get(chunkKey(x, z));
              if (!chunk?.visible) continue;
              // 地形メッシュのみ対象。木・建物・水面には煙を付けない。
              const terrain = chunk.children.find(
                (child) => child.userData.vfxTerrain === true,
              );
              if (terrain) {
                terrain.updateWorldMatrix(true, false);
                this.ray.intersectObject(terrain, false, this.hits);
              }
            }
          }
          let nearest: THREE.Intersection | undefined;
          for (const hit of this.hits)
            if (!nearest || hit.distance < nearest.distance) nearest = hit;
          if (nearest) {
            emitter.hit.copy(nearest.point);
            emitter.hit.y += EFFECT_CONFIG.smoke.groundOffset;
            emitter.hasHit = true;
          }
        }
        const valid =
          emitter.hasHit &&
          this.time - emitter.checkedAt <= EFFECT_CONFIG.wash.interval * 2 &&
          this.point.distanceTo(emitter.hit) <= EFFECT_CONFIG.wash.distance;
        rate = washEmission(thrust, valid);
        this.point.copy(emitter.hit);
      }
      if (!emitter.initialized || rate === 0) {
        emitter.previous.copy(this.point);
        emitter.initialized = true;
      }
      if (rate > 0) {
        const total = emitter.carry + rate * dt;
        const count = Math.floor(total);
        const pool = emitter.kind === "vapor" ? this.vapor : this.smoke;
        for (let i = 0; i < count; i++) {
          const alpha = (i + 1 - emitter.carry) / (rate * dt);
          this.spawn.lerpVectors(emitter.previous, this.point, alpha);
          // 地面煙は地面の最新位置から出し、斜面を横切る補間で埋めない。
          pool.emit(emitter.kind === "vapor" ? this.spawn : this.point);
        }
        emitter.carry = total - count;
      } else emitter.carry = 0;
      emitter.previous.copy(this.point);
    }
    this.vapor.update(dt, viewportHeight);
    this.smoke.update(dt, viewportHeight);
  }
  prewarm() {
    this.clear();
    this.vapor.emit(this.point.set(0, 0, 0));
    this.smoke.emit(this.point);
    this.vapor.update(0);
    this.smoke.update(0);
  }
  shiftOrigin(delta: Vec3) {
    this.vapor.shiftOrigin(delta);
    this.smoke.shiftOrigin(delta);
    this.point.fromArray(delta);
    for (const emitter of this.emitters) {
      emitter.previous.sub(this.point);
      emitter.hit.sub(this.point);
    }
  }
  clear() {
    this.time = 0;
    this.vapor.clear();
    this.smoke.clear();
    for (const emitter of this.emitters) {
      emitter.carry = 0;
      emitter.initialized = false;
      emitter.hasHit = false;
      emitter.checkedAt = -Infinity;
    }
  }
  dispose() {
    this.vapor.dispose();
    this.smoke.dispose();
    this.emitters = [];
    this.group.removeFromParent();
  }
}
