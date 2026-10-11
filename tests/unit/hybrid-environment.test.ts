import { describe, expect, it, vi } from "vitest";
import { NodeIO } from "@gltf-transform/core";
import { getBounds } from "@gltf-transform/functions";
import * as THREE from "three";
import { environmentModelGlb } from "../../packages/ai-dummy/src/environment-models";
import {
  treeRules,
  houseRules,
} from "../../packages/ai-dummy/src/environment-rules";
import { generatedSurfacePixels } from "../../packages/ai-dummy/src/environment-materials";
import { createVegetationChunk } from "../../packages/renderer-three/src/vegetation";
import { grassGround } from "../../packages/renderer-three/src/grass-ground";
import { configureBuildingMaterial } from "../../packages/renderer-three/src/environment-material";
import {
  AssetTemplates,
  EnvironmentTexturePool,
  disposeTemplate,
} from "../../packages/renderer-three/src/instances";
import { assetMetadataHash } from "../../packages/asset-catalog/src/index";
import { emptyProject } from "../../packages/project-schema/src/index";
import { AssetCatalog } from "../../packages/asset-catalog/src/index";
import { AssetFactory } from "../../packages/asset-factory/src/index";
import { DummyAstraAssetGenerator } from "../../packages/ai-dummy/src/asset-generator";
import { LocalAssetStorage } from "../../packages/storage/src/local";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const bounds = { minX: -128, minZ: -128, maxX: 128, maxZ: 128 };
const options = {
  bounds,
  area: bounds,
  seed: 42,
  originX: -128,
  originZ: -128,
  height: () => 0,
  allowed: () => true,
};
const count = (group: THREE.Group) =>
  group.children.reduce(
    (n, mesh) => n + (mesh as THREE.InstancedMesh).count,
    0,
  );
