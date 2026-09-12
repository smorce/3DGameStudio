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
  it("MotorはVelocityを既定にし、PlaneはPosition Motorへ割り当てる", () => {
    expect(createPart("Motor").actuator.motorMode).toBe("velocity");
    const machine = planeTemplate(),
      motors = machine.parts.filter((part) => part.definitionId === "Motor"),
      positionModes = motors.filter(
        (part) => part.actuator.motorMode === "position",
      );
    expect(motors).toHaveLength(5);
    expect(positionModes).toHaveLength(5);
    expect(positionModes.map((part) => part.actuator.controlChannel)).toEqual(
      expect.arrayContaining(["pitch", "turn"]),
    );
    expect(
      machine.connections
        .filter((connection) => connection.type === "revolute")
        .filter((connection) => connection.limits),
    ).toHaveLength(5);
  });
});
