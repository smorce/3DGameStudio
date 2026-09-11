import {
  DEFAULT_MOTOR_MAX_TORQUE,
  DEFAULT_MOTOR_TARGET_ANGULAR_VELOCITY,
  DEFAULT_PANEL_THICKNESS,
  PANEL_SIDE,
  panelMass,
  identity,
  uid,
  type Machine,
  type Part,
  type Vec3,
} from "../../project-schema/src/index";
import { euler, multiply, rotate, quaternion, type Quat } from "./math";
export const labels: Record<Part["definitionId"], string> = {
  Panel: "板",
  Block: "ブロック",
  Wheel: "タイヤ",
  Motor: "モーター",
  Steering: "ハンドル",
  Hinge: "関節",
  Thruster: "ジェット",
};
export const DEFAULT_THRUSTER_TORQUE = 600;
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
              position: [0, 0, -size[2] / 2],
              axis: [1, 0, 0],
              normal: [0, 0, -1],
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
          ? kind === "Motor"
            ? DEFAULT_MOTOR_MAX_TORQUE
            : 180
          : kind === "Thruster"
            ? DEFAULT_THRUSTER_TORQUE
            : 0,
      targetAngularVelocity:
        kind === "Motor" ? DEFAULT_MOTOR_TARGET_ANGULAR_VELOCITY : 0,
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
          (c.id === "0" ||
            c.id === "hinge-input" ||
            c.id.startsWith("jet-") ||
            c.id.startsWith("top-"))
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
      position: [0, 0, -z / 2],
      axis: [1, 0, 0],
      normal: [0, 0, -1],
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

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function unit(v: Vec3): Vec3 {
  const length = Math.hypot(...v);
  return length > 0.000001 ? (v.map((n) => n / length) as Vec3) : [0, 0, 0];
}

function alignAxis(from: Vec3, to: Vec3): Quat {
  const a = unit(from),
    b = unit(to),
    dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (Math.hypot(...a) < 0.5 || Math.hypot(...b) < 0.5 || dot > 0.999999)
    return [0, 0, 0, 1];
  if (dot < -0.999999) {
    const helper = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const axis = unit(cross(a, helper as Vec3));
    return [axis[0], axis[1], axis[2], 0];
  }
  const axis = cross(a, b),
    q: Quat = [axis[0], axis[1], axis[2], 1 + dot],
    length = Math.hypot(...q);
  return q.map((n) => n / length) as Quat;
}

function outwardAxis(kind: Part["definitionId"]): Vec3 | undefined {
  if (kind === "Thruster") return [0, 0, -1];
  if (kind === "Motor" || kind === "Hinge") return [0, 0, 1];
  return undefined;
}

function placementRotation(
  kind: Part["definitionId"],
  parentRotation: Vec3,
  normal?: Vec3,
): Vec3 {
  const axis = normal && outwardAxis(kind);
  if (!axis) return [...parentRotation];
  return euler(multiply(quaternion(parentRotation), alignAxis(axis, normal)));
}

