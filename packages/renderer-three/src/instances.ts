import { foliageWind } from "./foliage-wind";
import {
  configureBuildingMaterial,
  type BuildingMaterialMode,
} from "./environment-material";
import { alpineRotorTick } from "./alpine-rotor";
import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import type {
  AssetRecord,
  Project,
  Vec3,
} from "../../project-schema/src/index";
import {
  builtinEntityDefinition,
  isBuiltinEntityKind,
} from "../../world-system/src/entities";
export type Entity = Project["world"]["entities"][number];
export function disposeTemplate(
  group: THREE.Object3D,
  retainedTextures = new Set<THREE.Texture>(),
) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      geometries.add(o.geometry);
      for (const material of Array.isArray(o.material)
        ? o.material
        : [o.material])
        materials.add(material);
    }
  });
  materials.forEach((m) => {
    for (const value of Object.values(m).concat(Object.values(m.userData)))
      if (value instanceof THREE.Texture) textures.add(value);
    m.dispose();
  });
  textures.forEach((t) => {
    if (!retainedTextures.has(t)) t.dispose();
  });
  geometries.forEach((g) => g.dispose());
}
export function builtinTemplate(kind: Entity["kind"], level = 0) {
  const group = new THREE.Group();
  const addMesh = (
    geometry: THREE.BufferGeometry,
    color: string,
    position: [number, number, number],
    rotation: [number, number, number] = [0, 0, 0],
  ) => {
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color, roughness: 0.72 }),
    );
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    group.add(mesh);
  };
  if (!isBuiltinEntityKind(kind)) {
    addMesh(
      new THREE.IcosahedronGeometry(0.8, level ? 0 : 1),
      "#b68383",
      [0, 0.5, 0],
    );
    return group;
  }
  const definition = builtinEntityDefinition(kind);
  const segments = level ? 4 : 8;
  for (const part of definition.visual) {
    const rotation = part.localRotation;
    if (part.shape === "cylinder")
      addMesh(
        new THREE.CylinderGeometry(
          part.radiusTop,
          part.radiusBottom,
          part.height,
          segments,
        ),
        part.color,
        part.localPosition,
        rotation,
      );
    else if (part.shape === "cone")
      addMesh(
        new THREE.ConeGeometry(
          part.radius,
          part.height,
          part.radialSegments ?? segments,
        ),
        part.color,
        part.localPosition,
        rotation,
      );
    else if (part.shape === "box")
      addMesh(
        new THREE.BoxGeometry(...part.size),
        part.color,
        part.localPosition,
        rotation,
      );
    else
      addMesh(
        new THREE.IcosahedronGeometry(part.radius, level ? 0 : 1),
        part.color,
        part.localPosition,
        rotation,
      );
  }
  return group;
}
export function instanceTemplate(template: THREE.Object3D, entities: Entity[]) {
  const group = new THREE.Group();
  template.updateMatrixWorld(true);
  let supported = true;
  template.traverse((o) => {
    if (
      o instanceof THREE.SkinnedMesh ||
      (o instanceof THREE.Mesh &&
        Object.keys(o.geometry.morphAttributes).length) ||
      o instanceof THREE.InstancedMesh ||
      (o instanceof THREE.Mesh && o.matrixWorld.determinant() < 0) ||
      o instanceof THREE.Line ||
      o instanceof THREE.Points
    )
      supported = false;
  });
  const transform = new THREE.Object3D();
  const entityMatrix = (e: Entity) => {
    transform.position.fromArray(e.transform.position);
    transform.rotation.set(...e.transform.rotation);
    transform.scale.fromArray(e.transform.scale);
    transform.updateMatrix();
    return transform.matrix;
  };
  if (!supported) {
    for (const entity of entities) {
      const root = new THREE.Group(),
        object = clone(template);
      root.applyMatrix4(entityMatrix(entity));
      root.userData.id = entity.id;
      object.traverse((o) => {
        o.userData.shared = true;
      });
      root.add(object);
      group.add(root);
    }
    return group;
  }
  const rotorTicks: ((time: number) => void)[] = [];
  template.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mesh = new THREE.InstancedMesh(
      o.geometry,
      o.material,
      entities.length,
    );
    mesh.userData.shared = true;
    mesh.userData.entityIds = entities.map((e) => e.id);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const foliage =
      [1, 2, 3].includes(template.userData.environmentRecipeVersion) &&
      o.material instanceof THREE.MeshStandardMaterial &&
      ["leaf", "needle"].includes(o.material.name);
    if (foliage) {
      if (!o.material.userData.environmentWind) {
        const original = o.material.onBeforeCompile,
          key = o.material.customProgramCacheKey();
        o.material.onBeforeCompile = (
          shader: Parameters<THREE.Material["onBeforeCompile"]>[0],
          renderer: THREE.WebGLRenderer,
        ) => {
          original.call(o.material, shader, renderer);
          foliageWind(shader);
        };
        o.material.customProgramCacheKey = () => key + "-foliage-wind-v1";
        o.material.userData.environmentWind = true;
      }
      o.material.alphaToCoverage = true;
      // 葉の裏面の過度な黒さを抑える。透過MASKとMSAAを維持する。
      o.material.emissive.set("#243612");
      o.material.emissiveIntensity = 0.12;
    }
    for (let i = 0; i < entities.length; i++)
      mesh.setMatrixAt(
        i,
        new THREE.Matrix4().multiplyMatrices(
          entityMatrix(entities[i]),
          o.matrixWorld,
        ),
      );
    if (o.name === "alpine-windmill-rotor")
      rotorTicks.push(alpineRotorTick(mesh));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    if (foliage) mesh.boundingSphere!.radius += 0.1;
    group.add(mesh);
  });
  if (rotorTicks.length)
    group.userData.updateAlpineRotor = (time: number) =>
      rotorTicks.forEach((tick) => tick(time));
  return group;
}
export class AssetTemplates {
  private texturePool = new EnvironmentTexturePool();
  private entries = new Map<
    string,
    { refs: number; promise: Promise<THREE.Object3D> }
  >();
  refreshTextures(template: THREE.Object3D) {
    this.texturePool.acquire(template);
  }
  acquire(key: string, load: () => Promise<THREE.Object3D>) {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        refs: 0,
        promise: load().then((template) => {
          this.texturePool.acquire(template);
          return template;
        }),
      };
      this.entries.set(key, entry);
    }
    entry.refs++;
    const held = entry;
    let released = false;
    return {
      promise: entry.promise,
      release: () => {
        if (released) return;
        released = true;
        if (--held.refs === 0) {
          this.entries.delete(key);
          void held.promise
            .then((template) => {
              const pooled = this.texturePool.release(template);
              disposeTemplate(template, pooled);
            })
            .catch(() => {});
        }
      },
    };
  }
}

