# 指示18 実装・検証報告

レビュー指摘への対応は[追補報告](sample-worlds-review.md)を参照してください。以下の数値は初回実装時の記録です。

基準HEAD: `333a736`（`ba2609a`の後続）。作業ブランチ: `feat/sample-world-catalog`。

## 実装した構造

- `packages/sample-worlds`にCatalogと8ワールドのContentを分離。初回実装ではCatalogとBuilderを同一入口で公開。追補で表示専用MetadataとBuilderを分離。
- World Generatorには汎用`designed-world`を1種類追加。草原・飛行場・旧群島の生成経路を維持。
- World Design→Semantic Layers→Asset Slot→Asset Catalogの経路を維持し、`GET /api/worlds`と`GET /api/worlds/:id`へ一般化。IDはCatalogのallowlistで検証。
- StudioはCatalogのメタデータから8カードと推奨Machineを表示。「じゆうにつくる」は別枠。
- `demos/worlds`の8 Prepared Projectと`demos/sample-worlds`の共有libraryを同梱。空data directoryでも手動Factoryなしで開始可能。

8ワールドのID・Machine・Biome・山・道路・Landmark・Courseは[ワールド一覧](sample-worlds.md#8ワールド)を参照してください。砂漠はサボテンと砂色、雪山は雪線と針葉樹、南国はヤシと明るい砂浜を備えます。遠景ProxyにもBiome色を反映します。

## 永続データ・互換性

既存HEADのSchema v7、World Design v2、v6 Settlement.assetSlot→buildingRules移行と、Worker Contextのfingerprint/snapshot更新を継承しました。これらを重複実装せず、既存の同一参照mutate→reloadテストとMigrationテストを実行しています。

新しい永続フィールドは`Road.closed`、Settlement ruleの`minDistanceFromRoad`・`scaleRange`・`rotationMode`、Manifestの`biomeProfileVersion`です。optionalフィールドを省略した旧Worldは従来の既定動作で読み込めます。

Biome Profileは方式A、**Manifestにv1を固定**。temperate / grassland / tropical / alpine / desert / snowを共有します。雪線はsnow=24m、alpine=78m。旧DesignのManifest省略時はv1です。v1は将来も変更せず、新版を追加する方針です。

閉道路はCatmull-Romの前後の制御点を循環参照し、閉辺の長さもサンプル数に含めます。位置と接線、absolute/terrain両モードのConform、Chunk共有辺を検証しています。

Settlementは既存の決定的配置に道路距離・縮尺・回転指定を追加しました。建物数・間隔・No-Spawn・道路・滑走路・Spawn周辺を検証します。CourseはStart・Goal・Checkpoints・Respawnの座標を検証します。船の海上Spawnは呼出側から`spawnSurface: water`を指定し、GeneratorにMachine種別を持たせません。

旧grassland / airfield / archipelagoは、`333a736`から採取した9Chunkの地形・色・Prop全体のSHA-256が一致する回帰テストを追加しました。

## 共有Assetと準備

15 Slot、45 Asset Record、14種類のRuntime GLB、105論理参照です。Original・Runtime・LOD・ColliderをすべてSHA-256名で共有し、World別の実ファイル複製はありません。validateでは参照ファイルの存在・ファイル名hash・Catalogのruntime hashを確認します。

Dummy Requirement PlannerはLandmarkとSettlementのBiomeも取得し、全Sampleのunionを作ります。既存offline Factory→Processor→Catalogを通し、Demo用Primitive生成をDummy Generatorのオプションとして追加しました。同一SlotのvariantはIDを分けた共通形状です。

```bash
pnpm sample-worlds:prepare
pnpm sample-worlds:validate
```

準備を2回連続で行い、全Prepared Project・共有library・実ファイルのSHA-256が一致しました。マシンのPart IDだけでなく、UUIDを含む複合Joint IDと参照も固定化しています。RuntimeからFactory、AI、外部Providerは呼びません。

## テスト

- `pnpm typecheck`: PASS。
- `pnpm lint`: PASS。内包する`pnpm cycles`も循環依存なし。
- `pnpm test`: 42ファイル、310テストPASS（Unit 28ファイル・224件、Integration 14ファイル・86件）。新規sample-worldsはUnit 17件、Integration 2件。
- Integration: 全8Draft→Requirement union→offline Factory→Catalog→Bake→Validator→Runtime。MissingAsset=0、Validator error=0、NaN=0。空data directoryのAPIと不正ID、共有ファイルhashも検証。
- `pnpm build`: Studio / Player / ServerのビルドPASS（Playwright起動時にも実行）。既存の大きなbundleと依存ライブラリの注釈に関するwarningは残っています。
- fresh data専用E2E: 8/8 PASS。8カード、選択、Play、Chunk読込み、有限位置、地面下落下なし、陸上Machineの車輪接地、船の水面、島Proxy数、山高、Biome、有効なRace Courseを検証。
- 既存を含むE2Eの初回実行は41 PASS / 1 FAIL。失敗はボートの開始先に旧`archipelago`を期待していたため。新仕様の`designed-world`・Generator v2へ更新し、5島とtropical Biomeの検証を追加。削除・skipはしていません。

最終の全体E2E再実行は42/42 PASS（7.4分）。その後、遠景と近景のRGB変換を共通化し、8ワールドのfresh-data E2Eも8/8 PASS（2.0分）で再確認しました。

`docs/screenshots/sample-worlds/`には8ワールドのPlay画像と俯瞰画像、`docs/evidence/sample-worlds/`にはRuntime状態を保存しています。画像だけで合否を判定していません。

## 性能

各Worldの代表100Chunk（32m、33×33頂点、Chunk X/Z=-5〜4）をNodeで計測しています。地形・色・Prop生成を含み、WebGL描画とWorker転送は含みません。以下の表は初回計測値です。現在の原データは[生成計測](evidence/sample-worlds.json)、道路最適化の比較は[追補報告](sample-worlds-review.md)を参照してください。

| World                | median ms | p95 ms | max ms | entities / 100 Chunk |
| -------------------- | --------: | -----: | -----: | -------------------: |
| starter-grassland    |      0.21 |   0.64 |   3.06 |                  135 |
| airfield             |      0.15 |   0.47 |   1.06 |                    8 |
| tropical-archipelago |      3.37 |   4.36 |   8.81 |                  177 |
| toy-islands          |      3.79 |   4.80 |   6.14 |                  360 |
| mountain-island      |     10.83 |  12.06 |  12.69 |                  107 |
| desert-island        |     12.66 |  15.28 |  18.06 |                  184 |
| snow-island          |      7.26 |  13.59 |  14.27 |                  123 |
| race-island          |     14.28 |  17.32 |  21.94 |                  168 |

Biomeの斜面色には追加の高さサンプリングが必要です。周囲1頂点を加えた格子で値を共有して、各頂点4回の再計算を削減しました。それでも旧Design経路よりCPUコストは増えています。toy-islandsの同一プロセス比較では中央値2.71ms→5.09ms（約1.88倍）、p95は4.33ms→7.48msでした。旧3Presetの中央値は0.23〜0.33msで概ね同等です。[旧Generatorとの比較](evidence/sample-worlds-baseline-performance.json)に同一プロセスでの前後値を記録しています。

Worker Pool・Frame Budget・Streaming・Floating Originを維持しており、PlayをMain Thread生成へ戻していません。ソフトウェアWebGL環境のブラウザ観測はGPU/RAFの遅延を含み、60fpsを保証する結果ではありません。

## 制約と拡張

デモの形状は完成した専用美術素材ではありません。Biome別の摩擦・雪の滑り・砂の抵抗は未追加です。道路は地形Conform方式で、橋・トンネルを自動構築しません。高密度Propの近傍検索には引き続き最適化余地があります。既存Orbitカメラには地形の衝突回避がなく、山腹へズームすると地形内部が見える場合があります。

9個目はDesign追加→Catalog登録→必要Slot記述→件数・機能テスト追加→prepare→validateの順です。[具体的な手順](sample-worlds.md#9個目のsample-worldを追加する手順)を記載しました。UIやServerへの個別if追加は不要です。

最終差分をレビューし、既存E2Eが更新した今回と無関係な画像・診断結果を除外しました。Sample World基盤・内容・検証・ドキュメントだけを残しています。
