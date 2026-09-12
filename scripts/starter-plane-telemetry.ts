import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { emptyProject } from "../packages/project-schema/src/index";
import { planeTemplate } from "../packages/machine-system/src/index";
import { RapierPhysics } from "../packages/physics-rapier/src/index";
import { starterPlaneWorldPatch } from "../packages/world-system/src/index";
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
const tailAngle = Number(argument("tail-angle", "NaN"));
const thrusterTorque = Number(argument("thruster-torque", "NaN"));
const thrusterHeightOffset = Number(argument("thruster-height-offset", "NaN"));
const suspensionRestLength = Number(argument("suspension-rest-length", "NaN"));
const suspensionRelaxation = Number(argument("suspension-relaxation", "NaN"));
const terrainSize = Number(argument("terrain-size", "1024"));
const throttle = Number(argument("throttle", "1"));
const sweep = process.argv.includes("--sweep");
const directionComparison = process.argv.includes("--direction-comparison");
const summaryOutput = argument("summary-output", "");
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
  if (Number.isFinite(tailAngle))
    for (const part of machine.parts)
      if (
        part.definitionId === "Panel" &&
        part.metadata.aeroRole === "horizontal-tail"
      )
        part.transform.rotation = [(tailAngle * Math.PI) / 180, 0, 0];
  if (Number.isFinite(thrusterTorque))
    for (const part of machine.parts)
      if (part.definitionId === "Thruster")
        part.actuator.motorTorque = thrusterTorque;
  if (Number.isFinite(thrusterHeightOffset))
    for (const part of machine.parts)
      if (part.definitionId === "Thruster")
        part.transform.position[1] += thrusterHeightOffset;
  if (
    Number.isFinite(suspensionRestLength) ||
    Number.isFinite(suspensionRelaxation)
  )
    for (const part of machine.parts)
      if (part.definitionId === "Wheel") {
        const current = part.physics.suspension ?? {
          restLength: 0.35,
          stiffness: 10,
          compression: 2,
          relaxation: 1,
          maxForce: 10000,
        };
        part.physics.suspension = {
          ...current,
          ...(Number.isFinite(suspensionRestLength)
            ? { restLength: suspensionRestLength }
            : {}),
          ...(Number.isFinite(suspensionRelaxation)
            ? { relaxation: suspensionRelaxation }
            : {}),
        };
      }
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
  const planeWorld = starterPlaneWorldPatch(project.world);
  planeWorld.terrain.size = terrainSize;
  project.world.terrain = planeWorld.terrain;
  project.world.entities = planeWorld.entities;
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

const range = (values: number[]) => ({
  min: minimum(values),
  max: maximum(values),
  amplitude: maximum(values) - minimum(values),
});

const firstGroundedToAirborneIndex = (samples: MachineTelemetrySample[]) => {
  for (let index = 1; index < samples.length; index++) {
    const previous = samples[index - 1],
      current = samples[index];
    if (
      previous.groundedWheelCount > 0 &&
      current.groundedWheelCount === 0 &&
      current.terrainAvailable
    )
      return index;
  }
  return -1;
};

const contactToggleCount = (samples: MachineTelemetrySample[]) => {
  const toggleByWheel = new Map<string, number>();
  for (let index = 1; index < samples.length; index++) {
    const previous = new Map(
        samples[index - 1].wheels.map((wheel) => [wheel.id, wheel.inContact]),
      ),
      current = samples[index].wheels;
    for (const wheel of current)
      if (previous.has(wheel.id) && previous.get(wheel.id) !== wheel.inContact)
        toggleByWheel.set(wheel.id, (toggleByWheel.get(wheel.id) ?? 0) + 1);
  }
  return Object.fromEntries(toggleByWheel);
};

const analyzeSpeedBand = (
  name: string,
  samples: MachineTelemetrySample[],
  predicate: (sample: MachineTelemetrySample) => boolean,
) => {
  const band = samples.filter(predicate),
    suspensionLengths = band.flatMap((sample) =>
      sample.wheels.map((wheel) => wheel.suspensionLengthM),
    ),
    suspensionForces = band.flatMap((sample) =>
      sample.wheels.map((wheel) => wheel.suspensionForceN ?? 0),
    );
  return {
    name,
    samples: band.length,
    contactToggles: contactToggleCount(band),
    suspensionLengthM: range(suspensionLengths),
    suspensionForceN: {
      max: maximum(suspensionForces),
      atMaxCount: suspensionForces.filter((force) => force >= 9999).length,
    },
    verticalSpeedMps: range(band.map((sample) => sample.verticalSpeedMps)),
    pitchRad: range(band.map((sample) => sample.pitchRad)),
    pitchRateRadPerSecond: range(
      band.map((sample) => sample.angularVelocityRadPerSecond[0]),
    ),
  };
};

const findFirstChange = (
  samples: MachineTelemetrySample[],
  changed: (
    previous: MachineTelemetrySample,
    current: MachineTelemetrySample,
  ) => boolean,
) => {
  for (let index = 1; index < samples.length; index++)
    if (changed(samples[index - 1], samples[index]))
      return {
        step: samples[index].step,
        timeSeconds: samples[index].timeSeconds,
      };
  return null;
};

