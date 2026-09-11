import { evaluateRuntimeBudget } from "../../asset-core/src/profiles";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { AssetTemplates, WorldAssetBatch } from "./instances";
import {
  activeCourse,
  type Project,
  type Part,
  type Vec3,
} from "../../project-schema/src/index";
import type { Pose } from "../../physics-rapier/src/index";
import { groupInstances } from "../../world-system/src/index";
import { terrainChunks, ChunkStreamer } from "../../world-system/src/streaming";
import type { AttachmentCandidate } from "../../machine-system/src/index";
import {
  createPartVisual,
  updateMotorActivity,
  updateThrusterFlame,
} from "./part-visuals";
export { createPartVisual };
export type { PartVisualOptions } from "./part-visuals";
export interface RendererAdapter {
  load(project: Project): void;
  restoreEditTransforms(project: Project): void;
  render(poses?: Map<string, Pose>, thrust?: number): void;
  dispose(): void;
}
export function syncPartVisualTransforms(
  parts: Map<string, THREE.Object3D>,
  project: Project,
) {
  for (const machine of project.machines)
    for (const part of machine.parts) {
      const visual = parts.get(part.id);
      if (!visual) continue;
      visual.position.fromArray(part.transform.position);
      visual.rotation.fromArray([...part.transform.rotation, "XYZ"]);
      visual.scale.fromArray(part.transform.scale);
    }
}
export class ThreeRenderer implements RendererAdapter {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1500);
  controls: OrbitControls;
  root = new THREE.Group();
  machines = new Map<string, THREE.Group>();
  parts = new Map<string, THREE.Object3D>();
  chunks = new Map<string, THREE.Group>();
  private observer: ResizeObserver;
  private generation = 0;
  private templates = new AssetTemplates();
  private selected?: string;
  private project?: Project;
  private streamer?: ChunkStreamer<THREE.Group>;
  private chunkBuilders = new Map<string, ((g: THREE.Group) => void)[]>();
  private sun!: THREE.DirectionalLight;
  private highlighted = new THREE.Group();
  private selectionOutline = new THREE.Group();
  private ghost = new THREE.Group();
  private candidates: AttachmentCandidate[] = [];
  private hoverId?: string;
  private moved = false;
  private pointers = new Set<number>();
  onAttachmentPick?: (id: string) => void;
  onAttachmentHover?: (id?: string) => void;
  onCandidateScreens?: (points: { id: string; x: number; y: number }[]) => void;
  onPick?: (id: string | undefined, point: Vec3) => void;
  drawing = false;
  onStroke?: (points: Vec3[]) => void;
  private stroke: Vec3[] = [];
  private groundPoint(e: PointerEvent): Vec3 | undefined {
    const rect = this.canvas.getBoundingClientRect(),
      ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    const hit = ray.intersectObjects([...this.chunks.values()], true)[0];
    return hit ? [hit.point.x, hit.point.y, hit.point.z] : undefined;
  }
  private pointerMove = (e: PointerEvent) => {
    if (
      this.pointers.size &&
      Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) > 5
    )
      this.moved = true;
    if (this.highlighted.children.length) {
      const hit = this.candidateHit(e);
      const id = hit?.object.userData.candidateId as string | undefined;
      for (const object of this.highlighted.children) {
        const active = object.userData.candidateId === id;
        object.scale.setScalar(active ? 1.3 : 1);
        if (
          object instanceof THREE.Mesh &&
          object.material instanceof THREE.MeshStandardMaterial
        )
          object.material.emissiveIntensity = active ? 2 : 0.8;
      }
      this.canvas.style.cursor = id ? "pointer" : "grab";
      this.hoverAttachment(id);
    }
    if (!this.drawing || !this.stroke.length) return;
    const p = this.groundPoint(e),
      last = this.stroke.at(-1)!;
    if (p && Math.hypot(p[0] - last[0], p[2] - last[2]) > 1)
      this.stroke.push(p);
  };
  private candidateHit(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect(),
      ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    if (!this.highlighted.visible) return undefined;
    const hit = ray.intersectObjects(this.highlighted.children, true)[0];
    if (hit) return hit;
    // 遠い候補もタッチしやすいよう、画面上で最低44pxの範囲を確保する。
    let nearest: THREE.Object3D | undefined;
    let distance = 22;
    for (const object of this.highlighted.children) {
      const projected = object.position.clone().project(this.camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const d = Math.hypot(
        ((projected.x + 1) * rect.width) / 2 + rect.left - e.clientX,
        ((1 - projected.y) * rect.height) / 2 + rect.top - e.clientY,
      );
      if (d < distance) {
        distance = d;
        nearest = object;
      }
    }
    return nearest ? { object: nearest } : undefined;
  }
  private hoverAttachment(id?: string) {
    if (id === this.hoverId) return;
    this.hoverId = id;
    const candidate = this.candidates.find((c) => c.id === id);
    this.ghost.visible = !!candidate;
    if (candidate) {
      this.ghost.position.fromArray(candidate.position);
      this.ghost.rotation.fromArray([...candidate.rotation, "XYZ"]);
    }
    this.onAttachmentHover?.(id);
  }
  private pointerLeave = () => {
    this.hoverAttachment();
    this.canvas.style.cursor = "";
  };
  private pointerCancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    this.moved = true;
    this.stroke = [];
    this.controls.enabled = true;
    this.pointerLeave();
  };
  private down = [0, 0];
  private pointerDown = (e: PointerEvent) => {
    this.pointers.add(e.pointerId);
    if (this.pointers.size === 1) this.moved = false;
    else this.moved = true;
    this.down = [e.clientX, e.clientY];
    if (this.drawing) {
      const p = this.groundPoint(e);
      this.stroke = p ? [p] : [];
      this.controls.enabled = false;
      this.canvas.setPointerCapture(e.pointerId);
    }
  };
  private pointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.drawing) {
      const points = this.stroke;
      this.stroke = [];
      this.controls.enabled = true;
      if (points.length > 1) {
        this.onStroke?.(points);
        return;
      }
    }
    if (
      this.moved ||
      this.pointers.size ||
      Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) > 5
    )
      return;
    const rect = this.canvas.getBoundingClientRect(),
      ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    const candidate = this.candidateHit(e);
    if (candidate) {
      this.onAttachmentPick?.(candidate.object.userData.candidateId);
      return;
    }
    const hits = ray.intersectObjects(
      [...this.highlighted.children, ...this.root.children],
      true,
    );
    const h = hits[0];
    if (h) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.id) o = o.parent;
      this.onPick?.(
        h.instanceId !== undefined
          ? h.object.userData.entityIds?.[h.instanceId]
          : o?.userData.id,
        [h.point.x, h.point.y, h.point.z],
      );
    }
  };
  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera.position.set(7, 5.5, 8);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.6, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.scene.add(new THREE.HemisphereLight(0xe4f4ff, 0x6b7253, 2));
    const sun = (this.sun = new THREE.DirectionalLight(0xfff0d0, 3));
    sun.position.set(15, 25, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -25,
      right: 25,
      top: 25,
      bottom: -25,
    });
    this.scene.add(
      sun,
      this.root,
      this.highlighted,
      this.ghost,
      this.selectionOutline,
    );
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    canvas.addEventListener("pointerdown", this.pointerDown);
    canvas.addEventListener("pointerup", this.pointerUp);
    canvas.addEventListener("pointermove", this.pointerMove);
    canvas.addEventListener("pointerleave", this.pointerLeave);
    canvas.addEventListener("pointercancel", this.pointerCancel);
  }
  resetView() {
    this.camera.position.set(7, 5.5, 8);
    this.controls.target.set(0, 0.6, 0);
    this.controls.update();
  }
  get viewTarget(): Vec3 {
    return [
      this.controls.target.x,
      this.controls.target.y,
      this.controls.target.z,
    ];
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
    this.camera.aspect = r.width / Math.max(1, r.height);
    this.camera.updateProjectionMatrix();
  }
  private mesh(geometry: THREE.BufferGeometry, color: string) {
    const m = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color, roughness: 0.72 }),
    );
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
  private clear(group: THREE.Group) {
    group.traverse((o) => {
      o.userData.release?.();
      if (o instanceof THREE.InstancedMesh) o.dispose();
      if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose();
      if (o.userData.shared) return;
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        o.geometry.dispose();
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of materials) {
          for (const value of Object.values(m))
            if (value instanceof THREE.Texture) value.dispose();
          m.dispose();
        }
      }
    });
    group.clear();
  }
  load(p: Project, options?: { courseId: string | null }) {
    this.project = p;
    ++this.generation;
    this.streamer?.dispose();
    this.chunkBuilders.clear();
    this.clear(this.root);
    this.showAttachmentCandidates([]);
    this.parts.clear();
    this.machines.clear();
    this.chunks.clear();
    this.scene.background = new THREE.Color(p.world.environment.sky);
    this.scene.fog = new THREE.FogExp2(
      p.world.environment.sky,
      p.world.environment.fog,
    );
    const t = p.world.terrain;
    this.sun.intensity = p.world.lighting.intensity;
    const angle = ((p.world.lighting.timeOfDay - 6) / 12) * Math.PI;
    this.sun.position.set(
      Math.cos(angle) * 25,
      Math.max(2, Math.sin(angle) * 25),
      8,
    );
    for (const data of terrainChunks(p)) {
      this.chunkBuilders.set(data.key, [
        (group) => {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(data.vertices, 3),
          );
          geo.setIndex(data.indices);
          geo.setAttribute(
            "color",
            new THREE.Float32BufferAttribute(
              data.colors.flatMap((hex) => new THREE.Color(hex).toArray()),
              3,
            ),
          );
          geo.computeVertexNormals();
          const mesh = new THREE.Mesh(
            geo,
            new THREE.MeshStandardMaterial({
              vertexColors: true,
              roughness: 1,
            }),
          );
          mesh.receiveShadow = true;
          group.add(mesh);
        },
      ]);
    }
    const grid = new THREE.GridHelper(128, 64, 0x9cae85, 0x9cae85);
    grid.position.y = 0.015;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.18;
    this.root.add(grid);
    if (p.world.water.enabled) {
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(t.size * 2, t.size * 2),
        new THREE.MeshStandardMaterial({
          color: "#4db5c6",
          transparent: true,
          opacity: 0.65,
          roughness: 0.15,
        }),
      );
      water.rotation.x = -Math.PI / 2;
      water.position.y = p.world.water.height;
      this.root.add(water);
    }
    for (const m of p.machines) {
      const group = new THREE.Group();
      this.machines.set(m.id, group);
      this.root.add(group);
      for (const part of m.parts) {
        const visual = createPartVisual(part);
        visual.position.fromArray(part.transform.position);
        visual.rotation.fromArray([...part.transform.rotation, "XYZ"]);
        visual.scale.fromArray(part.transform.scale);
        visual.userData.id = part.id;
        group.add(visual);
        this.parts.set(part.id, visual);
      }
    }
    for (const [batchKey, entities] of groupInstances(p)) {
      const key = batchKey.split(":")[0];
      const builders = this.chunkBuilders.get(key) ?? [];
      builders.push((chunk) => {
        const asset = p.assets.find((a) => a.id === entities[0].assetId);
        const batch = new WorldAssetBatch(entities, asset, this.templates);
        chunk.add(batch.group);
      });
      this.chunkBuilders.set(key, builders);
    }
    const selectedCourse = activeCourse(p, options?.courseId);
    for (const c of options
      ? selectedCourse
        ? [selectedCourse]
        : []
      : p.courses) {
      if (c.path.length > 1) {
        for (let i = 1; i < c.path.length; i++) {
          const a = new THREE.Vector3(...c.path[i - 1]),
            b = new THREE.Vector3(...c.path[i]),
            len = a.distanceTo(b),
            road = this.mesh(
              new THREE.BoxGeometry(4, 0.08, len),
              c.id === selectedCourse?.id ? "#b8aa89" : "#8b94a0",
            );
          road.position.copy(a).add(b).multiplyScalar(0.5);
          road.lookAt(b);
          this.root.add(road);
        }
      }
      for (const [point, color, label] of [
        [c.start, "#53aa84", "START"],
        ...c.checkpoints.map((a) => [a.position, "#efbf54", "CHECK"]),
        [c.goal, "#e77961", "GOAL"],
      ] as [Vec3, string, string][]) {
        const gate = new THREE.Group();
        gate.position.fromArray(point);
        for (const x of [-2, 2]) {
          const pole = this.mesh(
            new THREE.CylinderGeometry(0.08, 0.08, 3, 8),
            color,
          );
          pole.position.set(x, 1, 0);
          gate.add(pole);
        }
        const bar = this.mesh(new THREE.BoxGeometry(4.2, 0.4, 0.2), color);
        bar.position.y = 2.5;
        gate.add(bar);
        gate.name = label;
        this.root.add(gate);
      }
      for (const o of c.obstacles) {
        const mesh = this.mesh(new THREE.BoxGeometry(...o.size), "#db9b64");
        mesh.position.set(
          o.position[0],
          o.position[1] + o.size[1] / 2,
          o.position[2],
        );
        if (o.kind === "jump") mesh.rotation.x = -0.36;
        this.root.add(mesh);
      }
    }
    this.streamer = new ChunkStreamer(
      (key) => {
        const builders = this.chunkBuilders.get(key);
        if (!builders) return;
        const group = new THREE.Group();
        this.root.add(group);
        for (const build of builders) build(group);
        this.chunks.set(key, group);
        return group;
      },
      (group) => {
        group.removeFromParent();
        this.clear(group);
        for (const [key, value] of this.chunks)
          if (value === group) this.chunks.delete(key);
      },
      p.world.chunkSize,
    );
    this.streamer.update(this.controls.target.toArray() as Vec3);
    this.select(this.selected);
  }
  private syncProjectPartTransforms(p: Project) {
    syncPartVisualTransforms(this.parts, p);
  }
  restoreEditTransforms(p: Project) {
    this.project = p;
    this.syncProjectPartTransforms(p);
    // Play中はカメラがPhysics位置を追従するため、編集位置へ戻したマシンが
    // 画面外に残らないよう、角度とズームを保ったままターゲットを引き戻す。
    const parts = p.machines[0]?.parts;
    if (parts?.length) {
      const center = parts
        .reduce(
          (sum, part) => sum.add(new THREE.Vector3(...part.transform.position)),
          new THREE.Vector3(),
        )
        .divideScalar(parts.length);
      const delta = center.clone().sub(this.controls.target);
      this.camera.position.add(delta);
      this.controls.target.copy(center);
      this.controls.update();
      this.streamer?.update(this.controls.target.toArray() as Vec3);
    }
    this.select(this.selected);
  }
  select(id?: string) {
    this.selected = id;
    this.clear(this.selectionOutline);
    const selected = id ? this.parts.get(id) : undefined;
    if (selected) {
      selected.updateWorldMatrix(true, true);
      const outline = new THREE.BoxHelper(selected, "#ffcc5c");
      outline.material.depthTest = false;
      outline.renderOrder = 9;
      this.selectionOutline.add(outline);
    }
    this.parts.forEach((o, k) =>
      o.traverse((child) => {
        if (
          child instanceof THREE.Mesh &&
          child.material instanceof THREE.MeshStandardMaterial
        )
          child.material.emissive.set(k === id ? "#493718" : "#000000");
      }),
    );
  }
  showAttachmentCandidates(candidates: AttachmentCandidate[], preview?: Part) {
    this.clear(this.highlighted);
    this.clear(this.ghost);
    this.candidates = candidates;
    this.hoverId = undefined;
    this.ghost.visible = false;
    if (preview) {
      const visual = createPartVisual(preview, { ghost: true });
      visual.scale.fromArray(preview.transform.scale);
      this.ghost.add(visual);
    }
    this.canvas.style.cursor = "";
    for (const candidate of candidates) {
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.27, 20, 16),
        new THREE.MeshStandardMaterial({
          color: "#8bffff",
          emissive: "#39e9ef",
          emissiveIntensity: 0.8,
          depthTest: false,
        }),
      );
      sphere.position.fromArray(candidate.position);
      sphere.renderOrder = 10;
      sphere.userData.candidateId = candidate.id;
      sphere.userData.id = "attachment:" + candidate.id;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.34, 0.035, 8, 32),
        new THREE.MeshBasicMaterial({ color: "#efffff", depthTest: false }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.renderOrder = 11;
      ring.userData.candidateId = candidate.id;
      sphere.add(ring);
      this.highlighted.add(sphere);
    }
  }
  render(poses?: Map<string, Pose>, thrust = 0) {
    this.parts.forEach((visual) => {
      updateThrusterFlame(visual, thrust);
      updateMotorActivity(visual, thrust);
    });
    if (poses) {
      for (const [id, p] of poses) {
        const m = this.parts.get(id);
        if (m) {
          m.position.fromArray(p.position);
          m.quaternion.fromArray(p.rotation);
        }
      }
      const first = poses.values().next().value;
      if (first) {
        const target = new THREE.Vector3(...first.position),
          delta = target.clone().sub(this.controls.target);
        this.camera.position.add(delta.multiplyScalar(0.08));
        this.controls.target.lerp(target, 0.08);
      }
    } else if (this.project) this.syncProjectPartTransforms(this.project);
    this.highlighted.visible = !poses;
    this.selectionOutline.visible = !poses;
    this.streamer?.update(this.controls.target.toArray() as Vec3);
    this.controls.update();
    this.root.traverse((o) => o.userData.updateLod?.(this.camera.position));
    this.renderer.render(this.scene, this.camera);
    if (this.onCandidateScreens) {
      const rect = this.canvas.getBoundingClientRect();
      this.onCandidateScreens(
        this.highlighted.visible
          ? this.highlighted.children.map((o) => {
              const p = o.position.clone().project(this.camera);
              return {
                id: o.userData.candidateId as string,
                x: Math.round(((p.x + 1) * rect.width) / 2),
                y: Math.round(((1 - p.y) * rect.height) / 2),
              };
            })
          : [],
      );
    }
  }
  get stats() {
    const assetIds = new Set<string>();
    const files = new Map<string, number>();
    const textures = new Set<THREE.Texture>();
    const lodBatches = [0, 0, 0];
    let instanceBatches = 0;
    this.root.traverse((o) => {
      if (o.userData.lodLevel !== undefined) lodBatches[o.userData.lodLevel]++;
      if (o instanceof THREE.InstancedMesh) instanceBatches++;
      if (o.userData.runtimeFile)
        files.set(o.userData.runtimeFile, o.userData.runtimeBytes ?? 0);
      if (o instanceof THREE.Mesh)
        for (const material of Array.isArray(o.material)
          ? o.material
          : [o.material])
          for (const value of Object.values(material))
            if (value instanceof THREE.Texture) textures.add(value);
      if (o.userData.assetId && o.children.length)
        assetIds.add(o.userData.assetId);
    });
    const runtimeAssetBytes = [...files.values()].reduce((a, b) => a + b, 0);
    const textureMemoryEstimate = [...textures].reduce((sum, t) => {
      const image = t.image as { width?: number; height?: number } | undefined;
      return (
        sum +
        (image?.width ?? 0) *
          (image?.height ?? 0) *
          4 *
          (t.generateMipmaps ? 4 / 3 : 1)
      );
    }, 0);
    return {
      runtimeAssetBytes,
      instanceBatches,
      lod0Batches: lodBatches[0],
      lod1Batches: lodBatches[1],
      lod2Batches: lodBatches[2],
      runtimeBudgetExceeded: evaluateRuntimeBudget(
        this.project?.settings.runtimeProfile ?? "balanced",
        {
          loadedAssetBytes: runtimeAssetBytes,
          textureBytes: textureMemoryEstimate,
          triangles: this.renderer.info.render.triangles,
          drawCalls: this.renderer.info.render.calls,
        },
      ).length,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      loadedChunks: [...this.chunks.values()].filter((g) => g.visible).length,
      loadedAssets: assetIds.size,
      textureMemoryEstimate,
    };
  }
  dispose() {
    this.generation++;
    this.observer.disconnect();
    this.canvas.removeEventListener("pointerdown", this.pointerDown);
    this.canvas.removeEventListener("pointerup", this.pointerUp);
    this.canvas.removeEventListener("pointermove", this.pointerMove);
    this.canvas.removeEventListener("pointerleave", this.pointerLeave);
    this.canvas.removeEventListener("pointercancel", this.pointerCancel);
    this.controls.dispose();
    this.streamer?.dispose();
    this.chunkBuilders.clear();
    this.clear(this.root);
    this.clear(this.highlighted);
    this.clear(this.ghost);
    this.clear(this.selectionOutline);
    this.renderer.dispose();
  }
}
