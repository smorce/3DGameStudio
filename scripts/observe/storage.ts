import { mkdir, writeFile, readFile, readdir, access } from "node:fs/promises";
import { join } from "node:path";
import type {
  ObservationRunManifest,
  ObservationRunSummary,
  TelemetryEvent,
} from "../../packages/runtime-telemetry/src/schema";

export const OBSERVABILITY_ROOT = ".observability";
export const RUNS_DIR = join(OBSERVABILITY_ROOT, "runs");

export function runDirectory(runId: string) {
  return join(RUNS_DIR, runId);
}

export async function ensureRunsRoot() {
  await mkdir(RUNS_DIR, { recursive: true });
}

export async function writeObservationRun(input: {
  manifest: ObservationRunManifest;
  events: readonly TelemetryEvent[];
  summary: ObservationRunSummary;
  artifacts?: Record<string, Uint8Array | string>;
}) {
  const dir = runDirectory(input.manifest.runId);
  await mkdir(join(dir, "artifacts", "screenshots"), { recursive: true });
  await mkdir(join(dir, "artifacts", "playwright"), { recursive: true });

  const events = input.events;
  const metrics = events.filter((event) => event.type === "metric");
  const states = events.filter((event) => event.type === "state");
  const allLines = events.map((event) => JSON.stringify(event)).join("\n");
  const metricLines = metrics.map((event) => JSON.stringify(event)).join("\n");
  const stateLines = states.map((event) => JSON.stringify(event)).join("\n");

  await writeFile(
    join(dir, "manifest.json"),
    JSON.stringify(input.manifest, null, 2) + "\n",
  );
  await writeFile(join(dir, "events.jsonl"), allLines + (allLines ? "\n" : ""));
  await writeFile(
    join(dir, "metrics.jsonl"),
    metricLines + (metricLines ? "\n" : ""),
  );
  await writeFile(
    join(dir, "states.jsonl"),
    stateLines + (stateLines ? "\n" : ""),
  );
  await writeFile(
    join(dir, "summary.json"),
    JSON.stringify(input.summary, null, 2) + "\n",
  );
  await writeFile(
    join(dir, "latest-pointer.json"),
    JSON.stringify({ runId: input.manifest.runId }, null, 2) + "\n",
  );

  if (input.artifacts)
    for (const [name, body] of Object.entries(input.artifacts)) {
      const target = join(dir, "artifacts", name);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(
        target,
        typeof body === "string" ? body : Buffer.from(body),
      );
    }

  await writeFile(join(RUNS_DIR, "LATEST"), `${input.manifest.runId}\n`);

  return dir;
}

export async function resolveRunId(runIdOrLatest: string) {
  if (runIdOrLatest !== "latest") return runIdOrLatest;
  const latestPath = join(RUNS_DIR, "LATEST");
  try {
    const text = (await readFile(latestPath, "utf8")).trim();
    if (text) return text;
  } catch {
    /* fall through */
  }
  const entries = await readdir(RUNS_DIR, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (dirs.length === 0) throw new Error("No observation runs found");
  return dirs.at(-1)!;
}

export async function loadRunEvents(runIdOrLatest: string) {
  const runId = await resolveRunId(runIdOrLatest);
  const text = await readFile(
    join(runDirectory(runId), "events.jsonl"),
    "utf8",
  );
  const events = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TelemetryEvent);
  return { runId, events };
}

export async function loadRunSummary(runIdOrLatest: string) {
  const runId = await resolveRunId(runIdOrLatest);
  const summary = JSON.parse(
    await readFile(join(runDirectory(runId), "summary.json"), "utf8"),
  ) as ObservationRunSummary;
  return { runId, summary };
}

export async function loadRunManifest(runIdOrLatest: string) {
  const runId = await resolveRunId(runIdOrLatest);
  const manifest = JSON.parse(
    await readFile(join(runDirectory(runId), "manifest.json"), "utf8"),
  ) as ObservationRunManifest;
  return { runId, manifest };
}

export async function runExists(runId: string) {
  try {
    await access(join(runDirectory(runId), "manifest.json"));
    return true;
  } catch {
    return false;
  }
}
