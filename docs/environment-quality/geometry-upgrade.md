# 環境アセットの造形・描画性能改善

`指示22.md` に基づく作業。基準ブランチは `feat/environment-fidelity-optimization`、作業ブランチは `feat/environment-geometry-and-performance`。

## 改修前の確認

実装前に実StudioをChromium / ANGLE SwiftShaderで起動し、Seed 42、1440×1000、Pixel Ratio 1、FOV 45°、MSAA 4の8視点を保存した。各視点10秒×3回、Chunkと描画リソースが安定してから観測した。影・樹木・草などの無効化診断も同じ実行に含む。正確な目線の1視点は別の起動で追加した。実GPUによる補助比較は後述する。

証跡は [before](geometry-upgrade/before/) に保存。`performance.json` は生データ、`validation.json` はブラウザ検証結果。今回の比較対象はこの改修前実行。`b974803` の過去の値を今回の測定結果として扱わない。

コードと画像から確認した問題：

- `environment-models.ts`: 側面に窓がなく、上階の窓もない。屋根の端部と棟の厚みが弱い。遠景で正面の窓が消える。
- `vegetation.ts`: 草の幅と直線的な葉先によって三角形が目立つ。
- `instances.ts`: Chunk内の最も近い位置を基準にグループ全体の影を切り替えるため、遠い木まで影を描く。
- `environment-plaza.ts`: 長方形の舗装が広く、植生との境界が単調。
- `environment-accents.ts`: 対象Chunkを判定する前に意味レイヤーと集落配置を取得する。追加樹木が描画専用で物理Worldに存在しない。
- `physics-rapier/src/index.ts`: 生成Entityの既存静的Collider経路は、素材の幹Convex Hullと位置・回転・縮尺を使用し、Chunk単位で参照を管理する。この経路を再利用する。

## 実装・検証の状態

実装・比較画像・SwiftShaderと実GPUの計測を完了した。型チェック、Lint、51ファイル396件のUnit/Integration、Build、既存8ワールド＋Alpine Village（全9ワールド）のprepare/validate、最終版の全50件のE2Eが成功した。造形と物理の修正は確認できたが、参考画像と同等の品質や全視点での総合性能改善は未達成。性能の増加と残る視覚差を以下に記録する。

## 採用した変更

### 住宅

石造りの下階・漆喰の上階、6.8×5.7mの壁面、道路を向く既存の回転を維持した。棟・破風・軒先の厚み、窓の奥行き・窓台・桟、扉枠と入口の敷石、側面の柱と斜め補強材を追加した。正面の上階は2窓、背面は1窓、側面は非対称の配置として、各面を均等な窓の列にしない。

屋根の勾配、煙突の左右、扉位置は素材生成Seedによって変わる。GLB再生成のバイト一致と、全LODの外形一致をテストした。LOD2でも窓と屋根の輪郭を残し、細い窓の桟を省く。近中景は既存の5 Materialへ形状を統合しており、細部ごとのDraw Callを増やさない。遠景は木枠と窓を頂点色付きの1素材へまとめ、元の4 Materialを維持する。色は元のTextureの線形色平均から求め、遠景で木目のTexture処理を省く。近景の住宅は722→1,854三角形、遠景は482→1,518三角形。屋根端と窓の形状に必要な増加として記録する。

素材レシピをv2→v3へ更新。Factoryの既存SHA-256内容ハッシュとprepare経路でGLB・LOD・Catalog・Manifestを更新した。Texture共有処理はv1/v2/v3を扱い、異なる版の画像を混同しない。建物14棟、地形、道路、Schema Version 7、力計算とVFX入力は維持する。

### 草と樹冠

草の近景8葉25三角形、中景3葉10三角形、16mパッチ、共有Geometry/Materialを維持した。幅を細くし、葉の中間部分と先端の曲がり方を変更した。既存の候補セル・Seed・道路端の短縮・建物と農地の除外を維持する。密度を増やして負荷を隠す方法は採用していない。

