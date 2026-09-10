import { expect, it } from "vitest";
import * as THREE from "three";
import { createPart } from "../../packages/machine-system/src/index";
import {
  createPartVisual,
  updateMotorActivity,
  updateThrusterFlame,
} from "../../packages/renderer-three/src/part-visuals";

function meshes(group: THREE.Group) {
  return group.children.filter(
    (child): child is THREE.Mesh => child instanceof THREE.Mesh,
  );
}

it("HingeはローカルX軸のピンと左右ブラケットを生成する", () => {
  const part = createPart("Hinge");
  part.transform.position = [4, 2, -3];
  part.transform.rotation = [0.2, 0.4, 0.6];
  const visual = createPartVisual(part);
  const pin = visual.getObjectByName("hinge-pin");

  expect(pin).toBeInstanceOf(THREE.Mesh);
  expect((pin as THREE.Mesh).geometry).toBeInstanceOf(THREE.CylinderGeometry);
  expect((pin as THREE.Mesh).rotation.z).toBeCloseTo(Math.PI / 2);
  expect(pin?.position.toArray()).toEqual([0, 0, 0]);
  expect(visual.position.toArray()).toEqual([0, 0, 0]);
  expect(visual.rotation.toArray()).toEqual([0, 0, 0, "XYZ"]);
  expect(visual.userData.jointAxis).toEqual([1, 0, 0]);
  expect(
    ["hinge-bracket-left", "hinge-bracket-right"].every((name) =>
      visual.getObjectByName(name),
    ),
  ).toBe(true);
  expect(visual.getObjectByName("hinge-rotating-mount")).toBeDefined();
  expect(
    (visual.getObjectByName("hinge-bracket-left") as THREE.Mesh).material,
  ).toMatchObject({ color: new THREE.Color(part.visual.color) });
});

it("Motorは短い円筒本体と外側へ出る出力軸を生成する", () => {
  const part = createPart("Motor");
  const visual = createPartVisual(part);
  const body = visual.getObjectByName("motor-body") as THREE.Mesh;
  const shaft = visual.getObjectByName("motor-output-shaft") as THREE.Mesh;
  const indicator = visual.getObjectByName("motor-rotation-indicator");

  expect(body.geometry).toBeInstanceOf(THREE.CylinderGeometry);
  expect(shaft.geometry).toBeInstanceOf(THREE.CylinderGeometry);
  expect(shaft.position.z).toBeGreaterThan(body.position.z);
  expect(visual.userData.outputAxis).toEqual([0, 0, 1]);
  expect(indicator?.visible).toBe(false);

  updateMotorActivity(visual, 1);
  expect(indicator?.visible).toBe(true);
  expect(
    (visual.getObjectByName("motor-rotation-ring") as THREE.Mesh).material,
  ).toMatchObject({ emissiveIntensity: expect.any(Number) });

  updateMotorActivity(visual, 0);
  expect(indicator?.visible).toBe(false);
});

it("Thrusterは+Z側の本体と-Z側へ広がるノズルを生成する", () => {
  const part = createPart("Thruster");
  const visual = createPartVisual(part);
  const body = visual.getObjectByName("thruster-body");
  const nozzle = visual.getObjectByName("thruster-nozzle") as THREE.Mesh;
  const rim = visual.getObjectByName("thruster-nozzle-rim");

  expect(body).toBeDefined();
  expect(nozzle).toBeDefined();
  expect(rim).toBeDefined();
  expect(nozzle.geometry).toBeInstanceOf(THREE.CylinderGeometry);
  expect(nozzle.position.z).toBeLessThan(0);
  expect(body!.position.z).toBeGreaterThan(nozzle.position.z);
  expect(
    (nozzle.geometry as THREE.CylinderGeometry).parameters.radiusBottom,
  ).toBeGreaterThan(
    (nozzle.geometry as THREE.CylinderGeometry).parameters.radiusTop,
  );
  expect(visual.getObjectByName("thruster-emitter")).toBeUndefined();
  expect(visual.getObjectByName("thruster-flame")?.visible).toBe(false);
  const idlePosition = visual.getObjectByName("thruster-flame")!.position.z;
  updateThrusterFlame(visual, 1);
  expect(visual.getObjectByName("thruster-flame")?.visible).toBe(true);
  expect(visual.getObjectByName("thruster-flame")!.position.z).toBeLessThan(
    idlePosition,
  );
  updateThrusterFlame(visual, 0);
  expect(visual.getObjectByName("thruster-flame")?.visible).toBe(false);
  const active = createPartVisual(part, { thrust: 1 });
  expect(active.getObjectByName("thruster-flame")?.visible).toBe(true);
  expect(active.getObjectByName("thruster-flame")!.position.z).toBeLessThan(
    nozzle.position.z,
  );
  expect(visual.userData.forceAxis).toEqual([0, 0, 1]);
  expect(visual.userData.exhaustAxis).toEqual([0, 0, -1]);
});

it("Ghostは通常Visualと同じ構成で全Meshを透過する", () => {
  const visual = createPartVisual(createPart("Thruster"), { ghost: true });
  const names = meshes(visual).map((mesh) => mesh.name);

  expect(names).toEqual([
    "thruster-body",
    "thruster-front-cap",
    "thruster-nozzle",
    "thruster-nozzle-rim",
    "thruster-flame",
    "thruster-flame-core",
  ]);
  for (const mesh of meshes(visual)) {
    const material = mesh.material as THREE.MeshStandardMaterial;
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeCloseTo(0.35);
    expect(material.depthWrite).toBe(false);
  }
});

it("全Part種をFactoryで生成できる", () => {
  for (const kind of [
    "Panel",
    "Block",
    "Wheel",
    "Motor",
    "Steering",
    "Hinge",
    "Thruster",
    "Wing",
  ] as const) {
    const visual = createPartVisual(createPart(kind));
    expect(visual.children.length).toBeGreaterThan(0);
  }
});
