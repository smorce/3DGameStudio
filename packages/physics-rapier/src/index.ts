import { ColliderTemplateCache } from "../../asset-core/src/collider";
import {
  ChunkStreamer,
  physicsStreaming,
  terrainChunks,
} from "../../world-system/src/streaming";
import {
  WorldRuntime,
  chunkCoordinate,
  generatedEntityColliders,
  isBuiltinEntityKind,
  PrefetchRetentionState,
  preparedChunkLocalOrigin,
  visibleChunks,
  visibleChunksWithPrefetch,
  worldCollidersForEntity,
  type WorldColliderPose,
} from "../../world-system/src/index";
import type RAPIER from "@dimforge/rapier3d-compat";
import {
  activeCourse,
  PANEL_SIDE,
  type Project,
  type Vec3,
  type Part,
} from "../../project-schema/src/index";
import {
  AIR_DENSITY,
  computePanelAerodynamicForce,
} from "../../aerodynamics/src/index";
import {
  computeBoxBuoyancy,
  WATER_LINEAR_DRAG,
  WATER_VERTICAL_DRAG,
  type WaterSurface,
} from "../../water-system/src/index";
import {
  compileMachine,
  connectorWorldPosition,
  suspensionHardPoint,
  wheelCenterFromSuspension,
  wheelSuspensionSettings,
} from "../../machine-system/src/index";
import {
  quaternion,
  euler,
  multiply,
  rotate,
  type Quat,
} from "../../machine-system/src/math";
import { isForwardThruster, mixThrusterCommands } from "./thruster-steering";
import {
  RuntimeTelemetry,
  forwardSpeedMps as calculateForwardSpeedMps,
  horizontalSpeedMps,
  vectorMagnitude,
  worldSpeedMps,
  type TelemetryVec3,
  type MotorTelemetrySample,
  type RoleAerodynamicTelemetry,
} from "../../runtime-telemetry/src/index";
import {
  heightAtIfInside,
  terrainContainsPoint,
} from "../../terrain-system/src/index";
export interface Pose {
  position: Vec3;
  rotation: Quat;
}
export interface WheelRenderState {
  partId: string;
  pose: Pose;
  suspensionLengthM: number;
  suspensionDirectionWorld: Vec3;
  restLengthM: number;
  maxTravelM: number;
  minimumLengthM: number;
  suspensionForceN?: number;
  inContact?: boolean;
  wheelRadiusM?: number;
}
export interface PhysicsRenderState {
  poses: Map<string, Pose>;
  wheels: Map<string, WheelRenderState>;
}
const PHYSICS_FIXED_DT = 1 / 60;
// 速度誤差1 rad/sあたりに要求するトルク。最終出力はmaxTorqueで制限する。
const MOTOR_VELOCITY_CONTROLLER_GAIN = 40;
interface RevoluteRuntime {
  bodyA: RAPIER.RigidBody;
  bodyB: RAPIER.RigidBody;
  axisLocal: Vec3;
  damping: number;
  joint: RAPIER.RevoluteImpulseJoint;
  label: string;
  limits?: {
    minAngleRad: number;
    maxAngleRad: number;
  };
}
interface MotorRuntime extends RevoluteRuntime {
  part: Part;
  machineId: string;
}
interface WheelRuntime {
  part: Part;
  /** Rapier addWheel 第1引数。サスペンション上端(車体側取付点)。 */
  hardPoint: Vec3;
  /** 編集データ上の自然長時Wheel中心。hardPoint + direction * restLength。 */
  restWheelCenter: Vec3;
  suspensionDirection: Vec3;
  restLengthM: number;
  maxTravelM: number;
  radiusM: number;
}
const vector = (v: Vec3) => ({ x: v[0], y: v[1], z: v[2] });
const rotation = (q: Quat) => ({ x: q[0], y: q[1], z: q[2], w: q[3] });
const normalize = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v);
  return length > 0.000001
    ? (v.map((value) => value / length) as Vec3)
    : [0, 0, 0];
};
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
function colliderExtent(pose: WorldColliderPose): number {
  if (pose.type === "cylinder") return Math.hypot(pose.radius, pose.halfHeight);
  if (pose.type === "ball") return pose.radius;
  return Math.hypot(...pose.halfExtents);
}
function colliderDescFromPose(
  rapier: typeof RAPIER,
  pose: WorldColliderPose,
  local: Vec3,
) {
  const desc =
    pose.type === "cylinder"
      ? rapier.ColliderDesc.cylinder(pose.halfHeight, pose.radius)
      : pose.type === "ball"
        ? rapier.ColliderDesc.ball(pose.radius)
        : rapier.ColliderDesc.cuboid(
            pose.halfExtents[0],
            pose.halfExtents[1],
            pose.halfExtents[2],
          );
  return desc.setTranslation(local[0], local[1], local[2]).setRotation({
    x: pose.rotation[0],
    y: pose.rotation[1],
    z: pose.rotation[2],
    w: pose.rotation[3],
  });
}
function worldAxis(runtime: RevoluteRuntime): Vec3 {
  const q = runtime.bodyA.rotation();
  const bodyRotation: Quat = [q.x, q.y, q.z, q.w];
  return normalize(rotate(runtime.axisLocal, bodyRotation));
}
function relativeAngularVelocity(runtime: RevoluteRuntime, axisWorld: Vec3) {
  const a = runtime.bodyA.angvel(),
    b = runtime.bodyB.angvel();
  return (
    (b.x - a.x) * axisWorld[0] +
    (b.y - a.y) * axisWorld[1] +
    (b.z - a.z) * axisWorld[2]
  );
}
function relativeAngle(runtime: RevoluteRuntime) {
  const a = runtime.bodyA.rotation(),
    b = runtime.bodyB.rotation(),
    qa: Quat = [a.x, a.y, a.z, a.w],
    qb: Quat = [b.x, b.y, b.z, b.w],
    inverseA: Quat = [-qa[0], -qa[1], -qa[2], qa[3]],
    relative = multiply(inverseA, qb),
    axis = normalize(runtime.axisLocal),
    sign =
      relative[0] * axis[0] + relative[1] * axis[1] + relative[2] * axis[2];
  return 2 * Math.atan2(sign, relative[3]);
}
function applyEqualOppositeTorque(
  runtime: RevoluteRuntime,
  axisWorld: Vec3,
  torque: number,
) {
  const applied = axisWorld.map((value) => value * torque) as Vec3;
  runtime.bodyA.addTorque(vector(applied.map((value) => -value) as Vec3), true);
  runtime.bodyB.addTorque(vector(applied), true);
}
function computeBoundedMotorTorque(
  targetVelocity: number,
  relativeVelocity: number,
  maxTorque: number,
) {
  if (maxTorque <= 0) return 0;
  return clamp(
    MOTOR_VELOCITY_CONTROLLER_GAIN * (targetVelocity - relativeVelocity),
    -maxTorque,
    maxTorque,
  );
}
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
// 複数Collider機体ではRigidBody原点と質量中心が一致しないため、world-space CoMを使う。
function worldCenterOfMass(body: RAPIER.RigidBody) {
  return body.worldCom();
}
function pitchMomentNm(
  point: Vec3,
  force: Vec3,
  center: { x: number; y: number; z: number },
) {
  return cross(
    [point[0] - center.x, point[1] - center.y, point[2] - center.z],
    force,
  )[0];
}
const addInto = (target: Vec3, value: Vec3) => {
  target[0] += value[0];
  target[1] += value[1];
  target[2] += value[2];
};
interface ForceAccumulator {
  lift: Vec3;
  liftMagnitude: number;
  appliedLift: Vec3;
  drag: Vec3;
  dragMagnitude: number;
  appliedDrag: Vec3;
  aerodynamic: Vec3;
  aerodynamicPitchMomentNm: number;
  aerodynamicPitchMomentByRoleNm: Record<string, number>;
  aerodynamicByRole: Record<string, RoleAerodynamicTelemetry>;
  thruster: Vec3;
  thrusterMagnitude: number;
  thrusterPitchMomentNm: number;
  panelCount: number;
  angleOfAttackSum: number;
  liftCoefficientSum: number;
  dragCoefficientSum: number;
  motorByPart: Record<string, MotorTelemetrySample>;
}
const emptyForceAccumulator = (): ForceAccumulator => ({
  lift: [0, 0, 0],
  liftMagnitude: 0,
  appliedLift: [0, 0, 0],
  drag: [0, 0, 0],
  dragMagnitude: 0,
  appliedDrag: [0, 0, 0],
  aerodynamic: [0, 0, 0],
  aerodynamicPitchMomentNm: 0,
  aerodynamicPitchMomentByRoleNm: {},
  aerodynamicByRole: {},
  thruster: [0, 0, 0],
  thrusterMagnitude: 0,
  thrusterPitchMomentNm: 0,
  panelCount: 0,
  angleOfAttackSum: 0,
  liftCoefficientSum: 0,
  dragCoefficientSum: 0,
  motorByPart: {},
});
function velocityAtPoint(body: RAPIER.RigidBody, point: Vec3): Vec3 {
  const api = body as unknown as {
    velocityAtPoint?: (point: { x: number; y: number; z: number }) => {
      x: number;
      y: number;
      z: number;
    };
  };
  if (api.velocityAtPoint) {
    const value = api.velocityAtPoint(vector(point));
    return [value.x, value.y, value.z];
  }
  const center = body.translation(),
    linear = body.linvel(),
    angular = body.angvel(),
    radius: Vec3 = [
      point[0] - center.x,
      point[1] - center.y,
      point[2] - center.z,
    ];
  const tangential = cross([angular.x, angular.y, angular.z], radius);
  return [
    linear.x + tangential[0],
    linear.y + tangential[1],
    linear.z + tangential[2],
  ];
}
function resetExternalForces(body: RAPIER.RigidBody) {
  const api = body as unknown as {
    resetForces?: (wakeUp: boolean) => void;
    resetTorques?: (wakeUp: boolean) => void;
  };
  api.resetForces?.(false);
  api.resetTorques?.(false);
}
let initialized: Promise<typeof RAPIER> | undefined;
const initialize = () =>
  (initialized ??= (async () => {
    const api = await import("@dimforge/rapier3d-compat");
    await api.init();
    return api;
  })());
