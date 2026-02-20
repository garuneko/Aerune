const { BskyAgent, RichText } = require('@atproto/api'); 
const { ipcRenderer, shell } = require('electron');

const translations = {
    ja: {
        nav_home: "ホーム", nav_notifications: "通知", nav_search: "検索", nav_profile: "プロフィール", nav_thread: "スレッド", nav_chat: "チャット", nav_settings: "設定", nav_bookmarks: "ブックマーク",
        add_account: "＋ アカウント追加", logout: "ログアウト", post_placeholder: "今なにしてる？", send: "送信",
        login_title: "Aerune ログイン", login_id: "ハンドル名 (handle.bsky.social)", login_pw: "アプリパスワード", login_btn: "ログイン",
        reply_placeholder: "@{0} への返信", quote_placeholder: "@{0} を引用中...", login_failed: "ログインに失敗しました。", post_failed: "投稿に失敗しました。下書きは保持されています。",
        delete_confirm: "このポストを削除しますか？", delete_failed: "削除に失敗しました。",
        follow_me: "フォローされています", following: "フォロー中", mutual: "相互フォロー", send_dm: "✉️ DM",
        chat_placeholder: "メッセージを入力...", 
        notif_like: "があなたのポストをいいねしました", notif_repost: "があなたのポストをリポストしました",
        notif_follow: "があなたをフォローしました", notif_mention: "があなたをメンションしました",
        notif_reply: "があなたに返信しました", notif_quote: "があなたのポストを引用しました",
        search_btn: "検索", search_placeholder: "検索キーワードを入力...", reposted_by: "🔁 {0} がリポスト", logout_confirm: "現在のアカウントからログアウトしますか？",
        profile_reply: "＠ リプライ",
        settings_general: "一般設定", settings_moderation: "モデレーション",
        settings_lang: "言語 / Language", settings_limit: "TLや検索の読み込み件数 (10〜100)", settings_save: "保存", settings_saved: "設定を保存しました", 
        settings_nsfw: "NSFW画像にぼかしを入れる", settings_mutes: "ミュート中のアカウント", settings_blocks: "ブロック中のアカウント",
        pinned_post: "固定されたポスト",
        ctx_reply: "💬 返信", ctx_repost: "🔁 リポスト", ctx_quote: "📝 引用", ctx_profile: "👤 プロフィールを見る",
        ctx_pin: "📌 固定ポストに設定", ctx_unpin: "📌 固定ポストを解除",
        ctx_follow: "➕ フォロー", ctx_unfollow: "➖ フォロー解除",
        ctx_mute: "🔇 ミュート", ctx_unmute: "🔊 ミュート解除",
        ctx_block: "🚫 ブロック", ctx_unblock: "✅ ブロック解除",
        ctx_bookmark: "🔖 ブックマークに追加", ctx_unbookmark: "🔖 ブックマークを外す",
        save_image: "💾 画像を保存", action_success: "完了しました",
        stats_posts: "ポスト", stats_following: "フォロー", stats_followers: "フォロワー",
        error_details: "【詳細なエラー理由】", network_check: "ネットワーク制限の可能性があります。ブラウザで原因を確認しますか？",
        post_too_long: "ポストが長すぎます。{0}文字オーバーしています。",
        no_bookmarks: "ブックマークはありません",
        bookmark_failed: "ブックマークの操作に失敗しました。"
    },
    en: {
        nav_home: "Home", nav_notifications: "Notifications", nav_search: "Search", nav_profile: "Profile", nav_thread: "Thread", nav_chat: "Chat", nav_settings: "Settings", nav_bookmarks: "Bookmarks",
        add_account: "+ Add Account", logout: "Logout", post_placeholder: "What's up?", send: "Post",
        login_title: "Login to Aerune", login_id: "Handle (handle.bsky.social)", login_pw: "App Password", login_btn: "Login",
        reply_placeholder: "Reply to @{0}", quote_placeholder: "Quoting @{0}...", login_failed: "Login failed.", post_failed: "Post failed. Draft is kept.", 
        delete_confirm: "Are you sure you want to delete this post?", delete_failed: "Failed to delete.",
        follow_me: "Follows you", following: "Following", mutual: "Mutual", send_dm: "✉️ Message",
        chat_placeholder: "Type a message...", 
        notif_like: "liked your post", notif_repost: "reposted your post",
        notif_follow: "followed you", notif_mention: "mentioned you",
        notif_reply: "replied to you", notif_quote: "quoted your post",
        search_btn: "Search", search_placeholder: "Enter keyword...", reposted_by: "🔁 Reposted by {0}", logout_confirm: "Are you sure you want to log out of the current account?",
        profile_reply: "@ Reply",
        settings_general: "General", settings_moderation: "Moderation",
        settings_lang: "言語 / Language", settings_limit: "Timeline limit (10-100)", settings_save: "Save", settings_saved: "Settings saved", 
        settings_nsfw: "Blur NSFW Images", settings_mutes: "Muted Accounts", settings_blocks: "Blocked Accounts",
        pinned_post: "Pinned Post",
        ctx_reply: "💬 Reply", ctx_repost: "🔁 Repost", ctx_quote: "📝 Quote", ctx_profile: "👤 View Profile",
        ctx_pin: "📌 Pin Post", ctx_unpin: "📌 Unpin Post",
        ctx_follow: "➕ Follow", ctx_unfollow: "➖ Unfollow",
        ctx_mute: "🔇 Mute", ctx_unmute: "🔊 Unmute",
        ctx_block: "🚫 Block", ctx_unblock: "✅ Unblock",
        ctx_bookmark: "🔖 Add to Bookmarks", ctx_unbookmark: "🔖 Remove Bookmark",
        save_image: "💾 Save Image", action_success: "Success",
        stats_posts: "Posts", stats_following: "Following", stats_followers: "Followers",
        error_details: "[Error Details]", network_check: "Possible network restriction. Would you like to check in your browser?",
        post_too_long: "Post is too long. It exceeds the limit by {0} characters.",
        no_bookmarks: "No bookmarks found.",
        bookmark_failed: "Failed to process bookmark."
    }
};

let currentLang = localStorage.getItem('aerune_lang') || (navigator.language.startsWith('ja') ? 'ja' : 'en');
let postLimit = parseInt(localStorage.getItem('aerune_post_limit')) || 30;
if (isNaN(postLimit)) postLimit = 30;
let nsfwBlur = localStorage.getItem('aerune_nsfw_blur') !== 'false';

const t = (key, ...args) => {
    let text = translations[currentLang][key] || key;
    args.forEach((arg, i) => { text = text.replace(`{${i}}`, arg); });
    return text;
};

const agent = new BskyAgent({ service: 'https://bsky.social' });
let selectedImages = [], replyTarget = null, quoteTarget = null, savedAccounts = [], currentDid = null, currentConvoId = null;
const els = {};

// ★ ブックマーク状態をローカルで記憶・共有するための仕組み
window.aeruneBookmarks = new Set();

function hasSelection() {
    try {
        const sel = window.getSelection();
        return sel && !sel.isCollapsed && sel.toString().trim().length > 0;
    } catch (e) { return false; }
}

let historyStack = [];
let currentState = null;

function pushState(newState) {
    if (currentState && JSON.stringify(currentState) !== JSON.stringify(newState)) {
        historyStack.push(currentState);
    }
    currentState = newState;
    updateBackBtn();
}

