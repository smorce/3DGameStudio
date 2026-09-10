import { expect, test } from "vitest";
import { CommandBus } from "../../packages/command-system/src/index";
import { emptyProject } from "../../packages/project-schema/src/index";
import {
  attachPart,
  createMachine,
  createPart,
  findAttachmentCandidates,
  placementConnectors,
} from "../../packages/machine-system/src/index";
import { quaternion, rotate } from "../../packages/machine-system/src/math";
function setup() {
  const project = emptyProject(),
    machine = createMachine();
  attachPart(machine, createPart("Panel"));
  project.machines.push(machine);
  return { machine, bus: new CommandBus(project) };
}
test("タイヤ候補は純粋計算で、使用済み位置を除外する", () => {
  const { machine } = setup();
  const before = structuredClone(machine);
  expect(findAttachmentCandidates(machine, "Wheel")).toHaveLength(4);
  expect(machine).toEqual(before);
  for (let i = 0; i < 4; i++) {
    attachPart(machine, createPart("Wheel"));
    expect(findAttachmentCandidates(machine, "Wheel")).toHaveLength(3 - i);
  }
});
test("移動・回転しても正方形Panelの候補は固定寸法で計算される", () => {
  const { machine } = setup();
  machine.parts[0].transform = {
    position: [10, 2, -5],
    rotation: [0, Math.PI / 2, 0],
    scale: [2, 3, 4],
  };
  const c = findAttachmentCandidates(machine, "Wheel")[0];
  [11.25, 1.55, -4].forEach((n, i) => expect(c.position[i]).toBeCloseTo(n));
  expect(c.rotation).toEqual(machine.parts[0].transform.rotation);
});
test("取り付けは接続・自動設定とともに一回のUndo/Redoで復元する", () => {
  const { bus, machine } = setup(),
    before = bus.project;
  const candidate = findAttachmentCandidates(machine, "Wheel")[0];
  bus.execute({
    type: "part.attach",
    machineId: machine.id,
    kind: "Wheel",
    partId: "wheel",
    candidateId: candidate.id,
  });
  const after = bus.project,
    added = after.machines[0].parts[1];
  expect(added.transform.position).toEqual(candidate.position);
  expect(added.transform.rotation).toEqual(candidate.rotation);
  expect(added.metadata).toMatchObject({ front: true, drive: false });
  expect(after.machines[0].connections[0].type).toBe("revolute");
  bus.undo();
  expect(bus.project).toEqual(before);
  bus.redo();
  expect(bus.project).toEqual(after);
  expect(() =>
    bus.execute({
      type: "part.attach",
      machineId: machine.id,
      kind: "Wheel",
      partId: "duplicate",
      candidateId: candidate.id,
    }),
  ).toThrow("Attachment candidate");
  expect(bus.project).toEqual(after);
});
test("つけ直し候補計算では元の部品を保持し、確定とUndoでIDと詳細設定を保つ", () => {
  const { machine, bus } = setup();
  bus.execute({
    type: "part.attach",
    machineId: machine.id,
    kind: "Wheel",
    partId: "wheel",
    candidateId: findAttachmentCandidates(machine, "Wheel")[0].id,
  });
  const before = bus.project,
    m = before.machines[0];
  const candidates = findAttachmentCandidates(m, "Wheel", "wheel");
  expect(bus.project).toEqual(before);
  expect(candidates).toHaveLength(4);
  bus.execute({
    type: "part.reattach",
    machineId: m.id,
    partId: "wheel",
    candidateId: candidates[2].id,
  });
  expect(bus.project.machines[0].parts[1]).toMatchObject({
    id: "wheel",
    metadata: { front: false, drive: true },
  });
  expect(bus.project.machines[0].connections).toHaveLength(1);
  bus.undo();
  expect(bus.project).toEqual(before);
});

