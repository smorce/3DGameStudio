import { test, expect } from "./fixtures";
import { readFile } from "node:fs/promises";
import { detailedGlb, rampGlb } from "../fixtures/runtime-assets";
test("広いWorldの物理Streaming・大量岩・2番目のコースを実走する @smoke", async ({
  page,
}) => {
  const project = JSON.parse(
    await readFile("tests/fixtures/benchmark-world.json", "utf8"),
  );
  project.courses[1].start = [200, 1, 0];
  project.courses[1].checkpoints = [{ id: "b-check", position: [200, 1, 5] }];
  project.courses[1].goal = [200, 1, 10];
  project.courses[0].obstacles = [
    { id: "a-block", kind: "obstacle", position: [200, 0, 0], size: [8, 8, 8] },
  ];
  project.courses[1].obstacles = [];
  await page.addInitScript(
    (p) =>
      !localStorage.getItem("machine-studio.project") &&
      localStorage.setItem("machine-studio.project", JSON.stringify(p)),
    project,
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  const stats = page.getByLabel("Runtime Stats");
  await expect(stats).toContainText("Draw Calls");
  await expect
    .poll(async () =>
      Number((await stats.innerText()).match(/Draw Calls (\d+)/)?.[1]),
    )
    .toBeLessThan(100);
  await page.getByLabel("走るコース").selectOption("bench-b");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await expect(page.getByLabel("走るコース")).toHaveValue("bench-b");
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  await expect(page.getByTestId("runtime-position")).toContainText("200.00");
  await expect
    .poll(async () =>
      Number((await stats.innerText()).match(/Physics Chunks (\d+)/)?.[1]),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(async () =>
      Number((await stats.innerText()).match(/Colliders (\d+)/)?.[1]),
    )
    .toBeLessThan(150);
  await page.keyboard.down("KeyW");
  await expect(stats).toContainText("ゴール", { timeout: 20000 });
  await page.keyboard.up("KeyW");
});
test("圧縮LOD素材を読込・Instancing描画し、非Box Collider上を走る @smoke", async ({
  page,
  request,
}) => {
  const bytes = await detailedGlb(true),
    query = new URLSearchParams({
      name: "LOD検証",
      provider: "local",
      sourceUrl: "local:test",
      license: "CC0",
      collider: "trimesh",
      profile: "performance",
    });
  const response = await request.post(`/api/upload?${query}`, {
    headers: { "Content-Type": "model/gltf-binary" },
    data: Buffer.from(bytes),
  });
  expect(response.ok()).toBe(true);
  const asset = await response.json();
  expect(asset.runtimeInfo.lods).toHaveLength(3);
  const project = JSON.parse(
    await readFile("demos/demo-simple-car.json", "utf8"),
  );
  const rampResponse = await request.post(`/api/upload?${query}`, {
    headers: { "Content-Type": "model/gltf-binary" },
    data: Buffer.from(await rampGlb()),
  });
  expect(rampResponse.ok()).toBe(true);
  const ramp = await rampResponse.json();
  expect(ramp.runtimeInfo.collider).toBe("trimesh");
  project.assets = [asset, ramp];
  project.courses = [
    {
      id: "ramp-course",
      name: "坂道",
      path: [],
      start: [0, 3, 0],
      goal: [0, 3, 20],
      checkpoints: [],
      obstacles: [],
      respawnPoints: [],
      metadata: {},
    },
  ];
  project.world.terrain.size = 1024;
  project.world.entities = Array.from({ length: 100 }, (_, i) => ({
    id: `lod-${i}`,
    name: "検証岩",
    kind: "asset",
    assetId: asset.id,
    transform: {
      position: [20 + (i % 10) * 5, 0, Math.floor(i / 10) * 5],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
  }));
  project.world.entities.push({
    id: "ramp-entity",
    name: "坂道",
    kind: "asset",
    assetId: ramp.id,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  });
  const loaded = new Set<string>();
  page.on("response", (response) => {
    if (response.ok() && response.url().includes("runtime-lod"))
      loaded.add(response.url());
  });
  await page.addInitScript(
    (p) =>
      !localStorage.getItem("machine-studio.project") &&
      localStorage.setItem("machine-studio.project", JSON.stringify(p)),
    project,
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await expect(page.getByLabel("Runtime Stats")).toContainText("Assets 2");
  await expect
    .poll(() => [...loaded].some((url) => url.includes("runtime-lod0")))
    .toBe(true);
  await expect
    .poll(async () =>
      Number(
        (await page.getByLabel("Runtime Stats").innerText()).match(
          /LOD0 (\d+)/,
        )?.[1],
      ),
    )
    .toBeGreaterThan(0);
  const canvas = page.getByLabel("3Dビューポート");
  await canvas.hover();
  for (let i = 0; i < 65; i++) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(30);
  }
  await expect
    .poll(() => [...loaded].some((url) => url.includes("runtime-lod2")))
    .toBe(true);
  await expect
    .poll(async () =>
      Number(
        (await page.getByLabel("Runtime Stats").innerText()).match(
          /LOD2 (\d+)/,
        )?.[1],
      ),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "■ やめる", exact: true }),
  ).toBeVisible();
  await page.keyboard.down("KeyW");
  await expect(page.getByLabel("Runtime Stats")).toContainText("ゴール", {
    timeout: 20000,
  });
  await expect
    .poll(async () =>
      Number(
        (await page.getByTestId("runtime-position").innerText()).match(
          /高さ (-?[\d.]+)/,
        )?.[1],
      ),
    )
    .toBeGreaterThan(1.5);
  await page.keyboard.up("KeyW");
  await expect(page.getByLabel("Runtime Stats")).toContainText(
    "Physics Chunks",
  );
});
