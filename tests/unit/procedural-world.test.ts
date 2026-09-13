import { expect, it } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  emptyProject,
  parseProject,
} from "../../packages/project-schema/src/index";
import { CommandBus } from "../../packages/command-system/src/index";
import {
  chunkHash,
  chunkKey,
  generateChunk,
  generatedEntityId,
  sampleGeneratedHeight,
  worldToChunk,
  type GeneratorInput,
} from "../../packages/world-generator/src/index";
import {
  WorldRuntime,
  applyProceduralBrush,
  createStarterWorld,
  fromWorldPosition,
  rebaseDelta,
  sampleWorldHeight,
  toWorldPosition,
} from "../../packages/world-system/src/index";

const input = (
  chunkX: number,
  chunkZ: number,
  preset: GeneratorInput["preset"] = "grassland",
): GeneratorInput => ({
  seed: 42,
  generatorVersion: 1,
  preset,
  chunkX,
  chunkZ,
  chunkSize: 32,
  chunkResolution: 33,
});

it("WorldPosition変換と負Chunk座標の往復", () => {
  for (const [x, z, cx, cz] of [
    [0, 0, 0, 0],
    [-0.1, 0, -1, 0],
    [-1, -1, -1, -1],
    [0, -0.1, 0, -1],
    [31.9, 32, 0, 1],
    [-32, -32, -1, -1],
    [-33, 10, -2, 0],
  ] as const) {
    const chunk = worldToChunk(x, z, 32);
    expect(chunk.chunkX).toBe(cx);
    expect(chunk.chunkZ).toBe(cz);
    const world = toWorldPosition([x, 4, z], 32);
    expect(fromWorldPosition(world, 32)[0]).toBeCloseTo(x);
    expect(fromWorldPosition(world, 32)[2]).toBeCloseTo(z);
    expect(chunkKey(chunk.chunkX, chunk.chunkZ)).toBe(`${cx},${cz}`);
  }
});

it("地形生成は決定論的で順序に依存しない", () => {
  const a = generateChunk(input(5, 8));
  const b = generateChunk(input(5, 8));
  expect([...a.heights]).toEqual([...b.heights]);
  expect(a.entities.map((e) => e.id)).toEqual(b.entities.map((e) => e.id));
  const shuffled = [input(-3, 2), input(5, 8), input(0, 0)].map(generateChunk);
  expect(chunkHash(shuffled[1])).toBe(chunkHash(a));
});

it("隣接Chunkの共有辺は完全一致する", () => {
  const origin = generateChunk(input(0, 0));
  const neighbors = {
    e: generateChunk(input(1, 0)),
    w: generateChunk(input(-1, 0)),
    n: generateChunk(input(0, 1)),
    s: generateChunk(input(0, -1)),
  };
  const res = 33;
  for (let j = 0; j < res; j++) {
    expect(origin.heights[j * res + (res - 1)]).toBe(
      neighbors.e.heights[j * res],
    );
    expect(origin.heights[j * res]).toBe(
      neighbors.w.heights[j * res + (res - 1)],
    );
  }
  for (let i = 0; i < res; i++) {
    expect(origin.heights[(res - 1) * res + i]).toBe(neighbors.n.heights[i]);
    expect(origin.heights[i]).toBe(neighbors.s.heights[(res - 1) * res + i]);
  }
});

it("Seedが違えば地形が変わり、generatorVersionは保存される", () => {
  const a = generateChunk(input(0, 0));
  const b = generateChunk({ ...input(0, 0), seed: 99 });
  expect(chunkHash(a)).not.toBe(chunkHash(b));
  const world = createStarterWorld({ preset: "grassland", seed: 42 });
  expect(world.source.kind).toBe("procedural");
  if (world.source.kind !== "procedural") throw new Error("preset");
  expect(world.source.generatorVersion).toBe(1);
});

it("PresetのSpawn安全と滑走路・水面", () => {
  expect(
    sampleGeneratedHeight({ ...input(0, 0, "grassland"), x: 0, z: 0 }),
  ).toBeLessThan(0.6);
  expect(
    sampleGeneratedHeight({ ...input(0, 0, "airfield"), x: 0, z: 80 }),
  ).toBeCloseTo(0, 5);
  expect(generateChunk({ ...input(0, 2, "airfield") }).entities).toHaveLength(
    0,
  );
  expect(
    sampleGeneratedHeight({ ...input(0, 0, "archipelago"), x: 0, z: 0 }),
  ).toBeLessThan(-3);
  const island = generateChunk({ ...input(4, 3, "archipelago") });
  expect(
    island.heights.some((h) => h > 0) || island.heights.some((h) => h < 0),
  ).toBe(true);
});

