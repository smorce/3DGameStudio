# Machine Studio を実装する

## Purpose / Big Picture

空のリポジトリから、板とタイヤを組み立ててすぐ走らせられるブラウザスタジオを作る。3段階の画面を切り替えても同じ保存データを保持する。本書は PLANS.md の実行計画形式に従い更新する。

## Progress

- [x] 2026-09-08: 仕様・既存ファイルを確認。既存コードなし。
- [x] 2026-09-09: Phase 0–3: 保存モデル、コマンド、描画、物理、簡単画面、永続化と車走行検証。
- [x] 2026-09-09: Phase 4–7: 地形、コース、アセット取込とオンラインプロバイダー。
- [x] 2026-09-09: Phase 8–11: 詳細画面、Studio、ダミーAI、チャンク管理。
- [x] 2026-09-09: Phase 12: 品質ゲート、スクリーンショット、文書、要件照合。

## Surprises & Discoveries

既存 PLANS.md は実行計画の作成規則であり、実装計画自体ではなかった。内容を保持し、本書を追加した。

2026-09-09: ポート5173には他のアプリが存在したため、Studioは5183とstrictPortを採用した。E2Eは本番ビルドを8788で起動し既存Serverを再利用しない。Headless Shellのダウンロードがタイムアウトしたため、取得できた通常Chromiumをheadlessで使用した。

外部フォントのロード待ちでE2Eのpage.gotoが遅延したため、フォントの外部取得を除去した。Poly HavenへのNode標準fetchの接続失敗に対して、IPv4のHTTPS transportと取得期限を導入し、Rock 07の実取込まで成功した。

接続解除した部品が複合剛体へ残る初期問題を、固定接続グループごとのCompileに変更して修正した。Unit／Integration26件と本番E2E9件で検証した。

## Decision Log

2026-09-08: pnpm workspace と TypeScript を使用。Python依存が必要になった場合のみ uv で局所環境を作る。グローバルインストールは行わない。

2026-09-08: 編集操作は検証付き CommandBus に集約し、Undo は適用前後のモデルスナップショットで実装する。JSON化可能なコマンドをAI・全UIで共有する。固定部品は複合剛体、車輪は Rapier 車両コントローラーで接地・サスペンションを計算する。

## Outcomes & Retrospective

車の制作→走行→保存、コース完走、Asset取込と配置、ダミーAI承認、3 LEVEL保持が動作した。固定部品の複合化、描画Chunkの破棄、Rapierの遅延importも追加した。主要E2E9件が成功し、3つのデモと8種類の画面画像を保存した。最終品質ゲートはすべてPASS。確定結果を docs/evidence/quality-gates.json に記録した。要件51の初期マイルストーンをCOMPLETEと判定する。高度な未実装を KNOWN_ISSUES.md に分離し、初期マイルストーンと仕様全体の達成を混同しない。

## Context and Orientation

apps/studio がReact画面、apps/player が独立実行画面、apps/server がアセット取得API。packages/project-schema のデータ定義は Three.js と Rapier に依存しない。packages/command-system が履歴付き変更窓口。engine-core は純粋データを受け取り、描画・物理の各アダプターへ渡す。

## Plan of Work

まず schema と CommandBus を作り単体テストで Undo と無効入力拒否を確認する。次に compiler と Rapier、Three アダプターを追加し車の入力・接地・前進を統合テストする。簡単画面と保存をつなぎブラウザで操作する。続いて world/course/asset のモデル操作、server の取得・検証・保存、詳細UI、AIのプレビューと承認を追加する。

## Concrete Steps

ルートで pnpm install、pnpm test:unit、pnpm test:integration、pnpm dev を実行する。http://localhost:5183 で「くるま」を選び、板とタイヤを追加し「あそぶ」で走行できることを確認する。実装後に pnpm typecheck、pnpm lint、pnpm format:check、pnpm build、pnpm test:e2e、pnpm smoke を実行する。

## Validation and Acceptance

車の走行前後で位置が変わり、停止後に編集データが変化しないこと。UIモードを切り替えても motorTorque=823 と friction=1.16 が保持されること。地形・コース・アセットを含む保存データが再読込できること。失敗した外部Providerがローカル操作を阻害しないこと。要件51を個別に照合し証拠を docs/progress.md に記す。

## Idempotence and Recovery

依存導入は pnpm install で再実行可能。取込データは .data 内に隔離し原本を保持する。読み込みは検証してから置き換え、失敗しても既存プロジェクトを保持する。

## Artifacts and Notes

スクリーンショットは docs/screenshots に保存。tests/fixtures と demos に再利用可能なJSONを置く。

## Interfaces and Dependencies

Project はJSONのみ。CommandBus.execute(command)、undo()、redo() で編集する。Engine(canvas) は load(project)、play()、stop()、dispose() を公開しReactへ依存しない。AssetProvider と AssetStorage は非同期の検索・取得・保存境界。AIProvider は型付きPlanを返し実APIを使わない。

更新: 2026-09-09。実装済みPhase、実通信・本番E2Eの発見、残る機能の範囲を反映した。
