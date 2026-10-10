import {
  mkdir,
  readFile,
  readdir,
  copyFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/** 実ブラウザの成功済み出力だけを正式証跡へ移し、数値の出所を保持する。 */
const root = "docs/environment-quality/geometry-upgrade";
const mode = process.argv[2];
if (
  ![
    "before",
    "after",
    "before-eye",
    "after-eye",
    "gpu-before",
    "gpu-after",
  ].includes(mode)
)
  throw new Error("Expected geometry evidence stage");
const input = process.argv[3];
const output = path.join(root, mode);
if (input) {
  const status = JSON.parse(
    await readFile(path.join(input, ".last-run.json"), "utf8"),
  );
  if (status.status !== "passed") throw new Error("Browser capture must pass");
  const directory = (await readdir(input)).find(
    (name) =>
      name.startsWith("environment-quality-") || name.startsWith("eye-"),
  );
  if (!directory) throw new Error("Missing browser evidence");
  await mkdir(output, { recursive: true });
  for (const name of await readdir(path.join(input, directory)))
    if (/\.(png|json)$/.test(name))
      await copyFile(
        path.join(input, directory, name),
        path.join(output, name),
      );
} else {
  // 通常E2Eがtest-resultsを解放した後は、既に保存済みの正式証跡だけを集計する。
  const validation = JSON.parse(
    await readFile(path.join(output, "validation.json"), "utf8"),
  );
  if (validation.completed !== true)
    throw new Error("Stored capture must be complete");
}
const raw = JSON.parse(
  await readFile(path.join(output, "performance.json"), "utf8"),
);
const distribution = (values: unknown[]) => {
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
  renderer: Record<string, unknown>;
  frame: Record<string, unknown>;
  world: Record<string, unknown>;
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
    ...[
      "generationLatencyMs",
      "maxGenerationLatencyMs",
      "workerGenerationMs",
    ].map((key) => [key, distribution(frames.map((s) => s.world[key]))]),
  ]);
};
const summary = {
  environment: raw.environment,
  backend: raw.backend,
  sampleWindowMs: raw.sampleWindowMs,
  method:
    "Distinct rendered frames, nearest-rank statistics; three consecutive 10-second windows per view. CPU renderMs is submission time. Initial loading snapshots are not a measured cold-load duration. Shadow diagnostics include frame time, not a separate shadow-only GPU timer.",
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
if (mode.startsWith("gpu-")) {
  if (!/D3D12.*RTX 4090/.test(raw.environment.renderer))
    throw new Error("Hardware GPU renderer must be verified");
  if (mode === "gpu-after") {
    const before = JSON.parse(
      await readFile(
        path.join(root, "gpu-before", "performance-summary.json"),
        "utf8",
      ),
    );
    await writeFile(
      path.join(root, "gpu-performance-comparison.json"),
      JSON.stringify(
        {
          before,
          after: summary,
          limitation:
            "One launch per version, three consecutive 10-second windows. RTX 4090 through WSL Mesa D3D12; frame timing is also limited by browser refresh scheduling.",
        },
        null,
        2,
      ) + "\n",
    );
  }
}
if (mode !== "after-eye") process.exit(0);
const load = async (stage: string) =>
  JSON.parse(
    await readFile(path.join(root, stage, "performance-summary.json"), "utf8"),
  );
const before = await load("before"),
  after = await load("after");
before.views.push(...(await load("before-eye")).views);
after.views.push(...summary.views);
for (const [phase, view, reference, prefix] of [
  ["phase1", "house-detail", "木組みの家.png", "house"],
  ["phase2", "forest-path", "森林の小道.png", "forest"],
  ["phase3", "village-eye-exact", "村の広場.png", "village"],
]) {
  const destination = path.join(root, phase);
  await mkdir(destination, { recursive: true });
  const eye = phase === "phase3";
  await copyFile(reference, path.join(destination, `${prefix}-reference.png`));
  for (const stage of ["before", "after"])
    await copyFile(
      path.join(root, eye ? `${stage}-eye` : stage, `${view}.png`),
      path.join(destination, `${prefix}-${stage}.png`),
    );
  const images = await Promise.all(
    [
      `${prefix}-reference.png`,
      `${prefix}-before.png`,
      `${prefix}-after.png`,
    ].map((file) =>
      sharp(path.join(destination, file))
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
    .toFile(path.join(destination, "comparison.png"));
  await writeFile(
    path.join(destination, "performance.json"),
    JSON.stringify(
      {
        before: before.views.filter((v: { view: string }) => v.view === view),
        after: after.views.filter((v: { view: string }) => v.view === view),
      },
      null,
      2,
    ) + "\n",
  );
}
// 住宅Phaseの必須名も、同じ実画像へのコピーとして用意する。
for (const stage of ["reference", "before", "after"])
  await copyFile(
    path.join(root, "phase1", `house-${stage}.png`),
    path.join(root, "phase1", `${stage}.png`),
  );
const final = path.join(root, "phase4");
await mkdir(final, { recursive: true });
for (const view of ["overview", "aerial", "forest-path", "house-close"])
  await copyFile(
    path.join(root, "after", `${view}.png`),
    path.join(final, `${view}.png`),
  );
await copyFile(
  path.join(root, "after-eye", "village-eye-exact.png"),
  path.join(final, "village-square.png"),
);
await writeFile(
  path.join(final, "performance-comparison.json"),
  JSON.stringify(
    {
      before,
      after,
      limitation:
        "SwiftShader software rendering. Hardware GPU and independent cold loads unmeasured. Separate shadow pass GPU timing unavailable; diagnostic effects are not additive.",
    },
    null,
    2,
  ) + "\n",
);
await copyFile(
  path.join(root, "after", "validation.json"),
  path.join(final, "validation.json"),
);
