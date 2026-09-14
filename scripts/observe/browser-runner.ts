import { execSync, spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { emptyProject } from "../../packages/project-schema/src/index";
import { planeTemplate } from "../../packages/machine-system/src/index";
import { createStarterWorld } from "../../packages/world-system/src/index";
import {
  buildRunSummary,
  requireObservationScenario,
  type MachineTelemetrySample,
  type ObservationRunManifest,
  type TelemetryEvent,
} from "../../packages/runtime-telemetry/src/index";
import {
  evaluateAssertion,
  type AssertionContext,
  type ObservationRunResult,
} from "./runner";
import { writeObservationRun } from "./storage";

type BrowserApp = "studio" | "player";

export interface BrowserObservationOptions {
  app?: BrowserApp;
  baseURL?: string;
  viewport?: [number, number];
  devicePixelRatio?: number;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const git = (command: string) => {
  try {
    return execSync(command, { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
};

async function isReachable(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(500) });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function startDevServer(app: BrowserApp, baseURL: string) {
  if (await isReachable(baseURL)) return () => undefined;
  const child = spawn("pnpm", [`dev:${app}`], {
    cwd: process.cwd(),
    env: { ...process.env, BROWSER: "none" },
    stdio: "ignore",
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await isReachable(baseURL)) {
      return () => {
        child.kill("SIGTERM");
      };
    }
    if (child.exitCode !== null)
      throw new Error(`Unable to start ${app} dev server`);
    await sleep(250);
  }
  child.kill("SIGTERM");
  throw new Error(`Timed out waiting for ${app} dev server at ${baseURL}`);
}

function keysForControls(controls: Record<string, number>) {
  const keys = new Set<string>();
  const throttle = controls.throttle ?? 0;
  const pitch = controls.pitch ?? 0;
  const turn = controls.turn ?? controls.steering ?? 0;
  if (throttle > 0) keys.add("KeyW");
  if (throttle < 0) keys.add("KeyS");
  if (pitch > 0) keys.add("ArrowUp");
  if (pitch < 0) keys.add("ArrowDown");
  if (turn < 0) keys.add("ArrowLeft");
  if (turn > 0) keys.add("ArrowRight");
  if ((controls.brake ?? 0) > 0) keys.add("Space");
  return keys;
}

async function playTimeline(
  page: import("@playwright/test").Page,
  scenario: ReturnType<typeof requireObservationScenario>,
) {
  const pressed = new Set<string>();
  for (const segment of scenario.timeline) {
    const next = keysForControls(segment.controls);
    for (const key of pressed)
      if (!next.has(key)) {
        await page.keyboard.up(key);
        pressed.delete(key);
      }
    for (const key of next)
      if (!pressed.has(key)) {
        await page.keyboard.down(key);
        pressed.add(key);
      }
    await page.waitForTimeout(
      Math.max(1, ((segment.toStep - segment.fromStep) / 60) * 1000),
    );
  }
  for (const key of pressed) await page.keyboard.up(key);
}

function browserAssertionContext(
  events: readonly TelemetryEvent[],
): AssertionContext {
  const samples = events
    .filter((event) => event.name === "physics.machine.sample")
    .map((event) => event.data as unknown as MachineTelemetrySample);
  const start = samples[0];
  const end = samples.at(-1);
  let maxPositionJumpM = 0;
  let maxAirborneJumpM = 0;
  let terrainUnavailableSteps = 0;
  let turnStartYaw: number | undefined;
  let turnEndYaw: number | undefined;
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index]!;
    if (!sample.terrainAvailable) terrainUnavailableSteps++;
    if (index > 0) {
      const previous = samples[index - 1]!;
      const jump = Math.hypot(
        sample.position[0] - previous.position[0],
        sample.position[1] - previous.position[1],
        sample.position[2] - previous.position[2],
      );
      maxPositionJumpM = Math.max(maxPositionJumpM, jump);
      if ((sample.heightAboveTerrainM ?? 0) > 2)
        maxAirborneJumpM = Math.max(maxAirborneJumpM, jump);
    }
    const turn = sample.controlChannels?.turn ?? sample.steering;
    if (Math.abs(turn) > 0.01) {
      turnStartYaw ??= sample.yawRad;
      turnEndYaw = sample.yawRad;
    }
  }
  const streaming = events.filter(
    (event) => event.name === "world.streaming.stats",
  );
  const maxWorkerQueue = Math.max(
    0,
    ...streaming.map((event) =>
      Math.max(
        Number(event.data.workerQueued ?? 0),
        Number(event.data.pendingQueueCount ?? 0),
      ),
    ),
  );
  const frameCommit = events.filter((event) => event.name === "renderer.frame");
  const maxCommitMs = Math.max(
    0,
    ...streaming.map((event) => Number(event.data.streamingCommitMs ?? 0)),
    ...frameCommit.map((event) => Number(event.data.streamingCommitMs ?? 0)),
  );
  const cameraTargets = events
    .filter((event) => event.name === "camera.follow.sample")
    .map((event) => event.data.target as number[]);
  let cameraTargetTravelM = 0;
  for (let index = 1; index < cameraTargets.length; index++) {
    const previous = cameraTargets[index - 1]!;
    const current = cameraTargets[index]!;
    if (previous.length < 3 || current.length < 3) continue;
    cameraTargetTravelM += Math.hypot(
      current[0]! - previous[0]!,
      current[1]! - previous[1]!,
      current[2]! - previous[2]!,
    );
  }
  return {
    samples,
    start,
    end,
    rebaseCount: events.filter(
      (event) => event.name === "world.origin.rebase.completed",
    ).length,
    maxPositionJumpM,
    maxAirborneJumpM,
    chunkCommitted: events.filter(
      (event) => event.name === "world.chunk.committed",
    ).length,
    chunkQueued: events.filter((event) => event.name === "world.chunk.queued")
      .length,
    maxWorkerQueue,
    maxCommitMs,
    turnYawDeltaRad:
      turnStartYaw !== undefined && turnEndYaw !== undefined
        ? turnEndYaw - turnStartYaw
        : (end?.yawRad ?? 0) - (start?.yawRad ?? 0),
    terrainUnavailableSteps,
    cameraSamples: cameraTargets.length,
    cameraTargetTravelM,
  };
}

export async function runBrowserObservationScenario(
  scenarioId: string,
  options: BrowserObservationOptions = {},
): Promise<ObservationRunResult> {
  const scenario = requireObservationScenario(scenarioId);
  const app = options.app ?? "studio";
  const viewport = options.viewport ?? [1280, 720];
  const devicePixelRatio = options.devicePixelRatio ?? 1;
  const baseURL =
    options.baseURL ?? `http://127.0.0.1:${app === "studio" ? "5183" : "5184"}`;
  const stopServer = await startDevServer(app, baseURL);
  const started = performance.now();
  const project = emptyProject();
  Object.assign(
    project.world,
    createStarterWorld({ preset: scenario.worldPreset, seed: scenario.seed }),
  );
  project.machines.push(planeTemplate());
  const browser = await chromium.launch({
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: viewport[0], height: viewport[1] },
    deviceScaleFactor: devicePixelRatio,
  });
  const tracePath = join(".observability", `observe-${Date.now()}.trace.zip`);
  await mkdir(".observability", { recursive: true });
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  });
  const page = await context.newPage();
  let runId = `${scenario.id}-browser`;
  try {
    await page.addInitScript((value) => {
      localStorage.setItem("machine-studio.project", JSON.stringify(value));
    }, project);
    await page.goto(`${baseURL}/?agent=1&observe=1`);
    await page.waitForFunction(
      () =>
        Boolean(
          (
            window as unknown as {
              __MACHINE_STUDIO_AGENT__?: { version: number };
            }
          ).__MACHINE_STUDIO_AGENT__?.version,
        ),
      undefined,
      { timeout: 30_000 },
    );
    const manifest = (await page.evaluate((id) => {
      const agent = (
        window as unknown as {
          __MACHINE_STUDIO_AGENT__: {
            beginObservation: (scenarioId: string) => unknown;
          };
        }
      ).__MACHINE_STUDIO_AGENT__;
      return agent.beginObservation(id);
    }, scenario.id)) as ObservationRunManifest;
    runId = manifest.runId;
    const playButton = page.getByRole("button", {
      name: "▶ あそぶ",
      exact: true,
    });
    await playButton.waitFor({ state: "visible", timeout: 30_000 });
    await playButton.click();
    await page.waitForFunction(
      () =>
        (
          window as unknown as {
            __MACHINE_STUDIO_AGENT__: {
              getState: () => { engine: { mode: string } };
            };
          }
        ).__MACHINE_STUDIO_AGENT__.getState().engine.mode === "PLAY",
      undefined,
      { timeout: 30_000 },
    );
    await playTimeline(page, scenario);
    await page.waitForTimeout(100);
    const beforeEnd = (await page.evaluate(() => {
      const agent = (
        window as unknown as {
          __MACHINE_STUDIO_AGENT__: {
            getEvents: () => TelemetryEvent[];
          };
        }
      ).__MACHINE_STUDIO_AGENT__;
      return agent.getEvents();
    })) as TelemetryEvent[];
    const contextForAssertions = browserAssertionContext(beforeEnd);
    const assertions = scenario.assertions.map((assertion) => ({
      assertion,
      ...evaluateAssertion(assertion, contextForAssertions),
    }));
    const result: "pass" | "fail" = assertions.every(
      (assertion) => assertion.passed,
    )
      ? "pass"
      : "fail";
    const finalState = (await page.evaluate(
      ({ items, result: observationResult }) => {
        const agent = (
          window as unknown as {
            __MACHINE_STUDIO_AGENT__: {
              recordAssertion: (
                assertion: string,
                expected: unknown,
                actual: unknown,
                passed: boolean,
              ) => unknown;
              endObservation: (result: "pass" | "fail") => unknown;
              getEvents: () => TelemetryEvent[];
            };
          }
        ).__MACHINE_STUDIO_AGENT__;
        for (const item of items)
          agent.recordAssertion(
            item.assertion,
            item.expected,
            item.actual,
            item.passed,
          );
        const ended = agent.endObservation(observationResult);
        return { manifest: ended, events: agent.getEvents() };
      },
      { items: assertions, result },
    )) as {
      manifest: ObservationRunManifest;
      events: TelemetryEvent[];
    };
    const screenshot = await page.screenshot({ fullPage: true });
    await context.tracing.stop({ path: tracePath });
    const trace = await readFile(tracePath);
    await context.close();
    await browser.close();
    await rm(tracePath, { force: true });
    const durationMs = performance.now() - started;
    const finalManifest = {
      ...finalState.manifest,
      gitCommit: git("git rev-parse HEAD"),
      gitBranch: git("git branch --show-current"),
      workingTreeDirty: git("git status --porcelain") !== "",
      durationMs,
      result,
    };
    const summary = buildRunSummary({
      runId,
      scenarioId: scenario.id,
      result,
      durationMs,
      events: finalState.events,
      extraMetrics: {
        distanceM:
          contextForAssertions.start && contextForAssertions.end
            ? Math.hypot(
                contextForAssertions.end.position[0] -
                  contextForAssertions.start.position[0],
                contextForAssertions.end.position[1] -
                  contextForAssertions.start.position[1],
                contextForAssertions.end.position[2] -
                  contextForAssertions.start.position[2],
              )
            : null,
        rebaseCount: contextForAssertions.rebaseCount,
        turnYawDeltaRad: contextForAssertions.turnYawDeltaRad,
      },
    });
    const dir = await writeObservationRun({
      manifest: finalManifest,
      events: finalState.events,
      summary,
      artifacts: {
        "screenshots/final.png": screenshot,
        "playwright/trace.zip": trace,
      },
    });
    stopServer();
    return {
      runId,
      scenario: scenario.id,
      result,
      durationMs,
      summaryPath: `${dir}/summary.json`,
      artifactPath: `${dir}/artifacts`,
      summary,
    };
  } catch (error) {
    await context.tracing.stop({ path: tracePath }).catch(() => undefined);
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    await rm(tracePath, { force: true });
    stopServer();
    throw error;
  }
}