広葉樹は枝当たり36→28枚の近景カードとし、枝先へ葉群を寄せた。近景は1,800→1,592三角形。中景カードの拡大率を1.3→1.15へ抑え、近中景の外形差を小さくする。遠景の樹冠を近景と同じSeedの枝骨格から生成する。遠景は1素材の不透明な葉群と幹で構成し、最終案は元の広葉樹200・針葉樹180三角形を維持する。枝まで立体化する案や全32枝を残す案は、性能測定と画像の結果から不採用にした。MASK・MSAA・alpha-to-coverageを維持し、新しい半透明処理は追加していない。

### 樹木と影

Chunk単位・素材単位の既存InstancedMeshを維持する。巨大な一括グループへ統合しない。近景の葉カード削減は色描画と影の三角形予算の両方へ効く。

グループ単位の影距離判定に加え、品質樹木へ専用MeshDepthMaterialを設定した。Shadow Passの頂点シェーダーで各Instanceの幹原点をSimulation座標へ変換し、カメラから85mを超える個体をクリップ領域の外へ退避させる。遠い個体の影ラスタライズを省く一方、近景の木陰と葉のMASKを維持する。個体の頂点処理やShadow Passの呼び出しそのものを全て省く方式ではない。通常のDraw Callsが減ると主張しない。専用深度MaterialはLOD交代・Chunk解放時に破棄する。

影用の別Meshや細かい距離グループを増やす方法は、通常描画・リソース・切替処理の負担を増やすため採用しない。影を全て無効にする方法も採用しない。フレーム時間と、取得できるSwiftShaderのGPUクエリ時間で比較する。GPUクエリはrenderer.render全体を囲み、独立した影だけの計測ではない。

### 広場

長方形の全面舗装を、中央の楕円・横の通路・既存屋台（32,-15）の足元の舗装へ変更した。草の除外関数と地表Shaderで同じ絶対座標の形を使い、外周の草と木の足元の草地を残す。石畳の石を小さくし、目地へ小さな決定的なずれを入れた。屋台・樽・木箱は既存素材と既存の意味ある配置を再利用する。建物や小物を大量追加していない。

### 景観樹木・Chunk計算

2本の樹木の唯一の配置源を `world-generator/src/environment-accents.ts` に移した。描画側での追加を撤去し、既存のCatalog解決・幹Convex Hull・静的Collider生成経路へ接続した。両者は同じEntityの位置・回転・縮尺を使用する。所有Chunkは絶対座標をchunkSizeでfloor除算して求め、負座標を扱う。

対象外Chunkでは意味レイヤー取得と集落計算を呼ばずに終了する。追加キャッシュは作らない。既存の意味レイヤー・集落キャッシュの寿命はWorld Design参照に従う。集落内の樹木には所属集落を付け、道路・建物・滑走路・生成禁止領域の確認を維持した。再生成時に判明した `prop-no-spawn` をこの所属情報で解決した。集落所属Entityに樹木が含まれるため、既存の14棟確認テストは `kind === building` を明示する。

Rapierで、生成された幹ColliderへのRayと実際のサンプル車両Colliderの接触、樹冠高さでの非接触、Origin Rebase、Chunk解放、再読込時の単一参照を検証した。車両を幹へ動かして接触Manifoldを確認し、幹の反対側へ抜けないことを確認した。物理アルゴリズムは変更していない。

## 測定の範囲と制限

変更前はHEAD `7761de6`（作業開始時の最新状態）を実ブラウザで測定した。過去の `b974803` の報告値も参照するが、今回の測定と混同しない。変更前の森林273 Draw Calls、住宅323、村618は過去の報告と一致する。

