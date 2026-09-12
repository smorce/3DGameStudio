import { it, expect } from "vitest";
import { emptyProject } from "../../packages/project-schema/src/index";
import {
  attachPart,
  boatTemplate,
  commitAttachment,
  createMachine,
  createPart,
  findAttachmentCandidates,
  carTemplate,
  planeTemplate,
} from "../../packages/machine-system/src/index";
import { RapierPhysics } from "../../packages/physics-rapier/src/index";
import { CommandBus } from "../../packages/command-system/src/index";
import { saveProject, loadProject } from "../../packages/storage/src/index";
import { euler, quaternion } from "../../packages/machine-system/src/math";
import { starterPlaneWorldPatch } from "../../packages/world-system/src/index";
import {
  findStableForwardTakeoff,
  type MachineTelemetrySample,
} from "../../packages/runtime-telemetry/src/index";

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
  // 棒状Hingeでは負荷側がほぼ止まっても根側が反転するため、
  // 相対角速度は長時間後に収束する。加速差が見える早い時点で比較する。
  for (let i = 0; i < 15; i++) {
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

it("TelemetryはPhysics Step後のRigidBody実値と共通速度を公開する", async () => {
  const project = emptyProject(),
    machine = planeTemplate();
  project.machines.push(machine);
  const physics = new RapierPhysics();
  await physics.load(project);
  physics.telemetry.start();
  for (let i = 0; i < 30; i++) physics.step(1, 0);
  const sample = physics.telemetry.current(machine.id)!,
    body = physics.world.bodies.getAll()[0],
    velocity = body.linvel();
  expect(sample.step).toBe(30);
  expect(sample.timeSeconds).toBeCloseTo(0.5);
  expect(sample.linearVelocityMps).toEqual([
    velocity.x,
    velocity.y,
    velocity.z,
  ]);
  expect(sample.worldSpeedMps).toBeCloseTo(
    Math.hypot(velocity.x, velocity.y, velocity.z),
  );
  expect(sample.massKg).toBeGreaterThan(0);
  expect(sample.totalThrusterForceN).toBeGreaterThan(0);
  expect(sample.terrainAvailable).toBe(true);
  expect(sample.terrainHeightM).toBe(0);
  expect(sample.heightAboveTerrainM).toBeCloseTo(sample.position[1]);
  expect(sample.aerodynamicPitchMomentByRoleNm["main-wing"]).toBeDefined();
  expect(sample.totalPitchMomentNm).toBeCloseTo(
    sample.aerodynamicPitchMomentNm + sample.thrusterPitchMomentNm,
  );
  const translation = body.translation();
  const centerOfMass = body.worldCom();
  expect(
    Math.hypot(
      centerOfMass.x - translation.x,
      centerOfMass.y - translation.y,
      centerOfMass.z - translation.z,
    ),
  ).toBeGreaterThan(0);
  expect(sample.contactStatusAvailable).toBe(true);
  expect(sample.wheels).toHaveLength(3);
  expect(sample.rawLiftVerticalN).toBe(sample.liftVerticalN);
  expect(sample.appliedAerodynamicForceWorldN).toHaveLength(3);
  expect(sample.aerodynamicByRole["main-wing"]).toBeDefined();
  physics.dispose();
});

async function simulatePlane(
  configure?: (machine: ReturnType<typeof planeTemplate>) => void,
  steps = 600,
  throttle = 1,
  terrainSize = 1024,
) {
  const project = emptyProject(),
    machine = planeTemplate();
  const planeWorld = starterPlaneWorldPatch(project.world);
  planeWorld.terrain.size = terrainSize;
  project.world.terrain = planeWorld.terrain;
  project.world.entities = planeWorld.entities;
  configure?.(machine);
  project.machines.push(machine);
  const physics = new RapierPhysics();
  await physics.load(project);
  physics.telemetry.start();
  const start = physics.poses().get(machine.id)!.position;
  for (let i = 0; i < steps; i++) {
    physics.step(throttle, 0);
  }
  const samples = physics.telemetry
    .samples()
    .filter((sample) => sample.machineId === machine.id);
  const first = samples[0],
    last = samples.at(-1)!,
    stableTakeoff = findStableForwardTakeoff(samples),
    stableSamples =
      stableTakeoff === undefined
        ? []
        : samples.slice(
            stableTakeoff.liftoffIndex,
            stableTakeoff.liftoffIndex + stableTakeoff.windowSteps,
          );
  physics.dispose();
  return {
    samples,
    heightGain:
      Math.max(...samples.map((sample) => sample.position[1])) -
      Math.min(...samples.map((sample) => sample.position[1])),
    forwardDistance: last.position[2] - start[2],
    maxForwardSpeed: Math.max(
      ...samples.map((sample) => sample.forwardSpeedMps),
    ),
    maxWorldSpeed: Math.max(...samples.map((sample) => sample.worldSpeedMps)),
    maxHeight: Math.max(...samples.map((sample) => sample.position[1])),
    minHeight: Math.min(...samples.map((sample) => sample.position[1])),
    maxPitch: Math.max(...samples.map((sample) => Math.abs(sample.pitchRad))),
    maxStablePitch:
      stableSamples.length > 0
        ? Math.max(...stableSamples.map((sample) => Math.abs(sample.pitchRad)))
        : 0,
    maxLiftToWeight: Math.max(
      ...samples.map((sample) => sample.liftToWeightRatio),
    ),
    final: last,
    first: first as MachineTelemetrySample,
    stableSampleCount: stableTakeoff?.windowSteps ?? 0,
    stableTakeoffStep: stableTakeoff?.liftoffStep ?? -1,
  };
}

async function simulatePlaneSteering(steering: number) {
  const project = emptyProject(),
    machine = planeTemplate();
  project.machines.push(machine);
  const physics = new RapierPhysics();
  await physics.load(project);
  const start = physics.poses().get(machine.id)!;
  for (let i = 0; i < 180; i++) physics.step(1, steering);
  const end = physics.poses().get(machine.id)!,
    startYaw = euler(start.rotation)[1],
    endYaw = euler(end.rotation)[1];
  physics.dispose();
  return {
    lateralDistance: end.position[0] - start.position[0],
    forwardDistance: end.position[2] - start.position[2],
    yaw: endYaw - startYaw,
  };
}

it("Starter PlaneはW+↑(pitch)で安定離陸する", async () => {
  const project = emptyProject(),
    machine = planeTemplate();
  const planeWorld = starterPlaneWorldPatch(project.world);
  planeWorld.terrain.size = 1024;
  project.world.terrain = planeWorld.terrain;
  project.world.entities = planeWorld.entities;
  project.machines.push(machine);
  const physics = new RapierPhysics();
  await physics.load(project);
  physics.telemetry.start();
  for (let i = 0; i < 240; i++) physics.step({ throttle: 1 });
  for (let i = 0; i < 660; i++) physics.step({ throttle: 1, pitch: 1 });
  const samples = physics.telemetry
      .samples()
      .filter((sample) => sample.machineId === machine.id),
    takeoff = findStableForwardTakeoff(samples);
  physics.dispose();
  expect(takeoff).toBeDefined();
  // 接地順: 3輪 → Noseのみ離れる → Main 2輪 → 0輪
  const states = samples
    .map((sample) =>
      sample.wheels.map((wheel) => (wheel.inContact ? "1" : "0")).join(""),
    )
    .filter((state, index, all) => index === 0 || state !== all[index - 1]);
  const threeWheelIndex = states.indexOf("111"),
    noseOffIndex = states.indexOf("011"),
    airborneIndex = states.findIndex(
      (state, index) => index > noseOffIndex && state === "000",
    );
  expect(threeWheelIndex).toBeGreaterThanOrEqual(0);
  expect(noseOffIndex).toBeGreaterThan(threeWheelIndex);
  expect(airborneIndex).toBeGreaterThan(noseOffIndex);
});

it("Starter PlaneはNeutralのWだけでは自動離陸しない", async () => {
  const result = await simulatePlane(undefined, 240);
  expect(result.stableTakeoffStep).toBe(-1);
  expect(result.forwardDistance).toBeGreaterThan(20);
  expect(result.maxWorldSpeed).toBeGreaterThan(10);
  expect(result.maxPitch).toBeLessThan(0.5);
});

it("Terrain端から落下しても安定離陸と判定しない", async () => {
  const result = await simulatePlane(undefined, 600, 1, 32),
    outside = result.samples.find((sample) => !sample.terrainAvailable),
    outsideAirborne = result.samples.find(
      (sample) => !sample.terrainAvailable && sample.groundedWheelCount === 0,
    );
  expect(outside).toBeDefined();
  expect(outsideAirborne).toBeDefined();
  expect(findStableForwardTakeoff(result.samples)).toBeUndefined();
});

it("一瞬のHopや降下を安定離陸と判定しない", async () => {
  const beforeFix = await simulatePlane((machine) => {
    for (const part of machine.parts)
      if (
        part.definitionId === "Panel" &&
        part.transform.position[2] === 0 &&
        part.transform.position[0] !== 0
      )
        part.transform.rotation = [(18 * Math.PI) / 180, 0, 0];
  });
  expect(Number.isFinite(beforeFix.maxHeight)).toBe(true);
  expect(beforeFix.stableTakeoffStep).toBe(-1);
  expect(beforeFix.final.terrainAvailable).toBe(true);
});

it("主翼の迎角を0度にすると離陸性能が下がる", async () => {
  const standard = await simulatePlane(),
    zeroAngle = await simulatePlane((machine) => {
      for (const part of machine.parts)
        if (
          part.definitionId === "Panel" &&
          part.transform.position[2] === 0 &&
          part.transform.position[0] !== 0
        )
          part.transform.rotation = [0, 0, 0];
    });
  expect(standard.maxWorldSpeed).toBeGreaterThan(0);
  expect(zeroAngle.stableTakeoffStep).toBe(-1);
});

it("翼面積またはThruster推力を減らすと離陸性能が下がる", async () => {
  const standard = await simulatePlane(),
    reducedWing = await simulatePlane((machine) => {
      const removed = new Set(
        machine.parts
          .filter(
            (part) =>
              part.definitionId === "Panel" &&
              part.transform.position[2] === 0 &&
              Math.abs(part.transform.position[0]) >= 3,
          )
          .map((part) => part.id),
      );
      machine.parts = machine.parts.filter((part) => !removed.has(part.id));
      machine.connections = machine.connections.filter(
        (connection) =>
          !removed.has(connection.a) && !removed.has(connection.b),
      );
    }),
    weakThruster = await simulatePlane((machine) => {
      for (const part of machine.parts)
        if (part.definitionId === "Thruster") part.actuator.motorTorque = 400;
    });
  expect(reducedWing.final).toBeDefined();
  expect(weakThruster.maxWorldSpeed).toBeLessThan(standard.maxWorldSpeed);
});

it("正Throttleは+Zへ推力を出し、負Throttleは前進離陸にならない", async () => {
  const forward = await simulatePlane(undefined, 60, 1),
    backward = await simulatePlane(undefined, 600, -1),
    forwardSample = forward.samples.at(-1)!,
    backwardSample = backward.samples.at(-1)!,
    backwardInitialSample = backward.samples[0];
  expect(forwardSample.forwardSpeedMps).toBeGreaterThan(0);
  expect(forwardSample.thrusterForceWorldN[2]).toBeGreaterThan(0);
  expect(backwardSample.forwardSpeedMps).toBeLessThan(0);
  expect(backwardInitialSample.thrusterForceWorldN[2]).toBeLessThan(0);
  expect(backward.stableTakeoffStep).toBe(-1);
  expect(findStableForwardTakeoff(backward.samples)).toBeUndefined();
});

async function createSettledBoat(settleSteps = 600) {
  const project = emptyProject(),
    machine = boatTemplate();
  project.world.water = { enabled: true, height: 1 };
  project.machines.push(machine);
  const physics = new RapierPhysics();
  await physics.load(project);
  for (let i = 0; i < settleSteps; i++) physics.step(0, 0);
  return { machine, physics };
}

async function inspectSettledBoat() {
  const { machine, physics } = await createSettledBoat();
  let minUp = 1;
  for (let i = 0; i < 60; i++) {
    physics.step(0, 0);
    const up = physics.poses().get(machine.id)!.rotation;
    minUp = Math.min(minUp, 1 - 2 * (up[0] * up[0] + up[2] * up[2]));
  }
  const poses = physics.poses(),
    deck = machine.parts.find(
      (part) => part.definitionId === "Panel" && part.metadata.buoyancy !== 1,
    )!,
    deckY = poses.get(deck.id)!.position[1] + deck.physics.size[1] / 2,
    boatPose = poses.get(machine.id)!;
  physics.dispose();
  return {
    minUp,
    deckY,
    position: boatPose.position,
    rotation: boatPose.rotation,
  };
}

async function simulateBoatSteering(steering: number) {
  const { machine, physics } = await createSettledBoat();
  const start = physics.poses().get(machine.id)!;
  for (let i = 0; i < 180; i++) physics.step(1, steering);
  const end = physics.poses().get(machine.id)!,
    startYaw = euler(start.rotation)[1],
    endYaw = euler(end.rotation)[1];
  physics.dispose();
  return {
    lateralDistance: end.position[0] - start.position[0],
    forwardDistance: end.position[2] - start.position[2],
    yaw: endYaw - startYaw,
  };
}

it("Starter Boatは排水体積で浮上しDeckを水面上に保つ", async () => {
  const result = await inspectSettledBoat();
  expect(result.minUp).toBeGreaterThan(0.8);
  expect(result.deckY).toBeGreaterThan(1.05);
  expect(result.position.every(Number.isFinite)).toBe(true);
  expect(result.rotation.every(Number.isFinite)).toBe(true);
});

it("Starter Boatはsteering=0で前進し、不要なYawを発生させない", async () => {
  const result = await simulateBoatSteering(0);
  expect(result.forwardDistance).toBeGreaterThan(5);
  expect(Math.abs(result.lateralDistance)).toBeLessThan(0.5);
  expect(Math.abs(result.yaw)).toBeLessThan(0.1);
});

it("Planeの地上Steeringは有限な応答を維持する", async () => {
  const straight = await simulatePlaneSteering(0),
    left = await simulatePlaneSteering(0.7),
    right = await simulatePlaneSteering(-0.7);
  expect(
    [straight, left, right].every((result) =>
      Object.values(result).every(Number.isFinite),
    ),
  ).toBe(true);
  expect(Math.abs(straight.lateralDistance)).toBeLessThan(20);
});

it("Boatは差動推力で左右へ旋回し、左右入力が鏡像になる", async () => {
  const left = await simulateBoatSteering(0.7),
    right = await simulateBoatSteering(-0.7);
  expect(left.forwardDistance).toBeGreaterThan(5);
  expect(right.forwardDistance).toBeGreaterThan(5);
  expect(left.lateralDistance).toBeLessThan(-1);
  expect(right.lateralDistance).toBeGreaterThan(1);
  expect(left.yaw).toBeLessThan(-0.1);
  expect(right.yaw).toBeGreaterThan(0.1);
  expect(Math.abs(left.lateralDistance + right.lateralDistance)).toBeLessThan(
    0.5,
  );
});

it("RollさせたBoatは浮力の復元Momentで水平へ戻る", async () => {
  const { machine, physics } = await createSettledBoat(0),
    body = physics.world.bodies.getAll()[0],
    initialRotation = quaternion([0, 0, (8 * Math.PI) / 180]);
  body.setRotation(
    {
      x: initialRotation[0],
      y: initialRotation[1],
      z: initialRotation[2],
      w: initialRotation[3],
    },
    true,
  );
  const startRoll = Math.abs(
    euler(physics.poses().get(machine.id)!.rotation)[2],
  );
  for (let i = 0; i < 360; i++) physics.step(0, 0);
  const pose = physics.poses().get(machine.id)!,
    endRoll = Math.abs(euler(pose.rotation)[2]);
  physics.dispose();
  expect(endRoll).toBeLessThan(startRoll);
  expect(pose.position.every(Number.isFinite)).toBe(true);
});
