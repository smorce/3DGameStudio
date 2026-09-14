import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { emptyProject } from "../packages/project-schema/src/index";
import { planeTemplate } from "../packages/machine-system/src/index";
import {
  RapierPhysics,
  type BodyMotionSnapshot,
  type CcdExperimentMode,
  type ContactPairSnapshot,
} from "../packages/physics-rapier/src/index";

const argument = (name: string, fallback: string) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? fallback;

type ExperimentMode = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i";
const mode = argument("mode", "e").toLowerCase() as ExperimentMode;
const steps = Number(argument("steps", "360"));
const output = argument(
  "output",
  `docs/evidence/ccd-experiment-${mode}.json`,
);
const initialHeightM = Number(argument("height", "200"));
const initialFallSpeedMps = Number(argument("fallSpeed", "60"));
const contactLogFrom = Number(argument("contactFrom", "0"));
const contactLogTo = Number(argument("contactTo", "20"));

type ExperimentConfig = {
  ccdMode: CcdExperimentMode;
  /** true=自己衝突ON、false=現行どおりJoint接続BodyのContact無効 */
  jointContactsEnabled: boolean;
  excludeMachineSelfCollision: boolean;
  note: string;
};

const modeMap: Record<ExperimentMode, ExperimentConfig> = {
  a: {
    ccdMode: "all",
    jointContactsEnabled: false,
    excludeMachineSelfCollision: false,
    note: "現行相当: 全CCD ON + Joint Contact OFF",
  },
  b: {
    ccdMode: "off",
    jointContactsEnabled: false,
    excludeMachineSelfCollision: false,
    note: "全CCD OFF + Joint Contact OFF",
  },
  c: {
    ccdMode: "chassis-only",
    jointContactsEnabled: false,
    excludeMachineSelfCollision: false,
    note: "胴体CCDのみ + Joint Contact OFF",
  },
  d: {
    ccdMode: "hinge-only",
    jointContactsEnabled: false,
    excludeMachineSelfCollision: false,
    note: "Hinge CCDのみ + Joint Contact OFF",
  },
  e: {
    ccdMode: "chassis-only",
    jointContactsEnabled: true,
    excludeMachineSelfCollision: false,
    note: "E: 胴体CCDのみ + Joint Contact ON（自己衝突を戻す）",
  },
  f: {
    ccdMode: "chassis-only",
    jointContactsEnabled: false,
    excludeMachineSelfCollision: false,
    note: "F: 胴体CCDのみ + Joint Contact OFF（Cと同条件・現行）",
  },
  g: {
    ccdMode: "all",
    jointContactsEnabled: false,
    excludeMachineSelfCollision: false,
    note: "G: 全CCD ON + Joint Contact OFF（Aと同条件・現行Production）",
  },
  h: {
    ccdMode: "all",
    jointContactsEnabled: false,
    excludeMachineSelfCollision: true,
    note: "H: 全CCD ON + Joint Contact OFF + Machine別collisionGroups（本番候補）",
  },
  i: {
    ccdMode: "chassis-only",
    jointContactsEnabled: false,
    excludeMachineSelfCollision: true,
    note: "I: 胴体CCDのみ + Joint Contact OFF + Machine別collisionGroups",
  },
};

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

function applyFiniteFlatWorld(
  project: ReturnType<typeof emptyProject>,
  size = 1024,
  resolution = 129,
) {
  project.world.source = { kind: "finite" };
  project.world.terrain = {
    ...project.world.terrain,
    size,
    resolution,
    heights: Array(resolution * resolution).fill(0),
    colors: Array(resolution * resolution).fill("#7cab68"),
  };
  project.world.entities = [];
}

type StepRecord = {
  step: number;
  timeSeconds: number;
  chassisLinvelY: number;
  chassisHeightM: number;
  bodies: BodyMotionSnapshot[];
  contacts?: ContactPairSnapshot[];
};