各視点10秒×3回は一度の起動内の連続観測。主比較のGPUはANGLE SwiftShaderのソフトウェア処理。実GPUの結果は別に比較する。独立した複数回のcold loadは未測定。初期読込はRuntimeの状態を保存しているが、起動時間の中央値を測ったものではない。Chunk生成の3回×100ChunkベンチマークはRenderer草生成・GLB読込・GPUアップロードを含まない。JavaScript Heapはブラウザの参考値であり、GCのタイミングに左右される。

正式な改修前後画像は同一カメラ・画角とする。参考画像とは建物・地形・樹木・カメラ構図が異なり、同等品質や数値的な類似度は主張しない。

## 不採用案の画像

[遠景の葉群が分離した森林案](geometry-upgrade/trials/forest-open-canopy.png) は、実ブラウザで針葉樹が段状の離れた塊に見えることを確認して不採用にした。最終案では、同じ8本の枝の参照位置から葉群を幹の近くへ寄せ、下部から上部へ寸法を減らして連続した外形へ修正した。遠景の枝Geometryそのものは省く。コードやテストだけで視覚品質の完了とは判断しない。

## リソース数の読み方

ブラウザの `renderer.geometries/textures` はThree.jsのRenderer統計、`resources.materials/geometries/textures` はシーンを走査して重複を除いた参照数。Materialは通常の色描画素材を数え、内部のShadow Map用素材や追加したcustomDepthMaterialを含まない。customDepthMaterialは品質樹木のMeshごとに1つ追加しており、通常素材数が同じでも実際のMaterial割当が同じとは主張しない。LOD交代とChunk解放で深度素材を破棄する。

## 残る視覚的な差

森林の実画像では、細い草葉によって太い三角形の見え方を弱めた一方、参考のような連続した草の覆いは再現できていない。遠景の樹冠は低ポリゴンの面が残り、葉カードの斜めの見え方や明暗も参考と異なる。住宅は窓・扉・木組みと屋根端を形状で増やしたが、参考の上階の張り出し、壁の細かな不整形、暖かい光、建物周囲の生活感はまだ不足している。広場は既存の14棟と小物配置を維持するため、参考ほど密な街並みではない。

この改修を参考画像と同等の景観品質の達成とは扱わない。独立cold loadの分布、影だけのGPU時間は未測定。

## 再実行方法

```bash
pnpm sample-worlds:prepare
pnpm sample-worlds:validate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright" pnpm test:e2e
PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright" FIDELITY_CAPTURE=1 pnpm exec playwright test --config playwright.environment.config.ts
pnpm exec tsx scripts/environment-geometry-evidence.ts after test-results/environment-quality
PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright" FIDELITY_EYE_OUTPUT=test-results/geometry-eye-after pnpm exec playwright test --config playwright.environment-eye.config.ts
pnpm exec tsx scripts/environment-geometry-evidence.ts after-eye test-results/geometry-eye-after
PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright" GEOMETRY_DETAILS_ONLY=1 pnpm exec playwright test --config playwright.environment.config.ts
PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright" GALLIUM_DRIVER=d3d12 MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA GEOMETRY_GPU_CAPTURE=1 GEOMETRY_OUTPUT=test-results/geometry-gpu-after FIDELITY_CAPTURE=1 pnpm exec playwright test --config playwright.environment.config.ts
pnpm exec tsx scripts/environment-geometry-evidence.ts gpu-after test-results/geometry-gpu-after
```

通常テストの `test-results/` と正式な `geometry-upgrade/` を分離する。全E2Eが `test-results/` を更新する前に、成功した計測の出力を証跡スクリプトで保存する。開始時の改修前画像は既に保存済みであり、最新コードを `before` として上書きしない。

## 性能悪化を確認した試行

[試行の全画像・生データ・集計](geometry-upgrade/trials/over-budget/) を保存した。遠景の広葉樹540三角形・針葉樹340三角形の案では、森林の三角形数が424,483→510,087、村全景が671,436→895,196となり、最初の観測窓のフレーム中央値も村400→466.6ms、住宅333.3→366.7msへ悪化した。Draw Callsもわずかに増えた。この案を性能改善として扱わない。

