import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { emptyProject } from "../packages/project-schema/src/index";
import { planeTemplate } from "../packages/machine-system/src/index";
import { RapierPhysics } from "../packages/physics-rapier/src/index";

const argument = (name: string, fallback: string) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? fallback;

const output = argument(
  "output",
  "docs/evidence/starter-plane-telemetry.jsonl",
);
const steps = Number(argument("steps", "600"));
const wingAngle = Number(argument("wing-angle", "NaN"));
const thrusterTorque = Number(argument("thruster-torque", "NaN"));
const reducedWing = process.argv.includes("--reduced-wing");

const project = emptyProject();
const machine = planeTemplate();
if (Number.isFinite(wingAngle))
  for (const part of machine.parts)
    if (
      part.definitionId === "Panel" &&
      part.transform.position[2] === 0 &&
      part.transform.position[0] !== 0
    )
      part.transform.rotation = [(wingAngle * Math.PI) / 180, 0, 0];
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
project.machines.push(machine);

const physics = new RapierPhysics();
await physics.load(project);
physics.telemetry.start();
for (let step = 0; step < steps; step++) physics.step(1, 0);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, physics.telemetry.exportJsonLines() + "\n", "utf8");
console.log(
  JSON.stringify({
    output,
    samples: physics.telemetry.samples().length,
    steps,
    wingAngle: Number.isFinite(wingAngle) ? wingAngle : "template",
    thrusterTorque: Number.isFinite(thrusterTorque)
      ? thrusterTorque
      : "template",
    reducedWing,
  }),
);
physics.dispose();
