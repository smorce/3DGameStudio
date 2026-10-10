import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import RAPIER from "@dimforge/rapier3d-compat";
import { parseProject } from "../../packages/project-schema/src/index";
import { RapierPhysics } from "../../packages/physics-rapier/src/index";
import { colliderDataSchema } from "../../packages/asset-core/src/collider";

it("景観樹木の幹は既存Rapier経路で衝突し、Rebase・解放・再読込でも重複しない", async () => {
  const p = parseProject(
    JSON.parse(readFileSync("demos/worlds/alpine-village.json", "utf8")),
  );
  const physics = new RapierPhysics();
  vi.spyOn(physics.colliderTemplates, "get").mockImplementation(async (url) =>
    colliderDataSchema.parse(
      JSON.parse(
        readFileSync(
          path.join("demos/sample-worlds/assets", path.basename(url)),
          "utf8",
        ),
      ),
    ),
  );
  try {
    await physics.load(p);
    const registry = (
      physics as unknown as {
        staticColliders: Map<
          string,
          { collider: RAPIER.Collider; refs: number }
        >;
      }
    ).staticColliders;
    const id = "entity:environment-accent-oak-0";
    for (let i = 0; i < 30; i++) physics.respawn([-8, 18, -88]);
    const tree = registry.get(id)!.collider;
    expect(tree).toBeDefined();
    const position = tree.translation();
    const hit = tree.castRay(
      new RAPIER.Ray(
        { x: position.x - 2, y: position.y + 2, z: position.z + 0.05 },
        { x: 1, y: 0, z: 0 },
      ),
      4,
      true,
    );
    expect(hit).toBeGreaterThan(1);
    expect(hit).toBeLessThan(2);
    expect(
      tree.castRay(
        new RAPIER.Ray(
          { x: position.x - 2, y: position.y + 11, z: position.z },
          { x: 1, y: 0, z: 0 },
        ),
        4,
        true,
      ),
    ).toBeLessThan(0);
    physics.world.gravity = { x: 0, y: 0, z: 0 };
    // 実際のサンプル車の車体Colliderで幹への接触を確認する。
    const car = physics.vehicles[0].body;
    car.setTranslation(
      { x: position.x - 4, y: position.y + 2, z: position.z + 0.05 },
      true,
    );
    car.setLinvel({ x: 3, y: 0, z: 0 }, true);
    let touchedTrunk = false;
    for (let i = 0; i < 90; i++) {
      physics.world.step();
      for (let j = 0; j < car.numColliders(); j++)
        physics.world.contactPair(car.collider(j), tree, (manifold) => {
          if (manifold.numContacts() > 0) touchedTrunk = true;
        });
    }
    expect(touchedTrunk).toBe(true);
    expect(car.translation().x).toBeLessThan(position.x);
    const plan = physics.worldRuntime!.planRebase([400, 0, 400])!;
    physics.shiftOrigin(plan.delta);
    physics.worldRuntime!.commitRebase(plan);
    expect(tree.translation().x).toBeCloseTo(position.x - plan.delta[0]);
    expect(tree.translation().z).toBeCloseTo(position.z - plan.delta[2]);
    for (let i = 0; i < 30; i++) physics.respawn([1000, 20, 1000]);
    expect(registry.has(id)).toBe(false);
    for (let i = 0; i < 30; i++) physics.respawn([-8, 18, -88]);
    expect(registry.get(id)?.refs).toBe(1);
    expect([...registry.keys()].filter((key) => key === id)).toHaveLength(1);
  } finally {
    physics.dispose();
    vi.restoreAllMocks();
  }
}, 30000);

it("最終生成された住宅のTrimeshは配置と一致し、実車両が壁を通り抜けない", async () => {
  const project = parseProject(
    JSON.parse(readFileSync("demos/worlds/alpine-village.json", "utf8")),
  );
  const physics = new RapierPhysics();
  vi.spyOn(physics.colliderTemplates, "get").mockImplementation(async (url) =>
    colliderDataSchema.parse(
      JSON.parse(
        readFileSync(
          path.join("demos/sample-worlds/assets", path.basename(url)),
          "utf8",
        ),
      ),
    ),
  );
  try {
    await physics.load(project);
    const house = physics
      .worldRuntime!.getChunk("-1,-2")!
      .entities.filter(
        (entity) => entity.assetSlot === "building.quality.house",
      )
      .sort(
        (a, b) =>
          Math.hypot(a.position[0] + 19.6, a.position[2] + 83.6) -
          Math.hypot(b.position[0] + 19.6, b.position[2] + 83.6),
      )[0];
    expect(house).toBeDefined();
    for (let i = 0; i < 30; i++) physics.respawn(house.position);
    const registry = (
      physics as unknown as {
        staticColliders: Map<string, { collider: RAPIER.Collider }>;
      }
    ).staticColliders;
    const wall = registry.get(`entity:${house.id}`)!.collider;
    expect(wall.shapeType()).toBe(RAPIER.ShapeType.TriMesh);
    expect(wall.translation().x).toBeCloseTo(house.position[0]);
    expect(wall.translation().y).toBeCloseTo(house.position[1]);
    expect(wall.translation().z).toBeCloseTo(house.position[2]);
    const normal = {
      x: Math.sin(house.rotation[1]),
      z: Math.cos(house.rotation[1]),
    };
    physics.world.gravity = { x: 0, y: 0, z: 0 };
    const car = physics.vehicles[0].body;
    car.setTranslation(
      {
        x: house.position[0] + normal.x * 6,
        y: house.position[1] + 3,
        z: house.position[2] + normal.z * 6,
      },
      true,
    );
    car.setLinvel({ x: -normal.x * 3, y: 0, z: -normal.z * 3 }, true);
    let touchedWall = false;
    for (let i = 0; i < 90; i++) {
      physics.world.step();
      for (let j = 0; j < car.numColliders(); j++)
        physics.world.contactPair(car.collider(j), wall, (manifold) => {
          if (manifold.numContacts() > 0) touchedWall = true;
        });
    }
    expect(touchedWall).toBe(true);
    expect(
      (car.translation().x - house.position[0]) * normal.x +
        (car.translation().z - house.position[2]) * normal.z,
    ).toBeGreaterThan(2.8 * house.scale[2]);
  } finally {
    physics.dispose();
    vi.restoreAllMocks();
  }
}, 30000);
