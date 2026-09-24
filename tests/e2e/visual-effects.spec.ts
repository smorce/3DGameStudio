import { test, expect } from "./fixtures";
import type { AgentGameState } from "../../packages/engine-core/src/agent-observation";
import { emptyProject } from "../../packages/project-schema/src/index";
import { planeTemplate } from "../../packages/machine-system/src/index";
import { createStarterWorld } from "../../packages/world-system/src/index";

type AgentWindow = Window & {
  __MACHINE_STUDIO_AGENT__: { getState(): AgentGameState };
};

test("PLAYの翼・車輪VFXとSTOP・再読込の消去を確認する @smoke", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const project = emptyProject();
  Object.assign(
    project.world,
    createStarterWorld({ preset: "airfield", seed: 42 }),
  );
  project.machines = [planeTemplate()];
  await page.addInitScript(
    (p) => localStorage.setItem("machine-studio.project", JSON.stringify(p)),
    project,
  );
  await page.goto("/?agent=1&observe=1");
  await page.waitForFunction(() =>
    Boolean((window as unknown as AgentWindow).__MACHINE_STUDIO_AGENT__),
  );
  const state = () =>
    page.evaluate(() =>
      (window as unknown as AgentWindow).__MACHINE_STUDIO_AGENT__.getState(),
    );
  await expect.poll(async () => (await state()).renderer.vaporEmitters).toBe(2);
  expect((await state()).renderer.activeVaporParticles).toBe(0);
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  await expect.poll(async () => (await state()).engine.mode).toBe("PLAY");
  expect((await state()).renderer.activeVaporParticles).toBe(0);
  await page.keyboard.down("KeyW");
  await expect
    .poll(async () => (await state()).renderer.activeGroundSmokeParticles, {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  await page.screenshot({ path: "docs/screenshots/vfx-ground-contact.png" });
  await expect
    .poll(async () => (await state()).renderer.activeVaporParticles, {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  await page.keyboard.down("ArrowUp");
  await expect
    .poll(async () => (await state()).machine.groundedWheelCount, {
      timeout: 30_000,
    })
    .toBe(0);
  await expect
    .poll(async () => (await state()).renderer.activeGroundSmokeParticles, {
      timeout: 30_000,
    })
    .toBe(0);
  await page.keyboard.up("ArrowUp");
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(700);
  await page.keyboard.up("ArrowLeft");
  await page.screenshot({ path: "docs/screenshots/vfx-flight-turn.png" });
  await page.keyboard.up("KeyW");
  await page.getByRole("button", { name: "■ やめる", exact: true }).click();
  await expect
    .poll(async () => (await state()).engine.mode, { timeout: 30_000 })
    .toBe("EDIT");
  expect((await state()).renderer.activeVaporParticles).toBe(0);
  expect((await state()).renderer.activeGroundSmokeParticles).toBe(0);
  await page.reload();
  await page.waitForFunction(() =>
    Boolean((window as unknown as AgentWindow).__MACHINE_STUDIO_AGENT__),
  );
  expect((await state()).renderer.activeVaporParticles).toBe(0);
  expect((await state()).renderer.activeGroundSmokeParticles).toBe(0);
});
