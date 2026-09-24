import { expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  contactEmission,
  vaporEmission,
  washEmission,
} from "../../packages/renderer-three/src/effects/effect-config";
import { EffectParticleSystem } from "../../packages/renderer-three/src/effects/particle-system";
import { VisualEffects } from "../../packages/renderer-three/src/effects/visual-effects";
import {
  createPart,
  planeTemplate,
} from "../../packages/machine-system/src/index";
import { emptyProject } from "../../packages/project-schema/src/index";
import type { PhysicsRenderState } from "../../packages/physics-rapier/src/index";

it("速度・接地・推力・描画地面hitだけで発生量を決める", () => {
  expect(vaporEmission(0)).toBe(0);
  expect(vaporEmission(17.99)).toBe(0);
  expect(vaporEmission(35)).toBeGreaterThan(0);
  expect(vaporEmission(100)).toBe(vaporEmission(35));
  expect(contactEmission(35, false)).toBe(0);
  expect(contactEmission(0, true)).toBe(0);
  expect(contactEmission(35, true)).toBeGreaterThan(0);
  expect(washEmission(0, true)).toBe(0);
  expect(washEmission(1, false)).toBe(0);
  expect(washEmission(1, true)).toBeGreaterThan(0);
});
it("固定プールの上限、寿命、原点移動、決定論的リセットとdispose", () => {
  const pool = new EffectParticleSystem(2, true);
  const point = new THREE.Vector3(10, 20, 30);
  for (let i = 0; i < 10; i++) pool.emit(point);
  expect(pool.activeCount).toBe(2);
  pool.shiftOrigin([2, 3, 4]);
  expect(Array.from(pool.positions.slice(0, 3))).toEqual([8, 17, 26]);
  pool.update(2);
  expect(pool.activeCount).toBe(0);
  expect(pool.points.visible).toBe(false);
  pool.clear();
  pool.emit(point);
  pool.update(0.1);
  const first = pool.positions.slice(0, 3);
  pool.clear();
  pool.emit(point);
  pool.update(0.1);
  expect(pool.positions.slice(0, 3)).toEqual(first);
  const geometry = vi.spyOn(pool.geometry, "dispose");
  const material = vi.spyOn(pool.material, "dispose");
  pool.dispose();
  expect(geometry).toHaveBeenCalledOnce();
  expect(material).toHaveBeenCalledOnce();
});
it("左右主翼の2点だけを姿勢変換し、粒子は機体移動と独立して残す", () => {
  const project = emptyProject();
  project.machines = [planeTemplate()];
  const parts = new Map<string, THREE.Object3D>();
  for (const part of project.machines[0].parts) {
    const visual = new THREE.Group();
    visual.position.fromArray(part.transform.position);
    visual.rotation.set(...part.transform.rotation);
    visual.scale.fromArray(part.transform.scale);
    parts.set(part.id, visual);
  }
  const effects = new VisualEffects();
  effects.load(project, parts);
  expect(effects.vaporEmitters).toBe(2);
  const state: PhysicsRenderState = {
    poses: new Map(),
    wheels: new Map(),
    effectInputs: new Map(
      project.machines[0].parts.map((part) => [
        part.id,
        { velocity: [0, 0, 40] as [number, number, number], thrust: 1 },
      ]),
    ),
  };
  effects.update(state, 0.05, new Map(), 720);
  expect(effects.vapor.activeCount).toBe(20);
  const before = effects.vapor.positions.slice(0, 3);
  for (const visual of parts.values()) visual.position.z += 10;
  effects.update(state, 0.05, new Map(), 720);
  expect(effects.vapor.positions.slice(0, 3)).toEqual(before);
  effects.shiftOrigin([10, 2, 3]);
  expect(effects.vapor.positions[0]).toBeCloseTo(before[0] - 10);
  effects.update(undefined, 0.05, new Map(), 720);
  expect(effects.vapor.activeCount).toBe(0);
  effects.update(state, 0.05, new Map(), 720);
  effects.load(project, parts);
  expect(effects.vapor.activeCount).toBe(0);
  effects.dispose();
});
it("排気方向の描画地形だけを低頻度で照射し、地面から離れると停止する", () => {
  const project = emptyProject();
  project.machines = [planeTemplate()];
  const thruster = createPart("Thruster");
  project.machines[0].parts = [thruster];
  const visual = new THREE.Group();
  visual.position.y = 1;
  visual.rotation.x = -Math.PI / 2;
  const effects = new VisualEffects();
  effects.load(project, new Map([[thruster.id, visual]]));
  const terrain = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshBasicMaterial(),
  );
  terrain.rotation.x = -Math.PI / 2;
  terrain.userData.vfxTerrain = true;
  const chunk = new THREE.Group();
  chunk.add(terrain);
  const chunks = new Map([["0,0", chunk]]);
  const raycast = vi.spyOn(terrain, "raycast");
  const state: PhysicsRenderState = {
    poses: new Map(),
    wheels: new Map(),
    effectInputs: new Map(
      project.machines[0].parts.map((part) => [
        part.id,
        { velocity: [0, 0, 40] as [number, number, number], thrust: 1 },
      ]),
    ),
  };
  effects.update(state, 0.05, chunks, 720);
  expect(effects.smoke.activeCount).toBeGreaterThan(0);
  expect(effects.smoke.positions[1]).toBeGreaterThan(0);
  effects.update(state, 0.01, chunks, 720);
  expect(raycast).toHaveBeenCalledTimes(1);
  visual.position.y = 10;
  for (let i = 0; i < 30; i++) effects.update(state, 0.05, chunks, 720);
  expect(effects.smoke.activeCount).toBe(0);
  effects.dispose();
  terrain.geometry.dispose();
  terrain.material.dispose();
});

