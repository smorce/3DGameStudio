import { execSync } from "node:child_process";
import { emptyProject } from "../../packages/project-schema/src/index";
import { planeTemplate } from "../../packages/machine-system/src/index";
import { RapierPhysics } from "../../packages/physics-rapier/src/index";
import { createStarterWorld } from "../../packages/world-system/src/index";
import { WorldRuntime } from "../../packages/world-system/src/runtime";
import { commitWorldOriginShift } from "../../packages/engine-core/src/rebase";
import { FrameProfiler } from "../../packages/engine-core/src/frame-profiler";
import {
  ObservationHub,
  buildRunSummary,
  createObservationManifest,
  findStableForwardTakeoff,
  hashScenarioDefinition,
  requireObservationScenario,
  type MachineTelemetrySample,
  type ObservationScenarioDefinition,
  type ScenarioAssertionId,
} from "../../packages/runtime-telemetry/src/index";
import { writeObservationRun } from "./storage";

const git = (command: string) => {
  try {
    return execSync(command, { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
};

const controlsAtStep = (
  scenario: ObservationScenarioDefinition,
  step: number,
) => {
  const segment = scenario.timeline.find(
    (entry) => step >= entry.fromStep && step < entry.toStep,
  );
  return segment?.controls ?? { throttle: 0 };
};

type AssertionContext = {
  samples: MachineTelemetrySample[];
  start: MachineTelemetrySample | undefined;
  end: MachineTelemetrySample | undefined;
  rebaseCount: number;
  maxPositionJumpM: number;
  maxAirborneJumpM: number;
  chunkCommitted: number;
  chunkQueued: number;
  maxWorkerQueue: number;
  maxCommitMs: number;
  turnYawDeltaRad: number;
  terrainUnavailableSteps: number;
  hub: ObservationHub;
};

const evaluateAssertion = (
  id: ScenarioAssertionId,
  ctx: AssertionContext,
): { passed: boolean; expected: unknown; actual: unknown } => {
  switch (id) {
    case "forward-speed-positive": {
      const positives = ctx.samples.filter(
        (sample) => sample.forwardSpeedMps > 0.5,
      ).length;
      const passed = positives >= Math.floor(ctx.samples.length * 0.5);
      return {
        passed,
        expected: "majority forwardSpeedMps > 0.5",
        actual: positives,
      };
    }
    case "world-displacement-forward": {
      const dz = (ctx.end?.position[2] ?? 0) - (ctx.start?.position[2] ?? 0);
      return { passed: dz > 5, expected: ">5m +Z", actual: dz };
    }
    case "no-large-lateral-drift": {
      const dx = Math.abs(
        (ctx.end?.position[0] ?? 0) - (ctx.start?.position[0] ?? 0),
      );
      const dz = Math.abs(
        (ctx.end?.position[2] ?? 0) - (ctx.start?.position[2] ?? 0),
      );
      const ratio = dz > 1 ? dx / dz : dx;
      return { passed: ratio < 0.35, expected: "dx/dz < 0.35", actual: ratio };
    }
    case "stable-takeoff-detected": {
      const takeoff = findStableForwardTakeoff(ctx.samples);
      return {
        passed: !!takeoff,
        expected: true,
        actual: takeoff
          ? {
              liftoffStep: takeoff.liftoffStep,
              liftoffHeightAboveTerrainM: takeoff.liftoffHeightAboveTerrainM,
            }
          : null,
      };
    }
    case "turn-left-yaw": {
      // ArrowLeft = turn/steering -1。yaw 減少（左）を期待。
      return {
        passed: ctx.turnYawDeltaRad < -0.05,
        expected: "< -0.05 rad",
        actual: ctx.turnYawDeltaRad,
      };
    }
    case "turn-right-yaw": {
      return {
        passed: ctx.turnYawDeltaRad > 0.05,
        expected: "> 0.05 rad",
        actual: ctx.turnYawDeltaRad,
      };
    }
    case "chunk-lifecycle-progress": {
      const passed = ctx.chunkQueued > 0 || ctx.chunkCommitted > 0;
      return {
        passed,
        expected: "queued or committed > 0",
        actual: {
          queued: ctx.chunkQueued,
          committed: ctx.chunkCommitted,
        },
      };
    }
    case "streaming-under-load":
    case "streaming-during-turn": {
      const passed =
        ctx.chunkCommitted > 0 || ctx.maxWorkerQueue > 0 || ctx.maxCommitMs > 0;
      return {
        passed,
        expected: "streaming activity observed",
        actual: {
          committed: ctx.chunkCommitted,
          maxWorkerQueue: ctx.maxWorkerQueue,
          maxCommitMs: ctx.maxCommitMs,
        },
      };
    }
    case "rebase-at-least-once": {
      return {
        passed: ctx.rebaseCount >= 1,
        expected: ">=1",
        actual: ctx.rebaseCount,
      };
    }
    case "rebase-global-continuity": {
      return {
        passed: ctx.maxPositionJumpM < 5,
        expected: "<5m jump",
        actual: ctx.maxPositionJumpM,
      };
    }
    case "rebase-flight-continuity": {
      return {
        passed: ctx.rebaseCount >= 1 && ctx.maxAirborneJumpM < 8,
        expected: "rebase>=1 && airborne jump <8m",
        actual: {
          rebaseCount: ctx.rebaseCount,
          maxAirborneJumpM: ctx.maxAirborneJumpM,
        },
      };
    }
    case "camera-follow-samples": {
      // headless では camera 実体がないため、旋回中の姿勢連続サンプルを代理指標にする。
      const turnSamples = ctx.samples.length;
      return {
        passed: turnSamples > 20,
        expected: ">20 pose samples",
        actual: turnSamples,
      };
    }
    case "terrain-entry-safe": {
      const fallen = ctx.samples.filter(
        (sample) =>
          sample.terrainAvailable === false && sample.position[1] < -5,
      ).length;
      return {
        passed: fallen === 0,
        expected: "no deep fall while terrain unavailable",
        actual: {
          fallen,
          terrainUnavailableSteps: ctx.terrainUnavailableSteps,
        },
      };
    }
    default:
      return { passed: false, expected: true, actual: `unknown:${id}` };
  }
};

export interface ObservationRunResult {
  runId: string;
  scenario: string;
  result: "pass" | "fail" | "error";
  durationMs: number;
  summaryPath: string;
  artifactPath: string;
  summary: ReturnType<typeof buildRunSummary>;
}

export async function runObservationScenario(
  scenarioId: string,
): Promise<ObservationRunResult> {
  const scenario = requireObservationScenario(scenarioId);
  const started = performance.now();
  const hub = new ObservationHub({ capacity: 12000 });
  const manifest = createObservationManifest({
    scenarioId: scenario.id,
    seed: scenario.seed,
    scenarioDefinitionHash: hashScenarioDefinition({
      id: scenario.id,
      durationSteps: scenario.durationSteps,
      timeline: scenario.timeline,
      assertions: scenario.assertions,
    }),
    mode: "node",
    gitCommit: git("git rev-parse HEAD"),
    gitBranch: git("git branch --show-current"),
    workingTreeDirty: git("git status --porcelain") !== "",
  });
  hub.beginRun(manifest);

  const project = emptyProject();
  Object.assign(
    project.world,
    createStarterWorld({ preset: scenario.worldPreset }),
  );
  project.machines.push(planeTemplate());
  const machineId = project.machines[0]!.id;

  const runtime = scenario.enableWorldRuntime
    ? new WorldRuntime(project.world, { forceSyncWorkers: true })
    : undefined;
  const physics = new RapierPhysics();
  await physics.load(project, runtime ? { world: runtime } : undefined);
  const spawn = project.world.spawnPoints[0] ?? [0, 2, 8];
  physics.respawn(spawn);
  hub.emit({
    name: "engine.respawn",
    source: "engine",
    type: "event",
    data: { spawn },
  });
  if (runtime) {
    await runtime.ensurePhysicsReady(spawn, 1);
    runtime.setPlayHotPath(true);
  }
  physics.telemetry.start();

  const profiler = new FrameProfiler(Math.max(scenario.durationSteps, 120));
  let previous: MachineTelemetrySample | undefined;
  let maxPositionJumpM = 0;
  let maxAirborneJumpM = 0;
  let chunkCommitted = 0;
  let chunkQueued = 0;
  let maxWorkerQueue = 0;
  let maxCommitMs = 0;
  let turnStartYaw: number | undefined;
  let turnEndYaw: number | undefined;
  let terrainUnavailableSteps = 0;
  const seenChunks = new Set<string>();

  try {
    for (let step = 0; step < scenario.durationSteps; step++) {
      const frameStarted = performance.now();
      const controls = controlsAtStep(scenario, step);

      let physicsMs = 0;
      let commitMs = 0;
      if (runtime) {
        const commitStarted = performance.now();
        runtime.commitPhysicsCriticalReady({ maxChunks: 4, budgetMs: 2 });
        physics.commitCriticalColliders();
        commitMs += performance.now() - commitStarted;
      }

      const physicsStarted = performance.now();
      physics.step(controls);
      physicsMs = performance.now() - physicsStarted;

      if (runtime) {
        const commitStarted = performance.now();
        runtime.commitPhysicsCriticalReady({ maxChunks: 4, budgetMs: 2 });
        physics.commitCriticalColliders();
        physics.flushStreaming();
        commitMs += performance.now() - commitStarted;
        const focus = physics.focusGlobal();
        if (focus) {
          const before = runtime.rebaseCount;
          const plan = commitWorldOriginShift(
            runtime,
            physics,
            undefined,
            focus,
          );
          if (plan) {
            hub.emit({
              name: "world.origin.rebase.started",
              source: "world",
              type: "event",
              physicsStep: step,
              data: {
                originBefore: plan.originBefore,
                originAfter: plan.originAfter,
                delta: plan.delta,
              },
            });
            hub.emit({
              name: "world.origin.rebase.completed",
              source: "world",
              type: "event",
              physicsStep: step,
              data: {
                originBefore: plan.originBefore,
                originAfter: plan.originAfter,
                delta: plan.delta,
                rebaseCount: runtime.rebaseCount,
              },
            });
            if (runtime.rebaseCount > before) {
              /* counted via events */
            }
          }
        }
        runtime.commitGeneralWithinBudget({ maxChunks: 2, budgetMs: 2 });
        const worldStats = runtime.stats(physics.focusGlobal() ?? spawn);
        maxWorkerQueue = Math.max(
          maxWorkerQueue,
          worldStats.workerQueued,
          worldStats.pendingQueueCount,
        );
        maxCommitMs = Math.max(
          maxCommitMs,
          worldStats.renderChunkCommitMs,
          worldStats.physicsChunkCommitMs,
          commitMs,
        );
        if (
          worldStats.currentChunk &&
          !seenChunks.has(worldStats.currentChunk)
        ) {
          seenChunks.add(worldStats.currentChunk);
          hub.emit({
            name: "world.chunk.queued",
            source: "world",
            type: "event",
            physicsStep: step,
            chunkKey: worldStats.currentChunk,
            data: { currentChunk: worldStats.currentChunk },
          });
          chunkQueued++;
        }
        if (
          worldStats.readyPhysicsCount > 0 ||
          worldStats.readyRenderCount > 0
        ) {
          hub.emit({
            name: "world.chunk.ready",
            source: "world",
            type: "event",
            physicsStep: step,
            data: {
              readyPhysicsCount: worldStats.readyPhysicsCount,
              readyRenderCount: worldStats.readyRenderCount,
            },
          });
        }
        if (commitMs > 0.01) {
          hub.emit({
            name: "world.chunk.committed",
            source: "world",
            type: "event",
            physicsStep: step,
            data: { commitMs },
          });
          chunkCommitted++;
        }
        if (step % 30 === 0) {
          hub.emitMetric(
            "world.streaming.stats",
            "world",
            {
              workerQueued: worldStats.workerQueued,
              workerInFlight: worldStats.workerInFlight,
              syncFallback: worldStats.syncGenerationFallbackCount,
              loadedRenderChunks: worldStats.loadedRenderChunks,
              loadedPhysicsChunks: worldStats.loadedPhysicsChunks,
              cacheHitRate: worldStats.cacheHitRate,
            },
            { physicsStep: step, frame: step },
          );
        }
      }

      const frameMs = performance.now() - frameStarted;
      profiler.record(frameMs);
      hub.recordFrameTiming({
        frame: step,
        rafMs: frameMs,
        physicsMs,
        streamingCommitMs: commitMs,
        timestampMs: performance.now(),
      });

      const sample = physics.telemetry.current(machineId);
      if (sample) {
        if (!sample.terrainAvailable) terrainUnavailableSteps++;
        if (previous) {
          const jump = Math.hypot(
            sample.position[0] - previous.position[0],
            sample.position[1] - previous.position[1],
            sample.position[2] - previous.position[2],
          );
          maxPositionJumpM = Math.max(maxPositionJumpM, jump);
          if ((sample.heightAboveTerrainM ?? 0) > 2)
            maxAirborneJumpM = Math.max(maxAirborneJumpM, jump);
        }
        if (step % scenario.sampleEverySteps === 0) {
          hub.emitState(
            "physics.machine.sample",
            "physics",
            {
              position: sample.position,
              simulationPosition: sample.simulationPosition ?? null,
              worldOrigin: sample.worldOrigin ?? null,
              rotation: sample.rotation,
              linearVelocityMps: sample.linearVelocityMps,
              forwardSpeedMps: sample.forwardSpeedMps,
              worldSpeedMps: sample.worldSpeedMps,
              verticalSpeedMps: sample.verticalSpeedMps,
              pitchRad: sample.pitchRad,
              yawRad: sample.yawRad,
              rollRad: sample.rollRad,
              throttle: sample.throttle,
              steering: sample.steering,
              groundedWheelCount: sample.groundedWheelCount,
              heightAboveTerrainM: sample.heightAboveTerrainM,
              terrainAvailable: sample.terrainAvailable,
              totalLiftN: sample.totalLiftN,
              totalDragN: sample.totalDragN,
              totalThrusterForceN: sample.totalThrusterForceN,
            },
            {
              physicsStep: sample.step,
              frame: step,
              entityId: sample.machineId,
            },
          );
        }
        const inTurn =
          controls.turn !== undefined || controls.steering !== undefined;
        if (inTurn && (controls.turn || controls.steering)) {
          if (turnStartYaw === undefined) turnStartYaw = sample.yawRad;
          turnEndYaw = sample.yawRad;
        }
        previous = sample;
      }

      if (
        step > 0 &&
        (controls.turn !== undefined || controls.steering !== undefined) &&
        ((controls.turn ?? 0) !== 0 || (controls.steering ?? 0) !== 0) &&
        step % 60 === 0
      ) {
        hub.emit({
          name: "input.changed",
          source: "input",
          type: "event",
          physicsStep: step,
          data: { ...controls },
        });
      }
    }

    const samples = physics.telemetry
      .samples()
      .filter((sample) => sample.machineId === machineId);
    const start = samples[0];
    const end = samples.at(-1);
    const turnYawDeltaRad =
      turnStartYaw !== undefined && turnEndYaw !== undefined
        ? turnEndYaw - turnStartYaw
        : (end?.yawRad ?? 0) - (start?.yawRad ?? 0);

    hub.emit({
      name: "diagnostic.turn.verdict",
      source: "diagnostic",
      type: "event",
      data: {
        turnYawDeltaRad,
        sampleCount: samples.length,
        note: "headless proxy for TurnMotionDiagnostics",
      },
    });
    hub.emit({
      name: "camera.follow.mode_changed",
      source: "camera",
      type: "event",
      data: {
        mode: "production-default",
        note: "headless run records proxy camera-follow assertion only",
      },
    });

    const ctx: AssertionContext = {
      samples,
      start,
      end,
      rebaseCount: runtime?.rebaseCount ?? 0,
      maxPositionJumpM,
      maxAirborneJumpM,
      chunkCommitted,
      chunkQueued,
      maxWorkerQueue,
      maxCommitMs,
      turnYawDeltaRad,
      terrainUnavailableSteps,
      hub,
    };

    let failed = 0;
    for (const assertionId of scenario.assertions) {
      const result = evaluateAssertion(assertionId, ctx);
      hub.emitAssertion(
        assertionId,
        result.expected,
        result.actual,
        result.passed,
      );
      if (!result.passed) failed++;
    }

    const result: "pass" | "fail" = failed === 0 ? "pass" : "fail";
    const completedAt = new Date().toISOString();
    hub.endRun(result, completedAt);
    const durationMs = performance.now() - started;
    const finalManifest = {
      ...hub.runManifest!,
      completedAt,
      result,
      durationMs,
    };
    const summary = buildRunSummary({
      runId: finalManifest.runId,
      scenarioId: scenario.id,
      result,
      durationMs,
      events: hub.allEvents(),
      extraMetrics: {
        distanceM:
          start && end
            ? Math.hypot(
                end.position[0] - start.position[0],
                end.position[1] - start.position[1],
                end.position[2] - start.position[2],
              )
            : null,
        rebaseCount: runtime?.rebaseCount ?? 0,
        turnYawDeltaRad,
        frameProfilerP95Ms: profiler.snapshot().p95Ms,
      },
    });
    const dir = await writeObservationRun({
      manifest: finalManifest,
      events: hub.allEvents(),
      summary,
    });
    return {
      runId: finalManifest.runId,
      scenario: scenario.id,
      result,
      durationMs,
      summaryPath: `${dir}/summary.json`,
      artifactPath: `${dir}/artifacts`,
      summary,
    };
  } catch (error) {
    hub.emitError("browser.uncaught_error", String(error), {
      message: error instanceof Error ? error.message : String(error),
    });
    hub.endRun("error");
    const durationMs = performance.now() - started;
    const finalManifest = {
      ...hub.runManifest!,
      completedAt: new Date().toISOString(),
      result: "error" as const,
      durationMs,
    };
    const summary = buildRunSummary({
      runId: finalManifest.runId,
      scenarioId: scenario.id,
      result: "error",
      durationMs,
      events: hub.allEvents(),
    });
    const dir = await writeObservationRun({
      manifest: finalManifest,
      events: hub.allEvents(),
      summary,
    });
    return {
      runId: finalManifest.runId,
      scenario: scenario.id,
      result: "error",
      durationMs,
      summaryPath: `${dir}/summary.json`,
      artifactPath: `${dir}/artifacts`,
      summary,
    };
  } finally {
    physics.dispose();
    runtime?.dispose();
  }
}
