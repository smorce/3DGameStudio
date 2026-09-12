import {
  DEFAULT_MOTOR_MAX_TORQUE,
  DEFAULT_MOTOR_TARGET_ANGULAR_VELOCITY,
  DEFAULT_PANEL_THICKNESS,
  DEFAULT_SUSPENSION_MAX_TRAVEL,
  PANEL_SIDE,
  panelMass,
  identity,
  uid,
  type Machine,
  type Part,
  type SuspensionSettings,
  type Vec3,
} from "../../project-schema/src/index";
import { euler, multiply, rotate, quaternion, type Quat } from "./math";
export const labels: Record<Part["definitionId"], string> = {
  Panel: "板",
  Block: "ブロック",
  Wheel: "タイヤ",
  Suspension: "サスペンション",
  Motor: "モーター",
  Steering: "ハンドル",
  Hinge: "関節",
  Thruster: "ジェット",
};
export const DEFAULT_THRUSTER_TORQUE = 600;
/** Panel下面の四隅。必ずPart表面上に置き、外側への浮きコネクタは作らない。 */
export function panelWheelMountPositions(size: Vec3): Vec3[] {
  const [x, y, z] = size,
    hx = x / 2,
    hz = z / 2,
    bottom = -y / 2;
  return [
    [-hx, bottom, hz],
    [hx, bottom, hz],
    [-hx, bottom, -hz],
    [hx, bottom, -hz],
  ];
}
export const wheelSlots: Vec3[] = panelWheelMountPositions([
  PANEL_SIDE,
  DEFAULT_PANEL_THICKNESS,
  PANEL_SIDE,
]);
export const DEFAULT_SUSPENSION: SuspensionSettings = {
  restLength: 0.65,
  maxTravel: DEFAULT_SUSPENSION_MAX_TRAVEL,
  stiffness: 10,
  compression: 2,
  relaxation: 4,
  maxForce: 10000,
};
/** 明示SuspensionがWheel半径へ食い込まないための最低クリアランス。 */
export const SUSPENSION_WHEEL_CLEARANCE_M = 0.08;
/** 圧縮時もストラット実体を残す最低長。クリアランスと同じ値を用いる。 */
export const MINIMUM_VISIBLE_SUSPENSION_LENGTH_M = SUSPENSION_WHEEL_CLEARANCE_M;
/** 明示Suspensionで正しいhardPoint接地を支える最低ばね剛性。 */
export const EXPLICIT_SUSPENSION_MIN_STIFFNESS = 45;

const panelSize: Vec3 = [PANEL_SIDE, DEFAULT_PANEL_THICKNESS, PANEL_SIDE];
/** 飛行機可動翼と同じ薄い棒状関節。立方体サイズの旧関節は使わない。 */
export const DEFAULT_HINGE_SIZE: Vec3 = [PANEL_SIDE, 0.08, 0.08];
export const DEFAULT_HINGE_MASS = 0.5;
const partSize = (kind: Part["definitionId"]): Vec3 =>
  kind === "Panel"
    ? [...panelSize]
    : kind === "Wheel"
      ? [0.4, 0.55, 0.55]
      : kind === "Suspension"
        ? [0.24, 0.62, 0.24]
        : kind === "Hinge"
          ? [...DEFAULT_HINGE_SIZE]
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
      mass:
        kind === "Panel"
          ? panelMass(DEFAULT_PANEL_THICKNESS)
          : kind === "Hinge"
            ? DEFAULT_HINGE_MASS
            : 3,
      friction: 1.2,
      restitution: 0.05,
      collider:
        kind === "Wheel" ? "cylinder" : kind === "Suspension" ? "none" : "box",
      size,
      ...(kind === "Suspension"
        ? { suspension: { ...DEFAULT_SUSPENSION } }
        : {}),
    },
    connectors:
      kind === "Hinge"
        ? [
            {
              id: "hinge-input",
              // 回転軸(=中心)を親Panel端面上へ置く。
              position: [0, 0, 0],
              axis: [1, 0, 0],
              normal: [0, 0, -1],
              type: "mount",
              accepts: [],
            },
          ]
        : kind === "Suspension"
          ? []
          : (kind === "Panel" ? wheelSlots : [[0, 0, 0] as Vec3]).map(
              (v, i) => ({
                id: String(i),
                position: v,
                axis: [1, 0, 0],
              }),
            ),
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
      motorMode: "velocity",
      controlChannel: "throttle",
      controlGain: 1,
      neutralAngleRad: 0,
      positionStiffness: 20,
      positionDamping: 5,
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
      { channel: "throttle", key: "KeyW", value: 1 },
      { channel: "throttle", key: "KeyS", value: -1 },
      { channel: "steering", key: "KeyA", value: 1 },
      { channel: "steering", key: "KeyD", value: -1 },
      { channel: "throttle", key: "ArrowUp", value: 1 },
      { channel: "throttle", key: "ArrowDown", value: -1 },
      { channel: "steering", key: "ArrowLeft", value: 1 },
      { channel: "steering", key: "ArrowRight", value: -1 },
      { channel: "brake", key: "Space", value: 1 },
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