it("Generated Entity IDは決定論的でTombstoneを残せる", () => {
  const id = generatedEntityId(input(2, -1), 0);
  expect(id).toBe("gen:1:grassland:2:-1:0");
  const world = createStarterWorld({ preset: "grassland" });
  const runtime = new WorldRuntime(world);
  const chunk = runtime.getChunk("2,-1")!;
  const first = chunk.entities[0];
  if (first) {
    world.edits.generatedEntityTombstones.push(first.id);
    runtime.reload(world);
    expect(
      runtime.getChunk("2,-1")!.entities.some((e) => e.id === first.id),
    ).toBe(false);
  }
  const bus = new CommandBus({
    ...emptyProject(),
    world: { ...emptyProject().world, ...world },
  });
  bus.execute({
    type: "asset.place",
    entity: {
      id: "user-tree",
      name: "木",
      kind: "tree",
      transform: {
        position: [4, 1, 4],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    },
  });
  expect(bus.project.world.entities.some((e) => e.id === "user-tree")).toBe(
    true,
  );
});

it("Terrain EditはChunkを跨ぎSave/Reload後も残る", () => {
  const project = emptyProject();
  Object.assign(project.world, createStarterWorld({ preset: "grassland" }));
  const bus = new CommandBus(project);
  bus.execute({
    type: "terrain.raise",
    x: 32,
    z: 0,
    radius: 8,
    strength: 3,
  });
  const edited = bus.project;
  expect(Object.keys(edited.world.edits.terrainChunks).length).toBeGreaterThan(
    0,
  );
  const again = parseProject(JSON.parse(JSON.stringify(edited)));
  const before = new WorldRuntime(edited.world).sampleHeight(32, 0)!;
  const after = new WorldRuntime(again.world).sampleHeight(32, 0)!;
  expect(after).toBeCloseTo(before, 5);
  expect(after).toBeGreaterThan(
    sampleWorldHeight(createStarterWorld({ preset: "grassland" }), 32, 0),
  );
});

it("v5有限Worldはv6 finite sourceへ完全保存される", () => {
  const legacy = emptyProject();
  const raw = {
    ...legacy,
    schemaVersion: 5,
    world: {
      ...legacy.world,
      source: undefined,
      edits: undefined,
      terrain: {
        ...legacy.world.terrain,
        heights: legacy.world.terrain.heights.map((_, i) => (i === 20 ? 7 : 0)),
      },
    },
  };
  const migrated = parseProject(JSON.parse(JSON.stringify(raw)));
  expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  expect(migrated.world.source).toEqual({ kind: "finite" });
  expect(migrated.world.terrain.heights[20]).toBe(7);
  expect(migrated.world.water).toEqual(legacy.world.water);
});

it("Renderer/Physicsは同じChunk Dataを共有しCacheは上限がある", () => {
  const world = createStarterWorld({ preset: "grassland" });
  const runtime = new WorldRuntime(world, { cacheLimit: 8, debug: true });
  const keys = Array.from({ length: 20 }, (_, i) => chunkKey(i, 0));
  runtime.acquire("renderer", keys.slice(0, 4));
  runtime.acquire("physics", keys.slice(2, 6));
  const shared = runtime.getChunk(keys[3]);
  expect(shared).toBe(runtime.peekChunk(keys[3]));
  runtime.acquire("renderer", []);
  runtime.acquire("physics", []);
  for (const key of keys) runtime.getChunk(key);
  expect(runtime.stats().cachedChunks).toBeLessThanOrEqual(8);
  runtime.reload(world);
  const stale = runtime.ticket - 1;
  expect(runtime.isCurrent(stale)).toBe(false);
});

it("Origin RebaseはChunk単位で、Telemetryはglobalを保つ", () => {
  const delta = rebaseDelta([200, 0, 10], [0, 0, 0], 32, 3);
  expect(delta?.[0]).toBe(Math.floor(200 / 32) * 32);
  expect(rebaseDelta([20, 0, 10], [0, 0, 0], 32, 3)).toBeUndefined();
  const runtime = new WorldRuntime(createStarterWorld({ preset: "airfield" }));
  const moved = runtime.maybeRebase([200, 2, 10]);
  expect(moved).toBeDefined();
  const sim = runtime.toSimulation([200, 2, 10]);
  expect(Math.abs(sim[0])).toBeLessThan(32);
  expect(runtime.toGlobal(sim)[0]).toBeCloseTo(200);
});

it("遠座標でも生成でき、古いTicketは混入しない", () => {
  const far = generateChunk(input(3125, -2100));
  expect(far.heights.length).toBe(33 * 33);
  expect(far.heights.every((n) => Number.isFinite(n))).toBe(true);
  const runtime = new WorldRuntime(createStarterWorld({ preset: "grassland" }));
  const ticket = runtime.ticket;
  runtime.dispose();
  expect(runtime.isCurrent(ticket)).toBe(false);
});

it("既存CommandBusのUndo/RedoはTerrain Editでも残る", () => {
  const project = emptyProject();
  const bus = new CommandBus(project);
  bus.execute({
    type: "terrain.raise",
    x: 0,
    z: 0,
    radius: 6,
    strength: 2,
  });
  const raised = bus.project.world.terrain.heights[16 * 33 + 16];
  bus.undo();
  expect(bus.project.world.terrain.heights[16 * 33 + 16]).toBe(0);
  bus.redo();
  expect(bus.project.world.terrain.heights[16 * 33 + 16]).toBe(raised);
  applyProceduralBrush(
    { ...createStarterWorld({ preset: "grassland" }), id: "w", name: "w" },
    "paint",
    40,
    0,
    6,
    1,
    "#c7b68b",
  );
});