function updateBackBtn() {
    const backBtn = document.getElementById('back-btn');
    if (backBtn) backBtn.style.display = historyStack.length > 0 ? 'inline-block' : 'none';
}

function goBack() {
    if (historyStack.length > 0) {
        const prevState = historyStack.pop();
        currentState = prevState;
        updateBackBtn();
        
        if (prevState.type === 'home') { switchView('home', els.timelineDiv); fetchTimeline(); }
        else if (prevState.type === 'notifications') { switchView('notifications', els.notifDiv); fetchNotifications(); }
        else if (prevState.type === 'chat') { switchView('chat', els.chatView); fetchConvos(); }
        else if (prevState.type === 'search') { switchView('search', els.searchView); }
        else if (prevState.type === 'profile') { window.loadProfile(prevState.actor, true); }
        else if (prevState.type === 'thread') { window.loadThread(prevState.uri, true); }
        else if (prevState.type === 'settings') { switchView('settings', els.settingsView); }
        else if (prevState.type === 'bookmarks') { switchView('bookmarks', els.bookmarksView); fetchBookmarks(); }
    }
}

async function initApp() {
    const get = (id) => document.getElementById(id);
    els.app = get('app');
    els.timelineDiv = get('timeline');
    els.notifDiv = get('notifications');
    els.notifBadge = get('notif-badge');
    els.chatView = get('chat-view');
    els.convoList = get('convo-list');
    els.chatHeader = get('chat-header');
    els.chatMessages = get('chat-messages');
    els.chatInputArea = get('chat-input-area');
    els.searchView = get('search-view');
    els.profileView = get('profile-view');
    els.threadView = get('thread-view');
    els.settingsView = get('settings-view');
    els.viewTitle = get('view-title');
    els.postInput = get('post-input');
    els.loginForm = get('login-form');
    els.dropZone = get('drop-zone');
    els.quotePreview = get('quote-preview');
    els.imagePreviewContainer = get('image-preview-container');
    els.ctxMenu = get('ctx-menu');

    if (!document.getElementById('nav-bookmarks')) {
        const li = document.createElement('li');
        li.id = 'nav-bookmarks';
        li.setAttribute('data-i18n', 'nav_bookmarks');
        li.innerText = t('nav_bookmarks');
        li.onclick = () => { pushState({ type: 'bookmarks' }); switchView('bookmarks', els.bookmarksView); fetchBookmarks(); };
        const profileNav = document.getElementById('nav-profile');
        if (profileNav) profileNav.parentNode.insertBefore(li, profileNav.nextSibling);
        
        const bView = document.createElement('div');
        bView.id = 'bookmarks-view';
        bView.className = 'content hidden';
        const mainEl = els.timelineDiv.parentNode;
        if (mainEl) mainEl.appendChild(bView);
        els.bookmarksView = bView;
    }

    if (els.viewTitle && !document.getElementById('back-btn')) {
        const backBtn = document.createElement('button');
        backBtn.id = 'back-btn';
        backBtn.className = 'icon-btn';
        backBtn.innerText = '◀';
        backBtn.style.display = 'none';
        backBtn.style.marginRight = '10px';
        backBtn.onclick = goBack;
        els.viewTitle.parentNode.insertBefore(backBtn, els.viewTitle);
    }

    if (els.postInput) {
        els.postInput.style.minHeight = '80px';
        els.postInput.value = localStorage.getItem('aerune_draft_text') || '';
        els.postInput.addEventListener('input', () => {
            localStorage.setItem('aerune_draft_text', els.postInput.value);
        });
    }

    document.getElementById('setting-lang').value = currentLang;
    document.getElementById('setting-limit').value = postLimit;
    document.getElementById('setting-nsfw').checked = nsfwBlur;

    applyTranslations();

    if (els.dropZone) {
        els.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); els.dropZone.classList.add('drag-over'); });
        els.dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); els.dropZone.classList.remove('drag-over'); });
        els.dropZone.addEventListener('drop', async (e) => {
            e.preventDefault(); e.stopPropagation(); els.dropZone.classList.remove('drag-over');
            const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
            await processIncomingImages(files);
        });
    }

    document.addEventListener('click', (e) => { if (e.button === 0 && els.ctxMenu) els.ctxMenu.classList.add('hidden'); });
    document.querySelector('.content')?.addEventListener('scroll', () => { if (els.ctxMenu) els.ctxMenu.classList.add('hidden'); });

    try {
        const data = await ipcRenderer.invoke('load-session');
        if (data && (Array.isArray(data) ? data.length > 0 : data.did)) {
            savedAccounts = Array.isArray(data) ? data : [data];
            await switchAccount(savedAccounts[0].did);
        } else { showLoginForm(); }
    } catch (e) { showLoginForm(); }
}

// ★ 起動時やログイン時にブックマーク一覧を同期して記憶する関数
async function syncBookmarksData() {
    try {
        let pdsUrl = 'https://bsky.social';
        if (agent.pdsUrl) pdsUrl = agent.pdsUrl;
        else if (agent.api?.xrpc?.uri) pdsUrl = agent.api.xrpc.uri;
        pdsUrl = pdsUrl.toString().replace(/\/$/, '');

        const fetchRes = await fetch(`${pdsUrl}/xrpc/app.bsky.bookmark.getBookmarks?limit=100`, {
            headers: { 'Authorization': `Bearer ${agent.session.accessJwt}` }
        });
        if (fetchRes.ok) {
            const data = await fetchRes.json();
            window.aeruneBookmarks.clear();
            (data.bookmarks || []).forEach(b => {
                const uri = b.subject ? b.subject.uri : (b.record ? b.record.uri : null);
                if (uri) window.aeruneBookmarks.add(uri);
            });
        }
    } catch (e) {}
}

async function login() {
    const identifier = document.getElementById('id').value.trim();
    const password = document.getElementById('pw').value.trim();
    const btn = document.getElementById('login-btn');
    try {
        btn.disabled = true; btn.innerText = "Connecting...";
        const res = await agent.login({ identifier, password });
        if (res.success) {
            savedAccounts = savedAccounts.filter(acc => acc.did !== res.data.did);
            savedAccounts.push(res.data);
            await ipcRenderer.invoke('save-session', savedAccounts);
            await switchAccount(res.data.did);
        }
    } catch (e) {
        console.error("Login Error:", e);
        const reason = e.message || String(e);
        const confirmMsg = `${t('login_failed')}\n\n${t('error_details')}\n${reason}\n\n${t('network_check')}`;
        if (confirm(confirmMsg)) { shell.openExternal('https://bsky.app'); }
    } finally { 
        btn.disabled = false; 
        btn.innerText = t('login_btn'); 
    }
}

async function switchAccount(did) {
    const sessionData = savedAccounts.find(acc => acc.did === did);
    if (!sessionData) return;
    try {
        await agent.resumeSession(sessionData);
        currentDid = did;
        els.loginForm.classList.add('hidden');
        if (els.app) els.app.style.opacity = "1";
        setupLoggedInUI();
    } catch (e) { showLoginForm(); }
}

function showLoginForm() {
    els.loginForm.classList.remove('hidden');
    if (els.app) els.app.style.opacity = "0.3";
}

function setupLoggedInUI() {
    agent.getProfile({ actor: agent.session.did }).then(res => {
        document.getElementById('profile-snippet').innerHTML = `<div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;"><img src="${res.data.avatar}" style="width: 40px; height: 40px; border-radius: 50%;"><strong>${res.data.displayName || res.data.handle}</strong></div>`;
        renderAccountList();
    });
    // ブックマークを裏で同期
    syncBookmarksData();
    pushState({ type: 'home' });
    switchView('home', els.timelineDiv);
    fetchTimeline();
    setInterval(checkNotifs, 30000);
}

