import { evidencePath } from "./fixtures";
import { test, expect } from "./fixtures";
import { mkdir } from "node:fs/promises";

test("Starter 3種は同じProcedural World Runtimeを使う", async ({ page }) => {
  await mkdir(evidencePath("docs/screenshots"), { recursive: true });
  for (const [label, worldId, preset, generatorVersion] of [
    ["くるま", "starter-grassland", "grassland", 1],
    ["ひこうき", "airfield", "airfield", 1],
    ["ボート", "tropical-archipelago", "designed-world", 2],
  ] as const) {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    const response = page.waitForResponse(`**/api/worlds/${worldId}`);
    await page.getByRole("button", { name: label, exact: false }).click();
    const loaded = await (await response).json();
    // パーツ数は読込前にも表示されるため、Worldの完了メッセージを待つ。
    await expect(
      page.getByText(`${loaded.world.name}を読み込みました`, { exact: true }),
    ).toBeVisible();
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
      path: evidencePath(`docs/screenshots/procedural-${preset}.png`),
      fullPage: true,
    });
  }
});
