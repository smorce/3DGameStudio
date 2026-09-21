# 指示17レビュー対応とE2E失敗の修正

対象ブランチ：`feat/world-generation-asset-factory`。初期実装`8c068fd`への追加修正です。

## 失敗4件の原因と対応

| テスト                    | 原因                                                                                                           | 修正                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| spike-flight-diagnostics  | テストが保存した計測JSONを、終了ボタンの別時点の診断保存が上書きしていた                                       | テスト専用出力先へ分離し、保存値とsummaryの完全一致を維持                     |
| spike-prewarm-diagnostics | 終了時の保存・ダイアログ・DROPが完了する前に次の画面へ移動していた                                             | 「あそぶ」が再度有効になるまで待機                                            |
| world-runtime             | `compileAsync`が参照中のMaterialを通常フレームのStreamingが破棄し、Three.jsの`program.isReady()`で例外になった | 描画準備中は通常描画を停止し、reload・編集Pose復元・disposeを準備終了まで延期 |
| runtime-stability         | 飛行中の機体座標とShadow座標を別々のブラウザ呼出しで取得し、異なる時刻の値を比較していた                       | 同じDOM snapshotから両方を取得。距離8m未満の基準は維持                        |

初期報告のspike-flight「浮動小数点の完全一致」は失敗の表れであり、根本原因ではありませんでした。許容誤差を増やす対応はしていません。テスト削除・skipもしていません。ブラウザ例外の監視はstackを保存するよう改善しています。

## WorkerのDesign更新

constructor/reload境界で`fingerprint({ generatorVersion, worldDesign })`を計算します。内容が変化した場合だけDesign snapshotを作り、全Workerへcontextを送ります。Jobには同じhashを渡すためChunkごとにDesignを走査・複製しません。Workerの再生成時も次のJob前に必要なcontextを送ります。

Main Threadの高さSamplerとSpline cacheもsnapshotへ切り替えるため、Workerだけ更新されてMain Threadに古い道路が残ることも避けます。旧generationの完了・取消コールバックが新generationのpending状態を書き換えないようにしました。

回帰テストは、構造化コピーとFIFOを再現したWorker経路／同期fallbackの両方で、同一Design参照の道幅・道路高度変更→reload→地形変化を確認します。変更なしのreloadでcontextを再送せず、generatorVersion変更では全Workerへ再送することも検査します。実ブラウザのWorker生成はtoy-islands E2Eで確認します。

## Settlementの建物

Schemaを`buildingRules: [{ assetSlot, count, minSpacing }]`へ変更しました。町全体でseed付きcell候補を作り、必要数を配置してから各Chunkへ分配します。町の地形平坦化・自然PropのNo-Spawn・Town Maskを維持し、町の建物だけ自身のTown Maskを除外します。明示No-Spawn、滑走路、水、急斜面、道路、Landmark、他の建物との間隔は検査します。

Planner、Catalog、Validatorへ接続し、配置可能数が不足した場合は`settlement-building-count`エラーにします。探索上限は1 Ruleあたり10万cell、要求数上限は256棟です。toy-islands Design v2では8棟・間隔12mとし、重複するLandmarkの家を削除しました。

テストは8棟、重複IDなし、間隔、地表高度、読込順非依存、seed差、Planner要求、No-Spawn、配置不能時のValidatorエラーを確認します。実E2EでもWorker生成された8棟すべてのAsset解決を検査します。

## Schema v7

`CURRENT_SCHEMA_VERSION = 7`へ更新しました。旧v0–v6の読み込みと、v7の保存・再読込を検証します。v6は基本データを維持し、旧Settlement.assetSlotを1棟のbuildingRuleへ変換します。同じ中心・SlotのLandmarkがある場合は空Ruleとして既存の家を保持し、二重生成しません。

Designを変換した場合のみ旧Build Manifestを無効化し、再Bakeします。有限WorldやDesign変換のないProjectの情報は保持します。Asset原本、Texture情報、編集差分、Tombstoneを再処理・削除しません。現在用意しているデモは、新しい8棟のDesignへ明示更新しています。

## 画風metadataと今後の改善

未審査の取得Assetには`style=unverified`、`styleAssessment=unverified`を保存し、要求画風は`requestedStyle`へ分けました。Factoryは`reviewRequired`として返し、stylized-low-polyの必要数には含めません。ローカルPackの明示レビュー済みmetadataだけを引き継ぎ、外部Providerの申告だけでは審査済みにしません。Dummyは`styleAssessment=dummy`と区別します。回帰テストで、外部取得素材に画風を確定付与せずDummyで不足を補うことを検証します。

geometry/texture/materialの自動画風審査・変換、自然PropのSpatial Hash化、Biome別の地表paletteは今後の改善項目です。今回のデモ準備はofflineで行い、外部Asset取得や課金AI通信は実行していません。ambientCGのPBR ZIPは引き続きTexture Asset／Renderer unsupportedとして扱います。

## 検証・起動

- `pnpm typecheck`、`pnpm lint`、循環依存検査：成功。
- `pnpm test`：40ファイル・291件成功。
- `pnpm test:e2e`：34件成功、失敗0。削除・skipなし。
- Studio / Player / Server build：成功（PlaywrightのwebServer起動時に実行）。
- `pnpm asset:factory -- --mode=offline`：28 Asset、不足・追加登録・エラー0。
- `pnpm world:bake`：1,190 Entity、Validatorのerror/warning 0、Manifest生成・検証成功。

既存3プリセットは各100 Chunkの高度・色・Entity・hashがベースと完全一致。新toy-islandsはNode同期計測でp50約2.02ms、p95約2.32msです。WebGLのフレーム性能を示す値ではありません。

`pnpm dev`を起動済みです。Studioは http://localhost:5183/ 、APIは8787番です。「おもちゃの群島」から読み込めます。APIからSchema v7、5島、8棟のbuildingRule、28 Asset、28 Assetを固定したManifestを確認しました。保存先は`.data/worlds/toy-islands.json`、更新前のバックアップは`.data/worlds/toy-islands-before-v7.json`です。

`pnpm smoke`も19件成功、失敗0でした。元の失敗4件はすべて修正・再検証済みとしてクローズします。最終集計は[検証JSON](evidence/world-generation-checks.json)にも保存しています。
