const { BskyAgent, RichText } = require('@atproto/api'); 
const { ipcRenderer, shell } = require('electron');

const translations = {
    ja: {
        nav_home: "ホーム", nav_notifications: "通知", nav_search: "検索", nav_profile: "プロフィール", nav_thread: "スレッド", nav_chat: "チャット",
        add_account: "＋ アカウント追加", logout: "ログアウト", post_placeholder: "今なにしてる？", send: "送信",
        login_title: "Aerune ログイン", login_id: "ハンドル名 (handle.bsky.social)", login_pw: "アプリパスワード", login_btn: "ログイン",
        reply_placeholder: "@{0} への返信", quote_placeholder: "@{0} を引用中...", login_failed: "ログインに失敗しました。", post_failed: "投稿に失敗しました。",
        delete_confirm: "このポストを削除しますか？", delete_failed: "削除に失敗しました。",
        follow_me: "フォローされています", following: "フォロー中", mutual: "相互フォロー", send_dm: "✉️ DMを送る",
        chat_placeholder: "メッセージを入力...", 
        notif_like: "があなたのポストをいいねしました", notif_repost: "があなたのポストをリポストしました",
        notif_follow: "があなたをフォローしました", notif_mention: "があなたをメンションしました",
        notif_reply: "があなたに返信しました", notif_quote: "があなたのポストを引用しました",
        search_btn: "検索", search_placeholder: "検索キーワードを入力...", reposted_by: "🔁 {0} がリポスト", logout_confirm: "現在のアカウントからログアウトしますか？",
        profile_reply: "＠ リプライ"
    },
    en: {
        nav_home: "Home", nav_notifications: "Notifications", nav_search: "Search", nav_profile: "Profile", nav_thread: "Thread", nav_chat: "Chat",
        add_account: "+ Add Account", logout: "Logout", post_placeholder: "What's up?", send: "Post",
        login_title: "Login to Aerune", login_id: "Handle (handle.bsky.social)", login_pw: "App Password", login_btn: "Login",
        reply_placeholder: "Reply to @{0}", quote_placeholder: "Quoting @{0}...", login_failed: "Login failed.", post_failed: "Post failed.", 
        delete_confirm: "Are you sure you want to delete this post?", delete_failed: "Failed to delete.",
        follow_me: "Follows you", following: "Following", mutual: "Mutual", send_dm: "✉️ Message",
        chat_placeholder: "Type a message...", 
        notif_like: "liked your post", notif_repost: "reposted your post",
        notif_follow: "followed you", notif_mention: "mentioned you",
        notif_reply: "replied to you", notif_quote: "quoted your post",
        search_btn: "Search", search_placeholder: "Enter keyword...", reposted_by: "🔁 Reposted by {0}", logout_confirm: "Are you sure you want to log out of the current account?",
        profile_reply: "@ Reply"
    }
};

let currentLang = localStorage.getItem('aerune_lang') || 'ja';
const t = (key, ...args) => {
    let text = translations[currentLang][key] || key;
    args.forEach((arg, i) => { text = text.replace(`{${i}}`, arg); });
    return text;
};

const agent = new BskyAgent({ service: 'https://bsky.social' });
let selectedImages = [], replyTarget = null, quoteTarget = null, savedAccounts = [], currentDid = null, currentConvoId = null;
const els = {};

// ★ 履歴管理用の変数
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
    els.viewTitle = get('view-title');
    els.postInput = get('post-input');
    els.loginForm = get('login-form');
    els.dropZone = get('drop-zone');
    els.quotePreview = get('quote-preview');
    els.imagePreviewContainer = get('image-preview-container');

    // ★ ヘッダーに戻るボタンを動的に追加
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
    }

    applyTranslations();

    if (els.dropZone) {
        els.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); els.dropZone.classList.add('drag-over'); });
        els.dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); els.dropZone.classList.remove('drag-over'); });
        els.dropZone.addEventListener('drop', (e) => {
            e.preventDefault(); e.stopPropagation(); els.dropZone.classList.remove('drag-over');
            const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
            if (files.length > 0) { selectedImages = [...selectedImages, ...files].slice(0, 4); updateImagePreview(); }
        });
    }

    try {
        const data = await ipcRenderer.invoke('load-session');
        if (data && (Array.isArray(data) ? data.length > 0 : data.did)) {
            savedAccounts = Array.isArray(data) ? data : [data];
            await switchAccount(savedAccounts[0].did);
        } else { showLoginForm(); }
    } catch (e) { showLoginForm(); }
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
    } catch (e) { alert(t('login_failed')); } finally { btn.disabled = false; btn.innerText = t('login_btn'); }
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
    // ★ 起動時にホームの履歴を積む
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

