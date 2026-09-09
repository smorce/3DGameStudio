import { format } from "prettier";
import { writeFile } from "node:fs/promises";
import { it, expect } from "vitest";
import {
  emptyProject,
  identity,
} from "../../packages/project-schema/src/index";
import { carTemplate } from "../../packages/machine-system/src/index";
import { RapierPhysics } from "../../packages/physics-rapier/src/index";
import {
  createCourse,
  CourseProgress,
} from "../../packages/course-system/src/index";
function wideWorld() {
  const p = emptyProject();
  p.machines = [carTemplate()];
  p.world.terrain = {
    ...p.world.terrain,
    size: 1024,
    resolution: 129,
    heights: Array(129 * 129).fill(0),
    colors: Array(129 * 129).fill("#7cab68"),
  };
  p.world.entities = Array.from({ length: 900 }, (_, i) => ({
    id: `entity-${i}`,
    name: "岩",
    kind: "rock",
    transform: {
      ...identity(),
      position: [(i % 30) * 32 - 480, 0, Math.floor(i / 30) * 32 - 480],
    },
  }));
  return p;
}
it("Machineの移動で近傍Colliderだけを維持し、遠方は増え続けない", async () => {
  const p = wideWorld(),
    physics = new RapierPhysics();
  await physics.load(p);
  try {
    expect(physics.stats.worldEntityColliders).toBeLessThan(100);
    expect(physics.stats.terrainChunkColliders).toBeLessThan(100);
    const samples = [];
    for (const x of [320, -320, 0, 320, -320]) {
      physics.respawn([x, 2, 0]);
      physics.step(0, 0);
      samples.push({ position: [x, 2, 0], ...physics.stats });
      expect(physics.stats.physicsChunksLoaded).toBeLessThanOrEqual(49);
      expect(physics.stats.colliders).toBeLessThan(150);
      const origins: number[] = [];
      physics.world.colliders.forEach((c) => {
        if (!c.parent()) origins.push(c.translation().x);
      });
      expect(origins.some((n) => Math.abs(n - x) < 40)).toBe(true);
      expect(
        origins.filter((n) => n !== 0).every((n) => Math.abs(n - x) < 140),
      ).toBe(true);
    }
    await writeFile(
      "docs/evidence/physics-streaming.json",
      await format(
        JSON.stringify({ worldEntities: 900, terrainChunks: 1024, samples }),
        { parser: "json" },
      ),
    );
  } finally {
    physics.dispose();
  }
});
it("境界通過中も隣接地形がPhysics Step前に存在し地面を抜けない", async () => {
  const p = wideWorld();
  p.world.entities = [];
  const physics = new RapierPhysics();
  await physics.load(p);
  try {
    physics.respawn([30, 0.1, 0]);
    for (let i = 0; i < 120; i++) physics.step(0, 0);
    const body = physics.vehicles[0].body;
    for (let i = 0; i < 180; i++) {
      const v = body.linvel();
      body.setLinvel({ x: 4, y: v.y, z: 0 }, true);
      physics.step(0, 0);
      expect(body.translation().y).toBeGreaterThan(-0.1);
    }
    expect(body.translation().x).toBeGreaterThan(32);
    expect(physics.stats.terrainChunkColliders).toBeGreaterThan(1);
  } finally {
    physics.dispose();
  }
});
it("BのStart・Checkpoint・Goalだけを使用しAの障害物は生成しない", async () => {
  const p = emptyProject(),
    a = createCourse("A"),
    b = createCourse("B");
  p.machines = [carTemplate()];
  a.path = [];
  b.path = [];
  b.start = [20, 1, 0];
  b.checkpoints = [{ id: "b-check", position: [20, 1, 10] }];
  b.goal = [20, 1, 20];
  a.obstacles = [
    {
      id: "a-obstacle",
      kind: "obstacle",
      position: [20, 0, 0],
      size: [10, 10, 10],
    },
  ];
  p.courses = [a, b];
  p.settings.activeCourseId = b.id;
  const physics = new RapierPhysics();
  await physics.load(p);
  try {
    physics.respawn(b.start);
    expect(physics.poses().get(p.machines[0].id)!.position[0]).toBe(20);
    expect(physics.stats.colliders).toBe(
      physics.stats.terrainChunkColliders + 1,
    );
    const progress = new CourseProgress(b);
    progress.update(b.start, 1);
    progress.update(a.goal, 1);
    expect(progress.next).toBe(0);
    progress.update(b.checkpoints[0].position, 1);
    progress.update(b.goal, 1);
    expect(progress.finished).toBe(true);
  } finally {
    physics.dispose();
  }
});
