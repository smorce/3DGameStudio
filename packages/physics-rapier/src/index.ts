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
import { compileMachine } from "../../machine-system/src/index";
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
} from "../../runtime-telemetry/src/index";
export interface Pose {
  position: Vec3;
  rotation: Quat;
}
const PHYSICS_FIXED_DT = 1 / 60;
// 速度誤差1 rad/sあたりに要求するトルク。最終出力はmaxTorqueで制限する。
const MOTOR_VELOCITY_CONTROLLER_GAIN = 40;
interface RevoluteRuntime {
  bodyA: RAPIER.RigidBody;
  bodyB: RAPIER.RigidBody;
  axisLocal: Vec3;
  damping: number;
}
interface MotorRuntime extends RevoluteRuntime {
  part: Part;
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
const addInto = (target: Vec3, value: Vec3) => {
  target[0] += value[0];
  target[1] += value[1];
  target[2] += value[2];
};
interface ForceAccumulator {
  lift: Vec3;
  liftMagnitude: number;
  drag: Vec3;
  dragMagnitude: number;
  aerodynamic: Vec3;
  thruster: Vec3;
  thrusterMagnitude: number;
  panelCount: number;
  angleOfAttackSum: number;
  liftCoefficientSum: number;
  dragCoefficientSum: number;
}
const emptyForceAccumulator = (): ForceAccumulator => ({
  lift: [0, 0, 0],
  liftMagnitude: 0,
  drag: [0, 0, 0],
  dragMagnitude: 0,
  aerodynamic: [0, 0, 0],
  thruster: [0, 0, 0],
  thrusterMagnitude: 0,
  panelCount: 0,
  angleOfAttackSum: 0,
  liftCoefficientSum: 0,
  dragCoefficientSum: 0,
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
  }[] = [];
  private parts: {
    part: Part;
    body: RAPIER.RigidBody;
    machineId: string;
  }[] = [];
  private forceByMachine = new Map<string, ForceAccumulator>();
  private water: WaterSurface = { enabled: false, height: 0 };
  private gravityMagnitude = 9.81;
  private hinges: RevoluteRuntime[] = [];
  private motors: MotorRuntime[] = [];
  async load(project: Project, options: { courseId?: string | null } = {}) {
    this.dispose();
    const generation = this.generation;
    const rapier = await initialize();
    if (generation !== this.generation) return;
    this.world = new rapier.World(vector(project.settings.gravity));
    this.world.timestep = PHYSICS_FIXED_DT;
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
        for (const p of group.parts) {
          const s = p.physics.size.map((v, i) => v * p.transform.scale[i]),
            q = p.transform.position;
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
        const runtime: RevoluteRuntime = {
          bodyA: a,
          bodyB: b,
          axisLocal: normalize(c.axis),
          damping: c.damping,
        };
        this.hinges.push(runtime);
        const driver = m.parts.find(
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
        if (driver) this.motors.push({ ...runtime, part: driver });
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
      for (const p of wheels) {
        const i = controller.numWheels();
        controller.addWheel(
          vector(p.transform.position),
          { x: 0, y: -1, z: 0 },
          { x: -1, y: 0, z: 0 },
          0.35,
          p.physics.size[1] * p.transform.scale[1],
        );
        controller.setWheelSuspensionStiffness(i, 10);
        controller.setWheelSuspensionCompression(i, 2);
        controller.setWheelSuspensionRelaxation(i, 1);
        controller.setWheelFrictionSlip(i, p.physics.friction * 2);
        controller.setWheelMaxSuspensionForce(i, 10000);
      }
      this.vehicles.push({ id: m.id, body: chassis, controller, wheels });
    }
  }
  step(throttle: number, steering: number, brake = false) {
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
          w.metadata.front ? steering * w.actuator.steering : 0,
        );
        v.controller.setWheelBrake(i, brake ? 20 : 0);
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
    const input = Number.isFinite(throttle) ? clamp(throttle, -1, 1) : 0;
    for (const motor of this.motors) {
      if (!motor.part.actuator.enabled || input === 0) continue;
      const axisWorld = worldAxis(motor),
        relativeVelocity = relativeAngularVelocity(motor, axisWorld),
        targetVelocity = input * motor.part.actuator.targetAngularVelocity,
        appliedTorque = computeBoundedMotorTorque(
          targetVelocity,
          relativeVelocity,
          motor.part.actuator.motorTorque,
        );
      if (appliedTorque !== 0)
        applyEqualOppositeTorque(motor, axisWorld, appliedTorque);
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
        throttle: input,
        steering,
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
          addInto(forces.drag, force.drag);
          forces.dragMagnitude += vectorMagnitude(force.drag);
          addInto(forces.aerodynamic, force.force);
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
        const command = thrusterCommands.get(part.id) ?? input;
        const force = direction.map(
          (value) => value * command * part.actuator.motorTorque,
        ) as Vec3;
        const forces = this.forceByMachine.get(machineId);
        if (forces) {
          addInto(forces.thruster, force);
          forces.thrusterMagnitude += vectorMagnitude(force);
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
    this.captureTelemetry(throttle, steering, brake);
  }
  private captureTelemetry(throttle: number, steering: number, brake: boolean) {
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
        wheelApi = vehicle.controller as unknown as {
          wheelIsInContact?: (index: number) => boolean;
          wheelSuspensionForce?: (index: number) => number;
        },
        contactStatusAvailable =
          typeof wheelApi.wheelIsInContact === "function",
        wheels = vehicle.wheels.map((wheel, index) => {
          const inContact = wheelApi.wheelIsInContact?.(index),
            suspensionForceN = wheelApi.wheelSuspensionForce?.(index);
          return {
            id: wheel.id,
            ...(inContact === undefined ? {} : { inContact }),
            suspensionLengthM:
              vehicle.controller.wheelSuspensionLength(index) ?? 0.35,
            ...(suspensionForceN === undefined ? {} : { suspensionForceN }),
          };
        }),
        groundedWheelCount = contactStatusAvailable
          ? wheels.filter((wheel) => wheel.inContact).length
          : 0;
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
        brake: Boolean(brake),
        pitchRad: angles[0],
        yawRad: angles[1],
        rollRad: angles[2],
        totalLiftN: forces.liftMagnitude,
        liftVerticalN: forces.lift[1],
        totalDragN: forces.dragMagnitude,
        totalAerodynamicForceN: vectorMagnitude(forces.aerodynamic),
        totalThrusterForceN: forces.thrusterMagnitude,
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
      v.wheels.forEach((w, i) => {
        const p = [...w.transform.position] as Vec3;
        p[1] -= v.controller.wheelSuspensionLength(i) ?? 0.35;
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
    this.physicsStep = 0;
    this.simulationTimeSeconds = 0;
    this.telemetry.stop();
    this.telemetry.clear();
    this.hinges = [];
    this.motors = [];
  }
}
