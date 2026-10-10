# 高品質な環境素材・描画基盤の実装報告

## 状態と作業基準

基準は `feat/alpine-village-visual-upgrade` の `f72cf94`。開始時に `git fetch origin feat/alpine-village-visual-upgrade` を実行し、リモートも同じコミットであることを確認した。作業ブランチは既存の `feat/high-quality-environment-assets` を使用した。開始時の追跡対象ファイルは変更なし。添付画像4枚は変更していない。

共通素材基盤と4段階の統合を実装した。画像はすべて既存Studioの実ブラウザ、World Runtime、Chunk Streamingを通して撮影した。別レンダラーや背景画像による景観置換は使用していない。ただし、参考画像と同等の密度・自然さを全面的に達成したとは評価していない。残る差は後述する。

## A. 共通基盤

### 既存機能の確認と再利用

`asset-pipeline/src/index.ts` はGLBの外部参照制限、埋め込み画像、材質、UV、Collider抽出に対応していた。`runtime.ts` はgltf-transformの重複排除、TextureのWebP化、Meshopt圧縮、自動LODを持つ。`renderer-three/src/instances.ts` はGLTFLoader、Geometry/Materialを共有するInstancedMesh、非対応モデルのCloneへのフォールバック、参照数付きTemplateキャッシュ、非同期LODのキャンセル、GPUリソースの解放を持つ。これらを再利用した。

単独でインポートされたPBR画像セットの自動適用は既存Pipelineで未対応のまま。本変更は、材質を持つGLBと、その生成・最適化・Runtime読み込みの経路を拡張するもの。

### Material・Texture・UV

- `packages/ai-dummy/src/environment-materials.ts`: レシピ版1の決定的なRGBA画像と法線・粗さ画像を生成。樹皮、広葉、針葉、草、木材、石積み、屋根、漆喰、窓の色を定義する。既存依存のSharpでPNGへ変換し、GLBに埋め込む。
- `environment-models.ts`: Three.jsのGeometryからPOSITION、NORMAL、TEXCOORD_0を保存。屋根はUVを反復させて瓦の実寸感を調整する。近・中距離の幹と葉は別材質。葉は両面のMASKで、半透明のソートを必要とするBLENDを使わない。
- 色画像はglTFのBase Colorとして保存する。GLTFLoaderがsRGBとして解釈する。Normal・metallic-roughness画像は数値画像で、Gに粗さ、Bに金属度0を保存する。頂点色を使う遠景モデルはThree.Colorによる線形値を保存し、白のBase Color Factorへ掛ける。色画像を手動で二重に線形化しない。
- Runtimeの草は画像を使わない曲面状の三角形で描く。頂点の明暗と、短草・長草・枯れ草・小さな野草・道路脇の草の色／高さを組み合わせる。草用GLBも生成器で利用できるが、Alpineの草はRuntime生成を使用する。
- 既存の頂点色GLBと地形の大きな配色は保持した。地表の微細な色・法線変化は追加したが、地形高さや道路Splineは変更していない。