function detectAirStopEvents(
  records: StepRecord[],
  minHeightM = 20,
  minSpeedMps = 20,
  jumpThresholdMps = 4,
) {
  const events: {
    step: number;
    bodyLabel: string;
    role: "chassis" | "hinge";
    beforeLinvelY: number;
    afterLinvelY: number;
    deltaLinvelY: number;
    heightM: number;
  }[] = [];
  for (let index = 1; index < records.length; index++) {
    const previous = records[index - 1];
    const current = records[index];
    if (current.chassisHeightM < minHeightM) continue;
    for (const body of current.bodies) {
      const before = previous.bodies.find(
        (candidate) => candidate.groupId === body.groupId,
      );
      if (!before) continue;
      const delta = body.linvel[1] - before.linvel[1];
      if (
        before.linvel[1] < -minSpeedMps &&
        delta > jumpThresholdMps &&
        body.linvel[1] < -5
      )
        events.push({
          step: current.step,
          bodyLabel: body.label,
          role: body.role,
          beforeLinvelY: before.linvel[1],
          afterLinvelY: body.linvel[1],
          deltaLinvelY: delta,
          heightM: body.position[1],
        });
    }
  }
  return events;
}

function chassisStagnationStep(records: StepRecord[]) {
  for (let index = 2; index < records.length; index++) {
    const a = records[index - 2];
    const c = records[index];
    if (c.chassisHeightM < 20) continue;
    const drop =
      a.chassisHeightM - c.chassisHeightM;
    if (drop < 0.05 && Math.abs(c.chassisLinvelY) > 10) return c.step;
  }
  return null;
}

