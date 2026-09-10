import { test, expect } from "./fixtures";
import { mkdir } from "node:fs/promises";
import { pickCandidate, savedProject, startPanel } from "./placement-helpers";
test("タイヤ候補から取り付けて選択する @smoke", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "じゆうにつくる" }).click();
  await page.getByRole("button", { name: "▱ 板", exact: true }).click();
  await expect(page.getByText("0 パーツ")).toBeVisible();
  await pickCandidate(page);
  await expect(page.getByText("1 パーツ")).toBeVisible();
  await page.getByRole("button", { name: "◉ タイヤ", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^ここにつける / }),
  ).toHaveCount(4);
  await expect(page.getByText("1 パーツ")).toBeVisible();
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/placement-01-wheel-candidates.png",
  });
  await pickCandidate(page);
  await expect(page.getByText("2 パーツ")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^ここにつける / }),
  ).toHaveCount(0);
  await expect(page.locator(".selection-tools")).toContainText("タイヤ");
  await page.screenshot({
    path: "docs/screenshots/placement-02-wheel-focused.png",
  });
});

test("Placement Smoke: 4輪を取り付け、回転・つけ直し・Undo・実走・保存復元 @smoke", async ({
  page,
}) => {
  await startPanel(page);
  await page.getByRole("button", { name: "◉ タイヤ", exact: true }).click();
  await pickCandidate(page);
  const before = await savedProject(page);
  const wheelId = before.machines[0].parts[1].id;
  await expect(page.locator(".selection-tools")).toHaveAttribute(
    "data-selected-id",
    wheelId,
  );
  await page.getByRole("button", { name: "↻ 回す", exact: true }).click();
  expect(
    (await savedProject(page)).machines[0].parts[1].transform.rotation,
  ).not.toEqual(before.machines[0].parts[1].transform.rotation);
  await page.getByRole("button", { name: "↶ 元に戻す" }).click();
  expect(await savedProject(page)).toEqual(before);
  await page.getByRole("button", { name: "◎ つけ直す" }).click();
  await expect(
    page.getByRole("button", { name: /^ここにつける / }),
  ).toHaveCount(4);
  await page.screenshot({ path: "docs/screenshots/placement-03-reattach.png" });
  expect(await savedProject(page)).toEqual(before);
  await page.keyboard.press("Escape");
  expect(await savedProject(page)).toEqual(before);
  await page.getByRole("button", { name: "◎ つけ直す" }).click();
  await pickCandidate(page, 2);
  const moved = await savedProject(page);
  expect(moved.machines[0].parts[1].id).toBe(wheelId);
  expect(moved.machines[0].parts[1].metadata).toMatchObject({
    front: false,
    drive: true,
  });
  await page.getByRole("button", { name: "↶ 元に戻す" }).click();
  expect(await savedProject(page)).toEqual(before);
  await page.getByRole("button", { name: "↷ やり直す" }).click();
  expect(await savedProject(page)).toEqual(moved);
  for (const count of [3, 2, 1]) {
    await page.getByRole("button", { name: "◉ タイヤ", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /^ここにつける / }),
    ).toHaveCount(count);
    await pickCandidate(page);
    await expect(
      page.getByRole("button", { name: /^ここにつける / }),
    ).toHaveCount(0);
  }
  await page.getByRole("button", { name: "◉ タイヤ", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^ここにつける / }),
  ).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    "もうタイヤをつけられる場所がないよ",
  );
  await page.getByRole("button", { name: "やめる", exact: true }).click();
  const assembled = await savedProject(page);
  expect(assembled.machines[0].parts).toHaveLength(5);
  expect(assembled.machines[0].connections).toHaveLength(4);
  await page.getByRole("button", { name: "↶ 元に戻す" }).click();
  expect((await savedProject(page)).machines[0].connections).toHaveLength(3);
  await page.getByRole("button", { name: "↷ やり直す" }).click();
  expect(await savedProject(page)).toEqual(assembled);
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
  expect(await savedProject(page)).toEqual(assembled);
  await page.reload();
  expect(await savedProject(page)).toEqual(assembled);
  await expect(page.getByText("5 パーツ")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^ここにつける / }),
  ).toHaveCount(0);
});

test("配置取消・パレット切替・コピー・キーボードとドラッグの区別", async ({
  page,
}) => {
  await startPanel(page);
  const before = await savedProject(page);
  const wheel = page.getByRole("button", { name: "◉ タイヤ", exact: true });
  await wheel.click();
  await expect(wheel).toHaveAttribute("aria-pressed", "true");
  expect(await savedProject(page)).toEqual(before);
  await wheel.click();
  await expect(
    page.getByRole("button", { name: /^ここにつける / }),
  ).toHaveCount(0);
  await wheel.click();
  await page.getByRole("button", { name: "▣ ブロック", exact: true }).click();
  await expect(wheel).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "やめる", exact: true }).click();
  expect(await savedProject(page)).toEqual(before);
  await wheel.click();
  const candidate = page
    .getByRole("button", { name: /^ここにつける / })
    .first();
  const box = (await candidate.boundingBox())!;
  await page.mouse.move(box.x + 22, box.y + 22);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 22, { steps: 10 });
  await page.mouse.move(box.x + 22, box.y + 22, { steps: 10 });
  await page.mouse.up();
  expect(await savedProject(page)).toEqual(before);
  await candidate.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("2 パーツ")).toBeVisible();
  await page.getByRole("button", { name: "コピー", exact: true }).click();
  await expect(page.getByText("2 パーツ")).toBeVisible();
  await pickCandidate(page);
  await expect(page.getByText("3 パーツ")).toBeVisible();
  await page.getByRole("button", { name: "消す", exact: true }).click();
  const removed = await savedProject(page);
  expect(removed.machines[0].parts).toHaveLength(2);
  expect(removed.machines[0].connections).toHaveLength(1);
});

test("全パーツを光る位置へ配置し、Studioの詳細値を保持する", async ({
  page,
}) => {
  await startPanel(page);
  for (const name of [
    "▣ ブロック",
    "⚙ モーター",
    "➤ ジェット",
    "↔ 関節",
    "▱ 板",
    "↶ ハンドル",
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await pickCandidate(page);
  }
  const p = await savedProject(page);
  expect(p.machines[0].parts).toHaveLength(7);
  expect(p.machines[0].connections).toHaveLength(6);
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await page.getByLabel("friction", { exact: true }).fill("2.34");
  await page.getByLabel("motorTorque", { exact: true }).fill("321");
  const detailed = await savedProject(page);
  await page.getByRole("button", { name: "つくる", exact: true }).click();
  expect(await savedProject(page)).toEqual(detailed);
  await page.getByRole("button", { name: "◎ つけ直す" }).click();
  await page.keyboard.press("Escape");
  expect(await savedProject(page)).toEqual(detailed);
});

test.describe("タッチ", () => {
  test.use({ hasTouch: true });
  test("候補をタップして取り付ける", async ({ page }) => {
    await startPanel(page);
    await page.getByRole("button", { name: "◉ タイヤ", exact: true }).tap();
    await pickCandidate(page, 0, true);
    await expect(page.getByText("2 パーツ")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^ここにつける / }),
    ).toHaveCount(0);
  });
});
