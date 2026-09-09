import {
  identity,
  uid,
  type Machine,
  type Part,
  type Vec3,
} from "../../project-schema/src/index";
import { rotate, quaternion } from "./math";
export const labels: Record<Part["definitionId"], string> = {
  Panel: "板",
  Block: "ブロック",
  Wheel: "タイヤ",
  Motor: "モーター",
  Steering: "ハンドル",
  Hinge: "関節",
  Thruster: "ジェット",
  Wing: "羽",
};
export const wheelSlots: Vec3[] = [
  [-1.25, 0, 1.25],
  [1.25, 0, 1.25],
  [-1.25, 0, -1.25],
  [1.25, 0, -1.25],
];
export function createPart(
  kind: Part["definitionId"],
  position: Vec3 = [0, 0.85, 0],
): Part {
  return {
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
      mass: kind === "Panel" ? 30 : 3,
      friction: 1.2,
      restitution: 0.05,
      collider: kind === "Wheel" ? "cylinder" : "box",
      size:
        kind === "Panel"
          ? [2.2, 0.3, 3.5]
          : kind === "Wheel"
            ? [0.4, 0.55, 0.55]
            : kind === "Wing"
              ? [4, 0.12, 0.8]
              : [0.6, 0.6, 0.6],
    },
    connectors: (kind === "Panel" ? wheelSlots : [[0, 0, 0] as Vec3]).map(
      (v, i) => ({ id: String(i), position: v, axis: [1, 0, 0] }),
    ),
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
export function attachPart(machine: Machine, part: Part, slot?: number) {
  const root = machine.parts.find((p) => p.definitionId === "Panel");
  if (root && part.definitionId === "Wheel") {
    const used = machine.connections
      .filter(
        (c) =>
          c.a === root.id &&
          machine.parts.some((p) => p.id === c.b && p.definitionId === "Wheel"),
      )
      .map((c) => Number(c.connectorA));
    const index = slot ?? wheelSlots.findIndex((_, i) => !used.includes(i));
    if (index < 0 || index >= 4 || used.includes(index))
      throw new Error("No available wheel connector");
    part.transform.position = rotate(
      wheelSlots[index].map((n, i) => n * root.transform.scale[i]) as Vec3,
      quaternion(root.transform.rotation),
    ).map((n, i) => n + root.transform.position[i]) as Vec3;
    part.metadata.drive = index >= 2;
    part.metadata.front = index < 2;
    machine.connections.push({
      id: `joint-${root.id}-${part.id}`,
      a: root.id,
      b: part.id,
      connectorA: String(index),
      connectorB: "0",
      type: "revolute",
      axis: [1, 0, 0],
      damping: 0.2,
    });
  } else if (root) {
    machine.connections.push({
      id: `joint-${root.id}-${part.id}`,
      a: root.id,
      b: part.id,
      connectorA: "0",
      connectorB: "0",
      type: part.definitionId === "Hinge" ? "revolute" : "fixed",
      axis: [1, 0, 0],
      damping: 0.2,
    });
  }
  machine.parts.push(part);
}
export function carTemplate() {
  const m = createMachine("はじめてのくるま");
  attachPart(m, createPart("Panel"));
  for (let i = 0; i < 4; i++) attachPart(m, createPart("Wheel"));
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
  const m = carTemplate();
  m.name = "はじめてのひこうき";
  attachPart(m, createPart("Wing", [0, 1, 0]));
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
