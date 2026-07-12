Bluesky専用パソコン用クライアントアプリ　Aerune(エアルネ)

ログインにはBlueskyの「アプリパスワード」を使用してください。

## Mac版をご利用の方へ（初回起動時の注意）※v2.5.1以前の場合

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

## 画像透かし

Electron版では、投稿画像に透過PNGまたはテキストの透かしを合成できます。設定画面で位置、サイズ、不透明度、文字色、影を指定できます。元のローカル画像ファイルは変更せず、投稿用の画像データだけを生成します。

## 動画圧縮

Electron版には、macOS arm64向けの動画圧縮機能を含みます。Windows x64では、監査済みLGPL構成のFFmpegを `vendor/ffmpeg/win32-x64/ffmpeg.exe`（開発時）または `Resources/bin/ffmpeg/win32-x64/ffmpeg.exe`（配布時）に配置した場合に同じ圧縮経路を使用します。

- FFmpegは独立したコマンドライン実行ファイルとして同梱し、`child_process.spawn` から呼び出します。
- 同梱するmacOS arm64版FFmpegはLGPL構成でビルドし、H.264エンコードには `h264_videotoolbox` を使用します。
- Windows x64版では `h264_mf` を実行時に検査し、利用できない場合は `libopenh264` へフォールバックします。
- Linux版の動画圧縮は公式サポート対象外です。必要な場合は利用者側のFFmpeg環境設定に委ねます。
- libx264/libx265/libfdk-aacなど、GPLまたはnonfree構成になるFFmpegコンポーネントは有効化しません。

同梱FFmpegのビルド:

```bash
scripts/build-ffmpeg-darwin-arm64.sh
```

LGPL構成の検査:

```bash
scripts/check-ffmpeg-lgpl.sh vendor/ffmpeg/darwin-arm64/ffmpeg
scripts/check-ffmpeg-lgpl.sh vendor/ffmpeg/win32-x64/ffmpeg.exe win32-x64
```

Release添付用のFFmpegライセンス/ソース資料の作成:

```bash
scripts/package-ffmpeg-compliance.sh
```

Electron版の配布物には、同梱FFmpegバイナリに対応するソース、ビルド設定、差分、チェックサム、ライセンス文書を含めます。

## ライセンス
MIT License

## 開発者
がる ([@garuneko](https://garuneko.com))
iOS/iPadOS https://apps.apple.com/app/aerune/id6759705337

# Aerune - Bluesky Desktop Client

A dedicated desktop client application for Bluesky.
Please use your Bluesky "App Password" to log in.

## For Mac Users (First Launch Instructions) For versions prior to v2.5.1

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

## Image Watermarking

The Electron version can apply a transparent PNG or text watermark to post images. Settings include position, size, opacity, text color, and shadow. Aerune does not modify the original local image file; it only generates image data for posting.

## Video Compression

The Electron version includes video compression for macOS arm64. On Windows x64, the same compression path is enabled when an audited LGPL FFmpeg binary is available at `vendor/ffmpeg/win32-x64/ffmpeg.exe` for development or `Resources/bin/ffmpeg/win32-x64/ffmpeg.exe` in packaged builds.

- FFmpeg is shipped as an independent command-line executable and invoked with `child_process.spawn`.
- The bundled macOS arm64 FFmpeg build uses an LGPL configuration and `h264_videotoolbox` for H.264 encoding.
- Windows x64 checks `h264_mf` at runtime and falls back to `libopenh264` when Media Foundation encoding is unavailable.
- Linux video compression is not an officially supported target. Users who need it should rely on their own FFmpeg environment.
- GPL or nonfree FFmpeg components, including libx264/libx265/libfdk-aac, are not enabled.

Build the bundled FFmpeg binary with:

```bash
scripts/build-ffmpeg-darwin-arm64.sh
```

Verify the LGPL configuration with:

```bash
scripts/check-ffmpeg-lgpl.sh vendor/ffmpeg/darwin-arm64/ffmpeg
scripts/check-ffmpeg-lgpl.sh vendor/ffmpeg/win32-x64/ffmpeg.exe win32-x64
```

Create the FFmpeg source/license archive for release uploads with:

```bash
scripts/package-ffmpeg-compliance.sh
```

Electron releases include the matching FFmpeg source materials, build configuration, local changes, checksum, and license texts for the exact binary shipped with Aerune.

## License

MIT License

## Developer

garu ([@garuneko](https://garuneko.com))
iOS/iPadOS https://apps.apple.com/app/aerune/id6759705337

## Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io/),
certificate by [SignPath Foundation](https://signpath.org/).

### Team roles

- Committer and reviewer: Mitsuki Hamada
- Approver: Mitsuki Hamada

### Privacy

Aerune communicates with Bluesky/AT Protocol services only when requested
by the user. For details, see the privacy policy.