function renderAccountList() {
    const container = document.getElementById('account-list');
    if (!container) return;
    container.innerHTML = '';
    savedAccounts.forEach(acc => {
        const div = document.createElement('div');
        div.className = `account-item ${acc.did === currentDid ? 'active' : ''}`;
        div.innerText = `@${acc.handle}`;
        div.onclick = () => { if (acc.did !== currentDid) switchAccount(acc.did); };
        container.appendChild(div);
    });
}

const linkifyCache = new Map();
function linkify(text) {
    if (!text) return '';
    if (linkifyCache.has(text)) return linkifyCache.get(text);
    let escaped = text.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag]));
    escaped = escaped.replace(/(https?:\/\/[^\s]+)/g, url => `<a href="#" onclick="shell.openExternal('${url}'); event.stopPropagation(); return false;" style="color: var(--bsky-blue); text-decoration: none;">${url}</a>`);
    escaped = escaped.replace(/(?:^|\s)(#[^\s#]+)/g, (match, tag) => {
        const space = match.startsWith(' ') ? ' ' : '';
        return `${space}<a href="#" onclick="window.execSearch('${tag.trim()}'); event.stopPropagation(); return false;" style="color: var(--bsky-blue); text-decoration: none;">${tag}</a>`;
    });
    escaped = escaped.replace(/(?:^|\s)(@[a-zA-Z0-9.-]+)/g, (match, handle) => {
        const space = match.startsWith(' ') ? ' ' : '';
        const cleanHandle = handle.trim().substring(1);
        return `${space}<a href="#" onclick="window.loadProfile('${cleanHandle}'); event.stopPropagation(); return false;" style="color: var(--bsky-blue); text-decoration: none;">${handle.trim()}</a>`;
    });
    if (linkifyCache.size > 500) linkifyCache.clear();
    linkifyCache.set(text, escaped);
    return escaped;
}

function showContextMenu(x, y, items) {
    if (!els.ctxMenu) return;
    els.ctxMenu.innerHTML = '';
    items.forEach(item => {
        if (item.divider) {
            const div = document.createElement('div'); div.className = 'ctx-divider';
            els.ctxMenu.appendChild(div);
        } else {
            const div = document.createElement('div'); div.className = 'ctx-menu-item';
            if (item.color) div.style.color = item.color;
            div.innerText = item.label;
            div.onclick = (e) => { e.stopPropagation(); els.ctxMenu.classList.add('hidden'); item.action(); };
            els.ctxMenu.appendChild(div);
        }
    });
    els.ctxMenu.classList.remove('hidden');
    const rect = els.ctxMenu.getBoundingClientRect();
    let posX = Math.max(0, Math.min(x, window.innerWidth - rect.width - 10));
    let posY = Math.max(0, Math.min(y, window.innerHeight - rect.height - 10));
    els.ctxMenu.style.left = `${posX}px`;
    els.ctxMenu.style.top = `${posY}px`;
}

