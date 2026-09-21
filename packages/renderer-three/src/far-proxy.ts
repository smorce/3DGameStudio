import { hexToRgb } from "../../world-generator/src/prepare";
import { CURRENT_BIOME_PROFILE_VERSION } from "../../world-generator/src/index";
import * as THREE from "three";
import type { World, Vec3 } from "../../project-schema/src/index";
import type { IslandProxyData } from "../../world-generator/src/far-proxy";

export class FarWorldProxy {
  readonly group = new THREE.Group();
  private worker?: Worker;
  private meshes: { mesh: THREE.Mesh; data: IslandProxyData }[] = [];
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
          new THREE.Float32BufferAttribute(data.colors.flatMap(hexToRgb), 3),
        );
        const material = new THREE.MeshStandardMaterial({
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
      }
      this.dirty = true;
      this.worker?.terminate();
      this.worker = undefined;
    };
    this.worker.postMessage({
      type: "far-proxies",
      design: world.source.design,
      seed: world.source.seed,
      chunkSize: world.source.chunkSize,
      biomeProfileVersion:
        world.buildManifest?.biomeProfileVersion ??
        CURRENT_BIOME_PROFILE_VERSION,
    });
  }
  invalidate() {
    this.dirty = true;
  }
  update(loadedKeys: Iterable<string>, origin: Vec3) {
    this.group.position.set(-origin[0], -origin[1], -origin[2]);
    if (!this.dirty || !this.meshes.length) return;
    this.dirty = false;
    const keys = new Set(loadedKeys);
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
    this.meshes = [];
    this.group.clear();
  }
}
