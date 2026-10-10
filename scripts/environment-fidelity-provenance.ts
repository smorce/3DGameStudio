import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** 最終の目線画像と旧カメラの性能記録を、名前で混同しないよう対応付ける。 */
const base = "docs/environment-quality/fidelity-optimization";
const eye = JSON.parse(
  await readFile(path.join(base, "eye-level/validation.json"), "utf8"),
);
if (
  !eye.completed ||
  !eye.exactPose ||
  Math.abs(eye.camera.position[1] - 13) > 0.01
)
  throw new Error("Verified exact eye-level evidence is required");
for (const phase of ["phase-b", "phase-c"]) {
  const file = path.join(base, phase, "validation.json");
  const validation = JSON.parse(await readFile(file, "utf8"));
  validation.screenshotSources = {
    "village-before.png": {
      view: "village-eye-exact",
      raw: "../before-eye/performance.json",
      validation: "../before-eye/validation.json",
    },
    "village-after.png": {
      view: "village-eye-exact",
      raw: "../eye-level/performance.json",
      validation: "../eye-level/validation.json",
      implementation:
        "Final integrated renderer; Phase B original raised-camera capture is retained separately",
    },
    "village-after-raised.png": {
      view: "village-eye",
      raw: "performance.json",
    },
    ...(phase === "phase-c"
      ? {
          "village-square.png": {
            view: "village-eye-exact",
            raw: "../eye-level/performance.json",
            validation: "../eye-level/validation.json",
          },
          "village-square-legacy.png": {
            view: "village-square",
            raw: "performance.json",
          },
        }
      : {}),
  };
  await writeFile(file, JSON.stringify(validation, null, 2) + "\n");
}
console.log("Eye-level screenshot provenance recorded");
