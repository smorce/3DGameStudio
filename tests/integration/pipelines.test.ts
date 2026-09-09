import { carTemplate } from "../../packages/machine-system/src/index";
import { createCourse } from "../../packages/course-system/src/index";
import { saveProject, loadProject } from "../../packages/storage/src/index";
import { it, expect, vi, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CommandBus } from "../../packages/command-system/src/index";
import {
  emptyProject,
  identity,
  uid,
} from "../../packages/project-schema/src/index";
import { DummyAIProvider } from "../../packages/ai-dummy/src/index";
import { applyPlan } from "../../packages/ai-core/src/index";
import {
  placeholderGlb,
  importAsset,
  validateGlb,
  GenerationQueue,
  MockBlenderWorker,
} from "../../packages/asset-pipeline/src/index";
import { LocalAssetStorage } from "../../packages/storage/src/local";
import { createApp } from "../../apps/server/src/app";
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
const candidate = {
  id: "rock",
  name: "Rock",
  provider: "local",
  sourceUrl: "local:rock",
  author: "Studio",
  license: "CC0",
  thumbnail: "",
  category: "rock",
};
it("ダミーPlanのValidation・Command適用は外部APIなしで原子的", async () => {
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Network is forbidden"));
  const bus = new CommandBus(emptyProject()),
    before = bus.project;
  const ai = new DummyAIProvider(0),
    plan = await ai.createWorldPlan("島", before);
  expect(bus.project).toEqual(before);
  applyPlan(bus, plan);
  expect(bus.project.courses).toHaveLength(1);
  expect(bus.project.world.entities).toHaveLength(1);
  bus.undo();
  expect(bus.project).toEqual(before);
  expect(() => applyPlan(bus, { ...plan, provider: "external" })).toThrow();
  await expect(ai.createMachinePlan("fail", before)).rejects.toThrow(
    "Simulated",
  );
  expect(fetchSpy).not.toHaveBeenCalled();
});
it("GLBの原本・最適化・参照・再読込とパストラバーサル拒否", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "machine-assets-"));
  dirs.push(dir);
  const storage = new LocalAssetStorage(dir);
  const bytes = await placeholderGlb(),
    record = await importAsset(candidate, bytes, storage);
  expect(await storage.exists(`${record.id}/original.glb`)).toBe(true);
  validateGlb(await storage.load(`${record.id}/runtime.glb`));
  const bus = new CommandBus(emptyProject());
  bus.batch([
    { type: "machine.create", machine: carTemplate() },
    { type: "course.create", course: createCourse() },
    { type: "asset.import", asset: record },
    {
      type: "asset.place",
      entity: {
        id: uid(),
        name: "岩",
        kind: "asset",
        assetId: record.id,
        transform: identity(),
      },
    },
  ]);
  const memory = new Map<string, string>();
  const projectStorage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
  };
  saveProject(projectStorage, bus.project);
  const loaded = new CommandBus(loadProject(projectStorage)!);
  expect(loaded.project).toEqual(bus.project);
  await expect(storage.save("../escape", bytes)).rejects.toThrow(
    "Invalid storage path",
  );
  expect(() => validateGlb(new Uint8Array(40))).toThrow();
});
it("生成Jobが成功・失敗を報告する", async () => {
  const queue = new GenerationQueue(new MockBlenderWorker());
  const ok = queue.submit({ prompt: "rock" }, async (bytes) => {
      validateGlb(bytes);
      return "asset";
    }),
    bad = queue.submit({ prompt: "fail" }, async () => "never");
  expect(ok.status).toBe("pending");
  await vi.waitFor(() => expect(ok.status).toBe("completed"));
  expect(ok.assetId).toBe("asset");
  await vi.waitFor(() => expect(bad.status).toBe("failed"));
});
it("サーバーの検索→取込→キャッシュ→GLB配信と永続化", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "machine-server-"));
  dirs.push(dir);
  const app = await createApp(dir),
    server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  const address = server.address() as { port: number },
    base = `http://127.0.0.1:${address.port}`;
  try {
    const search = await (
      await fetch(`${base}/api/assets?q=rock&provider=local`)
    ).json();
    expect(search.candidates.length).toBeGreaterThan(0);
    const request = () =>
      fetch(`${base}/api/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "local", id: "starter-rock" }),
      });
    const a = await (await request()).json(),
      b = await (await request()).json();
    expect(a.id).toBe(b.id);
    const file = await fetch(base + a.files.runtime);
    expect(file.status).toBe(200);
    validateGlb(new Uint8Array(await file.arrayBuffer()));
    const p = emptyProject();
    const res = await fetch(`${base}/api/project`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    expect(res.status).toBe(200);
    expect(await (await fetch(`${base}/api/project`)).json()).toEqual(p);
    const forbidden = await fetch(`${base}/api/jobs`, {
      method: "POST",
      headers: {
        Origin: "https://malicious.example",
        "Content-Type": "application/json",
      },
      body: '{"prompt":"x"}',
    });
    expect(forbidden.status).toBe(403);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
