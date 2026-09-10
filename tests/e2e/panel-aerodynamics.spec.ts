import { test, expect, type Page } from "./fixtures";
import { pickCandidate, startPanel } from "./placement-helpers";
import { mkdir } from "node:fs/promises";

async function screenshot(page: Page, name: string) {
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({
    path: `docs/screenshots/${name}.png`,
    fullPage: true,
  });
}

test("正方形Panel、Tilt、Hinge空力面を確認する @smoke", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "ひこうき", exact: false }).click();
  await expect(page.getByText(/パーツ$/)).toBeVisible();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const project = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("machine-studio.project") ?? "null"),
  );
  expect(
    project.machines[0].parts.every(
      (part: { definitionId: string }) => part.definitionId !== "Wing",
    ),
  ).toBe(true);
  await screenshot(page, "square-panel-aircraft");

  await page
    .getByRole("button", { name: "くわしくつくる", exact: true })
    .click();
  await page.getByRole("button", { name: /板 01/ }).click();
  await page.getByRole("button", { name: "／ 傾ける", exact: true }).click();
  await screenshot(page, "tilted-panels");

  await page.getByRole("button", { name: "新しくつくる", exact: true }).click();
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await startPanel(page);
  await page.getByRole("button", { name: "↔ 関節", exact: true }).click();
  await pickCandidate(page);
  await page.getByRole("button", { name: "▱ 板", exact: true }).click();
  await pickCandidate(page, 5);
  await expect(page.getByText(/3 パーツ/)).toBeVisible();
  await screenshot(page, "hinge-control-surface");
});