it("MachineとPartごとの速度・推力を分離し、欠損入力を他Partで補わない", () => {
  const project = emptyProject();
  project.machines = [planeTemplate(), planeTemplate()];
  const visuals = new Map<string, THREE.Object3D>();
  const inputs = new Map<
    string,
    { thrust: number; velocity: [number, number, number] }
  >();
  const thrusters = [];
  for (let machineIndex = 0; machineIndex < 2; machineIndex++) {
    const panel = createPart("Panel");
    panel.metadata.visualEffects = { wingVapor: true };
    const thruster = createPart("Thruster");
    thrusters.push(thruster);
    project.machines[machineIndex].parts = [panel, thruster];
    for (const part of [panel, thruster]) {
      const visual = new THREE.Group();
      visual.position.set(machineIndex * 10, 1, 0);
      if (part === thruster) visual.rotation.x = -Math.PI / 2;
      visuals.set(part.id, visual);
      inputs.set(part.id, {
        velocity: [0, 0, machineIndex === 0 ? 40 : 5],
        thrust: machineIndex === 0 ? 0 : 1,
      });
    }
  }
  const terrain = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshBasicMaterial(),
  );
  terrain.rotation.x = -Math.PI / 2;
  terrain.userData.vfxTerrain = true;
  const chunk = new THREE.Group();
  chunk.add(terrain);
  const effects = new VisualEffects();
  effects.load(project, visuals);
  const state: PhysicsRenderState = {
    poses: new Map(),
    wheels: new Map(),
    effectInputs: inputs,
  };
  const chunks = new Map([["0,0", chunk]]);
  effects.update(state, 0.05, chunks, 720);
  expect(effects.vapor.activeCount).toBe(10);
  expect(effects.vapor.positions[0]).toBeLessThan(2);
  expect(effects.smoke.activeCount).toBe(1);
  expect(effects.smoke.positions[0]).toBeGreaterThan(9);
  inputs.delete(thrusters[1].id);
  for (let frame = 0; frame < 30; frame++)
    effects.update(state, 0.05, chunks, 720);
  expect(effects.smoke.activeCount).toBe(0);
  effects.dispose();
  terrain.geometry.dispose();
  terrain.material.dispose();
});

