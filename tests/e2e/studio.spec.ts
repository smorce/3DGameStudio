import { test, expect } from "./fixtures";
import { pickCandidate } from "./placement-helpers";
test("空から板と4輪を組み立て保存・再読込 @smoke", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "じゆうにつくる" }).click();
  await page.getByRole("button", { name: "▱ 板", exact: true }).click();
  await pickCandidate(page);
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "◉ タイヤ", exact: true }).click();
    await pickCandidate(page);
  }
  await expect(page.getByText("5 パーツ")).toBeVisible();
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "■ やめる", exact: true }),
  ).toBeVisible();
  await page.keyboard.down("w");
  await page.waitForTimeout(1500);
  await page.keyboard.up("w");
  await page.getByRole("button", { name: "■ やめる", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.reload();
  await expect(page.getByText("5 パーツ")).toBeVisible();
  expect(errors).toEqual([]);
});
