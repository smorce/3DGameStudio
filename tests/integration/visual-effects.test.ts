import { expect, it } from "vitest";
import * as THREE from "three";
import { emptyProject } from "../../packages/project-schema/src/index";
import { planeTemplate } from "../../packages/machine-system/src/index";
import { RapierPhysics } from "../../packages/physics-rapier/src/index";
import { VisualEffects } from "../../packages/renderer-three/src/effects/visual-effects";

it("既存PhysicsRenderStateから接地煙と飛行軌跡を生成し、入力状態と物理結果を変更しない", async () => {
  const project = emptyProject();
  project.world.source = { kind: "finite" };
  project.world.terrain = {
    ...project.world.terrain,
    size: 1024,
    resolution: 129,
    heights: Array(129 * 129).fill(0),
    colors: Array(129 * 129).fill("#7cab68"),
  };
  project.world.entities = [];
  project.machines = [planeTemplate()];
  const physics = new RapierPhysics();
  const effects = new VisualEffects();
  const visuals = new Map<string, THREE.Object3D>();
  for (const part of project.machines[0].parts) {
    const visual = new THREE.Group();
    visual.scale.fromArray(part.transform.scale);
    visuals.set(part.id, visual);
  }
  effects.load(project, visuals);
  let maxVapor = 0,
    maxSmoke = 0,
    airborne = false;
  try {
    await physics.load(project);
    for (let step = 0; step < 900; step++) {
      physics.step({ throttle: 1, pitch: step >= 240 ? 1 : 0 });
      const state = physics.renderState();
      for (const [id, pose] of state.poses) {
        const visual = visuals.get(id);
        if (!visual) continue;
        visual.position.fromArray(pose.position);
        visual.quaternion.fromArray(pose.rotation);
      }
      const velocity = physics.vehicles[0].body.linvel();
      const snapshot = step === 300 ? structuredClone(state) : undefined;
      effects.update(state, 1 / 60, new Map(), 720);
      if (snapshot) {
        expect(state).toEqual(snapshot);
        expect(physics.renderState()).toEqual(snapshot);
        expect(physics.vehicles[0].body.linvel()).toEqual(velocity);
      }
      maxVapor = Math.max(maxVapor, effects.vapor.activeCount);
      maxSmoke = Math.max(maxSmoke, effects.smoke.activeCount);
      if (
        step > 300 &&
        [...state.wheels.values()].every((wheel) => !wheel.inContact)
      )
        airborne = true;
    }
    expect(maxVapor).toBeGreaterThan(0);
    expect(maxSmoke).toBeGreaterThan(0);
    expect(airborne).toBe(true);
    expect(effects.smoke.activeCount).toBe(0);
    effects.update(undefined, 1 / 60, new Map(), 720);
    expect(effects.vapor.activeCount).toBe(0);
    effects.prewarm();
    effects.load(project, visuals);
    expect(effects.vapor.activeCount).toBe(0);
    expect(effects.smoke.activeCount).toBe(0);
  } finally {
    physics.dispose();
    effects.dispose();
  }
});

it("描画入力は各剛体の速度と実際の混合済み推力を読み取り、停止・respawnで推力を残さない", async () => {
  const project = emptyProject();
  project.machines = [planeTemplate(), planeTemplate()];
  for (const part of project.machines[1].parts)
    part.transform.position[0] += 80;
  const [left, right] = project.machines[0].parts
    .filter((part) => part.definitionId === "Thruster")
    .sort((a, b) => a.transform.position[0] - b.transform.position[0]);
  const disabled = project.machines[1].parts.find(
    (part) => part.definitionId === "Thruster",
  )!;
  disabled.actuator.enabled = false;
  const physics = new RapierPhysics();
  try {
    await physics.load(project);
    expect(physics.renderState().effectInputs?.get(left.id)?.thrust).toBe(0);
    physics.step({ throttle: 0.5, steering: 1 });
    physics.vehicles[0].body.setLinvel({ x: 0, y: 0, z: 40 }, true);
    physics.vehicles[1].body.setLinvel({ x: 0, y: 0, z: 5 }, true);
    const snapshot = physics.renderState();
    expect(snapshot.effectInputs?.get(left.id)?.thrust).toBeCloseTo(0.175);
    expect(snapshot.effectInputs?.get(right.id)?.thrust).toBeCloseTo(0.825);
    expect(snapshot.effectInputs?.get(disabled.id)?.thrust).toBe(0);
    for (let index = 0; index < 2; index++) {
      const part = project.machines[index].parts.find(
        (part) => part.definitionId === "Panel",
      )!;
      const wheel = project.machines[index].parts.find(
        (part) => part.definitionId === "Wheel",
      )!;
      expect(snapshot.effectInputs?.get(part.id)?.velocity).toEqual([
        0,
        0,
        index === 0 ? 40 : 5,
      ]);
      expect(snapshot.effectInputs?.get(wheel.id)?.velocity).toEqual([
        0,
        0,
        index === 0 ? 40 : 5,
      ]);
    }
    physics.step({ throttle: 0 });
    expect(physics.renderState().effectInputs?.get(right.id)?.thrust).toBe(0);
    expect(snapshot.effectInputs?.get(right.id)?.thrust).toBeCloseTo(0.825);
    physics.step({ throttle: 1 });
    physics.respawn();
    expect(physics.renderState().effectInputs?.get(right.id)?.thrust).toBe(0);
  } finally {
    physics.dispose();
  }
});