原因は、遠景樹木の主要枝まで立体化し、画面内の多数の遠景Instanceで頂点処理が増えたこと。最終案では近中景の枝を維持し、遠景では同じSeedの枝先から9群の広葉樹・8段の針葉樹の樹冠を生成して、枝の細部を省く。遠景は広葉樹200・針葉樹180三角形という元の予算へ戻す。近景の窓・屋根・葉群を保ちつつ、遠景での不要なGeometry増加を取り除いた。

## 変更ファイル

- `packages/ai-dummy/src/environment-models.ts`: 住宅の形状、Seedごとの外観、樹冠とLOD。
- `packages/ai-dummy/src/environment-materials.ts`: 素材レシピv3。
- `packages/world-generator/src/environment-accents.ts`（追加）: 景観樹木の正規配置と所有Chunkの早期判定。
- `packages/world-generator/src/design-generation.ts`: 景観樹木を生成Entityへ統合。
- `packages/renderer-three/src/environment-accents.ts`: 配置確認用の互換関数。
- `packages/renderer-three/src/index.ts`: 描画専用の重複生成を撤去。
- `packages/renderer-three/src/instances.ts`: Texture共有版対応、個体ごとの影制限と深度Material解放。
- `packages/renderer-three/src/vegetation.ts`: 草葉の幅と曲がり方。
- `packages/renderer-three/src/environment-plaza.ts` / `ground-detail.ts`: 舗装範囲、草との境界、石畳。
- `tests/unit/environment-geometry.test.ts`（追加）: 早期終了、所有Chunk、住宅再現性・外形・窓、幹Collider、遠景描画予算。
- `tests/integration/environment-accent-physics.test.ts`（追加）: 実Rapierの幹接触・住宅Trimeshへの車両接触・解放・再読込・Rebase。
- `tests/unit/environment-quality.test.ts` / `alpine-village.test.ts`: 素材v3の参照寿命、14棟の数え方。
- `tests/e2e/environment-quality.spec.ts`: 住宅の正面・側面・細部の追加撮影モード。
- `playwright.environment.config.ts`: 通常出力・追加撮影出力の分離と、画面あり実GPU計測モード。
- `tests/e2e/alpine-village.spec.ts`: SwiftShaderで移動検証を完走するための全体時間制限。
- `scripts/environment-geometry-evidence.ts`（追加）: 成功した実ブラウザ出力の正式保存・集計・横並び比較。
- `demos/sample-worlds/library.json` / `demos/worlds/alpine-village.json` / `demos/sample-worlds/assets/`: Factoryで再生成した素材・内容ハッシュ・Manifest。

物理エンジン、車・飛行機・ボートの力計算、Schema、道路制御点、山脈の高さ生成のコードは変更していない。最終の全変更一覧は証跡ディレクトリの一覧にも保存する。

## 窓の奥行きと遠景住宅の追加調整

元の遠景樹木予算へ戻した試行は [budget-restored](geometry-upgrade/trials/budget-restored/) に保存した。森林の最初の観測窓は約400→383msへ改善したが、住宅近景は約333→350msで、影を無効にした住宅近景のGPU時間も増加していた。木枠の全面板とガラスの重なりが残っていたため、木枠を中央が空いた押出形状へ変更し、ガラスを枠より約4cm奥に置いた。ガラスの裏にある木材の不要な面を省き、実際の窓の奥行きも改善する。

また、LOD2へ窓を残すことで増えていたGlass用Draw Callを、木枠と窓の頂点色付き1素材への統合で取り除いた。窓の配置・屋根・外形を変えず、遠景のMaterial数を元の4へ維持する。

## 実GPUの利用確認