export class RapierPhysics {
  readonly colliderTemplates = new ColliderTemplateCache();
  readonly telemetry = new RuntimeTelemetry();
  world!: RAPIER.World;
  private generation = 0;
  private physicsStep = 0;
  private simulationTimeSeconds = 0;
  private streamer?: ChunkStreamer<string[]>;
  private lastStreamStats = {
    created: 0,
    pending: 0,
    commitMs: 0,
    syncFallback: 0,
  };
  private pendingStreamFocus?: { global: Vec3; vel?: Vec3 };
  private prefetchRetention = new PrefetchRetentionState();
  private staticColliders = new Map<
    string,
    { collider: RAPIER.Collider; refs: number; kind: string }
  >();
  vehicles: {
    id: string;
    body: RAPIER.RigidBody;
    controller: RAPIER.DynamicRayCastVehicleController;
    wheels: Part[];
    wheelRuntime: WheelRuntime[];
  }[] = [];
  private parts: {
    part: Part;
    body: RAPIER.RigidBody;
    machineId: string;
  }[] = [];
  private forceByMachine = new Map<string, ForceAccumulator>();
  private water: WaterSurface = { enabled: false, height: 0 };
  private gravityMagnitude = 9.81;
  private terrain?: Project["world"]["terrain"];
  worldRuntime?: WorldRuntime;
  private ownsRuntime = false;
  private lastMaxJointAnchorErrorM = 0;
  private hinges: RevoluteRuntime[] = [];
  private motors: MotorRuntime[] = [];
  async load(
    project: Project,
    options: { courseId?: string | null; world?: WorldRuntime } = {},
  ) {
    this.dispose();
    const generation = this.generation;
    const rapier = await initialize();
    if (generation !== this.generation) return;
    this.world = new rapier.World(vector(project.settings.gravity));
    this.world.timestep = PHYSICS_FIXED_DT;
    this.ownsRuntime = !options.world;
    this.worldRuntime =
      options.world ??
      (project.world.source.kind === "procedural"
        ? new WorldRuntime(project.world)
        : undefined);
    this.terrain = project.world.terrain;
    this.water = structuredClone(
      this.worldRuntime?.seaLevel ?? project.world.water,
    );
    this.gravityMagnitude = Math.abs(project.settings.gravity[1]);
    type StaticEntry = {
      kind: string;
      create: () => RAPIER.ColliderDesc;
      fallback?: () => RAPIER.ColliderDesc;
    };
    const spanning: {
      id: string;
      entry: StaticEntry;
      min: number[];
      max: number[];
    }[] = [];
    const builders = new Map<string, Map<string, StaticEntry>>();
    const register = (
      id: string,
      kind: string,
      min: Vec3,
      max: Vec3,
      create: () => RAPIER.ColliderDesc,
      fallback?: () => RAPIER.ColliderDesc,
    ) => {
      const [x0, z0] = chunkCoordinate(
          min,
          this.worldRuntime?.chunkSize ?? project.world.chunkSize,
        ),
        [x1, z1] = chunkCoordinate(
          max,
          this.worldRuntime?.chunkSize ?? project.world.chunkSize,
        );
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4096) {
        spanning.push({
          id,
          entry: { kind, create, fallback },
          min: [x0, z0],
          max: [x1, z1],
        });
        return;
      }
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++) {
          const key = `${x},${z}`,
            entries = builders.get(key) ?? new Map();
          entries.set(id, { kind, create, fallback });
          builders.set(key, entries);
        }
    };
    const createTerrainCollider = (key: string) => {
      // PreparedChunk の local 頂点を Simulation 座標へ焼き込んで Standalone Trimesh にする。
      // local Trimesh + translation および Fixed Body 方式は、現行の
      // DynamicRayCastVehicleController を含む回帰試験で接地不整合が発生したため
      // 現在は採用していない。根本原因は未特定。当面は Simulation 座標へ bake した
      // Standalone Trimesh を維持する。meshFor() の number[] 経由は避け、TypedArray へ直接焼く。
      if (this.worldRuntime && !this.worldRuntime.isPlayHotPath)
        this.worldRuntime.getChunk(key);
      const prepared = this.worldRuntime?.peekPreparedChunk(key);
      if (!prepared || prepared.positions.length < 9) return;
      const origin = preparedChunkLocalOrigin(
        prepared,
        this.worldRuntime!.worldOrigin,
      );
      const vertices = new Float32Array(prepared.positions.length);
      for (let i = 0; i < prepared.positions.length; i += 3) {
        vertices[i] = prepared.positions[i] + origin[0];
        vertices[i + 1] = prepared.positions[i + 1];
        vertices[i + 2] = prepared.positions[i + 2] + origin[2];
      }
      return rapier.ColliderDesc.trimesh(
        vertices,
        new Uint32Array(prepared.indices),
      ).setFriction(1.4);
    };
    if (!this.worldRuntime?.procedural) {
      for (const chunk of terrainChunks(project)) {
        const xs = chunk.vertices.filter((_, i) => i % 3 === 0),
          zs = chunk.vertices.filter((_, i) => i % 3 === 2);
        register(
          `terrain:${chunk.key}`,
          "terrain",
          [Math.min(...xs), 0, Math.min(...zs)],
          [Math.max(...xs) - 1e-6, 0, Math.max(...zs) - 1e-6],
          () =>
            rapier.ColliderDesc.trimesh(
              new Float32Array(chunk.vertices),
              new Uint32Array(chunk.indices),
            ).setFriction(1.4),
        );
      }
    }
    const usedAssets = new Set(project.world.entities.map((e) => e.assetId));
    const templates = new Map(
      await Promise.all(
        project.assets
          .filter((a) => usedAssets.has(a.id) && a.runtimeInfo?.colliderFile)
          .map(
            async (a) =>
              [
                a.id,
                await this.colliderTemplates.get(a.runtimeInfo!.colliderFile!),
              ] as const,
          ),
      ),
    );
    if (generation !== this.generation) return;
    for (const e of project.world.entities) {
      if (isBuiltinEntityKind(e.kind)) {
        for (const [index, pose] of worldCollidersForEntity(
          e.kind,
          e.transform,
        ).entries()) {
          const extent = colliderExtent(pose);
          const center = pose.translation;
          register(
            `entity:${e.id}:${index}`,
            "entity",
            [center[0] - extent, 0, center[2] - extent],
            [center[0] + extent, 0, center[2] + extent],
            () => {
              const local =
                this.worldRuntime?.toSimulation(pose.translation) ??
                pose.translation;
              return colliderDescFromPose(rapier, pose, local);
            },
          );
        }
        continue;
      }
      const p = e.transform.position,
        s = e.transform.scale,
        bounds = project.assets.find((a) => a.id === e.assetId)?.runtimeInfo
          ?.bounds;
      const half = bounds
        ? bounds.max.map((n, i) =>
            Math.max(0.01, ((n - bounds.min[i]) * s[i]) / 2),
          )
        : [s[0] * 0.6, s[1] * 0.6, s[2] * 0.6];
      const center = bounds
        ? bounds.max.map((n, i) => ((n + bounds.min[i]) * s[i]) / 2)
        : [0, s[1] * 0.6, 0];
      const offset = rotate(center as Vec3, quaternion(e.transform.rotation));
      const radius = Math.hypot(...half) + Math.hypot(...center);
      const local = (point: Vec3): Vec3 =>
        this.worldRuntime?.toSimulation(point) ?? point;
      const box = () => {
        const center = local([
          p[0] + offset[0],
          p[1] + offset[1],
          p[2] + offset[2],
        ]);
        return rapier.ColliderDesc.cuboid(half[0], half[1], half[2])
          .setTranslation(center[0], center[1], center[2])
          .setRotation(rotation(quaternion(e.transform.rotation)));
      };
      register(
        `entity:${e.id}`,
        "entity",
        [p[0] - radius, 0, p[2] - radius],
        [p[0] + radius, 0, p[2] + radius],
        () => {
          const asset = project.assets.find((a) => a.id === e.assetId),
            template = templates.get(e.assetId ?? "");
          if (template && asset?.runtimeInfo?.collider !== "box") {
            try {
              const vertices = new Float32Array(
                template.vertices.map((n, i) => n * s[i % 3]),
              );
              const desc =
                asset?.runtimeInfo?.collider === "trimesh"
                  ? rapier.ColliderDesc.trimesh(
                      vertices,
                      new Uint32Array(template.indices),
                    )
                  : rapier.ColliderDesc.convexHull(vertices);
              if (desc)
                return desc
                  .setTranslation(...local(p))
                  .setRotation(rotation(quaternion(e.transform.rotation)));
            } catch {
              /* 壊れた素材は境界ボックスへ戻す。 */
            }
          }
          return box();
        },
        box,
      );
    }

    const selectedCourse = activeCourse(project, options.courseId);
    for (const c of selectedCourse ? [selectedCourse] : []) {
      for (let i = 1; i < c.path.length; i++) {
        const a = c.path[i - 1],
          b = c.path[i],
          dx = b[0] - a[0],
          dy = b[1] - a[1],
          dz = b[2] - a[2],
          length = Math.hypot(dx, dy, dz);
        if (length < 0.01) continue;
        const q = quaternion([
          -Math.atan2(dy, Math.hypot(dx, dz)),
          Math.atan2(dx, dz),
          0,
        ]);
        register(
          `road:${c.id}:${i}`,
          "course",
          [Math.min(a[0], b[0]) - 3, 0, Math.min(a[2], b[2]) - 3],
          [Math.max(a[0], b[0]) + 3, 0, Math.max(a[2], b[2]) + 3],
          () => {
            const mid = this.worldRuntime?.toSimulation([
              (a[0] + b[0]) / 2,
              (a[1] + b[1]) / 2,
              (a[2] + b[2]) / 2,
            ]) ?? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
            return rapier.ColliderDesc.cuboid(2, 0.04, length / 2)
              .setTranslation(mid[0], mid[1], mid[2])
              .setRotation(rotation(q));
          },
        );
      }
      for (const o of c.obstacles) {
        const radius = Math.hypot(...o.size);
        register(
          `obstacle:${c.id}:${o.id}`,
          "course",
          [o.position[0] - radius, 0, o.position[2] - radius],
          [o.position[0] + radius, 0, o.position[2] + radius],
          () =>
            rapier.ColliderDesc.cuboid(
              o.size[0] / 2,
              o.size[1] / 2,
              o.size[2] / 2,
            )
              .setTranslation(
                ...(this.worldRuntime?.toSimulation([
                  o.position[0],
                  o.position[1] + o.size[1] / 2,
                  o.position[2],
                ]) ?? [
                  o.position[0],
                  o.position[1] + o.size[1] / 2,
                  o.position[2],
                ]),
              )
              .setRotation(
                rotation(quaternion([o.kind === "jump" ? -0.36 : 0, 0, 0])),
              ),
        );
      }
    }
    this.streamer = new ChunkStreamer(
      (key) => {
        const entries = new Map(builders.get(key));
        const [x, z] = key.split(",").map(Number);
        for (const item of spanning)
          if (
            x >= item.min[0] &&
            x <= item.max[0] &&
            z >= item.min[1] &&
            z <= item.max[1]
          )
            entries.set(item.id, item.entry);
        if (this.worldRuntime?.procedural) {
          const terrain = createTerrainCollider(key);
          if (terrain)
            entries.set(`terrain:${key}`, {
              kind: "terrain",
              create: () => createTerrainCollider(key) ?? terrain,
            });
        }
        const generated = this.worldRuntime?.procedural
          ? (this.worldRuntime.peekChunk(key)?.entities ?? [])
          : [];
        for (const entity of generated) {
          if (!isBuiltinEntityKind(entity.kind)) continue;
          generatedEntityColliders(entity).forEach((pose, index) => {
            entries.set(`entity:${entity.id}:${index}`, {
              kind: "entity",
              create: () => {
                const local =
                  this.worldRuntime?.toSimulation(pose.translation) ??
                  pose.translation;
                return colliderDescFromPose(rapier, pose, local);
              },
            });
          });
        }
        if (!entries.size) return;
        for (const [id, entry] of entries) {
          const existing = this.staticColliders.get(id);
          if (existing) existing.refs++;
          else {
            let collider: RAPIER.Collider;
            try {
              collider = this.world.createCollider(entry.create());
            } catch (error) {
              if (!entry.fallback) throw error;
              collider = this.world.createCollider(entry.fallback());
            }
            this.staticColliders.set(id, {
              collider,
              refs: 1,
              kind: entry.kind,
            });
          }
        }
        return [...entries.keys()];
      },
      (ids) => {
        for (const id of ids) {
          const entry = this.staticColliders.get(id)!;
          if (--entry.refs === 0) {
            this.world.removeCollider(entry.collider, true);
            this.staticColliders.delete(id);
          }
        }
      },
      this.worldRuntime?.chunkSize ?? project.world.chunkSize,
      this.worldRuntime?.procedural
        ? physicsStreaming.loadRadius + 1
        : physicsStreaming.loadRadius,
      this.worldRuntime?.procedural
        ? physicsStreaming.unloadRadius + 1
        : physicsStreaming.unloadRadius,
      this.worldRuntime?.procedural
        ? {
            maxCreatesPerUpdate: physicsStreaming.maxCreatesPerUpdate,
            budgetMs: physicsStreaming.budgetMs,
            urgentRadius: physicsStreaming.urgentRadius,
            prefetch: {
              aheadMax: physicsStreaming.prefetchAheadMax,
              futureHorizonsSec: physicsStreaming.futureHorizonsSec,
              retention: this.prefetchRetention,
              retentionSec: physicsStreaming.retentionSec,
            },
          }
        : undefined,
    );
    this.streamer.update(selectedCourse?.start ?? [0, 1, 0]);
    for (const machine of project.machines) {
      const m = compileMachine(machine);
      if (!m.bodies.length) continue;
      this.forceByMachine.set(machine.id, emptyForceAccumulator());
      const bodies = new Map<string, RAPIER.RigidBody>();
      for (const group of m.bodies) {
        const body = this.world.createRigidBody(
          rapier.RigidBodyDesc.dynamic()
            .setTranslation(0, 1, 0)
            .setLinearDamping(0.1)
            .setAngularDamping(3)
            .setCcdEnabled(true),
        );
        bodies.set(group.id, body);
        let additionalMass = 0;
        for (const p of group.parts) {
          const s = p.physics.size.map((v, i) => v * p.transform.scale[i]),
            q = p.transform.position;
          if (p.physics.collider === "none") {
            additionalMass += p.physics.mass;
            this.parts.push({ part: p, body, machineId: machine.id });
            continue;
          }
          const desc =
            p.physics.collider === "cylinder"
              ? rapier.ColliderDesc.cylinder(s[0] / 2, s[1])
              : rapier.ColliderDesc.cuboid(s[0] / 2, s[1] / 2, s[2] / 2);
          const rot =
            p.physics.collider === "cylinder"
              ? multiply(
                  quaternion(p.transform.rotation),
                  quaternion([0, 0, Math.PI / 2]),
                )
              : quaternion(p.transform.rotation);
          this.world.createCollider(
            desc
              .setTranslation(...q)
              .setRotation(rotation(rot))
              .setMass(p.physics.mass)
              .setFriction(p.physics.friction)
              .setRestitution(p.physics.restitution),
            body,
          );
          this.parts.push({ part: p, body, machineId: machine.id });
        }
        if (additionalMass > 0) body.setAdditionalMass(additionalMass, true);
      }
      for (const c of m.joints) {
        const a = bodies.get(m.bodyForPart.get(c.a)!),
          b = bodies.get(m.bodyForPart.get(c.b)!);
        if (!a || !b || a === b) continue;
        const p = m.parts.find((p) => p.id === c.b)!;
        const anchor = vector(p.transform.position);
        const joint = this.world.createImpulseJoint(
          rapier.JointData.revolute(anchor, anchor, vector(c.axis)),
          a,
          b,
          true,
        ) as RAPIER.RevoluteImpulseJoint;
        joint.setContactsEnabled(false);
        if (c.limits)
          joint.setLimits(c.limits.minAngleRad, c.limits.maxAngleRad);
        const attachedSurface = m.parts.find(
          (candidate) =>
            typeof candidate.metadata.aeroRole === "string" &&
            m.connections.some(
              (link) =>
                link.type === "fixed" &&
                ((link.a === c.b && link.b === candidate.id) ||
                  (link.b === c.b && link.a === candidate.id)),
            ),
        );
        const runtime: RevoluteRuntime = {
          bodyA: a,
          bodyB: b,
          axisLocal: normalize(c.axis),
          damping: c.damping,
          joint,
          label:
            (typeof p.metadata.aeroRole === "string" && p.metadata.aeroRole) ||
            (typeof attachedSurface?.metadata.aeroRole === "string" &&
              attachedSurface.metadata.aeroRole) ||
            p.id,
          limits: c.limits,
        };
        this.hinges.push(runtime);
        // Hinge自身がposition制御を持つ場合はMotor Partなしで関節を駆動する。
        const selfDrivenHinge =
          p.definitionId === "Hinge" && p.actuator.motorMode === "position"
            ? p
            : undefined;
        // Motor出力軸のrevoluteは、Motor自身が関節の親側ドライバーになる。
        const motorOutputDriver =
          c.connectorA === "motor-output"
            ? m.parts.find(
                (candidate) =>
                  candidate.id === c.a && candidate.definitionId === "Motor",
              )
            : undefined;
        const driver =
          selfDrivenHinge ??
          motorOutputDriver ??
          m.parts.find(
            (candidate) =>
              candidate.definitionId === "Motor" &&
              m.bodyForPart.get(candidate.id) === m.bodyForPart.get(c.b) &&
              m.connections.some(
                (link) =>
                  link.type === "fixed" &&
                  ((link.a === c.b && link.b === candidate.id) ||
                    (link.b === c.b && link.a === candidate.id)),
              ),
          );
        if (driver)
          this.motors.push({
            ...runtime,
            part: driver,
            machineId: machine.id,
          });
      }
      const chassis = bodies.get(
        m.bodyForPart.get(
          machine.parts.find((p) => p.definitionId === "Panel")?.id ??
            m.bodies[0].parts[0].id,
        )!,
      )!;
      const controller = this.world.createVehicleController(chassis);
      controller.indexUpAxis = 1;
      controller.setIndexForwardAxis = 2;
      const wheels = m.wheels.filter((w) => {
        const c = m.wheelConnections.find((c) => c.b === w.id)!;
        return bodies.get(m.bodyForPart.get(c.a)!) === chassis;
      });
      const wheelRuntime: WheelRuntime[] = [];
      for (const p of wheels) {
        const connection = m.wheelConnections.find((item) => item.b === p.id);
        if (!connection) continue;
        const restWheelCenter = connectorWorldPosition(p, "0");
        const i = controller.numWheels();
        const suspension = wheelSuspensionSettings(machine, p.id);
        const suspensionDirection: Vec3 = [0, -1, 0];
        const radius = p.physics.size[1] * p.transform.scale[1];
        // Rapierの第1引数はWheel中心ではなく、車体側のサスペンション取付点。
        const hardPoint = suspensionHardPoint(
          restWheelCenter,
          suspensionDirection,
          suspension.restLength,
        );
        controller.addWheel(
          vector(hardPoint),
          { x: 0, y: -1, z: 0 },
          { x: -1, y: 0, z: 0 },
          suspension.restLength,
          radius,
        );
        controller.setWheelSuspensionStiffness(i, suspension.stiffness);
        controller.setWheelSuspensionCompression(i, suspension.compression);
        controller.setWheelSuspensionRelaxation(i, suspension.relaxation);
        controller.setWheelFrictionSlip(i, p.physics.friction * 2);
        controller.setWheelMaxSuspensionForce(i, suspension.maxForce);
        controller.setWheelMaxSuspensionTravel(i, suspension.maxTravel);
        wheelRuntime.push({
          part: p,
          hardPoint,
          restWheelCenter,
          suspensionDirection,
          restLengthM: suspension.restLength,
          maxTravelM: suspension.maxTravel,
          radiusM: radius,
        });
      }
      this.vehicles.push({
        id: m.id,
        body: chassis,
        controller,
        wheels: wheelRuntime.map((item) => item.part),
        wheelRuntime,
      });
    }
  }
  step(input: Record<string, number> | number, steering = 0, brake = false) {
    const controls: Record<string, number> =
      typeof input === "number" ? { throttle: input, steering } : { ...input };
    const throttle = Number.isFinite(controls.throttle)
        ? clamp(controls.throttle, -1, 1)
        : 0,
      steeringValue = Number.isFinite(controls.steering)
        ? clamp(controls.steering, -1, 1)
        : 0,
      brakeValue =
        typeof input === "number"
          ? brake
          : Number.isFinite(controls.brake) && controls.brake > 0;
    const position = this.vehicles[0]?.body.translation();
    const velocity = this.vehicles[0]?.body.linvel();
    if (position) {
      const sim: Vec3 = [position.x, position.y, position.z];
      const global = this.worldRuntime?.toGlobal(sim) ?? sim;
      const vel: Vec3 | undefined = velocity
        ? [velocity.x, velocity.y, velocity.z]
        : undefined;
      if (this.worldRuntime?.procedural) {
        const keys = visibleChunksWithPrefetch(
          global,
          this.worldRuntime.chunkSize,
          physicsStreaming.loadRadius + 1,
          vel,
          {
            aheadMax: physicsStreaming.prefetchAheadMax,
            direction: this.streamer?.direction,
            futureHorizonsSec: physicsStreaming.futureHorizonsSec,
            retention: this.prefetchRetention,
            retentionSec: physicsStreaming.retentionSec,
          },
        );
        const urgent = visibleChunks(
          global,
          this.worldRuntime.chunkSize,
          physicsStreaming.urgentRadius,
        );
        // テストや非 PLAY 経路では urgent を同期準備する。
        // PLAY hot path では Worker Ready + Fixed Step Commit に任せる。
        if (!this.worldRuntime.isPlayHotPath)
          this.worldRuntime.ensureChunks(urgent);
        this.worldRuntime.requestChunks([
          ...[...urgent].map((key) => ({
            key,
            priority: "P0_PHYSICS_CRITICAL" as const,
          })),
          ...[...keys]
            .filter((key) => !urgent.has(key))
            .map((key) => ({
              key,
              priority: "P1_PHYSICS_PREFETCH" as const,
            })),
        ]);
        this.worldRuntime.acquire("physics", keys);
        this.worldRuntime.enqueuePrefetch(keys);
        this.pendingStreamFocus = { global, vel };
        // Engine を経由しない呼び出しでも urgent Collider を追いつかせる。
        if (!this.worldRuntime.isPlayHotPath)
          this.streamer?.update(global, vel);
      } else this.streamer?.update(global);
    }
    for (const machineId of this.forceByMachine.keys())
      this.forceByMachine.set(machineId, emptyForceAccumulator());
    const resetBodies = new Set<RAPIER.RigidBody>();
    for (const { body } of this.parts) {
      if (resetBodies.has(body)) continue;
      resetBodies.add(body);
      resetExternalForces(body);
    }
    for (const v of this.vehicles) {
      v.wheels.forEach((w, i) => {
        v.controller.setWheelEngineForce(
          i,
          w.actuator.enabled && w.metadata.drive
            ? throttle * w.actuator.motorTorque
            : 0,
        );
        v.controller.setWheelSteering(
          i,
          w.metadata.front ? steeringValue * w.actuator.steering : 0,
        );
        v.controller.setWheelBrake(i, brakeValue ? 20 : 0);
      });
      v.controller.updateVehicle(PHYSICS_FIXED_DT);
    }
    for (const hinge of this.hinges) {
      const axisWorld = worldAxis(hinge),
        relativeVelocity = relativeAngularVelocity(hinge, axisWorld);
      if (hinge.damping > 0)
        applyEqualOppositeTorque(
          hinge,
          axisWorld,
          -hinge.damping * relativeVelocity,
        );
    }
    for (const motor of this.motors) {
      const axisWorld = worldAxis(motor),
        actuator = motor.part.actuator,
        controlInput = clamp(
          (Number.isFinite(controls[actuator.controlChannel])
            ? controls[actuator.controlChannel]
            : 0) * actuator.controlGain,
          -1,
          1,
        ),
        actualAngle = relativeAngle(motor),
        forceAccumulator = this.forceByMachine.get(motor.machineId);
      if (actuator.motorMode === "position") {
        const limits = motor.limits ?? {
            minAngleRad: -Math.PI,
            maxAngleRad: Math.PI,
          },
          targetAngle =
            controlInput >= 0
              ? actuator.neutralAngleRad +
                controlInput * (limits.maxAngleRad - actuator.neutralAngleRad)
              : actuator.neutralAngleRad +
                controlInput * (actuator.neutralAngleRad - limits.minAngleRad);
        if (actuator.enabled)
          motor.joint.configureMotorPosition(
            targetAngle,
            actuator.positionStiffness,
            actuator.positionDamping,
          );
        else
          motor.joint.configureMotorPosition(
            actuator.neutralAngleRad,
            actuator.positionStiffness,
            actuator.positionDamping,
          );
        if (forceAccumulator)
          forceAccumulator.motorByPart[motor.part.id] = {
            controlInput,
            targetAngleRad: actuator.enabled
              ? targetAngle
              : actuator.neutralAngleRad,
            actualRelativeAngleRad: actualAngle,
            angleErrorRad:
              (actuator.enabled ? targetAngle : actuator.neutralAngleRad) -
              actualAngle,
          };
      } else if (actuator.enabled && controlInput !== 0) {
        const relativeVelocity = relativeAngularVelocity(motor, axisWorld),
          targetVelocity = controlInput * actuator.targetAngularVelocity,
          appliedTorque = computeBoundedMotorTorque(
            targetVelocity,
            relativeVelocity,
            actuator.motorTorque,
          );
        if (appliedTorque !== 0)
          applyEqualOppositeTorque(motor, axisWorld, appliedTorque);
      }
    }
    const thrustersByBody = new Map<
      RAPIER.RigidBody,
      {
        part: Part;
        body: RAPIER.RigidBody;
        machineId: string;
        localDirection: Vec3;
      }[]
    >();
    for (const { part, body, machineId } of this.parts) {
      if (part.definitionId !== "Thruster" || !part.actuator.enabled) continue;
      const localDirection = rotate(
        [0, 0, 1],
        quaternion(part.transform.rotation),
      );
      thrustersByBody.set(body, [
        ...(thrustersByBody.get(body) ?? []),
        { part, body, machineId, localDirection },
      ]);
    }
    const thrusterCommands = new Map<string, number>();
    for (const entries of thrustersByBody.values()) {
      const forward = entries.filter((entry) =>
        isForwardThruster(entry.localDirection),
      );
      const commands = mixThrusterCommands({
        throttle,
        steering: steeringValue,
        lateralOffsets: forward.map(
          (entry) => entry.part.transform.position[0],
        ),
      });
      forward.forEach((entry, index) =>
        thrusterCommands.set(entry.part.id, commands[index]),
      );
    }
    for (const { part, body, machineId } of this.parts) {
      const panelPose = this.pose(
        body,
        part.transform.position,
        quaternion(part.transform.rotation),
      );
      if (part.definitionId === "Panel") {
        const force = computePanelAerodynamicForce({
          center: panelPose.position,
          normal: rotate([0, 1, 0], panelPose.rotation),
          velocity: velocityAtPoint(body, panelPose.position),
          windVelocity: [0, 0, 0],
          area: PANEL_SIDE * PANEL_SIDE,
          airDensity: AIR_DENSITY,
        });
        const forces = this.forceByMachine.get(machineId);
        if (forces) {
          addInto(forces.lift, force.lift);
          forces.liftMagnitude += vectorMagnitude(force.lift);
          addInto(forces.appliedLift, force.appliedLift);
          addInto(forces.drag, force.drag);
          forces.dragMagnitude += vectorMagnitude(force.drag);
          addInto(forces.appliedDrag, force.appliedDrag);
          addInto(forces.aerodynamic, force.force);
          const center = worldCenterOfMass(body);
          const panelPitchMomentNm = pitchMomentNm(
            panelPose.position,
            force.force,
            center,
          );
          forces.aerodynamicPitchMomentNm += panelPitchMomentNm;
          const role =
            typeof part.metadata.aeroRole === "string"
              ? part.metadata.aeroRole
              : "unclassified";
          forces.aerodynamicPitchMomentByRoleNm[role] =
            (forces.aerodynamicPitchMomentByRoleNm[role] ?? 0) +
            panelPitchMomentNm;
          const roleTelemetry = forces.aerodynamicByRole[role] ?? {
            appliedLiftVerticalN: 0,
            appliedDragN: 0,
            appliedAerodynamicForceN: 0,
            angleOfAttackRad: 0,
            liftCoefficient: 0,
            dragCoefficient: 0,
            pitchMomentNm: 0,
            panelCount: 0,
          };
          roleTelemetry.appliedLiftVerticalN += force.appliedLift[1];
          roleTelemetry.appliedDragN += vectorMagnitude(force.appliedDrag);
          roleTelemetry.appliedAerodynamicForceN += vectorMagnitude(
            force.force,
          );
          roleTelemetry.angleOfAttackRad += force.angleOfAttack;
          roleTelemetry.liftCoefficient += force.liftCoefficient;
          roleTelemetry.dragCoefficient += force.dragCoefficient;
          roleTelemetry.pitchMomentNm += panelPitchMomentNm;
          roleTelemetry.panelCount++;
          forces.aerodynamicByRole[role] = roleTelemetry;
          forces.panelCount++;
          forces.angleOfAttackSum += force.angleOfAttack;
          forces.liftCoefficientSum += force.liftCoefficient;
          forces.dragCoefficientSum += force.dragCoefficient;
        }
        body.addForceAtPoint(
          vector(force.force),
          vector(panelPose.position),
          true,
        );
      }
      if (part.metadata.buoyancy === 1 && this.water.enabled) {
        const buoyancyPose = this.pose(
            body,
            part.transform.position,
            quaternion(part.transform.rotation),
          ),
          size = part.physics.size.map(
            (value, index) => value * part.transform.scale[index],
          ) as Vec3,
          buoyancy = computeBoxBuoyancy({
            waterHeight: this.water.height,
            center: buoyancyPose.position,
            size,
            axes: {
              x: rotate([1, 0, 0], buoyancyPose.rotation),
              y: rotate([0, 1, 0], buoyancyPose.rotation),
              z: rotate([0, 0, 1], buoyancyPose.rotation),
            },
            gravity: this.gravityMagnitude,
          });
        if (buoyancy.displacedVolume > 0) {
          body.addForceAtPoint(
            vector(buoyancy.force),
            vector(buoyancy.applicationPoint),
            true,
          );
          const pointVelocity = velocityAtPoint(
              body,
              buoyancy.applicationPoint,
            ),
            drag = pointVelocity.map(
              (value, index) =>
                -value *
                (index === 1 ? WATER_VERTICAL_DRAG : WATER_LINEAR_DRAG) *
                buoyancy.displacedVolume,
            ) as Vec3;
          body.addForceAtPoint(
            vector(drag),
            vector(buoyancy.applicationPoint),
            true,
          );
        }
      }
      if (part.definitionId === "Thruster" && part.actuator.enabled) {
        const thrusterPose = this.pose(
          body,
          part.transform.position,
          quaternion(part.transform.rotation),
        );
        const direction = rotate([0, 0, 1], thrusterPose.rotation);
        const command = thrusterCommands.get(part.id) ?? throttle;
        const force = direction.map(
          (value) => value * command * part.actuator.motorTorque,
        ) as Vec3;
        const forces = this.forceByMachine.get(machineId);
        if (forces) {
          addInto(forces.thruster, force);
          forces.thrusterMagnitude += vectorMagnitude(force);
          forces.thrusterPitchMomentNm += pitchMomentNm(
            thrusterPose.position,
            force,
            worldCenterOfMass(body),
          );
        }
        body.addForceAtPoint(
          vector(force),
          vector(thrusterPose.position),
          true,
        );
      }
    }
    this.world.step();
    this.physicsStep++;
    this.simulationTimeSeconds += PHYSICS_FIXED_DT;
    this.captureTelemetry(throttle, steeringValue, brakeValue, controls);
  }
  focusSimulation(): Vec3 | undefined {
    const position = this.vehicles[0]?.body.translation();
    return position ? [position.x, position.y, position.z] : undefined;
  }
  focusGlobal(): Vec3 | undefined {
    const simulation = this.focusSimulation();
    return simulation
      ? (this.worldRuntime?.toGlobal(simulation) ?? simulation)
      : undefined;
  }
  /** 直近 Origin Rebase の Physics 内訳（診断用）。 */
  lastRebaseBreakdown = {
    moveRigidBodiesMs: 0,
    moveStandaloneCollidersMs: 0,
    propagateCollidersMs: 0,
    ccdToggleMs: 0,
    rigidBodyCount: 0,
    colliderCount: 0,
    standaloneColliderCount: 0,
  };

  shiftOrigin(delta: Vec3) {
    if (!this.world) return;
    if (delta[0] === 0 && delta[1] === 0 && delta[2] === 0) return;
    const ccd = new Map<number, boolean>();
    let rigidBodyCount = 0;
    let standaloneColliderCount = 0;
    const ccdStarted = performance.now();
    this.world.forEachRigidBody((body) => {
      ccd.set(body.handle, body.isCcdEnabled());
      if (body.isCcdEnabled()) body.enableCcd(false);
    });
    const ccdDisableMs = performance.now() - ccdStarted;
    const bodiesStarted = performance.now();
    this.world.forEachRigidBody((body) => {
      rigidBodyCount++;
      const translation = body.translation(),
        linear = body.linvel(),
        angular = body.angvel(),
        rot = body.rotation();
      body.setTranslation(
        {
          x: translation.x - delta[0],
          y: translation.y - delta[1],
          z: translation.z - delta[2],
        },
        false,
      );
      body.setRotation(rot, false);
      body.setLinvel(linear, false);
      body.setAngvel(angular, false);
    });
    const moveRigidBodiesMs = performance.now() - bodiesStarted;
    const collidersStarted = performance.now();
    this.world.forEachCollider((collider) => {
      if (collider.parent()) return;
      standaloneColliderCount++;
      const translation = collider.translation();
      collider.setTranslation({
        x: translation.x - delta[0],
        y: translation.y - delta[1],
        z: translation.z - delta[2],
      });
    });
    const moveStandaloneCollidersMs = performance.now() - collidersStarted;
    const propagateStarted = performance.now();
    this.world.propagateModifiedBodyPositionsToColliders();
    const propagateCollidersMs = performance.now() - propagateStarted;
    const ccdRestoreStarted = performance.now();
    this.world.forEachRigidBody((body) => {
      if (ccd.get(body.handle)) body.enableCcd(true);
    });
    const ccdToggleMs =
      ccdDisableMs + (performance.now() - ccdRestoreStarted);
    this.lastRebaseBreakdown = {
      moveRigidBodiesMs,
      moveStandaloneCollidersMs,
      propagateCollidersMs,
      ccdToggleMs,
      rigidBodyCount,
      colliderCount: this.world.colliders.len(),
      standaloneColliderCount,
    };
  }
  /** Rebase後に最新Telemetryのsimulation/originを現在座標系へ揃える。 */
  syncOriginTelemetry() {
    const origin = this.worldRuntime?.worldOrigin ?? ([0, 0, 0] as Vec3);
    for (const vehicle of this.vehicles) {
      const sample = this.telemetry.current(vehicle.id);
      if (!sample) continue;
      const translation = vehicle.body.translation();
      const simulation: TelemetryVec3 = [
        translation.x,
        translation.y,
        translation.z,
      ];
      const global =
        this.worldRuntime?.toGlobal(simulation) ?? ([...simulation] as Vec3);
      const chunk = chunkCoordinate(global, this.worldRuntime?.chunkSize ?? 32);
      sample.simulationPosition = simulation;
      sample.worldOrigin = [...origin] as TelemetryVec3;
      sample.position = [...global] as TelemetryVec3;
      sample.chunkCoordinate = [chunk[0], chunk[1]];
    }
  }
  jointAnchorErrors() {
    return this.hinges.map((hinge) => {
      const a1 = hinge.joint.anchor1(),
        a2 = hinge.joint.anchor2(),
        t1 = hinge.bodyA.translation(),
        r1 = hinge.bodyA.rotation(),
        t2 = hinge.bodyB.translation(),
        r2 = hinge.bodyB.rotation(),
        w1 = rotate([a1.x, a1.y, a1.z], [r1.x, r1.y, r1.z, r1.w]),
        w2 = rotate([a2.x, a2.y, a2.z], [r2.x, r2.y, r2.z, r2.w]),
        axis = worldAxis(hinge);
      return {
        id: hinge.label,
        separationM: Math.hypot(
          t1.x + w1[0] - (t2.x + w2[0]),
          t1.y + w1[1] - (t2.y + w2[1]),
          t1.z + w1[2] - (t2.z + w2[2]),
        ),
        relativeAngleRad: relativeAngle(hinge),
        angularVelocity: relativeAngularVelocity(hinge, axis),
      };
    });
  }
  get maxJointAnchorErrorM() {
    return this.lastMaxJointAnchorErrorM;
  }
  private captureTelemetry(
    throttle: number,
    steering: number,
    brake: boolean,
    controls: Record<string, number>,
  ) {
    const safeThrottle = clamp(Number.isFinite(throttle) ? throttle : 0, -1, 1),
      safeSteering = clamp(Number.isFinite(steering) ? steering : 0, -1, 1);
    for (const vehicle of this.vehicles) {
      const position = vehicle.body.translation(),
        rawRotation = vehicle.body.rotation(),
        rotation: Quat = [
          rawRotation.x,
          rawRotation.y,
          rawRotation.z,
          rawRotation.w,
        ],
        rawLinear = vehicle.body.linvel(),
        linearVelocityMps: TelemetryVec3 = [
          rawLinear.x,
          rawLinear.y,
          rawLinear.z,
        ],
        rawAngular = vehicle.body.angvel(),
        angularVelocityRadPerSecond: TelemetryVec3 = [
          rawAngular.x,
          rawAngular.y,
          rawAngular.z,
        ],
        forward = rotate([0, 0, 1], rotation),
        angles = euler(rotation),
        forces = this.forceByMachine.get(vehicle.id) ?? emptyForceAccumulator(),
        machineBodies = new Set(
          this.parts
            .filter((part) => part.machineId === vehicle.id)
            .map((part) => part.body),
        ),
        massKg = [...machineBodies].reduce(
          (total, body) => total + body.mass(),
          0,
        ),
        weightN = massKg * this.gravityMagnitude,
        simulation: Vec3 = [position.x, position.y, position.z],
        global = this.worldRuntime?.toGlobal(simulation) ?? simulation,
        origin = this.worldRuntime?.worldOrigin ?? [0, 0, 0],
        chunk = chunkCoordinate(global, this.worldRuntime?.chunkSize ?? 32),
        sampled = this.worldRuntime
          ? this.worldRuntime.sampleHeight(global[0], global[2])
          : this.terrain
            ? heightAtIfInside(this.terrain, global[0], global[2])
            : undefined,
        terrainAvailable =
          sampled !== undefined ||
          (this.terrain
            ? terrainContainsPoint(this.terrain, global[0], global[2])
            : false) ||
          Boolean(this.worldRuntime?.procedural),
        terrainHeightM =
          sampled ??
          (this.terrain
            ? (heightAtIfInside(this.terrain, global[0], global[2]) ?? null)
            : null),
        wheelApi = vehicle.controller as unknown as {
          wheelIsInContact?: (index: number) => boolean;
          wheelSuspensionForce?: (index: number) => number;
          wheelSuspensionRestLength?: (index: number) => number;
          wheelMaxSuspensionTravel?: (index: number) => number;
        },
        contactStatusAvailable =
          typeof wheelApi.wheelIsInContact === "function",
        wheels = vehicle.wheelRuntime.map((runtime, index) => {
          const wheel = runtime.part,
            restLengthM =
              wheelApi.wheelSuspensionRestLength?.(index) ??
              runtime.restLengthM,
            maxTravelM =
              wheelApi.wheelMaxSuspensionTravel?.(index) ?? runtime.maxTravelM,
            inContact = wheelApi.wheelIsInContact?.(index),
            suspensionForceN = wheelApi.wheelSuspensionForce?.(index);
          return {
            id: wheel.id,
            ...(typeof wheel.metadata.gearRole === "string"
              ? { role: wheel.metadata.gearRole }
              : {}),
            ...(inContact === undefined ? {} : { inContact }),
            suspensionLengthM:
              vehicle.controller.wheelSuspensionLength(index) ??
              runtime.restLengthM,
            restLengthM,
            maxTravelM,
            minimumLengthM: Math.max(0.05, restLengthM - maxTravelM),
            ...(suspensionForceN === undefined ? {} : { suspensionForceN }),
          };
        }),
        groundedWheelCount = contactStatusAvailable
          ? wheels.filter((wheel) => wheel.inContact).length
          : 0;
      const joints = this.jointAnchorErrors();
      this.lastMaxJointAnchorErrorM = joints.reduce(
        (max, joint) => Math.max(max, joint.separationM),
        0,
      );
      const jointAnchorErrors = Object.fromEntries(
        joints.map((joint) => [joint.id, joint.separationM]),
      );
      const aerodynamicByRole = Object.fromEntries(
        Object.entries(forces.aerodynamicByRole).map(([role, value]) => [
          role,
          {
            ...value,
            angleOfAttackRad:
              value.panelCount > 0
                ? value.angleOfAttackRad / value.panelCount
                : 0,
            liftCoefficient:
              value.panelCount > 0
                ? value.liftCoefficient / value.panelCount
                : 0,
            dragCoefficient:
              value.panelCount > 0
                ? value.dragCoefficient / value.panelCount
                : 0,
          },
        ]),
      );
      this.telemetry.record({
        version: 1,
        step: this.physicsStep,
        timeSeconds: this.simulationTimeSeconds,
        machineId: vehicle.id,
        position: global,
        simulationPosition: simulation,
        worldOrigin: [...origin] as TelemetryVec3,
        chunkCoordinate: [chunk[0], chunk[1]],
        rotation,
        linearVelocityMps,
        angularVelocityRadPerSecond,
        worldSpeedMps: worldSpeedMps(linearVelocityMps),
        horizontalSpeedMps: horizontalSpeedMps(linearVelocityMps),
        forwardSpeedMps: calculateForwardSpeedMps(linearVelocityMps, forward),
        verticalSpeedMps: linearVelocityMps[1],
        throttle: safeThrottle,
        steering: safeSteering,
        controlChannels: { ...controls },
        motorByPart: { ...forces.motorByPart },
        brake: Boolean(brake),
        pitchRad: angles[0],
        yawRad: angles[1],
        rollRad: angles[2],
        totalLiftN: forces.liftMagnitude,
        liftVerticalN: forces.lift[1],
        totalDragN: forces.dragMagnitude,
        totalAerodynamicForceN: vectorMagnitude(forces.aerodynamic),
        rawLiftVerticalN: forces.lift[1],
        rawDragN: forces.dragMagnitude,
        appliedAerodynamicForceWorldN: [...forces.aerodynamic],
        appliedAerodynamicVerticalN: forces.aerodynamic[1],
        appliedAerodynamicToWeightRatio:
          weightN > 0 ? vectorMagnitude(forces.aerodynamic) / weightN : 0,
        aerodynamicPitchMomentNm: forces.aerodynamicPitchMomentNm,
        aerodynamicPitchMomentByRoleNm: {
          ...forces.aerodynamicPitchMomentByRoleNm,
        },
        aerodynamicByRole,
        totalThrusterForceN: forces.thrusterMagnitude,
        thrusterPitchMomentNm: forces.thrusterPitchMomentNm,
        totalPitchMomentNm:
          forces.aerodynamicPitchMomentNm + forces.thrusterPitchMomentNm,
        thrusterForceWorldN: [...forces.thruster],
        averageAngleOfAttackRad:
          forces.panelCount > 0
            ? forces.angleOfAttackSum / forces.panelCount
            : 0,
        averageLiftCoefficient:
          forces.panelCount > 0
            ? forces.liftCoefficientSum / forces.panelCount
            : 0,
        averageDragCoefficient:
          forces.panelCount > 0
            ? forces.dragCoefficientSum / forces.panelCount
            : 0,
        liftToWeightRatio: weightN > 0 ? forces.lift[1] / weightN : 0,
        massKg,
        weightN,
        terrainAvailable,
        terrainHeightM,
        heightAboveTerrainM:
          terrainHeightM === null ? null : global[1] - terrainHeightM,
        contactStatusAvailable,
        groundedWheelCount,
        maxJointAnchorErrorM: this.lastMaxJointAnchorErrorM,
        jointAnchorErrors,
        wheels,
      });
    }
  }
  private pose(
    body: RAPIER.RigidBody,
    local: Vec3 = [0, 0, 0],
    localRotation: Quat = [0, 0, 0, 1],
  ): Pose {
    const p = body.translation(),
      q = body.rotation(),
      quat: Quat = [q.x, q.y, q.z, q.w],
      offset = rotate(local, quat);
    return {
      position: [p.x + offset[0], p.y + offset[1], p.z + offset[2]],
      rotation: multiply(quat, localRotation),
    };
  }
  poses() {
    const result = new Map<string, Pose>();
    for (const v of this.vehicles) result.set(v.id, this.pose(v.body));
    for (const { part, body } of this.parts)
      result.set(
        part.id,
        this.pose(
          body,
          part.transform.position,
          quaternion(part.transform.rotation),
        ),
      );
    for (const v of this.vehicles)
      v.wheelRuntime.forEach((runtime, i) => {
        const length =
            v.controller.wheelSuspensionLength(i) ?? runtime.restLengthM,
          p = wheelCenterFromSuspension(
            runtime.hardPoint,
            runtime.suspensionDirection,
            length,
          ),
          w = runtime.part;
        result.set(
          w.id,
          this.pose(
            v.body,
            p,
            multiply(
              quaternion([0, v.controller.wheelSteering(i) ?? 0, 0]),
              quaternion([v.controller.wheelRotation(i) ?? 0, 0, 0]),
            ),
          ),
        );
      });
    return result;
  }
  /** Fixed Update の catch-up 後に1回だけ呼び、Collider 作成予算を Frame 単位にする。 */
  flushStreaming() {
    const focus = this.pendingStreamFocus;
    this.pendingStreamFocus = undefined;
    if (!focus || !this.streamer) return this.lastStreamStats;
    const stream = this.streamer.update(focus.global, focus.vel);
    this.lastStreamStats = {
      created: stream.created,
      pending: stream.pending,
      commitMs: stream.commitMs,
      syncFallback: stream.syncFallback,
    };
    return this.lastStreamStats;
  }

  /**
   * Physics Critical: Fixed Step 前に urgent 半径の Rapier Collider まで作る。
   * WorldRuntime の Prepared Cache Commit の直後に呼ぶこと。
   */
  commitCriticalColliders() {
    if (!this.streamer) return this.lastStreamStats;
    const body = this.vehicles[0]?.body;
    const translation = body?.translation();
    if (!translation) return this.lastStreamStats;
    const sim: Vec3 = [translation.x, translation.y, translation.z];
    const global = this.worldRuntime?.toGlobal(sim) ?? sim;
    const linvel = body?.linvel();
    const vel: Vec3 | undefined = linvel
      ? [linvel.x, linvel.y, linvel.z]
      : undefined;
    const stream = this.streamer.commitUrgent(global, vel);
    this.lastStreamStats = {
      created: stream.created,
      pending: stream.pending,
      commitMs: stream.commitMs,
      syncFallback: stream.syncFallback,
    };
    return this.lastStreamStats;
  }
  renderState(): PhysicsRenderState {
    const poses = this.poses(),
      wheels = new Map<string, WheelRenderState>();
    for (const vehicle of this.vehicles) {
      const rawRotation = vehicle.body.rotation(),
        bodyRotation: Quat = [
          rawRotation.x,
          rawRotation.y,
          rawRotation.z,
          rawRotation.w,
        ];
      vehicle.wheelRuntime.forEach((runtime, index) => {
        const suspensionLengthM =
            vehicle.controller.wheelSuspensionLength(index) ??
            runtime.restLengthM,
          restLengthM =
            vehicle.controller.wheelSuspensionRestLength(index) ??
            runtime.restLengthM,
          maxTravelM =
            vehicle.controller.wheelMaxSuspensionTravel(index) ??
            runtime.maxTravelM,
          inContact = vehicle.controller.wheelIsInContact(index),
          suspensionForceN = vehicle.controller.wheelSuspensionForce(index),
          pose = poses.get(runtime.part.id);
        if (!pose) return;
        wheels.set(runtime.part.id, {
          partId: runtime.part.id,
          pose,
          suspensionLengthM,
          suspensionDirectionWorld: rotate(
            runtime.suspensionDirection,
            bodyRotation,
          ),
          restLengthM,
          maxTravelM,
          minimumLengthM: Math.max(0.05, restLengthM - maxTravelM),
          inContact,
          suspensionForceN: suspensionForceN ?? undefined,
          wheelRadiusM: runtime.radiusM,
        });
      });
    }
    return { poses, wheels };
  }
  wheelStates() {
    return this.renderState().wheels;
  }
  respawn(position: Vec3 = [0, 2, 0]) {
    if (!this.world) return;
    this.streamer?.update(position);
    const local = this.worldRuntime?.toSimulation(position) ?? position;
    this.world.bodies.forEach((body) => {
      body.setTranslation({ x: local[0], y: local[1] + 1, z: local[2] }, true);
      body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    });
  }
  get stats() {
    return {
      physicsChunksLoaded: this.streamer?.loaded.size ?? 0,
      physicsChunksCreated: this.lastStreamStats.created,
      physicsChunkPending: this.lastStreamStats.pending,
      physicsCommitMs: this.lastStreamStats.commitMs,
      physicsSyncFallback: this.lastStreamStats.syncFallback,
      terrainChunkColliders: [...this.staticColliders.values()].filter(
        (c) => c.kind === "terrain",
      ).length,
      worldEntityColliders: [...this.staticColliders.values()].filter(
        (c) => c.kind === "entity",
      ).length,
      rigidBodies: this.world?.bodies.len() ?? 0,
      colliders: this.world?.colliders.len() ?? 0,
      joints: this.world?.impulseJoints.len() ?? 0,
      maxJointAnchorErrorM: this.lastMaxJointAnchorErrorM,
    };
  }
  dispose() {
    this.generation++;
    this.streamer?.dispose();
    this.prefetchRetention.reset();
    this.pendingStreamFocus = undefined;
    this.streamer = undefined;
    this.staticColliders.clear();
    this.colliderTemplates.clear();
    if (this.world) {
      this.world.free();
      this.world = undefined as unknown as RAPIER.World;
    }
    this.vehicles = [];
    this.parts = [];
    this.forceByMachine.clear();
    this.terrain = undefined;
    if (this.ownsRuntime) this.worldRuntime?.dispose();
    if (this.ownsRuntime) this.worldRuntime = undefined;
    this.physicsStep = 0;
    this.simulationTimeSeconds = 0;
    this.telemetry.stop();
    this.telemetry.clear();
    this.hinges = [];
    this.motors = [];
  }
}