function attachmentPoint(
  kind: Part["definitionId"],
  size: Vec3,
): Vec3 | undefined {
  if (kind === "Thruster") return [0, 0, size[2] / 2];
  if (kind === "Motor" || kind === "Hinge") return [0, 0, -size[2] / 2];
  return undefined;
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
          const rotation = placementRotation(
            kind,
            parent.transform.rotation,
            c.normal,
          );
          const childConnectorId =
            kind === "Wheel"
              ? "0"
              : kind === "Hinge"
                ? "hinge-input"
                : kind === "Panel" && c.id.startsWith("edge-")
                  ? oppositeEdge(c.id)
                  : kind === "Panel" &&
                      (c.id.startsWith("top-") || c.id === "face-top")
                    ? "face-bottom"
                    : "mount";
          const offset = c.position.map(
            (n, i) =>
              n * parentScale[i] +
              ((c.normal?.[i] ?? 0) * size[i] * scale[i]) / 2,
          ) as Vec3;
          const parentPoint = rotate(
            c.position.map((n, i) => n * parentScale[i]) as Vec3,
            q,
          ).map((n, i) => n + parent.transform.position[i]) as Vec3;
          const mount = attachmentPoint(kind, size);
          const position = mount
            ? (parentPoint.map(
                (n, i) =>
                  n -
                  rotate(
                    mount.map((value, j) => value * scale[j]) as Vec3,
                    quaternion(rotation),
                  )[i],
              ) as Vec3)
            : (rotate(offset, q).map(
                (n, i) => n + parent.transform.position[i],
              ) as Vec3);
          return {
            id: JSON.stringify([parent.id, c.id, kind]),
            parentPartId: parent.id,
            parentConnectorId: c.id,
            childConnectorId,
            position,
            rotation: rotation as Vec3,
            axis:
              kind === "Hinge"
                ? rotate([1, 0, 0], quaternion(rotation))
                : rotate(c.axis, q),
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
        attachmentPoint(part.definitionId, part.physics.size) ??
        (part.physics.size.map(
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

function templateConnector(part: Part, id: string) {
  const connector = placementConnectors(part).find((item) => item.id === id);
  if (!connector) throw new Error(`Template connector is unavailable: ${id}`);
  return connector;
}

function scaledTemplatePoint(part: Part, point: Vec3) {
  return point.map(
    (value, index) => value * part.transform.scale[index],
  ) as Vec3;
}

function connectTemplateParts(
  machine: Machine,
  parent: Part,
  child: Part,
  parentConnectorId: string,
  childConnectorId: string,
  childRotation: Vec3 = [...child.transform.rotation],
  childAnchor?: Vec3,
) {
  const parentConnector = templateConnector(parent, parentConnectorId);
  const childConnector = templateConnector(child, childConnectorId);
  const parentPoint = rotate(
    scaledTemplatePoint(parent, parentConnector.position),
    quaternion(parent.transform.rotation),
  ).map((value, index) => value + parent.transform.position[index]) as Vec3;
  const anchor = childAnchor ?? childConnector.position;
  child.transform.rotation = [...childRotation];
  child.transform.position = parentPoint.map(
    (value, index) =>
      value -
      rotate(
        scaledTemplatePoint(child, anchor),
        quaternion(child.transform.rotation),
      )[index],
  ) as Vec3;
  if (!machine.parts.some((part) => part.id === child.id))
    machine.parts.push(child);
  machine.connections.push({
    id: `template-${parent.id}-${child.id}-${machine.connections.length}`,
    a: parent.id,
    b: child.id,
    connectorA: parentConnectorId,
    connectorB: childConnectorId,
    type: "fixed",
    axis: rotate(parentConnector.axis, quaternion(parent.transform.rotation)),
    damping: 0.2,
  });
  return child;
}

function attachTemplateWheel(machine: Machine, parent: Part, slot: string) {
  const candidate = findAttachmentCandidates(machine, "Wheel").find(
    (item) =>
      item.parentPartId === parent.id && item.parentConnectorId === slot,
  );
  if (!candidate)
    throw new Error(`Template wheel slot is unavailable: ${slot}`);
  const wheel = createPart("Wheel");
  commitAttachment(machine, wheel, candidate);
  // 飛行機の車輪は着陸装置であり、前進力を発生させない。
  wheel.metadata.drive = false;
  wheel.actuator.motorTorque = 0;
  return wheel;
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
  const m = createMachine("はじめてのひこうき"),
    wingAngle = (18 * Math.PI) / 180,
    fuselage: Part[] = [];
  const nose = createPart("Panel", [0, 0.85, 2]);
  m.parts.push(nose);
  fuselage.push(nose);
  // +Zを機首として、中央胴体を5枚のPanelで決定論的に作る。
  for (let i = 1; i < 5; i++)
    fuselage.push(
      connectTemplateParts(
        m,
        fuselage[i - 1],
        createPart("Panel"),
        "edge-z-",
        "edge-z+",
      ),
    );

  const mainWing = fuselage[2];
  for (const side of [-1, 1] as const) {
    let parent = mainWing;
    for (let i = 0; i < 4; i++) {
      const parentConnector = side < 0 ? "edge-x-" : "edge-x+";
      const childConnector = side < 0 ? "edge-x+" : "edge-x-";
      parent = connectTemplateParts(
        m,
        parent,
        createPart("Panel"),
        parentConnector,
        childConnector,
        [wingAngle, 0, 0],
      );
    }
  }

  const tailRoot = fuselage[4],
    tailPanels: Record<-1 | 1, Part[]> = { [-1]: [], [1]: [] };
  for (const side of [-1, 1] as const) {
    const parentConnector = side < 0 ? "edge-x-" : "edge-x+";
    const childConnector = side < 0 ? "edge-x+" : "edge-x-";
    let parent = connectTemplateParts(
      m,
      tailRoot,
      createPart("Panel"),
      parentConnector,
      childConnector,
    );
    tailPanels[side].push(parent);
    parent = connectTemplateParts(
      m,
      parent,
      createPart("Panel"),
      parentConnector,
      childConnector,
    );
    tailPanels[side].push(parent);
  }

  // 後方の水平尾翼上にBlockを置き、機首側には簡単なCockpitを置く。
  connectTemplateParts(m, fuselage[1], createPart("Block"), "top-1", "mount");
  connectTemplateParts(m, tailRoot, createPart("Panel"), "top-0", "edge-z-", [
    0,
    0,
    Math.PI / 2,
  ]);
  for (const side of [-1, 1] as const) {
    const thruster = createPart("Thruster");
    thruster.actuator.motorTorque = 1600;
    connectTemplateParts(
      m,
      tailPanels[side][1],
      thruster,
      "edge-z-",
      "mount",
      [0, 0, 0],
      [0, 0, thruster.physics.size[2] / 2],
    );
  }

  // 車輪の位置は胴体PanelのConnectorへ明示し、全輪を非駆動にする。
  const gearSlots: Vec3[] = [
    [-1, -0.3, -1],
    [1, -0.3, -1],
    [-1, -0.3, -3],
    [1, -0.3, -3],
  ];
  nose.connectors = placementConnectors(nose);
  gearSlots.forEach((position, index) => {
    const connector = nose.connectors.find((item) => item.id === String(index));
    if (!connector)
      throw new Error(`Template landing gear slot is unavailable: ${index}`);
    connector.position = position;
  });
  for (let i = 0; i < gearSlots.length; i++)
    attachTemplateWheel(m, nose, String(i));
  // 軽量なPanelを使い、推進で得た速度を揚力へ変換しやすくする。
  for (const part of m.parts)
    if (part.definitionId === "Panel") {
      part.physics.size = [PANEL_SIDE, 0.04, PANEL_SIDE];
      part.physics.mass = panelMass(0.04);
    }
  return m;
}
export function boatTemplate() {
  const m = createMachine("はじめてのボート");
  const hullPanel = (position?: Vec3) => {
    const panel = createPart("Panel", position);
    panel.metadata.buoyancy = 1;
    return panel;
  };
  const leftRoot = hullPanel([-1, 0, 0.5]);
  m.parts.push(leftRoot);
  connectTemplateParts(m, leftRoot, hullPanel(), "edge-z+", "edge-z-");
  const leftRear = connectTemplateParts(
      m,
      leftRoot,
      hullPanel(),
      "edge-z-",
      "edge-z+",
    ),
    deckFront = connectTemplateParts(
      m,
      leftRoot,
      createPart("Panel"),
      "edge-x+",
      "edge-x-",
    ),
    deckRear = connectTemplateParts(
      m,
      leftRear,
      createPart("Panel"),
      "edge-x+",
      "edge-x-",
    ),
    rightRoot = connectTemplateParts(
      m,
      deckFront,
      hullPanel(),
      "edge-x+",
      "edge-x-",
    ),
    rightRear = connectTemplateParts(
      m,
      rightRoot,
      hullPanel(),
      "edge-z-",
      "edge-z+",
    );
  connectTemplateParts(m, rightRoot, hullPanel(), "edge-z+", "edge-z-");
  connectTemplateParts(m, deckRear, rightRear, "edge-x+", "edge-x-");
  const cabin = connectTemplateParts(
    m,
    deckFront,
    createPart("Block"),
    "top-1",
    "mount",
  );
  // 排水体積で決まる喫水を保ちつつ、Deckを明確に水面上へ出す。
  for (const part of [deckFront, deckRear, cabin])
    part.transform.position[1] += 0.08;
  for (const rear of [leftRear, rightRear]) {
    const thruster = createPart("Thruster");
    connectTemplateParts(
      m,
      rear,
      thruster,
      "edge-z-",
      "mount",
      [0, 0, 0],
      [0, 0, thruster.physics.size[2] / 2],
    );
  }
  return m;
}