function linkify(text) {
    if (!text) return '';
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
    return escaped;
}

function createPostElement(post, isThreadRoot = false, isQuoteModal = false, reason = null) {
    const author = post.author, viewer = post.viewer || {}, root = post.record?.reply?.root || { uri: post.uri, cid: post.cid };
    const div = document.createElement('div');
    div.className = 'post';
    if (isThreadRoot) div.style.borderLeft = '4px solid var(--bsky-blue)';
    
    // ★ コピペ対策: テキスト選択中は遷移しない
    if (!isQuoteModal) {
        div.onclick = () => {
            if (window.getSelection().toString().length > 0) return;
            window.loadThread(post.uri);
        };
    }

    let embedHtml = '';
    const embed = post.embed;

    if (embed) {
        if (embed.$type === 'app.bsky.embed.images#view') {
            embedHtml = `<div class="post-images">` + embed.images.map(img => `<img src="${img.thumb}" class="post-img-thumb" onclick="window.openModal('${img.fullsize}'); event.stopPropagation();">`).join('') + `</div>`;
        } 
        else if (embed.$type === 'app.bsky.embed.record#view') {
            const rec = embed.record;
            if (rec.author) {
                let quoteMediaHtml = '';
                if (rec.embeds && rec.embeds[0] && rec.embeds[0].$type === 'app.bsky.embed.images#view') {
                    quoteMediaHtml = `<div class="post-images" style="margin-top:8px;">` + rec.embeds[0].images.map(img => `<img src="${img.thumb}" class="post-img-thumb" onclick="window.openModal('${img.fullsize}'); event.stopPropagation();">`).join('') + `</div>`;
                }
                embedHtml = `
                <div class="embedded-quote" onclick="window.openQuoteModal(event, ${JSON.stringify(rec).replace(/"/g, '&quot;')}); event.stopPropagation();">
                    <strong>${rec.author.displayName || rec.author.handle}</strong> <span style="color:gray;">@${rec.author.handle}</span>
                    <div style="font-size:0.9em; margin-top:4px;">${linkify(rec.value?.text || rec.record?.text)}</div>
                    ${quoteMediaHtml}
                </div>`;
            }
        }
        else if (embed.$type === 'app.bsky.embed.recordWithMedia#view') {
            if (embed.media?.images) {
                embedHtml = `<div class="post-images">` + embed.media.images.map(img => `<img src="${img.thumb}" class="post-img-thumb" onclick="window.openModal('${img.fullsize}'); event.stopPropagation();">`).join('') + `</div>`;
            }
            const rec = embed.record.record;
            if (rec && rec.author) {
                let quoteMediaHtml = '';
                if (rec.embeds && rec.embeds[0] && rec.embeds[0].$type === 'app.bsky.embed.images#view') {
                    quoteMediaHtml = `<div class="post-images" style="margin-top:8px;">` + rec.embeds[0].images.map(img => `<img src="${img.thumb}" class="post-img-thumb" onclick="window.openModal('${img.fullsize}'); event.stopPropagation();">`).join('') + `</div>`;
                }
                embedHtml += `
                <div class="embedded-quote" onclick="window.openQuoteModal(event, ${JSON.stringify(rec).replace(/"/g, '&quot;')}); event.stopPropagation();">
                    <strong>${rec.author.displayName || rec.author.handle}</strong>
                    <div style="font-size:0.9em; margin-top:4px;">${linkify(rec.value?.text || rec.record?.text)}</div>
                    ${quoteMediaHtml}
                </div>`;
            }
        }
    }

    let repostHtml = '';
    if (reason && reason.$type === 'app.bsky.feed.defs#reasonRepost') {
        const reposterName = reason.by.displayName || reason.by.handle;
        repostHtml = `<div style="font-size: 0.85em; color: gray; margin-bottom: 4px; font-weight: bold;">${t('reposted_by', reposterName)}</div>`;
    }

    div.innerHTML = `
        <img src="${author.avatar || ''}" class="post-avatar" onclick="window.loadProfile('${author.handle}'); event.stopPropagation();">
        <div class="post-content">
            ${repostHtml}
            <div class="post-header"><strong>${author.displayName || author.handle}</strong> <span style="color:gray;">@${author.handle}</span></div>
            <div class="post-text">${linkify(post.record?.text || post.value?.text)}</div>
            ${embedHtml}
            <div class="post-actions" onclick="event.stopPropagation();">
                <button onclick="window.prepareReply('${post.uri}', '${post.cid}', '${author.handle}', '${root.uri}', '${root.cid}')" class="action-btn">💬 ${post.replyCount || 0}</button>
                <button onclick="window.doRepost('${post.uri}', '${post.cid}', ${viewer.repost ? `'${viewer.repost}'` : 'null'})" class="action-btn ${viewer.repost ? 'reposted' : ''}">🔁 ${post.repostCount || 0}</button>
                <button onclick="window.prepareQuote('${post.uri}', '${post.cid}', '${author.handle}', '${(post.record?.text || post.value?.text || '').replace(/'/g, "\\'")}')" class="action-btn">📝</button>
                <button onclick="window.doLike('${post.uri}', '${post.cid}', ${viewer.like ? `'${viewer.like}'` : 'null'})" class="action-btn ${viewer.like ? 'liked' : ''}">❤️ ${post.likeCount || 0}</button>
                ${author.did === currentDid ? `<button onclick="window.deletePost('${post.uri}')" class="action-btn" style="margin-left:auto;">🗑️</button>` : ''}
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
    const btn = document.getElementById('post-btn');
    try {
        btn.disabled = true;
        let imagesEmbed = undefined, finalEmbed = undefined;
        if (selectedImages.length > 0) {
            const blobs = [];
            for (const file of selectedImages) {
                const compressed = await compressImage(file);
                const res = await agent.uploadBlob(new Uint8Array(await compressed.arrayBuffer()), { encoding: 'image/jpeg' });
                blobs.push({ image: res.data.blob, alt: "" });
            }
            imagesEmbed = { $type: 'app.bsky.embed.images', images: blobs };
        }
        if (quoteTarget) {
            const recordEmbed = { $type: 'app.bsky.embed.record', record: quoteTarget };
            finalEmbed = imagesEmbed ? { $type: 'app.bsky.embed.recordWithMedia', media: imagesEmbed, record: recordEmbed } : recordEmbed;
        } else { finalEmbed = imagesEmbed; }

        const rt = new RichText({ text });
        await rt.detectFacets(agent);
        const postData = { text: rt.text, facets: rt.facets, embed: finalEmbed, createdAt: new Date().toISOString() };
        if (replyTarget) postData.reply = { root: replyTarget.root, parent: { uri: replyTarget.uri, cid: replyTarget.cid } };

        await agent.post(postData);
        resetPostForm();
        setTimeout(fetchTimeline, 500);
    } catch (e) { alert(t('post_failed')); } finally { btn.disabled = false; }
}

window.deletePost = async (uri) => {
    if (!confirm(t('delete_confirm'))) return;
    try { await agent.deletePost(uri); fetchTimeline(); } catch (e) { alert(t('delete_failed')); }
};

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
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
                canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.8);
            };
        };
    });
}

function updateImagePreview() {
    if (!els.imagePreviewContainer) return;
    els.imagePreviewContainer.innerHTML = '';
    selectedImages.forEach((file, index) => {
        const img = document.createElement('img'); img.src = URL.createObjectURL(file);
        img.className = 'preview-thumb'; img.title = "クリックで削除";
        img.onclick = () => { selectedImages.splice(index, 1); updateImagePreview(); };
        els.imagePreviewContainer.appendChild(img);
    });
}

window.prepareReply = (uri, cid, handle, rootUri, rootCid) => {
    resetPostForm();
    replyTarget = { uri, cid, root: { uri: rootUri || uri, cid: rootCid || cid } };
    els.postInput.placeholder = t('reply_placeholder', handle);
    els.postInput.value = ''; 
    els.postInput.focus();
};

window.prepareQuote = (uri, cid, handle, text) => {
    resetPostForm();
    quoteTarget = { uri, cid };
    els.quotePreview.classList.remove('hidden');
    els.quotePreview.innerHTML = `<span class="quote-preview-close" onclick="resetPostForm()">×</span><strong>@${handle}</strong>: ${text.substring(0, 60)}...`;
    els.postInput.focus();
};

window.prepareProfileReply = (handle) => {
    resetPostForm();
    els.postInput.value = `@${handle} `;
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

async function fetchTimeline() { try { const res = await agent.getTimeline({ limit: 30 }); renderPosts(res.data.feed, els.timelineDiv); } catch (e) {} }

async function fetchNotifications() {
    try {
        const res = await agent.listNotifications({ limit: 30 });
        const notifications = res.data.notifications;
        const uris = notifications.filter(n => (n.reason === 'like' || n.reason === 'repost') && n.reasonSubject).map(n => n.reasonSubject);
        const postMap = {};
        if (uris.length > 0) { const postsRes = await agent.getPosts({ uris }); postsRes.data.posts.forEach(p => { postMap[p.uri] = p.record.text; }); }
        els.notifDiv.innerHTML = '';
        notifications.forEach(n => {
            const div = document.createElement('div'); div.className = 'post';
            // ★ コピペ対策
            if (n.reasonSubject || n.uri) {
                div.onclick = () => {
                    if (window.getSelection().toString().length > 0) return;
                    window.loadThread(n.reasonSubject || n.uri);
                };
            }
            
            // ★ 返信などの場合は相手のテキストを表示する
            let previewText = '';
            if (n.reason === 'like' || n.reason === 'repost') {
                previewText = postMap[n.reasonSubject] || '';
            } else if (n.reason === 'reply' || n.reason === 'quote' || n.reason === 'mention') {
                previewText = n.record?.text || '';
            }
            
            const preview = previewText ? `<div class="post-text" style="color:gray; font-size:0.85em; margin-top:4px; padding:4px 8px; border-left:2px solid #ddd;">${linkify(previewText)}</div>` : '';
            div.innerHTML = `<img src="${n.author.avatar || ''}" class="post-avatar"> <div class="post-content"><strong>${n.author.displayName || n.author.handle}</strong> <span>${t('notif_' + n.reason)}</span>${preview}</div>`;
            els.notifDiv.appendChild(div);
        });
        await agent.updateSeenNotifications(); checkNotifs();
    } catch (e) {}
}

// ★ isBackフラグを追加して履歴が二重に積まれないようにする
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
            container.appendChild(createPostElement(item.post, isRoot));
            if (item.replies) item.replies.forEach(reply => {
                const el = createPostElement(reply.post); el.style.marginLeft = '40px'; el.style.borderLeft = '2px solid #eee';
                container.appendChild(el);
            });
        };
        renderThreadItem(res.data.thread, true);
    } catch (e) { container.innerHTML = '<div style="padding:20px;">Failed to load thread.</div>'; }
};

window.loadProfile = async (actor, isBack = false) => {
    if (!isBack) pushState({ type: 'profile', actor });
    switchView('profile', els.profileView);
    const container = document.getElementById('profile-header-container');
    container.innerHTML = 'Loading...';
    try {
        const res = await agent.getProfile({ actor });
        const p = res.data;
        const dmBtn = p.did !== agent.session.did ? `<button onclick="window.startDirectMessage('${p.did}')" class="sidebar-action-btn" style="width:auto; padding:5px 15px; margin-right:10px;">${t('send_dm')}</button>` : '';
        const replyBtn = `<button onclick="window.prepareProfileReply('${p.handle}')" class="sidebar-action-btn" style="width:auto; padding:5px 15px;">${t('profile_reply')}</button>`;
        
        const actionBtns = p.did !== agent.session.did ? `<div style="margin-top:15px;">${dmBtn}${replyBtn}</div>` : '';
        
        const rel = p.viewer?.following && p.viewer?.followedBy ? `<span class="relationship-badge">${t('mutual')}</span>` : (p.viewer?.following ? `<span class="relationship-badge">${t('following')}</span>` : (p.viewer?.followedBy ? `<span class="relationship-badge">${t('follow_me')}</span>` : ''));
        
        container.innerHTML = `<img src="${p.banner || ''}" style="width:100%; height:150px; object-fit:cover;"><div style="padding:20px; position:relative;"><img src="${p.avatar || ''}" style="width:80px; height:80px; border-radius:50%; border:4px solid white; position:absolute; top:-40px;"><div style="margin-top:40px;"><div style="font-size:20px; font-weight:bold;">${p.displayName || p.handle}${rel}</div><div style="color:gray;">@${p.handle}</div><div style="margin-top:10px; word-break: break-word;">${linkify(p.description || '')}</div>${actionBtns}</div></div>`;
        const feed = await agent.getAuthorFeed({ actor, limit: 30 });
        renderPosts(feed.data.feed, document.getElementById('profile-timeline'));
    } catch (e) { container.innerHTML = 'Failed to load profile.'; }
};

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
        if (other) {
            els.chatHeader.innerHTML = `<img src="${other.avatar || ''}" style="width:30px;height:30px;border-radius:50%;vertical-align:middle;margin-right:10px;"> <strong>${other.displayName || other.handle}</strong>`;
        }

        const msgRes = await chatAgent.chat.bsky.convo.getMessages({ convoId, limit: 50 });
        els.chatMessages.innerHTML = '';
        msgRes.data.messages.reverse().forEach(msg => {
            const isMine = msg.sender.did === agent.session.did;
            const bubble = document.createElement('div');
            bubble.style.cssText = `margin:5px; padding:8px; border-radius:10px; align-self:${isMine ? 'flex-end' : 'flex-start'}; background:${isMine ? '#0085ff' : '#eee'}; color:${isMine ? 'white' : 'black'}; max-width: 80%; word-break: break-word;`;
            
            let msgHtml = linkify(msg.text || "");
            if (isMine) {
                msgHtml = msgHtml.replace(/color: var\(--bsky-blue\);/g, 'color: white; text-decoration: underline;');
            }
            bubble.innerHTML = msgHtml;
            
            els.chatMessages.appendChild(bubble);
        });
        els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
    } catch (e) {}
}

window.startDirectMessage = async (did) => {
    try { 
        pushState({ type: 'chat' }); // DM画面への移動履歴
        switchView('chat', els.chatView); 
        const profile = await agent.getProfile({ actor: did });
        els.chatHeader.innerHTML = `<img src="${profile.data.avatar || ''}" style="width:30px;height:30px;border-radius:50%;vertical-align:middle;margin-right:10px;"> <strong>${profile.data.displayName || profile.data.handle}</strong>`;
        
        const res = await getChatAgent().chat.bsky.convo.getConvoForMembers({ members: [did] }); 
        await fetchConvos(); 
        loadConvo(res.data.convo.id); 
    } catch (e) { alert("DMを開始できませんでした。"); }
};

function switchView(viewId, activeDiv) {
    if (!els.viewTitle) return; els.viewTitle.innerText = t('nav_' + viewId);
    [els.timelineDiv, els.notifDiv, els.chatView, els.searchView, els.profileView, els.threadView].forEach(d => d?.classList.add('hidden'));
    if(activeDiv) activeDiv.classList.remove('hidden');
    document.querySelectorAll('.nav-links li').forEach(li => li.classList.remove('active'));
    document.getElementById(`nav-${viewId}`)?.classList.add('active');

    if (els.dropZone) {
        els.dropZone.style.display = (viewId === 'chat') ? 'none' : '';
    } else if (els.postInput && els.postInput.parentElement) {
        els.postInput.parentElement.style.display = (viewId === 'chat') ? 'none' : '';
    }
}

function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => { el.innerText = t(el.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); });
}

// ------------------------------------------
// イベントリスナー (タブクリック時にも履歴を積む)
// ------------------------------------------
document.getElementById('login-btn').addEventListener('click', login);
document.getElementById('post-btn')?.addEventListener('click', sendPost);

document.getElementById('nav-home').addEventListener('click', () => { 
    pushState({ type: 'home' }); switchView('home', els.timelineDiv); fetchTimeline(); 
});
document.getElementById('nav-notifications').addEventListener('click', () => { 
    pushState({ type: 'notifications' }); switchView('notifications', els.notifDiv); fetchNotifications(); 
});
document.getElementById('nav-chat').addEventListener('click', () => { 
    pushState({ type: 'chat' }); switchView('chat', els.chatView); fetchConvos(); 
});
document.getElementById('nav-search')?.addEventListener('click', () => { 
    pushState({ type: 'search' }); switchView('search', els.searchView); 
});
document.getElementById('nav-profile').addEventListener('click', () => { 
    window.loadProfile(agent.session.did); 
});

window.execSearch = async (q) => {
    const query = typeof q === 'string' ? q : document.getElementById('search-input')?.value.trim();
    if (!query) return;
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = query;
    pushState({ type: 'search' });
    switchView('search', els.searchView);
    try { 
        const res = await agent.app.bsky.feed.searchPosts({ q: query, limit: 30 }); 
        renderPosts(res.data.posts, document.getElementById('search-results') || els.searchResults); 
    } catch (e) {}
};

document.getElementById('refresh-btn')?.addEventListener('click', () => {
    if (!els.timelineDiv.classList.contains('hidden')) fetchTimeline();
    else if (!els.notifDiv.classList.contains('hidden')) fetchNotifications();
    else if (!els.chatView.classList.contains('hidden')) fetchConvos();
});

document.getElementById('search-exec-btn')?.addEventListener('click', () => window.execSearch());

document.getElementById('add-account-btn')?.addEventListener('click', () => {
    els.loginForm.classList.remove('hidden');
    if (els.app) els.app.style.opacity = "0.3";
});

document.getElementById('logout-btn')?.addEventListener('click', async () => {
    if (!confirm(t('logout_confirm'))) return;
    savedAccounts = savedAccounts.filter(acc => acc.did !== currentDid);
    await ipcRenderer.invoke('save-session', savedAccounts);
    if (savedAccounts.length > 0) {
        await switchAccount(savedAccounts[0].did);
    } else {
        currentDid = null;
        document.getElementById('account-list').innerHTML = '';
        showLoginForm();
    }
});

document.getElementById('modal-close')?.addEventListener('click', () => { document.getElementById('image-modal')?.classList.add('hidden'); });
document.getElementById('image-modal')?.addEventListener('click', (e) => { if (e.target.id === 'image-modal') document.getElementById('image-modal').classList.add('hidden'); });

window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && document.activeElement === els.postInput) { e.preventDefault(); sendPost(); }
    if (e.key === 'Escape') { 
        resetPostForm(); 
        document.getElementById('quote-modal')?.classList.add('hidden'); 
        document.getElementById('image-modal')?.classList.add('hidden'); 
    }
});

window.doLike = async (uri, cid, likeUri) => { try { if (likeUri) await agent.deleteLike(likeUri); else await agent.like(uri, cid); fetchTimeline(); } catch(e){} };
window.doRepost = async (uri, cid, repostUri) => { try { if (repostUri) await agent.deleteRepost(repostUri); else await agent.repost(uri, cid); fetchTimeline(); } catch(e){} };
window.openModal = (url) => { document.getElementById('modal-image').src = url; document.getElementById('image-modal').classList.remove('hidden'); };
document.getElementById('image-input')?.addEventListener('change', (e) => { selectedImages = [...selectedImages, ...Array.from(e.target.files)].slice(0, 4); updateImagePreview(); });

const sendChatMessage = async () => {
    const input = document.getElementById('chat-msg-input'); 
    if (!input || !input.value.trim() || !currentConvoId) return;
    const text = input.value.trim();
    input.value = ''; 
    try {
        await getChatAgent().chat.bsky.convo.sendMessage({ convoId: currentConvoId, message: { text } });
        loadConvo(currentConvoId);
    } catch (e) {
        alert("DMの送信に失敗しました。");
        input.value = text; 
    }
};

document.getElementById('chat-send-btn')?.addEventListener('click', sendChatMessage);

document.getElementById('chat-msg-input')?.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault(); 
        sendChatMessage();
    }
});

initApp();