describe("環境生成と所有リソース", () => {
  for (const kind of ["oak", "pine"] as const)
    it(`${kind}はSeed再現性とLOD樹冠の包絡を保つ`, async () => {
      const bytes = await environmentModelGlb(kind, 42);
      expect(await environmentModelGlb(kind, 42)).toEqual(bytes);
      const envelopes = [];
      for (const level of [0, 1, 2]) {
        const doc = await new NodeIO().readBinary(
          await environmentModelGlb(kind, 42, level),
        );
        const leaf = doc
          .getRoot()
          .listMeshes()
          .flatMap((m) => m.listPrimitives())
          .filter((p) => p.getMaterial()?.getName() !== "bark");
        const box = new THREE.Box3();
        for (const primitive of leaf) {
          const pos = primitive.getAttribute("POSITION")!;
          for (let i = 0; i < pos.getCount(); i++) {
            const rgb = primitive.getAttribute("COLOR_0")?.getElement(i, []);
            if (rgb && rgb[1] < rgb[0]) continue;
            box.expandByPoint(
              new THREE.Vector3(
                ...(pos.getElement(i, [0, 0, 0]) as [number, number, number]),
              ),
            );
          }
        }
        // 遠景の幹は葉と同じPrimitiveなので、樹冠上端・幅を比較する。
        envelopes.push(box);
        expect(
          doc.getRoot().listScenes()[0].getExtras().environmentRules,
        ).toEqual(treeRules(kind, 42));
      }
      for (const box of envelopes.slice(1))
        for (const axis of ["x", "z"] as const) {
          expect(box.min[axis]).toBeCloseTo(envelopes[0].min[axis], 4);
          expect(box.max[axis]).toBeCloseTo(envelopes[0].max[axis], 4);
        }
      expect(envelopes[2].max.y).toBeCloseTo(envelopes[0].max.y, 4);
    });
  it("建築設定を全LODへ保存し、張り出しと屋根勾配を変更できる", async () => {
    const rules = {
      ...houseRules(42),
      upperFloorOverhang: 0.7,
      roofPitch: 40,
      floors: 3,
    };
    const boxes = [];
    for (const level of [0, 1, 2]) {
      const doc = await new NodeIO().readBinary(
        await environmentModelGlb("house", 42, level, rules),
      );
      boxes.push(getBounds(doc.getRoot().listScenes()[0]));
      expect(
        doc.getRoot().listScenes()[0].getExtras().environmentRules,
      ).toEqual(rules);
    }
    expect(boxes[1]).toEqual(boxes[0]);
    expect(boxes[2]).toEqual(boxes[0]);
    expect(boxes[0].max[1]).toBeGreaterThan(10);
  });
  it("A3は近傍のbufferだけを持ち、Rebaseとモード復帰で同じ配置になる", () => {
    const group = createVegetationChunk({ ...options, initialMode: "A3" });
    expect(count(group)).toBe(0);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(128, 3, 128);
    camera.lookAt(128, 0, 100);
    group.userData.updateVegetation(camera, 771);
    const matrices = group.children.map((m) =>
      Array.from((m as THREE.InstancedMesh).instanceMatrix.array),
    );
    const near = count(group);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(5000);
    group.position.set(-1000000, 0, 1000000);
    camera.position.add(group.position);
    group.userData.updateVegetation(camera, 771);
    expect(
      group.children.map((m) =>
        Array.from((m as THREE.InstancedMesh).instanceMatrix.array),
      ),
    ).toEqual(matrices);
    group.userData.setGrassMode("A0");
    expect(count(group)).toBeGreaterThan(30000);
    group.userData.setGrassMode("A3");
    group.userData.updateVegetation(camera, 771);
    expect(count(group)).toBe(near);
    group.userData.release();
    group.userData.release();
    expect(group.children).toHaveLength(0);
  });
  for (const origin of [-256, 0, 1000000000])
    it(`地表マスク端は絶対座標${origin}で一致し、無効化時に破棄する`, () => {
      const materials = [
        new THREE.MeshStandardMaterial(),
        new THREE.MeshStandardMaterial(),
      ];
      const grounds = materials.map((material, i) =>
        grassGround(material, {
          ...options,
          area: { minX: -2e9, minZ: -2e9, maxX: 2e9, maxZ: 2e9 },
          bounds: {
            minX: origin + i * 128,
            minZ: -128,
            maxX: origin + (i + 1) * 128,
            maxZ: 0,
          },
          originX: origin + i * 128,
          roadDistance: () => 10,
        }),
      );
      grounds.forEach((g) => g.setActive(true));
      const a = materials[0].userData.grassCoverageTexture as THREE.DataTexture,
        b = materials[1].userData.grassCoverageTexture as THREE.DataTexture;
      for (let z = 0; z < 130; z++) {
        expect(a.image.data[(z * 130 + 128) * 4]).toBe(
          b.image.data[z * 130 * 4],
        );
        expect(a.image.data[(z * 130 + 129) * 4]).toBe(
          b.image.data[(z * 130 + 1) * 4],
        );
      }
      const disposed = vi.spyOn(a, "dispose");
      grounds[0].setActive(false);
      expect(disposed).toHaveBeenCalledTimes(1);
      expect(materials[0].userData.grassCoverageTexture).toBeUndefined();
      grounds.forEach((g) => g.release());
      materials.forEach((m) => m.dispose());
    });
  it("C1はSeed再現性があり、C0/C1/C2切替の再コンパイルを繰り返さない", () => {
    expect(generatedSurfacePixels("wood", 42)).toEqual(
      generatedSurfacePixels("wood", 42),
    );
    expect(generatedSurfacePixels("wood", 43)).not.toEqual(
      generatedSurfacePixels("wood", 42),
    );
    const baseline = new THREE.Texture(),
      generated = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: baseline });
    material.name = "wood";
    configureBuildingMaterial(material, generated);
    material.userData.setBuildingMaterialMode("C1");
    expect(material.map).toBe(generated);
    const version = material.version;
    material.userData.setBuildingMaterialMode("C1");
    expect(material.version).toBe(version);
    material.userData.setBuildingMaterialMode("C2");
    expect(material.map).toBe(baseline);
    material.userData.setBuildingMaterialMode("C0");
    expect(material.map).toBe(baseline);
    material.dispose();
    baseline.dispose();
    generated.dispose();
  });
  it("共有C1画像は最後のTemplate解放まで破棄しない", () => {
    const pool = new EnvironmentTexturePool();
    const make = () => {
      const g = new THREE.Group();
      g.userData.environmentRecipeVersion = 3;
      const texture = new THREE.Texture();
      texture.name = "wood-generated-v4";
      const material = new THREE.MeshStandardMaterial();
      material.userData.generatedMap = texture;
      g.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
      return g;
    };
    const a = make(),
      b = make();
    pool.acquire(a);
    pool.acquire(b);
    const ta = (a.children[0] as THREE.Mesh).material as THREE.Material,
      tb = (b.children[0] as THREE.Mesh).material as THREE.Material;
    expect(ta.userData.generatedMap).toBe(tb.userData.generatedMap);
    const disposed = vi.spyOn(ta.userData.generatedMap, "dispose");
    disposeTemplate(a, pool.release(a));
    expect(disposed).not.toHaveBeenCalled();
    disposeTemplate(b, pool.release(b));
    expect(disposed).toHaveBeenCalledTimes(1);
  });
  it("未完了のTemplateを中断しても、完了後に一度だけ破棄する", async () => {
    const cache = new AssetTemplates();
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial(),
    );
    group.add(mesh);
    const disposed = vi.spyOn(mesh.geometry, "dispose");
    let finish!: (g: THREE.Group) => void;
    const entry = cache.acquire(
      "pending",
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    entry.release();
    entry.release();
    finish(group);
    await entry.promise;
    await Promise.resolve();
    expect(disposed).toHaveBeenCalledTimes(1);
  });
  it("古い生成版をFactoryで再利用せず、Catalog指紋は生成規則とLOD変更を検知する", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hybrid-factory-"));
    try {
      const project = emptyProject(),
        factory = new AssetFactory(
          new AssetCatalog(project),
          new LocalAssetStorage(root),
          [],
          new DummyAstraAssetGenerator(true),
        );
      const plan = {
        planner: "test",
        requirements: [
          {
            assetSlot: "nature.tree.quality.oak",
            minVariants: 1,
            biomes: [],
            style: "stylized-low-poly",
          },
        ],
      };
      expect((await factory.fulfill(plan, "offline")).errors).toEqual([]);
      const a = project.assets[0],
        before = assetMetadataHash(a);
      a.catalog!.generation!.version = 3;
      expect(assetMetadataHash(a)).not.toBe(before);
      expect((await factory.fulfill(plan, "offline")).registered).toHaveLength(
        1,
      );
      const fresh = project.assets[1],
        hash = assetMetadataHash(fresh);
      fresh.runtimeInfo!.lods![0].distance = 99;
      expect(assetMetadataHash(fresh)).not.toBe(hash);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);
});

