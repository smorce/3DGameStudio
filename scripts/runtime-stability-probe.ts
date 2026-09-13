import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { emptyProject } from "../packages/project-schema/src/index";
import { planeTemplate } from "../packages/machine-system/src/index";
import { RapierPhysics } from "../packages/physics-rapier/src/index";
import {
  WorldRuntime,
  createStarterWorld,
} from "../packages/world-system/src/index";
import { commitWorldOriginShift } from "../packages/engine-core/src/rebase";
import type { MachineTelemetrySample } from "../packages/runtime-telemetry/src/index";

const argument = (name: string, fallback: string) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? fallback;

const steps = Number(argument("steps", "2400"));
const output = argument("output", "docs/evidence/runtime-stability-after.json");

const hypot3 = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const finite = (value: number) => Number.isFinite(value);

function gitMeta() {
  try {
    const gitHead = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const branch = execFileSync("git", ["branch", "--show-current"], {
      encoding: "utf8",
    }).trim();
    const dirty =
      execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
      }).trim().length > 0;
    return { gitHead, branch, workingTreeDirty: dirty };
  } catch {
    return { gitHead: "unknown", branch: "unknown", workingTreeDirty: true };
  }
}

async function main() {
  const project = emptyProject();
  Object.assign(project.world, createStarterWorld({ preset: "airfield" }));
  const machine = planeTemplate();
  project.machines.push(machine);
  const runtime = new WorldRuntime(project.world);
  const physics = new RapierPhysics();
  await physics.load(project, { world: runtime });
  physics.respawn(project.world.spawnPoints[0] ?? [0, 2, 8]);
  physics.telemetry.start();

  let airStopSteps = 0;
  let maxGlobalJump = 0;
  let maxRebaseDiscontinuityM = 0;
  let maxHinge = 0;
  let previous: MachineTelemetrySample | undefined;
  const generationLatencies: number[] = [];
  const rebaseVelocityDeltas: number[] = [];

  for (let step = 0; step < steps; step++) {
    const originBefore = [...runtime.worldOrigin];
    const pitch = step >= 240 && step < 320 ? 1 : 0;
    physics.step({ throttle: 1, pitch });
    if (
      originBefore[0] !== runtime.worldOrigin[0] ||
      originBefore[2] !== runtime.worldOrigin[2]
    )
      throw new Error("physics.step changed worldOrigin");
    const focus = physics.focusGlobal();
    if (focus) {
      const velocityBefore = physics.vehicles[0]?.body.linvel();
      const globalBefore = physics.focusGlobal()!;
      const plan = commitWorldOriginShift(runtime, physics, undefined, focus);
      if (plan) {
        const globalAfter = physics.focusGlobal()!;
        maxRebaseDiscontinuityM = Math.max(
          maxRebaseDiscontinuityM,
          hypot3(globalBefore, globalAfter),
        );
        if (velocityBefore) {
          const velocityAfter = physics.vehicles[0].body.linvel();
          rebaseVelocityDeltas.push(
            Math.hypot(
              velocityAfter.x - velocityBefore.x,
              velocityAfter.y - velocityBefore.y,
              velocityAfter.z - velocityBefore.z,
            ),
          );
        }
      }
    }
    const sample = physics.telemetry.current(machine.id);
    if (!sample) continue;
    generationLatencies.push(
      runtime.stats(sample.position).generationLatencyMs,
    );
    maxHinge = Math.max(maxHinge, sample.maxJointAnchorErrorM ?? 0);
    if (previous) {
      const globalJump = hypot3(sample.position, previous.position);
      maxGlobalJump = Math.max(maxGlobalJump, globalJump);
      if (
        sample.worldSpeedMps > 5 &&
        sample.throttle > 0 &&
        globalJump < 0.02 &&
        (sample.heightAboveTerrainM ?? 1) > 2
      )
        airStopSteps++;
    }
    previous = sample;
  }

  const last = physics.telemetry.current(machine.id);
  if (!last) throw new Error("Starter Plane telemetry was empty");
  const samples = physics.telemetry.samples();
  const start = samples[0];
  const meta = gitMeta();
  const evidence = {
    capturedAt: new Date().toISOString(),
    phase: "after",
    gitHead: meta.gitHead,
    branch: meta.branch,
    workingTreeDirty: meta.workingTreeDirty,
    steps,
    flightDistanceM: start ? hypot3(last.position, start.position) : 0,
    finalGlobalPosition: last.position,
    finalSimulationPosition: last.simulationPosition,
    finalWorldOrigin: last.worldOrigin,
    rebaseCount: runtime.rebaseCount,
    maxWorldSpeedMps: Math.max(...samples.map((s) => s.worldSpeedMps)),
    maxGlobalPositionDiscontinuityM: maxGlobalJump,
    maxRebaseGlobalDiscontinuityM: maxRebaseDiscontinuityM,
    maximumHingeAnchorErrorM: maxHinge,
    maxRebaseVelocityDeltaMps: rebaseVelocityDeltas.length
      ? Math.max(...rebaseVelocityDeltas)
      : 0,
    airStopSteps,
    syncGenerationCount: runtime.stats(last.position).syncGenerationCount,
    generationLatencyMs: {
      last: runtime.stats(last.position).generationLatencyMs,
      max: Math.max(
        runtime.stats(last.position).maxGenerationLatencyMs,
        ...generationLatencies,
      ),
    },
    finite: {
      position: last.position.every(finite),
      velocity: last.linearVelocityMps.every(finite),
      rotation: last.rotation.every(finite),
    },
  };
  await mkdir("docs/evidence", { recursive: true });
  await writeFile(output, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
  physics.dispose();
  runtime.dispose();
}

await main();
