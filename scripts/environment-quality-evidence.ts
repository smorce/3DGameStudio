import {
  mkdir,
  readdir,
  readFile,
  copyFile,
  writeFile,
  rm,
} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/** 正式証跡はこのコマンドでのみ更新し、通常テストの出力を分離する。 */
const phase = process.argv[2];
if (!["baseline", "phase1", "phase2", "phase3", "phase4"].includes(phase))
  throw new Error("Expected baseline or phase1..phase4");
const root = process.argv[3] ?? "test-results/alpine-isolated";
const lastRun = JSON.parse(
  await readFile(path.join(root, ".last-run.json"), "utf8"),
);
if (lastRun.status !== "passed")
  throw new Error("Browser run must pass before promoting formal evidence");
const directory = (await readdir(root)).find(
  (name) =>
    name.startsWith("alpine-village-Alpine-Village-") ||
    name.startsWith("environment-quality-"),
);
if (!directory) throw new Error("Browser evidence directory was not found");
const input = path.join(root, directory),
  output = `docs/environment-quality/${phase}`;
await readFile(
  path.join(
    input,
    directory.startsWith("alpine-village-") ? "rebase.json" : "validation.json",
  ),
);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of await readdir(input))
  if (/\.(png|json)$/.test(name))
    await copyFile(path.join(input, name), path.join(output, name));
const raw = JSON.parse(
  await readFile(path.join(input, "performance.json"), "utf8"),
);
const distribution = (values: (number | null | undefined)[]) => {
  const sorted = values
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    .sort((a, b) => a - b);
  const rank = (p: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
  return {
    samples: sorted.length,
    median: rank(0.5),
    p95: rank(0.95),
    max: sorted.at(-1) ?? null,
  };
};
const summary = {
  environment: raw.environment,
  backend: raw.backend,
  method:
    "Distinct rendered frames, nearest-rank median/p95. CPU renderMs is submission time; RAF includes scheduling and software GPU time. Unavailable GPU timings remain null.",
  runs: raw.runs.map(
    (run: {
      id: string;
      states: {
        view: string;
        samples: {
          engine: { frame: number };
          frame: { renderMs: number; rafMs: number };
          renderer: {
            gpuTimingMs?: number;
            drawCalls: number;
            triangles: number;
            geometries: number;
            textures: number;
          };
        }[];
        memory?: unknown;
      }[];
    }) => ({
      id: run.id,
      views: run.states.map((view) => {
        const frames = [
          ...new Map(view.samples.map((s) => [s.engine.frame, s])).values(),
        ];
        return {
          view: view.view,
          frameIntervalMs: distribution(frames.map((s) => s.frame.rafMs)),
          cpuRenderMs: distribution(frames.map((s) => s.frame.renderMs)),
          gpuMs: distribution(frames.map((s) => s.renderer.gpuTimingMs)),
          drawCalls: distribution(frames.map((s) => s.renderer.drawCalls)),
          triangles: distribution(frames.map((s) => s.renderer.triangles)),
          geometries: distribution(frames.map((s) => s.renderer.geometries)),
          textures: distribution(frames.map((s) => s.renderer.textures)),
          jsHeap: view.memory ?? null,
        };
      }),
    }),
  ),
};
await writeFile(
  path.join(output, "performance-summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
if (phase !== "baseline") {
  const comparisons: [string, string][] =
    phase === "phase1"
      ? [["forest-path", "森林の小道.png"]]
      : phase === "phase2"
        ? [["house-close", "木組みの家.png"]]
        : phase === "phase3"
          ? [["village", "村の広場.png"]]
          : [
              ["forest-path", "森林の小道.png"],
              ["house-close", "木組みの家.png"],
              ["village", "村の広場.png"],
            ];
  for (const [view, reference] of comparisons) {
    const images = await Promise.all(
      [
        reference,
        `docs/environment-quality/baseline/${view}.png`,
        path.join(output, `${view}.png`),
      ].map((file) =>
        sharp(file)
          .resize(960, 640, { fit: "contain", background: "#18212b" })
          .png()
          .toBuffer(),
      ),
    );
    await sharp({
      create: { width: 2880, height: 640, channels: 3, background: "#18212b" },
    })
      .composite(images.map((input, i) => ({ input, left: i * 960, top: 0 })))
      .png()
      .toFile(path.join(output, `${view}-comparison.png`));
  }
}
console.log(output);
