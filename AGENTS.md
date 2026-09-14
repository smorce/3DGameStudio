`wait_agent` を呼ぶたびに、`timeout_ms` には完了までの推定残り時間の2倍をミリ秒で明示する。ツール定義の最短・最大待機時間の範囲に収め、見積もれない場合は既定時間を明示する。通知で途中解除されるため、短い確認のために待機時間を縮めない。タイムアウト後は完了見込みを更新して同じ基準で待つ。

環境構築はuvを使ってグローバルには入れないで。

## Playwright / Chromium

「Executable doesn't exist … playwright/chromium_headless_shell-…」と出ても、Chromium が無いとは限らない。多くの場合 `PLAYWRIGHT_BROWSERS_PATH` が空のサンドボックスキャッシュ（例: `/tmp/cursor-sandbox-cache/<別hash>/playwright`）を指しているだけ。

対処:
1. 既存キャッシュを探す（例: `/tmp/cursor-sandbox-cache/*/playwright`、`~/.cache/ms-playwright`）。`chromium-1243` / `chromium_headless_shell-1243` が入っているディレクトリを使う。
2. 空の `PLAYWRIGHT_BROWSERS_PATH` 先へ、実体があるキャッシュへ symlink する（またはその実行だけ `PLAYWRIGHT_BROWSERS_PATH=<実体>` を付けて走らせる）。
3. そのうえで `pnpm observe run <scenario>` などを再実行する。
