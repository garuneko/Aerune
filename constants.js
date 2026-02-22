// constants.js (v2.0.1)
// SVGをspanキャッシュとして事前生成し、getIconの都度生成コストをゼロに

const SVG_ICONS = {
    repost: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M7 8H16 A3 3 0 0 1 19 11V13M19 13l-1.6-1.6M19 13l1.6-1.6M17 16H8 A3 3 0 0 1 5 13V11M5 11l1.6 1.6M5 11l-1.6 1.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    reply:  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M10 9L6 12l4 3M7 12h7c4 0 6 2 7 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    refresh:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M20 12a8 8 0 0 1-13.657 5.657M4 12a8 8 0 0 1 13.657-5.657M18 4v4h-4M6 20v-4h4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    pin:    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g transform="rotate(-25 12 12)"><circle cx="12" cy="6.6" r="3.6" fill="#3b82f6" stroke="#1d4ed8" stroke-width="1.6"/><path d="M9.5 9.6h5l-1.1 4.7H10.6L9.5 9.6zM12 14.3 L12 22.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`,
    like:   `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M10.94,20.38c.19-.16.39-.31.6-.43,5.1-4.63,8.46-7.7,8.46-11.46,0-2.5-2-4.5-4.5-4.5-1.74,0-3.41.81-4.5,2.09-1.09-1.28-2.76-2.09-4.5-2.09-2.5,0-4.5,2-4.5,4.5,0,3.78,3.4,6.86,8.55,11.53l.39.35Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
    trash:  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 7h16M10 11v7M14 11v7M6 7l1 14h10l1-14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1-1v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    quote:  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM13 8l-3 3 3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    bookmark:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    image:  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M7.5 14l2.5-2.8 3.2 3.6 2.2-2.4 2.6 2.9"/><path d="M12 4.5v6"/><path d="M9.8 7l2.2-2.2L14.2 7"/></svg>`
};

// 事前に生成済みのHTML文字列をキャッシュ
const ICON_CACHE = Object.create(null);
for (const [k, v] of Object.entries(SVG_ICONS)) {
    ICON_CACHE[k] = `<span class="svg-icon">${v}</span>`;
}

