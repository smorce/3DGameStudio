import { test, expect } from "./fixtures";
import { mkdir } from "node:fs/promises";

test("Starter 3種は同じProcedural World Runtimeを使う", async ({ page }) => {
  await mkdir("docs/screenshots", { recursive: true });
  for (const [label, preset, generatorVersion] of [
    ["くるま", "grassland", 1],
    ["ひこうき", "airfield", 1],
    ["ボート", "designed-world", 2],
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
    expect(project.world.source.generatorVersion).toBe(generatorVersion);
    if (label === "ボート") {
      expect(project.world.source.design.islands).toHaveLength(5);
      expect(project.world.source.design.islands[0].biome).toBe("tropical");
    }
    await page.screenshot({
      path: `docs/screenshots/procedural-${preset}.png`,
      fullPage: true,
    });
  }
});
