import { insideEnvironmentPlaza } from "../../packages/renderer-three/src/environment-plaza";
import { alpineEnvironmentAccents } from "../../packages/renderer-three/src/environment-accents";
import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core";
import {
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Texture,
  SRGBColorSpace,
  PerspectiveCamera,
  BufferGeometry,
  BufferAttribute,
  InstancedMesh,
  Matrix4,
} from "three";
import { environmentModelGlb } from "../../packages/ai-dummy/src/environment-models";
import { surfacePixels } from "../../packages/ai-dummy/src/environment-materials";
import {
  generateRuntime,
  runtimeIO,
  triangleCount,
} from "../../packages/asset-pipeline/src/runtime";
import {
  EnvironmentTexturePool,
  disposeTemplate,
  instanceTemplate,
} from "../../packages/renderer-three/src/instances";
import { vegetationPlacements } from "../../packages/world-generator/src/vegetation";
import {
  grassGeometry,
  createVegetationChunk,
} from "../../packages/renderer-three/src/vegetation";
import { parseProject } from "../../packages/project-schema/src/index";
import { readFileSync } from "node:fs";
import { generateChunk } from "../../packages/world-generator/src/index";
import { environmentTreeCollider } from "../../packages/ai-dummy/src/environment-models";
import { vegetationGroundHeight } from "../../packages/renderer-three/src/vegetation-ground";
import { prepareEnvironmentAssets } from "../../packages/ai-dummy/src/environment-prepare";
import { LocalAssetStorage } from "../../packages/storage/src/local";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { worldVegetationChunk } from "../../packages/renderer-three/src/world-vegetation";
import { prepareChunk } from "../../packages/world-generator/src/prepare";
import { SemanticLayers } from "../../packages/world-generator/src/semantic";
import { settlementEntities } from "../../packages/world-generator/src/settlement-generation";

