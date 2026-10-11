import { describe, expect, it, vi } from "vitest";
import { InstancedMesh, PerspectiveCamera } from "three";
import {
  createVegetationChunk,
  grassGeometry,
} from "../../packages/renderer-three/src/vegetation";

const options = {
  seed: 23,
  area: { minX: -16, minZ: -16, maxX: 16, maxZ: 16 },
  bounds: { minX: -16, minZ: -16, maxX: 16, maxZ: 16 },
  originX: -16,
  originZ: -16,
  height: () => 0,
  allowed: () => true,
};

describe("プロシージャル草の比較", () => {
  it("A2は頂点数・草丈を維持して葉幅を広げる", () => {
    const old = grassGeometry(8);
    const broad = grassGeometry(8, true);
    expect(broad.getAttribute("position").count).toBe(
      old.getAttribute("position").count,
    );
    old.computeBoundingBox();
    broad.computeBoundingBox();
    expect(broad.boundingBox!.max.y).toBe(old.boundingBox!.max.y);
    expect(Array.from(broad.getAttribute("position").array)).not.toEqual(
      Array.from(old.getAttribute("position").array),
    );
    old.dispose();
    broad.dispose();
  });

  it("切り替え・Rebase・LODで配置と共有材質を維持し、最後に解放する", () => {
    const a = createVegetationChunk(options);
    const b = createVegetationChunk(options);
    const meshA = a.children[0] as InstancedMesh;
    const meshB = b.children[0] as InstancedMesh;
    const baseline = meshA.geometry;
    const matrices = Array.from(meshA.instanceMatrix.array);
    a.userData.setGrassMode("A2");
    b.userData.setGrassMode("A2");
    const broad = meshA.geometry;
    expect(broad).not.toBe(baseline);
    expect(meshB.geometry).toBe(broad);
    expect(meshA.material).toBe(meshB.material);
    const dispose = vi.spyOn(broad, "dispose");
    a.position.set(-10000, 0, 10000);
    const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(-9984, 1, 10016);
    camera.lookAt(-9984, 0, 10000);
    a.userData.updateVegetation(camera, 1000);
    expect(Array.from(meshA.instanceMatrix.array)).toEqual(matrices);
    a.userData.setGrassMode("A0");
    expect(meshA.geometry).toBe(baseline);
    a.userData.release();
    expect(dispose).not.toHaveBeenCalled();
    b.userData.release();
    b.userData.release();
    expect(dispose).toHaveBeenCalledTimes(1);
    for (const group of [a, b])
      for (const mesh of group.children) (mesh as InstancedMesh).dispose();
  });
});

it("A1の地表マスクは除外条件を維持し、切り替えで旧シェーダーへ戻る", async () => {
  const { grassGround } =
    await import("../../packages/renderer-three/src/grass-ground");
  const { MeshStandardMaterial } = await import("three");
  const material = new MeshStandardMaterial();
  const original = material.onBeforeCompile;
  const ground = grassGround(material, { ...options, allowed: () => false });
  ground.setActive(true);
  const shader = {
    uniforms: {},
    vertexShader: "#include <begin_vertex>",
    fragmentShader: "#include <opaque_fragment>",
  } as Parameters<typeof material.onBeforeCompile>[0];
  material.onBeforeCompile(
    shader,
    {} as Parameters<typeof material.onBeforeCompile>[1],
  );
  const texture = shader.uniforms.grassCoverage.value;
  expect(
    texture.image.data
      .filter((_: number, i: number) => i % 4 === 0)
      .every((v: number) => v === 0),
  ).toBe(true);
  const dispose = vi.spyOn(texture, "dispose");
  ground.setActive(false);
  expect(material.onBeforeCompile).toBe(original);
  ground.setActive(true);
  ground.release();
  ground.release();
  expect(dispose).toHaveBeenCalledTimes(1);
  material.dispose();
});

it("異なるChunkも同じプログラムを共有し、原点とSeedは独立Uniformで渡す", async () => {
  const { grassGround } =
    await import("../../packages/renderer-three/src/grass-ground");
  const { MeshStandardMaterial } = await import("three");
  const materials = [new MeshStandardMaterial(), new MeshStandardMaterial()];
  const grounds = materials.map((material, i) =>
    grassGround(material, {
      ...options,
      originX: options.originX + i * 32,
      seed: options.seed + i,
      allowed: () => false,
    }),
  );
  const shaders = materials.map((material, i) => {
    grounds[i].setActive(true);
    const shader = {
      uniforms: {},
      vertexShader: "#include <begin_vertex>",
      fragmentShader: "#include <opaque_fragment>",
    } as Parameters<typeof material.onBeforeCompile>[0];
    material.onBeforeCompile(
      shader,
      {} as Parameters<typeof material.onBeforeCompile>[1],
    );
    return shader;
  });
  expect(materials[0].customProgramCacheKey()).toBe(
    materials[1].customProgramCacheKey(),
  );
  expect(shaders[0].vertexShader).toBe(shaders[1].vertexShader);
  expect(shaders[0].fragmentShader).toBe(shaders[1].fragmentShader);
  expect(shaders[0].uniforms.grassGroundOrigin.value).not.toEqual(
    shaders[1].uniforms.grassGroundOrigin.value,
  );
  expect(shaders[0].uniforms.grassGroundSeed.value).not.toBe(
    shaders[1].uniforms.grassGroundSeed.value,
  );
  grounds.forEach((ground) => ground.release());
  materials.forEach((material) => material.dispose());
});
