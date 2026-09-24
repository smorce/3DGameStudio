/** Vite上の実WebGLRendererで、物理に依存しない演出の境界条件を再現する。 */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import type { ThreeRenderer } from "../packages/renderer-three/src/index";
import type { Project } from "../packages/project-schema/src/index";
import type { PhysicsRenderState } from "../packages/physics-rapier/src/index";

type ProbeWindow = Window & {
  vfxProbe: {
    renderer: ThreeRenderer;
    project: Project;
    state: PhysicsRenderState;
  };
};
const baseURL = process.env.OBSERVE_BASE_URL ?? "http://127.0.0.1:5182";
const browser = await chromium.launch({
  channel: "chromium",
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
const directory = "docs/evidence/vfx";
await mkdir(directory, { recursive: true });
try {
  await page.route("**/vfx-harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><body style="margin:0"><canvas style="width:1100px;height:720px"></canvas></body></html>',
    }),
  );
  await page.goto(`${baseURL}/vfx-harness`);
  const initial = await page.evaluate(async (root) => {
    const rendererUrl = `${root}/packages/renderer-three/src/index.ts`;
    const schemaUrl = `${root}/packages/project-schema/src/index.ts`;
    const machineUrl = `${root}/packages/machine-system/src/index.ts`;
    const worldUrl = `${root}/packages/world-system/src/index.ts`;
    const { ThreeRenderer } = (await import(
      rendererUrl
    )) as typeof import("../packages/renderer-three/src/index");
    const { emptyProject } = (await import(
      schemaUrl
    )) as typeof import("../packages/project-schema/src/index");
    const { planeTemplate } = (await import(
      machineUrl
    )) as typeof import("../packages/machine-system/src/index");
    const { createStarterWorld } = (await import(
      worldUrl
    )) as typeof import("../packages/world-system/src/index");
    const project = emptyProject();
    Object.assign(
      project.world,
      createStarterWorld({ preset: "airfield", seed: 42 }),
    );
    project.machines = [planeTemplate()];
    const renderer = new ThreeRenderer(document.querySelector("canvas")!);
    renderer.load(project);
    const state: PhysicsRenderState = { poses: new Map(), wheels: new Map() };
    for (const part of project.machines[0].parts) {
      const visual = renderer.parts.get(part.id)!;
      state.poses.set(part.id, {
        position: visual.position.toArray(),
        rotation: visual.quaternion.toArray(),
      });
    }
    await renderer.preparePlayRendering({ state });
    (window as unknown as ProbeWindow).vfxProbe = { renderer, project, state };
    return {
      vapor: renderer.effects.vapor.activeCount,
      smoke: renderer.effects.smoke.activeCount,
    };
  }, `/@fs${process.cwd()}`);
  assert.deepEqual(initial, { vapor: 0, smoke: 0 });
  const flight = await page.evaluate(() => {
    const { renderer, project, state } = (window as unknown as ProbeWindow)
      .vfxProbe;
    for (let frame = 0; frame < 45; frame++) {
      const angle = frame * 0.004;
      for (const part of project.machines[0].parts) {
        const original = part.transform.position;
        state.poses.get(part.id)!.position = [
          original[0] + Math.sin(angle) * 15,
          original[1] + 15,
          original[2] + frame * 0.6,
        ];
      }
      renderer.render(state, 1, { dt: 1 / 60, velocity: [6, 0, 36] });
    }
    renderer.camera.position.set(-12, 23, 8);
    renderer.controls.target.set(2, 16, 25);
    renderer.controls.update();
    renderer.render(state, 1, { dt: 0, velocity: [6, 0, 36] });
    return renderer.fastStats;
  });
  assert(flight.activeVaporParticles > 0);
  await page.screenshot({ path: `${directory}/wing-vapor.png` });
  const rebase = await page.evaluate(() => {
    const { renderer, state } = (window as unknown as ProbeWindow).vfxProbe;
    const before = renderer.effects.vapor.positions.slice();
    const count = renderer.effects.vapor.activeCount;
    renderer.shiftOrigin([256, 0, 256]);
    for (const pose of state.poses.values()) {
      pose.position[0] -= 256;
      pose.position[2] -= 256;
    }
    const shifted = renderer.effects.vapor.positions;
    let maxError = 0;
    for (let i = 0; i < renderer.effects.vapor.capacity; i++)
      if (renderer.effects.vapor.ages[i] >= 0) {
        maxError = Math.max(
          maxError,
          Math.abs(shifted[i * 3] - before[i * 3] + 256),
          Math.abs(shifted[i * 3 + 2] - before[i * 3 + 2] + 256),
        );
      }
    renderer.render(state, 1, { dt: 0, velocity: [6, 0, 36] });
    return { maxError, count, after: renderer.effects.vapor.activeCount };
  });
  assert(rebase.maxError < 0.0001);
  assert.equal(rebase.count, rebase.after);
  await page.screenshot({ path: `${directory}/origin-rebase.png` });
  const wash = await page.evaluate(() => {
    const { renderer, project, state } = (window as unknown as ProbeWindow)
      .vfxProbe;
    renderer.load(project);
    for (const part of project.machines[0].parts) {
      const visual = renderer.parts.get(part.id)!;
      if (part.definitionId === "Thruster") {
        visual.position.set(part.transform.position[0], 1.5, 0);
        visual.rotation.set(-Math.PI / 2, 0, 0);
      }
      state.poses.set(part.id, {
        position: visual.position.toArray(),
        rotation: visual.quaternion.toArray(),
      });
    }
    for (let frame = 0; frame < 60; frame++)
      renderer.render(state, 1, { dt: 1 / 60, velocity: [0, 0, 0] });
    return renderer.fastStats;
  });
  assert(wash.activeGroundSmokeParticles > 0);
  await page.screenshot({ path: `${directory}/ground-wash.png` });
  const lifecycle = await page.evaluate(() => {
    const { renderer, project, state } = (window as unknown as ProbeWindow)
      .vfxProbe;
    for (const pose of state.poses.values()) pose.position[1] += 20;
    for (let frame = 0; frame < 90; frame++)
      renderer.render(state, 1, { dt: 1 / 60, velocity: [0, 0, 0] });
    const airborneSmoke = renderer.effects.smoke.activeCount;
    renderer.restoreEditTransforms(project);
    renderer.render(undefined, 1);
    let visibleFlames = 0;
    for (const part of renderer.parts.values())
      part.traverse((object) => {
        if (object.userData.thrusterFlame && object.visible) visibleFlames++;
      });
    const edit = renderer.fastStats;
    renderer.effects.prewarm();
    renderer.load(project);
    const reload = renderer.fastStats;
    const geometry = renderer.effects.vapor.geometry;
    const material = renderer.effects.smoke.material;
    let disposedGeometry = 0,
      disposedMaterial = 0;
    geometry.addEventListener("dispose", () => disposedGeometry++);
    material.addEventListener("dispose", () => disposedMaterial++);
    renderer.dispose();
    return {
      airborneSmoke,
      visibleFlames,
      edit,
      reload,
      disposedGeometry,
      disposedMaterial,
      detached: renderer.effects.group.parent === null,
    };
  });
  assert.equal(lifecycle.airborneSmoke, 0);
  assert.equal(lifecycle.visibleFlames, 0);
  assert.equal(lifecycle.edit.activeVaporParticles, 0);
  assert.equal(lifecycle.edit.activeGroundSmokeParticles, 0);
  assert.equal(lifecycle.reload.activeVaporParticles, 0);
  assert.equal(lifecycle.reload.activeGroundSmokeParticles, 0);
  assert.equal(lifecycle.disposedGeometry, 1);
  assert.equal(lifecycle.disposedMaterial, 1);
  assert(lifecycle.detached);
  assert.deepEqual(errors, []);
  await writeFile(
    `${directory}/renderer-probe.json`,
    JSON.stringify(
      { initial, flight, rebase, wash, lifecycle, errors },
      null,
      2,
    ) + "\n",
  );
  console.log("VFX renderer probe passed");
} finally {
  await browser.close();
}
