# 実装進捗と完成条件

更新日: 2026-09-09。空のリポジトリから実装した。最終品質ゲートはすべてPASS。単体20件、統合6件、本番E2E9件、Smoke7件が成功した。確定結果は `evidence/quality-gates.json` と各logに保存した。

## Phase記録

| Phase | 実装内容・主な変更先                                         | Architectureへの影響               | 実行・検証                             | 残る事項・次Phase                            |
| ----- | ------------------------------------------------------------ | ---------------------------------- | -------------------------------------- | -------------------------------------------- |
| 0     | pnpm workspace、project-schema、CommandBus、設定             | 保存モデルを実行ライブラリから独立 | typecheck、model.test.ts               | Renderer／Physicsへ進む                      |
| 1     | engine-core、renderer-three、physics-rapier、Machine Compile | EngineはReactなしで起動可能        | physics.test.tsで実前進                | LEVEL 1へ進む                                |
| 2     | ui-easy、Studio初回テンプレート、Panel／Wheel自動接続        | UIはCommandへ集約                  | studio.spec.tsで空から4輪車            | 保存と実行分離へ進む                         |
| 3     | Play／Stop、localStorage、JSON入出力、独立Player             | PlayはProjectのコピーから実行      | 保存・Reload、モデル不変性             | 履歴永続化は将来。Worldへ進む                |
| 4     | world／terrain／water、6ブラシ、配置物                       | MachineとWorldを分離               | systems.test.ts、World E2E             | 高精度浮力は将来。Courseへ進む               |
| 5     | course-system、道路、ゲート、Jump、完走判定                  | 経路とWorldを分離                  | Course E2Eで実完走                     | Loop／Tunnel専用形状は未実装。Assetへ進む    |
| 6     | AssetRecord、LocalStorage、GLB Pipeline、Library             | 大きなファイルをJSONから分離       | pipelines.test.ts、Asset E2E           | 凸分解・高度最適化は将来。オンラインへ進む   |
| 7     | Poly Haven／ambientCG／Local／Kenney境界                     | 取得先障害を分離                   | providers.json、外部GLBデモ            | ambientCG ZIP変換は未実装。詳細UIへ進む      |
| 8     | ui-creator、Tree、Transform、Speed、Steering、Connection     | UIモードは表示だけを変更           | 3 LEVEL E2E                            | Sensor／Logicは将来。Studioへ進む            |
| 9     | ui-studio、Physics／Joint、World／Course、素材、統計         | 共通モデルの詳細値を露出           | 823／1.16保持、Screenshot              | 汎用Gizmo・複数Machine選択は未実装。AIへ進む |
| 10    | AI interfaces、DummyAI、Preview、承認、Mock Worker Queue     | AIもCommandのみを使用              | AI Integration／E2E、有料API呼出しなし | 実AI・Blenderは別Phase                       |
| 11    | ChunkStreamer、地形分割、GPU破棄、Rapier遅延import           | 描画Chunkと物理の境界を維持        | Chunk Unit、E2E、Buildサイズ           | 物理Streaming・LOD・Instancingは未実装       |
| 12    | 本番ビルドE2E、7種以上の画像、3デモ、README・docs・ADR       | 実装と文書を照合                   | 最終Quality Gate全項目PASS             | 下の完成条件表とKNOWN_ISSUESを確定           |

## 完成条件51の照合

要件51に対する初期マイルストーンは **COMPLETE**。これは以下の必須完成条件の判定であり、仕様全体の高度な拡張機能をすべて完成したという意味ではない。

