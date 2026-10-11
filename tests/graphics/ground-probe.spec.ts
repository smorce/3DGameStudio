import { test, expect } from "../e2e/fixtures";
import { writeFile } from "node:fs/promises";
for (const origin of [-256, 0, 1000000000])
  test(`地表: 絶対原点${origin}のChunk境界とRebaseを実ブラウザで比較する`, async ({
    page,
  }, info) => {
    await page.goto("/");
    const result = await page.evaluate(
      (origin) =>
        (
          window as unknown as {
            __GROUND_PROBE__: (origin: number) => {
              seam: { max: number; changed: number };
              rebase: { max: number; changed: number };
              renderer: string;
              memory: { geometries: number; textures: number };
              programs: number;
              captures: Record<string, string>;
            };
          }
        ).__GROUND_PROBE__(origin),
      origin,
    );
    expect(result.seam.max).toBeLessThanOrEqual(1);
    expect(result.rebase.max).toBe(0);
    expect(result.memory.geometries).toBe(0);
    expect(result.memory.textures).toBe(0);
    expect(result.programs).toBe(0);
    if (process.env.GEOMETRY_GPU_CAPTURE === "1")
      expect(result.renderer).toContain("NVIDIA GeForce RTX 4090");
    for (const [name, data] of Object.entries(result.captures))
      await writeFile(
        info.outputPath(`${name}.png`),
        Buffer.from(data.split(",")[1], "base64"),
      );
    await writeFile(
      info.outputPath("ground-probe.json"),
      JSON.stringify({ ...result, captures: undefined }, null, 2),
    );
  });
