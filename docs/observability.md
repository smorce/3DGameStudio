# Observability（AI観測・再現・検証基盤）

既存の `RuntimeTelemetry`（`MachineTelemetrySample`）を置換せず、その上位に共通観測基盤を載せます。`pnpm observe` と `window.__MACHINE_STUDIO_AGENT__` から、同じ Scenario を再現・観測・比較できます。

## 全体 Architecture

```text
既存 RuntimeTelemetry / FrameProfiler / SpikeDiagnostics / WorldRuntime / GPU samples
        ↓ Engine PLAY ループで bridge
ObservationHub（Memory Ring Buffer・同期 I/O なし）
        ↓ Run 終了時 / 失敗時に export
.observability/runs/<runId>/
        ↓
pnpm observe（CLI） / window.__MACHINE_STUDIO_AGENT__
```

| 層 | 役割 | 主なパス |
| --- | --- | --- |
| Hub | emit / spike / AnomalyWindow | `packages/runtime-telemetry/src/observation-hub.ts` |
| Schema / Summary / Query / Scenario | 共通型・集約・比較・説明 | `packages/runtime-telemetry/src/` |
| Engine bridge | RAF ごとに metric / state | `packages/engine-core/src/index.ts` |
| Agent API | `window.__MACHINE_STUDIO_AGENT__` | `packages/engine-core/src/agent-observation.ts` |
| Browser Runner | Playwright + Agent | `scripts/observe/browser-runner.ts` |
| Simulation Runner | Node + Rapier（高速） | `scripts/observe/runner.ts` |
| Persist | Run ディレクトリ書き出し | `scripts/observe/storage.ts` |
| CLI | 入口 | `scripts/observe/cli.ts` |

情報は次の種別に分けます（`TelemetryEventType`）。

| 種別 | 意味 | 例 |
| --- | --- | --- |
| State | 連続状態 | `physics.machine.sample` |
| Event | 瞬間イベント | `world.chunk.committed` |
| Metric | 数値計測 | `renderer.frame` |
| Assertion | 判定結果 | `test.assertion.passed` / `failed` |
| Artifact | 大きな成果物 | screenshot / Playwright trace |

## Run 構造

```text
.observability/runs/<runId>/
  manifest.json
  events.jsonl          # 全イベント
  metrics.jsonl         # type===metric
  states.jsonl          # type===state
  summary.json
  latest-pointer.json
  artifacts/
    screenshots/        # final.png または error.png
    playwright/         # trace.zip
.observability/runs/LATEST
```

- `.observability/` … 生の実験結果（Git 管理外）
- `docs/evidence/` … 人間が採用した比較結果・証拠（従来どおり・互換のため残存）

### 成功時 / 失敗時

| 結果 | Browser | Simulation |
| --- | --- | --- |
| `pass` / `fail` | `final.png` + `trace.zip` + events / summary | events / summary（artifact なし） |
| `error` | 可能な範囲で `error.png` + `trace.zip` + events / summary。ページ未生成時は `browser.uncaught_error` を合成して保存 | events / summary（`result: error`） |

失敗時こそ証拠を残す方針です。ブラウザ実行が例外になっても `writeObservationRun()` まで実行します。

## Schema

- `ObservationRunManifest`（schemaVersion: 1）
- `TelemetryEvent`（runId / timestampMs / source / type / name / data）
- `ObservationRunSummary`（frame / gpu / spikes / streaming / assertions など）

主要イベント名:

```text
engine.play.started / engine.play.stopped / engine.respawn
input.changed
physics.machine.sample
world.chunk.queued / ready / committed
world.origin.rebase.started / completed
world.streaming.stats
renderer.frame
renderer.resource.changed
camera.follow.sample / mode_changed / verdict
diagnostic.frame.spike / diagnostic.turn.verdict
browser.pageerror / browser.console_error / browser.uncaught_error
simulation.step                    # --mode=simulation のみ
test.assertion.passed / failed
```

## サンプリング（観測オーバーヘッド削減）

ホットパスは Ring Buffer push のみです。Browser Engine では次のように間引きます。

