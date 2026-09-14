import { expect, test } from "@playwright/test";
import { listObservationScenarios } from "../../packages/runtime-telemetry/src/index";

test("Agent API が11 Scenarioを公開する @smoke", async ({ page }) => {
  await page.goto("/?agent=1");
  await page.waitForFunction(
    () =>
      Boolean(
        (
          window as unknown as {
            __MACHINE_STUDIO_AGENT__?: { version: number };
          }
        ).__MACHINE_STUDIO_AGENT__?.version,
      ),
    undefined,
    { timeout: 30_000 },
  );
  const listed = await page.evaluate(() => {
    const agent = (
      window as unknown as {
        __MACHINE_STUDIO_AGENT__: {
          listScenarios: () => Array<{ id: string }>;
          getState: () => unknown;
        };
      }
    ).__MACHINE_STUDIO_AGENT__;
    return {
      scenarios: agent.listScenarios().map((scenario) => scenario.id),
      state: agent.getState(),
    };
  });
  const expected = listObservationScenarios().map((scenario) => scenario.id);
  expect(listed.scenarios.sort()).toEqual([...expected].sort());
  expect(listed.scenarios).toHaveLength(11);
  expect(listed.state).toHaveProperty("engine");
  expect(listed.state).toHaveProperty("machine");
  expect(listed.state).toHaveProperty("world");
});
