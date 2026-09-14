# Observability（AI観測・再現・検証基盤）

## 全体 Architecture

既存の `RuntimeTelemetry`（`MachineTelemetrySample`）を置換せず、その上位に共通観測基盤を載せます。

```text
既存 RuntimeTelemetry / Diagnostics / stats
        ↓ emit / bridge
ObservationHub（Memory Ring Buffer）
        ↓ Run 終了時 export
.observability/runs/<runId>/
        ↓
pnpm observe（CLI） / window.__MACHINE_STUDIO_AGENT__
```

情報は次の4種類に分けます。

| 種別     | 意味         | 例                            |
| -------- | ------------ | ----------------------------- |
| State    | 連続状態     | `physics.machine.sample`      |
| Event    | 瞬間イベント | `world.chunk.committed`       |
| Metric   | 数値計測     | `renderer.frame`              |
| Artifact | 大きな成果物 | screenshot / Playwright trace |

## Run 構造

```text
.observability/runs/<runId>/
  manifest.json
  events.jsonl
  metrics.jsonl
  states.jsonl
  summary.json
  artifacts/
    screenshots/
    playwright/
```

- `.observability/` … 生の実験結果（Git 管理外）
- `docs/evidence/` … 人間が採用した比較結果・証拠（従来どおり）

## Schema

- `ObservationRunManifest`（schemaVersion: 1）
- `TelemetryEvent`（runId / timestampMs / source / type / name / data）

主要イベント名:

```text
engine.play.started / engine.play.stopped / engine.respawn
input.changed
physics.machine.sample
world.chunk.queued / ready / committed
world.origin.rebase.started / completed
world.streaming.stats
renderer.frame
camera.follow.mode_changed
diagnostic.frame.spike / diagnostic.turn.verdict
test.assertion.passed / failed
```

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
pnpm observe explain <runId|latest>
```
pnpm observe scenarios|run|summary|query|frame|compare|explain
JSON専用: pnpm --silent observe ... --json

`--json` 時は stdout が JSON のみ（診断は stderr）。
`pnpm` のスクリプト見出しを避けたい場合は `pnpm --silent observe ... --json` を使う。

## Run / Compare 例

```
runId: starter-plane-turn-left-mu1e0r1j-22894828
pnpm --silent observe summary latest --json
pnpm --silent observe query latest --name diagnostic.frame.spike --json
pnpm --silent observe explain latest --json
pnpm --silent observe compare <RUN1> <RUN2> --json
```

## Browser Agent API

開発・テスト、または `?agent=1` / `?observe=1` のときだけ:

```ts
window.__MACHINE_STUDIO_AGENT__;
```

読み取り中心。許可操作は scenario reset / observation begin・end / assertion記録などに限定。

## Scenario

定義は `packages/runtime-telemetry/src/scenarios.ts` に単一管理し、CLI / Playwright / Agent API が共有します。

必須11件:

1. starter-plane-straight
2. starter-plane-takeoff
3. starter-plane-turn-left
4. starter-plane-turn-right
5. world-streaming-forward
6. world-streaming-fast-flight
7. world-streaming-turn
8. origin-rebase-200m
9. origin-rebase-flight
10. camera-follow-turn
11. terrain-entry

## Artifact

Scenario 開始・重要 Event・Assertion failure・大きな Spike・終了時に Artifact を紐付け可能です。Playwright trace は必要に応じて `artifacts/playwright/` へ配置します。

## Performance への配慮

- ホットパスでは Ring Buffer push のみ
- 同期ファイル書き込みなし
- Run 終了時にまとめて export
- 無制限 array push / 毎フレーム JSON.stringify を避ける

## 既存診断との関係（Migration）

| 旧                                        | 新                                               |
| ----------------------------------------- | ------------------------------------------------ |
| RuntimeTelemetry / MachineTelemetrySample | 維持。必要時 `physics.machine.sample` へブリッジ |
| FrameProfiler                             | 維持。`renderer.frame` metric にも集約           |
| SpikeDiagnostics                          | 維持。`diagnostic.frame.spike` + AnomalyWindow   |
| TurnMotionDiagnostics                     | 維持。`diagnostic.turn.verdict`                  |
| CameraFollowToggleLog                     | 維持。`camera.follow.*`                          |
| WorldRuntime.stats / debugEvents          | 維持。`world.streaming.stats` / `world.chunk.*`  |
| Origin Rebase 計測                        | 維持。`world.origin.rebase.*`                    |
| Renderer stats / GPU timer                | 維持。Agent state / `renderer.frame`             |
| docs/evidence 直書き probe                | 残存（互換）。新規 Run は `.observability/runs`  |
| Playwright assertion                      | `test.assertion.passed/failed`                   |

既存 probe・HUD・テストは削除していません。

## 残制約

- 通常の `pnpm observe run` はPlaywright上の実Studioを実行し、Camera/Renderer/RAF/Workerを記録する
- `--mode=simulation` は高速なNode物理診断であり、RAF/Renderer/Cameraの実測値を生成しない
- Production では Agent API 非公開（明示 flag / 開発時のみ）
- docs/evidence 既存 probe は互換のため残存（新規は .observability/runs）