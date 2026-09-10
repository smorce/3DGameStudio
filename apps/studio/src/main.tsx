import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  emptyProject,
  uid,
  activeCourse,
  identity,
  type Part,
  type Vec3,
} from "../../../packages/project-schema/src/index";
import {
  CommandBus,
  type Command,
} from "../../../packages/command-system/src/index";
import {
  createMachine,
  createPart,
  carTemplate,
  planeTemplate,
  boatTemplate,
  findAttachmentCandidates,
  labels,
  type AttachmentCandidate,
} from "../../../packages/machine-system/src/index";
import { Engine } from "../../../packages/engine-core/src/index";
import { loadProject, saveProject } from "../../../packages/storage/src/index";
import { EasyPalette } from "../../../packages/ui-easy/src/index";
import { MachineInspector } from "../../../packages/ui-creator/src/index";
import {
  WorldCoursePanel,
  AssetBrowser,
  AIHelp,
  type EditTool,
} from "../../../packages/ui-studio/src/index";
import { createCourse } from "../../../packages/course-system/src/index";
import { heightAt } from "../../../packages/terrain-system/src/index";
import { applyPlan } from "../../../packages/ai-core/src/index";
import "./style.css";
type PlacementSession = {
  kind: Part["definitionId"];
  candidates: AttachmentCandidate[];
  movingPartId?: string;
  sourcePartId?: string;
};
const bus = new CommandBus(emptyProject());
function App() {
  const [project, setProject] = useState(bus.project),
    [started, setStarted] = useState(false),
    [message, setMessage] = useState("板とタイヤで、きみだけの一台。"),
    [playing, setPlaying] = useState(false),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<string>(),
    [level, setLevel] = useState("easy"),
    [tab, setTab] = useState("machine"),
    [tool, setTool] = useState<EditTool>("select"),
    [cursor, setCursor] = useState<Vec3>([5, 0, 5]),
    [stats, setStats] = useState<Record<string, number>>({}),
    [runtime, setRuntime] = useState("");
  const [placement, setPlacement] = useState<PlacementSession>();
  const [hovered, setHovered] = useState<string>();
  const [candidateScreens, setCandidateScreens] = useState<
    { id: string; x: number; y: number }[]
  >([]);
  const placementRef = useRef(placement);
  placementRef.current = placement;
  const cancelPlacement = () => {
    placementRef.current = undefined;
    setPlacement(undefined);
    setHovered(undefined);
    setMessage("パーツを選んで、光っているところを押してね");
    engine.current?.renderer.showAttachmentCandidates([]);
  };
  const commitPlacement = (candidateId: string) => {
    const session = placementRef.current,
      m = bus.project.machines[0];
    if (!session || !m) return;
    try {
      const partId = session.movingPartId ?? uid();
      bus.execute(
        session.movingPartId
          ? { type: "part.reattach", machineId: m.id, partId, candidateId }
          : {
              type: "part.attach",
              machineId: m.id,
              partId,
              kind: session.kind,
              candidateId,
              sourcePartId: session.sourcePartId,
            },
      );
      cancelPlacement();
      setSelected(partId);
      setMessage(labels[session.kind] + "をつけたよ！");
    } catch {
      cancelPlacement();
      setMessage("そこにはつけられなくなったよ。もう一度パーツをえらんでね");
    }
  };
  const toolRef = useRef<EditTool>("select");
  toolRef.current = tool;
  const canvas = useRef<HTMLCanvasElement>(null),
    engine = useRef<Engine>(null);
  const machine = project.machines[0],
    part = machine?.parts.find((p) => p.id === selected);
  const run = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Operation failed");
    }
  };
  const execute = (c: Command) => run(() => bus.execute(c));
  useEffect(() => bus.subscribe(() => setProject(bus.project)), []);
  useEffect(() => {
    try {
      const saved = loadProject(localStorage);
      if (saved) {
        bus.load(saved);
        setStarted(true);
        setMessage("おかえりなさい。つづきからつくろう！");
      }
    } catch {
      setMessage(
        "Project load failed. Create a new project or import a backup.",
      );
    }
    const e = new Engine(canvas.current!);
    engine.current = e;
    let lastStats = 0;
    e.onFrame = () => {
      if (performance.now() - lastStats > 250) {
        lastStats = performance.now();
        setStats({
          ...e.stats,
          x: e.position[0],
          y: e.position[1],
          z: e.position[2],
        });
        setRuntime(
          e.course
            ? `${e.course.finished ? "ゴール！" : "チェックポイント"} ${e.course.next}/${e.course.course.checkpoints.length} · ${e.course.elapsed.toFixed(1)} 秒`
            : "",
        );
      }
    };
    e.renderer.onStroke = (points) => {
      const p = bus.project;
      let course = activeCourse(p);
      const commands: Command[] = [];
      if (!course) {
        course = createCourse();
        course.path = [];
        course.checkpoints = [];
        commands.push({ type: "course.create", course });
      }
      commands.push({
        type: "course.path.update",
        courseId: course.id,
        path: [
          ...course.path,
          ...points.map(
            (v) =>
              [v[0], heightAt(p.world.terrain, v[0], v[2]) + 0.1, v[2]] as Vec3,
          ),
        ],
      });
      run(() => bus.batch(commands));
    };
    e.renderer.onAttachmentPick = commitPlacement;
    e.renderer.onAttachmentHover = setHovered;
    e.renderer.onCandidateScreens = (points) =>
      setCandidateScreens((before) =>
        JSON.stringify(before) === JSON.stringify(points) ? before : points,
      );
    e.renderer.onPick = (id, point) => {
      if (e.mode === "PLAY") return;
      setCursor(point);
      if (toolRef.current !== "select") {
        place(toolRef.current, point);
        return;
      }
      if (!placementRef.current) setSelected(id);
    };
    return () => e.dispose();
  }, []);
  useEffect(() => {
    void engine.current?.load(project);
  }, [project]);
  useEffect(
    () => engine.current?.renderer.select(selected),
    [selected, project],
  );
  useEffect(() => {
    if (!placement) {
      engine.current?.renderer.showAttachmentCandidates([]);
      return;
    }
    const m = project.machines[0];
    if (!m || !started || playing || level !== "easy" || tab !== "machine") {
      cancelPlacement();
      return;
    }
    const candidates = findAttachmentCandidates(
      m,
      placement.kind,
      placement.movingPartId,
      placement.sourcePartId,
    );
    placementRef.current = { ...placement, candidates };
    if (JSON.stringify(candidates) !== JSON.stringify(placement.candidates))
      setPlacement({ ...placement, candidates });
    setMessage(
      candidates.length
        ? m.parts.length
          ? "光っているところを押してね"
          : "ここからはじめよう"
        : "もう" + labels[placement.kind] + "をつけられる場所がないよ",
    );
    const preview =
      m.parts.find(
        (p) => p.id === (placement.movingPartId ?? placement.sourcePartId),
      ) ?? createPart(placement.kind);
    engine.current?.renderer.showAttachmentCandidates(candidates, preview);
  }, [placement, project, started, playing, level, tab]);
  useEffect(() => {
    if (engine.current)
      engine.current.renderer.drawing = tool === "road" && !playing;
  }, [tool, playing]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (playing || (e.target as HTMLElement).matches("input,textarea,select"))
        return;
      if (e.code === "Escape") {
        cancelPlacement();
        setMessage("パーツを選んで、光っているところを押してね");
      }
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
        e.preventDefault();
        if (e.shiftKey) bus.redo();
        else bus.undo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [playing]);
  function start(template: boolean | "plane" | "boat") {
    run(() => {
      const p = emptyProject();
      bus.execute({ type: "project.create", project: p });
      bus.execute({
        type: "machine.create",
        machine:
          template === "plane"
            ? planeTemplate()
            : template === "boat"
              ? boatTemplate()
              : template
                ? carTemplate()
                : createMachine(),
      });
      if (template === "boat")
        bus.execute({
          type: "world.update",
          patch: { water: { enabled: true, height: 1 } },
        });
      setStarted(true);
      setSelected(undefined);
      setTool("select");
    });
  }
  function place(t: EditTool, point: Vec3) {
    const p = bus.project;
    const position: Vec3 = [
      Math.round(point[0]),
      heightAt(p.world.terrain, point[0], point[2]) + 0.06,
      Math.round(point[2]),
    ];
    if (["raise", "lower", "flatten", "smooth", "paint", "noise"].includes(t)) {
      execute({
        type: `terrain.${t}` as "terrain.raise",
        x: position[0],
        z: position[2],
        radius: 12,
        strength: 1,
      });
    } else if (["tree", "rock", "building"].includes(t)) {
      execute({
        type: "asset.place",
        entity: {
          id: uid(),
          name: t,
          kind: t as "tree",
          transform: { ...identity(), position },
        },
      });
    } else if (t !== "select") {
      let c = activeCourse(p);
      if (!c) {
        c = createCourse();
        c.path = [];
        c.checkpoints = [];
        execute({ type: "course.create", course: c });
      }
      if (t === "road")
        execute({
          type: "course.path.update",
          courseId: c.id,
          path: [...c.path, position],
        });
      if (t === "start" || t === "goal")
        execute({
          type: t === "start" ? "course.start.set" : "course.goal.set",
          courseId: c.id,
          position,
        });
      if (t === "checkpoint")
        execute({ type: "course.checkpoint.add", courseId: c.id, position });
      if (t === "jump")
        execute({
          type: "course.update",
          courseId: c.id,
          patch: {
            obstacles: [
              ...c.obstacles,
              { id: uid(), kind: "jump", position, size: [4, 1, 5] },
            ],
          },
        });
    }
  }
  function beginPlacement(
    kind: Part["definitionId"],
    movingPartId?: string,
    sourcePartId?: string,
  ) {
    if (!machine) return;
    const candidates = findAttachmentCandidates(
      machine,
      kind,
      movingPartId,
      sourcePartId,
    );
    setTool("select");
    setHovered(undefined);
    setPlacement({ kind, candidates, movingPartId, sourcePartId });
    setMessage(
      candidates.length
        ? machine.parts.length
          ? "光っているところを押してね"
          : "ここからはじめよう"
        : "もう" + labels[kind] + "をつけられる場所がないよ",
    );
  }
  function add(kind: Part["definitionId"]) {
    if (!machine) return;
    if (level === "easy") {
      if (placement?.kind === kind) cancelPlacement();
      else beginPlacement(kind);
      return;
    }
    const p = createPart(kind, kind === "Panel" ? [0, 0.85, 0] : [0, 1.5, 0]);
    execute({ type: "part.add", machineId: machine.id, part: p });
    setTool("select");
    setSelected(p.id);
  }
  async function toggle() {
    cancelPlacement();
    setBusy(true);
    try {
      if (playing) {
        engine.current?.stop();
        setPlaying(false);
      } else {
        await engine.current?.play();
        setPlaying(engine.current?.mode === "PLAY");
        setMessage("W / ↑ で進む · A D で曲がる · Space ブレーキ · R でもどる");
      }
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main
      className={`app ${level} ${started ? "started" : ""} ${!playing && (level !== "easy" || tab !== "machine") ? "has-panel" : ""}`}
    >
      <header>
        <a className="brand" href="#" aria-label="Machine Studio">
          <span className="brand-mark">
            m<span>▰</span>
          </span>
          <div>
            MACHINE<span>STUDIO</span>
          </div>
        </a>
        <div className="mode-switch">
          <button
            className={level === "easy" ? "active" : ""}
            onClick={() => {
              setLevel("easy");
              if (["assets", "ai"].includes(tab)) setTab("machine");
            }}
          >
            つくる
          </button>
          <button
            className={level === "creator" ? "active" : ""}
            onClick={() => {
              setLevel("creator");
              if (["assets", "ai"].includes(tab)) setTab("machine");
            }}
          >
            くわしくつくる
          </button>
          <button
            className={level === "studio" ? "active" : ""}
            onClick={() => setLevel("studio")}
          >
            Studio
          </button>
        </div>
        {level !== "easy" && (
          <label>
            走るコース
            <select
              aria-label="走るコース"
              disabled={playing}
              value={activeCourse(project)?.id ?? ""}
              onChange={(e) =>
                execute({
                  type: "course.activate",
                  courseId: e.target.value || null,
                })
              }
            >
              <option value="">フリー走行</option>
              {project.courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className="save"
          onClick={() =>
            run(() => {
              saveProject(localStorage, project);
              setMessage("保存しました");
            })
          }
        >
          保存
        </button>
        <button
          className="play"
          disabled={busy || !machine?.parts.length}
          onClick={() => void toggle()}
        >
          {busy ? "準備中…" : playing ? "■ やめる" : "▶ あそぶ"}
        </button>
      </header>
      <div className="workspace">
        <canvas ref={canvas} aria-label="3Dビューポート" />
        {placement && !playing && (
          <>
            <div className="placement-message" role="status">
              <span>{hovered ? "ここにつける" : message}</span>
              <button onClick={cancelPlacement}>やめる</button>
            </div>
            <div className="candidate-labels" aria-label="つけられる場所">
              {candidateScreens.map((point, i) => (
                <button
                  key={point.id}
                  data-candidate-id={point.id}
                  aria-label={"ここにつける " + (i + 1)}
                  style={{ left: point.x, top: point.y }}
                  onClick={() => commitPlacement(point.id)}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </>
        )}
        {started && !playing && (
          <nav className="workspace-tabs" aria-label="作るもの">
            {[
              ["machine", "マシン"],
              ["world", "ワールド"],
              ["course", "コース"],
              ...(level === "studio"
                ? [
                    ["assets", "素材"],
                    ["ai", "AI"],
                  ]
                : []),
            ].map(([id, label]) => (
              <button
                className={tab === id ? "active" : ""}
                key={id}
                onClick={() => {
                  setTab(id);
                  setTool("select");
                }}
              >
                {label}
              </button>
            ))}
          </nav>
        )}
        <div className="scene-label">
          <span className="eyebrow">YOUR NEXT GREAT IDEA</span>
          <h1>{playing ? "走ってみよう。" : "つくって、走ろう。"}</h1>
          <p>{message}</p>
        </div>
        {started && !playing && (level !== "easy" || tab !== "machine") && (
          <aside className="side-panel">
            {tab === "machine" ? (
              <MachineInspector
                machine={machine}
                selected={selected}
                onSelect={setSelected}
                execute={execute}
                advanced={level === "studio"}
              />
            ) : tab === "assets" ? (
              <AssetBrowser
                project={project}
                execute={execute}
                position={cursor}
              />
            ) : tab === "ai" ? (
              <AIHelp
                project={project}
                onApply={(plan) => run(() => applyPlan(bus, plan))}
              />
            ) : (
              <>
                <WorldCoursePanel
                  project={project}
                  execute={execute}
                  tool={tool}
                  setTool={setTool}
                  tab={tab}
                  advanced={level === "studio"}
                />
                <section>
                  <h4>置く場所</h4>
                  <div className="vector">
                    {[0, 2].map((i) => (
                      <label key={i}>
                        {"XYZ"[i]}
                        <input
                          aria-label={`配置 ${"XYZ"[i]}`}
                          type="number"
                          value={Math.round(cursor[i])}
                          onChange={(e) => {
                            const p = [...cursor] as Vec3;
                            p[i] = Number(e.target.value);
                            setCursor(p);
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  <button
                    disabled={tool === "select"}
                    onClick={() => place(tool, cursor)}
                  >
                    ここに置く
                  </button>
                  <p>
                    {tool === "select"
                      ? "道具をえらんでください"
                      : `選択中: ${tool}`}
                  </p>
                </section>
              </>
            )}
            {level === "studio" && (
              <section>
                <h3>プロジェクト</h3>
                <button
                  onClick={() => {
                    const url = URL.createObjectURL(
                      new Blob([JSON.stringify(project, null, 2)], {
                        type: "application/json",
                      }),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "machine-studio.json";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  JSONを書き出す
                </button>
                <label className="upload">
                  JSONを読み込む
                  <input
                    aria-label="プロジェクト読込"
                    type="file"
                    accept=".json"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        const text = await f.text();
                        run(() => bus.load(JSON.parse(text)));
                      }
                    }}
                  />
                </label>
                <p>
                  ミッション {project.missions.length} / 配置{" "}
                  {project.world.entities.length}
                </p>
              </section>
            )}
          </aside>
        )}
        {(level === "studio" || playing) && (
          <output className="stats" aria-label="Runtime Stats">
            {level !== "easy" && (
              <>
                FPS {stats.fps} · Draw Calls {stats.drawCalls} · Triangles{" "}
                {stats.triangles}
                <br />
                Rigid Bodies {stats.rigidBodies} · Colliders {stats.colliders} ·
                Chunks {stats.loadedChunks} · Physics Chunks{" "}
                {stats.physicsChunksLoaded}
                <br />
                <span>
                  Assets {stats.loadedAssets} · Runtime{" "}
                  {Math.round((stats.runtimeAssetBytes ?? 0) / 1024)} KiB ·
                  Budget超過 {stats.runtimeBudgetExceeded ?? 0} · Texture ≈{" "}
                  {Math.round((stats.textureMemoryEstimate ?? 0) / 1048576)} MiB
                </span>
                <br />
                <span>
                  LOD0 {stats.lod0Batches ?? 0} · LOD1 {stats.lod1Batches ?? 0}{" "}
                  · LOD2 {stats.lod2Batches ?? 0}
                </span>
                <br />
              </>
            )}
            <span
              data-testid="runtime-position"
              data-position={JSON.stringify([stats.x ?? 0, stats.z ?? 0])}
            >
              {level === "easy" ? (
                "W / ↑ ですすもう"
              ) : (
                <>
                  位置 {stats.x?.toFixed(2)}, {stats.z?.toFixed(2)} · 高さ{" "}
                  {stats.y?.toFixed(2)}
                </>
              )}
            </span>{" "}
            {runtime}
          </output>
        )}
        <div className="tools">
          <button disabled={playing || !bus.canUndo} onClick={() => bus.undo()}>
            ↶ 元に戻す
          </button>
          <button disabled={playing || !bus.canRedo} onClick={() => bus.redo()}>
            ↷ やり直す
          </button>
          <button
            disabled={playing}
            onClick={() => {
              setStarted(false);
              setSelected(undefined);
              setTool("select");
            }}
          >
            新しくつくる
          </button>
        </div>
        {part && !playing && !placement && (
          <div className="selection-tools" data-selected-id={part.id}>
            <span>{labels[part.definitionId]}</span>
            {level === "easy" && (
              <button
                onClick={() => beginPlacement(part.definitionId, part.id)}
              >
                ◎ つけ直す
              </button>
            )}
            {level !== "easy" && (
              <>
                <button
                  onClick={() =>
                    execute({
                      type: "part.move",
                      machineId: machine.id,
                      partId: part.id,
                      value: [
                        part.transform.position[0] - 1,
                        part.transform.position[1],
                        part.transform.position[2],
                      ],
                    })
                  }
                >
                  ← 置く
                </button>
                <button
                  onClick={() =>
                    execute({
                      type: "part.move",
                      machineId: machine.id,
                      partId: part.id,
                      value: [
                        part.transform.position[0] + 1,
                        part.transform.position[1],
                        part.transform.position[2],
                      ],
                    })
                  }
                >
                  置く →
                </button>
              </>
            )}
            <button
              onClick={() =>
                execute({
                  type: "part.turn",
                  machineId: machine.id,
                  partId: part.id,
                  steps: 1,
                })
              }
            >
              ↻ 回す
            </button>
            {part.definitionId === "Panel" && (
              <button
                onClick={() =>
                  execute({
                    type: "part.tilt",
                    machineId: machine.id,
                    partId: part.id,
                    angle: Math.PI / 36,
                  })
                }
              >
                ／ 傾ける
              </button>
            )}
            {part.definitionId === "Thruster" && (
              <button
                onClick={() =>
                  execute({
                    type: "part.turn",
                    machineId: machine.id,
                    partId: part.id,
                    steps: 2,
                  })
                }
              >
                ⇄ 反対向き
              </button>
            )}
            <button
              onClick={() => {
                if (level === "easy") {
                  beginPlacement(part.definitionId, undefined, part.id);
                  return;
                }
                const p = structuredClone(part);
                p.id = uid();
                p.transform.position[0] += 2;
                execute({ type: "part.add", machineId: machine.id, part: p });
              }}
            >
              コピー
            </button>
            <button
              onClick={() =>
                execute({
                  type: "part.remove",
                  machineId: machine.id,
                  partId: part.id,
                })
              }
            >
              消す
            </button>
            <label>
              色
              <input
                aria-label="色"
                type="color"
                value={part.visual.color}
                onChange={(e) =>
                  execute({
                    type: "part.update",
                    machineId: machine.id,
                    partId: part.id,
                    patch: { visual: { color: e.target.value } },
                  })
                }
              />
            </label>
          </div>
        )}
        {!started && (
          <div className="welcome">
            <span className="eyebrow">HELLO, MAKER!</span>
            <h2>なにを作る？</h2>
            <p>ひらめきを、動くカタチに。</p>
            <div>
              <button onClick={() => start(true)}>
                <b>🚗</b>くるま<small>すぐに走れるよ</small>
              </button>
              <button onClick={() => start("plane")}>
                <b>✈️</b>ひこうき<small>空をめざそう</small>
              </button>
              <button onClick={() => start("boat")}>
                <b>🚤</b>ボート<small>水にうかべよう</small>
              </button>
              <button onClick={() => start(false)}>
                <b>🧱</b>じゆうにつくる<small>ゼロからはじめよう</small>
              </button>
            </div>
          </div>
        )}
        {playing && (
          <div className="drive">
            <button
              onPointerDown={() => {
                engine.current!.input.steering = 1;
              }}
              onPointerUp={() => {
                engine.current!.input.steering = 0;
              }}
              onPointerLeave={() => {
                engine.current!.input.steering = 0;
              }}
            >
              ← 左
            </button>
            <button
              onPointerDown={() => {
                engine.current!.input.throttle = 1;
              }}
              onPointerUp={() => {
                engine.current!.input.throttle = 0;
              }}
              onPointerLeave={() => {
                engine.current!.input.throttle = 0;
              }}
            >
              ↑ すすむ
            </button>
            <button
              onPointerDown={() => {
                engine.current!.input.steering = -1;
              }}
              onPointerUp={() => {
                engine.current!.input.steering = 0;
              }}
              onPointerLeave={() => {
                engine.current!.input.steering = 0;
              }}
            >
              右 →
            </button>
          </div>
        )}
      </div>
      <footer>
        <div className="footer-title">
          <span className="dot" /> {playing ? "テスト走行中" : "マシンをつくる"}
          <small>{machine?.parts.length ?? 0} パーツ</small>
        </div>
        {tab === "machine" ? (
          <EasyPalette
            onAdd={add}
            activeKind={placement?.kind}
            disabled={playing || busy || !started}
          />
        ) : (
          <div className="context-footer">
            <strong>
              {
                {
                  world: "世界をひろげよう。",
                  course: "次の冒険を描こう。",
                  assets: "お気に入りを、世界に。",
                  ai: "アイデアを一緒に。",
                }[tab]
              }
            </strong>
            <span>同じプロジェクトで、いつでもつくり直せる。</span>
          </div>
        )}
        <div className="hint">
          くるっと見回す：ドラッグ　／　近づく：スクロール{" "}
          <span>ひらめきに、限界はない。</span>
        </div>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