/** 独自レシピの同一画像だけをGLB間で共有し、最後のTemplate解放時に破棄する。 */
export class EnvironmentTexturePool {
  private entries = new Map<string, { texture: THREE.Texture; refs: number }>();
  private held = new WeakMap<THREE.Object3D, Set<string>>();
  acquire(template: THREE.Object3D) {
    if (![1, 2, 3].includes(template.userData.environmentRecipeVersion)) return;
    const keys = this.held.get(template) ?? new Set<string>();
    const replacements = new Map<THREE.Texture, THREE.Texture>();
    template.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material]) {
        const properties = material as unknown as Record<string, unknown>;
        for (const owner of [properties, material.userData])
          for (const [property, value] of Object.entries(owner)) {
            if (
              !(value instanceof THREE.Texture) ||
              !/^(bark|wood|stone|roof|leaf|needle|grass|plaster|glass)-(color|normal|roughness|generated)-v[1234]$/.test(
                value.name,
              )
            )
              continue;
            const key = JSON.stringify([
              value.name,
              value.colorSpace,
              value.wrapS,
              value.wrapT,
              value.magFilter,
              value.minFilter,
              value.flipY,
              value.channel,
            ]);
            const replaced = replacements.get(value);
            if (replaced) {
              owner[property] = replaced;
              continue;
            }
            let entry = this.entries.get(key);
            if (!entry) {
              entry = { texture: value, refs: 0 };
              this.entries.set(key, entry);
            } else if (entry.texture !== value) {
              value.dispose();
              owner[property] = entry.texture;
              replacements.set(value, entry.texture);
            }
            if (!keys.has(key)) {
              entry.refs++;
              keys.add(key);
            }
          }
      }
    });
    this.held.set(template, keys);
  }
  release(template: THREE.Object3D) {
    const retained = new Set<THREE.Texture>();
    for (const key of this.held.get(template) ?? []) {
      const entry = this.entries.get(key)!;
      retained.add(entry.texture);
      if (--entry.refs === 0) {
        entry.texture.dispose();
        this.entries.delete(key);
      }
    }
    this.held.delete(template);
    return retained;
  }
}
export function chooseLod(
  distance: number,
  distances: number[],
  current: number,
  hysteresis = 0.1,
) {
  let level = current;
  while (
    level + 1 < distances.length &&
    distance > distances[level + 1] * (1 + hysteresis)
  )
    level++;
  while (level > 0 && distance < distances[level] * (1 - hysteresis)) level--;
  return level;
}
/** Shadow Passだけで遠い個体を退避し、近い木と同じChunkの遠い木のラスタライズを省く。 */
export function environmentShadowMaterial(
  source: THREE.Material,
  camera: THREE.Vector3,
  distance = 85,
) {
  const foliage = source as THREE.MeshStandardMaterial;
  const material = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: foliage.map ?? null,
    alphaMap: foliage.alphaMap ?? null,
    alphaTest: foliage.alphaTest ?? 0,
    side: source.side,
  });
  material.userData.shadowDistance = { value: distance };
  material.userData.shadowMinimumDistance = { value: 0 };
  material.onBeforeCompile = (shader) => {
    if (["leaf", "needle"].includes(source.name)) foliageWind(shader);
    shader.uniforms.environmentShadowDistance =
      material.userData.shadowDistance;
    shader.uniforms.environmentShadowMinimumDistance =
      material.userData.shadowMinimumDistance;
    shader.uniforms.environmentShadowCamera = { value: camera };
    shader.vertexShader =
      "uniform vec3 environmentShadowCamera;\nuniform float environmentShadowDistance;\nuniform float environmentShadowMinimumDistance;\n" +
      shader.vertexShader.replace(
        "#include <project_vertex>",
        `#include <project_vertex>
      #ifdef USE_INSTANCING
        vec3 treeOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float shadowDistance = distance(treeOrigin, environmentShadowCamera);
        if (shadowDistance > environmentShadowDistance || shadowDistance < environmentShadowMinimumDistance) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      #endif`,
      );
  };
  material.customProgramCacheKey = () => "environment-shadow-distance-v1";
  return material;
}

