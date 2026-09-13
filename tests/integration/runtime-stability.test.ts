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
  worldCollidersForEntity,
} from "../../packages/world-system/src/index";
import { commitWorldOriginShift } from "../../packages/engine-core/src/rebase";

const hypot3 = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

it("Building Colliderは見た目の外壁付近で接触する", async () => {
  const rapier = await import("@dimforge/rapier3d-compat");
  await rapier.init();
  const world = new rapier.World({ x: 0, y: 0, z: 0 });
  const poses = worldCollidersForEntity("building", {
    position: [0, 0, 40],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  });
  for (const pose of poses) {
    const desc =
      pose.type === "cuboid"
        ? rapier.ColliderDesc.cuboid(
            pose.halfExtents[0],
            pose.halfExtents[1],
            pose.halfExtents[2],
          )
        : pose.type === "cylinder"
          ? rapier.ColliderDesc.cylinder(pose.halfHeight, pose.radius)
          : rapier.ColliderDesc.ball(pose.radius);
    world.createCollider(
      desc
        .setTranslation(
          pose.translation[0],
          pose.translation[1],
          pose.translation[2],
        )
        .setRotation({
          x: pose.rotation[0],
          y: pose.rotation[1],
          z: pose.rotation[2],
          w: pose.rotation[3],
        }),
    );
  }
  expect(world.colliders.len()).toBeGreaterThan(0);
  world.step();
  const hit = world.castRay(
    new rapier.Ray({ x: 0, y: 1.3, z: 0 }, { x: 0, y: 0, z: 1 }),
    80,
    true,
  );
  expect(hit).toBeTruthy();
  expect(hit!.timeOfImpact).toBeCloseTo(39, 1);
  expect(hit!.timeOfImpact).toBeLessThan(39.2);
  world.free();
});

it("Tree Colliderは幹半径付近で接触し葉全体の巨大Boxではない", async () => {
  const rapier = await import("@dimforge/rapier3d-compat");
  await rapier.init();
  const world = new rapier.World({ x: 0, y: 0, z: 0 });
  const poses = worldCollidersForEntity("tree", {
    position: [0, 0, 20],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  });
  expect(poses).toHaveLength(1);
  expect(poses[0].type).toBe("cylinder");
  if (poses[0].type !== "cylinder") return;
  world.createCollider(
    rapier.ColliderDesc.cylinder(
      poses[0].halfHeight,
      poses[0].radius,
    ).setTranslation(
      poses[0].translation[0],
      poses[0].translation[1],
      poses[0].translation[2],
    ),
  );
  world.step();
  const hit = world.castRay(
    new rapier.Ray({ x: 5, y: 0.75, z: 20 }, { x: -1, y: 0, z: 0 }),
    10,
    true,
  );
  expect(hit).toBeTruthy();
  expect(hit!.timeOfImpact).toBeCloseTo(4.8, 1);
  world.free();
});

it("Starter Planeの長距離飛行でRebaseしても空中停止せずHingeが離れない", async () => {
  const project = emptyProject();
  Object.assign(project.world, createStarterWorld({ preset: "airfield" }));
  project.machines.push(planeTemplate());
  const runtime = new WorldRuntime(project.world);
  const physics = new RapierPhysics();
  await physics.load(project, { world: runtime });
  physics.respawn(project.world.spawnPoints[0] ?? [0, 2, 8]);
  physics.telemetry.start();
  const machineId = project.machines[0].id;
  let airStop = 0;
  let maxGlobalJump = 0;
  let maxHinge = 0;
  let previous = physics.telemetry.current(machineId);
  const rebaseSnapshots: {
    velocityBefore: number;
    velocityAfter: number;
    hingeBefore: number;
    hingeAfter: number;
  }[] = [];
  for (let step = 0; step < 2100; step++) {
    const pitch = step >= 240 && step < 320 ? 1 : 0;
    const originBefore = [...runtime.worldOrigin];
    physics.step({ throttle: 1, pitch });
    expect(runtime.worldOrigin).toEqual(originBefore);
    const focus = physics.focusGlobal();
    if (focus) {
      const velocityBefore = physics.vehicles[0].body.linvel();
      const hingeBefore = Math.max(
        0,
        ...physics.jointAnchorErrors().map((item) => item.separationM),
      );
      const plan = commitWorldOriginShift(runtime, physics, undefined, focus);
      if (plan) {
        const velocityAfter = physics.vehicles[0].body.linvel();
        const hingeAfter = Math.max(
          0,
          ...physics.jointAnchorErrors().map((item) => item.separationM),
        );
        rebaseSnapshots.push({
          velocityBefore: Math.hypot(
            velocityBefore.x,
            velocityBefore.y,
            velocityBefore.z,
          ),
          velocityAfter: Math.hypot(
            velocityAfter.x,
            velocityAfter.y,
            velocityAfter.z,
          ),
          hingeBefore,
          hingeAfter,
        });
      }
    }
    const sample = physics.telemetry.current(machineId);
    if (sample && previous) {
      const originChanged =
        sample.worldOrigin && previous.worldOrigin
          ? hypot3(sample.worldOrigin, previous.worldOrigin) > 0.001
          : false;
      const jump = hypot3(sample.position, previous.position);
      if (!originChanged) maxGlobalJump = Math.max(maxGlobalJump, jump);
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
  expect(hypot3(last.position, start.position)).toBeGreaterThan(500);
  expect(runtime.rebaseCount).toBeGreaterThanOrEqual(3);
  expect(last.position.every(Number.isFinite)).toBe(true);
  expect(last.linearVelocityMps.every(Number.isFinite)).toBe(true);
  expect(last.rotation.every(Number.isFinite)).toBe(true);
  expect(airStop).toBe(0);
  expect(maxGlobalJump).toBeLessThan(5);
  expect(maxHinge).toBeLessThan(0.03);
  expect(rebaseSnapshots.length).toBeGreaterThanOrEqual(3);
  for (const snapshot of rebaseSnapshots) {
    expect(
      Math.abs(snapshot.velocityAfter - snapshot.velocityBefore),
    ).toBeLessThan(0.05);
    expect(snapshot.hingeAfter).toBeLessThan(0.03);
  }
  const roles = new Set(physics.jointAnchorErrors().map((item) => item.id));
  for (const role of [
    "aileron-left",
    "aileron-right",
    "elevator-left",
    "elevator-right",
    "rudder",
  ])
    expect(roles.has(role)).toBe(true);
  physics.dispose();
  runtime.dispose();
}, 20000);

it("既存Car/Boat/Planeはfiniteでもproceduralでも動く", async () => {
  for (const [template, preset] of [
    [carTemplate, "grassland"],
    [boatTemplate, "archipelago"],
    [planeTemplate, "airfield"],
  ] as const) {
    const project = emptyProject();
    Object.assign(project.world, createStarterWorld({ preset }));
    project.machines = [template()];
    const runtime = new WorldRuntime(project.world);
    const physics = new RapierPhysics();
    await physics.load(project, { world: runtime });
    physics.respawn(project.world.spawnPoints[0] ?? [0, 2, 0]);
    for (let i = 0; i < 90; i++) physics.step({ throttle: 1 });
    const sample = physics.telemetry.current(project.machines[0].id);
    expect(sample?.linearVelocityMps.every(Number.isFinite)).toBe(true);
    expect(sample?.position.every(Number.isFinite)).toBe(true);
    physics.dispose();
    runtime.dispose();
  }
});