| イベント | 間引き |
| --- | --- |
| `renderer.frame` | 毎 Frame（`gpuMs` 付き） |
| `physics.machine.sample` | Scenario の `sampleEverySteps`（既定 5） |
| `world.streaming.stats` | 8 Frame ごと |
| `camera.follow.sample` | `camera` タグ Scenario は毎 Frame、それ以外は 5 Frame ごと |
| `renderer.resource.changed` | 30 Frame ごと |
| `input.changed` | Control 値の差分時のみ（毎 Frame の `JSON.stringify` なし） |

Scenario 別 `sampleEverySteps`:

- `5` … starter-plane-* / camera-follow-turn / terrain-entry
- `10` … world-streaming-*
- `15` … origin-rebase-*

Simulation は `renderer.frame` / camera / 実 GPU を出さず、`simulation.step` と間引き済みの machine / streaming を記録します。

## GPU timing → Summary

1. Renderer の最新有効 GPU Sample（`gpuMs`）
2. `ObservationHub.recordFrameTiming({ gpuMs })` → `renderer.frame` metric
3. `buildRunSummary` が `summary.gpu.{p50,p95,max}` に集約
4. Agent `getState().renderer.gpuTimingMs` も同じ `gpuMs`（壁時計ではない）

Simulation では `renderer.frame` が無いため `summary.gpu` は空です。SwiftShader 環境では GPU 実測が薄い / 0 になり得ます。

## CLI

```bash
pnpm observe scenarios
pnpm observe run <scenario>
pnpm observe run <scenario> --mode=simulation
pnpm observe run <scenario> --app=player
pnpm observe summary <runId|latest>
pnpm observe query <runId|latest> --name diagnostic.frame.spike
pnpm observe frame <runId|latest> <frame>
pnpm observe compare <before> <after>
pnpm observe compare <before> <after> --force
pnpm observe explain <runId|latest>
```

| フラグ | 意味 |
| --- | --- |
| `--mode=browser`（既定） | Playwright で実 Studio / Player を実行 |
| `--mode=simulation` | Node 物理診断。manifest の `environment.mode` は `"node"` |
| `--app=studio`（既定） / `--app=player` | 起動アプリ |
| `--json` | stdout は JSON のみ（診断は stderr） |
| `--force` | compare で条件不一致でも続行 |

`pnpm` のスクリプト見出しを避けたい場合は `pnpm --silent observe ... --json` を使います。  
ベース URL は `OBSERVE_BASE_URL`（未指定時 studio `5183` / player `5184`）。

### Run / Compare 例

```bash
pnpm observe run starter-plane-turn-left
pnpm --silent observe summary latest --json
pnpm --silent observe query latest --name diagnostic.frame.spike --json
pnpm --silent observe explain latest --json
pnpm --silent observe compare <RUN1> <RUN2> --json
```

`compare` は Scenario ID / 定義 Hash / seed / mode / app / viewport / devicePixelRatio が一致しないと拒否します（`--force` で続行可）。deltas は frame p50/95/99/max、spikes、physics/render/gpu max、streaming、drawCalls、triangles、rebase、assertions などです。

`explain` は直近 spike 近傍の内訳（commit / render / physics）と rebase・failed assertion から suspect を並べます。

## Browser Agent API

次のいずれかで公開されます。

- `?agent=1` / `?observe=1`
- `MACHINE_STUDIO_AGENT=1` / `VITE_MACHINE_STUDIO_AGENT=1`
- `development` / `test` MODE

```ts
window.__MACHINE_STUDIO_AGENT__;
```

主な API:

| method | 内容 |
| --- | --- |
| `getState()` | engine / machine / camera / world / renderer / frame |
| `getPhysicsStep()` | 現在の Physics Step |
| `getTelemetrySummary()` | runId / eventCount / spikeCount / anomalyWindows |
| `queryRecent(filter?)` | 直近イベント（default 200） |
| `getEvents()` | Hub 全件 |
| `recordAssertion(...)` | assertion 記録 |
| `recordBrowserError(name, message, detail?)` | Hub `emitError`（fingerprint 重複抑制） |
| `listScenarios()` / `getRunInfo()` | Scenario / Manifest |
| `resetScenario()` | respawn |
| `beginObservation(scenarioId?)` / `endObservation(result?)` | Run 開始・終了 |

読み取り中心です。許可操作は scenario reset / observation begin・end / assertion・browser error 記録に限定します。

## Physics Step 基準の入力切替

Browser Runner の Timeline は壁時計待機ではなく、Physics Step 境界でキーを切り替えます。

