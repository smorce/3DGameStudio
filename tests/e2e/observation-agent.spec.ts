import { expect, test } from "@playwright/test";
import { listObservationScenarios } from "../../packages/runtime-telemetry/src/index";
import { emptyProject } from "../../packages/project-schema/src/index";
import { planeTemplate } from "../../packages/machine-system/src/index";
import { createStarterWorld } from "../../packages/world-system/src/index";

type AgentWindow = Window & {
  __MACHINE_STUDIO_AGENT__?: {
    version: number;
    listScenarios: () => Array<{ id: string }>;
    getState: () => {
      engine: { mode: string };
      machine: { physicsStep: number | null };
    };
    getPhysicsStep: () => number;
    beginObservation: (scenarioId: string) => unknown;
    endObservation: (result: "pass" | "fail" | "error") => unknown;
    getEvents: () => Array<{ name: string }>;
  };
};

async function waitForAgent(page: import("@playwright/test").Page) {
  await page.waitForFunction(
    () => Boolean((window as AgentWindow).__MACHINE_STUDIO_AGENT__?.version),
    undefined,
    { timeout: 30_000 },
  );
}

async function loadScenarioProject(
  page: import("@playwright/test").Page,
  scenario: {
    worldPreset: "airfield" | "grassland";
    seed: number;
  },
) {
  const project = emptyProject();
  Object.assign(
    project.world,
    createStarterWorld({
      preset: scenario.worldPreset,
      seed: scenario.seed,
    }),
  );
  project.machines.push(planeTemplate());
  await page.goto("about:blank");
  await page.evaluate((value) => {
    localStorage.setItem("machine-studio.project", JSON.stringify(value));
  }, project);
  await page.goto("/?agent=1&observe=1");
  await waitForAgent(page);
}

async function playUntilPhysicsStep(
  page: import("@playwright/test").Page,
  toStep: number,
) {
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as AgentWindow).__MACHINE_STUDIO_AGENT__!.getState().engine
            .mode,
      ),
    )
    .toBe("PLAY");
  await page.keyboard.down("KeyW");
  await page.waitForFunction(
    (step) =>
      ((window as AgentWindow).__MACHINE_STUDIO_AGENT__?.getPhysicsStep?.() ??
        0) >= step,
    toStep,
    { timeout: 60_000 },
  );
  await page.keyboard.up("KeyW");
}

test("Agent API が11 Scenarioを公開する @smoke", async ({ page }) => {
  test.setTimeout(90_000);
  await loadScenarioProject(page, { worldPreset: "airfield", seed: 42 });
  const listed = await page.evaluate(() => {
    const agent = (window as AgentWindow).__MACHINE_STUDIO_AGENT__!;
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
  expect(listed.state.machine).toHaveProperty("physicsStep");

  const started = await page.evaluate(() => {
    const agent = (window as AgentWindow).__MACHINE_STUDIO_AGENT__!;
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
          (window as AgentWindow).__MACHINE_STUDIO_AGENT__!.getState().engine
            .mode,
      ),
    )
    .toBe("PLAY");
  await page.keyboard.down("KeyW");
  await page.waitForFunction(
    () =>
      ((window as AgentWindow).__MACHINE_STUDIO_AGENT__?.getPhysicsStep?.() ??
        0) >= 240,
    undefined,
    { timeout: 60_000 },
  );
  await page.keyboard.down("ArrowLeft");
  await page.waitForFunction(
    () =>
      ((window as AgentWindow).__MACHINE_STUDIO_AGENT__?.getPhysicsStep?.() ??
        0) >= 480,
    undefined,
    { timeout: 60_000 },
  );
  await page.keyboard.up("ArrowLeft");
  await page.waitForFunction(
    () =>
      ((window as AgentWindow).__MACHINE_STUDIO_AGENT__?.getPhysicsStep?.() ??
        0) >= 600,
    undefined,
    { timeout: 60_000 },
  );
  await page.keyboard.up("KeyW");
  const events = await page.evaluate(() => {
    const agent = (window as AgentWindow).__MACHINE_STUDIO_AGENT__!;
    return agent.getEvents();
  });
  const names = events.map((event) => event.name);
  expect(names).toContain("renderer.frame");
  expect(names).toContain("physics.machine.sample");
  expect(names).toContain("world.streaming.stats");
  expect(names).toContain("world.chunk.committed");
  expect(names).toContain("camera.follow.sample");
  await page.evaluate(() => {
    const agent = (window as AgentWindow).__MACHINE_STUDIO_AGENT__!;
    agent.endObservation("pass");
  });
});

test("11 Scenario smoke: begin→短時間play→events→end @smoke", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const scenarios = listObservationScenarios();
  expect(scenarios).toHaveLength(11);

  for (const scenario of scenarios) {
    await loadScenarioProject(page, scenario);
    const started = await page.evaluate((id) => {
      const agent = (window as AgentWindow).__MACHINE_STUDIO_AGENT__!;
      return agent.beginObservation(id);
    }, scenario.id);
    expect(started).toMatchObject({
      scenarioId: scenario.id,
      seed: scenario.seed,
    });

    const smokeSteps = Math.min(90, scenario.durationSteps);
    await playUntilPhysicsStep(page, smokeSteps);

    const events = await page.evaluate(() => {
      const agent = (window as AgentWindow).__MACHINE_STUDIO_AGENT__!;
      return agent.getEvents();
    });
    const names = new Set(events.map((event) => event.name));
    expect(
      names.has("renderer.frame"),
      `${scenario.id}: missing renderer.frame`,
    ).toBeTruthy();
    expect(
      names.has("physics.machine.sample"),
      `${scenario.id}: missing physics.machine.sample`,
    ).toBeTruthy();
    expect(
      names.has("world.streaming.stats"),
      `${scenario.id}: missing world.streaming.stats`,
    ).toBeTruthy();

    const ended = await page.evaluate(() => {
      const agent = (window as AgentWindow).__MACHINE_STUDIO_AGENT__!;
      return agent.endObservation("pass");
    });
    expect(ended).toMatchObject({
      scenarioId: scenario.id,
      result: "pass",
    });
  }
});
