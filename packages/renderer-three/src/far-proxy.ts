import { alpineSurfaceMaterial } from "./alpine-surface";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { isAlpineVillage } from "../../world-generator/src/alpine-farmland";
import { hexToRgb } from "../../world-generator/src/prepare";
import { CURRENT_BIOME_PROFILE_VERSION } from "../../world-generator/src/index";
import * as THREE from "three";
import {
  worldChunkSize,
  type World,
  type Vec3,
} from "../../project-schema/src/index";
import type { IslandProxyData } from "../../world-generator/src/far-proxy";

export class FarWorldProxy {
  readonly group = new THREE.Group();
  private worker?: Worker;
  private meshes: { mesh: THREE.Mesh; data: IslandProxyData }[] = [];
  private forest: {
    mesh: THREE.InstancedMesh;
    trees: NonNullable<IslandProxyData["forest"]>;
  }[] = [];
  private dirty = true;
  private disposed = false;
  constructor(world: World) {
    if (
      world.source.kind !== "procedural" ||
      !world.source.design ||
      typeof Worker === "undefined"
    )
      return;
    this.group.name = "far-world-proxy";
    this.worker = new Worker(
      new URL("../../world-generator/src/worker-entry.ts", import.meta.url),
      { type: "module" },
    );
    this.worker.onmessage = (
      event: MessageEvent<{ type: string; proxies?: IslandProxyData[] }>,
    ) => {
      if (this.disposed) return;
      for (const data of event.data.proxies ?? []) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.BufferAttribute(data.positions, 3),
        );
        geometry.setAttribute(
          "normal",
          new THREE.BufferAttribute(data.normals, 3),
        );
        geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
        geometry.setAttribute(
          "color",
          new THREE.Float32BufferAttribute(
            data.colors.flatMap((hex) =>
              world.source.kind === "procedural" &&
              world.source.design &&
              isAlpineVillage(world.source.design)
                ? new THREE.Color(hex).toArray()
                : hexToRgb(hex),
            ),
            3,
          ),
        );
        const material =
          world.source.kind === "procedural" &&
          world.source.design &&
          isAlpineVillage(world.source.design)
            ? alpineSurfaceMaterial()
            : new THREE.MeshStandardMaterial({
                vertexColors: true,
                roughness: 1,
              });
        // 半透明の海を通してProxyの四角い海底領域が見えないようにする。
        if (world.water.enabled)
          material.onBeforeCompile = (shader) => {
            shader.uniforms.proxySeaLevel = { value: world.water.height };
            shader.vertexShader =
              "varying float proxyHeight;\n" +
              shader.vertexShader.replace(
                "#include <begin_vertex>",
                "#include <begin_vertex>\nproxyHeight = position.y;",
              );
            shader.fragmentShader =
              "varying float proxyHeight;\nuniform float proxySeaLevel;\n" +
              shader.fragmentShader.replace(
                "#include <clipping_planes_fragment>",
                "#include <clipping_planes_fragment>\nif (proxyHeight < proxySeaLevel) discard;",
              );
          };
        const mesh = new THREE.Mesh(geometry, material);
        this.meshes.push({ mesh, data });
        this.group.add(mesh);
        for (const pine of [true, false]) {
          const trees = (data.forest ?? []).filter(
            (tree) => tree.pine === pine,
          );
          if (!trees.length) continue;
          const parts = pine
            ? [0, 1, 2].map((tier) => {
                const part = new THREE.ConeGeometry(
                  0.29 - tier * 0.06,
                  0.52,
                  5,
                );
                part.translate(0, 0.3 + tier * 0.23, 0);
                return part;
              })
            : [0, 1, 2].map((tier) => {
                const part = new THREE.IcosahedronGeometry(0.25, 0);
                part.scale(1.15, 1, 1);
                part.translate(
                  Math.sin(tier * 2.4) * 0.17,
                  0.52 + tier * 0.08,
                  Math.cos(tier * 2.4) * 0.15,
                );
                return part;
              });
          const g = mergeGeometries(parts)!;
          parts.forEach((part) => part.dispose());
          const foliage = new THREE.InstancedMesh(
            g,
            new THREE.MeshStandardMaterial({
              color: pine ? "#365139" : "#577333",
              roughness: 1,
            }),
            trees.length,
          );
          this.forest.push({ mesh: foliage, trees });
          this.group.add(foliage);
        }
      }
      this.dirty = true;
      this.worker?.terminate();
      this.worker = undefined;
    };
    this.worker.postMessage({
      type: "far-proxies",
      design: world.source.design,
      seed: world.source.seed,
      chunkSize: worldChunkSize(world),
      biomeProfileVersion:
        world.buildManifest?.biomeProfileVersion ??
        CURRENT_BIOME_PROFILE_VERSION,
    });
  }
  get terrainProxyCount() {
    return this.meshes.length;
  }
  invalidate() {
    this.dirty = true;
  }
  update(loadedKeys: Iterable<string>, origin: Vec3) {
    this.group.position.set(-origin[0], -origin[1], -origin[2]);
    if (!this.dirty || !this.meshes.length) return;
    this.dirty = false;
    const keys = new Set(loadedKeys);
    const transform = new THREE.Object3D();
    for (const { mesh, trees } of this.forest) {
      let count = 0;
      for (const tree of trees) {
        if (keys.has(tree.key)) continue;
        transform.position.fromArray(tree.position);
        transform.scale.set(
          tree.scale * (0.8 + Math.sin(tree.position[0]) * 0.15),
          tree.scale,
          tree.scale,
        );
        transform.rotation.set(
          0,
          tree.position[0] * 0.13,
          Math.sin(tree.position[2]) * 0.04,
        );
        transform.updateMatrix();
        mesh.setMatrixAt(count++, transform.matrix);
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    for (const { mesh, data } of this.meshes) {
      const indices: number[] = [];
      for (let i = 0; i < data.cellKeys.length; i++)
        if (!keys.has(data.cellKeys[i]))
          for (let j = 0; j < 6; j++) indices.push(data.indices[i * 6 + j]);
      mesh.geometry.setIndex(indices);
    }
  }
  dispose() {
    this.disposed = true;
    this.worker?.terminate();
    this.group.removeFromParent();
    for (const { mesh } of this.meshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    for (const { mesh } of this.forest) {
      mesh.dispose();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.forest = [];
    this.meshes = [];
    this.group.clear();
  }
}
