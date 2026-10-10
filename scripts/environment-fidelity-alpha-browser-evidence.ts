import {
  mkdir,
  readdir,
  readFile,
  copyFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/** 合格した葉MASK/AA比較だけを、明示コマンドで正式証跡へ保存する。 */
const root = process.argv[2] ?? "test-results/alpha-browser";
if (
  JSON.parse(await readFile(path.join(root, ".last-run.json"), "utf8"))
    .status !== "passed"
)
  throw new Error(
    "All alpha browser variants must pass before promoting evidence",
  );
const directories = (await readdir(root)).filter((name) =>
  name.startsWith("alpha-alpha-browser-"),
);
if (directories.length !== 4)
  throw new Error("Expected four alpha browser variants");
const output = "docs/environment-quality/fidelity-optimization/alpha-browser";
await mkdir(output, { recursive: true });
const rank = (values: number[], fraction: number) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
};
const variants = [];
for (const directory of directories.sort()) {
  const input = path.join(root, directory);
  const validation = JSON.parse(
    await readFile(path.join(input, "validation.json"), "utf8"),
  );
  const raw = JSON.parse(
    await readFile(path.join(input, "performance.json"), "utf8"),
  );
  const name = validation.name;
  await copyFile(
    path.join(input, `${name}.png`),
    path.join(output, `${name}.png`),
  );
  await copyFile(
    path.join(input, "performance.json"),
    path.join(output, `${name}-performance.json`),
  );
  await copyFile(
    path.join(input, "validation.json"),
    path.join(output, `${name}-validation.json`),
  );
  const samples = [
    ...new Map<
      number,
      { frame: Record<string, number>; renderer: Record<string, number> }
    >(
      raw.runs[0].states[0].samples.map(
        (sample: { engine: { frame: number } }) => [
          sample.engine.frame,
          sample,
        ],
      ),
    ).values(),
  ];
  const metrics = Object.fromEntries(
    [
      ...[
        "drawCalls",
        "triangles",
        "gpuTimingMs",
        "textures",
        "geometries",
      ].map((key) => [key, samples.map((s) => s.renderer[key])]),
      ...["rafMs", "renderMs"].map((key) => [
        key,
        samples.map((s) => s.frame[key]),
      ]),
    ].map(([key, values]) => [
      key,
      {
        samples: (values as number[]).filter(Number.isFinite).length,
        median: rank(values as number[], 0.5),
        p95: rank(values as number[], 0.95),
        min: rank(values as number[], 0),
        max: rank(values as number[], 1),
      },
    ]),
  );
  variants.push({ ...validation, environment: raw.environment, metrics });
}
const order = [
  "cutoff-04-msaa4",
  "cutoff-05-msaa4",
  "cutoff-06-msaa4",
  "cutoff-05-no-msaa",
];
variants.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
for (const variant of variants) {
  for (const key of ["position", "target"] as const) {
    const reference = variants[0].camera[key] as number[];
    const actual = variant.camera[key] as number[];
    if (
      actual.some(
        (coordinate, i) => Math.abs(coordinate - reference[i]) > 0.001,
      )
    )
      throw new Error("Alpha comparison cameras must match");
  }
}
const images = await Promise.all(
  variants.map((variant) =>
    sharp(path.join(output, `${variant.name}.png`))
      .extract({ left: 980, top: 20, width: 420, height: 540 })
      .png()
      .toBuffer(),
  ),
);
await sharp({
  create: { width: 1680, height: 576, channels: 3, background: "#18212b" },
})
  .composite([
    ...images.map((input, i) => ({ input, left: i * 420, top: 36 })),
    {
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1680" height="36">${variants.map((v, i) => `<text x="${i * 420 + 12}" y="25" fill="white" font-family="sans-serif" font-size="18">MASK ${v.cutoff} / MSAA ${v.antialias ? "4x" : "off"}</text>`).join("")}</svg>`,
      ),
      left: 0,
      top: 0,
    },
  ])
  .png()
  .toFile(path.join(output, "leaf-edge-comparison.png"));
await writeFile(
  path.join(output, "comparison.json"),
  JSON.stringify(
    {
      method:
        "Same final world/camera/viewport; each variant is one independent load followed by stable counters and one 10-second window. GLB route replacement affects MASK leaf/needle cutoff only. MSAA-off overrides WebGL context attributes before startup. Static crops are not temporal flicker measurements. Software GPU timings are not hardware performance.",
      order: variants.map((v) => v.name),
      variants,
    },
    null,
    2,
  ) + "\n",
);
console.log(output);
