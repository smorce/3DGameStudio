/**
 * turn-motion-diagnostics-{a,b,c}.json をディスクから読み、総合 summary を書く。
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const TURN_MOTION_CASE_FILES = {
  a: "turn-motion-diagnostics-a.json",
  b: "turn-motion-diagnostics-b.json",
  c: "turn-motion-diagnostics-c.json",
} as const;

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function summarizeCase(relativePath: string, file: Record<string, unknown>) {
  const dump = (file.dump as Record<string, unknown>) ?? file;
  const verdict = dump.verdict as Record<string, unknown> | undefined;
  const stats = dump.stats as Record<string, unknown> | undefined;
  const separation = verdict?.separation as Record<string, unknown> | undefined;
  return {
    path: relativePath,
    savedAt: file.savedAt,
    mode: dump.mode ?? file.label,
    modeLabel: dump.modeLabel,
    turnStartTimeMs: dump.turnStartTimeMs,
    rafCount: stats?.rafCount,
    physicsStepCount: stats?.physicsStepCount,
    steeringPeak: stats?.steeringPeak,
    physicsDeltaP95: stats?.physicsDeltaP95,
    renderDeltaP95: stats?.renderDeltaP95,
    vehicleToTargetDistanceP95: stats?.vehicleToTargetDistanceP95,
    cameraPositionDeltaP95: stats?.cameraPositionDeltaP95,
    cameraTargetDeltaP95: stats?.cameraTargetDeltaP95,
    vehicleScreenDeltaP95: stats?.vehicleScreenDeltaP95,
    alphaLowHighTransitions: stats?.alphaLowHighTransitions,
    physicsStepsHistogram: stats?.physicsStepsHistogram,
    verdict: {
      physicsStairStepLikely: verdict?.physicsStairStepLikely,
      renderStairStepLikely: verdict?.renderStairStepLikely,
      cameraFollowLagLikely: verdict?.cameraFollowLagLikely,
      alphaOscillationLikely: verdict?.alphaOscillationLikely,
      physicsStepsAlternatingLikely: verdict?.physicsStepsAlternatingLikely,
      separation,
      notes: verdict?.notes,
    },
  };
}

export async function listMissingTurnMotionCases(
  evidenceDir = path.resolve("docs/evidence"),
) {
  const missing: string[] = [];
  for (const name of Object.values(TURN_MOTION_CASE_FILES)) {
    if (!(await exists(path.join(evidenceDir, name)))) missing.push(name);
  }
  return missing;
}

export async function writeTurnMotionSummaryFromDisk(
  evidenceDir = path.resolve("docs/evidence"),
) {
  await mkdir(evidenceDir, { recursive: true });
  const missing = await listMissingTurnMotionCases(evidenceDir);
  const cases: Record<string, ReturnType<typeof summarizeCase>> = {};
  for (const [key, fileName] of Object.entries(TURN_MOTION_CASE_FILES)) {
    const absolute = path.join(evidenceDir, fileName);
    if (!(await exists(absolute))) continue;
    const raw = JSON.parse(await readFile(absolute, "utf8")) as Record<
      string,
      unknown
    >;
    cases[key] = summarizeCase(
      path.join("docs/evidence", fileName).replace(/\\/g, "/"),
      raw,
    );
  }

  const present = Object.keys(cases);
  const summary = {
    note: "Motion Smoothness A/B。Thruster/Aero/Steering は未変更。ディスク上の turn-motion-diagnostics-{a,b,c}.json からのみ生成。",
    generatedAt: new Date().toISOString(),
    suspicionOrder: [
      "① Physicsの旋回角速度そのもの",
      "② Fixed Step / 補間",
      "③ Camera follow",
    ],
    readingGuide: {
      a: "現行（補間あり + damped camera follow）",
      b: "Rotation interpolation だけ OFF → 改善なら補間由来",
      c: "Instant camera follow / damping OFF → 改善なら Camera follow 由来",
      "physics stair in steps": "Physics Step 角速度そのものが階段 → ①",
      "screen delta stair": "機体の画面座標が止まる→飛ぶ → Camera follow damping",
      "raf/gpu normal": "Frame Performance 正常でも Motion 問題は別判定",
    },
    present,
    missing,
    complete: missing.length === 0,
    a: cases.a,
    b: cases.b,
    c: cases.c,
  };

  const relativePath = "docs/evidence/turn-motion-diagnostics.json";
  await writeFile(
    path.join(evidenceDir, "turn-motion-diagnostics.json"),
    JSON.stringify(summary, null, 2),
  );
  return {
    written: true as const,
    path: relativePath,
    missing,
    complete: missing.length === 0,
    summary,
  };
}
