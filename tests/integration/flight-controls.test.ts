import { expect, it } from "vitest";
import {
  attachPart,
  commitAttachment,
  createMachine,
  createPart,
  findAttachmentCandidates,
  planeTemplate,
} from "../../packages/machine-system/src/index";
import { emptyProject } from "../../packages/project-schema/src/index";
import { RapierPhysics } from "../../packages/physics-rapier/src/index";

function positionMotorFixture(
  limits = { minAngleRad: -0.2, maxAngleRad: 0.2 },
) {
  const project = emptyProject();
  project.settings.gravity = [0, 0, 0];
  const machine = createMachine("Position Motor Test"),
    root = createPart("Panel", [0, 1, 0]);
  attachPart(machine, root);
  const hinge = createPart("Hinge");
  attachPart(machine, hinge);
  const panel = createPart("Panel"),
    panelCandidate = findAttachmentCandidates(machine, "Panel").find(
      (candidate) =>
        candidate.parentPartId === hinge.id &&
        candidate.parentConnectorId === "hinge-output",
    );
  if (!panelCandidate)
    throw new Error("Position motor panel fixture unavailable");
  commitAttachment(machine, panel, panelCandidate);
  const revolute = machine.connections.find(
    (connection) => connection.type === "revolute",
  )!;
  const motor = createPart("Motor", [...hinge.transform.position]);
  motor.actuator.motorMode = "position";
  motor.actuator.controlChannel = "test";
  motor.actuator.positionStiffness = 120;
  motor.actuator.positionDamping = 20;
  machine.parts.push(motor);
  machine.connections.push({
    id: "position-motor-mount",
    a: hinge.id,
    b: motor.id,
    connectorA: "hinge-output",
    connectorB: "mount",
    type: "fixed",
    axis: [...revolute.axis],
    damping: 0.2,
  });
  revolute.limits = limits;
  project.machines.push(machine);
  return { project, machine, motor, panel };
}

function selfDrivenHingeFixture(
  limits = { minAngleRad: -0.2, maxAngleRad: 0.2 },
) {
  const project = emptyProject();
  project.settings.gravity = [0, 0, 0];
  const machine = createMachine("Self Driven Hinge Test"),
    root = createPart("Panel", [0, 1, 0]);
  attachPart(machine, root);
  const hinge = createPart("Hinge");
  hinge.actuator.motorMode = "position";
  hinge.actuator.controlChannel = "test";
  hinge.actuator.positionStiffness = 120;
  hinge.actuator.positionDamping = 20;
  attachPart(machine, hinge);
  const panel = createPart("Panel"),
    panelCandidate = findAttachmentCandidates(machine, "Panel").find(
      (candidate) =>
        candidate.parentPartId === hinge.id &&
        candidate.parentConnectorId === "hinge-output",
    );
  if (!panelCandidate)
    throw new Error("Self driven hinge panel fixture unavailable");
  commitAttachment(machine, panel, panelCandidate);
  const revolute = machine.connections.find(
    (connection) => connection.type === "revolute",
  )!;
  revolute.limits = limits;
  project.machines.push(machine);
  return { project, machine, hinge, panel };
}

it("Position制御のHingeはMotor Partなしで自分の関節を駆動する", async () => {
  const fixture = selfDrivenHingeFixture(),
    physics = new RapierPhysics();
  await physics.load(fixture.project);
  physics.telemetry.start();
  for (let i = 0; i < 60; i++) physics.step({ test: 1 });
  const positive = physics.telemetry.current(fixture.machine.id)!,
    positiveMotor = positive.motorByPart![fixture.hinge.id];
  expect(positiveMotor).toBeDefined();
  expect(positiveMotor.controlInput).toBe(1);
  expect(positiveMotor.targetAngleRad).toBeCloseTo(0.2);
  expect(positiveMotor.actualRelativeAngleRad).toBeGreaterThan(0.05);
  for (let i = 0; i < 90; i++) physics.step({});
  const neutral = physics.telemetry.current(fixture.machine.id)!,
    neutralMotor = neutral.motorByPart![fixture.hinge.id];
  expect(neutralMotor.targetAngleRad).toBe(0);
  expect(Math.abs(neutralMotor.actualRelativeAngleRad)).toBeLessThan(0.08);
  physics.dispose();
});

