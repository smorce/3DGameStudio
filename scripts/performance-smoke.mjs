import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
const server = spawn(process.execPath, ["apps/server/dist/index.js"], {
  env: { ...process.env, PORT: "8789", ASSET_DATA_DIR: ".data/performance" },
  stdio: "ignore",
});
let browser;
try {
  for (let i = 0; i < 50; i++) {
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
  const project = JSON.parse(
    await readFile("demos/demo-asset-world.json", "utf8"),
  );
  await page.addInitScript(
    (p) => localStorage.setItem("machine-studio.project", JSON.stringify(p)),
    project,
  );
  await page.goto("http://127.0.0.1:8789");
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await page
    .getByLabel("Runtime Stats")
    .getByText("Assets 1", { exact: false })
    .waitFor();
  await page.waitForTimeout(2000);
  const fps = [];
  for (let i = 0; i < 20; i++) {
    const text = await page.getByLabel("Runtime Stats").innerText();
    fps.push(Number(text.match(/FPS (\d+)/)?.[1]));
    await page.waitForTimeout(250);
  }
  await writeFile(
    "docs/evidence/performance.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        renderer: "Chromium SwiftShader",
        scene: project.id,
        viewport: [1280, 720],
        samples: fps,
        min: Math.min(...fps),
        average: fps.reduce((a, b) => a + b, 0) / fps.length,
        stats: await page.getByLabel("Runtime Stats").innerText(),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(fps);
} finally {
  await browser?.close();
  server.kill();
}
