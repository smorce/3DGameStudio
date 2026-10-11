import * as THREE from "three";
import { grassGround } from "./grass-ground";
import { vegetationPlacements } from "../../world-generator/src/vegetation";
export { vegetationArea } from "../../world-generator/src/vegetation";

/** 曲がった草葉を三角形で描く。透明面の重なりと草のShadow Passを避ける。 */
export function grassGeometry(blades: number, broad = false) {
  const positions: number[] = [],
    colors: number[] = [];
  for (let i = 0; i < blades; i++) {
    const a = i * 2.4,
      x = Math.cos(a) * (0.32 + (i % 3) * 0.06),
      z = Math.sin(a) * (0.32 + (i % 3) * 0.06);
    const h = 0.35 + (i % 4) * 0.11,
      w = (0.026 + (i % 3) * 0.006) * (broad ? 2.8 : 1);
    const wx = Math.cos(a + Math.PI / 2) * w,
      wz = Math.sin(a + Math.PI / 2) * w;
    const left = [x - wx, 0, z - wz],
      right = [x + wx, 0, z + wz];
    const middleLeft = [
      x + Math.cos(a) * 0.16 - wx * 0.32,
      h * 0.74,
      z + Math.sin(a) * 0.16 - wz * 0.32,
    ];
    const middleRight = [
      x + Math.cos(a) * 0.16 + wx * 0.32,
      h * 0.74,
      z + Math.sin(a) * 0.16 + wz * 0.32,
    ];
    const points = [
      left,
      right,
      middleRight,
      left,
      middleRight,
      middleLeft,
      middleLeft,
      middleRight,
      [
        x + Math.cos(a) * (0.21 + (i % 3) * 0.055),
        h,
        z + Math.sin(a) * (0.21 + (i % 3) * 0.055),
      ],
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

/** 全Chunkで同じ草形状と材質を共有し、最後のChunk解放時に破棄する。 */
let sharedVegetationResources:
  | {
      geometries: THREE.BufferGeometry[];
      material: THREE.MeshStandardMaterial;
      windMaterial: THREE.MeshStandardMaterial;
      references: number;
    }
  | undefined;
function acquireVegetationResources() {
  if (!sharedVegetationResources) {
    const windMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      side: THREE.DoubleSide,
    });
    // 位相に絶対座標とSeedで決まった回転を使い、Rebaseで変えない。
    windMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.grassTime = {
        get value() {
          return performance.now() / 1000;
        },
      };
      shader.vertexShader =
        "uniform float grassTime;\n" +
        shader.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float grassPhase = atan(instanceMatrix[0].z, instanceMatrix[0].x);
          float grassBend = sin(grassTime * 1.7 + grassPhase) * position.y * position.y * 0.12;
          transformed.x += grassBend;
          transformed.z += grassBend * 0.5;
        #endif`,
        );
    };
    windMaterial.customProgramCacheKey = () => "grass-wind-v1";
    sharedVegetationResources = {
      geometries: [
        grassGeometry(8),
        grassGeometry(3),
        grassGeometry(8, true),
        grassGeometry(3, true),
      ],
      material: new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 1,
        side: THREE.DoubleSide,
      }),
      windMaterial,
      references: 0,
    };
  }
  sharedVegetationResources.references++;
  return sharedVegetationResources;
}

/** Chunkが所有する草。親Chunkの移動に従うのでRebase仕様を変更しない。 */
export function createVegetationChunk(
  options: Parameters<typeof vegetationPlacements>[0] & {
    originX: number;
    originZ: number;
    groundMaterial?: THREE.MeshStandardMaterial;
  },
) {
  const group = new THREE.Group();
  group.userData.environmentCategory = "grass";
  const placements = vegetationPlacements(options);
  const ground = options.groundMaterial
    ? grassGround(options.groundMaterial, options)
    : undefined;
  const resources = acquireVegetationResources();
  const { material, geometries } = resources;
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
  let mode: "A0" | "A1" | "A2" = "A0";
  group.userData.setGrassMode = (next: "A0" | "A1" | "A2") => {
    if (mode === next) return;
    mode = next;
    ground?.setActive(mode === "A1");
    for (const mesh of meshes) {
      mesh.geometry = geometries[mesh.userData.level + (mode === "A2" ? 2 : 0)];
      mesh.material = mode === "A2" ? resources.windMaterial : material;
      mesh.boundingSphere!.radius =
        mesh.userData.baselineRadius + (mode === "A2" ? 0.35 : 0);
    }
  };
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
        p.scale * (p.kind === 4 ? 1.55 : 1.15),
        p.scale * [0.5, 1.15, 0.7, 0.75, 1.15][p.kind],
        p.scale * (p.kind === 4 ? 1.55 : 1.15),
      );
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.set(colors[p.kind]));
    });
    mesh.computeBoundingSphere();
    // 幅広葉と風の最大変位もカリング範囲に含める。
    mesh.userData.baselineRadius = mesh.boundingSphere!.radius;

    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.center = mesh.boundingSphere!.center.clone();
    mesh.userData.level = 0;
    meshes.push(mesh);
    group.add(mesh);
  }
  const world = new THREE.Vector3();
  const frustum = new THREE.Frustum(),
    projection = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  group.userData.updateVegetation = (
    camera: THREE.PerspectiveCamera,
    viewportHeight: number,
  ) => {
    group.updateWorldMatrix(true, false);
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(
      projection.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      ),
    );
    for (const mesh of meshes) {
      sphere.copy(mesh.boundingSphere!).applyMatrix4(group.matrixWorld);
      if (!frustum.intersectsSphere(sphere)) {
        mesh.visible = false;
        continue;
      }
      world.copy(mesh.userData.center);
      group.localToWorld(world);
      // 0.5mの草丈が画面で何pxかを用い、解像度/FOVにも追従させる。
      const pixels =
        (0.5 * viewportHeight) /
        (2 *
          Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) *
          Math.max(1, camera.position.distanceTo(world)));
      const level = mesh.userData.level as number;
      mesh.visible = pixels > (mesh.visible ? 6.5 : 7.5);
      if (mode === "A1")
        mesh.visible &&=
          camera.position.distanceTo(world) <
          (mesh.userData.nearVisible ? 30 : 26);
      mesh.userData.nearVisible = mesh.visible;
      const next = pixels > (level === 0 ? 12 : 14) ? 0 : 1;
      if (level !== next) {
        mesh.geometry = geometries[next + (mode === "A2" ? 2 : 0)];
        mesh.userData.level = next;
      }
    }
  };
  let released = false;
  group.userData.release = () => {
    if (released) return;
    released = true;
    ground?.release();
    resources.references--;
    if (resources.references === 0) {
      geometries.forEach((g) => g.dispose());
      material.dispose();
      resources.windMaterial.dispose();
      sharedVegetationResources = undefined;
    }
  };
  return group;
}
