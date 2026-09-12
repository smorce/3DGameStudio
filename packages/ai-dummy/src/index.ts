import {
  planSchema,
  type AIProvider,
  type Plan,
} from "../../ai-core/src/index";
import { type Project, uid, identity } from "../../project-schema/src/index";
import { carTemplate, createPart } from "../../machine-system/src/index";
import { createCourse } from "../../course-system/src/index";
export class DummyAIProvider implements AIProvider {
  constructor(private delay = 180) {}
  private async plan(title: string, commands: Plan["commands"], prompt = "") {
    await new Promise((r) => setTimeout(r, this.delay));
    if (prompt.includes("fail")) throw new Error("Simulated AI failure");
    return planSchema.parse({
      version: 1,
      provider: "dummy",
      title,
      explanation:
        "テンプレートによる提案です。内容を確認してから適用してください。",
      commands,
    });
  }
  createMachinePlan(prompt: string, p: Project) {
    const m = p.machines[0];
    const requestedSuspension = prompt.includes("サスペンション");
    return this.plan(
      requestedSuspension
        ? "サスペンションを追加してみる？"
        : "後ろにジェットを付けてみる？",
      m
        ? [
            {
              type: "part.add",
              machineId: m.id,
              part: createPart(
                requestedSuspension ? "Suspension" : "Thruster",
                [0, 1, -1.8],
              ),
            },
          ]
        : [{ type: "machine.create", machine: carTemplate() }],
      prompt,
    );
  }
  createWorldPlan(prompt: string, p: Project) {
    return this.plan(
      "南国の島と大きなジャンプ台",
      [
        {
          type: "world.update",
          patch: { water: { enabled: true, height: -0.2 } },
        },
        { type: "terrain.raise", x: 0, z: 0, radius: 40, strength: 1.5 },
        {
          type: "asset.place",
          entity: {
            id: uid(),
            name: "島の木",
            kind: "tree",
            transform: { ...identity(), position: [8, 1, 8] },
          },
        },
        {
          type: "course.create",
          course: {
            ...createCourse("島のジャンプコース"),
            obstacles: [
              { id: uid(), kind: "jump", position: [0, 0, 8], size: [4, 1, 5] },
            ],
          },
        },
      ],
      prompt + String(p.schemaVersion),
    );
  }
  createCoursePlan(prompt: string, _p: Project) {
    return this.plan(
      "チェックポイント付きコース",
      [{ type: "course.create", course: createCourse() }],
      prompt,
    );
  }
  async createAssetSpec(prompt: string) {
    await new Promise((r) => setTimeout(r, this.delay));
    return { prompt, kind: "placeholder" as const };
  }
  diagnoseMachine(p: Project) {
    const m = p.machines[0];
    return this.plan(
      "車体を少し低くすると安定しそうです",
      m
        ? m.parts
            .filter((a) => a.definitionId === "Panel")
            .map((a) => ({
              type: "part.move",
              machineId: m.id,
              partId: a.id,
              value: [a.transform.position[0], 0.65, a.transform.position[2]],
            }))
        : [],
    );
  }
}
