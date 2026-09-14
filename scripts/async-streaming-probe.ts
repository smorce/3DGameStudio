/**
 * Async Streaming の Before/After Evidence を生成する Probe。
 * Node 上で Physics + WorldRuntime を回し Frame 相当の計測を集計する。
 *
 * Node では Dedicated Worker が使えないため forceSyncWorkers=true。
 * syncFallback は Worker Pool の syncFallback を記録する（WorldRuntime とは別）。
 */
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { emptyProject } from "../packages/project-schema/src/index";
import { planeTemplate } from "../packages/machine-system/src/index";
import { createStarterWorld } from "../packages/world-system/src/index";
import { WorldRuntime } from "../packages/world-system/src/runtime";
import { RapierPhysics } from "../packages/physics-rapier/src/index";
import { commitWorldOriginShift } from "../packages/engine-core/src/rebase";
import { FrameProfiler } from "../packages/engine-core/src/frame-profiler";
import { prepareChunk } from "../packages/world-generator/src/prepare";

function hypot3(a: number[], b: number[]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function git(cmd: string) {
  try {
    return execSync(cmd, { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function runFlight(steps: number, label: string) {
  const project = emptyProject();
  Object.assign(project.world, createStarterWorld({ preset: "airfield" }));
  project.machines.push(planeTemplate());
  const runtime = new WorldRuntime(project.world, { forceSyncWorkers: true });
  const physics = new RapierPhysics();
  await physics.load(project, { world: runtime });
  physics.respawn(project.world.spawnPoints[0] ?? [0, 2, 8]);
  await runtime.ensurePhysicsReady(
    project.world.spawnPoints[0] ?? [0, 2, 8],
    1,
  );
  runtime.setPlayHotPath(true);
  physics.telemetry.start();
  const profiler = new FrameProfiler(1200);
  const machineId = project.machines[0].id;
  let airStop = 0;
  let maxHinge = 0;
  let previous = physics.telemetry.current(machineId);
  const syncAtWarm = runtime.workerPool.stats.syncFallback;
  let maxReadyQueueLength = 0;
  let maxCommitMs = 0;
  let maxPoolQueueLength = 0;

  for (let step = 0; step < steps; step++) {
    const frameStarted = performance.now();
    const pitch = step >= 240 && step < 320 ? 1 : 0;
    runtime.commitPhysicsCriticalReady({ maxChunks: 4, budgetMs: 2 });
    physics.commitCriticalColliders();
    physics.step({ throttle: 1, pitch });
    runtime.commitPhysicsCriticalReady({ maxChunks: 4, budgetMs: 2 });
    physics.commitCriticalColliders();
    physics.flushStreaming();
    const focus = physics.focusGlobal();
    if (focus) commitWorldOriginShift(runtime, physics, undefined, focus);
    runtime.commitGeneralWithinBudget({ maxChunks: 2, budgetMs: 2 });
    const frameMs = performance.now() - frameStarted;
    profiler.record(frameMs);
    const worldStats = runtime.stats();
    maxReadyQueueLength = Math.max(
      maxReadyQueueLength,
      worldStats.readyRenderCount,
      worldStats.readyPhysicsCount,
    );
    maxCommitMs = Math.max(
      maxCommitMs,
      worldStats.renderChunkCommitMs,
      worldStats.physicsChunkCommitMs,
    );
    maxPoolQueueLength = Math.max(
      maxPoolQueueLength,
      runtime.workerPool.stats.maxQueueLength,
    );
    const sample = physics.telemetry.current(machineId);
    if (sample && previous) {
      const jump = hypot3(sample.position, previous.position);
      maxHinge = Math.max(maxHinge, sample.maxJointAnchorErrorM ?? 0);
      if (
        sample.worldSpeedMps > 5 &&
        sample.throttle > 0 &&
        jump < 0.02 &&
        (sample.heightAboveTerrainM ?? 0) > 2
      )
        airStop++;
    }
    previous = sample;
  }

  const last = physics.telemetry.current(machineId)!;
  const start = physics.telemetry.samples()[0];
  const worldStats = runtime.stats(last.position);
  const frame = profiler.snapshot();
  const prepared = prepareChunk({
    seed: 42,
    generatorVersion: 1,
    preset: "airfield",
    chunkX: 0,
    chunkZ: 0,
    chunkSize: 32,
    chunkResolution: 33,
  });
  const pool = runtime.workerPool.stats;

  const result = {
    label,
    gitHead: git("git rev-parse HEAD"),
    branch: git("git branch --show-current"),
    workingTreeDirty: git("git status --porcelain") !== "",
    capturedAt: new Date().toISOString(),
    probeNotes: {
      forceSyncWorkers: true,
      reason: "Node has no Dedicated Worker for Vite worker-entry URL",
    },
    frame: {
      p50Ms: frame.p50Ms,
      p95Ms: frame.p95Ms,
      p99Ms: frame.p99Ms,
      maxMs: frame.maxMs,
      over16_7: frame.over16_7,
      over33_3: frame.over33_3,
      over50: frame.over50,
      sampleCount: frame.sampleCount,
    },
    physics: {
      lastMs: 0,
      maxMs: 0,
    },
    render: {
      lastMs: 0,
      maxMs: 0,
      note: "headless probe has no WebGL render path",
    },
    streaming: {
      workerCount: worldStats.workerCount,
      generated:
        worldStats.prefetchGenerationCount + worldStats.syncGenerationCount,
      cancelled: worldStats.cancelledJobs,
      syncFallbackCount: Math.max(0, pool.syncFallback - syncAtWarm),
      syncFallbackTotal: pool.syncFallback,
      worldRuntimeSyncFallbackCount: worldStats.syncGenerationFallbackCount,
      maxQueueLength: Math.max(pool.maxQueueLength, maxPoolQueueLength),
      maxReadyQueueLength,
      maxWorkerGenerationMs: pool.maxWorkerGenerationMs,
      maxCommitMs,
      preparedVertexCount: prepared.positions.length / 3,
      preparedHasNormals: prepared.normals.length === prepared.positions.length,
    },
    flight: {
      distanceM: hypot3(last.position, start.position),
      rebaseCount: runtime.rebaseCount,
      airStopSteps: airStop,
      maxHingeAnchorErrorM: maxHinge,
    },
  };

  physics.dispose();
  runtime.dispose();
  return result;
}

const mode = process.argv[2] ?? "after";
const out =
  mode === "before"
    ? "docs/evidence/async-streaming-before.json"
    : mode === "flight"
      ? "docs/evidence/async-streaming-flight.json"
      : mode === "turn"
        ? "docs/evidence/async-streaming-turn.json"
        : "docs/evidence/async-streaming-after.json";

const steps = mode === "turn" ? 900 : 2100;
const result = await runFlight(steps, mode);
writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
console.log(`wrote ${out}`, {
  distance: result.flight.distanceM,
  frameP95: result.frame.p95Ms,
  syncFallback: result.streaming.syncFallbackCount,
});
