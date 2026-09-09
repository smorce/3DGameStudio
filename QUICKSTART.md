# クイックスタート

最短で Studio を起動し、車を走らせる手順です。詳細な設計・検証は [README.md](README.md) を参照してください。

## 必要なもの

- Node.js 22.12 以降
- pnpm 10.9
- WebGL2 対応ブラウザー（Chromium 推奨）

## 1. 取得と起動

```sh
git clone https://github.com/smorce/3DGameStudio.git
cd 3DGameStudio
pnpm install
pnpm dev
```

起動後:

| サービス | URL |
| --- | --- |
| Studio | http://localhost:5183/ |
| Server | http://localhost:8787/ |

`pnpm dev` は Studio と Server を同時に起動します。素材の検索・取込には Server が必要です。

## 2. はじめての車

1. Studio を開く → **🚗 くるま**（すぐに走れるよ）を選ぶ
2. **▶ あそぶ** を押す
3. キーボードまたは画面下のボタンで運転する

ゼロから作る場合は **🧱 じゆうにつくる** を選び、板とタイヤを追加してから **▶ あそぶ** してください。

## 3. 操作

| 操作 | キー／操作 |
| --- | --- |
| 前進／後退 | W・↑ / S・↓ |
| 操舵 | A・D / ←・→ |
| ブレーキ | Space |
| リスポーン | R |
| カメラ回転／移動／ズーム | ドラッグ / 右ドラッグ / スクロール |
| Undo / Redo | Ctrl（Cmd）+ Z / Shift + 同上 |

画面下の運転ボタンと、標準ゲームパッドにも対応しています。

## 4. UIの切り替え

同じ保存モデルを、表示だけ切り替えて編集します。

| モード | 用途 |
| --- | --- |
| つくる | 簡単にパーツを置く |
| くわしくつくる | 位置・速度・接続などを細かく調整 |
| Studio | World／Course／Asset／統計など全体編集 |

**■ やめる** で編集画面に戻ります。Play 中の変更は編集モデルへは残りません。

## 5. デモを開く

Studio の JSON 読込で次を開けます。

- [demos/demo-simple-car.json](demos/demo-simple-car.json) … 基本の車
- [demos/demo-island-course.json](demos/demo-island-course.json) … 島コース
- [demos/demo-asset-world.json](demos/demo-asset-world.json) … 外部素材を置いたワールド

## 6. 個別起動

```sh
pnpm dev:studio  # http://localhost:5183
pnpm dev:server  # http://localhost:8787
pnpm dev:player  # http://localhost:5184
```

本番ビルドで確認する場合:

```sh
pnpm build
pnpm start:server
```

→ http://localhost:8787 （Studio） / http://localhost:8787/player/ （Player）

## 7. うまくいかないとき

| 症状 | 確認 |
| --- | --- |
| 5183 で起動できない | 別プロセスがポートを使用していないか確認する |
| 素材検索・取込が失敗する | Server（8787）が起動しているか確認する。`pnpm dev` を使う |
| 画面が真っ黒／描画されない | WebGL2 対応ブラウザーか確認する |
| 依存のエラー | Node.js 22.12+、pnpm 10.9 か確認し、`pnpm install` を再実行する |

環境変数は [.env.example](.env.example) を参照してください。`.env` の自動読込はしません。AI 用の有料 API キーは不要です。

## 次に読むもの

- [README.md](README.md) … 機能・構成・テスト
- [docs/progress.md](docs/progress.md) … 完成条件と証拠
- [KNOWN_ISSUES.md](KNOWN_ISSUES.md) … 既知の制約
