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

現在の機能テストは単体20件、統合6件、E2E9件、Smoke7件です。全Quality GateはPASSしました。最終チェックの実測合否は[evidence/quality-gates.json](evidence/quality-gates.json)と各logに保存します。`node scripts/verify.mjs`でインストール、型、Lint、Format、単体、統合、全Vitest、Build、E2E、Smokeをまとめて再実行できます。

外部Provider障害はE2EのRoute Mock、Provider単体は固定応答、Asset Pipelineは自己生成GLBを使用します。有料AIはテストでも使用しません。実通信結果は[evidence/providers.json](evidence/providers.json)を参照してください。Poly Havenは検索・メタデータ・取得・GLB変換、ambientCGは検索・メタデータを確認しました。

`ALL_BROWSERS=1`でChromium／Firefox／WebKitを対象にできます。Firefox／WebKitは別途インストールが必要で、今回の検証結果には含めません。

## シナリオと証拠

- LEVEL 1: 空からPanel＋Wheel×4、Play、保存、Reload。`tests/e2e/studio.spec.ts`。
- 3 LEVEL: Speed変更、motorTorque=823、friction=1.16、LEVEL 1へ復帰して保存・Reload。`tests/e2e/flows.spec.ts`。
- World／Course: 地形編集、木、道路、Start、Checkpoint、Jump、Goal。実際に走行して完走。
- Asset: 検索、Preview、取得、配置、GLB配信、再読込。外部素材デモも描画。
- 障害: Provider不調後にLocalへ復帰、壊れた保存ファイルから新規作成。
- AI: プレビュー中は変更なし、承認後に変更、Undoで全体復元、生成Job完了。
- Player: エディターなしの本番ページを起動しPlay。

`tests/fixtures`にminimal-project、simple-car、island-world、simple-course、sample-assets、broken-project、old-schema-projectを保存しています。
