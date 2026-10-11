import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/** 成功した通常テスト出力だけを、明示操作で正式証跡へ保存する。 */
const [stage, input] = process.argv.slice(2);
if (
  !stage ||
  !["A0", "A1", "A2", "GPU-A0", "GPU-A1", "GPU-A2"].includes(stage) ||
  !input
)
  throw new Error(
    "Expected A0, A1, or A2 and a successful Playwright output directory",
  );
const status = JSON.parse(
  await readFile(path.join(input, ".last-run.json"), "utf8"),
);
if (status.status !== "passed") throw new Error("Browser capture must pass");
const directory = (await readdir(input)).find((name) =>
  name.startsWith("environment-quality-"),
);
if (!directory) throw new Error("Missing browser evidence");
const source = path.join(input, directory);
const raw = JSON.parse(
  await readFile(path.join(source, "performance.json"), "utf8"),
);
if (raw.measurementVersion !== 2)
  throw new Error("Evidence requires current-frame measurement version 2");
if (
  stage.startsWith("GPU-") &&
  !/NVIDIA GeForce RTX 4090/.test(raw.environment.renderer)
)
  throw new Error("Hardware evidence requires an RTX 4090 renderer");
if ((raw.grassMode ?? "A0") !== stage.replace("GPU-", ""))
  throw new Error("Captured grass mode does not match the evidence stage");
const target = `docs/environment-quality/procedural-rendering/${stage}`;
await mkdir(target, { recursive: true });
for (const name of await readdir(source))
  if (/\.(png|json)$/.test(name))
    await copyFile(path.join(source, name), path.join(target, name));
const distribution = (values: unknown[]) => {
  const sorted = values
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  const rank = (p: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
  return { samples: sorted.length, median: rank(0.5), p95: rank(0.95) };
};
type Sample = {
  engine: { frame: number };
  renderer: Record<string, unknown>;
  frame: Record<string, unknown>;
  world: Record<string, unknown>;
};
const views = new Map<
  string,
  { samples: Sample[]; resources: unknown[]; memory: unknown[] }
>();
for (const state of raw.runs[0].states) {
  const view = views.get(state.view) ?? {
    samples: [],
    resources: [],
    memory: [],
  };
  view.samples.push(...state.samples);
  view.resources.push(state.resources);
  view.memory.push(state.memory);
  views.set(state.view, view);
}
const summary = {
  stage,
  measurementVersion: raw.measurementVersion,
  worldSeed: raw.worldSeed,
  worldGeneratorVersion: raw.worldGeneratorVersion,
  worldSourceHash: raw.worldSourceHash,
  startupUntilRuntimeHudMs: raw.startupUntilRuntimeHudMs,
  baselineCommit: "c044b914",
  environment: raw.environment,
  backend: raw.backend,
  sampleWindowMs: raw.sampleWindowMs,
  method:
    "Distinct rendered frames, nearest-rank median/p95; CPU renderMs measures submission. Loading snapshots do not measure cold startup. GPU unavailable values stay null.",
  views: Object.fromEntries(
    [...views].map(([name, view]) => {
      const frames = [
        ...new Map(view.samples.map((s) => [s.engine.frame, s])).values(),
      ];
      return [
        name,
        {
          ...Object.fromEntries(
            [
              "drawCalls",
              "triangles",
              "geometries",
              "textures",
              "gpuTimingMs",
            ].map((key) => [
              key,
              distribution(frames.map((s) => s.renderer[key])),
            ]),
          ),
          ...Object.fromEntries(
            [
              "rafMs",
              "renderMs",
              "streamingRequestMs",
              "streamingCommitMs",
            ].map((key) => [
              key,
              distribution(frames.map((s) => s.frame[key])),
            ]),
          ),
          ...Object.fromEntries(
            ["generationLatencyMs", "workerGenerationMs"].map((key) => [
              key,
              distribution(frames.map((s) => s.world[key])),
            ]),
          ),
          resources: view.resources,
          memory: view.memory,
        },
      ];
    }),
  ),
};
await writeFile(
  path.join(target, "summary.json"),
  JSON.stringify(summary, null, 2),
);
// 参考画像の画角は異なる。横並びは同じ画角を意味しない。
const filenames = [
  "森林の小道.png",
  ...["A0", "A1", "A2"].map(
    (mode) =>
      `docs/environment-quality/procedural-rendering/${stage.startsWith("GPU-") ? "GPU-" : ""}${mode}/forest-path.png`,
  ),
];
const images = [];
for (const filename of filenames) {
  try {
    images.push(
      await sharp(filename)
        .resize(720, 500, { fit: "contain", background: "#ffffff" })
        .png()
        .toBuffer(),
    );
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "ENOENT" &&
      !String(error).includes("Input file is missing")
    )
      throw error;
  }
}
await sharp({
  create: {
    width: 720 * images.length,
    height: 500,
    channels: 4,
    background: "#ffffff",
  },
})
  .composite(images.map((input, i) => ({ input, left: i * 720, top: 0 })))
  .png()
  .toFile(
    `docs/environment-quality/procedural-rendering/${stage.startsWith("GPU-") ? "grass-comparison-GPU.png" : "grass-comparison.png"}`,
  );
console.log(JSON.stringify(summary.views, null, 2));
