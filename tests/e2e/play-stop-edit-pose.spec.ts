import { test, expect } from "./fixtures";
import { pickCandidate, savedProject } from "./placement-helpers";

test("Play停止後に編集Poseへ戻り候補とVisualが一致する", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "じゆうにつくる" }).click();
  await page.getByRole("button", { name: "▱ 板", exact: true }).click();
  await pickCandidate(page);
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "◉ タイヤ", exact: true }).click();
    await pickCandidate(page);
  }
  const before = await savedProject(page);
  const canvas = page.getByLabel("3Dビューポート");

  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "■ やめる", exact: true }),
  ).toBeVisible();
  await page.keyboard.down("w");
  await expect
    .poll(
      async () => {
        const position = await page
          .getByTestId("runtime-position")
          .getAttribute("data-position");
        const [x, z] = JSON.parse(position ?? "[0,0]");
        return Math.hypot(x, z);
      },
      { timeout: 15000 },
    )
    .toBeGreaterThan(2);
  await page.keyboard.up("w");

  await page.getByRole("button", { name: "■ やめる", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "準備中…", exact: true }),
  ).toBeVisible({ timeout: 250 });
  await expect(
    page.getByRole("button", { name: "▣ ブロック", exact: true }),
  ).toBeDisabled({ timeout: 250 });
  await expect(
    page.getByRole("button", { name: "▶ あそぶ", exact: true }),
  ).toBeVisible();

  const after = await savedProject(page);
  expect(after).toEqual(before);
  await expect
    .poll(
      async () => {
        const raw = await canvas.getAttribute("data-rendered-transforms");
        return raw ? Object.keys(JSON.parse(raw)).length : 0;
      },
      { timeout: 5000 },
    )
    .toBe(after.machines[0].parts.length);
  const rendered = JSON.parse(
    (await canvas.getAttribute("data-rendered-transforms")) ?? "{}",
  ) as Record<
    string,
    { position: number[]; rotation: number[]; scale: number[] }
  >;
  for (const part of after.machines[0].parts) {
    const position =
      part.definitionId === "Wheel"
        ? [
            part.transform.position[0],
            part.transform.position[1] -
              (part.physics.suspension?.restLength ?? 0.65),
            part.transform.position[2],
          ]
        : part.transform.position;
    expect(rendered[part.id]).toEqual({
      position,
      rotation: part.transform.rotation,
      scale: part.transform.scale,
    });
  }

  await page.getByRole("button", { name: "▣ ブロック", exact: true }).click();
  const candidate = page
    .getByRole("button", { name: /^ここにつける / })
    .first();
  await expect(candidate).toBeVisible();
  // Stop後はカメラも編集位置へ戻り、候補ボタンが画面内に表示されること。
  const viewport = page.viewportSize()!;
  const box = (await candidate.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
});
