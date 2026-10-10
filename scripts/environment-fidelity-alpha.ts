import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { parseProject } from "../packages/project-schema/src/index";
import { runtimeIO } from "../packages/asset-pipeline/src/runtime";

/** 元のGLBと最終GLBの葉画像を使い、しきい値と縮小時の覆いを明示コマンドで比較する。 */
const run = promisify(execFile);
const baselineCommit = "44dff8baed69b8fadfb670ae424152e1281e2e62";
const original = parseProject(
  JSON.parse(
    (
      await run("git", [
        "show",
        `${baselineCommit}:demos/worlds/alpine-village.json`,
      ])
    ).stdout,
  ),
);
const current = parseProject(
  JSON.parse(await readFile("demos/worlds/alpine-village.json", "utf8")),
);
const measurements = [];
for (const [label, project] of [
  ["before", original],
  ["after", current],
] as const) {
  const asset = project.assets.find((a) =>
    a.catalog?.slots.includes("nature.tree.quality.oak"),
  );
  const lod = asset?.runtimeInfo?.lods?.[0];
  if (!asset || !lod) throw new Error("Missing oak LOD");
  const file = `demos/sample-worlds/assets/${path.basename(lod.file)}`;
  const bytes =
    label === "before"
      ? (
          await run("git", ["show", `${baselineCommit}:${file}`], {
            encoding: "buffer",
            maxBuffer: 5 * 1024 * 1024,
          })
        ).stdout
      : await readFile(file);
  const doc = await runtimeIO().readBinary(new Uint8Array(bytes));
  const image = doc
    .getRoot()
    .listMaterials()
    .find((m) => m.getName() === "leaf")
    ?.getBaseColorTexture()
    ?.getImage();
  if (!image) throw new Error("Missing leaf texture");
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let width = info.width,
    height = info.height;
  let alpha = Array.from({ length: width * height }, (_, i) => data[i * 4 + 3]);
  const levels = [];
  for (let level = 0; ; level++) {
    levels.push({
      level,
      width,
      height,
      meanAlpha: alpha.reduce((sum, v) => sum + v, 0) / (alpha.length * 255),
      coverage: Object.fromEntries(
        [0.4, 0.5, 0.6].map((cutoff) => [
          String(cutoff),
          alpha.filter((a) => a / 255 >= cutoff).length / alpha.length,
        ]),
      ),
    });
    if (width === 1 && height === 1) break;
    const nextWidth = Math.max(1, Math.floor(width / 2)),
      nextHeight = Math.max(1, Math.floor(height / 2));
    const next = [];
    for (let y = 0; y < nextHeight; y++)
      for (let x = 0; x < nextWidth; x++) {
        let sum = 0;
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++)
            sum +=
              alpha[
                Math.min(height - 1, y * 2 + dy) * width +
                  Math.min(width - 1, x * 2 + dx)
              ];
        next.push(Math.round(sum / 4));
      }
    alpha = next;
    width = nextWidth;
    height = nextHeight;
  }
  measurements.push({ label, assetId: asset.id, file, levels });
}
const output = "docs/environment-quality/fidelity-optimization/phase-c";
await mkdir(output, { recursive: true });
await writeFile(
  `${output}/alpha-comparison.json`,
  JSON.stringify(
    {
      baselineCommit,
      method:
        "CPU 2x2 box alpha mipmaps rounded to 8-bit; fraction of texels with alpha >= cutoff. Not a render benchmark. Excludes projection, trilinear filtering, derivatives and MSAA coverage. Actual browser confirms 4x MSAA; production keeps MASK cutoff 0.5 and enables alpha-to-coverage.",
      measurements,
    },
    null,
    2,
  ) + "\n",
);
