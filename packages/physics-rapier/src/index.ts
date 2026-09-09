import type RAPIER from "@dimforge/rapier3d-compat";
import type { Project, Vec3, Part } from "../../project-schema/src/index";
import {
  submergedDepth,
  type WaterSurface,
} from "../../water-system/src/index";
import { compileMachine } from "../../machine-system/src/index";
import {
  quaternion,
  multiply,
  rotate,
  type Quat,
} from "../../machine-system/src/math";
export interface Pose {
  position: Vec3;
  rotation: Quat;
}
const vector = (v: Vec3) => ({ x: v[0], y: v[1], z: v[2] });
const rotation = (q: Quat) => ({ x: q[0], y: q[1], z: q[2], w: q[3] });
let initialized: Promise<typeof RAPIER> | undefined;
const initialize = () =>
  (initialized ??= (async () => {
    const api = await import("@dimforge/rapier3d-compat");
    await api.init();
    return api;
  })());
export class RapierPhysics {
  world!: RAPIER.World;
  vehicles: {
    id: string;
    body: RAPIER.RigidBody;
    controller: RAPIER.DynamicRayCastVehicleController;
    wheels: Part[];
  }[] = [];
  private parts: { part: Part; body: RAPIER.RigidBody }[] = [];
  private water: WaterSurface = { enabled: false, height: 0 };
  private motors: {
    joint: RAPIER.RevoluteImpulseJoint;
    part: Part;
    damping: number;
  }[] = [];
  async load(project: Project) {
    const rapier = await initialize();
    this.dispose();
    this.world = new rapier.World(vector(project.settings.gravity));
    this.water = structuredClone(project.world.water);
    const t = project.world.terrain,
      vertices: number[] = [],
      indices: number[] = [];
    for (let j = 0; j < t.resolution; j++)
      for (let i = 0; i < t.resolution; i++) {
        vertices.push(
          (i / (t.resolution - 1) - 0.5) * t.size,
          t.heights[j * t.resolution + i],
          (j / (t.resolution - 1) - 0.5) * t.size,
        );
        if (i < t.resolution - 1 && j < t.resolution - 1) {
          const k = j * t.resolution + i;
          indices.push(
            k,
            k + t.resolution,
            k + 1,
            k + 1,
            k + t.resolution,
            k + t.resolution + 1,
          );
        }
      }
    this.world.createCollider(
      rapier.ColliderDesc.trimesh(
        new Float32Array(vertices),
        new Uint32Array(indices),
      ).setFriction(1.4),
    );
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
      this.world.createCollider(
        rapier.ColliderDesc.cuboid(half[0], half[1], half[2])
          .setTranslation(p[0] + offset[0], p[1] + offset[1], p[2] + offset[2])
          .setRotation(rotation(quaternion(e.transform.rotation))),
      );
    }

    for (const c of project.courses) {
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
        this.world.createCollider(
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
        this.world.createCollider(
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
    for (const machine of project.machines) {
      const m = compileMachine(machine);
      if (!m.bodies.length) continue;
      const bodies = new Map<string, RAPIER.RigidBody>();
      for (const group of m.bodies) {
        const body = this.world.createRigidBody(
          rapier.RigidBodyDesc.dynamic()
            .setTranslation(0, 1, 0)
            .setLinearDamping(0.1)
            .setAngularDamping(0.6)
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
          this.parts.push({ part: p, body });
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
        this.motors.push({ joint, part: p, damping: c.damping });
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
        controller.setWheelSuspensionStiffness(i, 35);
        controller.setWheelSuspensionCompression(i, 4.4);
        controller.setWheelSuspensionRelaxation(i, 2.3);
        controller.setWheelFrictionSlip(i, p.physics.friction * 2);
        controller.setWheelMaxSuspensionForce(i, 10000);
      }
      this.vehicles.push({ id: m.id, body: chassis, controller, wheels });
    }
  }
  step(throttle: number, steering: number, brake = false) {
    for (const v of this.vehicles) {
      const extraPower =
        this.parts
          .filter(
            (p) =>
              p.body === v.body &&
              p.part.definitionId === "Motor" &&
              p.part.actuator.enabled,
          )
          .reduce((n, p) => n + p.part.actuator.motorTorque, 0) /
        Math.max(1, v.wheels.filter((w) => w.metadata.drive).length);
      v.wheels.forEach((w, i) => {
        v.controller.setWheelEngineForce(
          i,
          w.actuator.enabled && w.metadata.drive
            ? throttle * (w.actuator.motorTorque + extraPower)
            : 0,
        );
        v.controller.setWheelSteering(
          i,
          w.metadata.front ? steering * w.actuator.steering : 0,
        );
        v.controller.setWheelBrake(i, brake ? 20 : 0);
      });
      v.controller.updateVehicle(1 / 60);
    }
    for (const { joint, part, damping } of this.motors)
      joint.configureMotorVelocity(
        part.actuator.enabled ? (throttle * part.actuator.motorTorque) / 20 : 0,
        damping + 1,
      );
    for (const { part, body } of this.parts) {
      const velocity = body.linvel();
      if (part.metadata.buoyancy) {
        const position = this.pose(body, part.transform.position).position;
        const depth = submergedDepth(this.water, position[1]);
        if (depth > 0) {
          body.applyImpulse(
            {
              x: -velocity.x * 0.5,
              y: Math.max(
                -10,
                Math.min(
                  15,
                  (part.physics.mass * 9.81 * Math.min(2, depth / 0.3) -
                    velocity.y * part.physics.mass * 3) /
                    60,
                ),
              ),
              z: -velocity.z * 0.5,
            },
            true,
          );
          body.applyTorqueImpulse(
            { x: 0, y: steering * throttle * 0.1, z: 0 },
            true,
          );
        }
      }
      if (part.definitionId === "Wing") {
        const speed = Math.hypot(velocity.x, velocity.z);
        const lift = rotate(
          [0, Math.min(speed * speed * 0.06, 2), 0],
          quaternion(part.transform.rotation),
        );
        body.applyImpulse(vector(lift), true);
      }
      if (part.definitionId === "Thruster" && part.actuator.enabled) {
        const q = body.rotation(),
          direction = rotate(
            [0, 0, (throttle * part.actuator.motorTorque) / 60],
            multiply([q.x, q.y, q.z, q.w], quaternion(part.transform.rotation)),
          );
        body.applyImpulse(vector(direction), true);
      }
    }
    this.world.timestep = 1 / 60;
    this.world.step();
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
      rigidBodies: this.world?.bodies.len() ?? 0,
      colliders: this.world?.colliders.len() ?? 0,
      joints: this.world?.impulseJoints.len() ?? 0,
    };
  }
  dispose() {
    if (this.world) {
      this.world.free();
      this.world = undefined as unknown as RAPIER.World;
    }
    this.vehicles = [];
    this.parts = [];
    this.motors = [];
  }
}
