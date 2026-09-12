import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { emptyProject } from "../packages/project-schema/src/index";
import { planeTemplate } from "../packages/machine-system/src/index";
import { RapierPhysics } from "../packages/physics-rapier/src/index";
import {
  findStableForwardTakeoff,
  type MachineTelemetrySample,
} from "../packages/runtime-telemetry/src/index";

const argument = (name: string, fallback: string) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? fallback;

const steps = Number(argument("steps", "600"));
const wingAngle = Number(argument("wing-angle", "NaN"));
const thrusterTorque = Number(argument("thruster-torque", "NaN"));
const throttle = Number(argument("throttle", "1"));
const sweep = process.argv.includes("--sweep");
const directionComparison = process.argv.includes("--direction-comparison");
const output = argument(
  "output",
  directionComparison
    ? "docs/evidence/starter-plane-direction-comparison.json"
    : sweep
      ? "docs/evidence/wing-angle-sweep.json"
      : "docs/evidence/starter-plane-telemetry.jsonl",
);
const reducedWing = process.argv.includes("--reduced-wing");

type Simulation = {
  samples: MachineTelemetrySample[];
  startPosition: [number, number, number];
  wingAngleDeg: number | "template";
  throttle: number;
};

const configureMachine = (
  machine: ReturnType<typeof planeTemplate>,
  configuredWingAngle: number,
) => {
  if (Number.isFinite(configuredWingAngle))
    for (const part of machine.parts)
      if (
        part.definitionId === "Panel" &&
        part.transform.position[2] === 0 &&
        part.transform.position[0] !== 0
      )
        part.transform.rotation = [(configuredWingAngle * Math.PI) / 180, 0, 0];
  if (Number.isFinite(thrusterTorque))
    for (const part of machine.parts)
      if (part.definitionId === "Thruster")
        part.actuator.motorTorque = thrusterTorque;
  if (reducedWing) {
    const removed = new Set(
      machine.parts
        .filter(
          (part) =>
            part.definitionId === "Panel" &&
            part.transform.position[2] === 0 &&
            Math.abs(part.transform.position[0]) >= 3,
        )
        .map((part) => part.id),
    );
    machine.parts = machine.parts.filter((part) => !removed.has(part.id));
    machine.connections = machine.connections.filter(
      (connection) => !removed.has(connection.a) && !removed.has(connection.b),
    );
  }
};

const simulate = async (
  configuredWingAngle: number,
  configuredThrottle: number,
): Promise<Simulation> => {
  const project = emptyProject(),
    machine = planeTemplate();
  configureMachine(machine, configuredWingAngle);
  project.machines.push(machine);
  const physics = new RapierPhysics();
  await physics.load(project);
  physics.telemetry.start();
  const startPosition = [...physics.poses().get(machine.id)!.position] as [
    number,
    number,
    number,
  ];
  for (let step = 0; step < steps; step++) physics.step(configuredThrottle, 0);
  const samples = physics.telemetry
    .samples()
    .filter((sample) => sample.machineId === machine.id);
  physics.dispose();
  return {
    samples,
    startPosition,
    wingAngleDeg: Number.isFinite(configuredWingAngle)
      ? configuredWingAngle
      : "template",
    throttle: configuredThrottle,
  };
};

const maximum = (values: number[]) =>
  values.length > 0 ? Math.max(...values) : 0;
const minimum = (values: number[]) =>
  values.length > 0 ? Math.min(...values) : 0;
const average = (values: number[]) =>
  values.length > 0
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;

