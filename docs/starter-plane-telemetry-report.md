# Starter Plane Telemetry調査レポート

## 症状

全開Throttle、Steering 0でStarter Planeを10秒間、固定Physics Step 600回実行した。従来テストは最大高度差を見ていたため、短時間の浮上を離陸成功として扱う可能性があった。

## 判定方法

安定離陸は、次の条件を60 Physics Step（1秒）連続で満たすこととした。

- 高さが1.5mを超える
- 全Landing Gearが非接地
- World Space速度が20m/sを超える
- `liftToWeightRatio`が1を超える
- `abs(pitchRad)`が0.8rad未満

接地情報はRapier 0.19.3の`wheelIsInContact()`を使用した。比較ログは次のファイルに保存している。

- [修正前ログ](evidence/starter-plane-before.jsonl)
- [修正後ログ](evidence/starter-plane-after.jsonl)
- [迎角ゼロ比較](evidence/starter-plane-zero-angle.jsonl)
- [弱Thruster比較](evidence/starter-plane-weak-thruster.jsonl)
- [翼面積減少比較](evidence/starter-plane-reduced-wing.jsonl)
- [数値比較JSON](evidence/starter-plane-comparison.json)

## テレメトリーで観測した事実

修正前の主翼角は+18度だった。

- 速度はStep 82で20.01m/sに到達し、速度不足だけが最初の問題ではなかった。
- 高さ1.5m以上かつ非接地になったのはStep 175、速度31.30m/sだった。
- しかし同じStepで`liftToWeightRatio`は-1.14で、持続的な上向き揚力を満たしていなかった。
- Step 227では速度が19.81m/sへ下がり、Step 251ではPitch絶対値が0.8radを超えた。
- 最大高度は7.20mに達したが、10秒後の高度は-34.64mだった。
- Pitchの全期間振動幅は2.32rad、Lift/Weight比は-2.24から4.67まで変動した。
- Machine質量は189kg、重量は1854.09Nだった。

この順序から、単純なThruster推力不足ではなく、速度が出た後の主翼空力と機体Pitchの組み合わせが、揚力の上下反転と再落下を引き起こしていると判断した。接地情報も取得でき、修正前は接地輪数が0から2、4へ変化する期間がありましたが、PitchとLiftの変動は接地が消えた後にも継続したため、脚だけを原因とする証拠にはならなかった。

## 原因

原因はStarter Planeの主翼迎角が現在のPanel空力モデルの符号規約と機体の質量・姿勢変化に対して大きすぎることだった。

主翼角+18度では、十分な速度の後にLift/Weight比が正負へ大きく振れ、Pitchが増幅し、速度と機体前方姿勢が崩れた。その結果、最大高度だけは一時的に増えるが、安定離陸条件を満たさず落下した。

## 比較実験

各実験は他の条件を変えず、600 Physics Stepで実行した。

- 主翼角+18度：安定条件の最長連続は34 Step、最大速度31.39m/s、最大高度7.20m、最終高度-34.64m。
- 主翼角0度：安定条件の最長連続は37 Step。最大高度61.68mでもPitch絶対値は1.18radに達し、単発の上昇を成功扱いできない。
- Thrusterを各1600から400へ変更：安定条件は0 Step、最大速度19.46m/s、最大Lift/Weight比0.59。
- 主翼外側4枚を除去：安定条件は110 Stepで標準機より短く、Pitch絶対値は1.49radだった。
- 主翼角-8度：安定条件の最長連続は155 Stepとなり、標準条件で60 Step以上を満たした。

この比較から、推力を極端に増やす修正ではなく、現在のPanel空力モデルで揚力が機体姿勢を崩さない迎角へ変更する方針を採用した。

## 実施した修正

[packages/machine-system/src/index.ts](../packages/machine-system/src/index.ts) のStarter Plane主翼角を+18度から-8度へ変更した。質量、重力、Thruster出力、Physics固定Stepは変更していない。

判定条件を満たす修正後の安定離陸はStep 346（5.77秒）、開始速度20.02m/s（72.08km/h）だった。最長連続は155 Step、最大高度55.34m、最大速度39.41m/s、Pitch振動幅1.48rad、安定判定後の最低高度7.21mだった。

修正後も10秒間の後半ではLift/Weight比が1を下回る期間とPitchの増加が残る。今回の完了条件である1秒連続の安定離陸は満たすが、長時間巡航の安定性や自動Pitch制御までは今回の修正範囲に含めていない。

## 回帰確認

- `RuntimeTelemetry`の速度計算、m/sからkm/hへの変換、開始・停止・クリア、Ring Buffer上限、JSON/JSON Lines ExportをUnit Testで確認。
- Rapier RigidBodyの`linvel()`、`angvel()`、質量、固定Step番号、Panel空力集計、Thruster集計、Landing Gear接地・サスペンション値との一致をIntegration Testで確認。
- 車、飛行機、ボートは同じEngine Telemetry経路を使用する。
- StudioとPlayerの速度HUDは`worldSpeedMps`を3.6倍した整数km/hを表示し、EDIT中は表示しない。
- 弱いThruster、主翼角0度、翼面積減少、一瞬の浮上を安定離陸と扱わない条件を回帰テストに追加した。

## 既知の制約

- `liftToWeightRatio`はLiftベクトルのWorld Y成分を重量で割った値であり、詳細なPanelごとのログは通常モードで保存しない。
- 現在のHUDは最新のWorld Space速度を表示するだけで、Windを考慮したAirspeedは未実装。
- Starter Planeの10秒後半にはLift/Weight比とPitchの長時間変動が残っている。
- Ground Clearanceの地形絶対値はまだ共通Telemetry項目にしておらず、今回の離陸判定では高さとWheel接地情報を併用した。
