import { expect, it } from "vitest";
import * as THREE from "three";
import {
  builtinEntityDefinition,
  worldColliderPose,
  worldCollidersForEntity,
} from "../../packages/world-system/src/entities";
import {
  builtinTemplate,
  disposeTemplate,
} from "../../packages/renderer-three/src/instances";

it("treeの描画寸法とCollider寸法は同じ定義から作られる", () => {
  const definition = builtinEntityDefinition("tree");
  const trunk = definition.visual[0];
  const collider = definition.colliders[0];
  expect(trunk.shape).toBe("cylinder");
  expect(collider.type).toBe("cylinder");
  if (trunk.shape !== "cylinder" || collider.type !== "cylinder") return;
  expect(collider.radius).toBeCloseTo(0.2);
  expect(collider.halfHeight * 2).toBeCloseTo(trunk.height);
  expect(collider.localPosition).toEqual(trunk.localPosition);
  const template = builtinTemplate("tree");
  const mesh = template.children[0] as THREE.Mesh;
  const size = new THREE.Box3()
    .setFromObject(mesh)
    .getSize(new THREE.Vector3());
  expect(size.y).toBeCloseTo(trunk.height, 5);
  disposeTemplate(template);
});

it("buildingの本体Colliderは見た目の2x2.6x2と一致する", () => {
  const definition = builtinEntityDefinition("building");
  const body = definition.visual[0];
  const collider = definition.colliders[0];
  expect(body.shape).toBe("box");
  expect(collider.type).toBe("cuboid");
  if (body.shape !== "box" || collider.type !== "cuboid") return;
  expect(collider.halfExtents.map((n) => n * 2)).toEqual(body.size);
  expect(collider.localPosition).toEqual(body.localPosition);
});

it("rockのBall ColliderはIcosahedron半径と中心を共有する", () => {
  const definition = builtinEntityDefinition("rock");
  const visual = definition.visual[0];
  const collider = definition.colliders[0];
  expect(visual.shape).toBe("icosahedron");
  expect(collider.type).toBe("ball");
  if (visual.shape !== "icosahedron" || collider.type !== "ball") return;
  expect(collider.radius).toBe(visual.radius);
  expect(collider.localPosition).toEqual(visual.localPosition);
});

it("entity.transformのtranslation/rotation/scaleをColliderへ適用する", () => {
  const yaw = Math.PI / 2;
  const transform = {
    position: [10, 2, -4] as [number, number, number],
    rotation: [0, yaw, 0] as [number, number, number],
    scale: [2, 3, 2] as [number, number, number],
  };
  const tree = worldCollidersForEntity("tree", transform)[0];
  expect(tree.type).toBe("cylinder");
  if (tree.type !== "cylinder") return;
  expect(tree.radius).toBeCloseTo(0.4);
  expect(tree.halfHeight).toBeCloseTo(2.25);
  expect(tree.translation[0]).toBeCloseTo(10);
  expect(tree.translation[1]).toBeCloseTo(2 + 0.75 * 3);
  expect(tree.translation[2]).toBeCloseTo(-4);

  const building = worldColliderPose(
    builtinEntityDefinition("building").colliders[0],
    transform,
  );
  expect(building.type).toBe("cuboid");
  if (building.type !== "cuboid") return;
  expect(building.halfExtents[0]).toBeCloseTo(2);
  expect(building.halfExtents[1]).toBeCloseTo(3.9);
  expect(building.halfExtents[2]).toBeCloseTo(2);
  expect(building.translation[0]).toBeCloseTo(10);
  expect(building.translation[1]).toBeCloseTo(2 + 1.3 * 3);

  const rotated = worldCollidersForEntity("building", {
    position: [0, 0, 0],
    rotation: [0, Math.PI / 2, 0],
    scale: [1, 1, 1],
  })[0];
  expect(rotated.rotation[1]).not.toBeCloseTo(0);
});
