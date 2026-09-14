import { expect, it } from "vitest";
import { emptyProject } from "../../packages/project-schema/src/index";
import { planeTemplate } from "../../packages/machine-system/src/index";
import { RapierPhysics } from "../../packages/physics-rapier/src/index";
import { createStarterWorld } from "../../packages/world-system/src/index";
import { WorldRuntime } from "../../packages/world-system/src/runtime";
import {
  ObservationHub,
  createObservationManifest,
} from "../../packages/runtime-telemetry/src/index";

it("Physics → ObservationHub へ machine sample を流せる", async () => {
  const project = emptyProject();
  Object.assign(project.world, createStarterWorld({ preset: "airfield" }));
  project.machines.push(planeTemplate());
  const physics = new RapierPhysics();
  await physics.load(project);
  physics.telemetry.start();
  const hub = new ObservationHub();
  hub.beginRun(
    createObservationManifest({ scenarioId: "starter-plane-straight" }),
  );
  for (let step = 0; step < 30; step++) physics.step({ throttle: 1 });
  const sample = physics.telemetry.current(project.machines[0]!.id)!;
  hub.emitState("physics.machine.sample", "physics", {
    forwardSpeedMps: sample.forwardSpeedMps,
    position: sample.position,
  });
  expect(
    hub.allEvents().some((event) => event.name === "physics.machine.sample"),
  ).toBe(true);
  physics.dispose();
});

it("World → ObservationHub へ streaming stats を流せる", async () => {
  const project = emptyProject();
  Object.assign(project.world, createStarterWorld({ preset: "airfield" }));
  project.machines.push(planeTemplate());
  const lifecycle: string[] = [];
  const runtime = new WorldRuntime(project.world, {
    forceSyncWorkers: true,
    onLifecycleEvent: (event) => lifecycle.push(event.name),
  });
  const physics = new RapierPhysics();
  await physics.load(project, { world: runtime });
  const spawn = project.world.spawnPoints[0] ?? [0, 2, 8];
  physics.respawn(spawn);
  await runtime.ensurePhysicsReady(spawn, 1);
  const hub = new ObservationHub();
  hub.beginRun(
    createObservationManifest({ scenarioId: "world-streaming-forward" }),
  );
  for (let step = 0; step < 60; step++) {
    runtime.commitPhysicsCriticalReady({ maxChunks: 4, budgetMs: 2 });
    physics.step({ throttle: 1 });
    physics.flushStreaming();
    runtime.commitGeneralWithinBudget({ maxChunks: 2, budgetMs: 2 });
  }
  const stats = runtime.stats(physics.focusGlobal() ?? spawn);
  hub.emitMetric("world.streaming.stats", "world", {
    workerQueued: stats.workerQueued,
    loadedPhysicsChunks: stats.loadedPhysicsChunks,
  });
  expect(
    hub.allEvents().some((event) => event.name === "world.streaming.stats"),
  ).toBe(true);
  expect(lifecycle).toContain("world.chunk.queued");
  expect(lifecycle).toContain("world.chunk.ready");
  expect(lifecycle).toContain("world.chunk.committed");
  expect(
    lifecycle.filter((name) => name === "world.chunk.committed").length,
  ).toBeGreaterThan(0);
  physics.dispose();
  runtime.dispose();
});
