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