test("互換性はパーツ別で、古い板も変更せずに候補を計算する", () => {
  const { machine, bus } = setup();
  const panel = machine.parts[0];
  panel.connectors = panel.connectors
    .filter((c) => /^[0-3]$/.test(c.id))
    .map(({ id, position, axis }) => ({ id, position, axis }));
  const before = structuredClone(machine);
  const wheels = findAttachmentCandidates(machine, "Wheel");
  const jets = findAttachmentCandidates(machine, "Thruster");
  expect(wheels).toHaveLength(4);
  expect(jets).toHaveLength(2);
  expect(
    jets.every(
      (c) => !wheels.some((w) => w.parentConnectorId === c.parentConnectorId),
    ),
  ).toBe(true);
  expect(machine).toEqual(before);
  const p = bus.project;
  p.machines[0] = machine;
  bus.load(p);
  bus.execute({
    type: "part.attach",
    machineId: machine.id,
    partId: "jet",
    kind: "Thruster",
    candidateId: jets[0].id,
  });
  expect(
    findAttachmentCandidates(bus.project.machines[0], "Thruster"),
  ).toHaveLength(1);
  expect(
    findAttachmentCandidates(bus.project.machines[0], "Wheel"),
  ).toHaveLength(4);
  bus.undo();
  expect(bus.project.machines[0]).toEqual(before);
});

test.each([
  "Panel",
  "Block",
  "Motor",
  "Thruster",
  "Steering",
  "Hinge",
] as const)("%sは候補と一致する姿勢と有効な接続で保存できる", (kind) => {
  const { machine, bus } = setup();
  const candidate = findAttachmentCandidates(machine, kind)[0];
  expect(candidate).toBeDefined();
  bus.execute({
    type: "part.attach",
    machineId: machine.id,
    partId: "added",
    kind,
    candidateId: candidate.id,
  });
  const m = bus.project.machines[0],
    part = m.parts[1];
  expect(part.transform.position).toEqual(candidate.position);
  expect(part.transform.rotation).toEqual(candidate.rotation);
  expect(m.connections[0].type).toBe(kind === "Hinge" ? "revolute" : "fixed");
  expect(
    part.connectors.some((c) => c.id === m.connections[0].connectorB),
  ).toBe(true);
});

test("Hingeは固定側入力と回転側出力を分け、出力側の部品を回転させる", () => {
  const { machine, bus } = setup();
  const hinge = createPart("Hinge");
  const connectors = placementConnectors(hinge);
  expect(connectors.map((c) => c.id)).toEqual(
    expect.arrayContaining(["hinge-input", "hinge-output"]),
  );
  expect(connectors.filter((c) => c.id.startsWith("jet-"))).toHaveLength(0);

  const hingeCandidate = findAttachmentCandidates(machine, "Hinge")[0];
  expect(hingeCandidate.childConnectorId).toBe("hinge-input");
  bus.execute({
    type: "part.attach",
    machineId: machine.id,
    kind: "Hinge",
    partId: "hinge",
    candidateId: hingeCandidate.id,
  });

  const thrusterCandidate = findAttachmentCandidates(
    bus.project.machines[0],
    "Thruster",
  ).find((candidate) => candidate.parentPartId === "hinge");
  expect(thrusterCandidate?.parentConnectorId).toBe("hinge-output");
  bus.execute({
    type: "part.attach",
    machineId: machine.id,
    kind: "Thruster",
    partId: "thruster",
    candidateId: thrusterCandidate!.id,
  });
  const before = bus.project.machines[0].parts.find(
    (part) => part.id === "thruster",
  )!.transform.position;

  bus.execute({
    type: "part.turn",
    machineId: machine.id,
    partId: "hinge",
    steps: 1,
  });
  const after = bus.project.machines[0].parts.find(
    (part) => part.id === "thruster",
  )!.transform.position;
  expect(after).not.toEqual(before);
  expect(
    bus.project.machines[0].connections.find(
      (connection) => connection.b === "thruster",
    )?.connectorA,
  ).toBe("hinge-output");
});

