# Project Model

`Project`はschemaVersion、id、name、world、courses、machines、assets、missions、settingsを持ちます。座標は右手系でYが上、マシン前方が+Z、寸法はメートルです。回転はXYZ Eulerラジアンです。

Machineはparts／connections／controlBindingsを保持します。Partには種類、transform、visual、physics、connectors、actuator、metadataがあります。Worldは地形格子、水、配置物、照明、環境、スポーン地点とチャンク寸法を保持します。Courseは道の点列、開始／終了、順序付きチェックポイント、障害物、リスポーン候補を保持します。

Assetはファイル参照とProvenanceを保存し、バイナリーを埋め込みません。`runtimeInfo`に境界寸法・三角形数・Box Collider方針を追加できます。GLBの実行参照は内部の `/api/files/...` に制限します。

`parseProject(unknown)`はバージョン0を1へ移行します。バージョン0にmissionsがなければ空配列を追加します。未対応バージョン、不正な数値、配列長、重複ID、存在しない接続・素材・コース参照は拒否します。読込に失敗しても現在のCommandBusを置き換えません。未知の新バージョンを推測して解釈しません。

固定例は `tests/fixtures`、生成スクリプトは `scripts/prepare-demos.ts` にあります。