async function downloadImage(url) {
    try {
        const res = await fetch(url);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `aerune_img_${Date.now()}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
    } catch(e) { alert('Download failed'); }
}

function createPostElement(post, isThreadRoot = false, isQuoteModal = false, reason = null) {
    if (!post || !post.author) return document.createElement('div'); 
    const author = post.author, postViewer = post.viewer || {}, authorViewer = author.viewer || {}, root = post.record?.reply?.root || { uri: post.uri, cid: post.cid };
    const div = document.createElement('div');
    div.className = 'post';
    if (isThreadRoot) div.style.borderLeft = '4px solid var(--bsky-blue)';
    
    const isMe = agent.session && author.did === agent.session.did;

    if (!isQuoteModal) {
        div.ondblclick = () => {
            if (hasSelection()) return;
            window.loadThread(post.uri);
        };
        div.addEventListener('contextmenu', async (e) => {
            e.preventDefault(); e.stopPropagation();
            if (hasSelection()) return;
            if (e.target.tagName === 'IMG') {
                showContextMenu(e.clientX, e.clientY, [{ label: t('save_image'), action: () => downloadImage(e.target.dataset.fullsize || e.target.src) }]);
                return;
            }
            // ★ グローバルな記憶リストを参照して「追加/外す」を正しく切り替え
            const isBookmarkedLocally = window.aeruneBookmarks.has(post.uri) || !!postViewer.bookmark;
            
            let opts = [
                { label: t('ctx_reply'), action: () => window.prepareReply(post.uri, post.cid, author.handle, root.uri, root.cid) },
                { label: t('ctx_repost'), action: () => window.doRepost(post.uri, post.cid, postViewer.repost) },
                { label: t('ctx_quote'), action: () => window.prepareQuote(post.uri, post.cid, author.handle, post.record?.text || '') },
                { divider: true },
                { label: isBookmarkedLocally ? t('ctx_unbookmark') : t('ctx_bookmark'), action: () => window.toggleBookmark(post) },
                { divider: true },
                { label: t('ctx_profile'), action: () => window.loadProfile(author.handle) },
            ];
            if (isMe) {
                opts.push({ divider: true });
                opts.push({ label: t('ctx_pin') + "/" + t('ctx_unpin'), action: () => window.togglePin(post) });
            } else {
                opts.push({ divider: true });
                opts.push({ label: authorViewer.following ? t('ctx_unfollow') : t('ctx_follow'), action: () => window.toggleFollow(author.did, authorViewer.following) });
                opts.push({ label: authorViewer.muted ? t('ctx_unmute') : t('ctx_mute'), action: () => window.toggleMute(author.did, authorViewer.muted) });
                opts.push({ label: authorViewer.blocking ? t('ctx_unblock') : t('ctx_block'), action: () => window.toggleBlock(author.did, authorViewer.blocking), color: '#d93025' });
            }
            showContextMenu(e.clientX, e.clientY, opts);
        });
    }

    const isNsfw = post.labels?.some(l => ['porn', 'sexual', 'nudity'].includes(l.val)) || post.author.labels?.some(l => ['porn', 'sexual', 'nudity'].includes(l.val));
    const imgClass = (isNsfw && nsfwBlur) ? 'post-img-thumb nsfw-blur' : 'post-img-thumb';
    const imgStyle = 'object-fit: cover; max-height: 400px; width: 100%; border-radius: 8px;';

    let embedHtml = '';
    const embed = post.embed;
    if (embed) {
        if (embed.$type === 'app.bsky.embed.images#view') {
            embedHtml = `<div class="post-images">` + embed.images.map(img => `<img src="${img.thumb}" data-fullsize="${img.fullsize}" class="${imgClass}" style="${imgStyle}" onclick="window.openModal('${img.fullsize}'); event.stopPropagation();">`).join('') + `</div>`;
        } 
        else if (embed.$type === 'app.bsky.embed.record#view') {
            const rec = embed.record;
            if (rec.author) {
                let quoteMediaHtml = '';
                if (rec.embeds && rec.embeds[0] && rec.embeds[0].$type === 'app.bsky.embed.images#view') {
                    quoteMediaHtml = `<div class="post-images" style="margin-top:8px;">` + rec.embeds[0].images.map(img => `<img src="${img.thumb}" data-fullsize="${img.fullsize}" class="${imgClass}" style="${imgStyle}" onclick="window.openModal('${img.fullsize}'); event.stopPropagation();">`).join('') + `</div>`;
                }
                embedHtml = `<div class="embedded-quote" onclick="window.openQuoteModal(event, ${JSON.stringify(rec).replace(/"/g, '&quot;')}); event.stopPropagation();"><strong>${rec.author.displayName || rec.author.handle}</strong> <span style="color:gray;">@${rec.author.handle}</span><div style="font-size:0.9em; margin-top:4px;">${linkify(rec.value?.text || rec.record?.text)}</div>${quoteMediaHtml}</div>`;
            }
        }
        else if (embed.$type === 'app.bsky.embed.recordWithMedia#view') {
            if (embed.media?.images) {
                embedHtml = `<div class="post-images">` + embed.media.images.map(img => `<img src="${img.thumb}" data-fullsize="${img.fullsize}" class="${imgClass}" style="${imgStyle}" onclick="window.openModal('${img.fullsize}'); event.stopPropagation();">`).join('') + `</div>`;
            }
            const rec = embed.record.record;
            if (rec && rec.author) {
                let quoteMediaHtml = '';
                if (rec.embeds && rec.embeds[0] && rec.embeds[0].$type === 'app.bsky.embed.images#view') {
                    quoteMediaHtml = `<div class="post-images" style="margin-top:8px;">` + rec.embeds[0].images.map(img => `<img src="${img.thumb}" data-fullsize="${img.fullsize}" class="${imgClass}" style="${imgStyle}" onclick="window.openModal('${img.fullsize}'); event.stopPropagation();">`).join('') + `</div>`;
                }
                embedHtml += `<div class="embedded-quote" onclick="window.openQuoteModal(event, ${JSON.stringify(rec).replace(/"/g, '&quot;')}); event.stopPropagation();"><strong>${rec.author.displayName || rec.author.handle}</strong><div style="font-size:0.9em; margin-top:4px;">${linkify(rec.value?.text || rec.record?.text)}</div>${quoteMediaHtml}</div>`;
            }
        }
    }

    let repostHtml = '';
    if (reason && reason.$type === 'app.bsky.feed.defs#reasonRepost') {
        const reposterName = reason.by.displayName || reason.by.handle;
        repostHtml = `<div style="font-size: 0.85em; color: gray; margin-bottom: 4px; font-weight: bold;">${t('reposted_by', reposterName)}</div>`;
    }

    const bookmarkCountHtml = (isMe && typeof post.bookmarkCount !== 'undefined' && post.bookmarkCount > 0) 
        ? `<button class="action-btn" style="cursor:default; color:var(--bsky-blue);">🔖 ${post.bookmarkCount}</button>` 
        : '';

    div.innerHTML = `
        <img src="${author.avatar || ''}" class="post-avatar" onclick="window.loadProfile('${author.handle}'); event.stopPropagation();">
        <div class="post-content">
            ${repostHtml}
            <div class="post-header"><strong>${author.displayName || author.handle}</strong> <span style="color:gray;">@${author.handle}</span></div>
            <div class="post-text">${linkify(post.record?.text || post.value?.text)}</div>
            ${embedHtml}
            <div class="post-actions" onclick="event.stopPropagation();">
                <button onclick="window.prepareReply('${post.uri}', '${post.cid}', '${author.handle}', '${root.uri}', '${root.cid}')" class="action-btn">💬 ${post.replyCount || 0}</button>
                <button onclick="window.doRepost('${post.uri}', '${post.cid}', ${postViewer.repost ? `'${postViewer.repost}'` : 'null'})" class="action-btn ${postViewer.repost ? 'reposted' : ''}">🔁 ${post.repostCount || 0}</button>
                <button onclick="window.prepareQuote('${post.uri}', '${post.cid}', '${author.handle}', '${(post.record?.text || post.value?.text || '').replace(/'/g, "\\'")}')" class="action-btn">📝</button>
                <button onclick="window.doLike('${post.uri}', '${post.cid}', ${postViewer.like ? `'${postViewer.like}'` : 'null'})" class="action-btn ${postViewer.like ? 'liked' : ''}">❤️ ${post.likeCount || 0}</button>
                ${bookmarkCountHtml}
                ${isMe ? `<button onclick="window.deletePost('${post.uri}')" class="action-btn" style="margin-left:auto;">🗑️</button>` : ''}
            </div>
        </div>`;
    return div;
}

window.openQuoteModal = (e, quoteRecord) => {
    const modal = document.getElementById('quote-modal');
    const body = document.getElementById('quote-modal-body');
    body.innerHTML = '';
    body.appendChild(createPostElement(quoteRecord, false, true));
    modal.classList.remove('hidden');
};
document.getElementById('quote-modal-close')?.addEventListener('click', () => document.getElementById('quote-modal').classList.add('hidden'));

async function sendPost() {
    const text = els.postInput.value.trim();
    if (!text && selectedImages.length === 0 && !quoteTarget) return;

    const rt = new RichText({ text });
    await rt.detectFacets(agent);
    if (rt.graphemeLength > 300) {
        alert(t('post_too_long', (rt.graphemeLength - 300).toString()));
        return;
    }

    const btn = document.getElementById('post-btn');
    try {
        btn.disabled = true;
        let imagesEmbed = undefined, finalEmbed = undefined;
        if (selectedImages.length > 0) {
            const blobs = [];
            for (const imgObj of selectedImages) {
                const res = await agent.uploadBlob(new Uint8Array(await imgObj.blob.arrayBuffer()), { encoding: 'image/jpeg' });
                blobs.push({ image: res.data.blob, alt: imgObj.alt || "", aspectRatio: { width: imgObj.width, height: imgObj.height } });
            }
            imagesEmbed = { $type: 'app.bsky.embed.images', images: blobs };
        }
        if (quoteTarget) {
            const recordEmbed = { $type: 'app.bsky.embed.record', record: quoteTarget };
            finalEmbed = imagesEmbed ? { $type: 'app.bsky.embed.recordWithMedia', media: imagesEmbed, record: recordEmbed } : recordEmbed;
        } else { finalEmbed = imagesEmbed; }
        
        const postData = { text: rt.text, facets: rt.facets, embed: finalEmbed, createdAt: new Date().toISOString() };
        if (replyTarget) postData.reply = { root: replyTarget.root, parent: { uri: replyTarget.uri, cid: replyTarget.cid } };
        await agent.post(postData);
        localStorage.removeItem('aerune_draft_text');
        resetPostForm();
        setTimeout(fetchTimeline, 500);
    } catch (e) { alert(t('post_failed')); } finally { btn.disabled = false; }
}

window.deletePost = async (uri) => {
    if (!confirm(t('delete_confirm'))) return;
    try { await agent.deletePost(uri); fetchTimeline(); } catch (e) { alert(t('delete_failed')); }
};

