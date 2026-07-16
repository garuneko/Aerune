# Aerune Electron リファクタリング / Electron Refactoring

リリース日 / Release date: 2026-07-16

## 日本語

### 主な変更

- OSの外観設定に連動するシステムダークモードを追加しました。
- ウォーターマーク設定へのショートカットとライブプレビューを追加し、候補画像の探索処理を改善しました。
- 同種の通知をまとめて表示し、リアクションやリポストの詳細をモーダルで確認できるようにしました。
- 返信チェーンに青い接続線を追加し、ネストしたスレッドを再帰的に表示できるようにしました。
- 表示ロジックのNode.jsテストを追加し、主要なUI判定を自動検証できるようにしました。
- 実装内容と検証結果を `WORK_LOG.md` に記録しました。

### 検証

- `npm test`: 3件すべて成功
- JavaScript構文チェック: 成功
- `npm run build -- --dir`: macOS arm64向けビルド成功

### 補足

- macOS向けローカルビルドは、開発者証明書がないためコード署名を省略しています。

## English

### Highlights

- Added system dark mode that follows the operating system appearance setting.
- Added a shortcut to watermark settings and a live preview, and improved candidate image discovery.
- Grouped related notifications and added a modal for reviewing reaction and repost details.
- Added blue reply-chain connectors and recursive rendering for nested conversation threads.
- Added Node.js tests for display logic so key UI decisions can be verified automatically.
- Documented the implementation and verification results in `WORK_LOG.md`.

### Verification

- `npm test`: all 3 tests passed
- JavaScript syntax checks: passed
- `npm run build -- --dir`: macOS arm64 build completed successfully

### Notes

- Code signing was skipped for the local macOS build because no developer certificate was available.
