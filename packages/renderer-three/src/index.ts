import { evaluateRuntimeBudget } from "../../asset-core/src/profiles";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  AssetTemplates,
  WorldAssetBatch,
  builtinTemplate,
  disposeTemplate,
  instanceTemplate,
} from "./instances";
import {
  activeCourse,
  type Project,
  type Part,
  type Vec3,
} from "../../project-schema/src/index";
import type { PhysicsRenderState } from "../../physics-rapier/src/index";
import { groupInstances, WorldRuntime } from "../../world-system/src/index";
import {
  ChunkStreamer,
  renderStreaming,
} from "../../world-system/src/streaming";
import {
  EDITOR_CHUNK_RADIUS,
  RENDER_CHUNK_RADIUS,
} from "../../world-generator/src/index";
import {
  PrefetchRetentionState,
  visibleChunks,
} from "../../world-system/src/chunks";
import { preparedChunkLocalOrigin } from "../../world-system/src/runtime";
import { type AttachmentCandidate } from "../../machine-system/src/index";
import {
  createPartVisual,
  updateMotorActivity,
  updateSuspensionVisual,
  updateThrusterFlame,
} from "./part-visuals";
import { SHADOW_EXTENT_M, cameraFollowAlpha, sunFollowPose } from "./follow";
import { interpolatePhysicsRenderState } from "./interpolation";
export { createPartVisual };
export type { PartVisualOptions } from "./part-visuals";
export {
  CAMERA_FOLLOW_LAMBDA,
  SHADOW_EXTENT_M,
  SHADOW_LIGHT_DISTANCE_M,
  cameraFollowAlpha,
  sunDirectionFromTimeOfDay,
  sunFollowPose,
} from "./follow";
export {
  interpolatePhysicsRenderState,
  interpolatePose,
} from "./interpolation";
/** Play中のカメラ俯仰上限（水平手前まで）。 */
export const PLAY_MAX_POLAR_ANGLE = Math.PI * 0.48;
/** 編集中は下面も見られるよう、ほぼ全周まで回せる。 */
export const EDIT_MAX_POLAR_ANGLE = Math.PI * 0.95;
export interface RenderFrameOptions {
  previous?: PhysicsRenderState;
  alpha?: number;
  dt?: number;
  velocity?: Vec3;
}
export interface RendererAdapter {
  load(project: Project): void;
  restoreEditTransforms(project: Project): void;
  render(
    state?: PhysicsRenderState,
    thrust?: number,
    options?: RenderFrameOptions,
  ): void;
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
      if (part.definitionId === "Suspension") {
        const wheelConnection = machine.connections.find(
          (item) =>
            item.a === part.id &&
            item.type === "revolute" &&
            machine.parts.some(
              (candidate) =>
                candidate.id === item.b && candidate.definitionId === "Wheel",
            ),
        );
        const wheel = wheelConnection
          ? machine.parts.find(
              (candidate) => candidate.id === wheelConnection.b,
            )
          : undefined;
        const wheelRadius = wheel
          ? wheel.physics.size[1] * wheel.transform.scale[1]
          : 0;
        updateSuspensionVisual(
          visual,
          part.physics.suspension?.restLength ?? 0.55,
          [0, -1, 0],
          wheelRadius,
        );
      }
    }
}
export class ThreeRenderer implements RendererAdapter {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2500);
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
  private sharedBuiltinTemplates = new Map<
    "tree" | "rock" | "building",
    THREE.Group
  >();
  private lastStreamStats = {
    created: 0,
    pending: 0,
    commitMs: 0,
    normalsMs: 0,
  };
  private frameNormalsMs = 0;
  private lastVelocity?: Vec3;
  private readonly lodBatches = new Set<WorldAssetBatch>();
  private lodFrameIndex = 0;
  private prefetchRetention = new PrefetchRetentionState();
  private instanceBatchCount = 0;
  private lodLevelCounts = [0, 0, 0];
  worldRuntime?: WorldRuntime;
  private ownsRuntime = false;
  private waterMesh?: THREE.Mesh;
  private gridHelper?: THREE.Object3D;
  private sun!: THREE.DirectionalLight;
  private highlighted = new THREE.Group();
  private selectionOutline = new THREE.Group();
  private ghost = new THREE.Group();
  private candidates: AttachmentCandidate[] = [];
  private hoverId?: string;
  /** EDIT中は true。地面を隠し、カメラを下面まで回せる。 */
  private editWorkspace = true;
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
    this.controls.maxPolarAngle = EDIT_MAX_POLAR_ANGLE;
    this.scene.add(new THREE.HemisphereLight(0xe4f4ff, 0x6b7253, 2));
    const sun = (this.sun = new THREE.DirectionalLight(0xfff0d0, 3));
    sun.position.set(15, 25, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -SHADOW_EXTENT_M;
    sun.shadow.camera.right = SHADOW_EXTENT_M;
    sun.shadow.camera.top = SHADOW_EXTENT_M;
    sun.shadow.camera.bottom = -SHADOW_EXTENT_M;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = SHADOW_EXTENT_M * 3;
    sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(
      sun,
      sun.target,
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
  load(
    p: Project,
    options?: { courseId?: string | null; world?: WorldRuntime },
  ) {
    this.project = p;
    this.editWorkspace = true;
    ++this.generation;
    this.ownsRuntime = !options?.world;
    this.worldRuntime = options?.world ?? new WorldRuntime(p.world);
    this.streamer?.dispose();
    this.chunkBuilders.clear();
    this.waterMesh = undefined;
    this.gridHelper = undefined;
    this.clear(this.root);
    this.showAttachmentCandidates([]);
    this.parts.clear();
    this.machines.clear();
    this.chunks.clear();
    this.scene.background = new THREE.Color(p.world.environment.sky);
    this.scene.fog = this.editWorkspace
      ? null
      : new THREE.FogExp2(p.world.environment.sky, p.world.environment.fog);
    this.sun.intensity = p.world.lighting.intensity;
    this.updateShadowFollow([0, 0, 0]);
    const grid = new THREE.GridHelper(128, 64, 0x9cae85, 0x9cae85);
    grid.position.y = 0.015;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.18;
    this.root.add(grid);
    this.gridHelper = grid;
    if (p.world.water.enabled) {
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(800, 800),
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
      this.waterMesh = water;
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
    this.syncProjectPartTransforms(p);
    this.applyEditWorkspaceVisuals();
    for (const [batchKey, entities] of groupInstances(p)) {
      const key = batchKey.split(":")[0];
      const builders = this.chunkBuilders.get(key) ?? [];
      builders.push((chunk) => {
        const asset = p.assets.find((a) => a.id === entities[0].assetId);
        const batch = new WorldAssetBatch(entities, asset, this.templates);
        this.lodBatches.add(batch);
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
    this.clearSharedBuiltinTemplates();
    this.lodBatches.clear();
    this.prefetchRetention.reset();
    this.streamer = new ChunkStreamer(
      (key) => {
        const group = new THREE.Group();
        const prepared = this.worldRuntime?.peekPreparedChunk(key);
        const chunkLocalOrigin = prepared
          ? preparedChunkLocalOrigin(prepared, this.worldRuntime!.worldOrigin)
          : undefined;
        if (prepared && chunkLocalOrigin) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute(
            "position",
            new THREE.BufferAttribute(prepared.positions, 3),
          );
          geo.setAttribute(
            "normal",
            new THREE.BufferAttribute(prepared.normals, 3),
          );
          geo.setAttribute(
            "color",
            new THREE.BufferAttribute(prepared.colors, 3),
          );
          geo.setIndex(new THREE.BufferAttribute(prepared.indices, 1));
          // Main Thread では Terrain Normal / Color を再計算しない。
          const mesh = new THREE.Mesh(
            geo,
            new THREE.MeshStandardMaterial({
              vertexColors: true,
              roughness: 1,
            }),
          );
          mesh.receiveShadow = true;
          group.add(mesh);
          group.position.set(
            chunkLocalOrigin[0],
            chunkLocalOrigin[1],
            chunkLocalOrigin[2],
          );
        } else {
          const data = this.worldRuntime?.meshFor(key);
          if (data) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute(
              "position",
              new THREE.Float32BufferAttribute(
                new Float32Array(data.vertices),
                3,
              ),
            );
            geo.setIndex(data.indices);
            geo.setAttribute(
              "color",
              new THREE.Float32BufferAttribute(
                new Float32Array(
                  data.colors.flatMap((hex) => new THREE.Color(hex).toArray()),
                ),
                3,
              ),
            );
            const normalsStarted = performance.now();
            geo.computeVertexNormals();
            this.frameNormalsMs += performance.now() - normalsStarted;
            const mesh = new THREE.Mesh(
              geo,
              new THREE.MeshStandardMaterial({
                vertexColors: true,
                roughness: 1,
              }),
            );
            mesh.receiveShadow = true;
            group.add(mesh);
          }
        }
        const generated =
          this.worldRuntime?.peekChunk(key)?.entities ??
          (this.worldRuntime?.isPlayHotPath
            ? []
            : (this.worldRuntime?.getChunk(key)?.entities ?? []));
        const byKind = new Map<string, typeof generated>();
        for (const entity of generated) {
          const list = byKind.get(entity.kind) ?? [];
          list.push(entity);
          byKind.set(entity.kind, list);
        }
        for (const [kind, entities] of byKind) {
          const template = this.sharedBuiltinTemplate(
            kind as "tree" | "rock" | "building",
          );
          group.add(
            instanceTemplate(
              template,
              entities.map((entity) => {
                const sim = this.worldRuntime!.toSimulation(entity.position);
                const position: Vec3 = chunkLocalOrigin
                  ? [
                      sim[0] - chunkLocalOrigin[0],
                      sim[1] - chunkLocalOrigin[1],
                      sim[2] - chunkLocalOrigin[2],
                    ]
                  : sim;
                return {
                  id: entity.id,
                  name: entity.name,
                  kind: entity.kind,
                  transform: {
                    position,
                    rotation: entity.rotation,
                    scale: entity.scale,
                  },
                };
              }),
            ),
          );
          this.instanceBatchCount++;
        }
        for (const build of this.chunkBuilders.get(key) ?? []) build(group);
        if (!group.children.length) return;
        this.root.add(group);
        this.chunks.set(key, group);
        return group;
      },
      (group) => {
        group.removeFromParent();
        this.clear(group);
        for (const [key, value] of this.chunks)
          if (value === group) this.chunks.delete(key);
      },
      this.worldRuntime?.chunkSize ?? p.world.chunkSize,
      this.worldRuntime?.procedural ? RENDER_CHUNK_RADIUS : 2,
      this.worldRuntime?.procedural ? RENDER_CHUNK_RADIUS + 1 : 3,
      this.worldRuntime?.procedural
        ? {
            maxCreatesPerUpdate: renderStreaming.maxCreatesPerUpdate,
            budgetMs: renderStreaming.budgetMs,
            urgentRadius: renderStreaming.urgentRadius,
            prefetch: {
              aheadMax: renderStreaming.prefetchAheadMax,
              futureHorizonsSec: renderStreaming.futureHorizonsSec,
              retention: this.prefetchRetention,
              retentionSec: renderStreaming.retentionSec,
            },
          }
        : undefined,
    );
    this.streamer.update(this.controls.target.toArray() as Vec3);
    this.applyEditWorkspaceVisuals();
    this.select(this.selected);
  }
  private syncProjectPartTransforms(p: Project) {
    syncPartVisualTransforms(this.parts, p);
  }
  /** 編集中は地面・地形を隠し、カメラを下面まで回せる。Playでは元に戻す。 */
  private applyEditWorkspaceVisuals() {
    const showWorld = !this.editWorkspace;
    this.controls.maxPolarAngle = this.editWorkspace
      ? EDIT_MAX_POLAR_ANGLE
      : PLAY_MAX_POLAR_ANGLE;
    const sky = this.project?.world.environment.sky ?? "#cfe8f5";
    const fogDensity = this.project?.world.environment.fog ?? 0.01;
    this.scene.fog = showWorld ? new THREE.FogExp2(sky, fogDensity) : null;
    if (this.gridHelper) this.gridHelper.visible = showWorld;
    if (this.waterMesh) this.waterMesh.visible = showWorld;
    for (const chunk of this.chunks.values()) chunk.visible = showWorld;
    const machines = new Set(this.machines.values());
    for (const child of this.root.children) {
      if (machines.has(child as THREE.Group)) continue;
      if (child === this.gridHelper || child === this.waterMesh) continue;
      if ([...this.chunks.values()].includes(child as THREE.Group)) continue;
      // 道路・ゲートなど地形まわりも編集中は出さない。
      child.visible = showWorld;
    }
  }
  setEditMachineLift(enabled: boolean) {
    // 互換API名。実体は編集ワークスペース（地面非表示＋カメラ制限）の切替。
    this.editWorkspace = enabled;
    this.applyEditWorkspaceVisuals();
  }
  shiftOrigin(delta: Vec3) {
    this.camera.position.x -= delta[0];
    this.camera.position.y -= delta[1];
    this.camera.position.z -= delta[2];
    this.controls.target.x -= delta[0];
    this.controls.target.y -= delta[1];
    this.controls.target.z -= delta[2];
    const chunkGroups = new Set(this.chunks.values());
    for (const group of chunkGroups) {
      group.position.x -= delta[0];
      group.position.z -= delta[2];
    }
    const machines = new Set(this.machines.values());
    for (const child of this.root.children) {
      if (machines.has(child as THREE.Group)) continue;
      if (child === this.gridHelper || child === this.waterMesh) continue;
      if (chunkGroups.has(child as THREE.Group)) continue;
      child.position.x -= delta[0];
      child.position.z -= delta[2];
    }
    this.sun.position.x -= delta[0];
    this.sun.position.y -= delta[1];
    this.sun.position.z -= delta[2];
    this.sun.target.position.x -= delta[0];
    this.sun.target.position.y -= delta[1];
    this.sun.target.position.z -= delta[2];
    this.controls.update();
  }
  applyOriginShift(delta: Vec3) {
    this.shiftOrigin(delta);
  }
  private updateShadowFollow(focus: Vec3) {
    const timeOfDay = this.project?.world.lighting.timeOfDay ?? 14;
    const pose = sunFollowPose(focus, timeOfDay);
    this.sun.position.set(...pose.position);
    this.sun.target.position.set(...pose.target);
    this.sun.shadow.camera.left = -SHADOW_EXTENT_M;
    this.sun.shadow.camera.right = SHADOW_EXTENT_M;
    this.sun.shadow.camera.top = SHADOW_EXTENT_M;
    this.sun.shadow.camera.bottom = -SHADOW_EXTENT_M;
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = SHADOW_EXTENT_M * 3;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }
  get shadowState() {
    return {
      light: this.sun.position.toArray() as Vec3,
      target: this.sun.target.position.toArray() as Vec3,
      left: this.sun.shadow.camera.left,
      right: this.sun.shadow.camera.right,
      top: this.sun.shadow.camera.top,
      bottom: this.sun.shadow.camera.bottom,
    };
  }
  restoreEditTransforms(p: Project) {
    this.project = p;
    this.editWorkspace = true;
    this.syncProjectPartTransforms(p);
    this.applyEditWorkspaceVisuals();
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
  render(
    state?: PhysicsRenderState,
    thrust = 0,
    options: RenderFrameOptions = {},
  ) {
    this.parts.forEach((visual) => {
      updateThrusterFlame(visual, thrust);
      updateMotorActivity(visual, thrust);
    });
    const interpolated =
      state && options.previous && options.alpha !== undefined
        ? interpolatePhysicsRenderState(options.previous, state, options.alpha)
        : state;
    const poses = interpolated?.poses;
    const wheels = interpolated?.wheels;
    if (poses) {
      this.editWorkspace = false;
      this.applyEditWorkspaceVisuals();
      for (const [id, p] of poses) {
        const m = this.parts.get(id);
        if (m) {
          m.position.fromArray(p.position);
          m.quaternion.fromArray(p.rotation);
        }
      }
      for (const machine of this.project?.machines ?? []) {
        for (const suspension of machine.parts.filter(
          (part) => part.definitionId === "Suspension",
        )) {
          const connection = machine.connections.find(
            (item) =>
              item.a === suspension.id &&
              item.type === "revolute" &&
              machine.parts.some(
                (part) => part.id === item.b && part.definitionId === "Wheel",
              ),
          );
          const top = poses.get(suspension.id),
            wheel = connection ? poses.get(connection.b) : undefined,
            wheelState = connection ? wheels?.get(connection.b) : undefined,
            visual = this.parts.get(suspension.id);
          if (!top || !wheel || !wheelState || !visual) continue;
          const topQuaternion = new THREE.Quaternion(...top.rotation),
            localDirection = new THREE.Vector3(
              ...wheelState.suspensionDirectionWorld,
            ).applyQuaternion(topQuaternion.clone().invert());
          updateSuspensionVisual(
            visual,
            wheelState.suspensionLengthM,
            [localDirection.x, localDirection.y, localDirection.z],
            wheelState.wheelRadiusM ?? 0,
          );
        }
      }
      const first = poses.values().next().value;
      if (first) {
        const target = new THREE.Vector3(...first.position),
          follow = cameraFollowAlpha(options.dt ?? 1 / 60),
          delta = target.clone().sub(this.controls.target);
        this.camera.position.add(delta.multiplyScalar(follow));
        this.controls.target.lerp(target, follow);
      }
    } else if (this.project) {
      this.editWorkspace = true;
      this.syncProjectPartTransforms(this.project);
      this.applyEditWorkspaceVisuals();
    }
    this.highlighted.visible = !poses;
    this.selectionOutline.visible = !poses;
    const focus = this.controls.target.toArray() as Vec3;
    const global = this.worldRuntime?.toGlobal(focus) ?? focus;
    const velocity = options?.velocity ?? this.lastVelocity;
    if (velocity) this.lastVelocity = velocity;
    if (this.worldRuntime) {
      const keys = new Set<string>();
      const size = this.worldRuntime.chunkSize;
      const radius = this.worldRuntime.procedural
        ? poses
          ? RENDER_CHUNK_RADIUS
          : EDITOR_CHUNK_RADIUS
        : 2;
      for (const key of visibleChunks(global, size, radius)) keys.add(key);
      this.worldRuntime.acquire(poses ? "renderer" : "editor", keys);
      this.worldRuntime.requestChunks(
        [...keys].map((key) => ({
          key,
          priority: poses
            ? ("P2_VISIBLE_RENDER" as const)
            : ("P4_EDITOR" as const),
        })),
      );
      this.worldRuntime.enqueuePrefetch(keys);
      // Frame 遅延時は Render Commit を skip 可能。
      const skipCommit = (options.dt ?? 0) > 0.033;
      this.worldRuntime.commitGeneralWithinBudget({ skip: skipCommit });
    }
    const stream = this.streamer?.update(global, velocity);
    if (stream) {
      this.lastStreamStats = {
        created: stream.created,
        pending: stream.pending,
        commitMs: stream.commitMs,
        normalsMs: this.drainNormalsMs(),
      };
    }
    // ストリーミングで新規chunkが入っても編集中は地面を出さない。
    if (this.editWorkspace) this.applyEditWorkspaceVisuals();
    if (this.waterMesh) {
      this.waterMesh.position.x = this.camera.position.x;
      this.waterMesh.position.z = this.camera.position.z;
    }
    if (this.gridHelper) {
      const size = 32;
      this.gridHelper.position.x =
        Math.round(this.controls.target.x / size) * size;
      this.gridHelper.position.z =
        Math.round(this.controls.target.z / size) * size;
    }
    this.controls.update();
    this.updateShadowFollow(this.controls.target.toArray() as Vec3);
    this.updateLodBatches();
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
    const lodBatches = [...this.lodLevelCounts];
    let instanceBatches = this.instanceBatchCount;
    for (const batch of this.lodBatches) {
      const level = batch.group.userData.lodLevel;
      if (typeof level === "number" && level >= 0 && level < 3)
        lodBatches[level]++;
      if (batch.group.userData.runtimeFile)
        files.set(
          batch.group.userData.runtimeFile,
          batch.group.userData.runtimeBytes ?? 0,
        );
      if (batch.group.userData.assetId)
        assetIds.add(batch.group.userData.assetId);
    }
    // テクスチャ推定のみ必要時に軽量スキャン（LOD traverse はしない）。
    this.root.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) instanceBatches++;
      if (o instanceof THREE.Mesh)
        for (const material of Array.isArray(o.material)
          ? o.material
          : [o.material])
          for (const value of Object.values(material))
            if (value instanceof THREE.Texture) textures.add(value);
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
      renderChunksCreated: this.lastStreamStats.created,
      renderChunkPending: this.lastStreamStats.pending,
      renderCommitMs: this.lastStreamStats.commitMs,
      normalsMs: this.lastStreamStats.normalsMs,
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
    this.clearSharedBuiltinTemplates();
    if (this.ownsRuntime) this.worldRuntime?.dispose();
    this.clear(this.root);
    this.clear(this.highlighted);
    this.clear(this.ghost);
    this.clear(this.selectionOutline);
    this.renderer.dispose();
  }

  private sharedBuiltinTemplate(kind: "tree" | "rock" | "building") {
    let template = this.sharedBuiltinTemplates.get(kind);
    if (!template) {
      template = builtinTemplate(kind);
      this.sharedBuiltinTemplates.set(kind, template);
    }
    return template;
  }

  private clearSharedBuiltinTemplates() {
    for (const template of this.sharedBuiltinTemplates.values())
      disposeTemplate(template);
    this.sharedBuiltinTemplates.clear();
  }

  /** LOD 更新を専用 Collection で分散する（root.traverse を使わない）。 */
  private updateLodBatches() {
    this.lodFrameIndex++;
    const camera = this.camera.position;
    let index = 0;
    for (const batch of this.lodBatches) {
      if (index++ % 4 === this.lodFrameIndex % 4) batch.update(camera);
    }
  }

  private drainNormalsMs() {
    const value = this.frameNormalsMs;
    this.frameNormalsMs = 0;
    return value;
  }
}