it("影の4方式と専用LODは切替・Rebase・取消後に所有リソースを解放する", async () => {
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const { WorldAssetBatch } =
    await import("../../packages/renderer-three/src/instances");
  const { readFile } = await import("node:fs/promises");
  const project = JSON.parse(
    await readFile("demos/worlds/alpine-village.json", "utf8"),
  );
  const asset = project.assets.find((a: { catalog: { slots: string[] } }) =>
    a.catalog.slots.includes("nature.tree.quality.oak"),
  );
  const disposeSpies: ReturnType<typeof vi.spyOn>[] = [];
  const loader = vi
    .spyOn(GLTFLoader.prototype, "loadAsync")
    .mockImplementation(async () => {
      const scene = new THREE.Group(),
        geometry = new THREE.BoxGeometry(),
        material = new THREE.MeshStandardMaterial();
      disposeSpies.push(vi.spyOn(geometry, "dispose"));
      scene.add(new THREE.Mesh(geometry, material));
      return { scene } as never;
    });
  const batch = new WorldAssetBatch(
    [
      {
        id: "tree",
        name: "木",
        kind: "asset",
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      },
    ],
    asset,
    new AssetTemplates(),
  );
  try {
    for (let i = 0; i < 8; i++) await Promise.resolve();
    const camera = new THREE.Vector3(10, 0, 0);
    const switchMode = (mode: string) => {
      batch.group.userData.setEnvironmentModes({ treeShadowMode: mode });
      batch.update(camera);
    };
    switchMode("B0");
    expect(batch.group.userData.detailedShadow).toBe(true);
    camera.x = 55;
    switchMode("B1");
    expect(batch.group.userData.castingEnvironmentShadow).toBe(false);
    camera.x = 10;
    switchMode("B2");
    expect(batch.group.userData.detailedShadow).toBe(false);
    expect(batch.group.userData.castingEnvironmentShadow).toBe(true);
    camera.x = 55;
    switchMode("B3");
    expect(batch.group.userData.proxyShadowLevel).toBe(1);
    camera.x = 100;
    batch.update(camera);
    expect(batch.group.userData.proxyShadowLevel).toBe(2);
    batch.shiftOrigin([1000000, 0, 0]);
    camera.x -= 1000000;
    batch.group.position.x -= 1000000;
    batch.update(camera);
    expect(batch.group.userData.proxyShadowLevel).toBe(2);
  } finally {
    batch.dispose();
    batch.dispose();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    loader.mockRestore();
  }
  expect(disposeSpies.length).toBeGreaterThanOrEqual(3);
  for (const spy of disposeSpies) expect(spy).toHaveBeenCalledTimes(1);
});

