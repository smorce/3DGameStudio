import { format } from "prettier";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
const phase = process.argv[2] ?? "after";
const project = JSON.parse(
  await readFile("demos/demo-simple-car.json", "utf8"),
);
project.world.terrain.size = 1024;
project.world.terrain.resolution = 129;
project.world.terrain.heights = Array(129 * 129).fill(0);
project.world.terrain.colors = Array(129 * 129).fill("#7cab68");
project.world.entities = Array.from({ length: 1500 }, (_, i) => ({
  id: `bench-rock-${i}`,
  name: "岩",
  kind: "rock",
  transform: {
    position: [
      i < 500 ? (i % 25) * 4 - 50 : 320 + (i % 25) * 4,
      0,
      i < 500
        ? Math.floor(i / 25) * 4 - 40
        : Math.floor((i - 500) / 25) * 4 - 80,
    ],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  },
}));
const course = {
  id: "bench-a",
  name: "A",
  path: [],
  checkpoints: [],
  start: [0, 1, 0],
  goal: [0, 1, 30],
  obstacles: [],
  respawnPoints: [],
  metadata: {},
};
project.courses = [
  course,
  {
    ...course,
    id: "bench-b",
    name: "B",
    start: [200, 1, 0],
    obstacles: [
      {
        id: "far-obstacle",
        kind: "obstacle",
        position: [210, 0, 0],
        size: [2, 2, 2],
      },
    ],
  },
];
await writeFile(
  "tests/fixtures/benchmark-world.json",
  await format(JSON.stringify(project), { parser: "json" }),
);
const server = spawn(process.execPath, ["apps/server/dist/index.js"], {
  env: { ...process.env, PORT: "8789", ASSET_DATA_DIR: ".data/benchmark" },
  stdio: "ignore",
});
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:8789/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({
    channel: "chromium",
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  await page.addInitScript(
    (p) => localStorage.setItem("machine-studio.project", JSON.stringify(p)),
    project,
  );
  await page.goto("http://127.0.0.1:8789");
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await page.waitForTimeout(2000);
  const edit = await page.getByLabel("Runtime Stats").innerText();
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  await page.getByRole("button", { name: "■ やめる", exact: true }).waitFor();
  await page.waitForTimeout(2000);
  const play = await page.getByLabel("Runtime Stats").innerText();
  const number = (label) =>
    Number(play.match(new RegExp(label + " ([0-9]+)"))?.[1] ?? 0);
  const result = {
    phase,
    checkedAt: new Date().toISOString(),
    renderer: "Chromium SwiftShader",
    viewport: [1280, 720],
    entities: 1500,
    drawCalls: number("Draw Calls"),
    triangles: number("Triangles"),
    loadedChunks: number("Chunks"),
    physicsChunksLoaded: number("Physics Chunks"),
    colliders: number("Colliders"),
    runtimeAssetBytes: 0,
    edit,
    play,
  };
  await writeFile(
    `docs/evidence/performance-${phase}.json`,
    await format(JSON.stringify(result), { parser: "json" }),
  );
  console.log(result);
} finally {
  await browser?.close();
  server.kill();
}
