import { expect, it } from "vitest";
import { emptyProject } from "../../packages/project-schema/src/index";
import { createProceduralWorld } from "../../packages/world-generator/src/index";
import { starterCarTemplate } from "../../packages/machine-system/src/index";
import { RapierPhysics } from "../../packages/physics-rapier/src/index";

it("標高のあるWorld DesignのSpawnでマシンが接地する", async () => {
  const p = emptyProject();
  p.world = { ...p.world, ...createProceduralWorld({ preset: "toy-islands" }) };
  p.machines = [starterCarTemplate()];
  const physics = new RapierPhysics();
  try {
    await physics.load(p);
    for (let i = 0; i < 180; i++) physics.step({ throttle: 0 });
    const sample = physics.telemetry.current(p.machines[0].id)!;
    expect(sample.position[1]).toBeGreaterThan(4);
    expect(sample.terrainHeightM).toBeGreaterThan(4);
    expect(sample.groundedWheelCount).toBeGreaterThan(0);
  } finally {
    physics.dispose();
  }
});