const translations = {
    ja: {
        nav_home:"ホーム",nav_notifications:"通知",nav_search:"検索",nav_profile:"プロフィール",nav_thread:"スレッド",nav_chat:"チャット",nav_settings:"設定",nav_bookmarks:"ブックマーク",
        add_account:"＋ アカウント追加",logout:"ログアウト",post_placeholder:"今なにしてる？",send:"送信",
        login_title:"Aerune ログイン",login_id:"ハンドル名 (handle.bsky.social)",login_pw:"アプリパスワード",login_btn:"ログイン",
        reply_placeholder:"@{0} への返信",quote_placeholder:"@{0} を引用中...",login_failed:"ログインに失敗しました。",post_failed:"投稿に失敗しました。下書きは保持されています。",
        delete_confirm:"このポストを削除しますか？",delete_failed:"削除に失敗しました。",
        follow_me:"フォローされています",following:"フォロー中",mutual:"相互フォロー",send_dm:"✉️ DM",
        chat_placeholder:"メッセージを入力...",
        notif_like:"があなたのポストをいいねしました",notif_repost:"があなたのポストをリポストしました",
        notif_follow:"があなたをフォローしました",notif_mention:"があなたをメンションしました",
        notif_reply:"があなたに返信しました",notif_quote:"があなたのポストを引用しました",
        search_btn:"検索",search_placeholder:"検索キーワードを入力...",reposted_by:"🔁 {0} がリポスト",logout_confirm:"現在のアカウントからログアウトしますか？",
        profile_reply:"＠ リプライ",
        settings_general:"一般設定",settings_moderation:"モデレーション",
        settings_lang:"言語 / Language",settings_limit:"TLや検索の読み込み件数 (10〜100)",settings_save:"保存",settings_saved:"設定を保存しました",
        settings_nsfw:"NSFW画像にぼかしを入れる",settings_mutes:"ミュート中のアカウント",settings_blocks:"ブロック中のアカウント",
        settings_bookmark_tab:"サイドバーにブックマークを表示する",
        settings_time_format:"投稿時刻の表示形式",settings_time_relative:"相対表示（〇分前）",settings_time_absolute:"絶対表示（日時）",
        pinned_post:"固定されたポスト",
        ctx_reply:"返信",ctx_repost:"リポスト",ctx_quote:"引用",ctx_profile:"プロフィールを見る",
        ctx_pin:"固定ポストに設定",ctx_unpin:"固定ポストを解除",
        ctx_follow:"フォロー",ctx_unfollow:"フォロー解除",
        ctx_mute:"ミュート",ctx_unmute:"ミュート解除",
        ctx_block:"ブロック",ctx_unblock:"ブロック解除",
        ctx_bookmark:"ブックマークに追加",ctx_unbookmark:"ブックマークを外す",
        save_image:"💾 画像を保存",action_success:"完了しました",
        stats_posts:"ポスト",stats_following:"フォロー",stats_followers:"フォロワー",
        error_details:"【詳細なエラー理由】",network_check:"ネットワーク制限の可能性があります。ブラウザで原因を確認しますか？",
        post_too_long:"ポストが長すぎます。{0}文字オーバーしています。",
        no_bookmarks:"ブックマークはありません",
        bookmark_failed:"ブックマークの操作に失敗しました。",
        login_empty:"IDとパスワードを入力してください。",
        login_app_pw_req:"Aeruneでのログインには、Bluesky公式で発行した「アプリパスワード」が必要です。\n（通常のログインパスワードは使えません）\n\nブラウザを開いて設定画面へ移動しますか？",
        login_invalid:"ID（ハンドル名）またはパスワードが間違っています。\n入力内容をご確認ください。",
        login_rate_limit:"ログイン試行回数が上限に達しました。\nしばらく時間を置いてから再度お試しください。",
        login_network:"通信エラーが発生しました。\nネットワーク接続を確認してください。",
        login_unknown:"原因を調べるためにブラウザ版を開きますか？"
    },
    en: {
        nav_home:"Home",nav_notifications:"Notifications",nav_search:"Search",nav_profile:"Profile",nav_thread:"Thread",nav_chat:"Chat",nav_settings:"Settings",nav_bookmarks:"Bookmarks",
        add_account:"+ Add Account",logout:"Logout",post_placeholder:"What's up?",send:"Post",
        login_title:"Login to Aerune",login_id:"Handle (handle.bsky.social)",login_pw:"App Password",login_btn:"Login",
        reply_placeholder:"Reply to @{0}",quote_placeholder:"Quoting @{0}...",login_failed:"Login failed.",post_failed:"Post failed. Draft is kept.",
        delete_confirm:"Are you sure you want to delete this post?",delete_failed:"Failed to delete.",
        follow_me:"Follows you",following:"Following",mutual:"Mutual",send_dm:"✉️ Message",
        chat_placeholder:"Type a message...",
        notif_like:"liked your post",notif_repost:"reposted your post",
        notif_follow:"followed you",notif_mention:"mentioned you",
        notif_reply:"replied to you",notif_quote:"quoted your post",
        search_btn:"Search",search_placeholder:"Enter keyword...",reposted_by:"🔁 Reposted by {0}",logout_confirm:"Are you sure you want to log out of the current account?",
        profile_reply:"@ Reply",
        settings_general:"General",settings_moderation:"Moderation",
        settings_lang:"言語 / Language",settings_limit:"Timeline limit (10-100)",settings_save:"Save",settings_saved:"Settings saved",
        settings_nsfw:"Blur NSFW Images",settings_mutes:"Muted Accounts",settings_blocks:"Blocked Accounts",
        settings_bookmark_tab:"Show Bookmarks in sidebar",
        settings_time_format:"Post time display",settings_time_relative:"Relative (X min ago)",settings_time_absolute:"Absolute (date & time)",
        pinned_post:"Pinned Post",
        ctx_reply:"Reply",ctx_repost:"Repost",ctx_quote:"Quote",ctx_profile:"View Profile",
        ctx_pin:"Pin Post",ctx_unpin:"Unpin Post",
        ctx_follow:"Follow",ctx_unfollow:"Unfollow",
        ctx_mute:"Mute",ctx_unmute:"Unmute",
        ctx_block:"Block",ctx_unblock:"Unblock",
        ctx_bookmark:"Add to Bookmarks",ctx_unbookmark:"Remove Bookmark",
        save_image:"💾 Save Image",action_success:"Success",
        stats_posts:"Posts",stats_following:"Following",stats_followers:"Followers",
        error_details:"[Error Details]",network_check:"Possible network restriction. Would you like to check in your browser?",
        post_too_long:"Post is too long. It exceeds the limit by {0} characters.",
        no_bookmarks:"No bookmarks found.",
        bookmark_failed:"Failed to process bookmark.",
        login_empty:"Please enter your ID and password.",
        login_app_pw_req:"Aerune requires an 'App Password' generated from the official Bluesky settings.\n(Your regular login password will not work.)\n\nOpen browser to go to the settings page?",
        login_invalid:"Incorrect ID (handle) or password.\nPlease check your input.",
        login_rate_limit:"Rate limit exceeded.\nPlease wait a moment and try again.",
        login_network:"A network error occurred.\nPlease check your connection.",
        login_unknown:"Would you like to open the browser to investigate the cause?"
    }
};

module.exports = { SVG_ICONS, ICON_CACHE, translations };
