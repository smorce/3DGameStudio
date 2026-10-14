/**
 * Alpine Villageの景観を固定カメラで撮影する開発用スクリプト。
 * 使い方: pnpm dev 起動後に `pnpm exec tsx scripts/alpine-look-capture.ts <出力先> [景観名...]`
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type { MachineStudioAgentApi } from "../packages/engine-core/src/agent-observation";
import type { Vec3 } from "../packages/project-schema/src/index";

const views: { name: string; position: Vec3; target: Vec3 }[] = [
  { name: "overview", position: [20, 105, 450], target: [-30, 35, -220] },
  { name: "farmland", position: [-85, 25, 30], target: [-75, 15, -20] },
  { name: "village-square", position: [39, 16, -7], target: [37, 15, -50] },
  { name: "house-close", position: [-30, 14, -67], target: [-19.6, 16, -83.6] },
  { name: "forest-path", position: [72, 16, -137], target: [122, 16, -153] },
  { name: "lake", position: [228, 13.5, 92], target: [285, 12, -40] },
  { name: "plaza", position: [34, 15.5, -4], target: [10, 13, -26] },
  { name: "pasture", position: [-55, 17, 32], target: [-115, 12, -18] },
];
const out = process.argv[2] ?? "test-results/alpine-look";
const only = process.argv.slice(3);
const base = process.env.STUDIO_URL ?? "http://127.0.0.1:5183";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (error) => console.error(`pageerror: ${error.message}`));
await page.goto(`${base}/?agent=1`);
await page.getByTestId("sample-world-alpine-village").click();
await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
await page.getByTestId("runtime-position").waitFor({ timeout: 120000 });
const settle = async () => {
  let stable = 0,
    previous = "";
  for (let i = 0; i < 120 && stable < 3; i++) {
    await page.waitForTimeout(1000);
    const signature = JSON.stringify(
      await page.evaluate(`(() => {
        const a = window.__MACHINE_STUDIO_AGENT__, s = a.getState();
        return [a.getWorldDesignDebug().renderPending, s.world.generationQueue, s.world.workerInFlight, s.world.loadedRenderChunks, s.renderer.drawCalls];
      })()`),
    );
    const [pending, queue, workers] = JSON.parse(signature);
    stable =
      !pending && !queue && !workers && signature === previous ? stable + 1 : 0;
    previous = signature;
  }
};
for (const view of views) {
  if (only.length && !only.includes(view.name)) continue;
  await page.evaluate(
    ({ position, target }) =>
      (
        window as unknown as {
          __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
        }
      ).__MACHINE_STUDIO_AGENT__.setInspectionView(position, target),
    view,
  );
  await settle();
  const renderer = await page.evaluate(() => {
    const s = (
      window as unknown as { __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi }
    ).__MACHINE_STUDIO_AGENT__.getState().renderer;
    return { drawCalls: s.drawCalls, triangles: s.triangles };
  });
  console.log(view.name, JSON.stringify(renderer));
  await page
    .locator("canvas")
    .first()
    .screenshot({
      path: `${out}/${view.name}.png`,
      style:
        "body * { visibility: hidden !important; } canvas { visibility: visible !important; }",
    });
}
await browser.close();