test("固定接続したPanelのTiltはAttachment Pointを維持する", () => {
  const { machine, bus } = setup();
  const candidate = findAttachmentCandidates(machine, "Panel")[0];
  bus.execute({
    type: "part.attach",
    machineId: machine.id,
    partId: "panel-child",
    kind: "Panel",
    candidateId: candidate.id,
  });
  const before = bus.project.machines[0],
    connection = before.connections[0],
    point = (part: (typeof before.parts)[number], connectorId: string) => {
      const connector = placementConnectors(part).find(
        (item) => item.id === connectorId,
      )!;
      return rotate(
        connector.position.map((n, i) => n * part.transform.scale[i]) as [
          number,
          number,
          number,
        ],
        quaternion(part.transform.rotation),
      ).map((n, i) => n + part.transform.position[i]);
    },
    anchor = point(
      before.parts.find((part) => part.id === connection.a)!,
      connection.connectorA,
    );
  bus.execute({
    type: "part.tilt",
    machineId: machine.id,
    partId: "panel-child",
    angle: Math.PI / 9,
  });
  const after = bus.project.machines[0],
    afterConnection = after.connections[0],
    afterAnchor = point(
      after.parts.find((part) => part.id === afterConnection.a)!,
      afterConnection.connectorA,
    ),
    afterChildAnchor = point(
      after.parts.find((part) => part.id === afterConnection.b)!,
      afterConnection.connectorB,
    );
  afterAnchor.forEach((value, i) => expect(value).toBeCloseTo(anchor[i]));
  afterChildAnchor.forEach((value, i) => expect(value).toBeCloseTo(anchor[i]));
});

test("Thrusterの排気方向は接続面の外側を向く", () => {
  const { machine } = setup();
  const candidates = findAttachmentCandidates(machine, "Thruster");
  expect(candidates).toHaveLength(2);
  for (const candidate of candidates) {
    const parent = machine.parts.find(
        (part) => part.id === candidate.parentPartId,
      )!,
      connector = placementConnectors(parent).find(
        (part) => part.id === candidate.parentConnectorId,
      )!,
      normal = rotate(connector.normal!, quaternion(parent.transform.rotation)),
      exhaust = rotate([0, 0, -1], quaternion(candidate.rotation)),
      force = rotate([0, 0, 1], quaternion(candidate.rotation));
    exhaust.forEach((value, i) => expect(value).toBeCloseTo(normal[i]));
    force.forEach((value, i) => expect(value).toBeCloseTo(-normal[i]));
  }
});

test("空のマシンでは板の初期位置だけを提示する", () => {
  const machine = createMachine();
  expect(findAttachmentCandidates(machine, "Panel")).toHaveLength(1);
  expect(findAttachmentCandidates(machine, "Wheel")).toHaveLength(0);
  expect(findAttachmentCandidates(machine, "Thruster")).toHaveLength(0);
});

test("接続木のつけ直しでは子孫へ接続せず、子孫の姿勢を一緒に移す", () => {
  const { machine, bus } = setup();
  const attach = (kind: "Block" | "Motor", id: string, parent?: string) => {
    const candidate = findAttachmentCandidates(
      bus.project.machines[0],
      kind,
    ).find((c) => !parent || c.parentPartId === parent)!;
    bus.execute({
      type: "part.attach",
      machineId: machine.id,
      partId: id,
      kind,
      candidateId: candidate.id,
    });
  };
  attach("Block", "block");
  attach("Motor", "motor", "block");
  const before = bus.project;
  const candidates = findAttachmentCandidates(
    before.machines[0],
    "Block",
    "block",
  );
  expect(
    candidates.every(
      (c) => c.parentPartId !== "block" && c.parentPartId !== "motor",
    ),
  ).toBe(true);
  const target = candidates[1];
  bus.execute({
    type: "part.reattach",
    machineId: machine.id,
    partId: "block",
    candidateId: target.id,
  });
  const after = bus.project;
  const delta = after.machines[0].parts[1].transform.position.map(
    (n, i) => n - before.machines[0].parts[1].transform.position[i],
  );
  after.machines[0].parts[2].transform.position.forEach((n, i) =>
    expect(n).toBeCloseTo(
      before.machines[0].parts[2].transform.position[i] + delta[i],
    ),
  );
  bus.undo();
  expect(bus.project).toEqual(before);
  bus.redo();
  expect(bus.project).toEqual(after);
});

