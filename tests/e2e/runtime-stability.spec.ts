import { test, expect } from "./fixtures";
import { mkdir } from "node:fs/promises";

async function screenshot(name: string, page: import("@playwright/test").Page) {
  await mkdir("docs/evidence/runtime-stability-shadow", { recursive: true });
  await page.screenshot({
    path: `docs/evidence/runtime-stability-shadow/${name}.png`,
    fullPage: true,
  });
}

test("長距離飛行でShadowが追従しRebase前後の画面を残す", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "ひこうき", exact: false }).click();
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  const stats = page.getByLabel("Runtime Stats");
  await expect(stats).toContainText("Rebase 0");
  await page.keyboard.down("w");
  await page.waitForTimeout(800);
  await page.keyboard.down("ArrowDown");
  await page.waitForTimeout(700);
  await page.keyboard.up("ArrowDown");
  await screenshot("01-before-rebase", page);

  await expect
    .poll(
      async () => {
        const text = await stats.innerText();
        return Number(text.match(/Rebase (\d+)/)?.[1] ?? 0);
      },
      { timeout: 45000 },
    )
    .toBeGreaterThanOrEqual(1);
  await screenshot("02-after-rebase", page);

  await expect
    .poll(
      async () => {
        const raw = await page
          .getByTestId("runtime-position")
          .getAttribute("data-position");
        const [x, z] = JSON.parse(raw ?? "[0,0]") as number[];
        return Math.hypot(x, z);
      },
      { timeout: 60000 },
    )
    .toBeGreaterThan(200);
  await screenshot("03-after-200m", page);

  // 飛行中の2座標を同じDOM更新の中で取得し、測定時刻のずれを防ぐ。
  const { simulation, shadow } = await page.evaluate(() => {
    const position = document.querySelector('[data-testid="runtime-position"]');
    const follow = document.querySelector('[data-testid="shadow-follow"]');
    const simulation = position?.getAttribute("data-simulation");
    const shadow = follow?.getAttribute("data-target");
    if (!simulation || !shadow)
      throw new Error("Runtime coordinates are missing");
    return {
      simulation: JSON.parse(simulation) as number[],
      shadow: JSON.parse(shadow) as number[],
    };
  });
  // Shadow FollowはSimulation座標の機体付近へ追従する（Globalではない）。
  expect(
    Math.hypot(shadow[0] - simulation[0], shadow[2] - simulation[2]),
  ).toBeLessThan(8);
  await page.keyboard.up("w");
  await page.getByRole("button", { name: "■ やめる", exact: true }).click();
});