const analyzeGroundRoll = (samples: MachineTelemetrySample[]) => {
  const liftoffIndex = firstGroundedToAirborneIndex(samples),
    preLiftoff =
      liftoffIndex >= 0
        ? samples.slice(0, liftoffIndex)
        : samples.filter((sample) => sample.terrainAvailable),
    bands = [
      analyzeSpeedBand(
        "low",
        preLiftoff,
        (sample) => sample.forwardSpeedMps >= 0 && sample.forwardSpeedMps < 10,
      ),
      analyzeSpeedBand(
        "medium",
        preLiftoff,
        (sample) => sample.forwardSpeedMps >= 10 && sample.forwardSpeedMps < 20,
      ),
      analyzeSpeedBand(
        "high",
        preLiftoff,
        (sample) => sample.forwardSpeedMps >= 20,
      ),
    ],
    reference =
      liftoffIndex >= 0
        ? samples.slice(Math.max(0, liftoffIndex - 30), liftoffIndex + 1)
        : preLiftoff;
  return {
    liftoffCandidateIndex: liftoffIndex >= 0 ? liftoffIndex : null,
    liftoffCandidateStep: liftoffIndex >= 0 ? samples[liftoffIndex].step : null,
    terrainSamples: preLiftoff.filter((sample) => sample.terrainAvailable)
      .length,
    contactToggles: contactToggleCount(preLiftoff),
    bands,
    causalOrder: {
      contact: findFirstChange(reference, (previous, current) =>
        previous.wheels.some(
          (wheel, index) =>
            wheel.inContact !== current.wheels[index]?.inContact,
        ),
      ),
      suspension: findFirstChange(reference, (previous, current) =>
        current.wheels.some(
          (wheel, index) =>
            Math.abs(
              wheel.suspensionLengthM -
                (previous.wheels[index]?.suspensionLengthM ??
                  wheel.suspensionLengthM),
            ) > 0.005,
        ),
      ),
      verticalSpeed: findFirstChange(
        reference,
        (previous, current) =>
          Math.abs(current.verticalSpeedMps - previous.verticalSpeedMps) > 0.2,
      ),
      pitch: findFirstChange(
        reference,
        (previous, current) =>
          Math.abs(current.pitchRad - previous.pitchRad) > 0.01,
      ),
      lift: findFirstChange(
        reference,
        (previous, current) =>
          Math.abs(current.liftVerticalN - previous.liftVerticalN) > 20,
      ),
    },
  };
};

const summarize = (simulation: Simulation) => {
  const { samples, startPosition } = simulation;
  const last = samples.at(-1);
  if (!last)
    throw new Error("Telemetry did not contain any Starter Plane samples");
  const firstTerrainUnavailableIndex = samples.findIndex(
    (sample) => !sample.terrainAvailable,
  );
  const aerodynamicPitchMomentByRoleNm = samples.reduce<
    Record<string, { min: number; max: number }>
  >((result, sample) => {
    for (const [role, value] of Object.entries(
      sample.aerodynamicPitchMomentByRoleNm,
    )) {
      const current = result[role] ?? { min: value, max: value };
      result[role] = {
        min: Math.min(current.min, value),
        max: Math.max(current.max, value),
      };
    }
    return result;
  }, {});
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
    tailAngleDeg: Number.isFinite(tailAngle) ? tailAngle : "template",
    suspensionRestLengthM: Number.isFinite(suspensionRestLength)
      ? suspensionRestLength
      : "template",
    suspensionRelaxation: Number.isFinite(suspensionRelaxation)
      ? suspensionRelaxation
      : "template",
    terrainSizeM: terrainSize,
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
    aerodynamicPitchMomentNm: range(
      samples.map((sample) => sample.aerodynamicPitchMomentNm),
    ),
    thrusterPitchMomentNm: range(
      samples.map((sample) => sample.thrusterPitchMomentNm),
    ),
    totalPitchMomentNm: range(
      samples.map((sample) => sample.totalPitchMomentNm),
    ),
    aerodynamicPitchMomentByRoleNm,
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
    terrainAvailableSamples: samples.filter((sample) => sample.terrainAvailable)
      .length,
    terrainUnavailableSamples: samples.filter(
      (sample) => !sample.terrainAvailable,
    ).length,
    firstTerrainUnavailableStep:
      firstTerrainUnavailableIndex >= 0
        ? samples[firstTerrainUnavailableIndex].step
        : null,
    firstTerrainUnavailableForwardDistanceM:
      firstTerrainUnavailableIndex >= 0
        ? samples[firstTerrainUnavailableIndex].position[2] - startPosition[2]
        : null,
    firstTerrainUnavailableGroundedWheelCount:
      firstTerrainUnavailableIndex >= 0
        ? samples[firstTerrainUnavailableIndex].groundedWheelCount
        : null,
    groundRollAnalysis: analyzeGroundRoll(samples),
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
  if (summaryOutput)
    await writeOutput(
      summaryOutput,
      JSON.stringify({ version: 1, ...summary }, null, 2) + "\n",
    );
  await writeOutput(
    output,
    simulation.samples.map((sample) => JSON.stringify(sample)).join("\n") +
      "\n",
  );
  console.log(JSON.stringify({ output, ...summary }));
}
