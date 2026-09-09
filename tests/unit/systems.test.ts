import { describe, it, expect, vi } from "vitest";
import {
  emptyProject,
  identity,
  uid,
  parseProject,
} from "../../packages/project-schema/src/index";
import {
  carTemplate,
  compileMachine,
  createPart,
  attachPart,
} from "../../packages/machine-system/src/index";
import {
  chunkCoordinate,
  groupInstances,
} from "../../packages/world-system/src/index";
import {
  terrainChunks,
  ChunkStreamer,
} from "../../packages/world-system/src/streaming";
import {
  brushTerrain,
  heightAt,
} from "../../packages/terrain-system/src/index";
import {
  createCourse,
  CourseProgress,
} from "../../packages/course-system/src/index";
import { makeRecord, resolveAssets } from "../../packages/asset-core/src/index";
import {
  normalizePoly,
  normalizeAmbient,
  LocalLibraryProvider,
} from "../../packages/asset-providers/src/index";
import { CommandBus } from "../../packages/command-system/src/index";
describe("マシン", () => {
  it("固定グループをまとめ可動関節は残す", () => {
    const m = carTemplate();
    attachPart(m, createPart("Block"));
    attachPart(m, createPart("Hinge"));
    const r = compileMachine(m);
    expect(r.wheels).toHaveLength(4);
    expect(r.bodies).toHaveLength(2);
    expect(r.joints).toHaveLength(1);
    expect(r.wheels.filter((p) => p.metadata.front)).toHaveLength(2);
    expect(r.wheels.filter((p) => p.metadata.drive)).toHaveLength(2);
  });
  it("切り離したタイヤを独立剛体にする", () => {
    const m = carTemplate();
    m.connections.pop();
    expect(compileMachine(m).bodies).toHaveLength(2);
    expect(compileMachine(m).wheels).toHaveLength(3);
  });
  it("部品削除と参照の修復はUndo可能", () => {
    const p = emptyProject(),
      m = carTemplate();
    p.machines.push(m);
    const bus = new CommandBus(p);
    bus.execute({
      type: "part.remove",
      machineId: m.id,
      partId: m.parts[0].id,
    });
    expect(bus.project.machines[0].connections).toHaveLength(0);
    bus.undo();
    expect(bus.project).toEqual(p);
  });
});
describe("地形とワールド", () => {
  it("負座標のチャンクとインスタンス分類", () => {
    expect(chunkCoordinate([-1, 0, -33], 32)).toEqual([-1, -2]);
    const p = emptyProject();
    p.world.entities.push({
      id: uid(),
      name: "岩",
      kind: "rock",
      transform: identity(),
    });
    expect(groupInstances(p).size).toBe(1);
    const chunks = terrainChunks(p);
    expect(chunks.length).toBe(16);
    expect(chunks.reduce((n, c) => n + c.indices.length / 3, 0)).toBe(2048);
  });
  it("ロードとアンロードで破棄する", () => {
    const destroy = vi.fn(),
      stream = new ChunkStreamer((k) => k, destroy, 32, 0);
    stream.update([0, 0, 0]);
    expect([...stream.loaded.keys()]).toEqual(["0,0"]);
    stream.update([100, 0, 0]);
    expect(destroy).toHaveBeenCalledWith("0,0");
    expect([...stream.loaded.keys()]).toEqual(["3,0"]);
    stream.dispose();
    expect(stream.loaded.size).toBe(0);
  });
  it.each(["raise", "lower", "flatten", "smooth", "paint", "noise"] as const)(
    "%s ブラシが検証可能な地形を返す",
    (mode) => {
      const p = emptyProject(),
        t = p.world.terrain;
      brushTerrain(t, "raise", 0, 0, 12, 2);
      const before = JSON.stringify(t);
      brushTerrain(t, mode, 0, 0, 12, 1);
      expect(JSON.stringify(t)).not.toBe(before);
      expect(() => parseProject(p)).not.toThrow();
      expect(Number.isFinite(heightAt(t, 0, 0))).toBe(true);
    },
  );
});
describe("コース", () => {
  it("順序を守ってゴールしリスポーン地点を更新する", () => {
    const c = createCourse(),
      r = new CourseProgress(c);
    r.update(c.goal, 1);
    expect(r.finished).toBe(false);
    r.update(c.start, 1);
    r.update(c.goal, 1);
    expect(r.finished).toBe(false);
    r.update(c.checkpoints[0].position, 1);
    expect(r.respawn).toEqual(c.checkpoints[0].position);
    r.update(c.goal, 1);
    expect(r.finished).toBe(true);
    expect(r.elapsed).toBe(4);
  });
});
describe("アセット", () => {
  it("公式応答の正規化と不正データ拒否", () => {
    expect(
      normalizePoly({ rock: { name: "Rock", authors: { Alice: "model" } } })[0]
        .author,
    ).toBe("Alice");
    expect(
      normalizeAmbient({ foundAssets: [{ assetId: "Rock001" }] })[0].license,
    ).toBe("CC0");
    expect(() => normalizePoly({ rock: { name: 4 } })).toThrow();
    expect(() => normalizeAmbient({ error: "down" })).toThrow();
  });
  it("不明な出典をCC0にしない", () => {
    const record = makeRecord(
      {
        id: "x",
        name: "x",
        provider: "local",
        sourceUrl: "unknown",
        author: "",
        license: "unknown",
        thumbnail: "",
        category: "",
      },
      "x",
    );
    expect(record.license.id).toBe("unknown");
    expect(record.license.attributionRequired).toBe(true);
  });
  it("障害を隔離して別プロバイダーの結果を返す", async () => {
    const a = new LocalLibraryProvider(),
      b = new LocalLibraryProvider([
        {
          id: "rock",
          name: "Rock",
          provider: "local",
          sourceUrl: "local:rock",
          author: "Studio",
          license: "CC0",
          thumbnail: "",
          category: "rock",
        },
      ]);
    a.search = async () => {
      throw new Error("Provider unavailable");
    };
    const r = await resolveAssets([a, b], "rock");
    expect(r.candidates).toHaveLength(1);
    expect(r.health[0].status).toBe("unavailable");
  });
});
