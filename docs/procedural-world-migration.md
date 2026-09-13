# Procedural World Migration

## v5 → v6

`parseProject` は v5 Project を次のように移行する。

- `schemaVersion` を 6 にする
- `world.source` がなければ `{ kind: "finite" }` を補う
- `world.edits` がなければ空の `terrainChunks` と `generatedEntityTombstones` を補う
- `world.terrain` の heights / colors / size / resolution / seed は変更しない
- Water / Entities / Courses / Machines / Assets は保持する

旧ユーザープロジェクトは有限Heightmapのまま残る。Procedural Worldへ自動変換しない。

## 新規Starter

Studioの初期選択だけが Environment Preset を選ぶ。

- くるま → `grassland`
- ひこうき → `airfield`
- ボート → `archipelago`

`createStarterWorld({ preset, seed })` が共通Factoryである。Machine名でWorldを判定しない。

## 将来

Legacy finite World を明示的に Procedural へ変換する機能は、`source.kind` を差し替える余地を残している。今回UIは追加しない。
