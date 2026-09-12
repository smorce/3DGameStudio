import { describe, expect, it } from "vitest";
import { aggregateControlChannels } from "../../packages/engine-core/src/index";
import {
  emptyProject,
  parseProject,
} from "../../packages/project-schema/src/index";
import {
  planeTemplate,
  createPart,
} from "../../packages/machine-system/src/index";
import { quaternion, rotate } from "../../packages/machine-system/src/math";

describe("汎用Control Channel", () => {
  it("同一Channelを加算し、範囲をClampする", () => {
    const values = aggregateControlChannels(
      [
        { channel: "pitch", key: "ArrowUp", value: 1 },
        { channel: "pitch", key: "KeyP", value: 1 },
        { channel: "turn", key: "ArrowLeft", value: -1 },
      ],
      new Set(["ArrowUp", "KeyP", "ArrowLeft"]),
    );
    expect(values).toEqual({ pitch: 1, turn: -1 });
  });

  it("同じキーを複数Channelへ同時に配信する", () => {
    expect(
      aggregateControlChannels(
        [
          { channel: "turn", key: "ArrowLeft", value: -1 },
          { channel: "steering", key: "ArrowLeft", value: -1 },
        ],
        new Set(["ArrowLeft"]),
      ),
    ).toEqual({ turn: -1, steering: -1 });
  });

  it("v4のaction bindingを操作互換のchannelへ移行する", () => {
    const project = emptyProject();
    const legacy = JSON.parse(JSON.stringify(project)) as Record<
      string,
      unknown
    >;
    legacy.schemaVersion = 4;
    const machines = legacy.machines as Record<string, unknown>[];
    machines.push({
      id: "legacy-machine",
      name: "Legacy",
      parts: [],
      connections: [],
      controlBindings: [
        { action: "forward", key: "KeyW" },
        { action: "backward", key: "KeyS" },
        { action: "left", key: "KeyA" },
        { action: "right", key: "KeyD" },
      ],
    });
    const migrated = parseProject(legacy),
      bindings = migrated.machines[0].controlBindings;
    expect(migrated.schemaVersion).toBe(5);
    expect(bindings).toContainEqual({
      channel: "throttle",
      key: "KeyW",
      value: 1,
    });
    expect(bindings).toContainEqual({
      channel: "steering",
      key: "ArrowLeft",
      value: 1,
    });
    expect(bindings).toContainEqual({
      channel: "brake",
      key: "Space",
      value: 1,
    });
  });
});

describe("Starter Planeの工作機構", () => {
  it("PlaneはMotor Partを使わず、Hinge自身をPosition制御へ割り当てる", () => {
    expect(createPart("Motor").actuator.motorMode).toBe("velocity");
    expect(createPart("Hinge").actuator.motorMode).toBe("velocity");
    expect(createPart("Hinge").physics.size[1]).toBeLessThanOrEqual(0.1);
    expect(createPart("Hinge").physics.size[2]).toBeLessThanOrEqual(0.1);
    const machine = planeTemplate(),
      motors = machine.parts.filter((part) => part.definitionId === "Motor"),
      hinges = machine.parts.filter((part) => part.definitionId === "Hinge"),
      positionHinges = hinges.filter(
        (part) => part.actuator.motorMode === "position",
      );
    expect(motors).toHaveLength(0);
    expect(hinges).toHaveLength(5);
    expect(positionHinges).toHaveLength(5);
    expect(positionHinges.map((part) => part.actuator.controlChannel)).toEqual(
      expect.arrayContaining(["pitch", "turn"]),
    );
    expect(
      machine.connections
        .filter((connection) => connection.type === "revolute")
        .filter((connection) => connection.limits),
    ).toHaveLength(5);
  });

  it("Hingeは薄い蝶番として親Panelの端面上に回転軸を置く", () => {
    const machine = planeTemplate(),
      hinges = machine.parts.filter((part) => part.definitionId === "Hinge");
    for (const hinge of hinges) {
      expect(hinge.physics.size[2]).toBeLessThanOrEqual(0.1);
      const revolute = machine.connections.find(
        (connection) =>
          connection.type === "revolute" && connection.b === hinge.id,
      )!;
      const parent = machine.parts.find((part) => part.id === revolute.a)!;
      const connector = parent.connectors.find(
        (item) => item.id === revolute.connectorA,
      )!;
      // 回転軸(=Hinge中心)が親Panelの接続端面上へ一致していること。
      const edgePoint = rotate(
        connector.position,
        quaternion(parent.transform.rotation),
      ).map((value, index) => value + parent.transform.position[index]);
      const edgeDistance = Math.hypot(
        ...hinge.transform.position.map(
          (value, index) => value - edgePoint[index],
        ),
      );
      expect(edgeDistance).toBeLessThan(0.001);
    }
  });
});