export type TreeShadowMode = "B0" | "B1" | "B2" | "B3";

export class WorldAssetBatch {
  readonly group = new THREE.Group();
  private disposed = false;
  private current = -1;
  private requested = -1;
  private requestTicket = 0;
  private failed = new Set<number>();
  private release?: () => void;
  private pendingRelease?: () => void;
  private center = new THREE.Vector3();
  private radius = 0;
  private shadowCamera = new THREE.Vector3();
  private shadowMode: TreeShadowMode = "B0";
  private profile: "quality" | "balanced" | "performance" = "balanced";
  private shadowProxy?: THREE.Group;
  private shadowProxyMaterials: THREE.Material[] = [];
  private shadowReleases: (() => void)[] = [];
  private materialMode: BuildingMaterialMode = "C0";
  private shadowMaterials: THREE.Material[] = [];
  private levels: {
    level: number;
    file?: string;
    distance: number;
    bytes?: number;
  }[];
  constructor(
    private entities: Entity[],
    private asset: AssetRecord | undefined,
    private cache: AssetTemplates,
    options?: { lodCenter?: [number, number, number]; lodRadius?: number },
  ) {
    if (options?.lodCenter) this.center.set(...options.lodCenter);
    else {
      for (const e of entities)
        this.center.add(new THREE.Vector3(...e.transform.position));
      this.center.divideScalar(Math.max(1, entities.length));
    }
    this.radius = Math.max(0, options?.lodRadius ?? 0);
    this.levels = asset
      ? asset.runtimeInfo?.lods?.length
        ? [...asset.runtimeInfo.lods].sort((a, b) => a.distance - b.distance)
        : [{ level: 0, file: asset.files.runtime, distance: 0 }]
      : [
          { level: 0, distance: 0 },
          { level: 1, distance: 60 },
        ];
    this.group.userData.assetId = asset?.id;
    this.group.userData.environmentCategory = asset?.catalog?.slots.some((s) =>
      s.startsWith("nature.tree."),
    )
      ? "trees"
      : asset?.catalog?.slots.some((s) => s.startsWith("building."))
        ? "buildingDetails"
        : undefined;
    this.group.userData.setEnvironmentModes = (options: {
      treeShadowMode?: TreeShadowMode;
      buildingMaterialMode?: BuildingMaterialMode;
      profile?: "quality" | "balanced" | "performance";
    }) => {
      const changed =
        !!options.buildingMaterialMode &&
        this.materialMode !== options.buildingMaterialMode;
      if (options.treeShadowMode) this.shadowMode = options.treeShadowMode;
      if (options.profile) this.profile = options.profile;
      if (options.buildingMaterialMode)
        this.materialMode = options.buildingMaterialMode;
      if (changed)
        this.group.traverse((object) => {
          if (object instanceof THREE.Mesh)
            for (const material of Array.isArray(object.material)
              ? object.material
              : [object.material])
              material.userData.setBuildingMaterialMode?.(this.materialMode);
        });
    };
    this.group.userData.release = () => this.dispose();
    this.group.userData.updateLod = (camera: THREE.Vector3) =>
      this.update(camera);
    this.load(0);
  }
  /** LOD 判定用の Simulation 座標中心。Origin Rebase ではこれも shift する。 */
  get lodCenter(): Vec3 {
    return [this.center.x, this.center.y, this.center.z];
  }
  /** Origin Rebase 時にカメラ・Chunk と同じ delta で中心をずらす。 */
  shiftOrigin(delta: Vec3) {
    this.shadowCamera.sub(new THREE.Vector3(...delta));
    this.center.x -= delta[0];
    this.center.y -= delta[1];
    this.center.z -= delta[2];
  }
  update(camera: THREE.Vector3) {
    if (this.disposed) return;
    this.shadowCamera.copy(camera);
    this.group.children[0]?.userData.updateAlpineRotor?.(
      performance.now() / 1000,
    );
    const distance = Math.max(0, camera.distanceTo(this.center) - this.radius);
    // 品質樹木の中遠景だけ影への参加を止める。近景と他Worldの素材は維持する。
    if (
      this.asset?.catalog?.slots.some((slot) =>
        slot.startsWith("nature.tree.quality."),
      )
    ) {
      const cutoff =
        this.profile === "performance"
          ? 45
          : this.profile === "quality"
            ? 120
            : 85;
      const mode = this.shadowMode;
      if ((mode === "B2" || mode === "B3") && !this.shadowProxy)
        this.createShadowProxy();
      if (
        mode === "B3" &&
        this.shadowProxy &&
        !this.shadowProxy.userData.loadedShadowLods
      )
        this.loadShadowLods(this.shadowProxy);
      if ((mode === "B0" || mode === "B1") && this.shadowProxy)
        this.disposeShadowProxy();
      const wasDetailed = this.group.userData.detailedShadow !== false;
      const detailed =
        mode === "B0"
          ? distance < cutoff + (wasDetailed ? 5 : -5)
          : mode === "B1"
            ? distance < (wasDetailed ? 48 : 42)
            : mode === "B3"
              ? distance < (wasDetailed ? 38 : 32)
              : false;
      this.group.userData.detailedShadow = detailed;
      this.group.traverse((object) => {
        if (object instanceof THREE.Mesh && !object.userData.shadowProxy)
          object.castShadow = detailed;
      });
      for (const material of [
        ...this.shadowMaterials,
        ...this.shadowProxyMaterials,
      ])
        if (material.userData.shadowDistance)
          material.userData.shadowDistance.value =
            material.userData.shadowProxyLevel !== undefined
              ? mode === "B3"
                ? material.userData.shadowProxyLevel === 1
                  ? 80
                  : 130
                : cutoff
              : mode === "B0"
                ? cutoff
                : mode === "B1"
                  ? 45
                  : 35;
      for (const material of this.shadowProxyMaterials)
        if (material.userData.shadowMinimumDistance)
          material.userData.shadowMinimumDistance.value =
            mode === "B3"
              ? material.userData.shadowProxyLevel === 1
                ? 35
                : 80
              : 0;
      if (this.shadowProxy)
        this.shadowProxy.visible =
          (mode === "B2" || mode === "B3") &&
          distance < (mode === "B3" ? 130 : cutoff);
      this.group.userData.proxyShadowLevel = chooseLod(
        distance,
        [0, 35, 80],
        this.group.userData.proxyShadowLevel ?? 1,
      );
      if (this.shadowProxy)
        for (const child of this.shadowProxy.children)
          child.visible =
            mode === "B3"
              ? child.userData.shadowLevel > 0
              : child.userData.shadowLevel === 0;
      this.group.userData.castingEnvironmentShadow =
        detailed || !!this.shadowProxy?.visible;
    }
    const target = chooseLod(
      distance,
      this.levels.map(
        (l) =>
          l.distance *
          (this.profile === "performance"
            ? 0.65
            : this.profile === "quality"
              ? 1.35
              : 1),
      ),
      Math.max(0, this.requested),
    );
    if (target !== this.requested && !this.failed.has(target))
      this.load(target);
  }
  private load(index: number) {
    this.requested = index;
    const ticket = ++this.requestTicket;
    this.pendingRelease?.();
    const lod = this.levels[index],
      key = lod.file ?? `builtin:${this.entities[0].kind}:${lod.level}`;
    const entry = this.cache.acquire(key, async () => {
      if (!lod.file) return builtinTemplate(this.entities[0].kind, lod.level);
      try {
        let bytes = 0;
        const gltf = await new GLTFLoader()
          .setMeshoptDecoder(MeshoptDecoder)
          .loadAsync(lod.file, (event) => {
            bytes = event.loaded;
          });
        if (this.asset?.runtimeInfo?.environmentMaterials) {
          gltf.scene.traverse((object) => {
            if (
              !(object instanceof THREE.Mesh) ||
              !(object.material instanceof THREE.MeshStandardMaterial)
            )
              return;
            const material = object.material,
              file =
                this.asset!.runtimeInfo!.environmentMaterials![material.name];
            if (file)
              configureBuildingMaterial(
                material,
                async () => {
                  const texture = await new THREE.TextureLoader().loadAsync(
                    file,
                  );
                  texture.name = `${material.name}-generated-v4`;
                  texture.colorSpace = THREE.SRGBColorSpace;
                  texture.flipY = false;
                  return texture;
                },
                () => this.cache.refreshTextures(gltf.scene),
              );
          });
        }
        gltf.scene.userData.sourceBytes = bytes;
        return gltf.scene;
      } catch {
        if (index !== 0) throw new Error("LOD download failed");
        return builtinTemplate("asset");
      }
    });
    this.pendingRelease = entry.release;
    void entry.promise
      .then((template) => {
        if (this.disposed || ticket !== this.requestTicket) return;
        this.disposeShadowProxy();
        this.group.traverse((o) => {
          if (o instanceof THREE.InstancedMesh) o.dispose();
        });
        this.shadowMaterials.forEach((material) => material.dispose());
        this.shadowMaterials = [];
        this.group.clear();
        this.release?.();
        this.release = entry.release;
        this.pendingRelease = undefined;
        const instances = instanceTemplate(template, this.entities);
        // 密な麦の各茎をShadow Mapへ再描画せず、建物・樹木・石垣の影を優先する。
        if (
          this.asset?.catalog?.slots.includes("landscape.alpine-village.wheat")
        ) {
          instances.traverse((object) => {
            if (object instanceof THREE.Mesh) object.castShadow = false;
          });
        }
        if (
          this.asset?.catalog?.slots.some((slot) =>
            slot.startsWith("nature.tree.quality."),
          )
        ) {
          instances.traverse((object) => {
            if (
              !(object instanceof THREE.Mesh) ||
              Array.isArray(object.material)
            )
              return;
            const depth = environmentShadowMaterial(
              object.material,
              this.shadowCamera,
              130,
            );
            object.customDepthMaterial = depth;
            this.shadowMaterials.push(depth);
          });
        }
        this.group.add(instances);

        this.group.traverse((object) => {
          if (object instanceof THREE.Mesh)
            for (const material of Array.isArray(object.material)
              ? object.material
              : [object.material])
              material.userData.setBuildingMaterialMode?.(this.materialMode);
        });
        this.current = index;
        this.group.userData.lodLevel = lod.level;
        this.group.userData.runtimeBytes =
          lod.bytes ??
          template.userData.sourceBytes ??
          this.asset?.runtimeInfo?.optimization?.runtimeBytes ??
          0;
        this.group.userData.runtimeFile = lod.file;
      })
      .catch(() => {
        entry.release();
        if (ticket === this.requestTicket) {
          this.failed.add(index);
          this.requested = this.current;
          this.pendingRelease = undefined;
        }
      });
  }
  private createShadowProxy() {
    const bounds = this.asset?.runtimeInfo?.bounds;
    if (!bounds) return;
    const group = new THREE.Group();
    const height = bounds.max[1],
      pine = this.asset!.catalog!.slots.some((slot) => slot.endsWith("pine"));
    const geometry = new THREE.IcosahedronGeometry(1, 0);
    const radiusX = (bounds.max[0] - bounds.min[0]) / 2,
      radiusZ = (bounds.max[2] - bounds.min[2]) / 2;
    geometry.scale(radiusX, height * (pine ? 0.4 : 0.3), radiusZ);
    geometry.translate(
      (bounds.max[0] + bounds.min[0]) / 2,
      height * (pine ? 0.58 : 0.7),
      (bounds.max[2] + bounds.min[2]) / 2,
    );
    const material = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
    });
    const mesh = new THREE.InstancedMesh(
      geometry,
      material,
      this.entities.length,
    );
    const transform = new THREE.Object3D();
    this.entities.forEach((entity, i) => {
      transform.position.fromArray(entity.transform.position);
      transform.rotation.set(...entity.transform.rotation);
      transform.scale.fromArray(entity.transform.scale);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
    });
    mesh.castShadow = true;
    mesh.userData.shadowProxy = true;
    mesh.userData.shared = true;
    mesh.customDepthMaterial = environmentShadowMaterial(
      material,
      this.shadowCamera,
      130,
    );
    mesh.customDepthMaterial.userData.shadowProxyLevel = 0;
    this.shadowProxyMaterials.push(mesh.customDepthMaterial);
    mesh.computeBoundingSphere();
    const simple = new THREE.Group();
    simple.userData.shadowLevel = 0;
    simple.add(mesh);
    group.add(simple);
    group.visible = false;
    this.shadowProxy = group;
    this.group.add(group);
  }
  private loadShadowLods(group: THREE.Group) {
    group.userData.loadedShadowLods = true;
    for (const lod of this.asset?.runtimeInfo?.environmentShadowLods ?? []) {
      const entry = this.cache.acquire(
        lod.file,
        async () =>
          (
            await new GLTFLoader()
              .setMeshoptDecoder(MeshoptDecoder)
              .loadAsync(lod.file)
          ).scene,
      );
      this.shadowReleases.push(entry.release);
      void entry.promise
        .then((template) => {
          if (this.disposed || this.shadowProxy !== group) return;
          const instances = instanceTemplate(template, this.entities);
          instances.userData.shadowLevel = lod.level;
          instances.visible = false;
          instances.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            const invisible = new THREE.MeshBasicMaterial({
              colorWrite: false,
              depthWrite: false,
            });
            object.material = invisible;
            object.userData.shadowProxy = true;
            object.userData.shadowTemplate = true;
            object.customDepthMaterial = environmentShadowMaterial(
              invisible,
              this.shadowCamera,
              130,
            );
            object.customDepthMaterial.userData.shadowProxyLevel = lod.level;
            this.shadowProxyMaterials.push(
              invisible,
              object.customDepthMaterial,
            );
          });
          group.add(instances);
        })
        .catch(() => entry.release());
    }
  }
  private disposeShadowProxy() {
    this.shadowReleases.forEach((release) => release());
    this.shadowReleases = [];
    this.shadowProxyMaterials.forEach((material) => material.dispose());
    this.shadowProxyMaterials = [];
    if (!this.shadowProxy) return;
    this.shadowProxy.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        if (object instanceof THREE.InstancedMesh) object.dispose();
        if (!object.userData.shadowTemplate) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      }
    });
    this.group.remove(this.shadowProxy);
    this.shadowProxy = undefined;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.pendingRelease?.();
    this.disposeShadowProxy();
    this.shadowMaterials.forEach((material) => material.dispose());
    this.shadowMaterials = [];
    this.group.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
    this.release?.();
  }
}
