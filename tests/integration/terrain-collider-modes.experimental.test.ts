import { expect, it } from "vitest";

/**
 * Experimental: Terrain Collider 配置モード A/B/C と
 * DynamicRayCastVehicleController の接地を、Rapier 単体の最小構成で比較する。
 *
 * A: Standalone Trimesh + world-space vertices
 * B: Standalone local Trimesh + setTranslation
 * C: Fixed Body + local Trimesh
 *
 * 重要: 本テストは「本番で観測された接地回帰」の再現実験であり、
 * Production 実装を変更しない。結果が A/B/C 同等でも根本原因の否定にはならない。
 * （Production 環境では再現するが、最小構成では未再現、となり得る）
 */
type Mode = "A_world" | "B_local_translation" | "C_fixed_body";

async function runMode(mode: Mode) {
  const RAPIER = await import("@dimforge/rapier3d-compat");
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const half = 20;
  const verts = new Float32Array([
    -half,
    0,
    -half,
    half,
    0,
    -half,
    half,
    0,
    half,
    -half,
    0,
    half,
  ]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const origin = { x: 100, y: 0, z: 0 };

  if (mode === "A_world") {
    const worldVerts = new Float32Array(verts.length);
    for (let i = 0; i < verts.length; i += 3) {
      worldVerts[i] = verts[i] + origin.x;
      worldVerts[i + 1] = verts[i + 1];
      worldVerts[i + 2] = verts[i + 2] + origin.z;
    }
    world.createCollider(
      RAPIER.ColliderDesc.trimesh(worldVerts, indices).setFriction(1.4),
    );
  } else if (mode === "B_local_translation") {
    world.createCollider(
      RAPIER.ColliderDesc.trimesh(verts, indices)
        .setFriction(1.4)
        .setTranslation(origin.x, origin.y, origin.z),
    );
  } else {
    const terrainBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(origin.x, origin.y, origin.z),
    );
    world.createCollider(
      RAPIER.ColliderDesc.trimesh(verts, indices).setFriction(1.4),
      terrainBody,
    );
  }

  const chassis = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(origin.x, 1.2, origin.z)
      .setCanSleep(false),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.6, 0.2, 1).setDensity(80),
    chassis,
  );
  const controller = world.createVehicleController(chassis);
  controller.indexUpAxis = 1;
  controller.setIndexForwardAxis = 2;
  for (const w of [
    { x: 0.5, y: 0.1, z: 0.7 },
    { x: -0.5, y: 0.1, z: 0.7 },
    { x: 0.5, y: 0.1, z: -0.7 },
    { x: -0.5, y: 0.1, z: -0.7 },
  ]) {
    const i = controller.numWheels();
    controller.addWheel(
      { x: w.x, y: w.y, z: w.z },
      { x: 0, y: -1, z: 0 },
      { x: -1, y: 0, z: 0 },
      0.4,
      0.3,
    );
    controller.setWheelSuspensionStiffness(i, 40);
    controller.setWheelSuspensionCompression(i, 2.5);
    controller.setWheelSuspensionRelaxation(i, 3.5);
    controller.setWheelFrictionSlip(i, 3);
    controller.setWheelMaxSuspensionForce(i, 6000);
    controller.setWheelMaxSuspensionTravel(i, 0.25);
  }

  const settle = (throttle: number, steps: number) => {
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < controller.numWheels(); i++) {
        controller.setWheelEngineForce(
          i,
          throttle > 0 ? (i < 2 ? 0 : 80 * throttle) : 0,
        );
        controller.setWheelSteering(i, 0);
        controller.setWheelBrake(i, 0);
      }
      controller.updateVehicle(1 / 60);
      world.step();
    }
  };

  const snapshot = () => {
    const t = chassis.translation();
    const v = chassis.linvel();
    let grounded = 0;
    for (let i = 0; i < controller.numWheels(); i++) {
      if (
        (
          controller as unknown as {
            wheelIsInContact?: (index: number) => boolean;
          }
        ).wheelIsInContact?.(i)
      )
        grounded++;
    }
    return {
      y: t.y,
      speedH: Math.hypot(v.x, v.z),
      grounded,
      finite: [t.x, t.y, t.z, v.x, v.y, v.z].every(Number.isFinite),
    };
  };

  settle(0, 90);
  const before = snapshot();
  settle(1, 90);
  const throttled = snapshot();

  const delta = { x: origin.x, y: 0, z: origin.z };
  world.forEachRigidBody((body) => {
    const t = body.translation();
    body.setTranslation(
      { x: t.x - delta.x, y: t.y - delta.y, z: t.z - delta.z },
      false,
    );
    body.setLinvel(body.linvel(), false);
    body.setAngvel(body.angvel(), false);
  });
  world.forEachCollider((col) => {
    if (col.parent()) return;
    const t = col.translation();
    col.setTranslation({
      x: t.x - delta.x,
      y: t.y - delta.y,
      z: t.z - delta.z,
    });
  });
  world.propagateModifiedBodyPositionsToColliders();

  settle(0, 30);
  const afterSettle = snapshot();
  settle(1, 90);
  const afterThrottle = snapshot();
  world.free();
  return { before, throttled, afterSettle, afterThrottle };
}

for (const mode of [
  "A_world",
  "B_local_translation",
  "C_fixed_body",
] as const) {
  it(`experimental ${mode}: 最小構成では Rebase 相当移動の前後で接地・加速が成立する`, async () => {
    const result = await runMode(mode);
    for (const phase of [
      result.before,
      result.throttled,
      result.afterSettle,
      result.afterThrottle,
    ]) {
      expect(phase.finite).toBe(true);
      expect(phase.grounded).toBeGreaterThanOrEqual(2);
      expect(phase.y).toBeGreaterThan(0.2);
      expect(phase.y).toBeLessThan(1.5);
    }
    expect(result.throttled.speedH).toBeGreaterThan(1);
    expect(result.afterThrottle.speedH).toBeGreaterThan(
      result.afterSettle.speedH + 0.5,
    );
  });
}