標準のChromiumはANGLE SwiftShader、OpenGL指定の画面あり起動でも通常はllvmpipeとなった。WSLにRTX 4090は見えており、`GALLIUM_DRIVER=d3d12` と `MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA` を指定した画面ありChromiumで `ANGLE (Microsoft Corporation, D3D12 (NVIDIA GeForce RTX 4090), OpenGL 4.6)` を確認した。[標準起動の確認](geometry-upgrade/hardware-probe.json) と [D3D12指定の確認](geometry-upgrade/hardware-d3d12-probe.json) を保存している。実GPUの測定はSwiftShaderと別の比較として保存し、バックエンドを変えた差をコードの性能改善として扱わない。

## 最終版のSwiftShader測定

各セルは改修前 → 改修後。時間はmsで、3観測窓それぞれの中央値の中央値を掲載する。各窓の中央値・p95・最小最大・サンプル数は [全視点の比較JSON](geometry-upgrade/phase4/performance-comparison.json) に保存している。CPUは描画命令の送信時間、GPUは影を含むrenderer.render全体のクエリ時間、フレームはrequestAnimationFrame間隔。

| 視点 | Draw Calls | Triangles | CPU描画 ms | GPU ms | フレーム ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 森林の小道 | 273 → 273 | 424483 → 424067 | 5.70 → 6.30 | 380.72 → 371.31 | 399.9 → 383.3 |
| 住宅近景 | 323 → 325 | 489728 → 501242 | 6.80 → 6.80 | 319.68 → 335.79 | 333.3 → 350.0 |
| 村全景 | 618 → 618 | 671436 → 681796 | 7.70 → 8.90 | 390.47 → 417.15 | 400.0 → 433.3 |
| 広場（高めの目線） | 366 → 366 | 430208 → 442521 | 6.60 → 7.30 | 396.16 → 405.00 | 400.0 → 416.7 |
| 住宅細部 | 322 → 323 | 413366 → 420060 | 6.40 → 7.30 | 325.00 → 325.41 | 333.4 → 333.3 |
| 広場（通常補正あり） | 369 → 368 | 434454 → 446328 | 6.50 → 7.00 | 398.54 → 409.07 | 416.6 → 416.7 |
| 全景 | 678 → 678 | 674390 → 684750 | 7.60 → 9.00 | 412.86 → 436.16 | 416.7 → 449.9 |
| 俯瞰 | 417 → 417 | 483566 → 493926 | 6.20 → 8.30 | 254.45 → 290.54 | 266.7 → 300.1 |
| 正確な広場目線 | 322 → 323 | 402057 → 414811 | 5.40 → 6.20 | 377.64 → 396.79 | 383.4 → 400.0 |

森林はフレーム中央値が約4.2%短縮した。一方、住宅近景は約5.0%、村全景は約8.3%、俯瞰は約12.5%増加した。全体の性能改善とは評価しない。住宅の窓・屋根・梁の形状追加により、村全景と俯瞰の三角形数は10,360増え、影用の個体距離判定にも頂点処理が加わる。Grassの舗装除外範囲縮小によって全ロード領域の草は120,814→121,033株となった（約0.18%増）。Draw Callsは大半で維持されるが、視点ごとの可視範囲とLODにより住宅近景で2、正確な広場目線で1増える。形状の増加だけで時間差の全てを説明できるとは断定しない。連続観測中の揺れとバックエンド依存が残り、追加の独立起動比較が必要になる。

影を無効にした1回10秒の診断では、森林のGPU時間は282.59→296.90ms、住宅近景は261.88→286.78ms、広場は306.91→320.05msだった。最終版の森林で影ありGPU中央値371.31msと影なし296.90msの差は約74msだが、別時間帯の観測であり影だけの厳密な時間ではない。遠方Instanceのクリップは実装したが、影最適化だけの寄与や全視点での改善をこのデータから主張しない。診断の生データも保存している。

