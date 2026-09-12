import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import {
  emptyProject,
  identity,
  parseProject,
  activeCourse,
} from "../../packages/project-schema/src/index";
import { CommandBus } from "../../packages/command-system/src/index";
import { createCourse } from "../../packages/course-system/src/index";
import {
  starterPlaneWorldPatch,
  starterWorldPatch,
} from "../../packages/world-system/src/index";
import { ChunkStreamer } from "../../packages/world-system/src/streaming";
import {
  builtinTemplate,
  instanceTemplate,
  chooseLod,
  disposeTemplate,
} from "../../packages/renderer-three/src/instances";
import { ColliderTemplateCache } from "../../packages/asset-core/src/collider";
import { evaluateRuntimeBudget } from "../../packages/asset-core/src/profiles";
it("くるま用の初期景観は中央を空けて木・ビル・山を配置する", () => {
  const patch = starterWorldPatch(emptyProject().world),
    center = Math.floor(patch.terrain.resolution / 2),
    centerHeight =
      patch.terrain.heights[center * patch.terrain.resolution + center],
    highest = Math.max(...patch.terrain.heights);

  expect(patch.entities).toHaveLength(15);
  expect(patch.entities.filter((e) => e.kind === "tree")).toHaveLength(8);
  expect(patch.entities.filter((e) => e.kind === "building")).toHaveLength(3);
  expect(patch.entities.filter((e) => e.kind === "rock")).toHaveLength(4);
  expect(centerHeight).toBe(0);
  expect(highest).toBeGreaterThan(5);
});
it("飛行機用の初期Worldは長く平坦で障害物がない", () => {
  const patch = starterPlaneWorldPatch(emptyProject().world);
  expect(patch.terrain.size).toBeGreaterThanOrEqual(1024);
  expect(new Set(patch.terrain.heights)).toEqual(new Set([0]));
  expect(patch.entities).toEqual([]);
});
it("v0/v1と既存デモはv2へ移行し保存・再読込できる", async () => {
  for (const name of [
    "demo-simple-car",
    "demo-island-course",
    "demo-asset-world",
  ]) {
    const old = JSON.parse(await readFile(`demos/${name}.json`, "utf8"));
    for (const version of [0, 1]) {
      const project = parseProject({ ...old, schemaVersion: version });
      expect(project.schemaVersion).toBe(4);
      expect(project.settings.activeCourseId).toBe(
        project.courses[0]?.id ?? null,
      );
      expect(parseProject(JSON.parse(JSON.stringify(project)))).toEqual(
        project,
      );
    }
  }
});
it("コースの選択をUndo/Redoし、明示指定とフリー走行を区別する", () => {
  const bus = new CommandBus(emptyProject()),
    a = createCourse("A"),
    b = createCourse("B");
  bus.batch([
    { type: "course.create", course: a },
    { type: "course.create", course: b },
  ]);
  bus.execute({ type: "course.activate", courseId: a.id });
  expect(activeCourse(bus.project)?.id).toBe(a.id);
  bus.undo();
  expect(activeCourse(bus.project)?.id).toBe(b.id);
  bus.redo();
  expect(activeCourse(bus.project)?.id).toBe(a.id);
  expect(activeCourse(bus.project, b.id)?.id).toBe(b.id);
  bus.execute({ type: "course.activate", courseId: null });
  expect(activeCourse(bus.project)).toBeUndefined();
  expect(() =>
    bus.execute({ type: "course.activate", courseId: "missing" }),
  ).toThrow();
});
it("チャンクは先にロードし、保持半径を出てから破棄する", () => {
  const events: string[] = [];
  const streamer = new ChunkStreamer(
    (key) => {
      events.push(`load:${key}`);
      return key;
    },
    (key) => {
      events.push(`unload:${key}`);
    },
    32,
    1,
    2,
  );
  streamer.update([0, 0, 0]);
  events.length = 0;
  streamer.update([32.1, 0, 0]);
  expect(streamer.loaded.has("-1,0")).toBe(true);
  streamer.update([31.9, 0, 0]);
  expect(events.filter((e) => e.startsWith("unload"))).toHaveLength(0);
  events.length = 0;
  streamer.update([320, 0, 0]);
  expect(events.findIndex((e) => e.startsWith("unload"))).toBeGreaterThan(
    events.length -
      1 -
      [...events].reverse().findIndex((e) => e.startsWith("load")),
  );
  expect(streamer.loaded.has("0,0")).toBe(false);
  streamer.dispose();
  expect(streamer.loaded.size).toBe(0);
});
it("500個の岩を共有Meshで描画しinstanceIdから選択できる", () => {
  const entities = Array.from({ length: 500 }, (_, i) => ({
    id: `rock-${i}`,
    name: "岩",
    kind: "rock" as const,
    transform: {
      ...identity(),
      position: [i * 2, 0, 0] as [number, number, number],
    },
  }));
  const template = builtinTemplate("rock"),
    group = instanceTemplate(template, entities);
  expect(group.children).toHaveLength(1);
  const mesh = group.children[0] as THREE.InstancedMesh;
  expect(mesh.isInstancedMesh).toBe(true);
  expect(mesh.count).toBe(500);
  group.updateMatrixWorld(true);
  const hit = new THREE.Raycaster(
    new THREE.Vector3(40, 10, 0),
    new THREE.Vector3(0, -1, 0),
  ).intersectObject(group, true)[0];
  expect(mesh.userData.entityIds[hit.instanceId!]).toBe("rock-20");
  mesh.dispose();
  disposeTemplate(template);
});
it("近・中・遠のLODと境界ヒステリシス、遠距離の三角形削減", () => {
  expect(chooseLod(10, [0, 60, 150], 0)).toBe(0);
  expect(chooseLod(80, [0, 60, 150], 0)).toBe(1);
  expect(chooseLod(180, [0, 60, 150], 1)).toBe(2);
  for (const distance of [59, 61, 59, 61])
    expect(chooseLod(distance, [0, 60, 150], 1)).toBe(1);
  expect(chooseLod(50, [0, 60, 150], 1)).toBe(0);
  const near = builtinTemplate("rock", 0),
    far = builtinTemplate("rock", 1);
  expect(
    (far.children[0] as THREE.Mesh).geometry.getAttribute("position").count,
  ).toBeLessThan(
    (near.children[0] as THREE.Mesh).geometry.getAttribute("position").count,
  );
  disposeTemplate(near);
  disposeTemplate(far);
});
it("Colliderデータは素材単位で一度だけ解析し壊れたデータを隔離する", async () => {
  let reads = 0;
  const cache = new ColliderTemplateCache(async () => {
    reads++;
    return {
      version: 1,
      vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      indices: [0, 1, 2],
    };
  });
  const results = await Promise.all(
    Array.from({ length: 1000 }, () => cache.get("rock")),
  );
  expect(reads).toBe(1);
  expect(results.every((r) => r === results[0])).toBe(true);
  expect(
    await new ColliderTemplateCache(async () => ({ vertices: [NaN] })).get(
      "broken",
    ),
  ).toBeUndefined();
});
it("Runtime予算は現在の描画量だけを評価する", () => {
  expect(
    evaluateRuntimeBudget("balanced", {
      loadedAssetBytes: 0,
      textureBytes: 0,
      triangles: 0,
      drawCalls: 0,
    }),
  ).toEqual([]);
  expect(
    evaluateRuntimeBudget("performance", {
      loadedAssetBytes: 200 * 1048576,
      textureBytes: 0,
      triangles: 0,
      drawCalls: 500,
    }),
  ).toEqual(["loadedAssetBytes", "drawCalls"]);
});
it("宣言された展開後サイズをデコード前に制限する", async () => {
  const { validateDocumentHeader } =
    await import("../../packages/asset-pipeline/src/safety");
  const { assetLimits } = await import("../../packages/asset-core/src/limits");
  const limits = assetLimits({ ASSET_MAX_AGGREGATE_MB: "1" });
  expect(() =>
    validateDocumentHeader(
      { asset: { version: "2.0" }, buffers: [{ byteLength: 2 * 1048576 }] },
      limits,
    ),
  ).toThrow("aggregate");
  expect(() =>
    validateDocumentHeader(
      {
        asset: { version: "2.0" },
        accessors: [{ count: 1e9, componentType: 5126, type: "VEC3" }],
      },
      limits,
    ),
  ).toThrow("safety");
});
