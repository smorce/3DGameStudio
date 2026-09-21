import { test, expect, type Page } from "./fixtures";
import type { AgentGameState } from "../../packages/engine-core/src/agent-observation";
import { mkdir, writeFile } from "node:fs/promises";
import { parseProject } from "../../packages/project-schema/src/index";

async function state(page: Page): Promise<AgentGameState> {
  return page.evaluate(() =>
    (
      window as unknown as {
        __MACHINE_STUDIO_AGENT__: { getState(): AgentGameState };
      }
    ).__MACHINE_STUDIO_AGENT__.getState(),
  );
}
async function start(page: Page, id: string) {
  await page.goto("/?agent=1");
  await page.getByTestId(`sample-world-${id}`).click();
  await page.getByRole("button", { name: "▶ あそぶ", exact: true }).click();
  await expect(page.getByTestId("runtime-position")).toBeVisible();
  await expect
    .poll(async () => (await state(page)).world.loadedPhysicsChunks ?? 0)
    .toBeGreaterThan(4);
  await page.waitForTimeout(1500);
}
for (const id of [
  "starter-grassland",
  "desert-island",
  "tropical-archipelago",
]) {
  test(`${id}: 実際の前進入力で30m走行する`, async ({ page }) => {
    await start(page, id);
    const initial = (await state(page)).machine.position!;
    const samples: AgentGameState["machine"][] = [];
    await page.keyboard.down("w");
    try {
      await expect
        .poll(
          async () => {
            const current = (await state(page)).machine;
            samples.push(current);
            expect(current.position!.every(Number.isFinite)).toBe(true);
            if (id === "tropical-archipelago")
              expect(Math.abs(current.position![1])).toBeLessThan(2);
            return Math.hypot(
              current.position![0] - initial[0],
              current.position![2] - initial[2],
            );
          },
          { timeout: 45000, intervals: [200] },
        )
        .toBeGreaterThan(30);
    } finally {
      await page.keyboard.up("w");
    }
    expect(samples.some((s) => (s.controls?.throttle ?? 0) > 0)).toBe(true);
    if (id !== "tropical-archipelago")
      expect(samples.some((s) => (s.groundedWheelCount ?? 0) > 0)).toBe(true);
    await mkdir("docs/evidence/sample-worlds", { recursive: true });
    await writeFile(
      `docs/evidence/sample-worlds/${id}-drive.json`,
      JSON.stringify({ initial, samples }, null, 2) + "\n",
    );
  });
}

test("race-island: 道路を実走して3CheckpointからGoalまで到達する", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(300000);
  const project = parseProject(
    await (await request.get("/api/worlds/race-island")).json(),
  );
  await start(page, "race-island");
  // 位置や物理状態は書き換えず、経路を見て通常のキー入力だけで運転する。
  page.on("console", (message) => {
    if (message.text().startsWith("race-drive:")) console.log(message.text());
  });
  const result = await page.evaluate(async (path) => {
    const api = (
      window as unknown as {
        __MACHINE_STUDIO_AGENT__: { getState(): AgentGameState };
      }
    ).__MACHINE_STUDIO_AGENT__;
    const keys = new Set<string>();
    const setKey = (code: string, down: boolean) => {
      if (keys.has(code) === down) return;
      if (down) keys.add(code);
      else keys.delete(code);
      document.body.dispatchEvent(
        new KeyboardEvent(down ? "keydown" : "keyup", {
          code,
          key: code === "Space" ? " " : code.slice(-1).toLowerCase(),
          bubbles: true,
        }),
      );
    };
    const points: number[][] = [];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1],
        b = path[i];
      const steps = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 2);
      for (let j = 0; j < steps; j++)
        points.push(a.map((v, k) => v + ((b[k] - v) * j) / steps));
    }
    points.push(path[path.length - 1]);
    let progress = 0,
      lastSample = 0;
    const samples: {
      machine: AgentGameState["machine"];
      progress: number;
      hud: string;
    }[] = [];
    const began = performance.now();
    let hud = "";
    try {
      while (performance.now() - began < 260000) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        const machine = api.getState().machine;
        if (!machine.position || !machine.rotation) continue;
        const [x, , z] = machine.position;
        let nearest = Infinity;
        for (
          let i = progress;
          i < Math.min(points.length, progress + 20);
          i++
        ) {
          const d = Math.hypot(points[i][0] - x, points[i][2] - z);
          if (d < nearest) {
            nearest = d;
            progress = i;
          }
        }
        const target = points[Math.min(points.length - 1, progress + 3)];
        const [qx, qy, qz, qw] = machine.rotation;
        const yaw = Math.atan2(
          2 * (qx * qz + qw * qy),
          1 - 2 * (qx * qx + qy * qy),
        );
        const angle = Math.atan2(target[0] - x, target[2] - z) - yaw;
        const error = Math.atan2(Math.sin(angle), Math.cos(angle));
        const speed = machine.speed ?? 0;
        const desired = Math.abs(error) > 0.4 ? 4 : 8;
        setKey("KeyW", speed < desired);
        setKey("Space", speed > desired + 1);
        setKey("KeyA", error > 0.04);
        setKey("KeyD", error < -0.04);
        hud =
          document.querySelector('[aria-label="Runtime Stats"]')?.textContent ??
          "";
        if (performance.now() - lastSample > 1000) {
          samples.push({ machine, progress, hud });
          if (samples.length % 15 === 0)
            console.info(
              "race-drive:",
              JSON.stringify({
                position: machine.position,
                speed,
                progress,
                error,
                controls: machine.controls,
              }),
            );
          if (
            samples.length === 3 &&
            !(machine.controls?.throttle || speed > 1)
          )
            throw new Error("Race driving input was not received");
          lastSample = performance.now();
        }
        if (hud.includes("ゴール！")) break;
      }
    } finally {
      for (const code of [...keys]) setKey(code, false);
    }
    return { samples, hud, progress };
  }, project.courses[0].path);
  await testInfo.attach("race-drive", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  await mkdir("docs/evidence/sample-worlds", { recursive: true });
  await writeFile(
    "docs/evidence/sample-worlds/race-drive.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  for (const n of [1, 2, 3])
    expect(
      result.samples.some((s) => s.hud.includes(`チェックポイント ${n}/3`)) ||
        (n === 3 && result.hud.includes("ゴール！")),
    ).toBe(true);
  expect(result.hud).toContain("ゴール！ 3/3");
  expect(
    result.samples.every((s) => s.machine.position?.every(Number.isFinite)),
  ).toBe(true);
});
