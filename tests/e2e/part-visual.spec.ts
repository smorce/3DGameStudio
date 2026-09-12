import { test, expect, type Page } from "./fixtures";
import { mkdir } from "node:fs/promises";
import { pickCandidate } from "./placement-helpers";

async function zoomScene(page: Page) {
  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Renderer canvas was not found");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -700);
  await page.waitForTimeout(100);
  return canvas;
}

test("Machine PartのVisual Evidenceを保存する", async ({ page }) => {
  await mkdir("docs/screenshots", { recursive: true });
  await page.goto("/");
  await page.getByRole("button", { name: "じゆうにつくる" }).click();
  await page.getByRole("button", { name: "▱ 板", exact: true }).click();
  await pickCandidate(page);

  await page.getByRole("button", { name: "➤ ジェット", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^ここにつける / }),
  ).toHaveCount(2);
  const canvas = await zoomScene(page);
  await canvas.screenshot({
    path: "docs/screenshots/part-visual-placement-ghost.png",
  });
  await pickCandidate(page);
  await canvas.screenshot({
    path: "docs/screenshots/part-visual-thruster.png",
  });

  await page.getByRole("button", { name: "━ 関節", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^ここにつける / }),
  ).toHaveCount(6);
  await pickCandidate(page);
  await canvas.screenshot({
    path: "docs/screenshots/part-visual-hinge.png",
  });
});
