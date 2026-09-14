import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSpikeFlightSummaryFromDisk,
  writeSpikeFlightSummaryFromDisk,
} from "../../scripts/spike-flight-summary";

async function writeCase(
  dir: string,
  fileName: string,
  p95: number,
  savedAt: string,
) {
  await writeFile(
    path.join(dir, fileName),
    JSON.stringify({
      label: fileName,
      query: "",
      savedAt,
      position: [0, 0, p95],
      dump: {
        spikeCount20ms: 1,
        spikeCount33ms: 2,
        spikeCount50ms: 3,
        earlySpikeCount20ms: 0,
        earlySpikeCount33ms: 0,
        earlySpikeCount50ms: 0,
        frameP50Ms: 16.7,
        frameP95Ms: p95,
        frameP99Ms: p95 + 1,
        frameMaxMs: p95 + 2,
        recentRebases: [],
        spikeWindows: [],
        environment: {
          devicePixelRatio: 2,
          webglRenderer: "Test GPU",
          shadowMapEnabled: true,
          effectivePixelRatio: 2,
          gpuFrameP95Ms: p95 / 2,
        },
      },
    }),
  );
}

describe("spike-flight-summary", () => {
  it("欠けているケースがある間は summary を書かない", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "spike-summary-"));
    await writeCase(
      dir,
      "spike-flight-baseline.json",
      16.7,
      "2026-01-01T00:00:00.000Z",
    );
    const built = await buildSpikeFlightSummaryFromDisk(dir);
    expect(built.ok).toBe(false);
    expect(built.missing.length).toBe(3);
    const written = await writeSpikeFlightSummaryFromDisk(dir);
    expect(written.written).toBe(false);
  });

  it("4ファイル揃ったらディスク内容だけから summary を書く", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "spike-summary-"));
    await writeCase(
      dir,
      "spike-flight-baseline.json",
      16.7,
      "2026-01-01T00:00:01.000Z",
    );
    await writeCase(
      dir,
      "spike-flight-shadow-off.json",
      20,
      "2026-01-01T00:00:02.000Z",
    );
    await writeCase(
      dir,
      "spike-flight-dpr1.json",
      30,
      "2026-01-01T00:00:03.000Z",
    );
    await writeCase(
      dir,
      "spike-flight-shadow-off-dpr1.json",
      40,
      "2026-01-01T00:00:04.000Z",
    );

    const result = await writeSpikeFlightSummaryFromDisk(dir);
    expect(result.written).toBe(true);
    expect(result.summary?.baseline?.p95).toBe(16.7);
    expect(result.summary?.shadowOff?.p95).toBe(20);
    expect(result.summary?.dpr1?.p95).toBe(30);
    expect(result.summary?.shadowOffDpr1?.p95).toBe(40);

    // ファイルを書き換えたあと再生成すると、新しい値が入る（メモリ非依存）。
    await writeCase(
      dir,
      "spike-flight-baseline.json",
      99,
      "2026-01-01T00:00:05.000Z",
    );
    const again = await writeSpikeFlightSummaryFromDisk(dir);
    expect(again.summary?.baseline?.p95).toBe(99);
    const onDisk = JSON.parse(
      await readFile(path.join(dir, "spike-flight-summary.json"), "utf8"),
    ) as { baseline: { p95: number } };
    expect(onDisk.baseline.p95).toBe(99);
  });
});
