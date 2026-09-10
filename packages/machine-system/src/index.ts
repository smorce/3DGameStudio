import {
  DEFAULT_PANEL_THICKNESS,
  PANEL_SIDE,
  panelMass,
  identity,
  uid,
  type Machine,
  type Part,
  type Vec3,
} from "../../project-schema/src/index";
import { euler, multiply, rotate, quaternion } from "./math";
export const labels: Record<Part["definitionId"], string> = {
  Panel: "板",
  Block: "ブロック",
  Wheel: "タイヤ",
  Motor: "モーター",
  Steering: "ハンドル",
  Hinge: "関節",
  Thruster: "ジェット",
};
export const wheelSlots: Vec3[] = [
  [-1, -0.45, 1.25],
  [1, -0.45, 1.25],
  [-1, -0.45, -1.25],
  [1, -0.45, -1.25],
];
const panelSize: Vec3 = [PANEL_SIDE, DEFAULT_PANEL_THICKNESS, PANEL_SIDE];
const partSize = (kind: Part["definitionId"]): Vec3 =>
  kind === "Panel"
    ? [...panelSize]
    : kind === "Wheel"
      ? [0.4, 0.55, 0.55]
      : [0.6, 0.6, 0.6];
export function createPart(
  kind: Part["definitionId"],
  position: Vec3 = [0, 0.85, 0],
): Part {
  const size = partSize(kind);
  const part: Part = {
    id: uid(),
    definitionId: kind,
    transform: { ...identity(), position },
    visual: {
      color:
        kind === "Wheel"
          ? "#26333e"
          : kind === "Thruster"
            ? "#ef8354"
            : "#e5b557",
    },
    physics: {
      mass: kind === "Panel" ? panelMass(DEFAULT_PANEL_THICKNESS) : 3,
      friction: 1.2,
      restitution: 0.05,
      collider: kind === "Wheel" ? "cylinder" : "box",
      size,
    },
    connectors:
      kind === "Hinge"
        ? [
            {
              id: "hinge-input",
              position: [0, -size[1] / 2, 0],
              axis: [1, 0, 0],
              normal: [0, -1, 0],
              type: "mount",
              accepts: [],
            },
          ]
        : (kind === "Panel" ? wheelSlots : [[0, 0, 0] as Vec3]).map((v, i) => ({
            id: String(i),
            position: v,
            axis: [1, 0, 0],
          })),
    actuator: {
      motorTorque:
        kind === "Wheel" || kind === "Motor"
          ? 180
          : kind === "Thruster"
            ? 200
            : 0,
      steering: 0.45,
      enabled: true,
    },
    metadata: {},
  };
  part.connectors = placementConnectors(part);
  return part;
}
export function createMachine(name = "マイマシン"): Machine {
  return {
    id: uid(),
    name,
    parts: [],
    connections: [],
    controlBindings: [
      { action: "forward", key: "KeyW" },
      { action: "backward", key: "KeyS" },
      { action: "left", key: "KeyA" },
      { action: "right", key: "KeyD" },
    ],
  };
}
export interface AttachmentCandidate {
  id: string;
  parentPartId: string;
  parentConnectorId: string;
  childConnectorId: string;
  position: Vec3;
  rotation: Vec3;
  axis: Vec3;
  connectionType: "fixed" | "revolute";
}

export function attachmentDescendants(machine: Machine, partId: string) {
  const ids = new Set([partId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of machine.connections)
      if (ids.has(c.a) && !ids.has(c.b)) {
        ids.add(c.b);
        changed = true;
      }
  }
  return ids;
}

type Connector = Part["connectors"][number];
const structuralKinds: Part["definitionId"][] = [
  "Panel",
  "Block",
  "Motor",
  "Steering",
  "Hinge",
];
const hingeOutputKinds: Part["definitionId"][] = [
  ...structuralKinds,
  "Thruster",
];