export type Connector = Part["connectors"][number];
// 辺・上面の構造接続。Suspension/Wheelは下面専用なので含めない。
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
const undercarriageKinds: Part["definitionId"][] = ["Wheel", "Suspension"];

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
          ? {
              type: "wheel" as const,
              accepts: ["Wheel", "Suspension"] as const,
            }
          : { type: "mount" as const, accepts: [] }),
    }));
  const add = (connector: Connector) => {
    if (!connectors.some((c) => c.id === connector.id))
      connectors.push(connector);
  };
  const [, sizeY, sizeZ] = part.physics.size;
  const mountPosition: Vec3 =
    part.definitionId === "Thruster"
      ? [0, 0, sizeZ / 2]
      : part.definitionId === "Motor"
        ? [0, 0, -sizeZ / 2]
        : part.definitionId === "Block" || part.definitionId === "Steering"
          ? [0, -sizeY / 2, 0]
          : part.definitionId === "Wheel"
            ? [0, part.physics.size[1], 0]
            : [0, 0, 0];
  add({
    id: "mount",
    position: mountPosition,
    axis: [1, 0, 0],
    ...(part.definitionId === "Wheel"
      ? { normal: [0, 1, 0] as Vec3, type: "mount" as const, accepts: [] }
      : { type: "mount" as const, accepts: [] }),
  });
  if (part.definitionId === "Wheel") {
    // 車軸中心。Suspension接続とPhysicsのrestWheelCenterに使う。
    const axle = connectors.find((connector) => connector.id === "0");
    if (axle) {
      axle.position = [0, 0, 0];
      axle.axis = [1, 0, 0];
      axle.normal = [0, -1, 0];
      axle.type = "wheel";
      axle.accepts = [];
    } else {
      add({
        id: "0",
        position: [0, 0, 0],
        axis: [1, 0, 0],
        normal: [0, -1, 0],
        type: "wheel",
        accepts: [],
      });
    }
  } else if (part.definitionId === "Hinge") {
    const [, , z] = part.physics.size,
      gap = Math.max(z * 0.1, 0.008);
    add({
      id: "hinge-input",
      position: [0, 0, 0],
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
    // Wheel/Suspension取付はPanel下面上だけ。面外の旧オフセットは四隅へ戻す。
    const faceMounts = panelWheelMountPositions([x, y, z]);
    for (let i = 0; i < 4; i++) {
      const id = String(i),
        connector = connectors.find((item) => item.id === id),
        fallback = faceMounts[i];
      if (!connector) {
        add({
          id,
          position: [...fallback] as Vec3,
          axis: [1, 0, 0],
          normal: [0, -1, 0],
          type: "wheel",
          accepts: ["Wheel", "Suspension"],
        });
        continue;
      }
      const insideFace =
        Math.abs(connector.position[0]) <= x / 2 + 1e-6 &&
        Math.abs(connector.position[2]) <= z / 2 + 1e-6;
      connector.position = insideFace
        ? [connector.position[0], -y / 2, connector.position[2]]
        : ([...fallback] as Vec3);
      connector.normal = [0, -1, 0];
      connector.type = "wheel";
      connector.accepts = [...undercarriageKinds];
    }
    // 下面中央はBlock用。足回りは四隅マウントに限定する。
    const faceBottom = connectors.find((item) => item.id === "face-bottom");
    if (faceBottom) faceBottom.accepts = ["Block"];
  } else if (part.definitionId === "Suspension") {
    const restLength =
      part.physics.suspension?.restLength ?? DEFAULT_SUSPENSION.restLength;
    add({
      id: "suspension-input",
      position: [0, 0, 0],
      axis: [1, 0, 0],
      normal: [0, 1, 0],
      type: "mount",
      accepts: structuralKinds,
    });
    add({
      id: "suspension-wheel",
      position: [0, -restLength, 0],
      axis: [1, 0, 0],
      normal: [0, -1, 0],
      type: "wheel",
      accepts: ["Wheel"],
    });
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
  // Wheel/Suspensionの取付面(+Y)を親Connectorへ向ける。
  if (kind === "Wheel" || kind === "Suspension") return [0, 1, 0];
  return undefined;
}

/** Wheel/Suspension: 取付面をPanelへ密着させつつ、車軸(ローカルX)は水平を保つ。 */
function undercarriagePlacementRotation(
  parentRotation: Vec3,
  normalLocal: Vec3,
): Vec3 {
  const parentQ = quaternion(parentRotation),
    normalWorld = unit(rotate(normalLocal, parentQ)),
    // 取付面は親の外側法線の反対(パネルへ向かう向き)。
    mountDir = unit(normalWorld.map((value) => -value) as Vec3),
    worldUp: Vec3 = [0, 1, 0];
  let orientation = alignAxis([0, 1, 0], mountDir);
  let desiredAxle = unit(cross(worldUp, mountDir));
  if (Math.hypot(...desiredAxle) < 0.5) {
    // 下面取り付け(mountDir≈上)では親の横方向を水平に投影する。
    const parentRight = rotate([1, 0, 0], parentQ);
    desiredAxle = unit([parentRight[0], 0, parentRight[2]] as Vec3);
    if (Math.hypot(...desiredAxle) < 0.5) desiredAxle = [1, 0, 0];
  }
  const axle = rotate([1, 0, 0], orientation);
  if (
    axle[0] * desiredAxle[0] + axle[1] * desiredAxle[1] + axle[2] * desiredAxle[2] <
    0
  )
    desiredAxle = desiredAxle.map((value) => -value) as Vec3;
  orientation = multiply(alignAxis(axle, desiredAxle), orientation);
  return euler(orientation);
}

function placementRotation(
  kind: Part["definitionId"],
  parentRotation: Vec3,
  normal?: Vec3,
): Vec3 {
  if ((kind === "Wheel" || kind === "Suspension") && normal)
    return undercarriagePlacementRotation(parentRotation, normal);
  const axis = normal && outwardAxis(kind);
  if (!axis) return [...parentRotation];
  return euler(multiply(quaternion(parentRotation), alignAxis(axis, normal)));
}

function transformPoint(transform: Part["transform"], point: Vec3): Vec3 {
  return rotate(
    point.map((value, index) => value * transform.scale[index]) as Vec3,
    quaternion(transform.rotation),
  ).map((value, index) => value + transform.position[index]) as Vec3;
}

function attachmentTransform(part: Part): Part["transform"] {
  return part.definitionId === "Panel"
    ? { ...part.transform, scale: [1, 1, 1] }
    : part.transform;
}

export function connectorWorldPosition(part: Part, connectorId: string): Vec3 {
  const connector = placementConnectors(part).find(
    (item) => item.id === connectorId,
  );
  if (!connector)
    throw new Error(`Connector is unavailable: ${part.id}/${connectorId}`);
  return transformPoint(attachmentTransform(part), connector.position);
}

export function wheelBottomY(machine: Machine, wheel: Part): number {
  const center = connectorWorldPosition(wheel, "0"),
    radius = wheel.physics.size[1] * wheel.transform.scale[1];
  return center[1] - radius;
}

export function liftMachineToGround(
  machine: Machine,
  groundHeightAt: (x: number, z: number) => number | undefined,
  epsilon = 1e-3,
) {
  let lift = 0;
  for (const wheel of machine.parts.filter(
    (part) => part.definitionId === "Wheel",
  )) {
    const center = connectorWorldPosition(wheel, "0"),
      ground = groundHeightAt(center[0], center[2]);
    if (ground === undefined) continue;
    lift = Math.max(lift, ground - wheelBottomY(machine, wheel));
  }
  if (lift <= epsilon) return 0;
  for (const part of machine.parts) part.transform.position[1] += lift;
  return lift;
}

export function solveAttachmentTransform(
  parentTransform: Part["transform"],
  parentConnector: Connector,
  childTransform: Part["transform"],
  childConnector: Connector,
): Part["transform"] {
  const parentPoint = transformPoint(parentTransform, parentConnector.position),
    childOffset = rotate(
      childConnector.position.map(
        (value, index) => value * childTransform.scale[index],
      ) as Vec3,
      quaternion(childTransform.rotation),
    );
  return {
    ...childTransform,
    position: childOffset.map(
      (value, index) => parentPoint[index] - value,
    ) as Vec3,
  };
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
  const scale = existing?.transform.scale ?? [1, 1, 1];
  const childPart = existing ?? createPart(kind);
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
          const rotation = placementRotation(
            kind,
            parent.transform.rotation,
            c.normal,
          );
          const childConnectorId =
            kind === "Wheel"
              ? parent.definitionId === "Suspension"
                ? "0"
                : "mount"
              : kind === "Suspension"
                ? "suspension-input"
                : kind === "Hinge"
                  ? "hinge-input"
                  : kind === "Panel" && c.id.startsWith("edge-")
                    ? oppositeEdge(c.id)
                    : kind === "Panel" &&
                        (c.id.startsWith("top-") || c.id === "face-top")
                      ? "face-bottom"
                      : "mount";
          const childConnector = placementConnectors(childPart).find(
            (connector) => connector.id === childConnectorId,
          );
          if (!childConnector)
            throw new Error(
              `Child connector is unavailable: ${kind}/${childConnectorId}`,
            );
          const childTransform = solveAttachmentTransform(
            attachmentTransform(parent),
            c,
            {
              ...childPart.transform,
              position: [0, 0, 0],
              rotation,
              scale,
            },
            childConnector,
          );
          return {
            id: JSON.stringify([parent.id, c.id, kind]),
            parentPartId: parent.id,
            parentConnectorId: c.id,
            childConnectorId,
            position: childTransform.position,
            rotation: rotation as Vec3,
            axis:
              kind === "Hinge" || kind === "Wheel"
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
  part.connectors = placementConnectors(part);
  if (candidate.parentPartId) {
    const parent = machine.parts.find((p) => p.id === candidate.parentPartId)!;
    parent.connectors = placementConnectors(parent);
    const connector = parent.connectors.find(
      (c) => c.id === candidate.parentConnectorId,
    )!;
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

function connectTemplateParts(
  machine: Machine,
  parent: Part,
  child: Part,
  parentConnectorId: string,
  childConnectorId: string,
  childRotation: Vec3 = [...child.transform.rotation],
  connectionType: "fixed" | "revolute" = "fixed",
  limits?: { minAngleRad: number; maxAngleRad: number },
) {
  const parentConnector = templateConnector(parent, parentConnectorId);
  const childConnector = templateConnector(child, childConnectorId);
  child.transform.rotation = [...childRotation];
  child.transform = solveAttachmentTransform(
    attachmentTransform(parent),
    parentConnector,
    child.transform,
    childConnector,
  );
  if (!machine.parts.some((part) => part.id === child.id))
    machine.parts.push(child);
  machine.connections.push({
    id: `template-${parent.id}-${child.id}-${machine.connections.length}`,
    a: parent.id,
    b: child.id,
    connectorA: parentConnectorId,
    connectorB: childConnectorId,
    type: connectionType,
    axis: rotate(parentConnector.axis, quaternion(parent.transform.rotation)),
    damping: 0.2,
    ...(limits ? { limits } : {}),
  });
  return child;
}

function attachTemplateSuspensionWheel(
  machine: Machine,
  parent: Part,
  slot: string,
  front: boolean,
  role: string,
) {
  const suspensionCandidate = findAttachmentCandidates(
    machine,
    "Suspension",
  ).find(
    (item) =>
      item.parentPartId === parent.id && item.parentConnectorId === slot,
  );
  if (!suspensionCandidate)
    throw new Error(`Template suspension slot is unavailable: ${slot}`);
  const suspension = createPart("Suspension");
  commitAttachment(machine, suspension, suspensionCandidate);
  const wheelCandidate = findAttachmentCandidates(machine, "Wheel").find(
    (item) =>
      item.parentPartId === suspension.id &&
      item.parentConnectorId === "suspension-wheel",
  );
  if (!wheelCandidate)
    throw new Error("Template suspension wheel connector is unavailable");
  const wheel = createPart("Wheel");
  wheel.physics.size = [0.3, 0.38, 0.38];
  commitAttachment(machine, wheel, wheelCandidate);
  wheel.metadata.front = front;
  wheel.metadata.drive = false;
  wheel.metadata.gearRole = role;
  wheel.actuator.motorTorque = 0;
  return { suspension, wheel };
}

export function carTemplate() {
  const m = createMachine("はじめてのくるま");
  attachPart(m, createPart("Panel"));
  // 最低2枚にして前後Wheelの間隔を確保する(1枚だと密着四隅で転倒しやすい)。
  const frontCandidate = findAttachmentCandidates(m, "Panel").find(
    (candidate) => candidate.parentConnectorId === "edge-z+",
  );
  if (!frontCandidate)
    throw new Error("Car front panel attachment is unavailable");
  const front = createPart("Panel");
  commitAttachment(m, front, frontCandidate);
  const rear = m.parts[0];
  for (const [panel, slot] of [
    [front, "0"],
    [front, "1"],
    [rear, "2"],
    [rear, "3"],
  ] as const) {
    const candidate = findAttachmentCandidates(m, "Wheel").find(
      (item) =>
        item.parentPartId === panel.id && item.parentConnectorId === slot,
    );
    if (!candidate) throw new Error(`Car wheel slot is unavailable: ${slot}`);
    commitAttachment(m, createPart("Wheel"), candidate);
  }
  return m;
}
export function starterCarTemplate() {
  // 2×5(幅2m×全長5m)のPanelグリッドで縦長シャシーを組む。
  const m = createMachine("はじめてのくるま"),
    root = createPart("Panel", [-0.5, 0.85, -2]);
  root.connectors = placementConnectors(root);
  root.connectors.find((connector) => connector.id === "face-top")!.accepts = [
    "Block",
  ];
  root.connectors.find((connector) => connector.id === "face-top")!.position = [
    0.5,
    DEFAULT_PANEL_THICKNESS / 2,
    2,
  ];
  m.parts.push(root);
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
  const rearLeft = root,
    rearRight = right;
  for (let row = 1; row < 5; row++) {
    left = attachPanel(left.id, "edge-z+");
    right = attachPanel(right.id, "edge-z+");
  }
  const frontLeft = left,
    frontRight = right;
  // 四隅Panelの下面コーナーへ密着。離れた仮想コネクタは使わない。
  for (const [panel, slot] of [
    [frontLeft, "0"],
    [frontRight, "1"],
    [rearLeft, "2"],
    [rearRight, "3"],
  ] as const) {
    const candidate = findAttachmentCandidates(m, "Wheel").find(
      (item) =>
        item.parentPartId === panel.id && item.parentConnectorId === slot,
    );
    if (!candidate)
      throw new Error(`Starter wheel slot is unavailable: ${slot}`);
    commitAttachment(m, createPart("Wheel"), candidate);
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
/** Rapier hard point = 自然長時Wheel中心から suspensionDirection * restLength だけ戻った点。 */
export function suspensionHardPoint(
  restWheelCenter: Vec3,
  suspensionDirection: Vec3,
  restLength: number,
): Vec3 {
  return restWheelCenter.map(
    (value, index) => value - suspensionDirection[index] * restLength,
  ) as Vec3;
}

/** Play時Wheel中心 = hardPoint + direction * 現在のサスペンション長。 */
export function wheelCenterFromSuspension(
  hardPoint: Vec3,
  suspensionDirection: Vec3,
  suspensionLength: number,
): Vec3 {
  return hardPoint.map(
    (value, index) => value + suspensionDirection[index] * suspensionLength,
  ) as Vec3;
}

/** 明示Suspensionの最大圧縮をWheel寸法で制限する。 */
export function clampSuspensionTravelForWheel(
  settings: SuspensionSettings,
  wheelRadius: number,
): SuspensionSettings {
  // restLength - maxTravel >= wheelRadius + clearance
  const minimumLength = wheelRadius + SUSPENSION_WHEEL_CLEARANCE_M;
  const maxAllowedTravel = Math.max(0.01, settings.restLength - minimumLength);
  return {
    ...settings,
    maxTravel: Math.min(settings.maxTravel, maxAllowedTravel),
    // クリアランス確保でストロークが減っても、機体が沈み込まない剛性を保証する。
    stiffness: Math.max(settings.stiffness, EXPLICIT_SUSPENSION_MIN_STIFFNESS),
    compression: Math.max(settings.compression, 4),
    relaxation: Math.max(settings.relaxation, 6),
  };
}

export function wheelSuspensionSettings(
  machine: Machine,
  wheelId: string,
): SuspensionSettings {
  const wheel = machine.parts.find(
    (part) => part.id === wheelId && part.definitionId === "Wheel",
  );
  const connection = machine.connections.find(
    (item) => item.type === "revolute" && item.b === wheelId,
  );
  const parent = connection
    ? machine.parts.find((part) => part.id === connection.a)
    : undefined;
  const radius = wheel
    ? wheel.physics.size[1] * wheel.transform.scale[1]
    : 0;
  if (parent?.definitionId === "Suspension" && parent.physics.suspension)
    return clampSuspensionTravelForWheel(parent.physics.suspension, radius);
  // 直接Wheel: Panel下面への密着と、Raycast用restLengthを分離する。
  // hardPointはTire上面、restLengthは半径(車軸までの距離)。
  const base = wheel?.physics.suspension ?? DEFAULT_SUSPENSION;
  const restLength = Math.max(0.08, radius);
  return {
    ...base,
    restLength,
    maxTravel: Math.min(base.maxTravel, Math.max(0.05, restLength * 0.4)),
    stiffness: Math.max(base.stiffness, EXPLICIT_SUSPENSION_MIN_STIFFNESS),
    compression: Math.max(base.compression, 4),
    relaxation: Math.max(base.relaxation, 6),
  };
}
export function planeTemplate() {
  const m = createMachine("はじめてのひこうき"),
    // rotation[0]が負のとき前縁上げ(正の物理迎角)になる。
    // 主翼は+2°の迎角、水平尾翼は-3°(下向き揚力)で機首上げを支援する。
    wingAngle = (-2 * Math.PI) / 180,
    tailAngle = (3 * Math.PI) / 180,
    controlSurfaceLimit = (15 * Math.PI) / 180,
    planePanelThickness = 0.04,
    fuselage: Part[] = [];
  const planePanel = (position?: Vec3) => {
    const panel =
      position === undefined
        ? createPart("Panel")
        : createPart("Panel", position);
    panel.physics.size = [PANEL_SIDE, planePanelThickness, PANEL_SIDE];
    panel.physics.mass = panelMass(planePanelThickness);
    // Wheel slotだけを旧データ互換として残し、面Connectorは薄いPanel寸法から再生成する。
    panel.connectors = panel.connectors.filter((connector) =>
      /^[0-3]$/.test(connector.id),
    );
    panel.connectors = placementConnectors(panel);
    return panel;
  };
  m.controlBindings = [
    { channel: "throttle", key: "KeyW", value: 1 },
    { channel: "throttle", key: "KeyS", value: -1 },
    { channel: "pitch", key: "ArrowUp", value: 1 },
    { channel: "pitch", key: "ArrowDown", value: -1 },
    { channel: "turn", key: "ArrowLeft", value: -1 },
    { channel: "turn", key: "ArrowRight", value: 1 },
    { channel: "steering", key: "ArrowLeft", value: -1 },
    { channel: "steering", key: "ArrowRight", value: 1 },
    { channel: "brake", key: "Space", value: 1 },
  ];
  const nose = planePanel([0, 0.85, 2]);
  m.parts.push(nose);
  fuselage.push(nose);
  // +Zを機首として、中央胴体を5枚のPanelで決定論的に作る。
  for (let i = 1; i < 5; i++)
    fuselage.push(
      connectTemplateParts(
        m,
        fuselage[i - 1],
        planePanel(),
        "edge-z-",
        "edge-z+",
      ),
    );

  for (const part of fuselage) part.metadata.aeroRole = "fuselage";
  const mainWing = fuselage[2];
  mainWing.metadata.aeroRole = "main-wing";
  const wingPanels: Record<-1 | 1, Part[]> = { [-1]: [], [1]: [] };
  for (const side of [-1, 1] as const) {
    let parent = mainWing;
    for (let i = 0; i < 4; i++) {
      const parentConnector = side < 0 ? "edge-x-" : "edge-x+";
      const childConnector = side < 0 ? "edge-x+" : "edge-x-";
      parent = connectTemplateParts(
        m,
        parent,
        planePanel(),
        parentConnector,
        childConnector,
        [wingAngle, 0, 0],
      );
      parent.metadata.aeroRole = "main-wing";
      wingPanels[side].push(parent);
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
      planePanel(),
      parentConnector,
      childConnector,
      [tailAngle, 0, 0],
    );
    parent.metadata.aeroRole = "horizontal-stabilizer";
    tailPanels[side].push(parent);
    parent = connectTemplateParts(
      m,
      parent,
      planePanel(),
      parentConnector,
      childConnector,
      [tailAngle, 0, 0],
    );
    parent.metadata.aeroRole = "horizontal-stabilizer";
    tailPanels[side].push(parent);
  }

  // 可動翼はMotor Partを使わず、Hinge自身がposition制御を受ける。
  // Hingeは2枚のPanelが接する境界に回転軸を置く薄い蝶番として扱う。
  const connectControlSurface = (
    parent: Part,
    parentConnector: string,
    surfaceRotation: Vec3,
    channel: string,
    gain: number,
    role: string,
    limits: { minAngleRad: number; maxAngleRad: number },
  ) => {
    const hinge = createPart("Hinge");
    hinge.connectors = placementConnectors(hinge);
    hinge.actuator.motorMode = "position";
    hinge.actuator.controlChannel = channel;
    hinge.actuator.controlGain = gain;
    hinge.actuator.neutralAngleRad = 0;
    hinge.actuator.positionStiffness = 500;
    hinge.actuator.positionDamping = 50;
    connectTemplateParts(
      m,
      parent,
      hinge,
      parentConnector,
      "hinge-input",
      surfaceRotation,
      "revolute",
      limits,
    );
    const movable = planePanel();
    // 可動Panelの前縁を回転軸へ密着させ、構造的な隙間を作らない。
    connectTemplateParts(
      m,
      hinge,
      movable,
      "mount",
      "edge-z+",
      surfaceRotation,
    );
    movable.metadata.aeroRole = role;
    return { hinge, movable };
  };

  for (const side of [-1, 1] as const) {
    // pitch=+1(↑)で関節角を正(法線前傾=尾翼の下向き揚力)にして機首を上げる。
    connectControlSurface(
      tailPanels[side][1],
      "edge-z-",
      [tailAngle, 0, 0],
      "pitch",
      1,
      side < 0 ? "elevator-left" : "elevator-right",
      { minAngleRad: -controlSurfaceLimit, maxAngleRad: controlSurfaceLimit },
    );
    // turn=-1(左)で左Aileronの揚力を減らし左へRollさせる。
    connectControlSurface(
      wingPanels[side][3],
      "edge-z-",
      [wingAngle, 0, 0],
      "turn",
      side < 0 ? -1 : 1,
      side < 0 ? "aileron-left" : "aileron-right",
      { minAngleRad: -controlSurfaceLimit, maxAngleRad: controlSurfaceLimit },
    );
  }

  // 軽量なPanelを使い、推進で得た速度を揚力へ変換しやすくする。
  // 以降の取付面計算も薄いPanel寸法を使用する。
  for (const part of m.parts)
    if (part.definitionId === "Panel") {
      part.physics.size = [PANEL_SIDE, planePanelThickness, PANEL_SIDE];
      part.physics.mass = panelMass(planePanelThickness);
    }

  // 機首に重いエンジンBlockを置き、重心を主翼付近まで前進させる。
  const engine = createPart("Block");
  engine.physics.mass = 30;
  connectTemplateParts(m, fuselage[0], engine, "top-1", "mount");
  const verticalTail = connectTemplateParts(
    m,
    tailRoot,
    planePanel(),
    "top-0",
    "edge-z-",
    [0, 0, Math.PI / 2],
  );
  verticalTail.metadata.aeroRole = "vertical-stabilizer";
  // turn=+1(右)で尾部を左へ押し、機首を右へ向ける。
  connectControlSurface(
    verticalTail,
    "edge-z-",
    [0, 0, Math.PI / 2],
    "turn",
    -1,
    "rudder",
    { minAngleRad: -controlSurfaceLimit, maxAngleRad: controlSurfaceLimit },
  );

  // 推力線を前方胴体の固定構造へ置く。可動翼には取り付けない。
  for (const side of [-1, 1] as const) {
    const thruster = createPart("Thruster");
    thruster.actuator.motorTorque = 1000;
    connectTemplateParts(
      m,
      fuselage[1],
      thruster,
      side < 0 ? "edge-x-" : "edge-x+",
      "mount",
      [0, 0, 0],
    );
  }
  // 実際の質量分布から重心を求め、Main Gearを重心の少し後方へ置く。
  const totalMass = m.parts.reduce((sum, part) => sum + part.physics.mass, 0);
  const centerOfMassZ =
    m.parts.reduce(
      (sum, part) => sum + part.physics.mass * part.transform.position[2],
      0,
    ) / totalMass;
  const gearY = -planePanelThickness / 2;
  // SuspensionはPanel下面へ密着させ、地上高はSuspension自身の長さで作る。
  const gearMount = fuselage[3];
  const mainGearLocalZ = Math.max(
    -0.45,
    Math.min(0.45, centerOfMassZ - 0.5 - gearMount.transform.position[2]),
  );
  nose.connectors = placementConnectors(nose);
  const noseSlot = nose.connectors.find((item) => item.id === "0");
  if (!noseSlot) throw new Error("Template nose gear slot is unavailable");
  noseSlot.position = [0, gearY, 0.35];
  noseSlot.normal = [0, -1, 0];
  gearMount.connectors = placementConnectors(gearMount);
  for (const [slot, x] of [
    ["1", -0.5],
    ["2", 0.5],
  ] as const) {
    const connector = gearMount.connectors.find((item) => item.id === slot);
    if (!connector)
      throw new Error(`Template main gear slot is unavailable: ${slot}`);
    connector.position = [x, gearY, mainGearLocalZ];
    connector.normal = [0, -1, 0];
  }
  attachTemplateSuspensionWheel(m, nose, "0", true, "nose");
  attachTemplateSuspensionWheel(m, gearMount, "1", false, "main-left");
  attachTemplateSuspensionWheel(m, gearMount, "2", false, "main-right");
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
  connectTemplateParts(m, deckFront, createPart("Block"), "top-1", "mount");
  for (const rear of [leftRear, rightRear]) {
    const thruster = createPart("Thruster");
    connectTemplateParts(m, rear, thruster, "edge-z-", "mount", [0, 0, 0]);
  }
  return m;
}
