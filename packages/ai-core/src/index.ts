import { z } from "zod";
import { commandSchema, type CommandBus } from "../../command-system/src/index";
import type { Project } from "../../project-schema/src/index";
export const planSchema = z.object({
  version: z.literal(1),
  provider: z.literal("dummy"),
  title: z.string(),
  explanation: z.string(),
  commands: z.array(commandSchema).max(100),
});
export type Plan = z.infer<typeof planSchema>;
export interface AIProvider {
  createMachinePlan(prompt: string, project: Project): Promise<Plan>;
  createWorldPlan(prompt: string, project: Project): Promise<Plan>;
  createCoursePlan(prompt: string, project: Project): Promise<Plan>;
  createAssetSpec(
    prompt: string,
  ): Promise<{ prompt: string; kind: "placeholder" }>;
  diagnoseMachine(project: Project): Promise<Plan>;
}
export function applyPlan(bus: CommandBus, input: unknown) {
  const plan = planSchema.parse(input);
  bus.batch(plan.commands);
}