| Requirement                                                               | Status | Evidence                                                             |
| ------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------- |
| 51.1 保存モデル独立、Command、Undo／Redo、schemaVersion、Migration        | PASS   | project-schema、command-system、tests/unit/model.test.ts             |
| 51.2 LEVEL 1 テンプレート、Panel、Wheel、接続表示、Play、運転、Stop、Save | PASS   | tests/e2e/studio.spec.ts、screenshots/01-level-1.png                 |
| 51.3 LEVEL 2 Tree、位置、Speed、Steering、Motor、Connection               | PASS   | ui-creator、tests/e2e/flows.spec.ts、screenshots/02-level-2.png      |
| 51.4 Studio Hierarchy、Inspector、Physics、World、Course、Asset Browser   | PASS   | ui-studio／ui-creator、screenshots/03-studio.png                     |
| 51.5 Terrain World、配置、保存、再読込                                    | PASS   | World／Course E2E、tests/unit/systems.test.ts                        |
| 51.6 Start、Goal、Checkpoint、Path、Jump作成と走行                        | PASS   | Course E2Eで実際に完走、screenshots/05-course-edit.png               |
| 51.7 検索→Preview→取込→保存→配置、オンライン1社＋Local、Provenance        | PASS   | Asset E2E、evidence/providers.json、demos/external-asset-record.json |
| 51.8 DummyAIのPlan、検証、Preview、承認、Command。有料APIなし             | PASS   | tests/integration/pipelines.test.ts、AI E2E                          |
| 51.9 Machine／World／Course／Assetの保存とReload                          | PASS   | 保存Integration、Course／Asset E2E                                   |
| 51.10 FPS／Draw Calls／Triangles／Rigid Bodies／Colliders                 | PASS   | Runtime Stats、screenshots/07-play-mode.png、performance.md          |
| 51.11 install、typecheck、lint、test、build、smoke、主要E2E、Console      | PASS   | evidence/quality-gates.json                                          |
| 51.12 README／docsと実装の一致                                            | PASS   | README.md、docs、KNOWN_ISSUES.md                                     |

## 達成範囲と残る作業

最低限の車制作・実走行、地形・コース制作、素材取得、ダミーAI、3段階UIは実装した。仕様全体に含まれる高度な機能まで一括して完成とは扱わない。詳細な未実装は `KNOWN_ISSUES.md` に列挙している。

次に優先するのは、物理Chunk StreamingとLOD／Instancing、Loop／Tunnelと高度なCourse編集、ZIP素材変換、センサー／ロジック／詳細マシン制御である。実AI接続は有料呼出しの承認を伴う別Phaseであり、本実装には含めない。

## 提出物

README、13種類のシステム／進捗文書、8件のADR、.env.example、単体／統合／E2E／Smoke、検証ログ、7種以上の画像、3つのデモプロジェクト、取得元つき外部素材、KNOWN_ISSUESを用意した。

## 品質ゲート結果

| チェック       | 結果 | 件数・証拠                                                         |
| -------------- | ---- | ------------------------------------------------------------------ |
| install        | PASS | frozen-lockfileで24 workspace                                      |
| typecheck      | PASS | evidence/typecheck.log                                             |
| lint／cycle    | PASS | evidence/lint.log、循環なし                                        |
| format         | PASS | evidence/format.log                                                |
| Unit           | PASS | 20件                                                               |
| Integration    | PASS | 6件                                                                |
| test           | PASS | 合計26件                                                           |
| Build          | PASS | Studio／Player／Server                                             |
| E2E            | PASS | Chromium・本番ビルド・9件                                          |
| Smoke          | PASS | 主要7件                                                            |
| Provider実通信 | PASS | Poly Haven検索・メタデータ・Rock 07取込、ambientCG検索・メタデータ |

Rapier初期化の依存ライブラリ警告、Viteの大きなWASMチャンク警告、ZodのPUREコメント警告は残る。ブラウザーの未処理例外とconsole.errorはテストの失敗条件であり、検証対象の全シナリオで発生しなかった。

外部素材デモの描画性能はSwiftShader／1280×720で20サンプルを測定し、平均27.5FPS・最小20FPSだった。これはソフトウェアGPUによる限定測定であり、大規模世界やモバイルの性能保証ではない。
