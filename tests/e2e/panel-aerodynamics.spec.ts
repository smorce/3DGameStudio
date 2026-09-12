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

test("Starter Planeを表示して保存する @smoke", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "ひこうき", exact: false }).click();
  await expect(page.getByText(/パーツ$/)).toBeVisible();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await screenshot(page, "starter-plane");
});

test("SuspensionをPaletteとInspectorで操作できる", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "ひこうき", exact: false }).click();
  await expect(
    page.getByRole("button", { name: "⌁ サスペンション", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "くわしくつくる", exact: true })
    .click();
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  const suspensionPart = page.getByRole("button", { name: /◈ サスペンション/ });
  await expect(suspensionPart).toHaveCount(3);
  await suspensionPart.last().click();
  await expect(page.getByLabel("Suspension restLength")).toBeVisible();
  await expect(page.getByLabel("Suspension relaxation")).toBeVisible();
});

test("Generic Flight ControlのMotor・Hinge・Binding Inspectorを編集できる", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "ひこうき", exact: false }).click();
  await page
    .getByRole("button", { name: "くわしくつくる", exact: true })
    .click();
  await page.getByRole("button", { name: "Studio", exact: true }).click();

  const motors = page.getByRole("button", { name: /◈ モーター/ });
  await expect(motors).toHaveCount(5);
  await motors.first().click();
  await expect(page.getByLabel("Motor Mode")).toBeVisible();
  await expect(page.getByLabel("Control Channel")).toBeVisible();
  await expect(page.getByLabel("Control Gain")).toBeVisible();

  await page.getByLabel("Control Channel").fill("pitch");
  await page
    .getByRole("button", { name: /◈ 関節/ })
    .first()
    .click();
  await expect(page.getByLabel("Limit Enabled")).toBeVisible();
  await expect(page.getByLabel("Min Angle")).toBeVisible();
  await expect(page.getByLabel("Max Angle")).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "Control Bindings" }),
  ).toBeVisible();
  await page.getByLabel("Binding 0 channel").fill("throttle");
  await page.getByLabel("Binding 0 value").fill("1");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const project = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("machine-studio.project") ?? "null"),
  );
  expect(project.schemaVersion).toBe(5);
  expect(project.machines[0].controlBindings[0]).toMatchObject({
    channel: "throttle",
    value: 1,
  });
  await screenshot(page, "generic-flight-controls-inspector");
});

test("Starter Boatを表示して保存する @smoke", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "ボート", exact: false }).click();
  await expect(page.getByText(/パーツ$/)).toBeVisible();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await screenshot(page, "starter-boat");
});

test("車・飛行機・ボートで共通速度HUDをPlay中だけ表示する", async ({
  page,
}) => {
  for (const template of ["くるま", "ひこうき", "ボート"]) {
    await page.goto("/");
    await page.getByRole("button", { name: template, exact: false }).click();
    await expect(page.getByLabel("Speed")).toHaveCount(0);
    await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
    const speedHud = page.getByLabel("Speed");
    await expect(speedHud).toBeVisible();
    await expect(speedHud).toContainText(/SPEED/);
    await expect(speedHud).toContainText(/\d+ km\/h/);
    await page.getByRole("button", { name: "■ やめる", exact: true }).click();
    await expect(speedHud).toHaveCount(0);
  }
});

test("Starter PlaneをW+Aで左旋回させる @smoke", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "ひこうき", exact: false }).click();
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "■ やめる", exact: true }),
  ).toBeVisible();
  await page.keyboard.down("w");
  await page.waitForTimeout(900);
  await page.keyboard.down("a");
  await page.waitForTimeout(700);
  await screenshot(page, "starter-plane-turn");
  await page.keyboard.up("a");
  await page.keyboard.up("w");
  await page.getByRole("button", { name: "■ やめる", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "▶ あそぶ", exact: true }),
  ).toBeVisible();
});

test("Starter Boatが浮上しW+Aで左旋回する @smoke", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "ボート", exact: false }).click();
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "■ やめる", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(1200);
  await screenshot(page, "starter-boat-floating");
  await page.keyboard.down("w");
  await page.keyboard.down("a");
  await page.waitForTimeout(900);
  await screenshot(page, "starter-boat-turn");
  await page.keyboard.up("a");
  await page.keyboard.up("w");
  await page.getByRole("button", { name: "■ やめる", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "▶ あそぶ", exact: true }),
  ).toBeVisible();
});