it.each([
  [3, -4, 0],
  [0, 0, 0],
] as [number, number, number][])(
  "接地煙はサスペンション方向%s,%s,%sを正規化して車輪半径だけずらす",
  (x, y, z) => {
    const project = emptyProject();
    project.machines = [planeTemplate()];
    const wheel = createPart("Wheel");
    project.machines[0].parts = [wheel];
    const effects = new VisualEffects();
    effects.load(project, new Map([[wheel.id, new THREE.Group()]]));
    const state: PhysicsRenderState = {
      poses: new Map(),
      wheels: new Map([
        [
          wheel.id,
          {
            partId: wheel.id,
            pose: { position: [10, 20, 30], rotation: [0, 0, 0, 1] },
            suspensionDirectionWorld: [x, y, z],
            wheelRadiusM: 2,
            inContact: true,
            suspensionLengthM: 1,
            restLengthM: 1,
            maxTravelM: 1,
            minimumLengthM: 0,
          },
        ],
      ]),
      effectInputs: new Map([[wheel.id, { velocity: [40, 0, 0] }]]),
    };
    const emitted: number[][] = [];
    const emit = effects.smoke.emit.bind(effects.smoke);
    vi.spyOn(effects.smoke, "emit").mockImplementation((position) => {
      emitted.push(position.toArray());
      emit(position);
    });
    effects.update(state, 0.05, new Map(), 720);
    effects.update(state, 0.05, new Map(), 720);
    expect(emitted).toHaveLength(1);
    expect(emitted[0][0]).toBeCloseTo(x === 0 ? 10 : 11.2);
    expect(emitted[0][1]).toBeCloseTo((x === 0 ? 18 : 18.4) + 0.08);
    expect(emitted[0][2]).toBe(30);
    effects.dispose();
  },
);

it("大量のChunkでも9キーだけ検索し、負座標・境界・Origin Rebase後も近傍地形を拾う", () => {
  const project = emptyProject();
  project.world.source = { kind: "finite" };
  project.world.chunkSize = 32;
  project.machines = [planeTemplate()];
  const part = createPart("Thruster");
  project.machines[0].parts = [part];
  const visual = new THREE.Group();
  visual.position.set(-0.1, 1, -0.1);
  visual.rotation.x = -Math.PI / 2;
  const effects = new VisualEffects();
  effects.load(project, new Map([[part.id, visual]]));
  const geometry = new THREE.PlaneGeometry(32, 32),
    material = new THREE.MeshBasicMaterial();
  const chunks = new Map<string, THREE.Group>();
  for (let x = -10; x <= 10; x++)
    for (let z = -10; z <= 10; z++) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.userData.vfxTerrain = true;
      const group = new THREE.Group();
      group.position.set(x * 32 + 16, 0, z * 32 + 16);
      group.add(mesh);
      chunks.set(`${x},${z}`, group);
    }
  const get = vi.spyOn(chunks, "get"),
    values = vi.spyOn(chunks, "values");
  const state: PhysicsRenderState = {
    poses: new Map(),
    wheels: new Map(),
    effectInputs: new Map([[part.id, { thrust: 1 }]]),
  };
  effects.update(state, 0.05, chunks, 720);
  expect(get).toHaveBeenCalledTimes(9);
  expect(values).not.toHaveBeenCalled();
  expect(get.mock.calls.map(([key]) => key).sort()).toEqual(
    [
      "-2,-2",
      "-2,-1",
      "-2,0",
      "-1,-2",
      "-1,-1",
      "-1,0",
      "0,-2",
      "0,-1",
      "0,0",
    ].sort(),
  );
  expect(effects.smoke.activeCount).toBe(1);
  const keys = get.mock.calls.map(([key]) => key);
  effects.shiftOrigin([256, 0, -256]);
  visual.position.x -= 256;
  visual.position.z += 256;
  for (const group of Map.prototype.values.call(
    chunks,
  ) as Iterable<THREE.Group>) {
    group.position.x -= 256;
    group.position.z += 256;
  }
  get.mockClear();
  effects.update(state, 0.05, chunks, 720, [256, 0, -256]);
  effects.update(state, 0.05, chunks, 720, [256, 0, -256]);
  expect(get.mock.calls.map(([key]) => key)).toEqual(keys);
  expect(effects.smoke.activeCount).toBe(3);
  effects.dispose();
  geometry.dispose();
  material.dispose();
});