async function main() {
  const config = modeMap[mode];
  if (!config) throw new Error(`Unknown mode ${mode}. Use a|b|c|d|e|f|g|h|i.`);

  const project = emptyProject();
  applyFiniteFlatWorld(project);
  const machine = planeTemplate();
  project.machines.push(machine);

  const physics = new RapierPhysics();
  await physics.load(project, {
    ccdMode: config.ccdMode,
    jointContactsEnabled: config.jointContactsEnabled,
    excludeMachineSelfCollision: config.excludeMachineSelfCollision,
  });
  physics.telemetry.start();

  const machineBodies = new Set(
    physics.bodyMotionSnapshots().map((snapshot) => snapshot.handle),
  );
  const startY =
    physics.vehicles[0]?.body.translation().y ??
    physics.bodyMotionSnapshots()[0]?.position[1] ??
    1;
  const deltaY = initialHeightM - startY;
  physics.world.bodies.forEach((body) => {
    if (!machineBodies.has(body.handle)) return;
    const translation = body.translation();
    body.setTranslation(
      { x: translation.x, y: translation.y + deltaY, z: translation.z },
      true,
    );
    body.setLinvel({ x: 0, y: -initialFallSpeedMps, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  });

  const records: StepRecord[] = [];
  for (let step = 0; step < steps; step++) {
    physics.step({ throttle: 0 });
    const bodies = physics.bodyMotionSnapshots();
    const chassis =
      bodies.find((body) => body.role === "chassis") ?? bodies[0];
    const record: StepRecord = {
      step,
      timeSeconds: step / 60,
      chassisLinvelY: chassis.linvel[1],
      chassisHeightM: chassis.position[1],
      bodies,
    };
    if (step >= contactLogFrom && step <= contactLogTo)
      record.contacts = physics.contactPairSnapshots({ machineOnly: false });
    records.push(record);
  }

  const airStopEvents = detectAirStopEvents(records);
  const chassisRecords = records.map((record) => ({
    step: record.step,
    linvelY: record.chassisLinvelY,
    heightM: record.chassisHeightM,
  }));
  const minChassisLinvelY = Math.min(...chassisRecords.map((r) => r.linvelY));
  const perBodyMinLinvelY = Object.fromEntries(
    physics.bodyMotionSnapshots().map((snapshot) => {
      const label = snapshot.label;
      const minY = Math.min(
        ...records.flatMap((record) =>
          record.bodies
            .filter((body) => body.groupId === snapshot.groupId)
            .map((body) => body.linvel[1]),
        ),
      );
      return [label, minY];
    }),
  );
  const firstAirStopByBody = Object.fromEntries(
    physics.bodyMotionSnapshots().map((snapshot) => {
      const first = airStopEvents.find(
        (event) => event.bodyLabel === snapshot.label,
      );
      return [snapshot.label, first?.step ?? null];
    }),
  );

  const contactWindows = records
    .filter((record) => record.contacts)
    .map((record) => {
      const contacts = record.contacts!;
      const sameMachine = contacts.filter((c) => c.sameMachine);
      const jointConnected = contacts.filter((c) => c.jointConnected);
      const withManifold = contacts.filter((c) => c.hasManifold);
      const sameMachineManifold = sameMachine.filter((c) => c.hasManifold);
      return {
        step: record.step,
        chassisHeightM: record.chassisHeightM,
        chassisLinvelY: record.chassisLinvelY,
        pairCount: contacts.length,
        sameMachinePairCount: sameMachine.length,
        jointConnectedPairCount: jointConnected.length,
        manifoldPairCount: withManifold.length,
        sameMachineManifoldCount: sameMachineManifold.length,
        sameMachinePairs: sameMachine.map((c) => ({
          partA: c.partA,
          partB: c.partB,
          bodyA: c.bodyA.slice(0, 40),
          bodyB: c.bodyB.slice(0, 40),
          jointConnected: c.jointConnected,
          hasManifold: c.hasManifold,
          numContacts: c.numContacts,
          numSolverContacts: c.numSolverContacts,
          normal: c.normal,
          minDist: c.points.length
            ? Math.min(...c.points.map((p) => p.dist))
            : null,
          maxImpulse: c.points.length
            ? Math.max(...c.points.map((p) => p.impulse))
            : null,
          ccdA: c.ccdA,
          ccdB: c.ccdB,
        })),
        externalManifoldPairs: contacts
          .filter((c) => !c.sameMachine && c.hasManifold)
          .slice(0, 10)
          .map((c) => ({
            partA: c.partA,
            partB: c.partB,
            bodyB: c.bodyB.slice(0, 40),
            numContacts: c.numContacts,
            normal: c.normal,
          })),
      };
    });

  const meta = gitMeta();
  const evidence = {
    capturedAt: new Date().toISOString(),
    experiment: "ccd-fall",
    mode,
    ...config,
    note: `注意: Productionは既に joint.setContactsEnabled(false) 済み。F/Gは現行挙動の再確認。EだけContactをONに戻す。`,
    gitHead: meta.gitHead,
    branch: meta.branch,
    workingTreeDirty: meta.workingTreeDirty,
    initialHeightM,
    initialFallSpeedMps,
    steps,
    bodyCount: physics.bodyMotionSnapshots().length,
    bodySetup: physics.bodyMotionSnapshots().map((snapshot) => ({
      groupId: snapshot.groupId,
      role: snapshot.role,
      label: snapshot.label,
      ccdEnabled: snapshot.ccdEnabled,
    })),
    summary: {
      minChassisLinvelY,
      perBodyMinLinvelY,
      airStopEventCount: airStopEvents.length,
      firstAirStopStep: airStopEvents[0]?.step ?? null,
      chassisStagnationStep: chassisStagnationStep(records),
      firstAirStopByBody,
      finalChassisHeightM: chassisRecords.at(-1)?.heightM ?? null,
      finalChassisLinvelY: chassisRecords.at(-1)?.linvelY ?? null,
    },
    airStopEvents: airStopEvents.slice(0, 40),
    contactWindows,
    chassisTimeline: chassisRecords.filter(
      (_, index) => index % 2 === 0 || index === records.length - 1,
    ),
    records: records.map(({ contacts: _contacts, ...rest }) => rest),
  };

  await mkdir("docs/evidence", { recursive: true });
  await writeFile(output, JSON.stringify(evidence, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        mode,
        ccdMode: config.ccdMode,
        jointContactsEnabled: config.jointContactsEnabled,
        excludeMachineSelfCollision: config.excludeMachineSelfCollision,
        note: config.note,
        output,
        minChassisLinvelY,
        airStopEventCount: airStopEvents.length,
        firstAirStopStep: airStopEvents[0]?.step ?? null,
        chassisStagnationStep: chassisStagnationStep(records),
        contactWindowSummary: contactWindows.map((w) => ({
          step: w.step,
          sameMachine: w.sameMachinePairCount,
          jointConnected: w.jointConnectedPairCount,
          manifold: w.manifoldPairCount,
          sameMachineManifold: w.sameMachineManifoldCount,
        })),
      },
      null,
      2,
    ),
  );
  physics.dispose();
}

await main();
