import * as THREE from "three";
import type { Vec3 } from "../../project-schema/src/index";
import type { GeneratedEntity } from "../../world-generator/src/types";

/** Chunkを親に持つ煙は親のRebase・解放に追従し、物理には関与しない。 */
export function alpineChimneySmoke(
  entities: GeneratedEntity[],
  chunkOrigin: Vec3,
) {
  const houses = entities.filter(
    (e) =>
      e.assetSlot?.startsWith("building.alpine-village.") &&
      !e.assetSlot.endsWith("barn"),
  );
  if (!houses.length) return undefined;
  const mesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.8, 1),
    new THREE.MeshBasicMaterial({
      color: "#e5e7df",
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    }),
    houses.length * 6,
  );
  const object = new THREE.Object3D();
  mesh.frustumCulled = false;
  const tick = (time: number) => {
    houses.forEach((house, i) => {
      const [x, y, z] = house.position,
        s = house.scale[0],
        angle = house.rotation[1];
      for (let j = 0; j < 6; j++) {
        const phase = (time * 0.16 + j / 6 + i * 0.17) % 1;
        object.position.set(
          x - chunkOrigin[0] + Math.cos(angle) * 1.8 * s + phase * 4,
          y - chunkOrigin[1] + 7.8 * s + phase * 6,
          z - chunkOrigin[2] - Math.sin(angle) * 1.8 * s,
        );
        object.scale.setScalar((0.4 + phase * 1.2) * Math.sin(phase * Math.PI));
        object.updateMatrix();
        mesh.setMatrixAt(i * 6 + j, object.matrix);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  tick(0);
  mesh.userData.alpineTick = tick;
  return mesh;
}
export function alpineClouds() {
  const group = new THREE.Group();
  group.name = "alpine-clouds";
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const material = new THREE.MeshBasicMaterial({ color: "#f3f3eb" });
  const mesh = new THREE.InstancedMesh(geometry, material, 60);
  const object = new THREE.Object3D();
  for (let i = 0; i < 60; i++) {
    const cluster = Math.floor(i / 6),
      puff = i % 6;
    object.position.set(
      -1000 + cluster * 220 + Math.sin(puff * 8) * 45,
      240 + (cluster % 3) * 30 + Math.cos(puff) * 16,
      -1000 + (cluster % 4) * 170,
    );
    object.scale.set(
      45 + (puff % 3) * 10,
      17 + (puff % 2) * 12,
      30 + (puff % 3) * 8,
    );
    object.updateMatrix();
    mesh.setMatrixAt(i, object.matrix);
  }
  mesh.computeBoundingSphere();
  group.add(mesh);
  return group;
}
