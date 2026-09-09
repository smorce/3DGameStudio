import { test, expect, type Page } from "./fixtures";
import { mkdir } from "node:fs/promises";
const saved = async (page: Page) =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("machine-studio.project")!),
  );
async function car(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "くるま", exact: false }).click();
}
async function save(page: Page) {
  await page.getByRole("button", { name: "保存", exact: true }).click();
}
async function studio(page: Page) {
  await page.getByRole("button", { name: "Studio", exact: true }).click();
}
async function screenshot(page: Page, name: string) {
  await mkdir("docs/screenshots", { recursive: true });
  await page.locator(".side-panel").evaluateAll((elements) =>
    elements.forEach((el) => {
      el.scrollTop = 0;
    }),
  );
  await page.screenshot({
    path: `docs/screenshots/${name}.png`,
    fullPage: true,
  });
}
test("3 LEVELの詳細値保持とUndo @smoke", async ({ page }) => {
  await car(page);
  await screenshot(page, "01-level-1");
  await page
    .getByRole("button", { name: "くわしくつくる", exact: true })
    .click();
  await page.getByRole("button", { name: "◈ タイヤ 02", exact: true }).click();
  await page.getByLabel("はやさ", { exact: true }).fill("450");
  await screenshot(page, "02-level-2");
  await studio(page);
  await page.getByLabel("motorTorque", { exact: true }).fill("823");
  await page.getByLabel("friction", { exact: true }).fill("1.16");
  await screenshot(page, "03-studio");
  await page.getByRole("button", { name: "つくる", exact: true }).click();
  await save(page);
  let p = await saved(page);
  expect(p.machines[0].parts[1].actuator.motorTorque).toBe(823);
  expect(p.machines[0].parts[1].physics.friction).toBe(1.16);
  await page.reload();
  await studio(page);
  await page.getByRole("button", { name: "◈ タイヤ 02", exact: true }).click();
  await expect(page.getByLabel("motorTorque")).toHaveValue("823");
  await screenshot(page, "04-machine-edit");
  await expect(page.getByRole("button", { name: "↶ 元に戻す" })).toBeDisabled();
  p = await saved(page);
  expect(p.machines[0].connections).toHaveLength(4);
});
test("WorldとCourseを作りチェックポイントからゴールまで走る @smoke", async ({
  page,
}) => {
  await car(page);
  await page.getByRole("button", { name: "ワールド", exact: true }).click();
  await page.getByRole("button", { name: "山を作る", exact: true }).click();
  await page.getByLabel("配置 X", { exact: true }).fill("20");
  await page.getByRole("button", { name: "ここに置く", exact: true }).click();
  await page.getByRole("button", { name: "木", exact: true }).click();
  await page.getByRole("button", { name: "ここに置く", exact: true }).click();
  await page.getByRole("button", { name: "コース", exact: true }).click();
  for (const [tool, z] of [
    ["道をひく", 0],
    ["道をひく", 18],
    ["スタート", 0],
    ["チェックポイント", 6],
    ["ゴール", 12],
  ] as const) {
    await page.getByRole("button", { name: tool, exact: true }).click();
    await page.getByLabel("配置 X", { exact: true }).fill("0");
    await page.getByLabel("配置 Z", { exact: true }).fill(String(z));
    await page.getByRole("button", { name: "ここに置く", exact: true }).click();
  }
  await page.getByRole("button", { name: "ジャンプ", exact: true }).click();
  await page.getByLabel("配置 X", { exact: true }).fill("10");
  await page.getByRole("button", { name: "ここに置く", exact: true }).click();
  await screenshot(page, "05-course-edit");
  await save(page);
  const before = await saved(page);
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "■ やめる", exact: true }),
  ).toBeVisible();
  await page.keyboard.down("w");
  await expect(page.getByLabel("Runtime Stats")).toContainText("ゴール！", {
    timeout: 15000,
  });
  await page.keyboard.up("w");
  await screenshot(page, "07-play-mode");
  await page.getByRole("button", { name: "■ やめる", exact: true }).click();
  await save(page);
  expect(await saved(page)).toEqual(before);
  await page.reload();
  expect((await saved(page)).world.entities).toHaveLength(1);
});
test("素材検索・Preview・Import・配置・復元 @smoke", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await car(page);
  await studio(page);
  await page.getByRole("button", { name: "素材", exact: true }).click();
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await page
    .getByRole("button", { name: "プレビュー", exact: true })
    .first()
    .click();
  await expect(page.locator(".preview")).toContainText("Rock");
  await page
    .locator(".preview")
    .getByRole("button", { name: "閉じる" })
    .click();
  await page.getByRole("button", { name: "取得", exact: true }).first().click();
  await expect(
    page.locator(".library-item").filter({ hasText: "はじまりの岩" }),
  ).toBeVisible();
  await page
    .locator(".library-item")
    .filter({ hasText: "はじまりの岩" })
    .getByRole("button", { name: "配置", exact: true })
    .click();
  await save(page);
  const p = await saved(page);
  expect(p.assets.length).toBeGreaterThan(0);
  expect(p.world.entities[0].assetId).toBe(p.assets[0].id);
  await expect
    .poll(async () => {
      const res = await page.request.get(p.assets[0].files.runtime);
      return res.status();
    })
    .toBe(200);
  await screenshot(page, "06-asset-browser");
  await page.reload();
  expect((await saved(page)).assets).toEqual(p.assets);
  expect(errors).toEqual([]);
});
test("Provider障害からローカル素材へ復帰 @smoke", async ({ page }) => {
  await page.route("**/api/assets?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("provider") === "polyhaven")
      await route.fulfill({
        json: {
          candidates: [],
          health: [
            {
              id: "polyhaven",
              status: "unavailable",
              error: "Provider unavailable",
            },
          ],
        },
      });
    else await route.continue();
  });
  await car(page);
  await studio(page);
  await page.getByRole("button", { name: "素材", exact: true }).click();
  await page.getByLabel("Provider", { exact: true }).selectOption("polyhaven");
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Provider unavailable");
  await page.getByLabel("Provider", { exact: true }).selectOption("local");
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "取得", exact: true }).first(),
  ).toBeVisible();
});
test("ダミーAIのPreview・承認・Undoと生成Job @smoke", async ({ page }) => {
  const paid: string[] = [];
  page.on("request", (r) => {
    if (/api\.openai|anthropic|generativelanguage/.test(r.url()))
      paid.push(r.url());
  });
  await car(page);
  await studio(page);
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await save(page);
  const before = await saved(page);
  await page.getByRole("button", { name: "提案をつくる", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "承認して適用", exact: true }),
  ).toBeVisible();
  await save(page);
  expect(await saved(page)).toEqual(before);
  await page.getByRole("button", { name: "承認して適用", exact: true }).click();
  await save(page);
  expect((await saved(page)).courses).toHaveLength(1);
  await page.getByRole("button", { name: "↶ 元に戻す" }).click();
  await save(page);
  expect(await saved(page)).toEqual(before);
  await page.getByRole("button", { name: "素材", exact: true }).click();
  await page
    .getByRole("button", { name: "仮の素材を作る", exact: true })
    .click();
  await expect(page.getByText("Job: completed")).toBeVisible();
  expect(paid).toEqual([]);
});
test("壊れた保存データでも新規作成できる", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("machine-studio.project", '{"broken":true}'),
  );
  await page.goto("/");
  await expect(
    page.getByText("Project load failed.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "じゆうにつくる" }).click();
  await page.getByRole("button", { name: "▱ 板", exact: true }).click();
  await expect(page.getByText("1 パーツ")).toBeVisible();
});

test("独立Playerが本番ビルドで起動する @smoke", async ({ page }) => {
  await page.goto("/player/");
  await expect(
    page.getByRole("button", { name: "▶ あそぶ", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  await page.keyboard.down("w");
  await page.waitForTimeout(500);
  await page.keyboard.up("w");
  await expect(page.locator("canvas")).toBeVisible();
});
test("外部素材デモを読み込みGLBを描画する", async ({ page }) => {
  await car(page);
  await studio(page);
  await page
    .getByLabel("プロジェクト読込")
    .setInputFiles("demos/demo-asset-world.json");
  await save(page);
  const project = await saved(page);
  expect(project.assets[0].source.provider).toBe("polyhaven");
  await expect(page.getByLabel("Runtime Stats")).toContainText("Assets 1");
  await screenshot(page, "08-external-asset-world");
});
