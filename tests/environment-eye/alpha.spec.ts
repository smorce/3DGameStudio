import { test, expect } from "../e2e/fixtures";
import { writeFile } from "node:fs/promises";
import type { MachineStudioAgentApi } from "../../packages/engine-core/src/agent-observation";

/** GLBの葉MASKだけを測定用に置換し、通常の素材とProjectは変更しない。 */
function leafCutoff(bytes: Buffer, cutoff: number) {
  if (bytes.readUInt32LE(0) !== 0x46546c67) return bytes;
  const length = bytes.readUInt32LE(12);
  const document = JSON.parse(bytes.subarray(20, 20 + length).toString("utf8"));
  let changed = false;
  for (const material of document.materials ?? []) {
    if (
      ["leaf", "needle"].includes(material.name) &&
      material.alphaMode === "MASK"
    ) {
      material.alphaCutoff = cutoff;
      changed = true;
    }
  }
  if (!changed) return bytes;
  const json = Buffer.from(JSON.stringify(document)),
    padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(padded);
  const header = Buffer.from(bytes.subarray(0, 12)),
    chunk = Buffer.alloc(8),
    remaining = bytes.subarray(20 + length);
  header.writeUInt32LE(20 + padded.length + remaining.length, 8);
  chunk.writeUInt32LE(padded.length, 0);
  chunk.writeUInt32LE(0x4e4f534a, 4);
  return Buffer.concat([header, chunk, padded, remaining]);
}

for (const variant of [
  { name: "cutoff-04-msaa4", cutoff: 0.4, antialias: true },
  { name: "cutoff-05-msaa4", cutoff: 0.5, antialias: true },
  { name: "cutoff-06-msaa4", cutoff: 0.6, antialias: true },
  { name: "cutoff-05-no-msaa", cutoff: 0.5, antialias: false },
]) {
  test(`alpha-browser: ${variant.name}`, async ({ page }, info) => {
    test.setTimeout(360000);
    let replaced = 0;
    await page.route("**/*.glb", async (route) => {
      const response = await route.fetch();
      const original = await response.body(),
        body = leafCutoff(original, variant.cutoff);
      if (body !== original) replaced++;
      await route.fulfill({ response, body });
    });
    if (!variant.antialias)
      await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (
          this: HTMLCanvasElement,
          kind: string,
          attributes?: unknown,
        ) {
          return Reflect.apply(original, this, [
            kind,
            ["webgl", "webgl2", "experimental-webgl"].includes(kind)
              ? { ...((attributes as object) ?? {}), antialias: false }
              : attributes,
          ]);
        } as typeof original;
      });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/?agent=1");
    await page.getByTestId("sample-world-alpine-village").click();
    await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
    await expect(page.getByTestId("runtime-position")).toBeVisible();
    await page.evaluate(() =>
      (
        window as unknown as { __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi }
      ).__MACHINE_STUDIO_AGENT__.setInspectionView(
        [72, 16, -137],
        [122, 16, -153],
      ),
    );
    const loading = [
      {
        view: variant.name,
        state: await page.evaluate(() =>
          (
            window as unknown as {
              __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
            }
          ).__MACHINE_STUDIO_AGENT__.getState(),
        ),
      },
    ];
    await page.waitForTimeout(10000);
    let previous = "",
      stable = 0;
    await expect
      .poll(
        async () => {
          const status = await page.evaluate(() => {
            const api = (
              window as unknown as {
                __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi;
              }
            ).__MACHINE_STUDIO_AGENT__;
            const state = api.getState(),
              debug = api.getWorldDesignDebug() as { renderPending: number };
            return {
              pending: debug.renderPending,
              queue: state.world.generationQueue,
              workers: state.world.workerInFlight,
              chunks: state.world.loadedRenderChunks,
              calls: state.renderer.drawCalls,
              textures: state.renderer.textures,
            };
          });
          const signature = JSON.stringify(status);
          stable =
            status.pending === 0 &&
            status.queue === 0 &&
            status.workers === 0 &&
            signature === previous
              ? stable + 1
              : 0;
          previous = signature;
          return stable;
        },
        { timeout: 180000, intervals: [2000] },
      )
      .toBeGreaterThanOrEqual(5);
    const samples = await page.evaluate(async () => {
      const api = (
        window as unknown as { __MACHINE_STUDIO_AGENT__: MachineStudioAgentApi }
      ).__MACHINE_STUDIO_AGENT__;
      const samples = [],
        deadline = performance.now() + 10000;
      while (performance.now() < deadline) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        samples.push(api.getState());
      }
      return samples;
    });
    const environment = await page.evaluate(() => {
      const gl = document.querySelector("canvas")?.getContext("webgl2"),
        debug = gl?.getExtension("WEBGL_debug_renderer_info");
      return {
        userAgent: navigator.userAgent,
        viewport: [innerWidth, innerHeight],
        pixelRatio: devicePixelRatio,
        antialias: gl?.getContextAttributes()?.antialias ?? null,
        msaaSamples: gl?.getParameter(gl.SAMPLES) ?? null,
        renderer: debug
          ? gl?.getParameter(debug.UNMASKED_RENDERER_WEBGL)
          : "unavailable",
      };
    });
    expect(replaced).toBeGreaterThan(0);
    expect(environment.antialias).toBe(variant.antialias);
    expect(environment.msaaSamples).toBe(variant.antialias ? 4 : 0);
    await page
      .locator("canvas")
      .first()
      .screenshot({
        path: info.outputPath(`${variant.name}.png`),
        style:
          "body * { visibility: hidden !important; } canvas { visibility: visible !important; }",
      });
    await writeFile(
      info.outputPath("performance.json"),
      JSON.stringify(
        {
          environment,
          backend: "Chromium ANGLE SwiftShader (software)",
          sampleWindowMs: 10000,
          loading,
          diagnostics: [],
          runs: [
            {
              id: "alpine-village",
              states: [
                { view: variant.name, repetition: 0, samples, memory: null },
              ],
            },
          ],
        },
        null,
        2,
      ) + "\n",
    );
    await writeFile(
      info.outputPath("validation.json"),
      JSON.stringify(
        {
          ...variant,
          replacedGLBs: replaced,
          camera: samples.at(-1)?.camera,
          completed: true,
        },
        null,
        2,
      ) + "\n",
    );
  });
}
