import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Project, Vec3 } from "../../project-schema/src/index";
import type { Pose } from "../../physics-rapier/src/index";
import { chunkCoordinate } from "../../world-system/src/index";
import { terrainChunks, ChunkStreamer } from "../../world-system/src/streaming";
import { quaternion, rotate } from "../../machine-system/src/math";
export interface RendererAdapter {
  load(project: Project): void;
  render(poses?: Map<string, Pose>): void;
  dispose(): void;
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
  private selected?: string;
  private project?: Project;
  private streamer?: ChunkStreamer<THREE.Group>;
  private chunkBuilders = new Map<string, ((g: THREE.Group) => void)[]>();
  private sun!: THREE.DirectionalLight;
  private highlighted = new THREE.Group();
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
    if (!this.drawing || !this.stroke.length) return;
    const p = this.groundPoint(e),
      last = this.stroke.at(-1)!;
    if (p && Math.hypot(p[0] - last[0], p[2] - last[2]) > 1)
      this.stroke.push(p);
  };
  private down = [0, 0];
  private pointerDown = (e: PointerEvent) => {
    this.down = [e.clientX, e.clientY];
    if (this.drawing) {
      const p = this.groundPoint(e);
      this.stroke = p ? [p] : [];
      this.controls.enabled = false;
      this.canvas.setPointerCapture(e.pointerId);
    }
  };
  private pointerUp = (e: PointerEvent) => {
    if (this.drawing) {
      const points = this.stroke;
      this.stroke = [];
      this.controls.enabled = true;
      if (points.length > 1) {
        this.onStroke?.(points);
        return;
      }
    }
    if (Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) > 5)
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
    const hits = ray.intersectObjects(
      [...this.highlighted.children, ...this.root.children],
      true,
    );
    const h = hits[0];
    if (h) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.id) o = o.parent;
      this.onPick?.(o?.userData.id, [h.point.x, h.point.y, h.point.z]);
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
    this.scene.add(sun, this.root, this.highlighted);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    canvas.addEventListener("pointerdown", this.pointerDown);
    canvas.addEventListener("pointerup", this.pointerUp);
    canvas.addEventListener("pointermove", this.pointerMove);
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
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
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
  load(p: Project) {
    this.project = p;
    const generation = ++this.generation;
    this.streamer?.dispose();
    this.chunkBuilders.clear();
    this.clear(this.root);
    this.clear(this.highlighted);
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
        const s = part.physics.size,
          visual = new THREE.Group();
        const shape =
          part.definitionId === "Wheel"
            ? new THREE.CylinderGeometry(s[1], s[1], s[0], 24)
            : new THREE.BoxGeometry(...s);
        if (part.definitionId === "Wheel") shape.rotateZ(Math.PI / 2);
        const mesh = this.mesh(shape, part.visual.color);
        visual.add(mesh);
        if (part.definitionId === "Wheel") {
          const hub = this.mesh(
            new THREE.CylinderGeometry(
              s[1] * 0.45,
              s[1] * 0.45,
              s[0] + 0.03,
              16,
            ),
            "#d6dde0",
          );
          hub.rotation.z = Math.PI / 2;
          visual.add(hub);
        }
        if (part.definitionId === "Panel") {
          const seat = this.mesh(
            new THREE.BoxGeometry(0.65, 0.5, 0.8),
            "#3f6570",
          );
          seat.position.y = 0.4;
          visual.add(seat);
        }
        visual.position.fromArray(part.transform.position);
        visual.rotation.fromArray([...part.transform.rotation, "XYZ"]);
        visual.scale.fromArray(part.transform.scale);
        visual.userData.id = part.id;
        group.add(visual);
        this.parts.set(part.id, visual);
      }
    }
    for (const e of p.world.entities) {
      const key = chunkCoordinate(e.transform.position, p.world.chunkSize).join(
        ",",
      );
      const builders = this.chunkBuilders.get(key) ?? [];
      builders.push((chunk) => {
        const group = new THREE.Group();
        group.userData.id = e.id;
        group.userData.assetId = e.assetId;
        group.position.fromArray(e.transform.position);
        group.rotation.fromArray([...e.transform.rotation, "XYZ"]);
        group.scale.fromArray(e.transform.scale);
        chunk.add(group);
        if (e.kind === "asset") {
          const asset = p.assets.find((a) => a.id === e.assetId);
          if (asset?.files.runtime)
            new GLTFLoader().load(
              asset.files.runtime,
              (g) => {
                if (generation !== this.generation || !chunk.parent) {
                  this.clear(g.scene);
                  return;
                }
                g.scene.traverse((o) => {
                  o.castShadow = true;
                  o.receiveShadow = true;
                });
                group.add(g.scene);
              },
              undefined,
              () => {
                if (generation !== this.generation || !chunk.parent) return;
                group.add(
                  this.mesh(new THREE.IcosahedronGeometry(0.7, 1), "#b68383"),
                );
              },
            );
        } else if (e.kind === "tree") {
          const trunk = this.mesh(
            new THREE.CylinderGeometry(0.15, 0.2, 1.5, 8),
            "#856349",
          );
          trunk.position.y = 0.75;
          const leaves = this.mesh(
            new THREE.ConeGeometry(1, 2.4, 8),
            "#3e7956",
          );
          leaves.position.y = 2;
          group.add(trunk, leaves);
        } else {
          const mesh = this.mesh(
            e.kind === "rock"
              ? new THREE.IcosahedronGeometry(0.8, 1)
              : new THREE.BoxGeometry(2, 3, 2),
            e.kind === "rock" ? "#8b9790" : "#d4c6a8",
          );
          mesh.position.y = e.kind === "rock" ? 0.5 : 1.5;
          group.add(mesh);
        }
      });
      this.chunkBuilders.set(key, builders);
    }
    for (const c of p.courses) {
      if (c.path.length > 1) {
        for (let i = 1; i < c.path.length; i++) {
          const a = new THREE.Vector3(...c.path[i - 1]),
            b = new THREE.Vector3(...c.path[i]),
            len = a.distanceTo(b),
            road = this.mesh(new THREE.BoxGeometry(4, 0.08, len), "#b8aa89");
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
    if (p.machines[0]) this.showConnectors(p.machines[0].id);
  }
  select(id?: string) {
    this.selected = id;
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
  showConnectors(machineId: string) {
    this.clear(this.highlighted);
    const m = this.project?.machines.find((a) => a.id === machineId),
      panel = m?.parts.find((p) => p.definitionId === "Panel");
    if (!panel || !m) return;
    for (const c of panel.connectors) {
      if (
        m.connections.some(
          (a) =>
            a.a === panel.id &&
            a.connectorA === c.id &&
            m.parts.some((p) => p.id === a.b && p.definitionId === "Wheel"),
        )
      )
        continue;
      const sphere = this.mesh(
        new THREE.SphereGeometry(0.2, 16, 12),
        "#7af2e1",
      );
      sphere.position.fromArray(
        rotate(
          c.position.map((n, i) => n * panel.transform.scale[i]) as Vec3,
          quaternion(panel.transform.rotation),
        ).map((n, i) => n + panel.transform.position[i]) as Vec3,
      );
      sphere.userData.id = `connector:${c.id}`;
      this.highlighted.add(sphere);
    }
  }
  render(poses?: Map<string, Pose>) {
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
    }
    this.highlighted.visible = !poses;
    this.streamer?.update(this.controls.target.toArray() as Vec3);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
  get stats() {
    const assetIds = new Set<string>();
    this.root.traverse((o) => {
      if (o.userData.assetId && o.children.length)
        assetIds.add(o.userData.assetId);
    });
    return {
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      loadedChunks: [...this.chunks.values()].filter((g) => g.visible).length,
      loadedAssets: assetIds.size,
      textureMemoryEstimate: this.renderer.info.memory.textures * 1024 * 1024,
    };
  }
  dispose() {
    this.generation++;
    this.observer.disconnect();
    this.canvas.removeEventListener("pointerdown", this.pointerDown);
    this.canvas.removeEventListener("pointerup", this.pointerUp);
    this.canvas.removeEventListener("pointermove", this.pointerMove);
    this.controls.dispose();
    this.streamer?.dispose();
    this.chunkBuilders.clear();
    this.clear(this.root);
    this.clear(this.highlighted);
    this.renderer.dispose();
  }
}
