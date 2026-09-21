# Sample World レビュー対応

基準HEAD: `a7d61c2`。Prepared Demoの鮮度、Biome版の伝達、道路の生成負荷、実走検証、Metadataの依存分離を修正しました。

## Prepared Demoの鮮度

`assertPreparedSampleCurrent()`が毎回現在の`descriptor.buildProject()`を生成し、次を検証します。

- World/Coursesの現在の`worldContentFingerprint()`とPreparedの実内容が一致する。
- Designを持つWorldのManifestの`worldFingerprint`が現在の値と一致する。
- AssetとManifestを除いたWorld・Courses・Machines・Settingsの`sampleDefinitionFingerprint()`が一致する。

追加stampは保存せず直接比較します。`sample-worlds:validate`、全8Worldの単体テスト、空data directoryのAPI統合テストから同じ関数を呼びます。World、Machine、Course、Settingsの変更、Prepared改変、Manifestの古い値・欠落に対する失敗テストがあります。prepareし忘れは通常の`pnpm test`でも失敗します。エラーにはWorld IDと再生成コマンドを含めます。

## Biome Profileの版

Manifest → WorldRuntime → GeneratorInput → `biomeSurfaceCatalog[version]`の経路を接続しました。同期生成、Worker生成、Far ProxyのWorker要求にも同じ版を渡します。省略時はv1、未対応版はエラーです。版は生成Contextのfingerprintに含め、reload時にキャッシュを更新します。

テスト用v2を一時追加し、v1の近景・遠景が変わらないこと、v2指定で異なる色を生成すること、Runtimeでv1→v2→v1へ切り替えると表示データが戻ることを同期・Worker両方で検証しました。製品にはv1だけを同梱します。

## 道路生成

`sampleTerrain()`で高さ・道路影響・Biomeを共有し、頂点ごとの道路検索を1回にしました。線分は32m格子へ登録し、地形・道路色の計算では近傍の線分だけを照合します。道路自体がない場合と道路範囲外は早期終了します。

異なる幅・減衰幅の道路が交差しても、近い別道路が影響を打ち消す既存の規則を維持します。線分の走査順を保つため同距離でも結果が変わりません。Prop配置が要求する全域の正確な最近傍距離は全線分走査を維持しています。道路を10倍に延ばした直線道路で、同じChunk近傍の線分照合数が増えないことを検証しました。

各Designの100Chunkについて旧走査と新実装の地形・色・Propのfingerprintが一致しています。旧grassland / airfield / archipelagoの既存SHA-256回帰も維持しています。

### 同一プロセス性能比較

Nodeで旧全線分二重走査と新実装を交互に実行。各方式100Chunkをウォームアップ後、2回×100Chunkを測定しました。Chunkは32m、33×33頂点、X/Z=-5〜4。地形・色・Propを含み、WebGLとWorker転送は含みません。比較hashは計測区間外です。

| World                | 旧中央値 ms | 新中央値 ms | 旧p95 ms | 新p95 ms |
| -------------------- | ----------: | ----------: | -------: | -------: |
| tropical-archipelago |        3.44 |        3.69 |     4.54 |     6.48 |
| toy-islands          |        3.92 |        3.97 |     5.25 |     4.90 |
| mountain-island      |       11.67 |        4.47 |    13.40 |     6.30 |
| desert-island        |       14.34 |        4.13 |    18.66 |     6.47 |
| snow-island          |        7.73 |        3.96 |    16.36 |     5.96 |
| race-island          |       15.42 |        4.31 |    17.17 |     5.81 |

道路の多い山岳・砂漠・雪山・レースは約49〜72%短縮しました。南国とおもちゃ5島の計測領域には道路検索の削減効果が少なく、中央値の改善はありません。特に南国のp95には悪化が残っており、全Worldの高速化や60fpsを保証する結果ではありません。Worker Poolとフレーム時間予算は維持しています。

原データ: [同一プロセス比較](evidence/sample-worlds-road-performance.json)、[通常validateの100Chunk測定](evidence/sample-worlds.json)。再現コマンドは`pnpm exec tsx scripts/sample-road-benchmark.ts`です。

## Metadataの分離

StudioとServerの表示・ID検索は`sample-worlds/src/metadata.ts`を使います。`builders.ts`はMetadataとDesign・Machine Templateを結び、prepareとテストへ`buildProject()`を提供します。`index.ts`は旧入口との互換性を保つ再exportです。パッケージの`./metadata`と`./builders`も公開しました。

Viteの実ビルドのモジュール一覧を検査し、Studioに含まれるSample Worldモジュールが`metadata.ts`だけであることを確認しました。[ビルド検証](evidence/sample-worlds-bundle.json)。Engine自身が必要とするGeneratorやMachine編集機能は引き続き含まれます。

## 実走検証

`tests/e2e/sample-gameplay.spec.ts`に、草原の車、砂漠の車、南国のボート、レースの4ケースを追加しました。前3ケースは通常の前進キーで30m以上移動し、ボートは推進中も水面から2m以内を維持します。レースは経路に沿ってアクセル・ブレーキ・操舵キーを入力し、3Checkpoint→Goalを確認します。位置・速度・Course進捗の直接変更やテスト専用の易しいCourseへの差し替えはありません。

初回のレース検証ではテスト側のイベント送信先をWindowにしたため入力が届かず失敗しました。DOM要素からのキーイベントへ修正し、入力未達の早期検査を追加しました。また実車の操舵方向に合わせてテストの経路追従を修正しました。

レースの記録では約810mを走行し、40.8秒で1個目、79.0秒で2個目、124.1秒で3個目のCheckpoint通過を観測し、161.0秒でGoalに到達しました（Courseの経過時間、1秒間隔の観測値）。[レース実走記録](evidence/sample-worlds/race-drive.json)。南国のボートは30.06m進み、観測した高さは水面に対して−0.042〜＋0.107mでした。[ボート実走記録](evidence/sample-worlds/tropical-archipelago-drive.json)。

## 検証結果

- `pnpm test`: 45ファイル、336件PASS（Unit 250件、Integration 86件）。初回の並行負荷中は既存の50ms生成予算テストが1件失敗し、ブラウザ停止後の全体再実行で通過しました。予算値や検査内容は変更していません。
- `pnpm sample-worlds:validate`: 8Worldの鮮度、Manifest、Asset hash、各100Chunk、Validatorを通過。
- `pnpm typecheck`、`pnpm lint`（循環依存検査を含む）: PASS。
- fresh data専用E2E: 12/12 PASS（8Worldの読込み・状態確認＋4実走ケース、5.3分）。ブラウザの未処理例外・console errorなし。
- `pnpm build`: Studio / Player / Serverをビルド。既存の大きなbundleと依存ライブラリの注釈に関するwarningは残っています。
- 変更ファイルのPrettier検査と`git diff --check`: PASS。