// 古い保存データには不足する接続先だけを補完し、計算中は元の配列を変更しない。
export function placementConnectors(part: Part): Connector[] {
  const connectors: Connector[] = part.connectors
    .filter(
      (c) =>
        !(
          part.definitionId === "Hinge" &&
          (c.id === "0" || c.id.startsWith("jet-") || c.id.startsWith("top-"))
        ),
    )
    .map((c) => ({
      ...c,
      ...(c.type || c.accepts
        ? {}
        : part.definitionId === "Panel" && /^[0-3]$/.test(c.id)
          ? { type: "wheel" as const, accepts: ["Wheel" as const] }
          : { type: "mount" as const, accepts: [] }),
    }));
  const add = (connector: Connector) => {
    if (!connectors.some((c) => c.id === connector.id))
      connectors.push(connector);
  };
  add({
    id: "mount",
    position: [0, 0, 0],
    axis: [1, 0, 0],
    type: "mount",
    accepts: [],
  });
  if (part.definitionId === "Hinge") {
    const [x, y, z] = part.physics.size,
      gap = Math.min(x, y, z) * 0.1;
    add({
      id: "hinge-input",
      position: [0, -y / 2, 0],
      axis: [1, 0, 0],
      normal: [0, -1, 0],
      type: "mount",
      accepts: [],
    });
    add({
      id: "hinge-output",
      position: [0, 0, z / 2 + gap],
      axis: [1, 0, 0],
      normal: [0, 0, 1],
      type: "structural",
      accepts: hingeOutputKinds,
    });
  } else if (["Panel", "Block"].includes(part.definitionId)) {
    const [x, y, z] = part.physics.size;
    const topZ = part.definitionId === "Panel" ? [-z * 0.3, z * 0.3] : [0];
    if (part.definitionId === "Panel") {
      for (const [id, position, normal] of [
        ["edge-x-", [-x / 2, 0, 0], [-1, 0, 0]],
        ["edge-x+", [x / 2, 0, 0], [1, 0, 0]],
        ["edge-z-", [0, 0, -z / 2], [0, 0, -1]],
        ["edge-z+", [0, 0, z / 2], [0, 0, 1]],
        ["face-bottom", [0, -y / 2, 0], [0, -1, 0]],
        ["face-top", [0, y / 2, 0], [0, 1, 0]],
      ] as const)
        add({
          id,
          position: position as Vec3,
          axis: [1, 0, 0],
          normal: normal as Vec3,
          type: "structural",
          accepts: id.startsWith("face-") ? [] : structuralKinds,
        });
    }
    topZ.forEach((offset, i) =>
      add({
        id: "top-" + i,
        position: [0, y / 2, offset],
        axis: [1, 0, 0],
        normal: [0, 1, 0],
        type: "structural",
        accepts: structuralKinds,
      }),
    );
    for (const sign of [-1, 1]) {
      add({
        id: "jet-" + sign,
        position: [0, 0, (sign * z) / 2],
        axis: [0, 1, 0],
        normal: [0, 0, sign],
        type: "propulsion",
        accepts: ["Thruster"],
      });
    }
  }
  return connectors;
}

function oppositeEdge(id: string) {
  return id.endsWith("-")
    ? id.slice(0, -1) + "+"
    : id.endsWith("+")
      ? id.slice(0, -1) + "-"
      : "face-bottom";
}

