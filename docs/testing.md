# テストと検証

`pnpm install`後に`pnpm exec playwright install chromium --no-shell`でChromiumを準備します。グローバルインストールは不要です。

| 層          | コマンド                | 検証すること                                                          |
| ----------- | ----------------------- | --------------------------------------------------------------------- |
| Static      | `pnpm typecheck`        | workspace全体の型整合性                                               |
| Static      | `pnpm lint`             | ESLintと循環依存                                                      |
| Static      | `pnpm format:check`     | Prettier形式                                                          |
| Unit        | `pnpm test:unit`        | schema、Migration、Command、接続、地形、Chunk、Course、Provider正規化 |
| Integration | `pnpm test:integration` | Rapier走行、保存、Asset Pipeline、Server、DummyAI、Generation Job     |
| E2E         | `pnpm test:e2e`         | 本番ビルドをChromiumから操作                                          |
| Smoke       | `pnpm smoke`            | 主要7シナリオを1コマンドで実行                                        |
| Build       | `pnpm build`            | Studio、Player、Serverの本番出力                                      |

E2Eはポート8788に専用Serverを起動し、`.data/e2e`を使用します。既存開発Serverを再利用しません。各テストは新しいブラウザーコンテキストで実行します。GPU負荷による競合を避け、ブラウザーテストは1workerです。ソフトウェアGPUに対応するChromiumの起動引数を指定しています。

`tests/e2e/fixtures.ts`が未処理例外とconsole.errorを収集し、テストを失敗させます。ConsoleはPlaywright添付、失敗画像とTraceはtest-resultsに保存されます。必要な画面はテスト中にdocs/screenshotsへ撮影します。画像のピクセル差によるVisual Regression判定は導入していません。

指示1の基準は単体20件、統合6件、E2E9件、Smoke7件でした。指示2では既存テストを維持し、追加の単体／統合テストと2件のSmokeを加えています。今回の確定結果は[evidence/world-runtime-quality-gates.json](evidence/world-runtime-quality-gates.json)を参照してください。最終チェックの実測合否は[evidence/quality-gates.json](evidence/quality-gates.json)と各logに保存します。`node scripts/verify.mjs`でインストール、型、Lint、Format、単体、統合、全Vitest、Build、E2E、Smokeをまとめて再実行できます。

外部Provider障害はE2EのRoute Mock、Provider単体は固定応答、Asset Pipelineは自己生成GLBを使用します。有料AIはテストでも使用しません。実通信結果は[evidence/providers.json](evidence/providers.json)を参照してください。Poly Havenは検索・メタデータ・取得・GLB変換、ambientCGは検索・メタデータを確認しました。

`ALL_BROWSERS=1`でChromium／Firefox／WebKitを対象にできます。Firefox／WebKitは別途インストールが必要で、今回の検証結果には含めません。

## Panel Surface Aerodynamics

- `tests/unit/aerodynamics.test.ts`: 速度ゼロ、平行流、正負Tilt、正対時の抗力、速度二乗則。
- `tests/unit/model.test.ts`: v2 Wing→v3 Panel Migration、Panel寸法固定、厚さと質量の連動。
- `tests/unit/placement.test.ts`: Panel Edge-to-Edge接続と`part.tilt`後のAttachment Point保持。
- `tests/integration/physics.test.ts`: Panelを含む剛体の実Rapier走行、Thrusterの継続推力、既存Wheel回帰。

Play中は各PanelのWorld CenterでPoint Velocityを取得し、Panelごとに`addForceAtPoint`します。Motorは明示的なHinge接続がない限りWheel出力へ影響しません。

## シナリオと証拠

- LEVEL 1: 空からPanel＋Wheel×4、Play、保存、Reload。`tests/e2e/studio.spec.ts`。
- 3 LEVEL: Speed変更、motorTorque=823、friction=1.16、LEVEL 1へ復帰して保存・Reload。`tests/e2e/flows.spec.ts`。
- World／Course: 地形編集、木、道路、Start、Checkpoint、Jump、Goal。実際に走行して完走。
- Asset: 検索、Preview、取得、配置、GLB配信、再読込。外部素材デモも描画。
- 障害: Provider不調後にLocalへ復帰、壊れた保存ファイルから新規作成。
- AI: プレビュー中は変更なし、承認後に変更、Undoで全体復元、生成Job完了。
- Player: エディターなしの本番ページを起動しPlay。

`tests/fixtures`にminimal-project、simple-car、island-world、simple-course、sample-assets、broken-project、old-schema-projectを保存しています。

## 指示2の追加検証

- `tests/unit/world-runtime.test.ts`: 旧3デモのMigration／Round-trip、Course Undo／Redo、ロード先行とヒステリシス、500個のInstancingとRaycaster選択、LOD距離、Collider Source共有、Runtime予算、展開後サイズの事前制限。
- `tests/integration/world-streaming.test.ts`: 実Rapierで1024m地形・900物体を往復しCollider数を確認。境界通過中の落下を毎Step検査。選択外CourseのCollider除外。
- `tests/integration/runtime-pipeline.test.ts`: Original完全一致、三段階LODを実GLTFLoader＋MeshoptDecoderで読込、三角形数とサイズ削減、Texture縮小、5MiB超Binary Upload、各安全上限、Storage回収、Hull／Trimesh／破損Box、非同期Stop、退化Hull。
- `tests/e2e/world-runtime.spec.ts`: 大量岩の本番描画、B選択→保存→Reload→完走、実圧縮GLBとWebP、実表示中のLOD段階、Trimeshの坂道上での実走。

`node scripts/world-benchmark.mjs after`は本番ビルドから再測定します。Beforeは元コミット`bc77656`の別worktreeで同じスクリプトを実行しました。フィクスチャは`tests/fixtures/benchmark-world.json`、結果はperformance-before／after.jsonです。詳しい条件と限界は[performance.md](performance.md)を参照してください。

## 指示3のPlacement検証

変更前の基準はUnit 28件、Integration 19件、E2E 11件の成功です。`feat/world-runtime-foundations`の取得済み最新`04d34f0`から、作業ブランチ`feat/machine-placement-system`で実装しました。

- Unit：4→3→0候補、純粋性、Move／Rotate／Scale、互換性、旧Connector補完、全8種の配置、接続木、回転軸、Undo／Redo。
- Integration：候補から組み立てた4輪車の実Rapier走行、編集モデル不変、保存復元。
- E2E：3D候補クリック、配置後の消去と選択、回転／つけ直しのUndo、取消、コピー、全パーツ、詳細値保持、ドラッグ誤配置防止、キーボード、タッチ。
- Placement Smoke：空からPanel＋4輪を配置し、候補の減少、選択、回転、つけ直し、Undo／Redo、前進、Save／Reloadまで自動確認。

`pnpm test:e2e tests/e2e/placement.spec.ts`で配置シナリオだけを実行できます。最終合否と件数は[evidence/placement-quality-gates.json](evidence/placement-quality-gates.json)、完成条件と画像は[配置の実装報告](placement-report.md)にまとめています。スクリーンショット3枚は実際に目視確認済みです。Chromiumのタッチエミュレーションを含みますが、実モバイル端末の性能保証ではありません。
