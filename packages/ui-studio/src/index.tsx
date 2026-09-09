import { useState, useEffect } from "react";
import {
  identity,
  uid,
  type Project,
  type Vec3,
  type AssetRecord,
} from "../../project-schema/src/index";
import type { Command } from "../../command-system/src/index";
import { createCourse, courseTemplate } from "../../course-system/src/index";
import type { AssetCandidate } from "../../asset-core/src/index";
import { DummyAIProvider } from "../../ai-dummy/src/index";
import { type Plan } from "../../ai-core/src/index";
export type EditTool =
  | "select"
  | "raise"
  | "lower"
  | "flatten"
  | "smooth"
  | "paint"
  | "noise"
  | "road"
  | "checkpoint"
  | "start"
  | "goal"
  | "jump"
  | "rock"
  | "tree"
  | "building";
export function WorldCoursePanel({
  project,
  execute,
  tool,
  setTool,
  tab,
  advanced,
}: {
  project: Project;
  execute: (c: Command) => void;
  tool: EditTool;
  setTool: (t: EditTool) => void;
  tab: string;
  advanced: boolean;
}) {
  const course = project.courses[0];
  return (
    <section>
      <h3>{tab === "world" ? "世界をつくる" : "コースをつくる"}</h3>
      {tab === "course" && (
        <label className="field">
          テンプレート
          <select
            aria-label="コーステンプレート"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) {
                const template = courseTemplate(
                  e.target.value as Parameters<typeof courseTemplate>[0],
                );
                if (course)
                  execute({
                    type: "course.update",
                    courseId: course.id,
                    patch: {
                      name: template.name,
                      path: template.path,
                      checkpoints: template.checkpoints,
                      start: template.start,
                      goal: template.goal,
                      obstacles: template.obstacles,
                      respawnPoints: template.respawnPoints,
                    },
                  });
                else execute({ type: "course.create", course: template });
              }
            }}
          >
            <option value="" disabled>
              えらぶ
            </option>
            {[
              ["straight", "一本道"],
              ["circuit", "サーキット"],
              ["offroad", "オフロード"],
              ["island", "島一周"],
              ["air", "空中コース"],
            ].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p>
        道具をえらび、地面をクリック。
        <br />
        下の「ここに置く」でも操作できます。
      </p>
      <div className="tool-grid">
        {(tab === "world"
          ? [
              ["raise", "山を作る"],
              ["flatten", "平らにする"],
              ["paint", "道をぬる"],
              ["tree", "木"],
              ["rock", "岩"],
              ["building", "建物"],
              ...(advanced
                ? [
                    ["lower", "Lower"],
                    ["smooth", "Smooth"],
                    ["noise", "Noise"],
                  ]
                : []),
            ]
          : [
              ["road", "道をひく"],
              ["jump", "ジャンプ"],
              ["checkpoint", "チェックポイント"],
              ["start", "スタート"],
              ["goal", "ゴール"],
            ]
        ).map(([t, label]) => (
          <button
            className={tool === t ? "selected" : ""}
            key={t}
            onClick={() => setTool(t as EditTool)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "world" && project.world.entities.length > 0 && (
        <>
          <h4>世界のオブジェクト</h4>
          {project.world.entities.map((entity) => (
            <div className="library-item" key={entity.id}>
              <span>{entity.name}</span>
              <button
                onClick={() =>
                  execute({ type: "asset.remove", entityId: entity.id })
                }
              >
                消す
              </button>
            </div>
          ))}
        </>
      )}
      {tab === "world" ? (
        <>
          <label className="field">
            水を表示
            <input
              type="checkbox"
              checked={project.world.water.enabled}
              onChange={(e) =>
                execute({
                  type: "world.update",
                  patch: {
                    water: {
                      ...project.world.water,
                      enabled: e.target.checked,
                    },
                  },
                })
              }
            />
          </label>
          {advanced && (
            <>
              <label className="field">
                水面の高さ
                <input
                  type="number"
                  step="0.1"
                  value={project.world.water.height}
                  onChange={(e) =>
                    execute({
                      type: "world.update",
                      patch: {
                        water: {
                          ...project.world.water,
                          height: Number(e.target.value),
                        },
                      },
                    })
                  }
                />
              </label>
              <label className="field">
                光の強さ
                <input
                  type="range"
                  min="0"
                  max="5"
                  step="0.1"
                  value={project.world.lighting.intensity}
                  onChange={(e) =>
                    execute({
                      type: "world.update",
                      patch: {
                        lighting: {
                          ...project.world.lighting,
                          intensity: Number(e.target.value),
                        },
                      },
                    })
                  }
                />
              </label>
            </>
          )}
        </>
      ) : (
        <>
          <button
            onClick={() =>
              execute({ type: "course.create", course: createCourse() })
            }
          >
            コースを追加
          </button>
          {course && (
            <>
              <p>{course.name}</p>
              <p>
                道 {course.path.length} 点 / チェックポイント{" "}
                {course.checkpoints.length} 個
              </p>
              <button
                onClick={() =>
                  execute({
                    type: "course.path.update",
                    courseId: course.id,
                    path: [],
                  })
                }
              >
                道を描き直す
              </button>
              {advanced && (
                <button
                  onClick={() =>
                    execute({
                      type: "mission.create",
                      mission: {
                        id: uid(),
                        courseId: course.id,
                        name: "60秒チャレンジ",
                        targetSeconds: 60,
                      },
                    })
                  }
                >
                  ミッションを追加
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(
    url,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const result = await res.json();
  if (!res.ok) throw new Error(result.error ?? "Request failed");
  return result as T;
}
export function AssetBrowser({
  project,
  execute,
  position,
}: {
  project: Project;
  execute: (c: Command) => void;
  position: Vec3;
}) {
  const [query, setQuery] = useState("rock"),
    [provider, setProvider] = useState("local"),
    [results, setResults] = useState<AssetCandidate[]>([]),
    [health, setHealth] = useState<
      { id: string; status: string; error?: string }[]
    >([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<AssetCandidate>(),
    [job, setJob] = useState<{
      id: string;
      status: string;
      assetId?: string;
      error?: string;
    }>(),
    [usable, setUsable] = useState(true),
    [category, setCategory] = useState(""),
    [library, setLibrary] = useState<AssetRecord[]>([]);
  const loadLibrary = () =>
    api<AssetRecord[]>("/api/library")
      .then(setLibrary)
      .catch((e) => setError(String(e)));
  useEffect(() => {
    void loadLibrary();
  }, []);
  useEffect(() => {
    if (!job || ["completed", "failed"].includes(job.status)) return;
    const timer = setTimeout(() => {
      api<typeof job>(`/api/jobs/${job.id}`)
        .then((next) => {
          setJob(next);
          if (next?.status === "completed") void loadLibrary();
        })
        .catch((e) => setError(String(e)));
    }, 250);
    return () => clearTimeout(timer);
  }, [job]);
  async function search() {
    setBusy(true);
    setError("");
    try {
      const data = await api<{
        candidates: AssetCandidate[];
        health: typeof health;
      }>(`/api/assets?q=${encodeURIComponent(query)}&provider=${provider}`);
      setResults(data.candidates);
      setHealth(data.health);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const importOne = async (c: AssetCandidate) => {
    setBusy(true);
    try {
      const record = await api<AssetRecord>("/api/import", {
        provider: c.provider,
        id: c.id,
      });
      execute({ type: "asset.import", asset: record });
      await loadLibrary();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="asset-browser">
      <h3>アセットブラウザー</h3>
      <p>素材を探す → 取得 → 世界に置く</p>
      <div className="search">
        <input
          aria-label="素材検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void search();
          }}
        />
        <button disabled={busy} onClick={() => void search()}>
          検索
        </button>
      </div>
      <select
        aria-label="Provider"
        value={provider}
        onChange={(e) => setProvider(e.target.value)}
      >
        <option value="local">Local Library</option>
        <option value="all">すべて</option>
        <option value="polyhaven">Poly Haven</option>
        <option value="ambientcg">ambientCG</option>
        <option value="kenney">Kenney Pack</option>
      </select>
      <label className="field">
        利用可能のみ
        <input
          type="checkbox"
          checked={usable}
          onChange={(e) => setUsable(e.target.checked)}
        />
      </label>
      <input
        aria-label="カテゴリ"
        placeholder="カテゴリで絞る"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      />
      {busy && <p role="status">取得中…</p>}
      {error && <p role="alert">{error}</p>}
      {health
        .filter((h) => h.status !== "available")
        .map((h) => (
          <p role="alert" key={h.id}>
            {h.id}: {h.error ?? "Provider unavailable"}
          </p>
        ))}
      <div className="asset-results">
        {results
          .filter(
            (c) =>
              (!usable || c.license === "CC0") &&
              c.category.toLowerCase().includes(category.toLowerCase()),
          )
          .map((c) => (
            <article key={`${c.provider}:${c.id}`}>
              {c.thumbnail ? (
                <img loading="lazy" src={c.thumbnail} alt={c.name} />
              ) : (
                <div className="rock-preview">◆</div>
              )}
              <strong>{c.name}</strong>
              <small>
                {c.provider === "polyhaven" ? "Poly Haven" : c.provider} ·{" "}
                {c.license}
              </small>
              <div>
                <button onClick={() => setPreview(c)}>プレビュー</button>
                <button disabled={busy} onClick={() => void importOne(c)}>
                  取得
                </button>
              </div>
            </article>
          ))}
      </div>
      {preview && (
        <div className="preview">
          <button onClick={() => setPreview(undefined)}>閉じる</button>
          {preview.thumbnail && (
            <img src={preview.thumbnail} alt={preview.name} />
          )}
          <strong>{preview.name}</strong>
          <p>
            {preview.author} / {preview.license}
          </p>
          <a href={preview.sourceUrl} target="_blank" rel="noreferrer">
            出典
          </a>
        </div>
      )}
      <h4>ライブラリー</h4>
      {[
        ...new Map(
          [...library, ...project.assets].map((a) => [a.id, a]),
        ).values(),
      ].map((a) => (
        <div className="library-item" key={a.id}>
          <span>{a.name}</span>
          <button
            onClick={() => {
              if (!project.assets.some((r) => r.id === a.id))
                execute({ type: "asset.import", asset: a });
              execute({
                type: "asset.place",
                entity: {
                  id: uid(),
                  name: a.name,
                  kind: "asset",
                  assetId: a.id,
                  transform: { ...identity(), position },
                },
              });
            }}
          >
            配置
          </button>
        </div>
      ))}
      <h4>手持ちのGLBを読み込む</h4>
      <label className="upload">
        GLB / Kenney Pack 内のGLB
        <input
          aria-label="GLBをインポート"
          type="file"
          accept=".glb"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              if (file.size > 4 * 1024 * 1024)
                throw new Error("Upload exceeds 4 MB limit");
              const bytes = new Uint8Array(await file.arrayBuffer());
              let raw = "";
              for (const b of bytes) raw += String.fromCharCode(b);
              const a = await api<AssetRecord>("/api/upload", {
                name: file.name,
                data: btoa(raw),
                provider: provider === "kenney" ? "kenney" : "local",
                sourceUrl: "user-supplied",
                license: "unknown",
              });
              execute({ type: "asset.import", asset: a });
              await loadLibrary();
            } catch (error) {
              setError(String(error));
            }
          }}
        />
      </label>
      <h4>AIで作る（ダミー）</h4>
      <p>見つからない素材は仮の形で試せます。</p>
      <button
        disabled={job && !["completed", "failed"].includes(job.status)}
        onClick={() => {
          new DummyAIProvider()
            .createAssetSpec(query || "rock")
            .then((spec) => api<NonNullable<typeof job>>("/api/jobs", spec))
            .then(setJob)
            .catch((e) => setError(String(e)));
        }}
      >
        仮の素材を作る
      </button>
      {job && (
        <p role="status">
          Job: {job.status} {job.error}
        </p>
      )}
      <small>
        Powered by Poly Haven · ambientCG
        <br />
        素材のライセンスとAPI利用条件は別です。
      </small>
    </section>
  );
}
export function AIHelp({
  project,
  onApply,
}: {
  project: Project;
  onApply: (plan: Plan) => void;
}) {
  const [prompt, setPrompt] = useState("南国の島に大きなジャンプ台を置いて"),
    [plan, setPlan] = useState<Plan>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function generate() {
    setBusy(true);
    setError("");
    try {
      const ai = new DummyAIProvider();
      setPlan(
        await (/島|世界/.test(prompt)
          ? ai.createWorldPlan(prompt, project)
          : /コース/.test(prompt)
            ? ai.createCoursePlan(prompt, project)
            : ai.createMachinePlan(prompt, project)),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h3>つくるお手伝い</h3>
      <p>ダミーAI · 有料APIは使用しません</p>
      <textarea
        aria-label="AIへのお願い"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <button disabled={busy} onClick={() => void generate()}>
        {busy ? "考え中…" : "提案をつくる"}
      </button>
      {error && <p role="alert">{error}</p>}
      {plan && (
        <div className="ai-plan">
          <h4>{plan.title}</h4>
          <p>{plan.explanation}</p>
          <ul>
            {plan.commands.map((c, i) => (
              <li key={i}>{c.type}</li>
            ))}
          </ul>
          <button
            onClick={() => {
              onApply(plan);
              setPlan(undefined);
            }}
          >
            承認して適用
          </button>
          <button onClick={() => setPlan(undefined)}>やめる</button>
        </div>
      )}
    </section>
  );
}
