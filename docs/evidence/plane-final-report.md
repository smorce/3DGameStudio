# Starter Plane 最終レポート

## A. Terrain Edge問題

- 旧128m TerrainのWorld範囲は `-64m <= x,z <= 64m` で、旧テストの `forwardDistance > 80m` はTerrain外を含み得た。
- 専用Edge Fixtureは32m Terrain（前方境界 `+16m`）を使用した。
- Edge FixtureではPhysics Step 85、前進距離16.106mで `terrainAvailable=false` になった。この時点の `groundedWheelCount` は2で、その後Terrain外で0輪になるSampleも存在した。
- Edge Fixtureの600 Step中、Terrain内は84 Sample、Terrain外は516 Sampleだった。
- Terrain外の試験では `stableTakeoff=false` であり、Terrain外への移動は離陸成功にならなかった。

## B. ガタつきの原因

- 修正前相当設定（主翼6°、尾翼0°、rest length 0.35m、relaxation 1）では、Lift変化とSuspension変化がStep 105、Vertical Speed/Pitch変化がStep 114、Wheel Contact変化がStep 130から発生した。
- Contactが最初ではなく、LiftおよびSuspensionの変化が先行していたため、Terrain Edgeではない空力・Landing Gear相互作用が主因だった。
- 修正前相当のPitch振幅は1.164rad、Suspension長振幅は高速区間で0.530mだった。
- 最終設定ではPitch振幅0.395rad、高速区間のSuspension長振幅0.335mまで低下した。

## C. Suspension修正

- WheelごとのOptional Suspension Settingsを追加し、Car/Boatの既存データには未指定のまま既定値を適用できるようにした。
- Starter Planeでは、Telemetryで初期接地遅れとSuspensionの過大圧縮を確認したため、rest lengthを0.35mから1.0m、relaxationを1から4へ変更した。
- 修正前相当の低速区間はSuspension長振幅0.492m、最大Force 1502Nだった。
- 最終設定の低速区間はSuspension長振幅0.350m、最大Force 780Nだった。
- 最終設定ではSuspension ForceのMax Force張り付きは0回で、Contact Toggleは各Wheel 1〜2回だった。

## D. 空力再評価

- 1024m Flat Test Worldで、+4°、+6°、+8°、+10°、+12°を同一条件で再測定した。
- +4°と+6°は3秒のStable Flight条件を満たさず、+8°、+10°、+12°は条件を満たした。
- +8°はLiftoff Step 168、Liftoff Forward Speed 37.547m/s、最大Pitch絶対値0.248radで、最終Starter Planeに採用した。
- Pitch Moment Telemetryは `@dimforge/rapier3d-compat` 0.19.3 の `RigidBody.worldCom()`（world-space center of mass）まわりに `r x F` を集計する。複数Colliderを異なる位置へ置く機体では、RigidBody原点（`translation()`）と質量中心は一致しない。Starter Planeでは質量中心が原点より約0.86m上・約0.59m後方にあり、推力線は質量中心に近い。実際の空力・推力は `addForceAtPoint()` でRapierへ渡しているため飛行物理自体はもともと質量中心まわりで計算されており、この差が影響するのは原因解析用Pitch Moment Telemetryの数値である。
- 当時の最終Telemetryはtranslation基準だったため、Thruster Pitch Momentは約2942Nmで安定して見えた。worldCom基準では同じ推力でもPitch Momentは大幅に小さくなる。Aerodynamic Pitch Momentの主な変動がMain WingとHorizontal Tailから発生する、という役割別の見方はそのTelemetry内訳として引き続き有効である。

## E. 最終飛行結果

- Runway distance before liftoff: 約48.8m
- Liftoff speed: 37.547m/s
- Liftoff time: 2.800s
- Post-liftoff stable flight duration: 2.983s（180 Physics Sample window）
- Final height above terrain: 56.465m
- Minimum height after liftoff: 1.075m
- Maximum pitch: 0.248rad
- Pitch range: 0.395rad
- Average vertical speed: 7.681m/s
- Final forward speed: 37.562m/s
- 600 Step全SampleでTerrain内を維持し、Stable Flight中のWheel Contactは0だった。

## F. 実際のStudio動作

- Plane起動時に1024m Flat World Patchを適用し、Studioでも128m Terrainを使用しない構成にした。
- ブラウザでPlane新規作成、Play、W入力、前進コントロール保持を確認した。前進コントロールを3秒保持するとSpeed表示は135km/hになり、さらに3秒保持してもStudioはエラーにならず、PlaneとTerrainの表示が移動した。
- Play終了操作も正常に完了した。
- Terrain Edgeからの落下は成功扱いにしない。

## Evidence

- `plane-ground-roll-before.jsonl`
- `plane-ground-roll-before-summary.json`
- `plane-ground-roll-after.jsonl`
- `plane-terrain-edge.jsonl`
- `plane-terrain-edge-summary.json`
- `plane-long-runway-before.jsonl`
- `plane-long-runway-after.jsonl`
- `plane-suspension-analysis.json`
- `plane-wing-angle-sweep-v2.json`
- `plane-flight-final.jsonl`
- `plane-flight-final-summary.json`
