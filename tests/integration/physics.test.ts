import { it, expect } from "vitest";
import { emptyProject } from "../../packages/project-schema/src/index";
import {
  attachPart,
  commitAttachment,
  createMachine,
  createPart,
  findAttachmentCandidates,
  carTemplate,
} from "../../packages/machine-system/src/index";
import { RapierPhysics } from "../../packages/physics-rapier/src/index";
import { CommandBus } from "../../packages/command-system/src/index";
import { saveProject, loadProject } from "../../packages/storage/src/index";

function motorFixture({
  maxTorque = 180,
  targetAngularVelocity = 10,
  enabled = true,
  extraBlocks = 0,
  extraBlockMass = 3,
  withMotor = true,
  unconnectedMotor = false,
} = {}) {
  const project = emptyProject();
  project.settings.gravity = [0, 0, 0];
  const machine = createMachine("Motor test"),
    root = createPart("Panel", [0, 1, 0]);
  attachPart(machine, root);
  const hinge = createPart("Hinge");
  attachPart(machine, hinge);
  const child = createPart("Panel");
  const childCandidate = findAttachmentCandidates(machine, "Panel").find(
    (candidate) =>
      candidate.parentPartId === hinge.id &&
      candidate.parentConnectorId === "hinge-output",
  );
  if (!childCandidate)
    throw new Error("Motor fixture hinge output unavailable");
  commitAttachment(machine, child, childCandidate);
  const revolute = machine.connections.find(
    (connection) => connection.type === "revolute",
  )!;
  let motor: ReturnType<typeof createPart> | undefined;
  if (withMotor) {
    motor = createPart("Motor", [...hinge.transform.position]);
    motor.actuator.motorTorque = maxTorque;
    motor.actuator.targetAngularVelocity = targetAngularVelocity;
    motor.actuator.enabled = enabled;
    machine.parts.push(motor);
    machine.connections.push({
      id: "motor-mount",
      a: hinge.id,
      b: motor.id,
      connectorA: "hinge-output",
      connectorB: "mount",
      type: "fixed",
      axis: [...revolute.axis],
      damping: 0.2,
    });
  }
  for (let i = 0; i < extraBlocks; i++) {
    const block = createPart("Block", [0, 1, 2 + i * 0.75]);
    block.physics.mass = extraBlockMass;
    machine.parts.push(block);
    machine.connections.push({
      id: `block-mount-${i}`,
      a: hinge.id,
      b: block.id,
      connectorA: "hinge-output",
      connectorB: "mount",
      type: "fixed",
      axis: [...revolute.axis],
      damping: 0.2,
    });
  }
  if (unconnectedMotor) machine.parts.push(createPart("Motor", [4, 1, 0]));
  project.machines.push(machine);
  return { project, machine, root, hinge, child, motor, axis: revolute.axis };
}

function axisVelocity(
  body: { angvel(): { x: number; y: number; z: number } },
  axis: number[],
) {
  const angular = body.angvel();
  return angular.x * axis[0] + angular.y * axis[1] + angular.z * axis[2];
}
function relativeAxisVelocity(
  bodies: { angvel(): { x: number; y: number; z: number } }[],
  axis: number[],
) {
  return axisVelocity(bodies[1], axis) - axisVelocity(bodies[0], axis);
}
it("4輪車が物理世界で前進し編集・保存データを変更しない", async () => {
  const bus = new CommandBus(emptyProject());
  bus.execute({ type: "machine.create", machine: carTemplate() });
  const before = bus.project;
  const physics = new RapierPhysics();
  await physics.load(before);
  for (let i = 0; i < 120; i++) physics.step(0, 0);
  const a = physics.poses().values().next().value!.position;
  for (let i = 0; i < 240; i++) physics.step(1, 0);
  const b = physics.poses().values().next().value!.position;
  expect(Math.hypot(b[0] - a[0], b[2] - a[2])).toBeGreaterThan(2);
  expect(Number.isFinite(b[1])).toBe(true);
  expect(bus.project).toEqual(before);
  const data = new Map<string, string>();
  const storage = {
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    getItem: (k: string) => data.get(k) ?? null,
  };
  saveProject(storage, bus.project);
  expect(loadProject(storage)).toEqual(before);
  physics.dispose();
});

it("接続グループの分離、可動関節、ジェット推力を実行する", async () => {
  const { createPart, attachPart } =
    await import("../../packages/machine-system/src/index");
  const p = emptyProject(),
    m = carTemplate();
  const hinge = createPart("Hinge", [0, 1.8, 0]);
  attachPart(m, hinge);
  const jet = createPart("Thruster", [0, 1, -1.7]);
  attachPart(m, jet);
  p.machines.push(m);
  const physics = new RapierPhysics();
  await physics.load(p);
  expect(physics.stats.rigidBodies).toBe(2);
  expect(physics.stats.joints).toBe(1);
  for (let i = 0; i < 120; i++) physics.step(1, 0.1);
  expect(physics.poses().has(hinge.id)).toBe(true);
  expect(physics.poses().get(m.id)!.position.every(Number.isFinite)).toBe(true);
  physics.dispose();
});

it("接続Motorは正方向へ回転させ、両Bodyへ反作用を伝える", async () => {
  const fixture = motorFixture();
  const physics = new RapierPhysics();
  await physics.load(fixture.project);
  for (let i = 0; i < 30; i++) physics.step(1, 0);
  const bodies = physics.world.bodies.getAll(),
    axis = fixture.axis,
    bodyAVelocity = axisVelocity(bodies[0], axis),
    bodyBVelocity = axisVelocity(bodies[1], axis);
  expect(bodyBVelocity).toBeGreaterThan(0);
  expect(bodyAVelocity).toBeLessThan(0);
  physics.dispose();
});

