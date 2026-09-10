import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import type { AssetRecord, Project } from "../../project-schema/src/index";
export type Entity = Project["world"]["entities"][number];
export function disposeTemplate(group: THREE.Object3D) {
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
    for (const value of Object.values(m))
      if (value instanceof THREE.Texture) textures.add(value);
    m.dispose();
  });
  textures.forEach((t) => t.dispose());
  geometries.forEach((g) => g.dispose());
}
export function builtinTemplate(kind: Entity["kind"], level = 0) {
  const group = new THREE.Group();
  const add = (geometry: THREE.BufferGeometry, color: string, y: number) => {
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color, roughness: 0.72 }),
    );
    mesh.position.y = y;
    group.add(mesh);
  };
  const addAt = (
    geometry: THREE.BufferGeometry,
    color: string,
    position: [number, number, number],
  ) => {
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color, roughness: 0.72 }),
    );
    mesh.position.set(...position);
    group.add(mesh);
  };
  if (kind === "tree") {
    add(
      new THREE.CylinderGeometry(0.15, 0.2, 1.5, level ? 4 : 8),
      "#856349",
      0.75,
    );
    add(new THREE.ConeGeometry(1, 2.4, level ? 4 : 8), "#3e7956", 2);
  } else if (kind === "building") {
    add(new THREE.BoxGeometry(2, 2.6, 2), "#c8b891", 1.3);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(1.55, 0.9, 4),
      new THREE.MeshStandardMaterial({ color: "#a85f54", roughness: 0.72 }),
    );
    roof.position.y = 3.05;
    roof.rotation.y = Math.PI / 4;
    group.add(roof);
    for (const x of [-0.55, 0.55])
      addAt(new THREE.BoxGeometry(0.35, 0.38, 0.06), "#5a7780", [
        x,
        1.45,
        1.03,
      ]);
  } else
    add(
      new THREE.IcosahedronGeometry(0.8, level ? 0 : 1),
      kind === "asset" ? "#b68383" : "#8b9790",
      0.5,
    );
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
    for (let i = 0; i < entities.length; i++)
      mesh.setMatrixAt(
        i,
        new THREE.Matrix4().multiplyMatrices(
          entityMatrix(entities[i]),
          o.matrixWorld,
        ),
      );
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });
  return group;
}
export class AssetTemplates {
  private entries = new Map<
    string,
    { refs: number; promise: Promise<THREE.Object3D> }
  >();
  acquire(key: string, load: () => Promise<THREE.Object3D>) {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { refs: 0, promise: load() };
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
          void held.promise.then(disposeTemplate).catch(() => {});
        }
      },
    };
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
  ) {
    for (const e of entities)
      this.center.add(new THREE.Vector3(...e.transform.position));
    this.center.divideScalar(entities.length);
    this.levels = asset
      ? asset.runtimeInfo?.lods?.length
        ? [...asset.runtimeInfo.lods].sort((a, b) => a.distance - b.distance)
        : [{ level: 0, file: asset.files.runtime, distance: 0 }]
      : [
          { level: 0, distance: 0 },
          { level: 1, distance: 60 },
        ];
    this.group.userData.assetId = asset?.id;
    this.group.userData.release = () => this.dispose();
    this.group.userData.updateLod = (camera: THREE.Vector3) =>
      this.update(camera);
    this.load(0);
  }
  update(camera: THREE.Vector3) {
    const target = chooseLod(
      camera.distanceTo(this.center),
      this.levels.map((l) => l.distance),
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
        this.group.traverse((o) => {
          if (o instanceof THREE.InstancedMesh) o.dispose();
        });
        this.group.clear();
        this.release?.();
        this.release = entry.release;
        this.pendingRelease = undefined;
        this.group.add(instanceTemplate(template, this.entities));
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
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.pendingRelease?.();
    this.release?.();
  }
}
