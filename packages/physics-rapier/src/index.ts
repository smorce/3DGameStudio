import { ColliderTemplateCache } from "../../asset-core/src/collider";
import {
  terrainChunks,
  ChunkStreamer,
  physicsStreaming,
} from "../../world-system/src/streaming";
import { chunkCoordinate } from "../../world-system/src/index";
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
  private hinges: RevoluteRuntime[] = [];
  private motors: MotorRuntime[] = [];
  async load(project: Project, options: { courseId?: string | null } = {}) {
    this.dispose();
    const generation = this.generation;
    const rapier = await initialize();
    if (generation !== this.generation) return;
    this.world = new rapier.World(vector(project.settings.gravity));
    this.world.timestep = PHYSICS_FIXED_DT;
    this.terrain = project.world.terrain;
    this.water = structuredClone(project.world.water);
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
      const [x0, z0] = chunkCoordinate(min, project.world.chunkSize),
        [x1, z1] = chunkCoordinate(max, project.world.chunkSize);
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
      const box = () =>
        rapier.ColliderDesc.cuboid(half[0], half[1], half[2])
          .setTranslation(p[0] + offset[0], p[1] + offset[1], p[2] + offset[2])
          .setRotation(rotation(quaternion(e.transform.rotation)));
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
                  .setTranslation(...p)
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
          () =>
            rapier.ColliderDesc.cuboid(2, 0.04, length / 2)
              .setTranslation(
                (a[0] + b[0]) / 2,
                (a[1] + b[1]) / 2,
                (a[2] + b[2]) / 2,
              )
              .setRotation(rotation(q)),
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
                o.position[0],
                o.position[1] + o.size[1] / 2,
                o.position[2],
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
      project.world.chunkSize,
      physicsStreaming.loadRadius,
      physicsStreaming.unloadRadius,
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
        const runtime: RevoluteRuntime = {
          bodyA: a,
          bodyB: b,
          axisLocal: normalize(c.axis),
          damping: c.damping,
          joint,
          limits: c.limits,
        };
        this.hinges.push(runtime);
        // Hinge自身がposition制御を持つ場合はMotor Partなしで関節を駆動する。
        const selfDrivenHinge =
          p.definitionId === "Hinge" && p.actuator.motorMode === "position"
            ? p
            : undefined;
        const driver =
          selfDrivenHinge ??
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
    if (position) this.streamer?.update([position.x, position.y, position.z]);
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
        terrainAvailable = this.terrain
          ? terrainContainsPoint(this.terrain, position.x, position.z)
          : false,
        terrainHeightM = this.terrain
          ? (heightAtIfInside(this.terrain, position.x, position.z) ?? null)
          : null,
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
        position: [position.x, position.y, position.z],
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
          terrainHeightM === null ? null : position.y - terrainHeightM,
        contactStatusAvailable,
        groundedWheelCount,
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
    this.world.bodies.forEach((body) => {
      body.setTranslation(
        { x: position[0], y: position[1] + 1, z: position[2] },
        true,
      );
      body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    });
  }
  get stats() {
    return {
      physicsChunksLoaded: this.streamer?.loaded.size ?? 0,
      terrainChunkColliders: [...this.staticColliders.values()].filter(
        (c) => c.kind === "terrain",
      ).length,
      worldEntityColliders: [...this.staticColliders.values()].filter(
        (c) => c.kind === "entity",
      ).length,
      rigidBodies: this.world?.bodies.len() ?? 0,
      colliders: this.world?.colliders.len() ?? 0,
      joints: this.world?.impulseJoints.len() ?? 0,
    };
  }
  dispose() {
    this.generation++;
    this.streamer?.dispose();
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
    this.physicsStep = 0;
    this.simulationTimeSeconds = 0;
    this.telemetry.stop();
    this.telemetry.clear();
    this.hinges = [];
    this.motors = [];
  }
}
