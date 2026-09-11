import { describe, it, expect } from "vitest";
import {
  emptyProject,
  parseProject,
} from "../../packages/project-schema/src/index";
import { CommandBus } from "../../packages/command-system/src/index";
import {
  carTemplate,
  createPart,
} from "../../packages/machine-system/src/index";
import {
  DEFAULT_MOTOR_MAX_TORQUE,
  DEFAULT_MOTOR_TARGET_ANGULAR_VELOCITY,
  PANEL_SIDE,
  panelMass,
} from "../../packages/project-schema/src/index";
describe("モデルとコマンド", () => {
  it("履歴とシリアライズ、詳細値を保持する", () => {
    const bus = new CommandBus(emptyProject()),
      m = carTemplate();
    bus.execute({ type: "machine.create", machine: m });
    const p = m.parts[1];
    bus.execute({
      type: "part.update",
      machineId: m.id,
      partId: p.id,
      patch: {
        actuator: { ...p.actuator, motorTorque: 823 },
        physics: { ...p.physics, friction: 1.16 },
      },
    });
    const after = bus.project;
    bus.undo();
    expect(bus.project.machines[0].parts[1].actuator.motorTorque).toBe(180);
    bus.redo();
    expect(bus.project).toEqual(after);
    expect(parseProject(JSON.parse(JSON.stringify(after)))).toEqual(after);
    expect(JSON.parse(JSON.stringify(bus.history))).toHaveLength(2);
  });
  it("不正な接続を拒否し原子的に戻す", () => {
    const bus = new CommandBus(emptyProject()),
      m = carTemplate();
    bus.execute({ type: "machine.create", machine: m });
    const before = bus.project;
    expect(() =>
      bus.execute({
        type: "part.add",
        machineId: m.id,
        part: createPart("Wheel"),
      }),
    ).toThrow();
    expect(bus.project).toEqual(before);
  });
  it("旧スキーマと壊れた入力", () => {
    const p = emptyProject();
    expect(parseProject({ ...p, schemaVersion: 0 }).schemaVersion).toBe(4);
    expect(() => parseProject({ ...p, schemaVersion: 9 })).toThrow();
    expect(() => parseProject({})).toThrow();
  });

  it("v2のWingを正方形Panelへ移行し接続を保持する", () => {
    const project = emptyProject(),
      machine = carTemplate(),
      legacy = JSON.parse(JSON.stringify(machine.parts[0])) as Record<
        string,
        unknown
      >;
    legacy.definitionId = "Wing";
    (legacy.transform as Record<string, unknown>).scale = [2, 3, 4];
    (legacy.physics as Record<string, unknown>).size = [4, 0.1, 0.8];
    machine.parts[0] = legacy as (typeof machine.parts)[0];
    project.machines.push(machine);
    const migrated = parseProject({ ...project, schemaVersion: 2 });
    const panel = migrated.machines[0].parts[0];
    expect(migrated.schemaVersion).toBe(4);
    expect(panel.definitionId).toBe("Panel");
    expect(panel.physics.size[0]).toBe(PANEL_SIDE);
    expect(panel.physics.size[2]).toBe(PANEL_SIDE);
    expect(panel.physics.size[1]).toBeCloseTo(0.3);
    expect(panel.physics.mass).toBeCloseTo(panelMass(0.3));
    expect(panel.transform.scale).toEqual([1, 1, 1]);
  });
  it("v3 Motorの旧速度式をv4の目標角速度へ移行する", () => {
    const project = emptyProject(),
      machine = carTemplate(),
      motor = createPart("Motor");
    motor.actuator.motorTorque = 200;
    machine.parts.push(motor);
    project.machines.push(machine);
    const legacy = JSON.parse(JSON.stringify(project)) as Record<
      string,
      unknown
    >;
    legacy.schemaVersion = 3;
    const legacyMachine = (legacy.machines as Record<string, unknown>[])[0];
    const legacyParts = legacyMachine.parts as Record<string, unknown>[];
    const legacyMotor = legacyParts.find(
      (part) => part.definitionId === "Motor",
    )!;
    delete (legacyMotor.actuator as Record<string, unknown>)
      .targetAngularVelocity;
    const migrated = parseProject(legacy);
    const migratedMotor = migrated.machines[0].parts.find(
      (part) => part.definitionId === "Motor",
    )!;
    expect(migrated.schemaVersion).toBe(4);
    expect(migratedMotor.actuator.motorTorque).toBe(200);
    expect(migratedMotor.actuator.targetAngularVelocity).toBe(10);
  });
  it("新規Motorは最大Torqueと目標角速度を別々に初期化する", () => {
    const motor = createPart("Motor");
    expect(motor.actuator.motorTorque).toBe(DEFAULT_MOTOR_MAX_TORQUE);
    expect(motor.actuator.targetAngularVelocity).toBe(
      DEFAULT_MOTOR_TARGET_ANGULAR_VELOCITY,
    );
  });

  it("Panelの厚さ変更は幅・長さと質量を固定する", () => {
    const bus = new CommandBus(emptyProject()),
      machine = carTemplate(),
      panel = machine.parts[0];
    bus.execute({ type: "machine.create", machine });
    bus.execute({
      type: "part.update",
      machineId: machine.id,
      partId: panel.id,
      patch: {
        transform: { ...panel.transform, scale: [4, 2, 5] },
        physics: { ...panel.physics, size: [4, 0.24, 5] },
      },
    });
    const updated = bus.project.machines[0].parts[0];
    expect(updated.physics.size).toEqual([PANEL_SIDE, 0.24, PANEL_SIDE]);
    expect(updated.transform.scale).toEqual([1, 1, 1]);
    expect(updated.physics.mass).toBeCloseTo(panelMass(0.24));
  });
});
it("親部品の移動・回転で接続位置を保持する", () => {
  const m = carTemplate(),
    bus = new CommandBus(emptyProject());
  bus.execute({ type: "machine.create", machine: m });
  bus.execute({
    type: "part.move",
    machineId: m.id,
    partId: m.parts[0].id,
    value: [3, 0.85, 0],
  });
  expect(bus.project.machines[0].parts[1].transform.position[0]).toBeCloseTo(2);
  bus.execute({
    type: "part.rotate",
    machineId: m.id,
    partId: m.parts[0].id,
    value: [0, Math.PI, 0],
  });
  expect(bus.project.machines[0].parts[1].transform.position[0]).toBeCloseTo(4);
  bus.undo();
  expect(bus.project.machines[0].parts[1].transform.position[0]).toBeCloseTo(2);
});
it("シリアライズしたコマンド履歴を再生できる", () => {
  const project = emptyProject(),
    bus = new CommandBus(project),
    machine = carTemplate();
  const commands = machine.parts;
  machine.parts = [];
  machine.connections = [];
  bus.execute({ type: "machine.create", machine });
  for (const part of commands)
    bus.execute({ type: "part.add", machineId: machine.id, part });
  const replay = new CommandBus(project);
  for (const batch of JSON.parse(JSON.stringify(bus.history)))
    replay.batch(batch);
  expect(replay.project).toEqual(bus.project);
});
