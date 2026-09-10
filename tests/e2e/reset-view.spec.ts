import { test, expect } from "./fixtures";

// 「新しくつくる」後に配置候補ボタンが画面内へ表示されることを確認する。
test("走行後に新しくつくると候補ボタンが画面内に出る", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "くるま", exact: false }).click();
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "■ やめる", exact: true }),
  ).toBeVisible();
  await page.keyboard.down("w");
  await page.waitForTimeout(4000);
  await page.keyboard.up("w");
  await page.getByRole("button", { name: "■ やめる", exact: true }).click();
  await page.getByRole("button", { name: "新しくつくる", exact: true }).click();
  await page.getByRole("button", { name: "じゆうにつくる" }).click();
  await page.getByRole("button", { name: "▱ 板", exact: true }).click();
  const candidate = page.getByRole("button", { name: "ここにつける 1" });
  await expect(candidate).toBeVisible();
  const viewport = page.viewportSize()!;
  const box = (await candidate.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
});