// ★ ブックマークの追加と削除を正確に処理する関数
window.toggleBookmark = async (post) => {
    try {
        const isBookmarkedLocally = window.aeruneBookmarks.has(post.uri) || !!(post.viewer && post.viewer.bookmark);
        
        let pdsUrl = 'https://bsky.social';
        if (agent.pdsUrl) pdsUrl = agent.pdsUrl;
        else if (agent.api?.xrpc?.uri) pdsUrl = agent.api.xrpc.uri;
        pdsUrl = pdsUrl.toString().replace(/\/$/, '');

        if (isBookmarkedLocally) {
            // ★ 外す処理：対象ポストのURIを指定して削除
            const res = await fetch(`${pdsUrl}/xrpc/app.bsky.bookmark.deleteBookmark`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${agent.session.accessJwt}` },
                body: JSON.stringify({ uri: post.uri })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status} - ${await res.text()}`);
            
            if (post.viewer) delete post.viewer.bookmark; 
            window.aeruneBookmarks.delete(post.uri);
            alert(t('action_success'));
            if (currentState?.type === 'bookmarks') fetchBookmarks();
        } else {
            // ★ 追加処理
            const res = await fetch(`${pdsUrl}/xrpc/app.bsky.bookmark.createBookmark`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${agent.session.accessJwt}` },
                body: JSON.stringify({ uri: post.uri, cid: post.cid })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status} - ${await res.text()}`);
            
            if (!post.viewer) post.viewer = {};
            post.viewer.bookmark = "bookmarked"; 
            window.aeruneBookmarks.add(post.uri);
            alert(t('action_success'));
        }
    } catch (e) {
        console.error("Bookmark Error:", e);
        alert(`${t('bookmark_failed')}\nReason: ${e.message || String(e)}`);
    }
};

async function fetchBookmarks() {
    els.bookmarksView.innerHTML = '<div style="padding:20px;text-align:center;">Loading...</div>';
    try {
        let pdsUrl = 'https://bsky.social';
        if (agent.pdsUrl) pdsUrl = agent.pdsUrl;
        else if (agent.api?.xrpc?.uri) pdsUrl = agent.api.xrpc.uri;
        pdsUrl = pdsUrl.toString().replace(/\/$/, '');

        const fetchRes = await fetch(`${pdsUrl}/xrpc/app.bsky.bookmark.getBookmarks?limit=${postLimit}`, {
            headers: { 'Authorization': `Bearer ${agent.session.accessJwt}` }
        });
        
        if (!fetchRes.ok) {
            if (fetchRes.status >= 400 && fetchRes.status < 500) {
                els.bookmarksView.innerHTML = `<div style="padding:20px; text-align:center; color:gray;">${t('no_bookmarks')}</div>`;
                return;
            }
            throw new Error(`HTTP ${fetchRes.status}`);
        }
        
        const data = await fetchRes.json();
        const bookmarks = data.bookmarks || [];
        const uris = [];
        
        window.aeruneBookmarks.clear(); // キャッシュを最新化
        
        for (const b of bookmarks) {
            const subjectUri = b.subject ? b.subject.uri : (b.record ? b.record.uri : null);
            if (subjectUri) {
                uris.push(subjectUri);
                window.aeruneBookmarks.add(subjectUri);
            }
        }
        
        if (uris.length === 0) {
            els.bookmarksView.innerHTML = `<div style="padding:20px; text-align:center;">${t('no_bookmarks')}</div>`;
            return;
        }
        
        let feedItems = [];
        for (let i = 0; i < uris.length; i += 25) {
            const chunk = uris.slice(i, i + 25);
            const postsRes = await agent.getPosts({ uris: chunk });
            postsRes.data.posts.forEach(post => {
                post.viewer = post.viewer || {};
                post.viewer.bookmark = "bookmarked";
                feedItems.push({ post });
            });
        }
        renderPosts(feedItems, els.bookmarksView);
    } catch(e) {
        console.error("Fetch Bookmarks Error:", e);
        els.bookmarksView.innerHTML = `<div style="padding:20px;text-align:center;color:red;">${t('bookmark_failed')}<br><small style="color:gray;">${e.message}</small></div>`;
    }
}

function resetPostForm() {
    els.postInput.value = ''; els.postInput.placeholder = t('post_placeholder');
    els.quotePreview.classList.add('hidden'); els.quotePreview.innerHTML = '';
    selectedImages = []; replyTarget = null; quoteTarget = null;
    updateImagePreview();
}

async function compressImage(file, maxSize = 2000) {
    return new Promise((resolve) => {
        const reader = new FileReader(); reader.readAsDataURL(file);
        reader.onload = event => {
            const img = new Image(); img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let w = img.width, h = img.height;
                if (w > maxSize || h > maxSize) { if (w > h) { h *= maxSize / w; w = maxSize; } else { w *= maxSize / h; h = maxSize; } }
                w = Math.round(w); h = Math.round(h);
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
                canvas.toBlob(blob => resolve({ blob, width: w, height: h }), 'image/jpeg', 0.85);
            };
        };
    });
}

async function processIncomingImages(files) {
    if (files.length === 0) return;
    for (const file of files) {
        if (selectedImages.length >= 4) break;
        const compressed = await compressImage(file);
        selectedImages.push({ id: Date.now() + Math.random(), file: file, url: URL.createObjectURL(file), blob: compressed.blob, width: compressed.width, height: compressed.height, alt: "" });
    }
    updateImagePreview();
}

function updateImagePreview() {
    if (!els.imagePreviewContainer) return;
    els.imagePreviewContainer.innerHTML = '';
    selectedImages.forEach((imgObj, index) => {
        const wrap = document.createElement('div');
        wrap.className = 'img-preview-wrap';
        wrap.innerHTML = `<img src="${imgObj.url}" title="クリックで削除" style="cursor: pointer;" onclick="window.removeImg(${index}); event.stopPropagation();"><div class="img-controls"><button onclick="window.moveImg(${index}, -1); event.stopPropagation();" ${index === 0 ? 'disabled' : ''}>◀</button><input type="text" placeholder="ALT" value="${imgObj.alt}" onchange="window.updateAlt(${index}, this.value)" onclick="event.stopPropagation();"><button onclick="window.moveImg(${index}, 1); event.stopPropagation();" ${index === selectedImages.length - 1 ? 'disabled' : ''}>▶</button><button onclick="window.removeImg(${index}); event.stopPropagation();" style="color:#ff6b6b; font-weight:bold;">✖</button></div>`;
        els.imagePreviewContainer.appendChild(wrap);
    });
}

window.moveImg = (index, dir) => {
    const temp = selectedImages[index];
    selectedImages[index] = selectedImages[index + dir];
    selectedImages[index + dir] = temp;
    updateImagePreview();
};
window.updateAlt = (index, val) => { selectedImages[index].alt = val; };
window.removeImg = (index) => { selectedImages.splice(index, 1); updateImagePreview(); };

window.prepareReply = (uri, cid, handle, rootUri, rootCid) => {
    replyTarget = { uri, cid, root: { uri: rootUri || uri, cid: rootCid || cid } };
    els.postInput.placeholder = t('reply_placeholder', handle);
    els.postInput.focus();
};

window.prepareQuote = (uri, cid, handle, text) => {
    quoteTarget = { uri, cid };
    els.quotePreview.classList.remove('hidden');
    const safeText = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    els.quotePreview.innerHTML = `<span class="quote-preview-close" onclick="resetPostForm()">×</span><strong>@${handle}</strong>: ${safeText.substring(0, 60)}...`;
    els.postInput.focus();
};

window.prepareProfileReply = (handle) => {
    els.postInput.value = `@${handle} ` + els.postInput.value;
    els.postInput.focus();
};

async function checkNotifs() {
    try { const res = await agent.countUnreadNotifications(); els.notifBadge.classList.toggle('hidden', res.data.count === 0); } catch(e) {}
}

function renderPosts(posts, container) { 
    if (!container) return; 
    container.innerHTML = ''; 
    posts.forEach(item => container.appendChild(createPostElement(item.post || item, false, false, item.reason))); 
}