export function findAttachmentCandidates(
  machine: Machine,
  kind: Part["definitionId"],
  movingPartId?: string,
  sourcePartId?: string,
): AttachmentCandidate[] {
  const excluded = movingPartId
    ? attachmentDescendants(machine, movingPartId)
    : new Set<string>();
  const existing = machine.parts.find(
    (p) => p.id === (movingPartId ?? sourcePartId),
  );
  if (movingPartId && !existing) return [];
  if (
    !machine.parts.length ||
    (movingPartId && excluded.size === machine.parts.length)
  )
    return kind === "Panel"
      ? [
          {
            id: "root",
            parentPartId: "",
            parentConnectorId: "",
            childConnectorId: "mount",
            position: [0, 0.85, 0],
            rotation: existing ? [...existing.transform.rotation] : [0, 0, 0],
            axis: [1, 0, 0],
            connectionType: "fixed",
          },
        ]
      : [];
  const size = existing?.physics.size ?? partSize(kind);
  const scale = existing?.transform.scale ?? [1, 1, 1];
  return machine.parts
    .filter((p) => !excluded.has(p.id))
    .flatMap((parent) =>
      placementConnectors(parent)
        .filter(
          (c) =>
            c.accepts?.includes(kind) &&
            !machine.connections.some(
              (link) =>
                (link.a === parent.id &&
                  link.connectorA === c.id &&
                  link.b !== movingPartId) ||
                (link.b === parent.id && link.connectorB === c.id),
            ),
        )
        .map((c) => {
          const q = quaternion(parent.transform.rotation);
          const parentScale =
            parent.definitionId === "Panel"
              ? ([1, 1, 1] as Vec3)
              : parent.transform.scale;
          const rotation =
            kind === "Thruster" && c.normal?.[2] === 1
              ? euler(multiply(q, quaternion([0, Math.PI, 0])))
              : [...parent.transform.rotation];
          const offset = c.position.map(
            (n, i) =>
              n * parentScale[i] +
              ((c.normal?.[i] ?? 0) * size[i] * scale[i]) / 2,
          ) as Vec3;
          return {
            id: JSON.stringify([parent.id, c.id, kind]),
            parentPartId: parent.id,
            parentConnectorId: c.id,
            childConnectorId:
              kind === "Wheel"
                ? "0"
                : kind === "Hinge"
                  ? "hinge-input"
                  : kind === "Panel" && c.id.startsWith("edge-")
                    ? oppositeEdge(c.id)
                    : kind === "Panel" &&
                        (c.id.startsWith("top-") || c.id === "face-top")
                      ? "face-bottom"
                      : "mount",
            position: rotate(offset, q).map(
              (n, i) => n + parent.transform.position[i],
            ) as Vec3,
            rotation: rotation as Vec3,
            axis: rotate(c.axis, q),
            connectionType:
              kind === "Wheel" || kind === "Hinge"
                ? ("revolute" as const)
                : ("fixed" as const),
          };
        }),
    );
}

export function commitAttachment(
  machine: Machine,
  part: Part,
  candidate: AttachmentCandidate,
) {
  part.transform.position = [...candidate.position];
  part.transform.rotation = [...candidate.rotation];
  if (candidate.parentPartId) {
    const parent = machine.parts.find((p) => p.id === candidate.parentPartId)!;
    parent.connectors = placementConnectors(parent);
    const connector = parent.connectors.find(
      (c) => c.id === candidate.parentConnectorId,
    )!;
    if (
      candidate.childConnectorId === "mount" ||
      candidate.childConnectorId === "hinge-input"
    ) {
      part.connectors = placementConnectors(part);
      const childConnector = part.connectors.find(
        (c) => c.id === candidate.childConnectorId,
      )!;
      childConnector.position =
        part.definitionId === "Thruster"
          ? [0, 0, part.physics.size[2] / 2]
          : (part.physics.size.map(
              (n, i) => (-(connector.normal?.[i] ?? 0) * n) / 2,
            ) as Vec3);
    }
    if (part.definitionId === "Wheel") {
      part.metadata.front = connector.position[2] > 0;
      part.metadata.drive = !part.metadata.front;
    }
    machine.connections.push({
      id: "joint-" + parent.id + "-" + part.id,
      a: parent.id,
      b: part.id,
      connectorA: candidate.parentConnectorId,
      connectorB: candidate.childConnectorId,
      type: candidate.connectionType,
      axis: [...candidate.axis],
      damping: 0.2,
    });
  }
  if (!machine.parts.some((p) => p.id === part.id)) machine.parts.push(part);
}

