import { expect, it } from "vitest";
import { commitWorldOriginShift } from "../../packages/engine-core/src/rebase";
import { carTemplate } from "../../packages/machine-system/src/index";
import { RapierPhysics } from "../../packages/physics-rapier/src/index";
import { emptyProject } from "../../packages/project-schema/src/index";
import {
  WorldRuntime,
  createStarterWorld,
} from "../../packages/world-system/src/index";

/**
 * Terrain Collider（Simulation 座標 bake の Standalone Trimesh）と
 * DynamicRayCastVehicleController の接地・加速を、正式な Origin Rebase
 * Transaction（commitWorldOriginShift）前後で回帰監視する。
 *
 * 閾値根拠（grassland + carTemplate、focus ≈ chunk (4,0) 中心の実測）:
 * - heightAboveTerrainM ≈ 0.24–0.26 → Assert: -0.5 < h < 2.5
 *   （沈下時は大きく負、接触喪失で浮遊すると大きく正になる帯域を検出）
 * - groundedWheelCount = 4 → Assert: >= 2（完全喪失を検出。片輪浮きは許容）
 * - throttle 90 step で水平速度 ≈ 0.2 → ≈ 8 m/s → 増分 > 1.5 かつ絶対 > 2
 * - Rebase 直後の Global 連続 ≈ 0 → discontinuity < 1e-3
 *
 * 機体チューニングは変更しない。車は地上 Raycast Vehicle の最小に近い本番経路。
 */
const hypot3 = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const horizontalSpeed = (physics: RapierPhysics) => {
  const v = physics.vehicles[0].body.linvel();
  return Math.hypot(v.x, v.z);
};

const assertFiniteSample = (
  sample: {
    position: number[];
    linearVelocityMps: number[];
    rotation: number[];
    heightAboveTerrainM: number | null;
  },
  bodyY: number,
) => {
  expect(sample.position.every(Number.isFinite)).toBe(true);
  expect(sample.linearVelocityMps.every(Number.isFinite)).toBe(true);
  expect(sample.rotation.every(Number.isFinite)).toBe(true);
  expect(Number.isFinite(bodyY)).toBe(true);
  if (sample.heightAboveTerrainM !== null)
    expect(Number.isFinite(sample.heightAboveTerrainM)).toBe(true);
};

const assertGroundContact = (
  sample: {
    groundedWheelCount: number;
    heightAboveTerrainM: number | null;
    terrainAvailable: boolean;
  },
  label: string,
) => {
  expect(sample.terrainAvailable, `${label}: terrainAvailable`).toBe(true);
  expect(
    sample.groundedWheelCount,
    `${label}: groundedWheelCount`,
  ).toBeGreaterThanOrEqual(2);
  expect(sample.heightAboveTerrainM).not.toBeNull();
  // 異常沈下（地面貫通）と接触喪失による過大浮遊を同時に検出する帯域。
  expect(sample.heightAboveTerrainM!).toBeGreaterThan(-0.5);
  expect(sample.heightAboveTerrainM!).toBeLessThan(2.5);
};

it("DynamicRayCastVehicleControllerはTerrain Standalone Trimesh上でRebase前後も接地・加速する", async () => {
  const project = emptyProject();
  Object.assign(project.world, createStarterWorld({ preset: "grassland" }));
  project.machines = [carTemplate()];
  const runtime = new WorldRuntime(project.world);
  const physics = new RapierPhysics();
  await physics.load(project, { world: runtime });
  const machineId = project.machines[0].id;
  const size = runtime.chunkSize;
  // planRebase 距離閾値(3 chunk)を超える位置から開始し、正式 Transaction を必ず踏む。
  const focusX = 4 * size + size / 2;
  const focusZ = size / 2;
  physics.respawn([focusX, 2, focusZ]);

  for (let i = 0; i < 60; i++) physics.step({ throttle: 0 });
  expect(physics.stats.terrainChunkColliders).toBeGreaterThan(0);
  const settle = physics.telemetry.current(machineId)!;
  assertFiniteSample(settle, physics.vehicles[0].body.translation().y);
  assertGroundContact(settle, "before-rebase/settle");

  const speedBeforeThrottle = horizontalSpeed(physics);
  for (let i = 0; i < 90; i++) physics.step({ throttle: 1 });
  const afterThrottle = physics.telemetry.current(machineId)!;
  assertFiniteSample(afterThrottle, physics.vehicles[0].body.translation().y);
  assertGroundContact(afterThrottle, "before-rebase/throttle");
  const speedAfterThrottle = horizontalSpeed(physics);
  expect(speedAfterThrottle - speedBeforeThrottle).toBeGreaterThan(1.5);
  expect(speedAfterThrottle).toBeGreaterThan(2);

  const globalBefore = physics.focusGlobal()!;
  const plan = commitWorldOriginShift(
    runtime,
    physics,
    undefined,
    globalBefore,
  );
  expect(plan).toBeDefined();
  const globalAfter = physics.focusGlobal()!;
  expect(hypot3(globalBefore, globalAfter)).toBeLessThan(1e-3);

  const justAfter = physics.telemetry.current(machineId)!;
  assertFiniteSample(justAfter, physics.vehicles[0].body.translation().y);
  assertGroundContact(justAfter, "just-after-rebase");
  expect(justAfter.worldOrigin).toEqual([...runtime.worldOrigin]);

  for (let i = 0; i < 30; i++) physics.step({ throttle: 0 });
  const settleAfter = physics.telemetry.current(machineId)!;
  assertFiniteSample(settleAfter, physics.vehicles[0].body.translation().y);
  assertGroundContact(settleAfter, "after-rebase/settle");
  // 世界座標上の地形高さと車両位置の関係が破綻していないこと。
  expect(settleAfter.heightAboveTerrainM).toBeCloseTo(
    settleAfter.position[1] - (settleAfter.terrainHeightM ?? 0),
    5,
  );

  const speedBeforeAgain = horizontalSpeed(physics);
  const positionBeforeAccel = [...settleAfter.position];
  for (let i = 0; i < 90; i++) physics.step({ throttle: 1 });
  const afterAgain = physics.telemetry.current(machineId)!;
  assertFiniteSample(afterAgain, physics.vehicles[0].body.translation().y);
  assertGroundContact(afterAgain, "after-rebase/throttle");
  const speedAfterAgain = horizontalSpeed(physics);
  expect(speedAfterAgain - speedBeforeAgain).toBeGreaterThan(1.5);
  expect(speedAfterAgain).toBeGreaterThan(2);
  // 異常な瞬間移動がない（90 step ≈ 1.5s での水平移動は実測で数十 m 規模）。
  expect(hypot3(afterAgain.position, positionBeforeAccel)).toBeLessThan(80);
  expect(hypot3(afterAgain.position, positionBeforeAccel)).toBeGreaterThan(1);

  physics.dispose();
  runtime.dispose();
});
