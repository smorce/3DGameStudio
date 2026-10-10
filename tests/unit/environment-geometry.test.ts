import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { getBounds } from "@gltf-transform/functions";
import { parseProject } from "../../packages/project-schema/src/index";
import { generateChunk } from "../../packages/world-generator/src/index";
import { semanticContext } from "../../packages/world-generator/src/design-generation";
import { alpineEnvironmentAccentEntities } from "../../packages/world-generator/src/environment-accents";
import {
  environmentModelGlb,
  environmentTreeCollider,
} from "../../packages/ai-dummy/src/environment-models";

const project = () =>
  parseProject(
    JSON.parse(readFileSync("demos/worlds/alpine-village.json", "utf8")),
  );
it("対象外Chunkでは意味レイヤーと集落配置を取得しない", () => {
  const source = project().world.source;
  if (source.kind !== "procedural")
    throw new Error("Expected procedural source");
  const layers = vi.fn(() => {
    throw new Error("Unexpected settlement calculation");
  });
  expect(
    alpineEnvironmentAccentEntities(
      { ...source, chunkX: 8, chunkZ: -8 },
      layers,
    ),
  ).toEqual([]);
  expect(layers).not.toHaveBeenCalled();
});
it("負座標の所有Chunkだけに樹木があり、読込順を変えても同じ位置を生成する", () => {
  const source = project().world.source;
  if (source.kind !== "procedural" || !source.design)
    throw new Error("Expected procedural design");
  const inputs = [
    [-1, -2],
    [0, -1],
    [2, 2],
  ].map(([chunkX, chunkZ]) => ({ ...source, chunkX, chunkZ }));
  const collect = (order: typeof inputs) =>
    order
      .flatMap((input) =>
        generateChunk(input).entities.filter((e) =>
          e.id.startsWith("environment-accent"),
        ),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
  const trees = collect(inputs);
  expect(trees).toHaveLength(2);
  expect(collect([...inputs].reverse())).toEqual(trees);
  for (const tree of trees) {
    expect(tree.assetSlot).toBe("nature.tree.quality.oak");
    expect(tree.position[1]).toBe(
      semanticContext(source.design, source.seed).sampleHeight(
        tree.position[0],
        tree.position[2],
      ),
    );
  }
});
it("住宅は同じSeedで同じGLBを生成し、全LODの外形とガラス面を維持する", async () => {
  const original = await environmentModelGlb("house", 42);
  expect(await environmentModelGlb("house", 42)).toEqual(original);
  const bounds = [];
  for (const level of [0, 1, 2]) {
    const doc = await new NodeIO().readBinary(
      await environmentModelGlb("house", 42, level),
    );
    bounds.push(getBounds(doc.getRoot().listScenes()[0]));
    const glass = doc
      .getRoot()
      .listMeshes()
      .flatMap((m) => m.listPrimitives())
      .find(
        (p) =>
          p.getMaterial()?.getName() ===
          (level === 2 ? "environment-house-far-wood" : "glass"),
      )!;
    const positions = glass.getAttribute("POSITION")!;
    const sides = new Set<string>();
    for (let i = 0; i < positions.getCount(); i++) {
      const p = positions.getElement(i, []);
      if (level === 2) {
        const color = glass.getAttribute("COLOR_0")!.getElement(i, []);
        if (color[2] <= color[0] || color[1] <= color[0]) continue;
      }
      if (Math.abs(p[0]) > 3.4) sides.add(p[0] > 0 ? "right" : "left");
      if (Math.abs(p[2]) > 2.85) sides.add(p[2] > 0 ? "front" : "back");
    }
    expect(sides.size).toBe(4);
  }
  expect(bounds[1]).toEqual(bounds[0]);
  expect(bounds[2]).toEqual(bounds[0]);
});
it("広葉樹のColliderは樹冠を含まず幹だけを覆う", () => {
  const hull = JSON.parse(
    new TextDecoder().decode(environmentTreeCollider("oak")),
  );
  const xs = hull.vertices.filter((_: number, i: number) => i % 3 === 0);
  const zs = hull.vertices.filter((_: number, i: number) => i % 3 === 2);
  expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.9);
  expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(0.9);
});

it("遠景の樹木は元の三角形予算を超えず、全Seedで幹を維持する", async () => {
  for (const kind of ["oak", "pine"] as const)
    for (const seed of [0, 1, 2]) {
      const doc = await new NodeIO().readBinary(
        await environmentModelGlb(kind, seed, 2),
      );
      const triangles = doc
        .getRoot()
        .listMeshes()
        .flatMap((mesh) => mesh.listPrimitives())
        .reduce(
          (total, primitive) =>
            total +
            (primitive.getIndices()?.getCount() ??
              primitive.getAttribute("POSITION")!.getCount()) /
              3,
          0,
        );
      expect(triangles).toBeLessThanOrEqual(kind === "oak" ? 200 : 180);
      const bounds = getBounds(doc.getRoot().listScenes()[0]);
      expect(bounds.min[1]).toBeLessThan(0.01);
      expect(bounds.max[1]).toBeGreaterThanOrEqual(kind === "oak" ? 7.7 : 10);
    }
});