Three.jsの色管理とMeshStandardMaterialの仕様は、[公式色管理文書](https://threejs.org/manual/pages/color-management.html) と [公式材質文書](https://threejs.org/docs/pages/MeshStandardMaterial.html) を確認した。

### 共有と解放

モデルの部材は材質別にまとめる。同じGLBの同種画像・Materialは共有する。Templateは既存キャッシュで共有し、InstancedMeshはそのGeometryとMaterialを参照する。

追加した `EnvironmentTexturePool` は、レシピ版と独自画像名が一致するTextureだけをGLB間で共有する。色空間とサンプラー設定もキーへ含める。最後のTemplate解放時にTextureをdisposeし、各TemplateのMaterialとGeometryも解放する。外部素材を画像名だけで統合しない。解放前に読み込みが完了しない場合も既存の参照数・Promise経路で処理する。

草はChunk内の16mパッチ単位でインスタンス化し、そのChunkで詳細／簡略GeometryとMaterialを共有する。Chunk破棄時のreleaseで所有リソースを一度だけ解放する。InstanceのGPUバッファは既存Rendererのclear処理で解放される。

今回は巨大な画像アトラスを採用しなかった。近景の不透明な樹皮とMASKの葉を分け、画像を共有する方を採用した。遠景では材質を1つにまとめる。これにより、アトラスの透明余白、UV境界のにじみ、用途別の法線・粗さの管理を増やさずにDraw Callsを削減できる。画像の共有でTextureメモリは減るが、異なるMaterialやChunkのDraw Callsが自動的に統合されるわけではない。

### 再生成・LOD・他Worldへの適用

`environment-prepare.ts` はAlpineから独立した準備関数。元GLBのScene extrasにレシピ版とSeedを保存し、素材名を変更しても同じSeedから明示的なLODと幹Colliderを生成する。薄い葉のカードを自動Simplifyだけで処理しない。

近距離は幹・枝・葉カード、中距離は葉の数を減らしたモデル、遠距離は不透明な頂点色1材質の輪郭モデルを使う。遠景でも元の高さ・位置を維持し、葉や細枝の細部は省略する。切り替え距離は現段階で45m／110m、既存の10%ヒステリシスを使用する。品質素材だけ、Chunk原点ではなく実際の配置群の中心と半径で距離を判定する。将来の画角や品質設定に対する全モデルの投影サイズLODは未実装。Chunkよりさらに遠い既存FarWorldProxyは従来の簡略形状を維持しており、品質モデルへの置き換えは行っていない。

草は草丈0.5mの投影ピクセル数で切り替える。詳細／簡略は9～11px、非表示は4.5～5.5pxのヒステリシス。後者は全体測定後に引き上げた。遠方は既存地表と微細な模様へ移行する。風や連続的なフェードは未実装で、境界に切り替えが見える場合がある。

新しいWorld Schemaは追加していない。既存の `source.parameters` に以下を設定できる。

```json
{
  "vegetationArea": { "minX": -270, "minZ": -320, "maxX": 260, "maxZ": 210 },
  "environmentAssets": [
    {
      "area": { "minX": -1800, "minZ": -1800, "maxX": 1800, "maxZ": 1800 },
      "slots": {
        "nature.tree.alpine-village.oak": "nature.tree.quality.oak",
        "nature.tree.alpine-village.pine": "nature.tree.quality.pine"
      }
    }
  ]
}
```

`world-generator/src/vegetation.ts` の配置関数は高さと配置可否をコールバックで受け取り、特定Worldに依存しない。絶対座標セルにSeedによる揺らぎを加える。`world-vegetation.ts` が既存の意味レイヤー、建物、Catalogのランドマーク境界、実Terrainの高さ／傾斜に接続する。農地の除外は呼び出し側から渡す。`ground-detail.ts` も任意の座標varyingと舗装マスクを受け取る。

生成器と準備関数は `@machine-studio/ai-dummy/environment-models`、`/environment-materials`、`/environment-prepare` のPackage exportsから利用できる。生成時は既存DummyAssetGeneratorのdemoPrimitivesを有効にし、品質Slotを指定して、準備時にprepareEnvironmentAssetsを呼び出す。

素材Slotは既存Plannerへ密度0のPropRuleで宣言できる。品質樹木は3 variantsを生成する。CatalogとWorldBuildManifestは既存の焼き込みとcontent hashを使用する。

## B. 各Phaseの結果

比較画像の並びは **参考画像／改修前／改修後**。参考画像のカメラ位置は不明であり、参考と同じ画角とは主張しない。改修前と改修後の同名視点は同じ位置・注視点・Viewportで撮影した。

### Phase 1: 森林の小道

最初は約100m四方（X=55～155、Z=-205～-105）に限定した。既存の道路と樹木配置を再利用し、広葉樹・針葉樹のSlotを品質モデルへ置き換えた。分岐した枝、複数の葉の小群、幹の質感、立体的な草、地表の微細模様を追加した。初回画像では中距離LODの葉が疎らだったため、葉数とカードの大きさ、LOD判定を修正した。

- [実ブラウザ画像](phase1/forest-path.png)
- [参考／改修前／改修後](phase1/forest-path-comparison.png)
- [性能](phase1/performance-summary.json)

樹冠が大きな多面体だけに見える問題と、道路脇の草がない問題は改善した。参考より草は疎らで、葉の形が大きく規則的に見える箇所がある。葉の透過光、細かな葉脈、風の動きは未実装。

### Phase 2: 木組みの家

既存の石造・木造住宅の位置・縮尺を維持し、品質住宅へ解決する。1階の石積み、2階の漆喰、縦横と斜めの木組み、瓦模様を持つ屋根、窓枠・ガラス色・窓台・扉・煙突を分離した。床面サイズは6.8m×5.7m、軒高5.2m、棟高約7.6m。Colliderは既存Pipelineがモデルから生成し、Runtimeへ渡す。

- [実ブラウザ画像](phase2/house-close.png)
- [参考／改修前／改修後](phase2/house-close-comparison.png)
- [性能](phase2/performance-summary.json)

木材・石・屋根の区別と建物の近景は改善した。建材の風化、窓の内部、窓ガラスの透過・反射、納屋や風車の高品質材質への置き換えは未実装。納屋・風車・石垣・作物は既存素材を維持する。

### Phase 3: 村の景観

建物の周囲にも草を追加し、道路、農地、建物の足元、ランドマークの内部を除外した。最終確認で集落全体のNoSpawnマスクが草まで消していたため、草については明示的な禁止領域・滑走路・実際のCatalog境界で判定するよう修正した。回転と縮尺を含む建物の占有範囲を避け、集落の空地には草を描く。村の既存道路に石畳の模様と微細な法線を重ねた。屋台・木箱・樽の小物セットを3か所へ配置した。初期配置はValidatorが建物の生成数低下を検出したため、既存建物から21m以上離れた場所へ変更し、14棟を維持した。品質住宅でも既存の煙突の煙を表示する。

近景の検査カメラではShadow Frustumを視点周辺へ絞り、広い全景では既存の広域Frustumを保つ。ゲームプレイのShadow Follow仕様は変更していない。草自体のShadow Passは省略し、木・建物の影を受ける。

- [同一カメラの村の比較](phase3/village-comparison.png)
- [Phase 3の性能](phase3/performance-summary.json)
- [最終統合後の村の近景](phase4/village-square.png)

石畳と小物は全景カメラでは小さく、最終の近景画像も併せて確認する必要がある。村の近景は新設カメラのため、対応する改修前画像はない。参考の広場と同じ配置・市場規模は再現していない。

### Phase 4: 全体統合と最適化

品質樹木をAlpineの森林全域へ適用し、村・農地周辺530m四方に草の生成範囲を拡大した。草の根と傾斜判定は、描画Terrainと同じ三角形の補間を用いる。親Chunkの移動に従い、Origin Rebaseで草の位置を再生成しない。

全体統合直後は村視点のDraw Callsが963回になった。遠景樹木を不透明な1材質モデルへ変更し、草の遠景切り替えも調整した。最適化直前の値は [optimization-baseline.json](optimization-baseline.json) に残す。近景・全景・再読み込み・走行・実際のOrigin Rebaseの最終証跡はPhase 4へ保存する。

- [森林の小道の最終比較](phase4/forest-path-comparison.png)
- [家の最終比較](phase4/house-close-comparison.png)
- [村の最終比較](phase4/village-comparison.png)
- [性能の改修前後比較](phase4/performance-comparison.json)

遠景は意図的に粗い輪郭モデルであり、近景と同じ葉の細部ではない。高品質化は森林・草・住宅を中心に行い、既存のAlpineのすべての素材を写真のような品質へ変換したものではない。

## C. 性能と測定の限界

Chromium／ANGLE／SwiftShaderのソフトウェアGPU、1440×1000のViewportで測定した。CanvasはStudioのレイアウト内にあるため高さはViewport全体と異なる。実GPUのFPS達成は未検証。

同名カメラごとに2秒の観測窓を設け、異なる描画フレームを集計する。中央値・p95はnearest-rank法。数フレームしか得られない視点もあるため、p95の安定性は低い。CPU描画時間はGPUへの送信時間であり、フレーム全体のCPU時間ではない。GPUタイマーはSwiftShaderでの値。RAFはGPU／スケジューリング／その他の仕事を含む。取得できない値はnullにし、0で代用しない。

基準観測APIはGeometry／Textureカウンターの名前を間違えていた。本変更で修正したが、改修前の当該値はnullのまま扱う。JS Heapは採取できているが、TextureメモリやGPUメモリの実測ではない。Textureの推定容量はAsset PipelineのruntimeInfoに保持する。

最終の数値は `phase4/performance-comparison.json` のbefore/afterを参照する。ここにDraw Calls、Triangles、CPU送信時間、RAF、GPU時間、JS Heap、モデルのLODごとの容量・材質数・Texture数、同じ100Chunkの生成時間を記録する。生成時間の比較はf72cf94の実sourceと最終sourceを使用し、双方で1回ウォームアップしてから同じ順に測定する。草のRenderer側の準備コストはWorld GeneratorのChunk生成時間には含まれない。

最終全E2Eで得られた中央値（比較可能な同名カメラ）:

| 視点 | Draw Calls 改修前→後 | Triangles 改修前→後 | RAF ms 改修前→後 | CPU送信 ms 改修前→後 |
| --- | --- | --- | --- | --- |
| 森林の小道 | 123→197 | 279,014→410,108 | 183.4→400.0 | 7.5→11.1 |
| 住宅近景 | 186→336 | 406,656→525,352 | 250.0→350.0 | 3.5→8.8 |
| 村の全景 | 373→627 | 573,144→677,056 | 316.7→383.3 | 9.4→12.9 |

最終値は集落の空地に草を戻した修正を含む。村のDraw Callsは全体統合直後の963回から627回へ減ったが、改修前の373回より多い。各視点の短い観測と非同期Streamingにより、個々の実行の値には差がある。

性能が全面的に改修前より速くなったとは評価しない。葉のMASK、枝、材質の増加は特に近景のGPU負荷を増やす。遠景LODと草の距離切り替えで負荷を削減するが、実GPUでの品質設定ごとの調整は残る。

## D. 互換性

- 新しいWorld Schema、Rapier計算、車の駆動力、飛行機の空力、推力ミキサー、Part別VFX入力、Origin Rebase仕様は変更していない。
- Alpineの地形、山脈生成、道路Splineは変更していない。素材Slotの置き換え、小物、密度0の必要Slot宣言、既存parametersによる描画設定を追加した。
- 住宅の位置・縮尺と建物14棟を維持する。品質樹木のColliderは葉を含まない幹のconvex hull。住宅・小物は既存のCollider経路を利用する。Runtimeの草は物理Entityを追加しない。
- Chunk Streaming、LODの非同期読み込み、Origin Rebaseは既存Runtimeを利用する。草の配置はChunk分割と順序に依存せず、LOD中心は既存のshiftOriginに従う。
- 既存8ワールドとAlpineの合計9ワールドを準備・検証する。変更された準備済みWorld JSONはAlpineのみで、共通素材libraryへ品質素材が加わる。
- CatalogとManifestは準備コマンドで再生成し、全Slot解決とcontent hashを検証する。

## E. 素材・依存・再生成

| 素材       | Slot／用途                          | 生成方法                                   |
| ---------- | ----------------------------------- | ------------------------------------------ |
| 広葉樹     | nature.tree.quality.oak             | Seed付き幹・枝・葉カード、明示LOD          |
| 針葉樹     | nature.tree.quality.pine            | 高さ別の枝・針葉カード、明示LOD            |
| 木組み住宅 | building.quality.house              | 石・漆喰・木・屋根・窓の部材生成           |
| 小物セット | prop.quality.market                 | 屋台、箱、樽の部材生成                     |
| 草         | Runtime／nature.grass.quality.grass | 曲がった草葉のインスタンス／任意生成用GLB  |
| 地表       | ground-detail.ts                    | 絶対座標ノイズ、舗装マスク、法線の微細変化 |

作者は3DGameStudio。ゲーム用の外部画像・モデル・外部生成サービスは使用していない。添付参考画像は比較だけに使用し、Textureへ切り出していない。素材Recordのlicenseは `project-owned`。本リポジトリの [MIT License](../../LICENSE) に従い、商用利用・改変・再配布が可能で、著作権とLicenseの表示を保持する。素材出自と帰属表示はRecordと性能資料にも保存する。

実使用バージョン: Three.js 0.180.0、Sharp 0.35.4、gltf-transform core/extensions/functions 4.5.0、meshoptimizer 0.22.0。既存のSharpを利用Packageの直接依存として明示した。新たなライブラリやグローバルインストールは追加していない。依存は既存のpnpm-lock.yamlに固定される。

```bash
pnpm sample-worlds:prepare
pnpm sample-worlds:validate
PLAYWRIGHT_BROWSERS_PATH=/home/smorce/.cache/ms-playwright QUALITY_PHASE=phase1 \
  pnpm exec playwright test --config playwright.environment.config.ts
pnpm exec tsx scripts/environment-quality-evidence.ts phase1 test-results/environment-quality
# phase2 / phase3 / phase4 も同様。参考画像4枚は作業時の添付入力を使用する。
PLAYWRIGHT_BROWSERS_PATH=/home/smorce/.cache/ms-playwright pnpm test:e2e
pnpm exec tsx scripts/environment-quality-evidence.ts phase4 test-results
pnpm exec tsx scripts/environment-quality-measure.ts
```

ブラウザキャッシュのパスは実行環境に合わせる。通常テストは `test-results/` だけへ出力し、正式証跡は明示したevidenceコマンドで更新する。evidenceコマンドは対象Phaseの古い出力を置き換える。対象テスト結果の.last-run.jsonがpassedであることと、ブラウザの検証JSONが存在することを確認してから更新する。

## F. 検証結果

- `pnpm typecheck`: 成功。
- `pnpm lint`: 成功。循環依存なし。既存 `.data/` の一時ファイルでの初回失敗は、生成キャッシュをLint対象から除外して解消した。
- `pnpm test`: 49ファイル／381件成功。ブラウザ計測と同時実行した際の既存の時間制限テスト1件の失敗は、ブラウザ終了後の全件再実行で成功。時間制限テストは弱めていない。
- `pnpm sample-worlds:prepare`: 成功。途中、小物が建物の生成数を減らす問題を検出し、配置を修正してから再実行した。
- `pnpm sample-worlds:validate`: 成功。既存8ワールド＋Alpineの9ワールド、各100Chunk。
- `pnpm build`: ブラウザ検証のwebServer起動でStudio／Player／Serverをビルドし成功。既存依存のRollup注釈・大きなBundleの警告は残る。
- Phase 1初回／改善後、Phase 2、Phase 3、Phase 4初回／最適化後: 実ブラウザ検証成功。Phase 1の初回の追加観測テストはカウンター名不一致で失敗し、API修正後に再実行して成功。
- 全E2E初回は性能最適化のため中断（1 interrupted、49 did not run）。成功扱いしない。
- 全E2Eの診断実行は49件成功／1件失敗。Alpine走行で2.5秒の実時間に対する移動距離が0.993mとなり、1m超の確認が失敗した。物理処理を変更せず、150物理ステップを観測する方式へ変更した。改修前の走行性能とは観測区間が違うため、比較資料でcomparable=falseとする。
- 全E2E最終再実行: **50件成功、20.2分**。最終の集落草・Catalog占有範囲修正と150物理ステップの走行確認を含む。車・飛行機・ボート、Part別VFX、9ワールド新規起動、長距離飛行／Origin Rebase、物理Streaming、圧縮LOD／Instancingが成功。[結果記録](validation-results.json) を参照。

追加テストは、GLB／UV／画像読み込み／MASK／最適化後の材質、Seedの再現性、素材名変更後のLOD再生成、共有Textureの最後の参照での解放、Geometry/Material共有、草のChunk境界、道路・建物の除外条件、五つの草分類、接地面の対角線、Origin Rebase後の整合性を検査する。ブラウザではGLBダウンロード、Textureカウンター、景観画像と性能を確認する。物理・VFX・既存ワールドの回帰は既存のUnit／Integration／E2Eを利用する。
