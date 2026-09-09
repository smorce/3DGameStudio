import express from "express";
import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  PolyHavenProvider,
  AmbientCGProvider,
  LocalLibraryProvider,
  KenneyPackProvider,
} from "../../../packages/asset-providers/src/index";
import {
  resolveAssets,
  type AssetCandidate,
} from "../../../packages/asset-core/src/index";
import { LocalAssetStorage } from "../../../packages/storage/src/local";
import {
  importAsset,
  placeholderGlb,
  GenerationQueue,
  MockBlenderWorker,
} from "../../../packages/asset-pipeline/src/index";
import {
  assetSchema,
  parseProject,
  type AssetRecord,
} from "../../../packages/project-schema/src/index";
export async function createApp(
  dataDir = process.env.ASSET_DATA_DIR ?? ".data",
) {
  const app = express(),
    storage = new LocalAssetStorage(path.join(dataDir, "assets"));
  await mkdir(dataDir, { recursive: true });
  let records: AssetRecord[] = [];
  try {
    records = z
      .array(assetSchema)
      .parse(
        JSON.parse(await readFile(path.join(dataDir, "library.json"), "utf8")),
      );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  if (dataDir === (process.env.ASSET_DATA_DIR ?? ".data")) {
    try {
      const demos = z
        .array(assetSchema)
        .parse(JSON.parse(await readFile("demos/assets/library.json", "utf8")));
      for (const record of demos)
        if (!records.some((a) => a.id === record.id)) {
          await cp(
            path.join("demos/assets", record.id),
            path.join(dataDir, "assets", record.id),
            { recursive: true },
          );
          records.push(record);
        }
      await writeFile(
        path.join(dataDir, "library.json"),
        JSON.stringify(records, null, 2),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const localCandidate: AssetCandidate = {
    id: "starter-rock",
    name: "Rock • はじまりの岩",
    provider: "local",
    sourceUrl: "local:machine-studio/starter-rock",
    author: "Machine Studio",
    license: "CC0",
    thumbnail: "",
    category: "rock",
  };
  const binary = await placeholderGlb();
  const local = new LocalLibraryProvider(
      [localCandidate],
      new Map([[localCandidate.id, binary]]),
    ),
    kenney = new KenneyPackProvider();
  const providers = [
      local,
      new PolyHavenProvider(),
      new AmbientCGProvider(),
      kenney,
    ],
    queue = new GenerationQueue(new MockBlenderWorker());
  let persist = Promise.resolve();
  function saveRecord(record: AssetRecord) {
    records.push(record);
    persist = persist.then(() =>
      writeFile(
        path.join(dataDir, "library.json"),
        JSON.stringify(records, null, 2),
      ),
    );
    return persist;
  }
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      res.status(403).json({ error: "Origin is not allowed" });
      return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use(express.json({ limit: "8mb" }));
  app.get("/api/health", (_req, res) =>
    res.json({ status: "ok", ai: "dummy" }),
  );
  app.get("/api/assets", async (req, res) => {
    const selected = providers.filter(
      (p) =>
        !req.query.provider ||
        req.query.provider === "all" ||
        req.query.provider === p.id,
    );
    const result = await resolveAssets(selected, String(req.query.q ?? ""));
    const saved = records
      .filter((a) =>
        a.name.toLowerCase().includes(String(req.query.q ?? "").toLowerCase()),
      )
      .map((a) => ({
        id: a.id,
        name: a.name,
        provider: "library",
        sourceUrl: a.source.sourceUrl,
        author: a.source.author,
        license: a.license.id,
        thumbnail: a.files.thumbnail,
        category: "model",
      }));
    res.json({
      ...result,
      candidates: [
        ...result.candidates,
        ...(!req.query.provider ||
        ["all", "local"].includes(String(req.query.provider))
          ? saved
          : []),
      ],
    });
  });
  app.get("/api/library", (_req, res) => res.json(records));
  app.post("/api/import", async (req, res) => {
    const input = z
      .object({ provider: z.string(), id: z.string() })
      .parse(req.body);
    if (input.provider === "library") {
      const a = records.find((a) => a.id === input.id);
      if (!a) throw new Error("Asset not found");
      res.json(a);
      return;
    }
    const provider = providers.find((p) => p.id === input.provider);
    if (!provider) throw new Error("Unknown provider");
    const candidate = await provider.getAsset(input.id),
      options = await provider.getDownloadOptions(input.id),
      option = options.find((o) => o.format === "glb" || o.format === "gltf");
    if (!option)
      throw new Error(
        "No supported glTF download. ZIP conversion is not available.",
      );
    const cached = records.find(
      (a) =>
        a.source.provider === input.provider &&
        a.source.sourceAssetId === input.id,
    );
    if (cached) {
      res.json(cached);
      return;
    }
    const record = await importAsset(
      candidate,
      await provider.download(input.id, option),
      storage,
      option,
    );
    await saveRecord(record);
    res.json(record);
  });
  app.post("/api/upload", async (req, res) => {
    const input = z
      .object({
        name: z.string().max(120),
        data: z.string().max(6 * 1024 * 1024),
        provider: z.enum(["local", "kenney"]),
        sourceUrl: z.string().max(500),
        license: z.enum(["CC0", "unknown"]),
      })
      .parse(req.body);
    const candidate = {
      ...localCandidate,
      id: crypto.randomUUID(),
      name: input.name,
      provider: input.provider,
      sourceUrl: input.sourceUrl,
      author: input.provider === "kenney" ? "Kenney" : "User supplied",
      license: input.license,
    };
    const record = await importAsset(
      candidate,
      new Uint8Array(Buffer.from(input.data, "base64")),
      storage,
    );
    await saveRecord(record);
    res.json(record);
  });
  app.post("/api/jobs", async (req, res) => {
    const spec = z
      .object({ prompt: z.string().min(1).max(500) })
      .parse(req.body);
    const job = queue.submit(spec, async (bytes) => {
      const record = await importAsset(
        {
          ...localCandidate,
          id: crypto.randomUUID(),
          name: `ダミー素材: ${spec.prompt.slice(0, 30)}`,
          provider: "dummy",
        },
        bytes,
        storage,
      );
      record.ai = {
        provider: "DummyAIProvider",
        model: "template-v1",
        promptHash: "dummy",
        generationId: record.id,
      };
      await saveRecord(record);
      return record.id;
    });
    res.status(202).json(job);
  });
  app.get("/api/jobs/:id", (req, res) => {
    const job = queue.jobs.get(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json(job);
  });
  app.put("/api/project", async (req, res) => {
    const project = parseProject(req.body);
    await writeFile(
      path.join(dataDir, "project.json"),
      JSON.stringify(project),
    );
    res.json({ saved: true });
  });
  app.get("/api/project", async (_req, res) =>
    res.json(
      parseProject(
        JSON.parse(await readFile(path.join(dataDir, "project.json"), "utf8")),
      ),
    ),
  );
  app.use(
    "/api/files",
    express.static(path.resolve(dataDir, "assets"), {
      dotfiles: "deny",
      setHeaders: (res) => {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      },
    }),
  );
  app.get("/api/demos", (_req, res) =>
    res.json(["demo-simple-car", "demo-island-course", "demo-asset-world"]),
  );
  app.get("/api/demos/:name", async (req, res) => {
    if (
      !["demo-simple-car", "demo-island-course", "demo-asset-world"].includes(
        req.params.name,
      )
    ) {
      res.status(404).json({ error: "Demo not found" });
      return;
    }
    res.json(
      parseProject(
        JSON.parse(await readFile(`demos/${req.params.name}.json`, "utf8")),
      ),
    );
  });
  app.use("/player", express.static(path.resolve("apps/player/dist")));
  app.use(express.static(path.resolve("apps/studio/dist")));
  app.use(
    (
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(400).json({ error: error.message });
    },
  );
  return app;
}