it("壊れた生成設定をGLBへ保存しない", async () => {
  await expect(
    environmentModelGlb("house", 42, 0, { ...houseRules(42), floors: 0 }),
  ).rejects.toThrow("Invalid house dimensions");
  await expect(
    environmentModelGlb("oak", 42, 0, {
      ...treeRules("oak", 42),
      crownDensity: 0,
    }),
  ).rejects.toThrow("Invalid tree dimensions");
  await expect(
    environmentModelGlb("oak", 42, 0, treeRules("oak", 43)),
  ).rejects.toThrow("Invalid environment rule parameters");
});

it("異なるSeedのC1画像を誤って共有せず、中断した画像を破棄する", async () => {
  const pool = new EnvironmentTexturePool(),
    groups: THREE.Group[] = [];
  for (const hash of ["seed-a", "seed-b"]) {
    const group = new THREE.Group();
    group.userData.environmentRecipeVersion = 3;
    const texture = new THREE.Texture();
    texture.name = `wood-generated-v4:${hash}`;
    const material = new THREE.MeshStandardMaterial();
    material.userData.generatedMap = texture;
    group.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
    pool.acquire(group);
    groups.push(group);
  }
  expect(
    ((groups[0].children[0] as THREE.Mesh).material as THREE.Material).userData
      .generatedMap,
  ).not.toBe(
    ((groups[1].children[0] as THREE.Mesh).material as THREE.Material).userData
      .generatedMap,
  );
  groups.forEach((group) => disposeTemplate(group, pool.release(group)));
  const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  let resolve!: (t: THREE.Texture) => void;
  const ready = vi.fn();
  configureBuildingMaterial(
    material,
    () =>
      new Promise((finish) => {
        resolve = finish;
      }),
    ready,
  );
  material.userData.setBuildingMaterialMode("C1");
  material.dispose();
  const texture = new THREE.Texture(),
    dispose = vi.spyOn(texture, "dispose");
  resolve(texture);
  for (let i = 0; i < 3; i++) await Promise.resolve();
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(ready).not.toHaveBeenCalled();
  material.map!.dispose();
});
