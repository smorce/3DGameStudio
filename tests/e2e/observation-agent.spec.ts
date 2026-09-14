import { expect, test } from "@playwright/test";
import { listObservationScenarios } from "../../packages/runtime-telemetry/src/index";
import { emptyProject } from "../../packages/project-schema/src/index";
import { planeTemplate } from "../../packages/machine-system/src/index";
import { createStarterWorld } from "../../packages/world-system/src/index";

test("Agent API が11 Scenarioを公開する @smoke", async ({ page }) => {
  test.setTimeout(60_000);
  const project = emptyProject();
  Object.assign(
    project.world,
    createStarterWorld({ preset: "airfield", seed: 42 }),
  );
  project.machines.push(planeTemplate());
  await page.addInitScript(
    (value) =>
      localStorage.setItem("machine-studio.project", JSON.stringify(value)),
    project,
  );
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

  const started = await page.evaluate(() => {
    const agent = (
      window as unknown as {
        __MACHINE_STUDIO_AGENT__: {
          beginObservation: (scenarioId: string) => unknown;
        };
      }
    ).__MACHINE_STUDIO_AGENT__;
    return agent.beginObservation("starter-plane-turn-left");
  });
  expect(started).toMatchObject({
    scenarioId: "starter-plane-turn-left",
    seed: 42,
    environment: { mode: "browser", app: "studio" },
  });
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __MACHINE_STUDIO_AGENT__: {
                getState: () => { engine: { mode: string } };
              };
            }
          ).__MACHINE_STUDIO_AGENT__.getState().engine.mode,
      ),
    )
    .toBe("PLAY");
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(4000);
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(4000);
  await page.keyboard.up("ArrowLeft");
  await page.waitForTimeout(2000);
  await page.keyboard.up("KeyW");
  const events = await page.evaluate(() => {
    const agent = (
      window as unknown as {
        __MACHINE_STUDIO_AGENT__: {
          getEvents: () => Array<{ name: string }>;
        };
      }
    ).__MACHINE_STUDIO_AGENT__;
    return agent.getEvents();
  });
  const names = events.map((event) => event.name);
  expect(names).toContain("renderer.frame");
  expect(names).toContain("physics.machine.sample");
  expect(names).toContain("world.streaming.stats");
  expect(names).toContain("world.chunk.committed");
  expect(names).toContain("camera.follow.sample");
  await page.evaluate(() => {
    const agent = (
      window as unknown as {
        __MACHINE_STUDIO_AGENT__: {
          endObservation: (result: "pass") => unknown;
        };
      }
    ).__MACHINE_STUDIO_AGENT__;
    agent.endObservation("pass");
  });
});