```text
キー入力適用
↓
physicsStep >= segment.toStep まで待機（getPhysicsStep）
↓
次セグメント
```

同じ seed・同じ初期状態・同じ Physics Step で同じ入力を再現できます。  
検知は Playwright 側のため、極重い Frame では切替が数 Step 遅れる可能性があります。

## Browser Error の接続

```text
page.on("pageerror")  → browser.pageerror
page.on("console") error → browser.console_error
runner catch          → browser.uncaught_error
```

いずれも Agent の `recordBrowserError()` → Hub `emitError()`（fingerprint 最大 3 回）へ入ります。

## Scenario

定義は `packages/runtime-telemetry/src/scenarios.ts` に単一管理し、CLI / Playwright / Agent API が共有します。

定義フィールド: `id`, `description`, `seed`, `tags`, `durationSteps`, `worldPreset`, `enableWorldRuntime`, `sampleEverySteps`, `timeline`, `assertions`

必須 11 件:

1. `starter-plane-straight`
2. `starter-plane-takeoff`
3. `starter-plane-turn-left`
4. `starter-plane-turn-right`
5. `world-streaming-forward`
6. `world-streaming-fast-flight`
7. `world-streaming-turn`
8. `origin-rebase-200m`
9. `origin-rebase-flight`
10. `camera-follow-turn`
11. `terrain-entry`

通常 CI 向けに `tests/e2e/observation-agent.spec.ts` の `@smoke` で、11 Scenario を短縮実行（最大 90 Physics Step）します。完全長は `pnpm observe run`（nightly / manual）を想定します。

E2E での Project 投入は `about:blank` 上の `localStorage` を使わず、browser-runner と同様に `addInitScript` で HTTP オリジンへ投入します。

## Player の観測モード

Player（`apps/player/src/main.ts`）は `?agent=1` または `?observe=1` のときだけ `loadProject(localStorage)` を読みます。通常起動では既定の Starter Project を使い、観測基盤が Production Player の挙動を変えません。

## Artifact

現行の実運用では、Scenario **終了時**または**エラー時**に screenshot と Playwright trace を Run へ保存します。途中 Event / Spike 単位での Artifact 紐付けは未実装です。

## Performance への配慮

- ホットパスでは Ring Buffer push のみ
- 同期ファイル書き込みなし
- Run 終了時（または失敗時）にまとめて export
- 無制限 array push / 毎 Frame の `JSON.stringify` を避ける
- Hub capacity: Agent 約 30k / Simulation 約 12k（溢れ時は古いイベントが落ちる）

## 既存診断との関係（Migration）

| 旧 | 新 |
| --- | --- |
| RuntimeTelemetry / MachineTelemetrySample | 維持。必要時 `physics.machine.sample` へブリッジ |
| FrameProfiler | 維持。`renderer.frame` metric にも集約 |
| SpikeDiagnostics | 維持。`diagnostic.frame.spike` + AnomalyWindow |
| TurnMotionDiagnostics | 維持。`diagnostic.turn.verdict` |
| CameraFollowToggleLog | 維持。`camera.follow.mode_changed` / `verdict` / `sample` |
| WorldRuntime.stats / debugEvents | 維持。`world.streaming.stats` / `world.chunk.*` |
| Origin Rebase 計測 | 維持。`world.origin.rebase.*` |
| Renderer stats / GPU timer | 維持。Agent state / `renderer.frame.gpuMs` → `summary.gpu` |
| docs/evidence 直書き probe | 残存（互換）。新規 Run は `.observability/runs` |
| Playwright assertion | `test.assertion.passed` / `failed` |

既存 probe・HUD・テストは削除していません。

## 残制約

- 通常の `pnpm observe run` は Playwright 上の実 Studio / Player を実行し、Camera / Renderer / RAF / Worker を記録する
- `--mode=simulation` は高速な Node 物理診断であり、RAF / Renderer / Camera / 実 GPU の実測値を生成しない（manifest mode は `"node"`）
- Production では Agent API 非公開（明示 flag / 開発・テスト時のみ）
- docs/evidence 既存 probe は互換のため残存（新規は `.observability/runs`）
- Physics Step 同期は Playwright 検知方式のため、極重い Frame では切替が数 Step 遅れる可能性がある
- Playwright のサンドボックスキャッシュが空を指す場合は `AGENTS.md` の手順で既存 Chromium キャッシュへ繋ぐ