通常描画のMaterial/Geometry/Texture参照数は森林250/252/18、村全景259/261/16で前後一致した。住宅細部は267/269/18→265/267/18。通常素材とは別に品質樹木MeshごとのcustomDepthMaterialがある。森林の最初の観測後の使用JS Heapは約166.7→209.5MiB、村全景は約172.0→189.5MiB。GCのタイミングと初期ロード状態に依存し、一定のメモリ削減やリークの証拠として扱わない。各窓のHeapとリソース数は集計JSONに記録した。

## 正式な画像比較

いずれも左が参考、中央が改修前、右が最終版。参考とは構図が異なる。改修前後の実カメラ座標は全9視点で完全一致し、[実座標の照合](geometry-upgrade/phase4/actual-camera-comparison.json) に保存した。

- [住宅の横並び比較](geometry-upgrade/phase1/comparison.png): 側面に上階・下階の窓、角の柱、斜め梁が入り、従来の無装飾面を改善した。屋根の棟と端部、窓台と枠の奥行きは細部画像でも確認する。
- [正面](geometry-upgrade/phase1/front.png) / [側面](geometry-upgrade/phase1/side.png) / [細部](geometry-upgrade/phase1/closeup.png): 実ブラウザで読み込み完了を待って撮影した。正面には扉と上階・下階の窓、側面には非対称の窓と斜め梁がある。撮影の成功とShader・GLBエラーなしはdetails-validation.jsonに記録した。
- [森林の横並び比較](geometry-upgrade/phase2/comparison.png): 同じ草株予算で葉幅を細くした。遠景針葉樹の樹冠を連続した段へ修正したが、低ポリゴンの輪郭は残る。
- [広場の横並び比較](geometry-upgrade/phase3/comparison.png): 舗装を入口と通路へ集中させ、木の足元と外周に草地を残した。実カメラは[39,13,-7]、地表11.2882276866mに対して高さ約1.71177m。
- [全景](geometry-upgrade/phase4/overview.png) / [俯瞰](geometry-upgrade/phase4/aerial.png): 既存道路・地形・14棟を含む統合後の景観。

## RTX 4090による補助測定

同じChromium、Seed、Viewport、MSAA、4視点、10秒×3回で測定した。改修前は基準HEADの一時worktreeへ計測用spec/configだけをコピーし、アプリの改修は含めていない。バックエンドは両方ともANGLE / Mesa D3D12 / NVIDIA GeForce RTX 4090。起動は各版1回。条件とソースのハッシュは [provenance.json](geometry-upgrade/provenance.json)、生データは [gpu-before](geometry-upgrade/gpu-before/) と [gpu-after](geometry-upgrade/gpu-after/) に保存した。

| 視点 | Draw Calls | Triangles | CPU描画 ms | GPUクエリ ms | フレーム ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 森林の小道 | 273 → 273 | 424483 → 424067 | 5.50 → 4.10 | 0.191 → 0.186 | 33.3 → 33.4 |
| 住宅細部 | 358 → 359 | 445663 → 452357 | 8.60 → 5.40 | 0.161 → 0.173 | 33.3 → 33.3 |
| 村全景 | 618 → 618 | 671436 → 681796 | 9.60 → 6.90 | 0.189 → 0.194 | 33.4 → 33.4 |
| 正確な広場目線 | 368 → 369 | 431993 → 444486 | 5.60 → 5.00 | 0.154 → 0.160 | 33.4 → 66.6 |

GPUクエリ値は既存EXT_disjoint_timer_query_webgl2の取得値。森林は約2.7%短縮、住宅細部は約7.6%、村全景は約2.2%、正確な広場目線は約4.0%増加した。絶対値はWSL / Mesa / ANGLEの報告に依存し、ネイティブWindowsのGPUプロファイラによる確認ではない。画面更新は各観測窓の中央値でも33.3〜83.5msに揺れ、広場目線の代表値は33.4→66.6msとなる。GPU時間だけで安定したFPSや総合的な改善を主張しない。SwiftShaderの主比較とも混合しない。各観測窓とp95は [実GPU比較JSON](geometry-upgrade/gpu-performance-comparison.json) で確認できる。

