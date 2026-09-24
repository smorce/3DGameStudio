/** 成功したVFX E2Eの画像だけを、明示的な実行でdocsへ反映する。 */
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

const output = "test-results/vfx-evidence";
const result = spawnSync(
  "pnpm",
  [
    "exec",
    "playwright",
    "test",
    "tests/e2e/visual-effects.spec.ts",
    "--project=chromium",
    `--output=${output}`,
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0)
  throw new Error(
    `VFX evidence test failed: ${result.status ?? result.signal}`,
  );
const files = await readdir(output, { recursive: true });
const screenshots = ["vfx-ground-contact.png", "vfx-flight-turn.png"];
const sources = screenshots.map((name) => {
  const matches = files.filter((file) => path.basename(file) === name);
  if (matches.length !== 1)
    throw new Error(
      `Expected one screenshot for ${name}, found ${matches.length}`,
    );
  return path.join(output, matches[0]);
});
await mkdir("docs/screenshots", { recursive: true });
for (let index = 0; index < screenshots.length; index++)
  await copyFile(
    sources[index],
    path.join("docs/screenshots", screenshots[index]),
  );
console.log("VFX evidence updated");
