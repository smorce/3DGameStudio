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
      e.assetSlot === "building.quality.house" ||
      e.assetSlot === "landscape.alpine-village.cabin-timber",
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
export const alpineSkyColors = {
  horizon: "#cfdfe6",
  middle: "#93bfdf",
  zenith: "#4f8dcb",
  sunGlow: "#fff0d2",
};
/** 地平の霞から天頂の青、太陽側の暖色までを頂点色へ焼き込む。毎フレームの計算はない。 */
export function alpineSkyDome(sunDirection: readonly number[], radius = 2200) {
  const geometry = new THREE.SphereGeometry(radius, 32, 16);
  const position = geometry.getAttribute("position");
  const horizon = new THREE.Color(alpineSkyColors.horizon),
    middle = new THREE.Color(alpineSkyColors.middle),
    zenith = new THREE.Color(alpineSkyColors.zenith),
    glow = new THREE.Color(alpineSkyColors.sunGlow);
  const sun = new THREE.Vector3(...sunDirection).normalize();
  const direction = new THREE.Vector3();
  const colors: number[] = [];
  for (let i = 0; i < position.count; i++) {
    direction.fromBufferAttribute(position, i).normalize();
    const elevation = Math.max(0, direction.y);
    const color =
      elevation < 0.14
        ? horizon.clone().lerp(middle, elevation / 0.14)
        : middle
            .clone()
            .lerp(zenith, Math.pow((elevation - 0.14) / 0.86, 0.65));
    const toward = Math.max(0, direction.dot(sun));
    color.lerp(glow, Math.pow(toward, 6) * 0.55 * (1 - elevation * 0.5));
    colors.push(...color.toArray());
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false,
      // PLAY開始時の霧晴れ演出で、編集画面の単色背景から空へ溶け込ませる。
      transparent: true,
      depthWrite: false,
    }),
  );
  mesh.name = "alpine-sky";
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
export function alpineClouds() {
  const group = new THREE.Group();
  group.name = "alpine-clouds";
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const colors: number[] = [];
  const normal = geometry.getAttribute("normal");
  const top = new THREE.Color("#fffdf6"),
    bottom = new THREE.Color("#c3cfd8");
  for (let i = 0; i < normal.count; i++) {
    const color = bottom.clone().lerp(top, (normal.getY(i) + 1) / 2);
    colors.push(...color.toArray());
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    fog: false,
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
  // 積雲の塊ごとに中心・広がり・高さを持ち、底を平らにして上へ盛り上げる。
  const clusters = [
    { x: -620, y: 330, z: -1350, spread: 90, size: 1.15 },
    { x: -150, y: 420, z: -1800, spread: 60, size: 0.9 },
    { x: 520, y: 360, z: -1150, spread: 120, size: 1.35 },
    { x: 980, y: 300, z: -1500, spread: 70, size: 1 },
    { x: 1350, y: 380, z: -400, spread: 110, size: 1.25 },
    { x: -1300, y: 350, z: -600, spread: 80, size: 1.05 },
    { x: 250, y: 470, z: 1400, spread: 100, size: 1.1 },
  ];
  const puffs = 12;
  const mesh = new THREE.InstancedMesh(
    geometry,
    material,
    clusters.length * puffs,
  );
  const object = new THREE.Object3D();
  for (let i = 0; i < clusters.length * puffs; i++) {
    const c = clusters[Math.floor(i / puffs)],
      puff = i % puffs,
      cluster = Math.floor(i / puffs);
    const centrality = 1 - Math.abs(puff / (puffs - 1) - 0.5) * 2;
    const cloudHeight =
      (16 + centrality * 30 + (Math.cos(puff * 7 + cluster) + 1) * 6) * c.size;
    object.position.set(
      c.x + (puff / (puffs - 1) - 0.5) * c.spread * 2.2,
      c.y + cloudHeight * 0.55 + Math.sin(puff * 7.1) * 3,
      c.z + Math.cos(puff * 4.3 + cluster) * 40,
    );
    object.scale.set(
      (26 + (Math.sin(puff * 12 + cluster) + 1) * 15) * c.size,
      cloudHeight,
      (24 + (Math.sin(puff * 9 + cluster) + 1) * 14) * c.size,
    );
    object.updateMatrix();
    mesh.setMatrixAt(i, object.matrix);
  }
  mesh.computeBoundingSphere();
  group.add(mesh);
  return group;
}
