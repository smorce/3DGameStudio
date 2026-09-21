import { test, expect } from "./fixtures";
import { mkdir, writeFile } from "node:fs/promises";
import { sampleWorldCatalog } from "../../packages/sample-worlds/src/index";
import { sampleGeneratedHeight } from "../../packages/world-generator/src/index";
import { parseProject } from "../../packages/project-schema/src/index";
for (const descriptor of sampleWorldCatalog) {
  test(`${descriptor.id}: fresh dataで選択して遊べる`, async ({
    page,
    request,
  }) => {
    const external: string[] = [];
    await page.route(/^https?:/, async (route) => {
      if (
        !["localhost", "127.0.0.1"].includes(
          new URL(route.request().url()).hostname,
        )
      ) {
        external.push(route.request().url());
        await route.abort();
      } else await route.continue();
    });
    const project = parseProject(
      await (await request.get(`/api/worlds/${descriptor.id}`)).json(),
    );
    await page.goto("/?agent=1");
    await expect(page.locator('[data-testid^="sample-world-"]')).toHaveCount(8);
    await page.getByTestId(`sample-world-${descriptor.id}`).click();
    await expect(
      page.getByText(`${project.world.name}を読み込みました`),
    ).toBeVisible();
    await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
    await expect(page.getByTestId("runtime-position")).toBeVisible();
    const state = () =>
      page.evaluate(() => {
        const api = (
          window as unknown as {
            __MACHINE_STUDIO_AGENT__: {
              getState(): {
                world: { loadedRenderChunks: number };
                machine: {
                  position: number[];
                  groundedWheelCount: number | null;
                };
                engine: { mode: string };
              };
              getWorldDesignDebug(): { farWorldProxyCount: number };
            };
          }
        ).__MACHINE_STUDIO_AGENT__;
        return { ...api.getState(), design: api.getWorldDesignDebug() };
      });
    await expect
      .poll(async () => (await state()).world.loadedRenderChunks)
      .toBeGreaterThan(8);
    if (
      project.world.source.kind === "procedural" &&
      project.world.source.design
    )
      await expect
        .poll(async () => (await state()).design.farWorldProxyCount)
        .toBe(project.world.source.design.islands.length);
    await page.waitForTimeout(1500);
    const current = await state();
    expect(current.machine.position.every(Number.isFinite)).toBe(true);
    if (descriptor.recommendedMachine !== "boat")
      await expect
        .poll(async () => (await state()).machine.groundedWheelCount ?? 0)
        .toBeGreaterThan(0);
    if (descriptor.tags.includes("race"))
      await expect(page.getByLabel("Runtime Stats")).toContainText(
        "チェックポイント 0/3",
      );
    const [x, y, z] = current.machine.position;
    const source = project.world.source;
    if (source.kind !== "procedural")
      throw new Error("Expected procedural source");
    expect(y).toBeGreaterThan(sampleGeneratedHeight({ ...source, x, z }) - 1);
    if (descriptor.recommendedMachine === "boat") {
      expect(project.world.water.enabled).toBe(true);
      expect(y).toBeGreaterThan(-2);
    }
    if (descriptor.tags.includes("snow") || descriptor.tags.includes("desert"))
      expect(source.design?.islands[0].biome).toBe(descriptor.tags[0]);
    if (descriptor.id === "mountain-island")
      expect(
        sampleGeneratedHeight({ ...source, x: 70, z: 90 }),
      ).toBeGreaterThan(70);
    if (descriptor.tags.includes("race")) {
      expect(project.settings.activeCourseId).toBeTruthy();
      expect(project.courses[0].checkpoints).toHaveLength(3);
    }
    expect(external).toEqual([]);
    await mkdir("docs/screenshots/sample-worlds", { recursive: true });
    await mkdir("docs/evidence/sample-worlds", { recursive: true });
    const filename = `${String(descriptor.sortOrder).padStart(2, "0")}-${descriptor.id === "starter-grassland" ? "grassland" : descriptor.id}`;
    await page.screenshot({
      path: `docs/screenshots/sample-worlds/${filename}.png`,
    });
    await page.mouse.move(700, 290);
    for (let i = 0; i < 16; i++) {
      await page.mouse.wheel(0, 250);
      await page.waitForTimeout(30);
    }
    await page.mouse.down();
    await page.mouse.move(700, 390, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    await page.screenshot({
      path: `docs/screenshots/sample-worlds/${filename}-overview.png`,
    });
    await writeFile(
      `docs/evidence/sample-worlds/${descriptor.id}.json`,
      JSON.stringify(current, null, 2) + "\n",
    );
  });
}