森林の影無効化診断のGPUクエリ中央値は0.121→0.129ms。影を含む描画全体との別窓比較であり、影だけの独立GPUタイマーではない。

## Chunk生成とFactory再現性

実ブラウザ測定を止め、各版を直列で3回×100Chunk生成した（最終版→基準版の順）。

| 回 | CPU中央値 ms（前 → 後） | p95 ms（前 → 後） |
| --- | ---: | ---: |
| 1 | 8.74 → 8.57 | 28.70 → 27.85 |
| 2 | 8.18 → 8.20 | 24.81 → 25.14 |
| 3 | 8.63 → 8.08 | 25.35 → 24.90 |

旧Rendererの景観樹木確認処理はこのGeneratorベンチマークに含まれないため、早期終了の削減量をこの値から直接推定しない。対象外Chunkで意味レイヤー取得が呼ばれないことは専用テストで検証した。BrowserのStreaming Request/Commit時間は観測データに保存し、取得できないworkerGenerationMs等はnullとしている。初回World起動の所要時間分布は未測定。

Factoryを最終版で再実行してCatalogの完全一致を確認した。69素材・158ファイルすべてで内容ハッシュがファイル名と一致する。[再生成検証](geometry-upgrade/factory-repeat-validation.json) と [改修前素材計測](geometry-upgrade/asset-measurements-before.json) / [改修後素材計測](geometry-upgrade/asset-measurements-after.json) に各LODの三角形、Material、Texture、Bounds、サイズを記録した。

## 検証項目と対応

| 項目 | 検証方法 |
| --- | --- |
| 住宅のSeed再現性・窓・LOD外形 | environment-geometry.test.tsでGLBのバイト一致、4面の窓、全LODのBounds一致を検証。正面・側面・細部をブラウザ撮影。 |
| UV・法線・Texture・MASK | environment-quality.test.tsで元GLBと最適化Runtimeを検証。ブラウザでShaderエラーとGLB取得失敗を監視。 |
| 建物と道路・Collider | alpine-village.test.tsで開始点・道路・建物・石垣の交差を確認。最終Prepared住宅のTrimeshが生成Entityと同じ位置にあり、実車両が壁と接触して通り抜けないことを専用Integrationで確認。 |
| 草の配置・接地・境界 | 既存テストで道路・建物・農地の除外、地表三角形との接地、Chunk分割・生成順の一致を検証。 |
| 共有リソースの寿命 | 既存テストでGeometry/Material/Textureの最後の参照での解放を検証。v3のTexture共有ケースを追加。 |
| 景観樹木の衝突と寿命 | environment-accent-physics.test.tsで実車両の幹接触、樹冠での非接触、Origin Rebase、解放・再読込の単一参照を検証。 |
| 対象外Chunkの計算回避 | getLayersが呼ばれたら失敗する専用テスト。負座標・生成順・所有Chunkの2本一致も検証。 |
| 既存8ワールド＋Alpine VillageとSchema | 全9ワールドのsample-worlds:validate、既存のPreparedデータ検証、[景観定義の照合](geometry-upgrade/world-definition-validation.json)。 |

住宅の衝突検証は、最終生成されたCatalogとColliderファイルを読み、既存WorldRuntimeが解決した代表住宅に対して実施した。ColliderがTrimeshであることとEntity位置の一致を確認し、サンプル車両を壁へ動かして接触Manifoldと非貫通を検証した。重力を止めて壁との接触を分離したIntegrationであり、ブラウザで道路から住宅へ運転する新しいシナリオではない。

## 検証中に確認した時間制限