async function fetchTimeline() { try { const res = await agent.getTimeline({ limit: postLimit }); renderPosts(res.data.feed, els.timelineDiv); } catch (e) {} }

async function fetchNotifications() {
    try {
        const res = await agent.listNotifications({ limit: postLimit });
        const notifications = res.data.notifications;
        const uris = notifications.filter(n => (n.reason === 'like' || n.reason === 'repost') && n.reasonSubject).map(n => n.reasonSubject);
        const postMap = {};
        if (uris.length > 0) { 
            for (let i = 0; i < uris.length; i += 25) {
                const chunk = uris.slice(i, i + 25);
                const postsRes = await agent.getPosts({ uris: chunk }); 
                postsRes.data.posts.forEach(p => { postMap[p.uri] = p.record.text; }); 
            }
        }
        els.notifDiv.innerHTML = '';
        notifications.forEach(n => {
            const div = document.createElement('div'); div.className = 'post';
            div.ondblclick = () => {
                if (hasSelection()) return;
                if (n.reason === 'follow') window.loadProfile(n.author.handle);
                else if (n.reasonSubject || n.uri) window.loadThread(n.reasonSubject || n.uri);
            };
            div.addEventListener('contextmenu', (e) => {
                e.preventDefault(); e.stopPropagation();
                if (hasSelection()) return;
                if (e.target.tagName === 'IMG') {
                    showContextMenu(e.clientX, e.clientY, [{ label: t('save_image'), action: () => downloadImage(e.target.dataset.fullsize || e.target.src) }]);
                    return;
                }
                const authorViewer = n.author.viewer || {};
                const isMe = agent.session && n.author.did === agent.session.did;
                let opts = [];
                if (n.reason !== 'follow' && (n.reasonSubject || n.uri)) { opts.push({ label: t('nav_thread'), action: () => window.loadThread(n.reasonSubject || n.uri) }); }
                opts.push({ label: t('ctx_profile'), action: () => window.loadProfile(n.author.handle) });
                if (!isMe) {
                    opts.push({ divider: true });
                    opts.push({ label: authorViewer.following ? t('ctx_unfollow') : t('ctx_follow'), action: () => window.toggleFollow(n.author.did, authorViewer.following) });
                    opts.push({ label: authorViewer.muted ? t('ctx_unmute') : t('ctx_mute'), action: () => window.toggleMute(author.did, authorViewer.muted) });
                    opts.push({ label: authorViewer.blocking ? t('ctx_unblock') : t('ctx_block'), action: () => window.toggleBlock(author.did, authorViewer.blocking), color: '#d93025' });
                }
                showContextMenu(e.clientX, e.clientY, opts);
            });
            let previewText = '';
            if (n.reason === 'like' || n.reason === 'repost') previewText = postMap[n.reasonSubject] || '';
            else if (n.reason === 'reply' || n.reason === 'quote' || n.reason === 'mention') previewText = n.record?.text || '';
            const preview = previewText ? `<div class="post-text" style="color:gray; font-size:0.85em; margin-top:4px; padding:4px 8px; border-left:2px solid #ddd;">${linkify(previewText)}</div>` : '';
            div.innerHTML = `<img src="${n.author.avatar || ''}" class="post-avatar"> <div class="post-content"><strong>${n.author.displayName || n.author.handle}</strong> <span>${t('notif_' + n.reason)}</span>${preview}</div>`;
            els.notifDiv.appendChild(div);
        });
        await agent.updateSeenNotifications(); checkNotifs();
    } catch (e) {}
}

window.loadThread = async (uri, isBack = false) => {
    if (!isBack) pushState({ type: 'thread', uri });
    switchView('thread', els.threadView);
    const container = document.getElementById('thread-content');
    container.innerHTML = '<div style="padding:20px;text-align:center;">Loading Thread...</div>';
    try {
        const res = await agent.getPostThread({ uri, depth: 10, parentHeight: 10 });
        container.innerHTML = '';
        const renderThreadItem = (item, isRoot = false) => {
            if (item.parent) renderThreadItem(item.parent);
            if (item.post) container.appendChild(createPostElement(item.post, isRoot));
            if (item.replies) item.replies.forEach(reply => {
                if (reply.post) {
                    const el = createPostElement(reply.post); el.style.marginLeft = '40px'; el.style.borderLeft = '2px solid #eee';
                    container.appendChild(el);
                }
            });
        };
        renderThreadItem(res.data.thread, true);
    } catch (e) { container.innerHTML = '<div style="padding:20px;">Failed to load thread.</div>'; }
};

window.loadProfile = async (actor, isBack = false) => {
    if (!isBack) pushState({ type: 'profile', actor });
    switchView('profile', els.profileView);
    const container = document.getElementById('profile-header-container');
    const pinnedContainer = document.getElementById('profile-pinned');
    const timelineContainer = document.getElementById('profile-timeline');
    container.innerHTML = 'Loading...';
    pinnedContainer.innerHTML = '';
    timelineContainer.innerHTML = '';
    try {
        const res = await agent.getProfile({ actor });
        const p = res.data;
        const isSelf = agent.session && p.did === agent.session.did;
        const dmBtn = !isSelf ? `<button onclick="window.startDirectMessage('${p.did}')" class="sidebar-action-btn" style="width:auto; padding:5px 15px; margin-right:10px;">${t('send_dm')}</button>` : '';
        const replyBtn = !isSelf ? `<button onclick="window.prepareProfileReply('${p.handle}')" class="sidebar-action-btn" style="width:auto; padding:5px 15px; margin-right:10px;">${t('profile_reply')}</button>` : '';
        const followBtn = !isSelf ? `<button onclick="window.toggleFollow('${p.did}', '${p.viewer?.following || ''}')" class="sidebar-action-btn" style="width:auto; padding:5px 15px; background:${p.viewer?.following ? '#ccc' : 'var(--bsky-blue)'};">${p.viewer?.following ? t('ctx_unfollow') : t('ctx_follow')}</button>` : '';
        const actionBtns = `<div style="margin-top:15px; display:flex; gap:8px; flex-wrap:wrap;">${dmBtn}${replyBtn}${followBtn}</div>`;
        const rel = (p.viewer?.following && p.viewer?.followedBy) ? `<span class="relationship-badge">${t('mutual')}</span>` : (p.viewer?.following ? `<span class="relationship-badge">${t('following')}</span>` : (p.viewer?.followedBy ? `<span class="relationship-badge">${t('follow_me')}</span>` : ''));
        const bannerHtml = p.banner ? `<img src="${p.banner}" style="width:100%; height:150px; object-fit:cover;">` : `<div style="width:100%; height:150px; background:#ddd;"></div>`;
        const statsHtml = `<div style="display:flex; gap:20px; margin-top:15px; border-top:1px solid #eee; padding-top:10px; font-size:0.95em;"><span><strong>${p.postsCount || 0}</strong> <span style="color:gray;">${t('stats_posts')}</span></span><span style="cursor:pointer;" onclick="shell.openExternal('https://bsky.app/profile/${p.handle}/follows')"><strong>${p.followsCount || 0}</strong> <span style="color:gray;">${t('stats_following')}</span></span><span style="cursor:pointer;" onclick="shell.openExternal('https://bsky.app/profile/${p.handle}/followers')"><strong>${p.followersCount || 0}</strong> <span style="color:gray;">${t('stats_followers')}</span></span></div>`;

        container.innerHTML = `${bannerHtml}<div style="padding:20px; position:relative;"><img src="${p.avatar || ''}" style="width:80px; height:80px; border-radius:50%; border:4px solid white; position:absolute; top:-40px; background:#eee;"><div style="margin-top:40px;"><div style="font-size:20px; font-weight:bold;">${p.displayName || p.handle}${rel}</div><div style="color:gray;">@${p.handle}</div><div style="margin-top:10px; word-break: break-word;">${linkify(p.description || '')}</div>${statsHtml}${actionBtns}</div></div>`;
        const feedRes = await agent.getAuthorFeed({ actor, limit: postLimit });
        let feedItems = feedRes.data.feed;
        if (p.pinnedPost) {
            try {
                const pinnedRes = await agent.getPosts({ uris: [p.pinnedPost.uri] });
                if (pinnedRes.data.posts.length > 0) {
                    const pinnedPost = pinnedRes.data.posts[0];
                    const pinnedEl = createPostElement(pinnedPost, false, false);
                    const badge = document.createElement('div');
                    badge.innerHTML = `<span style="font-size: 0.85em; color: gray; font-weight: bold;">📌 ${t('pinned_post')}</span>`;
                    badge.style.marginBottom = "8px";
                    pinnedEl.insertBefore(badge, pinnedEl.firstChild);
                    pinnedEl.style.border = "2px solid var(--bsky-blue)";
                    pinnedEl.style.backgroundColor = "rgba(0, 133, 255, 0.05)";
                    pinnedContainer.appendChild(pinnedEl);
                    feedItems = feedItems.filter(item => item.post.uri !== p.pinnedPost.uri);
                }
            } catch (err) { console.error("Failed to load pinned post", err); }
        }
        renderPosts(feedItems, timelineContainer);
    } catch (e) { container.innerHTML = 'Failed to load profile.'; }
};