it("Position Motorは正負入力とNeutral復帰を実際のJoint Poseへ反映する", async () => {
  const fixture = positionMotorFixture(),
    physics = new RapierPhysics();
  await physics.load(fixture.project);
  physics.telemetry.start();
  for (let i = 0; i < 60; i++) physics.step({ test: 1 });
  const positive = physics.telemetry.current(fixture.machine.id)!,
    positiveMotor = positive.motorByPart![fixture.motor.id];
  expect(positiveMotor.controlInput).toBe(1);
  expect(positiveMotor.targetAngleRad).toBeCloseTo(0.2);
  expect(positiveMotor.actualRelativeAngleRad).toBeGreaterThan(0.05);
  const positivePose = physics.poses().get(fixture.panel.id)!;
  for (let i = 0; i < 90; i++) physics.step({ test: -1 });
  const negative = physics.telemetry.current(fixture.machine.id)!,
    negativeMotor = negative.motorByPart![fixture.motor.id];
  expect(negativeMotor.controlInput).toBe(-1);
  expect(negativeMotor.targetAngleRad).toBeCloseTo(-0.2);
  expect(negativeMotor.actualRelativeAngleRad).toBeLessThan(-0.05);
  for (let i = 0; i < 90; i++) physics.step({});
  const neutral = physics.telemetry.current(fixture.machine.id)!,
    neutralMotor = neutral.motorByPart![fixture.motor.id],
    neutralPose = physics.poses().get(fixture.panel.id)!;
  expect(neutralMotor.targetAngleRad).toBe(0);
  expect(Math.abs(neutralMotor.actualRelativeAngleRad)).toBeLessThan(0.08);
  expect(neutralPose.rotation).not.toEqual(positivePose.rotation);
  physics.dispose();
});

it("Position MotorはHinge Limitを超える目標を物理的に制限する", async () => {
  const fixture = positionMotorFixture({
      minAngleRad: -0.1,
      maxAngleRad: 0.1,
    }),
    physics = new RapierPhysics();
  await physics.load(fixture.project);
  physics.telemetry.start();
  for (let i = 0; i < 180; i++) physics.step({ test: 1 });
  const motor = physics.telemetry.current(fixture.machine.id)!.motorByPart![
    fixture.motor.id
  ];
  expect(motor.targetAngleRad).toBeCloseTo(0.1);
  expect(motor.actualRelativeAngleRad).toBeLessThan(0.12);
  physics.dispose();
});

it("PlaneはControl Surfaceの実PoseとNose→Mainの接地順をTelemetryへ出す", async () => {
  const project = emptyProject(),
    machine = planeTemplate();
  project.machines.push(machine);
  const physics = new RapierPhysics();
  await physics.load(project);
  physics.telemetry.start();
  const elevator = machine.parts.find(
    (part) => part.metadata.aeroRole === "elevator-left",
  )!;
  const before = physics.poses().get(elevator.id)!;
  for (let i = 0; i < 120; i++) physics.step({});
  for (let i = 0; i < 180; i++) physics.step({ throttle: 1 });
  for (let i = 0; i < 30; i++) physics.step({ throttle: 1, pitch: 1 });
  for (let i = 0; i < 180; i++) physics.step({ throttle: 1 });
  const samples = physics.telemetry.samples(),
    after = physics.poses().get(elevator.id)!,
    states = samples
      .map((sample) =>
        sample.wheels.map((wheel) => (wheel.inContact ? "1" : "0")).join(""),
      )
      .filter((state, index, all) => index === 0 || state !== all[index - 1]);
  const threeWheelIndex = states.indexOf("111"),
    twoWheelIndex = states.indexOf("011"),
    zeroWheelIndex = states.findIndex(
      (state, index) => index > twoWheelIndex && state === "000",
    );
  expect(after.rotation).not.toEqual(before.rotation);
  expect(
    samples.some(
      (sample) =>
        sample.motorByPart &&
        Object.values(sample.motorByPart).some(
          (motor) => Math.abs(motor.controlInput) > 0,
        ),
    ),
  ).toBe(true);
  expect(states).toContain("111");
  expect(twoWheelIndex).toBeGreaterThan(threeWheelIndex);
  expect(zeroWheelIndex).toBeGreaterThan(twoWheelIndex);
  expect(samples.some((sample) => sample.aerodynamicByRole.rudder)).toBe(true);
  physics.dispose();
});