describe("環境品質の素材基盤", () => {
  it("素材名を変更してもGLBに保存したSeedから同じLODを再生成する", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "environment-quality-"));
    try {
      const storage = new LocalAssetStorage(root);
      const project = parseProject(
        JSON.parse(readFileSync("demos/worlds/alpine-village.json", "utf8")),
      );
      const asset = structuredClone(
        project.assets.find((a) =>
          a.catalog?.slots.includes("nature.tree.quality.oak"),
        )!,
      );
      asset.name = "名前を変更した広葉樹";
      asset.files.original = "/api/files/source.glb";
      await storage.save("source.glb", await environmentModelGlb("oak", 19));
      await prepareEnvironmentAssets([asset], storage);
      const file = asset.runtimeInfo!.lods![1].file.replace("/api/files/", "");
      const bytes = await storage.load(file);
      const lod = await runtimeIO().readBinary(bytes);
      expect(lod.getRoot().listScenes()[0].getExtras().environmentSeed).toBe(
        19,
      );
      await prepareEnvironmentAssets([asset], storage);
      expect(await storage.load(file)).toEqual(bytes);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);
  it("UV・法線・埋め込み画像・MASKをGLBと最適化Runtimeで保持する", async () => {
    const bytes = await environmentModelGlb("oak", 3);
    expect(await environmentModelGlb("oak", 3)).toEqual(bytes);
    expect(await environmentModelGlb("oak", 4)).not.toEqual(bytes);
    const doc = await new NodeIO().readBinary(bytes);
    const leaf = doc
      .getRoot()
      .listMaterials()
      .find((m) => m.getName() === "leaf")!;
    expect(leaf.getAlphaMode()).toBe("MASK");
    expect(leaf.getDoubleSided()).toBe(true);
    for (const mesh of doc.getRoot().listMeshes())
      for (const p of mesh.listPrimitives()) {
        expect(p.getAttribute("TEXCOORD_0")?.getCount()).toBe(
          p.getAttribute("POSITION")?.getCount(),
        );
        expect(p.getAttribute("NORMAL")).not.toBeNull();
      }
    const image = await sharp(leaf.getBaseColorTexture()!.getImage()!)
      .ensureAlpha()
      .raw()
      .toBuffer();
    expect(image.some((v, i) => i % 4 === 3 && v === 0)).toBe(true);
    expect(image.some((v, i) => i % 4 === 3 && v === 255)).toBe(true);
    const runtime = await generateRuntime(doc);
    const loaded = await runtimeIO().readBinary(runtime.levels[0].bytes);
    expect(loaded.getRoot().listTextures().length).toBeGreaterThan(0);
    expect(
      loaded
        .getRoot()
        .listMaterials()
        .some((m) => m.getAlphaMode() === "MASK"),
    ).toBe(true);
    const distant = await new NodeIO().readBinary(
      await environmentModelGlb("oak", 3, 2),
    );
    expect(triangleCount(distant)).toBeLessThan(triangleCount(doc));
  }, 30000);
  it("草の共有形状と材質を最後のChunk参照まで維持する", () => {
    const area = { minX: 0, minZ: 0, maxX: 16, maxZ: 16 };
    const options = {
      seed: 42,
      area,
      bounds: area,
      originX: 0,
      originZ: 0,
      height: () => 0,
      allowed: () => true,
    };
    const first = createVegetationChunk(options),
      second = createVegetationChunk(options);
    const a = first.children[0] as InstancedMesh,
      b = second.children[0] as InstancedMesh;
    expect(a.geometry).toBe(b.geometry);
    expect(a.material).toBe(b.material);
    const geometryDisposed = vi.spyOn(a.geometry, "dispose");
    const materialDisposed = vi.spyOn(
      a.material as MeshStandardMaterial,
      "dispose",
    );
    first.userData.release();
    first.userData.release();
    expect(geometryDisposed).not.toHaveBeenCalled();
    expect(materialDisposed).not.toHaveBeenCalled();
    second.userData.release();
    expect(geometryDisposed).toHaveBeenCalledTimes(1);
    expect(materialDisposed).toHaveBeenCalledTimes(1);
    first.children.forEach((mesh) => (mesh as InstancedMesh).dispose());
    second.children.forEach((mesh) => (mesh as InstancedMesh).dispose());
  });
  it("小さな葉をカード面全体へ分散し、透明な帯に集中させない", () => {
    const { color } = surfacePixels("leaf", 128);
    const quadrants = [0, 0, 0, 0];
    let covered = 0;
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++)
        if (color[(y * 128 + x) * 4 + 3] === 255) {
          covered++;
          quadrants[(x >= 64 ? 1 : 0) + (y >= 64 ? 2 : 0)]++;
        }
    expect(covered / (128 * 128)).toBeGreaterThan(0.3);
    expect(covered / (128 * 128)).toBeLessThan(0.7);
    for (const count of quadrants)
      expect(count / covered).toBeGreaterThan(0.15);
  });
  it("木材・石・屋根の法線と粗さを建物GLBに埋め込む", async () => {
    const doc = await new NodeIO().readBinary(
      await environmentModelGlb("house"),
    );
    expect(
      doc
        .getRoot()
        .listMaterials()
        .map((m) => m.getName())
        .sort(),
    ).toEqual(["glass", "plaster", "roof", "stone", "wood"]);
    for (const m of doc.getRoot().listMaterials()) {
      expect(m.getBaseColorTexture()).not.toBeNull();
      expect(m.getNormalTexture()).not.toBeNull();
      expect(m.getMetallicRoughnessTexture()).not.toBeNull();
    }
    expect(surfacePixels("stone")).toEqual(surfacePixels("stone"));
  });
  it("GLB間の同一画像は最後の参照まで保持し、通常素材と混同しない", () => {
    const pool = new EnvironmentTexturePool();
    const make = () => {
      const g = new Group();
      g.userData.environmentRecipeVersion = 1;
      const texture = new Texture();
      texture.name = "leaf-color-v1";
      texture.colorSpace = SRGBColorSpace;
      g.add(
        new Mesh(
          new PlaneGeometry(),
          new MeshStandardMaterial({ map: texture }),
        ),
      );
      return {
        g,
        texture,
        material: (g.children[0] as Mesh).material as MeshStandardMaterial,
      };
    };
    const a = make(),
      b = make(),
      disposed = vi.spyOn(a.texture, "dispose");
    pool.acquire(a.g);
    pool.acquire(b.g);
    expect(b.material.map).toBe(a.texture);
    disposeTemplate(a.g, pool.release(a.g));
    expect(disposed).not.toHaveBeenCalled();
    disposeTemplate(b.g, pool.release(b.g));
    expect(disposed).toHaveBeenCalledTimes(1);
  });
  it("異なる素材レシピ版のTextureを混同せず、v2も最後の参照で解放する", () => {
    const pool = new EnvironmentTexturePool();
    const make = (version: number) => {
      const group = new Group();
      group.userData.environmentRecipeVersion = version;
      const texture = new Texture();
      texture.name = `leaf-color-v${version}`;
      const material = new MeshStandardMaterial({ map: texture });
      group.add(new Mesh(new PlaneGeometry(), material));
      return { group, material, texture };
    };
    const old = make(1),
      first = make(2),
      second = make(2);
    pool.acquire(old.group);
    pool.acquire(first.group);
    pool.acquire(second.group);
    expect(first.material.map).not.toBe(old.material.map);
    expect(first.material.map).toBe(second.material.map);
    const disposed = vi.spyOn(first.texture, "dispose");
    disposeTemplate(first.group, pool.release(first.group));
    expect(disposed).not.toHaveBeenCalled();
    disposeTemplate(second.group, pool.release(second.group));
    expect(disposed).toHaveBeenCalledTimes(1);
    disposeTemplate(old.group, pool.release(old.group));
  });
  it("インスタンスはGeometry/Materialを共有し、草はRebase後も親Chunk座標に従う", () => {
    const template = new Group(),
      geometry = new PlaneGeometry(),
      material = new MeshStandardMaterial();
    template.add(new Mesh(geometry, material));
    const batch = instanceTemplate(template, [
      {
        id: "tree",
        kind: "asset",
        name: "tree",
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      },
    ]);
    expect((batch.children[0] as Mesh).geometry).toBe(geometry);
    expect((batch.children[0] as Mesh).material).toBe(material);
    const grass = createVegetationChunk({
      seed: 42,
      area: { minX: 0, minZ: 0, maxX: 32, maxZ: 32 },
      bounds: { minX: 0, minZ: 0, maxX: 32, maxZ: 32 },
      originX: 0,
      originZ: 0,
      height: () => 12,
      allowed: () => true,
    });
    const camera = new PerspectiveCamera(45);
    camera.position.set(0, 15, 0);
    grass.userData.updateVegetation(camera, 1000);
    const visible = grass.children.map((m) => m.visible);
    grass.position.x -= 2048;
    camera.position.x -= 2048;
    grass.updateMatrixWorld(true);
    grass.userData.updateVegetation(camera, 1000);
    expect(grass.children.map((m) => m.visible)).toEqual(visible);
    grass.userData.release();
    disposeTemplate(template);
  });
});
describe("草の配置", () => {
  it("景観用樹木はChunkごとに一度だけ描き、道路と建物を塞がない", () => {
    const project = parseProject(
      JSON.parse(readFileSync("demos/worlds/alpine-village.json", "utf8")),
    );
    const source = project.world.source;
    if (source.kind !== "procedural" || !source.design)
      throw new Error("Expected procedural design");
    const before = generateChunk({ ...source, chunkX: -1, chunkZ: -2 });
    const accents = [];
    for (let z = -3; z < 1; z++)
      for (let x = -2; x < 2; x++)
        accents.push(
          ...alpineEnvironmentAccents(
            source.design,
            source.seed,
            project.assets,
            `${x},${z}`,
            64,
          ),
        );
    expect(accents.length).toBe(2);
    expect(new Set(accents.map((a) => a.id)).size).toBe(2);
    const layers = new SemanticLayers(source.design, source.seed);
    for (const accent of accents)
      expect(
        layers.sampleRoadInfluence(accent.position[0], accent.position[2], true)
          .distance,
      ).toBeGreaterThan(5);
    expect(generateChunk({ ...source, chunkX: -1, chunkZ: -2 })).toEqual(
      before,
    );
  });
  it("道路外側の覆いを広げても総株数と近景の三角形予算を増やさない", () => {
    const area = { minX: -32, minZ: -32, maxX: 32, maxZ: 32 };
    const base = {
      seed: 42,
      area,
      bounds: area,
      height: () => 12,
      allowed: (x: number) => Math.abs(x) > 1,
    };
    const original = vegetationPlacements(base);
    const optimized = vegetationPlacements({
      ...base,
      roadDistance: (x) => Math.abs(x),
      roadside: (x) => Math.abs(x) < 6,
    });
    expect(optimized.length).toBeLessThan(original.length);
    expect(optimized.filter((p) => Math.abs(p.position[0]) < 6).length).toBe(
      original.filter((p) => Math.abs(p.position[0]) < 6).length,
    );
    const geometry = grassGeometry(8);
    expect(geometry.getAttribute("position").count / 3).toBe(25);
    geometry.dispose();
  });
  it("視野外パッチを除外してもRebase後の表示判定が一致する", () => {
    const area = { minX: -32, minZ: -32, maxX: 32, maxZ: 32 };
    const grass = createVegetationChunk({
      seed: 42,
      area,
      bounds: area,
      originX: 0,
      originZ: 0,
      height: () => 0,
      allowed: () => true,
    });
    const camera = new PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(0, 2, 0);
    camera.lookAt(0, 0, -20);
    grass.updateMatrixWorld(true);
    grass.userData.updateVegetation(camera, 1000);
    const before = grass.children.map((mesh) => mesh.visible);
    expect(before.some(Boolean)).toBe(true);
    expect(before.some((v) => !v)).toBe(true);
    grass.position.x -= 2048;
    camera.position.x -= 2048;
    grass.updateMatrixWorld(true);
    grass.userData.updateVegetation(camera, 1000);
    expect(grass.children.map((mesh) => mesh.visible)).toEqual(before);
    grass.userData.release();
    grass.children.forEach((mesh) => (mesh as InstancedMesh).dispose());
  });

  it("広場の舗装には草を生やさず、樹木の足元には草の島を残す", () => {
    const project = parseProject(
      JSON.parse(readFileSync("demos/worlds/alpine-village.json", "utf8")),
    );
    const source = project.world.source;
    if (source.kind !== "procedural" || !source.design)
      throw new Error("Expected procedural design");
    const prepared = prepareChunk({ ...source, chunkX: 0, chunkZ: -1 });
    const geometry = new BufferGeometry().setAttribute(
      "position",
      new BufferAttribute(prepared.positions, 3),
    );
    const grass = worldVegetationChunk(
      source,
      project.assets,
      prepared,
      geometry,
      0,
    )!;
    const matrix = new Matrix4();
    let underTree = 0;
    for (const mesh of grass.children as InstancedMesh[])
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        const x = matrix.elements[12],
          z = matrix.elements[14] - 64;
        expect(insideEnvironmentPlaza(x, z)).toBe(false);
        if (Math.hypot(x - 30, z + 25) < 5) underTree++;
      }
    expect(underTree).toBeGreaterThan(0);
    grass.userData.release();
    grass.children.forEach((mesh) => (mesh as InstancedMesh).dispose());
    geometry.dispose();
  });
  it("任意の建物のCatalog境界を除外し、集落内の空き地には草を生やせる", () => {
    const project = parseProject(
      JSON.parse(readFileSync("demos/worlds/alpine-village.json", "utf8")),
    );
    const source = structuredClone(project.world.source);
    if (source.kind !== "procedural" || !source.design)
      throw new Error("Expected procedural design");
    source.design.islands[0].id = "vegetation-test";
    source.design.islands[0].mountains = [];
    source.design.islands[0].propRules = [];
    source.design.roads = [];
    source.design.landmarks = [];
    source.design.noSpawnRegions = [];
    source.design.settlements = [
      {
        id: "test-village",
        center: [32, 12, 32],
        radius: 30,
        height: 12,
        buildingRules: [
          {
            assetSlot: "building.large",
            count: 1,
            minSpacing: 30,
            minDistanceFromRoad: 0,
            scaleRange: [1, 1],
            rotationMode: "yaw",
          },
        ],
      },
    ];
    source.parameters = {
      vegetationArea: { minX: 0, minZ: 0, maxX: 64, maxZ: 64 },
    };
    const asset = structuredClone(
      project.assets.find((a) =>
        a.catalog?.slots.includes("building.quality.house"),
      )!,
    );
    asset.catalog!.slots = ["building.large"];
    asset.runtimeInfo!.bounds = { min: [-20, 0, -12], max: [20, 10, 12] };
    const prepared = prepareChunk({ ...source, chunkX: 0, chunkZ: 0 });
    const geometry = new BufferGeometry().setAttribute(
      "position",
      new BufferAttribute(prepared.positions, 3),
    );
    const grass = worldVegetationChunk(source, [asset], prepared, geometry, 0)!;
    const building = settlementEntities(
      { ...source, chunkX: 0, chunkZ: 0 },
      new SemanticLayers(source.design, source.seed),
    )[0];
    expect(building).toBeDefined();
    const matrix = new Matrix4();
    let inVillage = 0;
    for (const mesh of grass.children as InstancedMesh[])
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        const x = matrix.elements[12],
          z = matrix.elements[14];
        const dx = x - building.position[0],
          dz = z - building.position[2],
          angle = building.rotation[1];
        expect(
          Math.abs(dx * Math.cos(angle) - dz * Math.sin(angle)) < 20 &&
            Math.abs(dx * Math.sin(angle) + dz * Math.cos(angle)) < 12,
        ).toBe(false);
        if (Math.hypot(x - 32, z - 32) < 30) inVillage++;
      }
    expect(inVillage).toBeGreaterThan(0);
    grass.userData.release();
    grass.children.forEach((m) => (m as InstancedMesh).dispose());
    geometry.dispose();
  });
  it("草の接地高さは描画Terrainの三角形と一致し、対角線でも連続する", () => {
    const positions = [0, 0, 0, 1, 2, 0, 0, 4, 1, 1, 10, 1];
    expect(vegetationGroundHeight(positions, 2, 1, 0.25, 0.25)).toBe(1.5);
    expect(vegetationGroundHeight(positions, 2, 1, 0.75, 0.75)).toBe(6.5);
    expect(vegetationGroundHeight(positions, 2, 1, 0.5, 0.5)).toBe(3);
    expect(vegetationGroundHeight(positions, 2, 1, 1, 1)).toBe(10);
  });
  it("品質エリアの素材だけを変更し、地形・既存配置・道路とColliderの独立性を保つ", () => {
    const source = parseProject(
      JSON.parse(readFileSync("demos/worlds/alpine-village.json", "utf8")),
    ).world.source;
    if (source.kind !== "procedural")
      throw new Error("Expected procedural source");
    let replacements = 0;
    for (const chunkX of [0, 1, 2])
      for (const chunkZ of [-4, -3, -2]) {
        const detailed = generateChunk({ ...source, chunkX, chunkZ });
        const original = generateChunk({
          ...source,
          parameters: { ...source.parameters, environmentAssets: undefined },
          chunkX,
          chunkZ,
        });
        expect(detailed.heights).toEqual(original.heights);
        expect(detailed.colors).toEqual(original.colors);
        expect(
          detailed.entities.map(({ assetSlot: _slot, ...entity }) => entity),
        ).toEqual(
          original.entities.map(({ assetSlot: _slot, ...entity }) => entity),
        );
        replacements += detailed.entities.filter((e) =>
          e.assetSlot?.startsWith("nature.tree.quality."),
        ).length;
      }
    expect(replacements).toBeGreaterThan(0);
    const collider = JSON.parse(
      new TextDecoder().decode(environmentTreeCollider("oak")),
    );
    expect(
      Math.max(
        ...collider.vertices
          .filter((_: number, i: number) => i % 3 === 0)
          .map(Math.abs),
      ),
    ).toBeLessThan(0.6);
  });
  it("Chunk分割と生成順に依存せず、道路と建物を除外できる", () => {
    const area = { minX: -32, minZ: -32, maxX: 32, maxZ: 32 };
    const opts = {
      seed: 42,
      area,
      height: (x: number, z: number) => 12 + Math.sin(x + z),
      allowed: (x: number, z: number) =>
        Math.abs(x) > 3 && Math.hypot(x - 12, z - 12) > 6,
      roadside: (x: number) => Math.abs(x) < 6,
    };
    const full = vegetationPlacements({ ...opts, bounds: area });
    const split = [
      vegetationPlacements({ ...opts, bounds: { ...area, minX: 0 } }),
      vegetationPlacements({ ...opts, bounds: { ...area, maxX: 0 } }),
    ].flat();
    const sort = (p: typeof full) =>
      p.sort(
        (a, b) =>
          a.position[2] - b.position[2] || a.position[0] - b.position[0],
      );
    expect(sort(split)).toEqual(sort(full));
    expect(new Set(full.map((p) => p.position.join(","))).size).toBe(
      full.length,
    );
    expect(new Set(full.map((p) => p.kind)).size).toBe(5);
    expect(
      vegetationPlacements({ ...opts, seed: 43, bounds: area }),
    ).not.toEqual(full);
  });
});