window.toggleFollow = async (did, followingUri) => {
    try {
        if (followingUri && followingUri !== 'undefined' && followingUri !== '') await agent.deleteFollow(followingUri);
        else await agent.follow(did);
        if (currentState?.type === 'profile') window.loadProfile(did, true);
    } catch(e) { alert("Failed"); }
};
window.toggleBlock = async (did, blockingUri) => {
    try {
        if (blockingUri && blockingUri !== 'undefined') await agent.app.bsky.graph.block.delete({ repo: agent.session.did, rkey: blockingUri.split('/').pop() });
        else await agent.app.bsky.graph.block.create({ repo: agent.session.did }, { subject: did, createdAt: new Date().toISOString() });
        if (currentState?.type === 'settings') loadModerationList('blocks');
        else alert(t('action_success'));
    } catch(e) { alert("Failed"); }
};
window.toggleMute = async (did, isMuted) => {
    try {
        if (isMuted && isMuted !== 'false') await agent.unmute(did);
        else await agent.mute(did);
        if (currentState?.type === 'settings') loadModerationList('mutes');
        else alert(t('action_success'));
    } catch(e) { alert("Failed"); }
};
window.togglePin = async (post) => {
    try {
        const repo = agent.session.did;
        const res = await agent.com.atproto.repo.getRecord({ repo, collection: 'app.bsky.actor.profile', rkey: 'self' });
        const record = res.data.value;
        if (record.pinnedPost && record.pinnedPost.uri === post.uri) { delete record.pinnedPost; } 
        else { record.pinnedPost = { uri: post.uri, cid: post.cid }; }
        await agent.com.atproto.repo.putRecord({ repo, collection: 'app.bsky.actor.profile', rkey: 'self', record });
        alert(t('action_success'));
        if (currentState?.type === 'profile') window.loadProfile(agent.session.handle, true);
    } catch (e) { alert("Failed to pin/unpin"); }
};

async function loadModerationList(type) {
    const container = document.getElementById('moderation-list-container');
    container.innerHTML = '<div style="padding:10px;">Loading...</div>';
    try {
        let items = [];
        if (type === 'blocks') {
            const res = await agent.app.bsky.graph.getBlocks({ limit: 50 });
            items = res.data.blocks.map(b => ({ did: b.did, handle: b.handle, name: b.displayName, uri: b.viewer.blocking }));
        } else {
            const res = await agent.app.bsky.graph.getMutes({ limit: 50 });
            items = res.data.mutes.map(m => ({ did: m.did, handle: m.handle, name: m.displayName, isMuted: m.viewer.muted }));
        }
        container.innerHTML = '';
        if (items.length === 0) container.innerHTML = '<div style="padding:10px;">No accounts found.</div>';
        items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'user-list-item';
            div.innerHTML = `<div><strong>${item.name || item.handle}</strong> <span style="color:gray;">@${item.handle}</span></div><button class="sidebar-action-btn" style="width:auto; padding:4px 8px;">${type === 'blocks' ? t('ctx_unblock') : t('ctx_unmute')}</button>`;
            div.querySelector('button').onclick = () => {
                if (type === 'blocks') window.toggleBlock(item.did, item.uri);
                else window.toggleMute(item.did, item.isMuted);
            };
            container.appendChild(div);
        });
    } catch(e) { container.innerHTML = '<div style="padding:10px;">Failed to load.</div>'; }
}

document.getElementById('btn-load-mutes')?.addEventListener('click', () => loadModerationList('mutes'));
document.getElementById('btn-load-blocks')?.addEventListener('click', () => loadModerationList('blocks'));

function getChatAgent() { return agent.withProxy('bsky_chat', 'did:web:api.bsky.chat'); }
async function fetchConvos() {
    try {
        const res = await getChatAgent().chat.bsky.convo.listConvos({ limit: 20 });
        els.convoList.innerHTML = '';
        res.data.convos.forEach(convo => {
            const other = convo.members.find(m => m.did !== agent.session.did);
            const div = document.createElement('div'); div.className = `convo-item ${convo.id === currentConvoId ? 'active' : ''}`;
            div.innerHTML = `<img src="${other.avatar || ''}" style="width:40px; border-radius:50%;"> <strong>${other.displayName}</strong>`;
            div.onclick = () => loadConvo(convo.id); els.convoList.appendChild(div);
        });
    } catch (e) {}
}

async function loadConvo(convoId) {
    currentConvoId = convoId; els.chatInputArea.classList.remove('hidden');
    try {
        const chatAgent = getChatAgent();
        const convoRes = await chatAgent.chat.bsky.convo.getConvo({ convoId });
        const other = convoRes.data.convo.members.find(m => m.did !== agent.session.did);
        if (other) { els.chatHeader.innerHTML = `<img src="${other.avatar || ''}" style="width:30px;height:30px;border-radius:50%;vertical-align:middle;margin-right:10px;"> <strong>${other.displayName || other.handle}</strong>`; }
        const msgRes = await chatAgent.chat.bsky.convo.getMessages({ convoId, limit: 50 });
        els.chatMessages.innerHTML = '';
        msgRes.data.messages.reverse().forEach(msg => {
            const isMine = msg.sender.did === agent.session.did;
            const bubble = document.createElement('div');
            bubble.style.cssText = `margin:5px; padding:8px; border-radius:10px; align-self:${isMine ? 'flex-end' : 'flex-start'}; background:${isMine ? '#0085ff' : '#eee'}; color:${isMine ? 'white' : 'black'}; max-width: 80%; word-break: break-word;`;
            let msgHtml = linkify(msg.text || "");
            if (isMine) { msgHtml = msgHtml.replace(/color: var\(--bsky-blue\);/g, 'color: white; text-decoration: underline;'); }
            bubble.innerHTML = msgHtml;
            els.chatMessages.appendChild(bubble);
        });
        els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
    } catch (e) {}
}

