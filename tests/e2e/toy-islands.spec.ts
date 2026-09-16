import { test, expect } from "./fixtures";
import { mkdir, writeFile } from "node:fs/promises";
import { emptyProject } from "../../packages/project-schema/src/index";
import { createProceduralWorld } from "../../packages/world-generator/src/index";
import {
  starterCarTemplate,
  liftMachineToGround,
} from "../../packages/machine-system/src/index";
import { AssetCatalog } from "../../packages/asset-catalog/src/index";
import {
  AssetFactory,
  DummyAssetRequirementPlanner,
} from "../../packages/asset-factory/src/index";
import { bakeWorld } from "../../packages/asset-factory/src/bake";
import { DummyAstraAssetGenerator } from "../../packages/ai-dummy/src/asset-generator";
import { LocalAssetStorage } from "../../packages/storage/src/local";

test.beforeAll(async () => {
  const p = emptyProject();
  p.world = {
    ...p.world,
    ...createProceduralWorld({ preset: "toy-islands", id: "toy-islands" }),
  };
  const source = p.world.source;
  if (source.kind !== "procedural" || !source.design)
    throw new Error("Missing design");
  const machine = starterCarTemplate();
  liftMachineToGround(machine, () => 0);
  p.machines = [machine];
  const catalog = new AssetCatalog(p),
    factory = new AssetFactory(
      catalog,
      new LocalAssetStorage(".data/e2e/assets"),
      [],
      new DummyAstraAssetGenerator(),
    );
  const result = await factory.fulfill(
    await new DummyAssetRequirementPlanner().plan(source.design),
    "offline",
  );
  expect(result.errors).toEqual([]);
  bakeWorld(p, catalog);
  await mkdir(".data/e2e/worlds", { recursive: true });
  await writeFile(".data/e2e/worlds/toy-islands.json", JSON.stringify(p));
});

test("toy-islandsを保存済みCatalogから読み込みWorkerで遊べる @smoke", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/?agent=1");
  await page.getByRole("button", { name: /おもちゃの群島/ }).click();
  await expect(page.getByText("おもちゃの群島を読み込みました")).toBeVisible();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("machine-studio.project")!),
  );
  expect(saved.world.source.design.islands).toHaveLength(5);
  expect(saved.assets).toHaveLength(28);
  expect(saved.world.buildManifest.requiredAssets).toHaveLength(28);
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  await expect(page.getByTestId("runtime-position")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const api = (
          window as unknown as {
            __MACHINE_STUDIO_AGENT__: {
              getState(): {
                world: { loadedRenderChunks: number };
                engine: { mode: string };
              };
            };
          }
        ).__MACHINE_STUDIO_AGENT__;
        return api.getState().world.loadedRenderChunks;
      }),
    )
    .toBeGreaterThan(8);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __MACHINE_STUDIO_AGENT__: {
                getWorldDesignDebug(): { farWorldProxyCount: number };
              };
            }
          ).__MACHINE_STUDIO_AGENT__.getWorldDesignDebug().farWorldProxyCount,
      ),
    )
    .toBe(5);
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(1800);
  await page.keyboard.up("KeyW");
  const altitude = await page.evaluate(
    () =>
      (
        window as unknown as {
          __MACHINE_STUDIO_AGENT__: {
            getState(): { machine: { position: number[] } };
          };
        }
      ).__MACHINE_STUDIO_AGENT__.getState().machine.position[1],
  );
  expect(altitude).toBeGreaterThan(4);
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/toy-islands.png",
    fullPage: true,
  });
  const debug = await page.evaluate(() => {
    const api = (
      window as unknown as {
        __MACHINE_STUDIO_AGENT__: {
          getState(): unknown;
          getWorldDesignDebug(x: number, z: number): unknown;
        };
      }
    ).__MACHINE_STUDIO_AGENT__;
    return { state: api.getState(), design: api.getWorldDesignDebug(64, 64) };
  });
  await writeFile(
    "docs/evidence/toy-islands-browser.json",
    JSON.stringify(debug, null, 2) + "\n",
  );
  await page.mouse.move(700, 290);
  for (let i = 0; i < 25; i++) {
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(30);
  }
  await page.screenshot({
    path: "docs/screenshots/toy-islands-far.png",
    fullPage: true,
  });
  expect(requests.some((url) => /worker-entry/.test(url))).toBe(true);
  expect(
    requests
      .filter((url) => /^https?:/.test(url))
      .every((url) => new URL(url).hostname === "127.0.0.1"),
  ).toBe(true);
});