it("MotorなしHingeは受動的に回転し、Motorの0入力は駆動しない", async () => {
  const fixture = motorFixture({ withMotor: false }),
    physics = new RapierPhysics();
  await physics.load(fixture.project);
  expect(physics.stats.joints).toBe(1);
  const bodies = physics.world.bodies.getAll();
  bodies[1].setAngvel(
    { x: fixture.axis[0], y: fixture.axis[1], z: fixture.axis[2] },
    true,
  );
  physics.step(0, 0);
  expect(Math.abs(axisVelocity(bodies[1], fixture.axis))).toBeGreaterThan(0.01);
  physics.dispose();

  const driven = new RapierPhysics(),
    motorFixtureWithZeroInput = motorFixture();
  await driven.load(motorFixtureWithZeroInput.project);
  for (let i = 0; i < 30; i++) driven.step(0, 0);
  expect(
    Math.abs(
      axisVelocity(
        driven.world.bodies.getAll()[1],
        motorFixtureWithZeroInput.axis,
      ),
    ),
  ).toBeLessThan(0.01);
  driven.dispose();
});

it("負方向throttleは逆回転し、disabled Motorは駆動しない", async () => {
  const negativeFixture = motorFixture(),
    negativePhysics = new RapierPhysics();
  await negativePhysics.load(negativeFixture.project);
  for (let i = 0; i < 30; i++) negativePhysics.step(-1, 0);
  expect(
    axisVelocity(
      negativePhysics.world.bodies.getAll()[1],
      negativeFixture.axis,
    ),
  ).toBeLessThan(0);
  negativePhysics.dispose();

  const disabledFixture = motorFixture({ enabled: false }),
    disabledPhysics = new RapierPhysics();
  await disabledPhysics.load(disabledFixture.project);
  for (let i = 0; i < 30; i++) disabledPhysics.step(1, 0);
  expect(
    Math.abs(
      axisVelocity(
        disabledPhysics.world.bodies.getAll()[1],
        disabledFixture.axis,
      ),
    ),
  ).toBeLessThan(0.01);
  disabledPhysics.dispose();
});

it("最大トルクと目標角速度が独立し、負荷で加速が低下する", async () => {
  const weakFixture = motorFixture({ maxTorque: 50 }),
    strongFixture = motorFixture({ maxTorque: 200 }),
    weakPhysics = new RapierPhysics(),
    strongPhysics = new RapierPhysics();
  await weakPhysics.load(weakFixture.project);
  await strongPhysics.load(strongFixture.project);
  for (let i = 0; i < 10; i++) {
    weakPhysics.step(1, 0);
    strongPhysics.step(1, 0);
  }
  const weakVelocity = relativeAxisVelocity(
      weakPhysics.world.bodies.getAll(),
      weakFixture.axis,
    ),
    strongVelocity = relativeAxisVelocity(
      strongPhysics.world.bodies.getAll(),
      strongFixture.axis,
    );
  expect(strongVelocity).toBeGreaterThan(weakVelocity);
  weakPhysics.dispose();
  strongPhysics.dispose();

  const lightFixture = motorFixture({ maxTorque: 200 }),
    heavyFixture = motorFixture({
      maxTorque: 200,
      extraBlocks: 8,
      extraBlockMass: 1000,
    }),
    lightPhysics = new RapierPhysics(),
    heavyPhysics = new RapierPhysics();
  await lightPhysics.load(lightFixture.project);
  await heavyPhysics.load(heavyFixture.project);
  for (let i = 0; i < 60; i++) {
    lightPhysics.step(1, 0);
    heavyPhysics.step(1, 0);
  }
  expect(
    relativeAxisVelocity(lightPhysics.world.bodies.getAll(), lightFixture.axis),
  ).toBeGreaterThan(
    relativeAxisVelocity(heavyPhysics.world.bodies.getAll(), heavyFixture.axis),
  );
  lightPhysics.dispose();
  heavyPhysics.dispose();

  const slowFixture = motorFixture({
      maxTorque: 200,
      targetAngularVelocity: 5,
    }),
    fastFixture = motorFixture({
      maxTorque: 200,
      targetAngularVelocity: 15,
    }),
    slowPhysics = new RapierPhysics(),
    fastPhysics = new RapierPhysics();
  await slowPhysics.load(slowFixture.project);
  await fastPhysics.load(fastFixture.project);
  for (let i = 0; i < 120; i++) {
    slowPhysics.step(1, 0);
    fastPhysics.step(1, 0);
  }
  expect(
    relativeAxisVelocity(fastPhysics.world.bodies.getAll(), fastFixture.axis),
  ).toBeGreaterThan(
    relativeAxisVelocity(slowPhysics.world.bodies.getAll(), slowFixture.axis),
  );
  slowPhysics.dispose();
  fastPhysics.dispose();
});

it("未接続Motorは関節やMachine全体へTorqueを加えない", async () => {
  const fixture = motorFixture({
      withMotor: false,
      unconnectedMotor: true,
    }),
    physics = new RapierPhysics();
  await physics.load(fixture.project);
  expect(physics.stats.joints).toBe(1);
  for (let i = 0; i < 30; i++) physics.step(1, 0);
  const standalone = physics.world.bodies.getAll()[2].angvel();
  expect([standalone.x, standalone.y, standalone.z]).toEqual([0, 0, 0]);
  physics.dispose();
});