window.startDirectMessage = async (did) => {
    try { 
        pushState({ type: 'chat' });
        switchView('chat', els.chatView); 
        const profile = await agent.getProfile({ actor: did });
        els.chatHeader.innerHTML = `<img src="${profile.data.avatar || ''}" style="width:30px;height:30px;border-radius:50%;vertical-align:middle;margin-right:10px;"> <strong>${profile.data.displayName || profile.data.handle}</strong>`;
        const res = await getChatAgent().chat.bsky.convo.getConvoForMembers({ members: [did] }); 
        await fetchConvos(); loadConvo(res.data.convo.id); 
    } catch (e) { alert("DMを開始できませんでした。"); }
};

function switchView(viewId, activeDiv) {
    if (!els.viewTitle) return; 
    els.viewTitle.setAttribute('data-i18n', 'nav_' + viewId);
    els.viewTitle.innerText = t('nav_' + viewId);
    [els.timelineDiv, els.notifDiv, els.chatView, els.searchView, els.profileView, els.threadView, els.settingsView, els.bookmarksView].forEach(d => d?.classList.add('hidden'));
    if(activeDiv) activeDiv.classList.remove('hidden');
    document.querySelectorAll('.nav-links li').forEach(li => li.classList.remove('active'));
    document.getElementById(`nav-${viewId}`)?.classList.add('active');
    if (els.dropZone) { els.dropZone.style.display = (viewId === 'chat' || viewId === 'settings' || viewId === 'bookmarks') ? 'none' : ''; }
}

function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => { el.innerText = t(el.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); });
}

document.getElementById('login-btn').addEventListener('click', login);
document.getElementById('login-cancel-btn')?.addEventListener('click', () => { els.loginForm.classList.add('hidden'); if (els.app) els.app.style.opacity = "1"; });
document.getElementById('post-btn')?.addEventListener('click', sendPost);
document.getElementById('nav-home').addEventListener('click', () => { pushState({ type: 'home' }); switchView('home', els.timelineDiv); fetchTimeline(); });
document.getElementById('nav-notifications').addEventListener('click', () => { pushState({ type: 'notifications' }); switchView('notifications', els.notifDiv); fetchNotifications(); });
document.getElementById('nav-chat').addEventListener('click', () => { pushState({ type: 'chat' }); switchView('chat', els.chatView); fetchConvos(); });
document.getElementById('nav-search')?.addEventListener('click', () => { pushState({ type: 'search' }); switchView('search', els.searchView); });
document.getElementById('nav-profile').addEventListener('click', () => { window.loadProfile(agent.session.did); });
document.getElementById('nav-settings').addEventListener('click', () => { pushState({ type: 'settings' }); switchView('settings', els.settingsView); });

window.execSearch = async (q) => {
    const query = typeof q === 'string' ? q : document.getElementById('search-input')?.value.trim();
    if (!query) return;
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = query;
    pushState({ type: 'search' });
    switchView('search', els.searchView);
    try { 
        const res = await agent.app.bsky.feed.searchPosts({ q: query, limit: postLimit }); 
        renderPosts(res.data.posts, document.getElementById('search-results') || els.searchResults); 
    } catch (e) {}
};

document.getElementById('refresh-btn')?.addEventListener('click', () => {
    if (!els.timelineDiv.classList.contains('hidden')) fetchTimeline();
    else if (!els.notifDiv.classList.contains('hidden')) fetchNotifications();
    else if (!els.chatView.classList.contains('hidden')) fetchConvos();
    else if (els.bookmarksView && !els.bookmarksView.classList.contains('hidden')) fetchBookmarks();
});

document.getElementById('search-exec-btn')?.addEventListener('click', () => window.execSearch());
document.getElementById('add-account-btn')?.addEventListener('click', () => { els.loginForm.classList.remove('hidden'); if (els.app) els.app.style.opacity = "0.3"; });
document.getElementById('logout-btn')?.addEventListener('click', async () => {
    if (!confirm(t('logout_confirm'))) return;
    savedAccounts = savedAccounts.filter(acc => acc.did !== currentDid);
    await ipcRenderer.invoke('save-session', savedAccounts);
    if (savedAccounts.length > 0) { await switchAccount(savedAccounts[0].did); } 
    else { currentDid = null; document.getElementById('account-list').innerHTML = ''; showLoginForm(); }
});

document.getElementById('settings-save-btn')?.addEventListener('click', () => {
    const newLang = document.getElementById('setting-lang').value;
    const newLimit = parseInt(document.getElementById('setting-limit').value) || 30;
    const newBlur = document.getElementById('setting-nsfw').checked;
    localStorage.setItem('aerune_lang', newLang);
    localStorage.setItem('aerune_post_limit', newLimit.toString());
    localStorage.setItem('aerune_nsfw_blur', newBlur.toString());
    currentLang = newLang;
    nsfwBlur = newBlur;
    postLimit = Math.min(Math.max(newLimit, 10), 100);
    document.getElementById('setting-limit').value = postLimit;
    applyTranslations();
    const msg = document.getElementById('settings-msg');
    msg.innerText = t('settings_saved');
    setTimeout(() => { msg.innerText = ''; }, 3000);
});

document.getElementById('modal-close')?.addEventListener('click', () => { document.getElementById('image-modal')?.classList.add('hidden'); });
document.getElementById('image-modal')?.addEventListener('click', (e) => { if (e.target.id === 'image-modal') document.getElementById('image-modal').classList.add('hidden'); });

window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && document.activeElement === els.postInput) { e.preventDefault(); sendPost(); }
    if (e.key === 'Escape') { resetPostForm(); document.getElementById('quote-modal')?.classList.add('hidden'); document.getElementById('image-modal')?.classList.add('hidden'); }
});

window.addEventListener('paste', async (e) => {
    if (e.clipboardData && e.clipboardData.files.length > 0) {
        const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'));
        if (files.length > 0) { e.preventDefault(); await processIncomingImages(files); }
    }
});

window.doLike = async (uri, cid, likeUri) => { try { if (likeUri && likeUri !== 'null') await agent.deleteLike(likeUri); else await agent.like(uri, cid); fetchTimeline(); } catch(e){} };
window.doRepost = async (uri, cid, repostUri) => { try { if (repostUri && repostUri !== 'null') await agent.deleteRepost(repostUri); else await agent.repost(uri, cid); fetchTimeline(); } catch(e){} };
window.openModal = (url) => { document.getElementById('modal-image').src = url; document.getElementById('image-modal').classList.remove('hidden'); };
document.getElementById('image-input')?.addEventListener('change', async (e) => { await processIncomingImages(Array.from(e.target.files)); e.target.value = ''; });

const sendChatMessage = async () => {
    const input = document.getElementById('chat-msg-input'); 
    if (!input || !input.value.trim() || !currentConvoId) return;
    const text = input.value.trim();
    input.value = ''; 
    try {
        await getChatAgent().chat.bsky.convo.sendMessage({ convoId: currentConvoId, message: { text } });
        loadConvo(currentConvoId);
    } catch (e) { alert("DMの送信に失敗しました。"); input.value = text; }
};

document.getElementById('chat-send-btn')?.addEventListener('click', sendChatMessage);
document.getElementById('chat-msg-input')?.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); sendChatMessage(); } });

initApp();