最初の全E2Eは49件成功し、Alpineだけが全体420秒の時間制限で失敗した。[最初の結果](geometry-upgrade/verification/e2e-first.log) を保存した。全体の待機を600秒へ変更して再実行すると、最後の実走Rebaseの90秒待機が期限に達したが、失敗直後の画面にはRebase 1、Origin [0,192]、車の位置z=200.87mが記録されていた。[失敗時の詳細](geometry-upgrade/verification/e2e-rebase-timeout.md) と [画面](geometry-upgrade/verification/e2e-rebase-timeout.png) を保存した。RuntimeのRAFは約466msで、Engineは1描画フレームの物理時間を最大0.1秒に制限するため、低FPSでは実走到達に壁時計時間が多く必要になる。全体600秒、Rebase待機180秒として、Rebase回数の増加・景観の絶対座標維持という検証条件を維持した。物理設定や開始位置を変えてRebaseを発生させる方法は使っていない。

E2Eと並行したUnit全件では既存streaming-frame-budgetの1件が失敗した。50msの実時間予算で2Chunk生成を期待するテストが1Chunkで終了した。E2Eを止めて全件を単独実行すると、51ファイル396件が成功した。対象コードは変更していない。[並行時のログ](geometry-upgrade/verification/tests-concurrent.log) を保存し、最終結果は単独実行のログとする。

最終版のAlpineシナリオは7.1分で成功した。車の実走によってOrigin [0,0,0]→[0,0,192]、Rebase 0→1となり、風車の絶対位置[-205,15.3146409988,-65]は前後一致した。[実走RebaseのJSON](geometry-upgrade/verification/alpine-rebase/rebase.json)、[直前](geometry-upgrade/verification/alpine-rebase/before-rebase.png)、[直後](geometry-upgrade/verification/alpine-rebase/after-rebase.png)を保存した。

## 最終チェックの結果

| チェック | 結果 | 証跡 |
| --- | --- | --- |
| pnpm typecheck | 成功 | [型チェック](geometry-upgrade/verification/typecheck.log) |
| pnpm lint | 成功、循環依存なし | [Lint](geometry-upgrade/verification/lint.log) |
| pnpm test | 51ファイル396件成功（Unit 35ファイル306件、Integration 16ファイル90件） | [全件ログ](geometry-upgrade/verification/tests.log) |
| pnpm build | Studio・Player・Server成功 | [Build](geometry-upgrade/verification/build.log) |
| pnpm sample-worlds:prepare | 成功、再実行でCatalog一致 | [Prepare](geometry-upgrade/verification/prepare.log) |
| pnpm sample-worlds:validate | 全9ワールド成功、69素材・35Runtimeファイル・129論理参照 | [Validate](geometry-upgrade/verification/validate.log) |
| pnpm test:e2e | 最終版の全50件成功、20.4分 | [最終E2Eログ](geometry-upgrade/verification/e2e-final.log) / [成功状態](geometry-upgrade/verification/e2e-last-run.json) |
| SwiftShader比較 | 8視点×10秒×3回、正確な目線1視点×10秒×3回を前後で成功 | [最終8視点](geometry-upgrade/verification/after.log) / [目線](geometry-upgrade/verification/eye-after.log) |
| RTX 4090比較 | 4視点×10秒×3回を前後で成功 | [GPU改修前](geometry-upgrade/verification/gpu-before.log) / [GPU最終版](geometry-upgrade/verification/gpu-after.log) |
| 住宅の追加撮影 | 正面・側面・細部を成功 | [撮影ログ](geometry-upgrade/verification/details.log) |
| 証跡の構成 | 必須29ファイルが存在し、内容あり | [証跡検証](geometry-upgrade/evidence-validation.json) |

通常テストが更新した従来のdocs/evidence・docs/screenshotsは元に戻し、新規テスト出力は一時ディレクトリへ退避した。今回の正式な画像・性能・検証ログはgeometry-upgrade内へ保存している。[最終検証結果](geometry-upgrade/validation-results.json) と [変更ファイル一覧](geometry-upgrade/changed-files.json) も併記する。変更は作業ブランチのローカル作業ツリーにあり、コミット・Pushは行っていない。
