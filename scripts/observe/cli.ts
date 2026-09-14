#!/usr/bin/env tsx
/**
 * AI観測 CLI: pnpm observe <command>
 * --json 時は stdout に JSON のみ、診断は stderr。
 */
import {
  compareRunSummaries,
  explainRun,
  listObservationScenarios,
  queryEvents,
  type ObservationQueryFilter,
} from "../../packages/runtime-telemetry/src/index";
import { runBrowserObservationScenario } from "./browser-runner";
import { runSimulationObservationScenario } from "./runner";
import { loadRunEvents, loadRunManifest, loadRunSummary } from "./storage";

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const force = args.includes("--force");
const positional = args.filter((value) => !value.startsWith("--"));
const flagValue = (name: string) => {
  const index = args.findIndex(
    (value) => value === `--${name}` || value.startsWith(`--${name}=`),
  );
  if (index < 0) return undefined;
  const token = args[index]!;
  if (token.startsWith(`--${name}=`)) return token.slice(name.length + 3);
  return args[index + 1];
};

const writeOut = (value: unknown) => {
  process.stdout.write(
    `${typeof value === "string" ? value : JSON.stringify(value, null, jsonMode ? undefined : 2)}\n`,
  );
};

const writeErr = (message: string) => {
  process.stderr.write(`${message}\n`);
};

const usage = () => {
  writeErr(`Usage:
  pnpm observe scenarios [--json]
  pnpm observe run <scenario> [--mode=browser|simulation] [--app=studio|player] [--json]
  pnpm observe summary <runId|latest> [--json]
  pnpm observe query <runId|latest> [filters...] [--json]
  pnpm observe frame <runId|latest> <frame> [--json]
  pnpm observe compare <beforeRunId> <afterRunId> [--json] [--force]
  pnpm observe explain <runId|latest> [--json]`);
};

async function main() {
  const command = positional[0];
  if (!command) {
    usage();
    process.exitCode = 1;
    return;
  }

  switch (command) {
    case "scenarios": {
      const scenarios = listObservationScenarios();
      if (jsonMode) writeOut(scenarios);
      else {
        writeOut(
          scenarios
            .map(
              (scenario) =>
                `${scenario.id}\t${scenario.tags.join(",")}\t${scenario.description}`,
            )
            .join("\n"),
        );
      }
      return;
    }
    case "run": {
      const scenarioId = positional[1];
      if (!scenarioId) {
        writeErr("Missing scenario id");
        process.exitCode = 1;
        return;
      }
      const mode = flagValue("mode") ?? "browser";
      const app = flagValue("app") ?? "studio";
      if (app !== "studio" && app !== "player") {
        writeErr(`Unknown observe app: ${app}`);
        process.exitCode = 1;
        return;
      }
      const result =
        mode === "simulation"
          ? await runSimulationObservationScenario(scenarioId)
          : mode === "browser"
            ? await runBrowserObservationScenario(scenarioId, {
                app,
                baseURL: process.env.OBSERVE_BASE_URL,
              })
            : (() => {
                throw new Error(`Unknown observe mode: ${mode}`);
              })();
      if (jsonMode) {
        writeOut({
          runId: result.runId,
          scenario: result.scenario,
          result: result.result,
          durationMs: result.durationMs,
          summaryPath: result.summaryPath,
          artifactPath: result.artifactPath,
        });
      } else {
        writeOut(
          [
            `runId: ${result.runId}`,
            `scenario: ${result.scenario}`,
            `pass/fail: ${result.result}`,
            `duration: ${result.durationMs.toFixed(1)}ms`,
            `summary path: ${result.summaryPath}`,
            `artifact path: ${result.artifactPath}`,
          ].join("\n"),
        );
      }
      process.exitCode = result.result === "pass" ? 0 : 1;
      return;
    }
    case "summary": {
      const { summary } = await loadRunSummary(positional[1] ?? "latest");
      writeOut(summary);
      return;
    }
    case "query": {
      const { runId, events } = await loadRunEvents(positional[1] ?? "latest");
      const filter: ObservationQueryFilter = {
        source: flagValue("source"),
        name: flagValue("name"),
        type: flagValue("type") as ObservationQueryFilter["type"],
        frame: flagValue("frame") ? Number(flagValue("frame")) : undefined,
        beforeMs: flagValue("before-ms")
          ? Number(flagValue("before-ms"))
          : undefined,
        afterMs: flagValue("after-ms")
          ? Number(flagValue("after-ms"))
          : undefined,
        entityId: flagValue("entity-id"),
        chunkKey: flagValue("chunk-key"),
        limit: flagValue("limit") ? Number(flagValue("limit")) : undefined,
      };
      const matched = queryEvents(events, filter);
      if (jsonMode) writeOut({ runId, count: matched.length, events: matched });
      else {
        writeErr(`runId=${runId} matches=${matched.length}`);
        writeOut(matched.map((event) => JSON.stringify(event)).join("\n"));
      }
      return;
    }
    case "frame": {
      const frame = Number(positional[2]);
      if (!Number.isFinite(frame)) {
        writeErr("Missing frame number");
        process.exitCode = 1;
        return;
      }
      const { runId, events } = await loadRunEvents(positional[1] ?? "latest");
      const matched = queryEvents(events, { frame });
      if (jsonMode) writeOut({ runId, frame, events: matched });
      else writeOut(matched.map((event) => JSON.stringify(event)).join("\n"));
      return;
    }
    case "compare": {
      const beforeId = positional[1];
      const afterId = positional[2];
      if (!beforeId || !afterId) {
        writeErr("compare requires <beforeRunId> <afterRunId>");
        process.exitCode = 1;
        return;
      }
      const before = await loadRunSummary(beforeId);
      const after = await loadRunSummary(afterId);
      const beforeManifest = await loadRunManifest(beforeId);
      const afterManifest = await loadRunManifest(afterId);
      const comparison = compareRunSummaries(before.summary, after.summary, {
        force,
        beforeManifest: beforeManifest.manifest,
        afterManifest: afterManifest.manifest,
      });
      if (!comparison.sameScenario && !force) {
        writeErr(comparison.warnings.join("\n"));
        process.exitCode = 1;
        if (jsonMode) writeOut(comparison);
        return;
      }
      writeOut(comparison);
      return;
    }
    case "explain": {
      const { runId, events } = await loadRunEvents(positional[1] ?? "latest");
      const explained = explainRun({ runId, events });
      writeOut(explained);
      return;
    }
    default:
      writeErr(`Unknown command: ${command}`);
      usage();
      process.exitCode = 1;
  }
}

main().catch((error) => {
  writeErr(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
