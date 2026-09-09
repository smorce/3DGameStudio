import { it, expect } from "vitest";
import { emptyProject } from "../../packages/project-schema/src/index";
import { carTemplate } from "../../packages/machine-system/src/index";
import { RapierPhysics } from "../../packages/physics-rapier/src/index";
import { CommandBus } from "../../packages/command-system/src/index";
import { saveProject, loadProject } from "../../packages/storage/src/index";
it("4輪車が物理世界で前進し編集・保存データを変更しない", async () => {
  const bus = new CommandBus(emptyProject());
  bus.execute({ type: "machine.create", machine: carTemplate() });
  const before = bus.project;
  const physics = new RapierPhysics();
  await physics.load(before);
  for (let i = 0; i < 120; i++) physics.step(0, 0);
  const a = physics.poses().values().next().value!.position;
  for (let i = 0; i < 240; i++) physics.step(1, 0);
  const b = physics.poses().values().next().value!.position;
  expect(Math.hypot(b[0] - a[0], b[2] - a[2])).toBeGreaterThan(2);
  expect(Number.isFinite(b[1])).toBe(true);
  expect(bus.project).toEqual(before);
  const data = new Map<string, string>();
  const storage = {
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    getItem: (k: string) => data.get(k) ?? null,
  };
  saveProject(storage, bus.project);
  expect(loadProject(storage)).toEqual(before);
  physics.dispose();
});

it("接続グループの分離、可動関節、ジェット推力を実行する", async () => {
  const { createPart, attachPart } =
    await import("../../packages/machine-system/src/index");
  const p = emptyProject(),
    m = carTemplate();
  const hinge = createPart("Hinge", [0, 1.8, 0]);
  attachPart(m, hinge);
  const jet = createPart("Thruster", [0, 1, -1.7]);
  attachPart(m, jet);
  p.machines.push(m);
  const physics = new RapierPhysics();
  await physics.load(p);
  expect(physics.stats.rigidBodies).toBe(2);
  expect(physics.stats.joints).toBe(1);
  for (let i = 0; i < 120; i++) physics.step(1, 0.1);
  expect(physics.poses().has(hinge.id)).toBe(true);
  expect(physics.poses().get(m.id)!.position.every(Number.isFinite)).toBe(true);
  physics.dispose();
});
