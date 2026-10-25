# Privacy Policy for Aerune

Effective date: 2026-02-27
Last updated: 2026-10-25

### The App and Its Connections

Aerune is a third-party Bluesky (AT Protocol) client. Credentials, posts, and related data are communicated directly with Bluesky and the AT Protocol services you use, including your account's PDS, for authentication, browsing, posting, and other requested actions. The App does not send credentials, posts, location, or weather request counts to developer-operated servers. Opening external images, videos, or links may also connect to their providers.

### Accounts and Notifications

On iOS / iPadOS, saved-account authentication tokens are stored in the device Keychain. You can remove saved accounts in Settings. Logging out alone does not remove saved accounts. Removing local account data does not delete your Bluesky account or posts. If you allow notifications, the device push token and related registration information are registered with Bluesky's notification service, and Apple's push notification service is used for delivery. You can change notification permission in OS Settings.

### Weather and City Search

The following applies to iOS / iPadOS versions that include Weather. City and region searches use Apple's geocoding service; weather uses WeatherKit. Search terms and the approximate coordinates needed for weather requests are sent to Apple. City search does not use your device's current location. Bluesky credentials are not sent to weather or geocoding services.

### Current Location and Withdrawing Permission

Only when you choose Use current location and grant OS permission does the App obtain a one-time approximate location and send it to Apple. Coordinates are rounded to two decimal places before transmission. The App does not persist your current location, build movement history, access location in the background, or send it to the developer. You can choose a city without allowing location access and change permission at any time in OS Settings. Weather is requested manually, without automatic refresh or automatic posting.

### Weather Storage and Deletion

Your manually selected city and its coordinates rounded to two decimal places are kept in the App's local storage for future selection, until you use Remove saved city on the Weather screen. Weather data is temporarily held in memory for display, not saved in an Aerune-specific database or history. Weather storage is not synchronized to developer-operated servers. Depending on OS settings, local data may be included in device backups and restored.

### Weather Request Count

The month identifier and weather request count are stored locally to enforce a monthly limit of 500 shared by all accounts on this device. Counts are not sent to the developer or Bluesky, and usage is not combined across devices. Months use UTC; the previous record is replaced when usage is next checked on or after 00:00 UTC on the first day of the next month. Failed requests and cancellations after sending count; city searches and denied or failed location access do not. Removing the saved city, logging out, or removing or switching accounts does not reset the count.

### User-Generated Content and Moderation

The App displays User-Generated Content (UGC) from the Bluesky network. There is strictly no tolerance for objectionable content or abusive users. Users have access to built-in features to block or mute other accounts. Users who violate these terms will be immediately subject to blocking and service restrictions.

### External Services and Contact

Information sent to Bluesky / AT Protocol services, Apple, or external content providers is handled under their respective privacy policies.
Apple: https://www.apple.com/legal/privacy/
Bluesky: https://bsky.social/about/support/privacy-policy

Contact: garuneko@gmail.com
If you email us, your email address and message are used to handle your inquiry. Contact the same address to request deletion of inquiry information. Do not send passwords or authentication tokens.

---

## 日本語：Aeruneのプライバシーポリシー

制定日：2026-02-27
改定日：2026-10-25

### アプリと通信先

AeruneはBluesky（AT Protocol）のサードパーティクライアントです。ログイン情報やポスト等は、認証・閲覧・投稿などの操作のため、Blueskyや利用するAT Protocolサービス（アカウントのPDS等）と直接通信します。アプリから開発者のサーバーへ、ログイン情報・ポスト・位置情報・天気の利用回数を送信することはありません。外部の画像・動画・リンクを開く場合は、その提供元とも通信することがあります。

### アカウント・通知

iOS / iPadOS版の保存済みアカウントの認証用トークンは端末のKeychainに保存します。設定から保存済みアカウントを削除できます。ログアウトだけでは保存済みアカウントは削除されません。端末内の削除でBluesky側のアカウントや投稿が削除されることはありません。通知を許可した場合は、配信のため端末のプッシュ通知用トークン等をBlueskyの通知サービスに登録し、Appleの通知配信サービスを使用します。通知の許可はOSの設定から変更できます。

### 天気・都市検索

以下は天気機能を搭載したiOS / iPadOS版に適用します。都市名・地域名の検索にはAppleの地名検索サービス、天気の取得にはWeatherKitを使用します。入力した検索語と、天気の取得に必要なおおよその座標をAppleへ送信します。都市検索では端末の現在地を使用しません。Blueskyの認証情報を天気・地名検索サービスへ送信することもありません。

### 現在地の利用と許可の取り消し

「現在地を使う」を選び、OSで位置情報の利用を許可した場合だけ、おおよその位置情報を単発で取得してAppleへ送信します。送信する座標は小数点以下2桁に丸めます。現在地の永続保存、移動履歴の作成、バックグラウンドでの位置取得、開発者への送信は行いません。位置情報を許可しなくても都市を手動で選べます。許可はOSの「設定」からいつでも変更できます。天気の取得は手動で行い、自動更新・自動投稿は行いません。

### 天気データの保存・削除

手動で選択した都市名と、小数点以下2桁に丸めた座標をアプリの端末内ストレージに保存し、次回の都市選択に使用します。天気画面の「保存した都市を削除」で削除するまで保持します。天気データは表示のため一時的にメモリ上で扱い、Aerune独自のデータベースや履歴として保存しません。天気機能の保存データを開発者のサーバーへ同期することはありません。端末内の保存データは、OSの設定によりバックアップ・復元の対象となる場合があります。

### 天気の利用回数

月の識別情報と天気取得回数を端末内に保存し、全アカウント共通の月500回の上限管理に使用します。回数を開発者やBlueskyへ送信しません。UTCの暦月で区切り、翌月1日0:00 UTC以降に利用状況を確認すると前月の記録を置き換えます。複数端末の回数は合算しません。送信後の失敗・キャンセルも数えますが、都市検索や位置情報の拒否・取得失敗は数えません。保存都市の削除、ログアウト、アカウントの削除・切り替えでも回数はリセットされません。

### ユーザー生成コンテンツとモデレーション

アプリはBlueskyネットワークのユーザー生成コンテンツ（UGC）を表示します。不適切なコンテンツや他者への嫌がらせは認めません。利用者はアプリの機能から他のアカウントをブロック・ミュートできます。これらの規定に違反した利用者は、直ちにブロックやサービスの利用制限の対象となります。

### 外部サービス・お問い合わせ

Bluesky / AT Protocol、Apple、外部コンテンツの提供元に送信した情報は、各提供元のプライバシーポリシーに従って取り扱われます。
Apple：https://www.apple.com/legal/privacy/
Bluesky：https://bsky.social/about/support/privacy-policy

お問い合わせ：garuneko@gmail.com
メールでお問い合わせいただいた場合は、メールアドレスと内容を対応のために使用します。お問い合わせ情報の削除を希望する場合も、この窓口へご連絡ください。パスワードや認証用トークンは送らないでください。
