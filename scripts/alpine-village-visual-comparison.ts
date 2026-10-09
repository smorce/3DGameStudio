import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const root = "docs/worlds/alpine-village-upgrade";
await mkdir(root, { recursive: true });
async function compare(left: string, right: string, output: string) {
  const panels = await Promise.all(
    [left, right].map((file) =>
      sharp(file)
        .resize(1440, 790, { fit: "contain", background: "#182229" })
        .png()
        .toBuffer(),
    ),
  );
  await sharp({
    create: { width: 2880, height: 790, channels: 3, background: "#182229" },
  })
    .composite(panels.map((input, i) => ({ input, left: i * 1440, top: 0 })))
    .png()
    .toFile(`${root}/${output}`);
}
// 実際のブラウザ画像を並べ、目標との比較と同一カメラでの改修前後を別々に保存する。
await compare(
  "山々に囲まれたヨーロッパ風の田園風景.png",
  `${root}/phase3/reference.png`,
  "target-vs-upgrade.png",
);
await compare(
  `${root}/baseline/reference.png`,
  `${root}/phase3/reference.png`,
  "before-vs-after.png",
);
for (const view of [
  "overview",
  "farmland",
  "forest",
  "village",
  "windmill",
  "aerial",
])
  await compare(
    `${root}/baseline/${view}.png`,
    `${root}/phase3/${view}.png`,
    `${view}-comparison.png`,
  );
