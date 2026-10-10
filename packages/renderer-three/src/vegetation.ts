import * as THREE from "three";
import { vegetationPlacements } from "../../world-generator/src/vegetation";
export { vegetationArea } from "../../world-generator/src/vegetation";

/** 曲がった草葉を三角形で描く。透明面の重なりと草のShadow Passを避ける。 */
export function grassGeometry(blades: number) {
  const positions: number[] = [],
    colors: number[] = [];
  for (let i = 0; i < blades; i++) {
    const a = i * 2.4,
      x = Math.cos(a) * 0.23,
      z = Math.sin(a) * 0.23;
    const h = 0.35 + (i % 4) * 0.11,
      w = 0.04;
    const points = [
      [x - w, 0, z],
      [x + w, 0, z],
      [x + Math.cos(a) * 0.16 + w * 0.4, h * 0.65, z + Math.sin(a) * 0.16],
      [x - w, 0, z],
      [x + Math.cos(a) * 0.16 + w * 0.4, h * 0.65, z + Math.sin(a) * 0.16],
      [x + Math.cos(a) * 0.16 - w * 0.4, h * 0.65, z + Math.sin(a) * 0.16],
      [x + Math.cos(a) * 0.16 - w * 0.4, h * 0.65, z + Math.sin(a) * 0.16],
      [x + Math.cos(a) * 0.16 + w * 0.4, h * 0.65, z + Math.sin(a) * 0.16],
      [x + Math.cos(a) * 0.27, h, z + Math.sin(a) * 0.27],
    ];
    for (const p of points) {
      positions.push(...p);
      const t = p[1] / h;
      colors.push(0.35 + t * 0.65, 0.45 + t * 0.55, 0.3 + t * 0.7);
    }
    if (i === 0) {
      // 小さな野草の花。種類ごとのインスタンス色で枯れ草と区別する。
      positions.push(x - 0.045, h, z, x + 0.045, h, z, x, h + 0.08, z);
      colors.push(1, 1, 0.75, 1, 1, 0.75, 1, 1, 0.75);
    }
  }
  const g = new THREE.BufferGeometry()
    .setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
    .setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/** Chunkが所有する草。親Chunkの移動に従うのでRebase仕様を変更しない。 */
export function createVegetationChunk(
  options: Parameters<typeof vegetationPlacements>[0] & {
    originX: number;
    originZ: number;
  },
) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    side: THREE.DoubleSide,
  });
  const geometries = [grassGeometry(10), grassGeometry(3)];
  const placements = vegetationPlacements(options);
  const patches = new Map<string, typeof placements>();
  for (const p of placements) {
    const key = `${Math.floor(p.position[0] / 16)},${Math.floor(p.position[2] / 16)}`;
    const list = patches.get(key) ?? [];
    list.push(p);
    patches.set(key, list);
  }
  const dummy = new THREE.Object3D(),
    color = new THREE.Color();
  const colors = ["#8caa48", "#6d9237", "#b6a164", "#9bab65", "#789946"];
  const meshes: THREE.InstancedMesh[] = [];
  for (const list of patches.values()) {
    const mesh = new THREE.InstancedMesh(geometries[0], material, list.length);
    mesh.userData.shared = true;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    list.forEach((p, i) => {
      dummy.position.set(
        p.position[0] - options.originX,
        p.position[1] - 0.035,
        p.position[2] - options.originZ,
      );
      dummy.rotation.set(0, p.yaw, 0);
      dummy.scale.set(
        p.scale,
        p.scale * [0.55, 1.3, 0.85, 0.8, 1.1][p.kind],
        p.scale,
      );
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.set(colors[p.kind]));
    });
    mesh.computeBoundingSphere();
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.center = mesh.boundingSphere!.center.clone();
    mesh.userData.level = 0;
    meshes.push(mesh);
    group.add(mesh);
  }
  const world = new THREE.Vector3();
  group.userData.updateVegetation = (
    camera: THREE.PerspectiveCamera,
    viewportHeight: number,
  ) => {
    for (const mesh of meshes) {
      world.copy(mesh.userData.center);
      group.localToWorld(world);
      // 0.5mの草丈が画面で何pxかを用い、解像度/FOVにも追従させる。
      const pixels =
        (0.5 * viewportHeight) /
        (2 *
          Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) *
          Math.max(1, camera.position.distanceTo(world)));
      const level = mesh.userData.level as number;
      mesh.visible = pixels > (mesh.visible ? 4.5 : 5.5);
      const next = pixels > (level === 0 ? 9 : 11) ? 0 : 1;
      if (level !== next) {
        mesh.geometry = geometries[next];
        mesh.userData.level = next;
      }
    }
  };
  let released = false;
  group.userData.release = () => {
    if (released) return;
    released = true;
    geometries.forEach((g) => g.dispose());
    material.dispose();
  };
  return group;
}
