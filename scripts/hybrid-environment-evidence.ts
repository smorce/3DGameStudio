import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  copyFile,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import sharp from "sharp";
import type { AgentGameState } from "../packages/engine-core/src/agent-observation";

type Capture = {
  baseline: boolean;
  full: boolean;
  environment: {
    renderer: string;
    viewport: number[];
    canvas: number[];
    pixelRatio: number;
  };
  source: unknown;
  seed: number;
  revision?: string;
  studioBuildHash?: string;
  worldPreparationMs: number;
  results: {
    name: string;
    view: unknown;
    modes: unknown;
    conditionPreparationMs: number;
    windows: {
      repetition: number;
      samples: AgentGameState[];
      resources: Record<string, number>;
      heap: number | null;
    }[];
  }[];
};
const root = "docs/environment-quality/procedural-rendering/instruction24";
function distribution(values: unknown[]) {
  const sorted = values
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  const at = (p: number) =>
    sorted.length
      ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]
      : null;
  return {
    count: sorted.length,
    median: at(0.5),
    p95: at(0.95),
    min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null,
  };
}
async function promote(tag: string, directory: string) {
  if (
    ![
      "baseline-GPU",
      "final-GPU",
      "baseline-SwiftShader",
      "final-SwiftShader",
    ].includes(tag)
  )
    throw new Error("Invalid evidence tag");
  const status = JSON.parse(
    await readFile(path.join(directory, ".last-run.json"), "utf8"),
  );
  if (status.status !== "passed" || status.failedTests.length)
    throw new Error("Browser run must pass before evidence promotion");
  const folders = await readdir(directory);
  let source = "";
  for (const folder of folders) {
    const candidate = path.join(directory, folder, "hybrid-comparison.json");
    try {
      await readFile(candidate);
      source = candidate;
      break;
    } catch {
      /* 比較JSONのあるテスト出力を探す。 */
    }
  }
  if (!source) throw new Error("Missing comparison capture");
  const bytes = await readFile(source),
    capture: Capture = JSON.parse(bytes.toString());
  if (
    !capture.full ||
    capture.seed !== 42 ||
    capture.baseline !== tag.startsWith("baseline")
  )
    throw new Error("Invalid comparison conditions");
  if (
    tag.endsWith("GPU")
      ? !/NVIDIA GeForce RTX 4090/.test(capture.environment.renderer)
      : !/SwiftShader/i.test(capture.environment.renderer)
  )
    throw new Error("Unexpected rendering backend");
  const target = path.join(root, tag);
  await mkdir(target, { recursive: true });
  const results = capture.results.map((condition) => {
    if (condition.windows.length < 3)
      throw new Error("Evidence requires three observation windows");
    const windows = condition.windows.map((window) => {
      const samples = [
        ...new Map(window.samples.map((s) => [s.engine.frame, s])).values(),
      ];
      const metrics = Object.fromEntries(
        (
          [
            "rafMs",
            "cpuWorkMs",
            "renderMs",
            "physicsMs",
            "streamingRequestMs",
            "streamingCommitMs",
          ] as const
        ).map((key) => [key, distribution(samples.map((s) => s.frame[key]))]),
      );
      const renderer = Object.fromEntries(
        (
          [
            "drawCalls",
            "triangles",
            "gpuTimingMs",
            "shadowCpuMs",
            "shadowGpuMs",
          ] as const
        ).map((key) => [
          key,
          distribution(samples.map((s) => s.renderer[key])),
        ]),
      );
      return {
        repetition: window.repetition,
        sampleCount: samples.length,
        camera: samples[0]?.camera,
        metrics,
        renderer,
        resources: window.resources,
        heap: window.heap,
      };
    });
    return {
      name: condition.name,
      view: condition.view,
      modes: condition.modes,
      conditionPreparationMs: condition.conditionPreparationMs,
      windows,
    };
  });
  const summary = {
    tag,
    revision: capture.revision ?? "db876e8da7f260740da0e7be82760d445cb652f7",
    studioBuildHash: capture.studioBuildHash ?? null,
    environment: capture.environment,
    seed: capture.seed,
    worldSourceHash: createHash("sha256")
      .update(JSON.stringify(capture.source))
      .digest("hex"),
    worldPreparationMs: capture.worldPreparationMs,
    sampleWindowMs: 10000,
    repetitions: 3,
    rawSha256: createHash("sha256").update(bytes).digest("hex"),
    results,
  };
  await writeFile(
    path.join(target, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  await writeFile(path.join(target, "capture.json.gz"), gzipSync(bytes));
  for (const condition of capture.results)
    await copyFile(
      path.join(path.dirname(source), `${condition.name}.png`),
      path.join(target, `${condition.name}.png`),
    );
  for (const folder of folders)
    for (const name of ["hybrid-stability.json", "hybrid-rebase.json"]) {
      try {
        await copyFile(
          path.join(directory, folder, name),
          path.join(target, name),
        );
      } catch {
        /* 基準側には安定性テストがない。 */
      }
    }
  console.log(`Promoted evidence: ${tag}`);
}
async function montage(
  files: string[],
  output: string,
  columns: number,
  width: number,
  labels: string[],
) {
  const height = Math.round((width * 771) / 1440),
    titleHeight = 28,
    rows = Math.ceil(files.length / columns);
  const panels = await Promise.all(
    files.map(async (file, i) => ({
      input: await sharp(file).resize(width, height).png().toBuffer(),
      left: (i % columns) * width,
      top: Math.floor(i / columns) * (height + titleHeight) + titleHeight,
    })),
  );
  const labelSvg = `<svg width="${columns * width}" height="${rows * (height + titleHeight)}">${labels.map((label, i) => `<text x="${(i % columns) * width + 12}" y="${Math.floor(i / columns) * (height + titleHeight) + 20}" fill="white" font-family="sans-serif" font-size="16">${label}</text>`).join("")}</svg>`;
  await sharp({
    create: {
      width: columns * width,
      height: rows * (height + titleHeight),
      channels: 4,
      background: "#202820",
    },
  })
    .composite([{ input: Buffer.from(labelSvg), left: 0, top: 0 }, ...panels])
    .png()
    .toFile(output);
}
async function compare() {
  for (const backend of ["GPU", "SwiftShader"]) {
    const before = path.join(root, `baseline-${backend}`),
      after = path.join(root, `final-${backend}`);
    const a = JSON.parse(
        await readFile(path.join(before, "summary.json"), "utf8"),
      ),
      b = JSON.parse(await readFile(path.join(after, "summary.json"), "utf8"));
    if (
      a.worldSourceHash !== b.worldSourceHash ||
      JSON.stringify(a.environment.viewport) !==
        JSON.stringify(b.environment.viewport) ||
      JSON.stringify(a.environment.canvas) !==
        JSON.stringify(b.environment.canvas)
    )
      throw new Error("Baseline and final capture conditions differ");
    const views = [
      "forest-path",
      "tree-close",
      "house-close",
      "village-square",
      "farmland",
      "overview",
    ];
    for (const view of views) {
      const ca = a.results.find((r: { name: string }) => r.name === view)
          .windows[0].camera,
        cb = b.results.find((r: { name: string }) => r.name === view).windows[0]
          .camera;
      for (const key of ["position", "target"])
        for (let i = 0; i < 3; i++)
          if (Math.abs(ca[key][i] - cb[key][i]) > 1e-5)
            throw new Error("Camera poses differ");
    }
    await montage(
      views.flatMap((view) => [
        path.join(before, `${view}.png`),
        path.join(after, `${view}.png`),
      ]),
      path.join(root, `before-after-${backend}.png`),
      2,
      720,
      views.flatMap((view) => [`Baseline: ${view}`, `Final: ${view}`]),
    );
    for (const [name, modes, files] of [
      ["grass", ["A0", "A1", "A2", "A3"], ["forest-path", "A1", "A2", "A3"]],
      ["shadow", ["B0", "B1", "B2", "B3"], ["forest-path", "B1", "B2", "B3"]],
      ["material", ["C0", "C1", "C2"], ["house-close", "C1", "C2"]],
    ] as const)
      await montage(
        files.map((file) => path.join(after, `${file}.png`)),
        path.join(root, `${name}-${backend}.png`),
        modes.length === 3 ? 3 : 2,
        modes.length === 3 ? 480 : 720,
        [...modes],
      );
  }
}
if (process.argv[2] === "promote")
  await promote(process.argv[3], process.argv[4]);
else if (process.argv[2] === "compare") await compare();
else throw new Error("Expected promote or compare");