const longestRun = (
  samples: MachineTelemetrySample[],
  predicate: (sample: MachineTelemetrySample) => boolean,
) => {
  let current = 0;
  let longest = 0;
  for (const sample of samples) {
    current = predicate(sample) ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
};

const summarize = (simulation: Simulation) => {
  const { samples, startPosition } = simulation;
  const last = samples.at(-1);
  if (!last)
    throw new Error("Telemetry did not contain any Starter Plane samples");
  const takeoff = findStableForwardTakeoff(samples),
    takeoffSamples =
      takeoff === undefined ? samples : samples.slice(takeoff.liftoffIndex),
    takeoffSample =
      takeoff === undefined ? undefined : samples[takeoff.liftoffIndex],
    forwardDirectionSamples = samples.filter(
      (sample) => sample.forwardSpeedMps > 5,
    ),
    backwardDirectionSamples = samples.filter(
      (sample) => sample.forwardSpeedMps < -5,
    ),
    airborneSteps = longestRun(
      samples,
      (sample) =>
        sample.contactStatusAvailable && sample.groundedWheelCount === 0,
    );
  return {
    wingAngleDeg: simulation.wingAngleDeg,
    throttle: simulation.throttle,
    steps: samples.length,
    stableTakeoff: takeoff !== undefined,
    stableTakeoffStep: takeoff?.liftoffStep ?? -1,
    stableTakeoffTimeSeconds: takeoff?.liftoffTimeSeconds ?? null,
    stableFlightDurationSeconds: takeoff?.durationSeconds ?? 0,
    stableWindowFinalHeightM: takeoff?.finalAltitudeM ?? null,
    takeoffStartSpeedMps: takeoffSample?.worldSpeedMps ?? null,
    takeoffStartForwardSpeedMps: takeoffSample?.forwardSpeedMps ?? null,
    maxWorldSpeedMps: maximum(samples.map((sample) => sample.worldSpeedMps)),
    maxForwardSpeedMps: maximum(
      samples.map((sample) => sample.forwardSpeedMps),
    ),
    minForwardSpeedMps: minimum(
      samples.map((sample) => sample.forwardSpeedMps),
    ),
    maxHeightM: maximum(samples.map((sample) => sample.position[1])),
    finalHeightM: last.position[1],
    minHeightAfterTakeoffM:
      takeoff === undefined
        ? null
        : minimum(takeoffSamples.map((sample) => sample.position[1])),
    minHeightDuringStableWindowM:
      takeoff === undefined
        ? null
        : minimum(
            samples
              .slice(
                takeoff.liftoffIndex,
                takeoff.liftoffIndex + takeoff.windowSteps,
              )
              .map((sample) => sample.position[1]),
          ),
    maxVerticalSpeedMps: maximum(
      samples.map((sample) => sample.verticalSpeedMps),
    ),
    minVerticalSpeedMps: minimum(
      samples.map((sample) => sample.verticalSpeedMps),
    ),
    averageVerticalSpeedMps: average(
      takeoffSamples.map((sample) => sample.verticalSpeedMps),
    ),
    maxPitchAbsRad: maximum(samples.map((sample) => Math.abs(sample.pitchRad))),
    pitchVibrationRangeRad:
      maximum(samples.map((sample) => sample.pitchRad)) -
      minimum(samples.map((sample) => sample.pitchRad)),
    maxLiftToWeightRatio: maximum(
      samples.map((sample) => sample.liftToWeightRatio),
    ),
    averageLiftToWeightRatio: average(
      samples.map((sample) => sample.liftToWeightRatio),
    ),
    maxDragN: maximum(samples.map((sample) => sample.totalDragN)),
    averageDragN: average(samples.map((sample) => sample.totalDragN)),
    averageAngleOfAttackRad: average(
      samples.map((sample) => sample.averageAngleOfAttackRad),
    ),
    averageLiftCoefficient: average(
      samples.map((sample) => sample.averageLiftCoefficient),
    ),
    averageDragCoefficient: average(
      samples.map((sample) => sample.averageDragCoefficient),
    ),
    liftSignByForwardDirection: {
      forward: {
        samples: forwardDirectionSamples.length,
        positive: forwardDirectionSamples.filter(
          (sample) => sample.liftVerticalN > 0,
        ).length,
        negative: forwardDirectionSamples.filter(
          (sample) => sample.liftVerticalN < 0,
        ).length,
        averageLiftVerticalN: average(
          forwardDirectionSamples.map((sample) => sample.liftVerticalN),
        ),
      },
      backward: {
        samples: backwardDirectionSamples.length,
        positive: backwardDirectionSamples.filter(
          (sample) => sample.liftVerticalN > 0,
        ).length,
        negative: backwardDirectionSamples.filter(
          (sample) => sample.liftVerticalN < 0,
        ).length,
        averageLiftVerticalN: average(
          backwardDirectionSamples.map((sample) => sample.liftVerticalN),
        ),
      },
    },
    forwardDistanceM: last.position[2] - startPosition[2],
    continuousAirborneSteps: airborneSteps,
    continuousAirborneSeconds: airborneSteps / 60,
  };
};

const writeOutput = async (path: string, contents: string) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
};

const directionSnapshot = (simulation: Simulation) => ({
  summary: summarize(simulation),
  samples: simulation.samples.slice(0, 6).map((sample) => ({
    step: sample.step,
    timeSeconds: sample.timeSeconds,
    forwardSpeedMps: sample.forwardSpeedMps,
    liftVerticalN: sample.liftVerticalN,
    averageAngleOfAttackRad: sample.averageAngleOfAttackRad,
    averageLiftCoefficient: sample.averageLiftCoefficient,
    thrusterForceWorldN: sample.thrusterForceWorldN,
  })),
});

if (directionComparison) {
  const forward = await simulate(wingAngle, 1),
    backward = await simulate(wingAngle, -1);
  await writeOutput(
    output,
    JSON.stringify(
      {
        version: 1,
        steps,
        wingAngleDeg: Number.isFinite(wingAngle) ? wingAngle : "template",
        steering: 0,
        forward: directionSnapshot(forward),
        backward: directionSnapshot(backward),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      output,
      steps,
      wingAngle,
      forward: summarize(forward),
      backward: summarize(backward),
    }),
  );
} else if (sweep) {
  const angles = argument("wing-angles", "4,6,8,10,12")
    .split(",")
    .map(Number)
    .filter(Number.isFinite);
  const results = [];
  for (const angle of angles)
    results.push(summarize(await simulate(angle, throttle)));
  await writeOutput(
    output,
    JSON.stringify(
      {
        version: 1,
        steps,
        throttle,
        steering: 0,
        angles,
        results,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ output, angles, results }));
} else {
  const simulation = await simulate(wingAngle, throttle),
    summary = summarize(simulation);
  await writeOutput(
    output,
    simulation.samples.map((sample) => JSON.stringify(sample)).join("\n") +
      "\n",
  );
  console.log(JSON.stringify({ output, ...summary }));
}
