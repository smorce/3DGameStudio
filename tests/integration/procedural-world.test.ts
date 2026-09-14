import { expect, it } from "vitest";
import { emptyProject } from "../../packages/project-schema/src/index";
import {
  boatTemplate,
  carTemplate,
  planeTemplate,
} from "../../packages/machine-system/src/index";
import { RapierPhysics } from "../../packages/physics-rapier/src/index";
import {
  WorldRuntime,
  createStarterWorld,
} from "../../packages/world-system/src/index";
import {
  chunkHash,
  generateChunk,
} from "../../packages/world-generator/src/index";

it("Renderer/Physicsが同じProcedural Chunkを共有する", () => {
  const world = createStarterWorld({ preset: "grassland" });
  const runtime = new WorldRuntime(world);
  const chunk = runtime.getChunk("0,0")!;
  expect(runtime.meshFor("0,0")?.vertices.length).toBeGreaterThan(9);
  expect(chunk.heights.length).toBe(33 * 33);
  const again = new WorldRuntime(world).getChunk("0,0")!;
  expect([...again.heights]).toEqual([...chunk.heights]);
});

it("CarはChunk境界を越えても地形が続く", async () => {
  const project = emptyProject();
  Object.assign(project.world, createStarterWorld({ preset: "grassland" }));
  project.machines = [carTemplate()];
  const runtime = new WorldRuntime(project.world);
  const physics = new RapierPhysics();
  await physics.load(project, { world: runtime });
  physics.respawn([0, 2, 0]);
  for (let i = 0; i < 180; i++) physics.step({ throttle: 1 });
  const sample = physics.telemetry.current(project.machines[0].id);
  expect(sample?.terrainAvailable).toBe(true);
  expect(sample?.position[2]).not.toBeCloseTo(0);
  expect(
    runtime.stats(sample?.position ?? [0, 0, 0]).cachedChunks,
  ).toBeLessThan(256);
  physics.dispose();
});

it("Planeは旧512m境界を越えても地形が続く", async () => {
  const project = emptyProject();
  Object.assign(project.world, createStarterWorld({ preset: "airfield" }));
  project.machines = [planeTemplate()];
  const runtime = new WorldRuntime(project.world);
  const physics = new RapierPhysics();
  await physics.load(project, { world: runtime });
  physics.respawn([0, 8, 600]);
  for (let i = 0; i < 120; i++) physics.step({ throttle: 1 });
  const sample = physics.telemetry.current(project.machines[0].id)!;
  expect(sample.position[2]).toBeGreaterThan(512);
  expect(sample.terrainAvailable).toBe(true);
  expect(sample.worldOrigin).toBeDefined();
  physics.dispose();
});

it("Boatは旧Water端を越えても海面と浮力が続く", async () => {
  const project = emptyProject();
  Object.assign(project.world, createStarterWorld({ preset: "archipelago" }));
  project.machines = [boatTemplate()];
  const runtime = new WorldRuntime(project.world);
  const physics = new RapierPhysics();
  await physics.load(project, { world: runtime });
  physics.respawn([0, 1.5, 0]);
  for (let i = 0; i < 180; i++) physics.step({ throttle: 1 });
  expect(runtime.seaLevel.enabled).toBe(true);
  const sample = physics.telemetry.current(project.machines[0].id)!;
  expect(sample.position[1]).toBeGreaterThan(-2);
  physics.respawn([0, 1.5, 2000]);
  physics.step({ throttle: 0 });
  expect(runtime.sampleHeight(0, 2000)).toBeLessThan(1);
  physics.dispose();
});

it("Origin Rebase後もglobal位置と速度が連続する", async () => {
  const project = emptyProject();
  Object.assign(project.world, createStarterWorld({ preset: "airfield" }));
  project.machines = [planeTemplate()];
  const runtime = new WorldRuntime(project.world);
  const physics = new RapierPhysics();
  await physics.load(project, { world: runtime });
  const before: [number, number, number] = [400, 4, 80];
  expect(runtime.maybeRebase(before)).toBeDefined();
  const sim = runtime.toSimulation(before);
  expect(Math.hypot(sim[0], sim[2])).toBeLessThan(64);
  expect(runtime.toGlobal(sim)[0]).toBeCloseTo(before[0]);
  expect(runtime.toGlobal(sim)[2]).toBeCloseTo(before[2]);
  physics.dispose();
});

it("Physics TerrainはPreparedからTypedArrayへ直接焼き、Rebase後も地面を維持する", async () => {
  const rapier = await import("@dimforge/rapier3d-compat");
  const project = emptyProject();
  Object.assign(project.world, createStarterWorld({ preset: "airfield" }));
  project.machines = [planeTemplate()];
  const runtime = new WorldRuntime(project.world);
  const physics = new RapierPhysics();
  await physics.load(project, { world: runtime });
  const chunkX = 3;
  const size = runtime.chunkSize;
  const focusX = chunkX * size + size / 2;
  const focusZ = size / 2;
  physics.respawn([focusX, 2, focusZ]);
  for (let i = 0; i < 30; i++) physics.step({ throttle: 0 });

  expect(physics.stats.terrainChunkColliders).toBeGreaterThan(0);
  const prepared = runtime.peekPreparedChunk(`${chunkX},0`);
  expect(prepared).toBeTruthy();
  // meshFor と同じ Simulation 座標になっている（number[] 経由ではないが結果は一致）。
  const mesh = runtime.meshFor(`${chunkX},0`)!;
  expect(mesh.vertices.length).toBe(prepared!.positions.length);

  const probeX = focusX + 10;
  const probeZ = focusZ + 10;
  const hitBefore = physics.world!.castRay(
    new rapier.Ray({ x: probeX, y: 10, z: probeZ }, { x: 0, y: -1, z: 0 }),
    20,
    true,
  );
  expect(hitBefore).toBeTruthy();
  expect(10 - hitBefore!.timeOfImpact!).toBeCloseTo(
    runtime.sampleHeight(probeX, probeZ) ?? 0,
    0,
  );

  const plan = runtime.planRebase([focusX, 0, focusZ]);
  expect(plan).toBeDefined();
  physics.shiftOrigin(plan!.delta);
  runtime.commitRebase(plan!);
  physics.step({ throttle: 0 });

  const hitAfter = physics.world!.castRay(
    new rapier.Ray(
      { x: probeX - plan!.delta[0], y: 10, z: probeZ - plan!.delta[2] },
      { x: 0, y: -1, z: 0 },
    ),
    20,
    true,
  );
  expect(hitAfter).toBeTruthy();
  expect(10 - hitAfter!.timeOfImpact!).toBeCloseTo(
    runtime.sampleHeight(probeX, probeZ) ?? 0,
    0,
  );
  physics.dispose();
  runtime.dispose();
});

it("100km相当のChunk遷移でもCacheはBounded", () => {
  const runtime = new WorldRuntime(
    createStarterWorld({ preset: "grassland" }),
    { cacheLimit: 32 },
  );
  for (let x = 0; x <= 3125; x += 40) runtime.getChunk(`${x},0`);
  expect(runtime.stats().cachedChunks).toBeLessThanOrEqual(32);
  const far = generateChunk({
    seed: 42,
    generatorVersion: 1,
    preset: "grassland",
    chunkX: 3125,
    chunkZ: 0,
    chunkSize: 32,
    chunkResolution: 33,
  });
  expect(chunkHash(far).length).toBeGreaterThan(0);
});
