import { expect, it } from "vitest";
import * as THREE from "three";
import {
  commitAttachment,
  createMachine,
  createPart,
  findAttachmentCandidates,
} from "../../packages/machine-system/src/index";
import { emptyProject } from "../../packages/project-schema/src/index";
import {
  createPartVisual,
  syncPartVisualTransforms,
} from "../../packages/renderer-three/src/index";

it("編集Pose同期はVisualのTransformをProjectへ戻し、Projectを書き換えない", () => {
  const project = emptyProject(),
    machine = createMachine(),
    part = createPart("Panel");
  part.transform = {
    position: [3, 2, -4],
    rotation: [0.2, -0.3, 0.4],
    scale: [1.2, 0.8, 1.4],
  };
  machine.parts.push(part);
  project.machines.push(machine);
  const before = structuredClone(project);
  const visual = new THREE.Group();
  visual.position.set(-20, 7, 11);
  visual.rotation.set(-0.5, 0.6, -0.7);
  visual.scale.set(4, 5, 6);

  syncPartVisualTransforms(new Map([[part.id, visual]]), project);

  expect(visual.position.toArray()).toEqual(part.transform.position);
  expect(visual.rotation.toArray()).toEqual([
    ...part.transform.rotation,
    "XYZ",
  ]);
  expect(visual.scale.toArray()).toEqual(part.transform.scale);
  expect(project).toEqual(before);
});

it("編集時のSuspension VisualとWheel中心をAttachmentで揃える", () => {
  const project = emptyProject(),
    machine = createMachine(),
    panel = createPart("Panel");
  machine.parts.push(panel);
  const suspensionCandidate = findAttachmentCandidates(
    machine,
    "Suspension",
  )[0]!;
  const suspension = createPart("Suspension");
  commitAttachment(machine, suspension, suspensionCandidate);
  const wheelCandidate = findAttachmentCandidates(machine, "Wheel").find(
    (candidate) =>
      candidate.parentPartId === suspension.id &&
      candidate.parentConnectorId === "suspension-wheel",
  )!;
  const wheel = createPart("Wheel");
  commitAttachment(machine, wheel, wheelCandidate);
  project.machines.push(machine);
  const suspensionVisual = createPartVisual(suspension),
    wheelVisual = createPartVisual(wheel);
  syncPartVisualTransforms(
    new Map([
      [suspension.id, suspensionVisual],
      [wheel.id, wheelVisual],
    ]),
    project,
  );
  expect(suspensionVisual.position.toArray()).toEqual(
    suspension.transform.position,
  );
  expect(wheelVisual.position.y).toBeCloseTo(wheel.transform.position[1]);
});
