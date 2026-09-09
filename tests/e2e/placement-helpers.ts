import { expect, type Page } from "./fixtures";
export async function pickCandidate(page: Page, index = 0, touch = false) {
  const button = page
    .getByRole("button", { name: /^ここにつける / })
    .nth(index);
  await expect(button).toBeVisible();
  const box = (await button.boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}
export async function savedProject(page: Page) {
  await page.getByRole("button", { name: "保存", exact: true }).click();
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("machine-studio.project")!),
  );
}
export async function startPanel(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "じゆうにつくる" }).click();
  await page.getByRole("button", { name: "▱ 板", exact: true }).click();
  await pickCandidate(page);
}
