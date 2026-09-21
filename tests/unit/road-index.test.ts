import { expect, it, vi } from "vitest";
import { sampleWorldCatalog } from "../../packages/sample-worlds/src/builders";
import {
  SemanticLayers,
  generateChunk,
} from "../../packages/world-generator/src/index";
import { bruteRoadInfluence } from "../fixtures/road-reference";

it.each(
  sampleWorldCatalog.filter(
    (w) => !["starter-grassland", "airfield"].includes(w.id),
  ),
)("$id の索引化後の地形・色・Propは全線分走査と完全一致する", (descriptor) => {
  const source = descriptor.buildProject().world.source;
  if (source.kind !== "procedural") throw new Error("Missing source");
  for (const [chunkX, chunkZ] of [
    [-1, -1],
    [0, 0],
    [0, 2],
    [2, 3],
    [5, 0],
    [-5, 1],
  ]) {
    const input = { ...source, chunkX, chunkZ };
    const indexed = generateChunk(input);
    const spy = vi
      .spyOn(SemanticLayers.prototype, "sampleRoadInfluence")
      .mockImplementation(bruteRoadInfluence);
    try {
      expect(generateChunk(input)).toEqual(indexed);
    } finally {
      spy.mockRestore();
    }
  }
});
it("異なる幅・減衰幅の交差道路、負座標、境界、範囲外、同距離を正しく扱う", () => {
  const source = sampleWorldCatalog
    .find((w) => w.id === "race-island")!
    .buildProject().world.source;
  if (source.kind !== "procedural" || !source.design)
    throw new Error("Missing design");
  const road = source.design.roads[0];
  source.design.roads.push({
    ...structuredClone(road),
    id: "wide",
    width: 32,
    terrainFalloff: 1,
    controlPoints: [
      [-90, 30, -40],
      [90, 30, 50],
    ],
  });
  source.design.roads.push({
    ...structuredClone(road),
    id: "long-falloff",
    width: 1,
    terrainFalloff: 100,
    controlPoints: [
      [-90, 40, -20],
      [90, 40, 70],
    ],
  });
  source.design.roads.push({ ...structuredClone(road), id: "tie" });
  const layers = new SemanticLayers(source.design, 42);
  for (let z = -224; z <= 224; z += 8)
    for (let x = -224; x <= 224; x += 8) {
      const original = bruteRoadInfluence.call(layers, x, z, true);
      const indexed = layers.sampleRoadInfluence(x, z, true);
      expect(indexed.weight).toBe(original.weight);
      if (original.weight > 0 || original.distance <= 0)
        expect(indexed).toEqual(original);
      expect(layers.sampleRoadInfluence(x, z)).toEqual(
        bruteRoadInfluence.call(layers, x, z),
      );
    }
});

it("道路を10倍に延ばしても近傍Chunkの線分照合数は増えない", () => {
  const source = sampleWorldCatalog
    .find((w) => w.id === "race-island")!
    .buildProject().world.source;
  if (source.kind !== "procedural" || !source.design)
    throw new Error("Missing design");
  const counts = [300, 3000].map((length) => {
    const design = structuredClone(source.design!);
    design.roads[0].closed = false;
    design.roads[0].controlPoints = Array.from(
      { length: length / 30 + 1 },
      (_, i) => [0, 8, i * 30],
    );
    const layers = new SemanticLayers(design, 42);
    const spy = vi.spyOn(Math, "hypot");
    try {
      layers.sampleRoadInfluence(0, 150, true);
      return spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }
  });
  expect(counts[0]).toBeGreaterThan(0);
  expect(counts[1]).toBeLessThanOrEqual(counts[0] + 2);
});

it("道路を増やしても範囲外セルの線分照合は増えない", () => {
  const source = sampleWorldCatalog
    .find((w) => w.id === "race-island")!
    .buildProject().world.source;
  if (source.kind !== "procedural" || !source.design)
    throw new Error("Missing design");
  const template = source.design.roads[0];
  const counts = [1, 100].map((roadCount) => {
    const design = structuredClone(source.design!);
    design.roads = Array.from({ length: roadCount }, (_, i) => ({
      ...structuredClone(template),
      id: `road-${i}`,
      closed: false,
      controlPoints: [
        [i * 200, 8, 0],
        [i * 200 + 80, 8, 100],
      ],
    }));
    const layers = new SemanticLayers(design, 42);
    const spy = vi.spyOn(Math, "hypot");
    try {
      layers.sampleRoadInfluence(-10000, -10000, true);
      return spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }
  });
  expect(counts[0]).toBe(0);
  expect(counts[1]).toBe(0);
});

it("近傍道路だけ照合し、遠い道路を増やしても照合数は増えない", () => {
  const source = sampleWorldCatalog
    .find((w) => w.id === "race-island")!
    .buildProject().world.source;
  if (source.kind !== "procedural" || !source.design)
    throw new Error("Missing design");
  const template = source.design.roads[0];
  const counts = [1, 100].map((roadCount) => {
    const design = structuredClone(source.design!);
    design.roads = [
      {
        ...structuredClone(template),
        id: "nearby",
        closed: false,
        controlPoints: [
          [0, 8, 0],
          [0, 8, 100],
        ],
      },
      ...Array.from({ length: roadCount - 1 }, (_, i) => ({
        ...structuredClone(template),
        id: `far-${i}`,
        closed: false,
        controlPoints: [
          [2000 + i * 200, 8, 0],
          [2080 + i * 200, 8, 100],
        ],
      })),
    ];
    const layers = new SemanticLayers(design, 42);
    const spy = vi.spyOn(Math, "hypot");
    try {
      layers.sampleRoadInfluence(0, 50, true);
      return spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }
  });
  expect(counts[0]).toBeGreaterThan(0);
  expect(counts[1]).toBe(counts[0]);
});
