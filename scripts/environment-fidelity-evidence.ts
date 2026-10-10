import {
  mkdir,
  readdir,
  readFile,
  copyFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import sharp from "sharp";

/** 合格した実ブラウザ出力だけを明示的に正式証跡へ移す。 */
const mode = process.argv[2];
if (
  ![
    "before",
    "before-extra",
    "before-stable",
    "before-eye",
    "eye-level",
    "phase-a",
    "phase-a-trial",
    "phase-a-density-trial",
    "phase-b",
    "phase-b-trial",
    "phase-c",
  ].includes(mode)
)
  throw new Error("Expected before, phase-a, phase-b or phase-c");
const root = process.argv[3] ?? "test-results/environment-quality";
if (
  JSON.parse(await readFile(path.join(root, ".last-run.json"), "utf8"))
    .status !== "passed"
)
  throw new Error("Browser run must pass before promoting evidence");
const directory = (await readdir(root)).find(
  (name) =>
    name.startsWith("environment-quality-") ||
    name.startsWith("eye-environment-eye-"),
);
if (!directory) throw new Error("Browser evidence directory was not found");
const input = path.join(root, directory);
const base = "docs/environment-quality/fidelity-optimization";
const output = path.join(base, mode);
await mkdir(output, { recursive: true });
for (const name of await readdir(input))
  if (/\.(png|json)$/.test(name))
    await copyFile(path.join(input, name), path.join(output, name));
const raw = JSON.parse(
  await readFile(path.join(input, "performance.json"), "utf8"),
);
const distribution = (values: (number | null | undefined)[]) => {
  const sorted = values
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  const rank = (p: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
  return {
    samples: sorted.length,
    median: rank(0.5),
    p95: rank(0.95),
    min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null,
  };
};
type Sample = {
  engine: { frame: number };
  renderer: Record<string, number | null>;
  frame: Record<string, number | null>;
};
const summarize = (samples: Sample[]) => {
  const frames = [...new Map(samples.map((s) => [s.engine.frame, s])).values()];
  return Object.fromEntries([
    ...["drawCalls", "triangles", "geometries", "textures", "gpuTimingMs"].map(
      (key) => [key, distribution(frames.map((s) => s.renderer[key]))],
    ),
    ...["rafMs", "renderMs", "streamingRequestMs", "streamingCommitMs"].map(
      (key) => [key, distribution(frames.map((s) => s.frame[key]))],
    ),
  ]);
};
const summary = {
  environment: raw.environment,
  backend: raw.backend,
  sampleWindowMs: raw.sampleWindowMs,
  method:
    "Distinct rendered frames; nearest-rank median/p95/min/max. Three consecutive 10-second windows per view; not independent cold loads. CPU renderMs is submission time. Initial view state is a loading snapshot, not a load-duration distribution.",
  loading: raw.loading,
  views: raw.runs[0].states.map(
    (s: {
      view: string;
      repetition: number;
      samples: Sample[];
      memory: unknown;
      resources?: unknown;
    }) => ({
      view: s.view,
      repetition: s.repetition,
      ...summarize(s.samples),
      jsHeap: s.memory,
      resources: s.resources ?? null,
    }),
  ),
  diagnostics: raw.diagnostics.map(
    (s: { view: string; disabled: string; samples: Sample[] }) => ({
      view: s.view,
      disabled: s.disabled,
      ...summarize(s.samples),
    }),
  ),
};
await writeFile(
  path.join(output, "performance-summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
if (mode.startsWith("before")) process.exit(0);
const comparisons =
  mode === "eye-level"
    ? [["village-eye-exact", "村の広場.png", "village-"]]
    : mode === "phase-a"
      ? [["forest-path", "森林の小道.png", ""]]
      : mode === "phase-b"
        ? [
            ["house-detail", "木組みの家.png", "house-"],
            ["village-eye", "村の広場.png", "village-"],
          ]
        : mode === "phase-c"
          ? [
              ["forest-path", "森林の小道.png", "forest-"],
              ["house-detail", "木組みの家.png", "house-"],
              ["village-eye", "村の広場.png", "village-"],
            ]
          : [];
for (const [view, reference, prefix] of comparisons) {
  await copyFile(reference, path.join(output, `${prefix}reference.png`));
  await copyFile(
    path.join(
      base,
      mode === "eye-level" ? "before-eye" : "before-stable",
      `${view}.png`,
    ),
    path.join(output, `${prefix}before.png`),
  );
  await copyFile(
    path.join(output, `${view}.png`),
    path.join(output, `${prefix}after.png`),
  );
  const images = await Promise.all(
    [
      reference,
      path.join(output, `${prefix}before.png`),
      path.join(output, `${prefix}after.png`),
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
    .toFile(path.join(output, `${prefix}comparison.png`));
}
if (mode === "eye-level") {
  // 補正前の比較を残し、正式な広場画像を実際の目線比較へ更新する。
  for (const phase of ["phase-b", "phase-c"]) {
    const destination = path.join(base, phase);
    for (const name of [
      "village-before.png",
      "village-after.png",
      "village-comparison.png",
    ]) {
      await copyFile(
        path.join(destination, name),
        path.join(destination, name.replace(".png", "-raised.png")),
        constants.COPYFILE_EXCL,
      ).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
      await copyFile(path.join(output, name), path.join(destination, name));
    }
    await copyFile(
      path.join(output, "performance-summary.json"),
      path.join(destination, "eye-level-performance-summary.json"),
    );
    await copyFile(
      path.join(output, "validation.json"),
      path.join(destination, "eye-level-validation.json"),
    );
  }
  await copyFile(
    path.join(output, "village-eye-exact.png"),
    path.join(base, "phase-c", "village-square.png"),
  );
  const comparisonPath = path.join(
    base,
    "phase-c",
    "performance-comparison.json",
  );
  const comparison = JSON.parse(await readFile(comparisonPath, "utf8"));
  const eyeBefore = JSON.parse(
    await readFile(
      path.join(base, "before-eye", "performance-summary.json"),
      "utf8",
    ),
  );
  comparison.before.views = [
    ...comparison.before.views.filter(
      (v: { view: string }) => v.view !== "village-eye-exact",
    ),
    ...eyeBefore.views,
  ];
  comparison.after.views = [
    ...comparison.after.views.filter(
      (v: { view: string }) => v.view !== "village-eye-exact",
    ),
    ...summary.views,
  ];
  comparison.eyeLevelCorrection =
    "Legacy comparisons preserve OrbitControls clamping. village-eye-exact uses the same optional exactPose observation patch in baseline and final builds; camera position and target are asserted in the browser.";
  await writeFile(comparisonPath, JSON.stringify(comparison, null, 2) + "\n");
}
if (mode === "phase-c") {
  const before = JSON.parse(
    await readFile(path.join(base, "before/performance-summary.json"), "utf8"),
  );
  const extra = JSON.parse(
    await readFile(
      path.join(base, "before-extra/performance-summary.json"),
      "utf8",
    ),
  );
  before.views.push(...extra.views);
  const stable = JSON.parse(
    await readFile(
      path.join(base, "before-stable/performance-summary.json"),
      "utf8",
    ),
  );
  const stableViews = new Set(
    stable.views.map((v: { view: string }) => v.view),
  );
  before.initialWarmup = before.views.filter((v: { view: string }) =>
    stableViews.has(v.view),
  );
  before.views = [
    ...before.views.filter((v: { view: string }) => !stableViews.has(v.view)),
    ...stable.views,
  ];
  before.diagnostics = [
    ...before.diagnostics.filter(
      (v: { view: string }) => v.view !== "forest-path",
    ),
    ...stable.diagnostics,
  ];
  await copyFile(
    path.join(output, "village-square.png"),
    path.join(output, "village-square-legacy.png"),
  );
  await copyFile(
    path.join(output, "village-eye.png"),
    path.join(output, "village-square.png"),
  );
  await writeFile(
    path.join(output, "performance-comparison.json"),
    JSON.stringify(
      {
        before,
        after: summary,
        limitation:
          "SwiftShader software rendering; hardware GPU performance unverified. Identical camera, seed, viewport and time. Three consecutive windows, one browser load per version. Diagnostic toggles remove whole tree/building batches; effects are not additive.",
      },
      null,
      2,
    ) + "\n",
  );
}
console.log(output);