export function attachPart(machine: Machine, part: Part, slot?: number) {
  if (
    part.definitionId === "Wheel" &&
    machine.parts.some((p) => p.definitionId === "Panel")
  ) {
    const candidates = findAttachmentCandidates(machine, "Wheel");
    const candidate =
      slot === undefined
        ? candidates[0]
        : candidates.find((c) => c.parentConnectorId === String(slot));
    if (!candidate) throw new Error("No available wheel connector");
    commitAttachment(machine, part, candidate);
    return;
  }
  const candidate = findAttachmentCandidates(machine, part.definitionId)[0];
  if (candidate) {
    commitAttachment(machine, part, candidate);
    return;
  }
  machine.parts.push(part);
}
export function carTemplate() {
  const m = createMachine("はじめてのくるま");
  attachPart(m, createPart("Panel"));
  for (let i = 0; i < 4; i++) attachPart(m, createPart("Wheel"));
  return m;
}
export function starterCarTemplate() {
  // 2×5(幅2m×全長5m)のPanelグリッドで縦長シャシーを組む。
  const m = createMachine("はじめてのくるま"),
    root = createPart("Panel", [-0.5, 0.85, -2]);
  root.connectors = placementConnectors(root);
  // 車輪半径0.55が接地し、Panel外周(x=±1)とも重ならない位置に固定する。
  const starterWheelSlots: Vec3[] = [
    [-0.7, -0.3, 4],
    [1.7, -0.3, 4],
    [-0.7, -0.3, 0],
    [1.7, -0.3, 0],
  ];
  for (let i = 0; i < starterWheelSlots.length; i++)
    root.connectors.find((connector) => connector.id === String(i))!.position =
      starterWheelSlots[i];
  root.connectors.find((connector) => connector.id === "face-top")!.accepts = [
    "Block",
  ];
  root.connectors.find((connector) => connector.id === "face-top")!.position = [
    0.5,
    DEFAULT_PANEL_THICKNESS / 2,
    2,
  ];
  m.parts.push(root);
  for (let i = 0; i < 4; i++) attachPart(m, createPart("Wheel"), i);
  const attachPanel = (parentPartId: string, parentConnectorId: string) => {
    const candidate = findAttachmentCandidates(m, "Panel").find(
      (item) =>
        item.parentPartId === parentPartId &&
        item.parentConnectorId === parentConnectorId,
    );
    if (!candidate) throw new Error("Starter panel attachment is unavailable");
    const panel = createPart("Panel");
    commitAttachment(m, panel, candidate);
    return panel;
  };
  let left = root,
    right = attachPanel(root.id, "edge-x+");
  for (let row = 1; row < 5; row++) {
    left = attachPanel(left.id, "edge-z+");
    right = attachPanel(right.id, "edge-z+");
  }
  const blockCandidate = findAttachmentCandidates(m, "Block").find(
    (item) =>
      item.parentPartId === root.id && item.parentConnectorId === "face-top",
  );
  if (!blockCandidate)
    throw new Error("Starter block attachment is unavailable");
  commitAttachment(m, createPart("Block"), blockCandidate);
  return m;
}
export function compileMachine(machine: Machine) {
  const parts = structuredClone(machine.parts),
    connections = structuredClone(machine.connections);
  const wheelConnections = connections.filter(
    (c) =>
      c.type === "revolute" &&
      parts.some((p) => p.id === c.b && p.definitionId === "Wheel"),
  );
  const wheelIds = new Set(wheelConnections.map((c) => c.b));
  const solid = parts.filter((p) => !wheelIds.has(p.id));
  const parent = new Map(solid.map((p) => [p.id, p.id]));
  const root = (id: string): string =>
    parent.get(id) === id ? id : root(parent.get(id)!);
  for (const c of connections.filter((c) => c.type === "fixed"))
    if (parent.has(c.a) && parent.has(c.b)) parent.set(root(c.b), root(c.a));
  const groups = new Map<string, Part[]>();
  for (const p of solid) {
    const id = root(p.id);
    groups.set(id, [...(groups.get(id) ?? []), p]);
  }
  const bodies = [...groups].map(([id, parts]) => ({ id, parts }));
  return {
    id: machine.id,
    parts,
    fixedParts: solid,
    wheels: parts.filter((p) => wheelIds.has(p.id)),
    connections,
    wheelConnections,
    bodies,
    bodyForPart: new Map(solid.map((p) => [p.id, root(p.id)])),
    joints: connections.filter(
      (c) => c.type === "revolute" && !wheelIds.has(c.b),
    ),
  };
}
export function planeTemplate() {
  const m = createMachine();
  m.name = "はじめてのひこうき";
  attachPart(m, createPart("Panel", [0, 1, 0]));
  for (let i = 0; i < 4; i++) attachPart(m, createPart("Panel"));
  attachPart(m, createPart("Thruster", [0, 1, -1.6]));
  return m;
}
export function boatTemplate() {
  const m = createMachine("はじめてのボート"),
    hull = createPart("Panel");
  hull.metadata.buoyancy = 1;
  attachPart(m, hull);
  attachPart(m, createPart("Thruster", [0, 1, -1.7]));
  return m;
}
