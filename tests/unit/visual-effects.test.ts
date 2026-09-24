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
  const state: PhysicsRenderState = { poses: new Map(), wheels: new Map() };
  effects.update(state, 0, 0.05, [0, 0, 40], new Map(), 720);
  expect(effects.vapor.activeCount).toBe(20);
  const before = effects.vapor.positions.slice(0, 3);
  for (const visual of parts.values()) visual.position.z += 10;
  effects.update(state, 0, 0.05, [0, 0, 40], new Map(), 720);
  expect(effects.vapor.positions.slice(0, 3)).toEqual(before);
  effects.shiftOrigin([10, 2, 3]);
  expect(effects.vapor.positions[0]).toBeCloseTo(before[0] - 10);
  effects.update(undefined, 1, 0.05, [0, 0, 40], new Map(), 720);
  expect(effects.vapor.activeCount).toBe(0);
  effects.update(state, 0, 0.05, [0, 0, 40], new Map(), 720);
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
  const chunks = new Map([["0:0", chunk]]);
  const raycast = vi.spyOn(terrain, "raycast");
  const state: PhysicsRenderState = { poses: new Map(), wheels: new Map() };
  effects.update(state, 1, 0.05, [0, 0, 0], chunks, 720);
  expect(effects.smoke.activeCount).toBeGreaterThan(0);
  expect(effects.smoke.positions[1]).toBeGreaterThan(0);
  effects.update(state, 1, 0.01, [0, 0, 0], chunks, 720);
  expect(raycast).toHaveBeenCalledTimes(1);
  visual.position.y = 10;
  for (let i = 0; i < 30; i++)
    effects.update(state, 1, 0.05, [0, 0, 0], chunks, 720);
  expect(effects.smoke.activeCount).toBe(0);
  effects.dispose();
  terrain.geometry.dispose();
  terrain.material.dispose();
});
