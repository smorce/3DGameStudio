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
      (e.assetSlot?.startsWith("building.alpine-village.") &&
        !e.assetSlot.endsWith("barn")) ||
      e.assetSlot === "building.quality.house",
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
  const colors: number[] = [];
  const normal = geometry.getAttribute("normal");
  const top = new THREE.Color("#faf7ec"),
    bottom = new THREE.Color("#cfdae0");
  for (let i = 0; i < normal.count; i++) {
    const color = bottom.clone().lerp(top, (normal.getY(i) + 1) / 2);
    colors.push(...color.toArray());
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  // 輪郭を視線との角度で薄くし、重なりを保ちながら硬い球の縁を消す。
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      "varying vec3 cloudNormal;\nvarying vec3 cloudEye;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvec3 cloudScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));\ncloudNormal = normalize(normalMatrix * (normal / cloudScale));\ncloudEye = -(modelViewMatrix * instanceMatrix * vec4(position, 1.0)).xyz;",
      );
    shader.fragmentShader =
      "varying vec3 cloudNormal;\nvarying vec3 cloudEye;\n" +
      shader.fragmentShader.replace(
        "#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.a *= smoothstep(0.08, 0.65, abs(dot(normalize(cloudNormal), normalize(cloudEye))));",
      );
  };
  const mesh = new THREE.InstancedMesh(geometry, material, 40);
  const object = new THREE.Object3D();
  for (let i = 0; i < 40; i++) {
    const cluster = Math.floor(i / 10),
      puff = i % 10;
    const cloudHeight = 15 + (Math.cos(puff * 7 + cluster) + 1) * 14;
    object.position.set(
      [-480, -40, 620, 950][cluster] +
        Math.sin(puff * 8) * [45, 30, 85, 40][cluster],
      [390, 470, 420, 330][cluster] +
        cloudHeight * 0.65 +
        Math.sin(puff * 7.1) * 4,
      [-1400, -1900, -1100, -1600][cluster] + Math.cos(puff * 4.3) * 35,
    );
    object.scale.set(
      24 + (Math.sin(puff * 12 + cluster) + 1) * 17,
      cloudHeight,
      22 + (Math.sin(puff * 9 + cluster) + 1) * 16,
    );
    object.updateMatrix();
    mesh.setMatrixAt(i, object.matrix);
  }
  mesh.computeBoundingSphere();
  group.add(mesh);
  return group;
}