test("車軸を保つ90度回転は詳細設定を保持し、4回で元の姿勢へ戻る", async () => {
  const { rotate, quaternion } =
    await import("../../packages/machine-system/src/math");
  const { machine, bus } = setup();
  bus.execute({
    type: "part.rotate",
    machineId: machine.id,
    partId: machine.parts[0].id,
    value: [0.3, 0.7, -0.4],
  });
  bus.execute({
    type: "part.attach",
    machineId: machine.id,
    kind: "Wheel",
    partId: "wheel",
    candidateId: findAttachmentCandidates(bus.project.machines[0], "Wheel")[0]
      .id,
  });
  const before = bus.project;
  const axis = rotate(
    [1, 0, 0],
    quaternion(before.machines[0].parts[1].transform.rotation),
  );
  for (let i = 0; i < 4; i++) {
    bus.execute({
      type: "part.turn",
      machineId: machine.id,
      partId: "wheel",
      steps: 1,
    });
    const wheel = bus.project.machines[0].parts[1];
    rotate([1, 0, 0], quaternion(wheel.transform.rotation)).forEach((n, j) =>
      expect(n).toBeCloseTo(axis[j]),
    );
    expect(wheel.actuator).toEqual(before.machines[0].parts[1].actuator);
  }
  const result = quaternion(
    bus.project.machines[0].parts[1].transform.rotation,
  );
  const original = quaternion(before.machines[0].parts[1].transform.rotation);
  expect(
    Math.abs(result.reduce((sum, n, i) => sum + n * original[i], 0)),
  ).toBeCloseTo(1);
  for (let i = 0; i < 4; i++) bus.undo();
  expect(bus.project).toEqual(before);
});

test("コピーは寸法・色・物理設定を保持し、重複IDを拒否する", () => {
  const { machine, bus } = setup();
  bus.execute({
    type: "part.attach",
    machineId: machine.id,
    kind: "Thruster",
    partId: "jet",
    candidateId: findAttachmentCandidates(machine, "Thruster")[0].id,
  });
  const jet = bus.project.machines[0].parts[1];
  bus.execute({
    type: "part.update",
    machineId: machine.id,
    partId: jet.id,
    patch: {
      visual: { color: "#123456" },
      actuator: { ...jet.actuator, motorTorque: 432 },
      transform: { ...jet.transform, scale: [2, 3, 4] },
    },
  });
  const before = bus.project;
  const candidate = findAttachmentCandidates(
    before.machines[0],
    "Thruster",
    undefined,
    "jet",
  )[0];
  expect(() =>
    bus.execute({
      type: "part.attach",
      machineId: machine.id,
      kind: "Thruster",
      partId: "jet",
      candidateId: candidate.id,
    }),
  ).toThrow("identifier");
  expect(bus.project).toEqual(before);
  bus.execute({
    type: "part.attach",
    machineId: machine.id,
    kind: "Thruster",
    partId: "copy",
    sourcePartId: "jet",
    candidateId: candidate.id,
  });
  const copy = bus.project.machines[0].parts[2];
  expect(copy.visual).toEqual(before.machines[0].parts[1].visual);
  expect(copy.physics).toEqual(jet.physics);
  expect(copy.actuator.motorTorque).toBe(432);
  expect(copy.transform.scale).toEqual([2, 3, 4]);
  expect(copy.transform.position).toEqual(candidate.position);
});

test("ジェットを反対向きにしても接続点は一致し、Undoで戻る", async () => {
  const { quaternion, rotate } =
    await import("../../packages/machine-system/src/math");
  const { machine, bus } = setup();
  bus.execute({
    type: "part.attach",
    machineId: machine.id,
    kind: "Thruster",
    partId: "jet",
    candidateId: findAttachmentCandidates(machine, "Thruster")[0].id,
  });
  const before = bus.project;
  bus.execute({
    type: "part.turn",
    machineId: machine.id,
    partId: "jet",
    steps: 2,
  });
  const m = bus.project.machines[0],
    [parent, child] = m.parts;
  const a = parent.connectors.find(
    (c) => c.id === m.connections[0].connectorA,
  )!;
  const b = child.connectors.find((c) => c.id === m.connections[0].connectorB)!;
  const point = (part: typeof child, local: typeof a.position) =>
    rotate(
      local.map((n, i) => n * part.transform.scale[i]) as typeof local,
      quaternion(part.transform.rotation),
    ).map((n, i) => n + part.transform.position[i]);
  point(parent, a.position).forEach((n, i) =>
    expect(n).toBeCloseTo(point(child, b.position)[i]),
  );
  expect(
    rotate([0, 0, 1], quaternion(child.transform.rotation))[2],
  ).toBeCloseTo(-1);
  bus.undo();
  expect(bus.project).toEqual(before);
});
