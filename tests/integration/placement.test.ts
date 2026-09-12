import { test, expect } from "vitest";
import { CommandBus } from "../../packages/command-system/src/index";
import {
  createMachine,
  findAttachmentCandidates,
} from "../../packages/machine-system/src/index";
import { emptyProject } from "../../packages/project-schema/src/index";
import { RapierPhysics } from "../../packages/physics-rapier/src/index";
import { saveProject, loadProject } from "../../packages/storage/src/index";

test("候補だけから作った4輪車が回転・つけ直し後にも走行し、保存モデルを維持する", async () => {
  const bus = new CommandBus(emptyProject()),
    machine = createMachine();
  bus.execute({ type: "machine.create", machine });
  const attach = (kind: "Panel" | "Wheel", id: string) =>
    bus.execute({
      type: "part.attach",
      machineId: machine.id,
      partId: id,
      kind,
      candidateId: findAttachmentCandidates(bus.project.machines[0], kind)[0]
        .id,
    });
  attach("Panel", "panel");
  // 前後2枚にしてWheel間隔を確保する。
  attach("Panel", "panel-front");
  attach("Wheel", "wheel-0");
  bus.execute({
    type: "part.reattach",
    machineId: machine.id,
    partId: "wheel-0",
    candidateId: findAttachmentCandidates(
      bus.project.machines[0],
      "Wheel",
      "wheel-0",
    ).find((candidate) => candidate.parentPartId === "panel")!.id,
  });
  for (let i = 1; i < 4; i++) attach("Wheel", "wheel-" + i);
  bus.execute({
    type: "part.turn",
    machineId: machine.id,
    partId: "wheel-0",
    steps: 1,
  });
  const before = bus.project;
  const physics = new RapierPhysics();
  try {
    await physics.load(before);
    for (let i = 0; i < 120; i++) physics.step(0, 0);
    const a = physics.poses().get(machine.id)!.position;
    for (let i = 0; i < 240; i++) physics.step(1, 0);
    const b = physics.poses().get(machine.id)!.position;
    expect(Math.hypot(b[0] - a[0], b[2] - a[2])).toBeGreaterThan(2);
    expect(b.every(Number.isFinite)).toBe(true);
    expect(bus.project).toEqual(before);
    const data = new Map<string, string>();
    const storage = {
      setItem: (k: string, v: string) => {
        data.set(k, v);
      },
      getItem: (k: string) => data.get(k) ?? null,
    };
    saveProject(storage, before);
    expect(loadProject(storage)).toEqual(before);
  } finally {
    physics.dispose();
  }
});
