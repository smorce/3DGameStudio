import { test, expect } from "./fixtures";
import { mkdir } from "node:fs/promises";

test("Starter 3種は同じProcedural World Runtimeを使う", async ({ page }) => {
  await mkdir("docs/screenshots", { recursive: true });
  for (const [label, preset] of [
    ["くるま", "grassland"],
    ["ひこうき", "airfield"],
    ["ボート", "archipelago"],
  ] as const) {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByRole("button", { name: label, exact: false }).click();
    await expect(page.getByText(/パーツ$/)).toBeVisible();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    const project = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("machine-studio.project") ?? "null"),
    );
    expect(project.schemaVersion).toBe(7);
    expect(project.world.source.kind).toBe("procedural");
    expect(project.world.source.preset).toBe(preset);
    expect(project.world.source.generatorVersion).toBe(1);
    await page.screenshot({
      path: `docs/screenshots/procedural-${preset}.png`,
      fullPage: true,
    });
  }
});
