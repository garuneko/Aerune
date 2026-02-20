Bluesky専用パソコン用クライアントアプリ　Aerune(エアルネ)
ログインにはBlueskyの「アプリパスワード」を使用してください。

## Mac版をご利用の方へ（初回起動時の注意）

macOSのセキュリティ機能（Gatekeeper）により、初回起動時に「壊れているため開けません。ゴミ箱に入れる必要があります」などの警告が表示される場合があります。

本アプリはAppleの有料開発者証明書で署名していないため、この警告が表示される場合があります。

### ブロックの解除手順（初回・アプリ更新時）

1. ダウンロードした `.dmg` を開き、中にあるアプリを **「アプリケーション」フォルダ** にドラッグ＆ドロップしてコピーします
2. **「ターミナル」** アプリを開きます（`Finder` → `アプリケーション` → `ユーティリティ` → `ターミナル`）
3. 以下のコマンドをコピー＆ペーストして実行します
```bash
sudo xattr -rd com.apple.quarantine "/Applications/Aerune.app"
```

4. Macのログインパスワードを入力してEnterキーを押します（入力中は画面に文字が表示されませんが正常です）
5. エラーが出なければ完了です。アプリケーションフォルダからアプリを起動してください

## 動作環境
- **Windows**: Windows 10以降
- **macOS**: macOS 11 (Big Sur) 以降

## ライセンス
MIT License

## 開発者
がる ([@garuneko](https://garuneko.com))

# Aerune - Bluesky Desktop Client

A dedicated desktop client application for Bluesky.
Please use your Bluesky "App Password" to log in.

## For Mac Users (First Launch Instructions)

Due to macOS security features (Gatekeeper), you may see a warning message such as "The app is damaged and can't be opened. You should move it to the Trash" when launching the app for the first time.

This warning appears because the app is not signed with Apple's paid developer certificate.

### Steps to Unblock (Required for First Launch and Updates)

1. Open the downloaded `.dmg` file and drag the app into your **Applications** folder
2. Open the **Terminal** app (`Finder` → `Applications` → `Utilities` → `Terminal`)
3. Copy and paste the following command and press Enter:
```bash
sudo xattr -rd com.apple.quarantine "/Applications/Aerune.app"
```

4. Enter your Mac login password and press Enter (characters won't appear on screen while typing, but this is normal)
5. If no error appears, you're done. Launch the app from your Applications folder

## System Requirements

- **Windows**: Windows 10 or later
- **macOS**: macOS 11 (Big Sur) or later

## License

MIT License

## Developer

garu ([@garuneko](https://garuneko.com))

