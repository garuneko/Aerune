// renderer.js 
// Aerune メインエントリーポイント

const { ipcRenderer, shell } = require('electron');
const { RichText } = require('@atproto/api');
const { hasSelection, compressImage, downloadImage, linkify, renderRichText } = require('./utils.js');
const Navigation = require('./navigation.js');
const BskyAPI = require('./bsky-api.js');
const { ICON_CACHE, translations } = require('./constants.js');
const { createPostElement, renderPosts, getPost: getStoredPost, getQuote: getStoredQuote } = require('./post-renderer.js');
const AppActions = require('./actions.js');
const ViewLoader = require('./view-loader.js');

// ─── グローバル状態 ───────────────────────────────────────────────
const api = new BskyAPI();
const nav = new Navigation();
const els = {};
let savedAccounts = [], currentDid = null;
let selectedImages = [], replyTarget = null, quoteTarget = null;
let currentConvoId = null;
window.aeruneBookmarks = new Set();

// ─── 設定 ─────────────────────────────────────────────────────────
let currentLang = localStorage.getItem('aerune_lang') || (navigator.language.startsWith('ja') ? 'ja' : 'en');
let postLimit = Math.max(10, Math.min(100, parseInt(localStorage.getItem('aerune_post_limit')) || 30));
let nsfwBlur = localStorage.getItem('aerune_nsfw_blur') !== 'false';
let showBookmarksConfig = localStorage.getItem('aerune_show_bookmarks') !== 'false';
window.aeruneTimeFormat = localStorage.getItem('aerune_time_format') || 'relative';

// ─── i18n ────────────────────────────────────────────────────────
const t = (key, ...args) => {
    let text = translations[currentLang]?.[key] ?? key;
    for (let i = 0; i < args.length; i++) text = text.replace(`{${i}}`, args[i]);
    return text;
};

// ─── アイコン (事前キャッシュ済みHTML文字列を返すだけ) ────────────
const getIcon = (key) => ICON_CACHE[key] || '';

const getRenderContext = () => ({
    api, t, getIcon, nsfwBlur,
    aeruneBookmarks: window.aeruneBookmarks,
    timeFormat: window.aeruneTimeFormat || 'relative',
});

// ─── スタイル (一度だけ注入) ──────────────────────────────────────
{
    const s = document.createElement('style');
    s.textContent = `.svg-icon{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;min-width:18px;flex-shrink:0;vertical-align:middle;margin-right:4px;opacity:.6;transition:all .2s}.svg-icon svg{width:100%;height:100%;display:block}.action-btn{display:inline-flex;align-items:center;background:transparent;border:none;cursor:pointer;padding:4px 8px;color:gray;font-size:.9em}.action-btn:hover .svg-icon{opacity:1;transform:scale(1.1)}.action-btn.liked{color:#e0245e!important}.action-btn.liked .svg-icon{opacity:1;color:#e0245e}.action-btn.liked .svg-icon svg path{fill:#e0245e!important;stroke:#e0245e!important}.action-btn.reposted{color:#17bf63!important}.action-btn.reposted .svg-icon{opacity:1;color:#17bf63}.action-btn.reposted .svg-icon svg path{stroke:#17bf63!important}.action-btn.bookmarked{color:var(--bsky-blue)!important}.action-btn.bookmarked .svg-icon{opacity:1;color:var(--bsky-blue)}.action-btn.bookmarked .svg-icon svg path{fill:var(--bsky-blue)!important;stroke:var(--bsky-blue)!important}.ctx-menu-item .svg-icon{width:16px;height:16px;min-width:16px;flex-shrink:0;margin-right:8px;margin-bottom:2px;opacity:1}.thread-line{position:relative}.thread-line::before{content:'';position:absolute;left:38px;top:62px;bottom:-12px;width:2px;background:#e5e7eb;z-index:1}`;
    document.head.appendChild(s);
}

// ─── ナビゲーション ───────────────────────────────────────────────
function updateBackBtn() {
    const b = document.getElementById('back-btn');
    if (b) b.style.display = nav.canGoBack ? 'inline-block' : 'none';
}

function goBack() {
    const prev = nav.pop(); 
    if (!prev) return;
    updateBackBtn();

    const restoreScroll = (container) => {
        if (!container || prev._scrollTop == null) return;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            container.scrollTop = prev._scrollTop;
        }));
    };

    switch (prev.type) {
        case 'home':
            switchView('home', els.timelineDiv);
            viewLoader.fetchTimeline(postLimit).then(() => restoreScroll(els.timelineDiv));
            break;
        case 'notifications':
            switchView('notifications', els.notifDiv);
            viewLoader.fetchNotifications(postLimit).then(() => restoreScroll(els.notifDiv));
            break;
        case 'chat':
            switchView('chat', els.chatView);
            fetchConvos();
            break;
        case 'search':
            switchView('search', els.searchView);
            restoreScroll(document.getElementById('search-results'));
            break;
        case 'profile':
            window.loadProfile(prev.actor, true);
            break;
        case 'thread':
            window.loadThread(prev.uri, true);
            break;
        case 'settings':
            switchView('settings', els.settingsView);
            break;
        case 'bookmarks':
            switchView('bookmarks', els.bookmarksView);
            viewLoader.fetchBookmarks(postLimit).then(() => restoreScroll(els.bookmarksView));
            break;
    }
}

// ─── モジュール初期化 ─────────────────────────────────────────────
let viewLoader, actions;

function initModules() {
    viewLoader = new ViewLoader(api, getRenderContext, els);
    actions = new AppActions(api, t, {
        timeline:  () => viewLoader.fetchTimeline(postLimit),
        bookmarks: () => viewLoader.fetchBookmarks(postLimit),
        current:   () => {
            if (!els.timelineDiv.classList.contains('hidden'))         viewLoader.fetchTimeline(postLimit);
            else if (els.profileView && !els.profileView.classList.contains('hidden') && nav.current?.type === 'profile')
                                                                        viewLoader.loadProfile(nav.current.actor, postLimit);
            else if (els.bookmarksView && !els.bookmarksView.classList.contains('hidden'))
                                                                        viewLoader.fetchBookmarks(postLimit);
        },
        profile:   actor => viewLoader.loadProfile(actor, postLimit)
    }, ipcRenderer, nav);
}

// ─── グローバル公開 ───────────────────────────────────────────────
window.doLike          = (u, c, l)     => actions.doLike(u, c, l);
window.doRepost        = (u, c, r)     => actions.doRepost(u, c, r);
window.deletePost      = u             => actions.deletePost(u);
window.toggleBookmark  = post          => actions.toggleBookmark(post);
window.toggleFollow    = (d, f)        => actions.toggleFollow(d, f);
window.toggleMute      = (d, m)        => actions.toggleMute(d, m);
window.toggleBlock     = (d, b)        => actions.toggleBlock(d, b);
window.togglePin       = post          => actions.togglePin(post);

window.loadProfile = (actor, isBack = false) => {
    if (!isBack) { nav.push({ type: 'profile', actor }, _activeView); updateBackBtn(); }
    switchView('profile', els.profileView);
    viewLoader.loadProfile(actor, postLimit);
};

window.loadThread = (uri, isBack = false) => {
    if (!isBack) { nav.push({ type: 'thread', uri }, _activeView); updateBackBtn(); }
    switchView('thread', els.threadView);
    viewLoader.loadThread(uri);
};

window.openModal = (url) => {
    const img   = document.getElementById('modal-image');
    const modal = document.getElementById('image-modal');
    if (img)   img.src = url;
    if (modal) modal.classList.remove('hidden');
};

window.openQuoteModal = (e, rec) => {
    if (!els.quoteModal || !els.quoteModalBody) return;
    els.quoteModalBody.textContent = '';
    els.quoteModalBody.appendChild(createPostElement(rec, getRenderContext(), false, true));
    els.quoteModal.classList.remove('hidden');
};

window.prepareReply = (uri, cid, handle, rootUri, rootCid) => {
    replyTarget = { uri, cid, root: { uri: rootUri || uri, cid: rootCid || cid } };
    els.postInput.placeholder = t('reply_placeholder', handle);
    els.postInput.focus();
};

window.prepareQuote = (uri, cid, handle, text) => {
    quoteTarget = { uri, cid };
    els.quotePreview.classList.remove('hidden');
    const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    els.quotePreview.innerHTML = `<span class="quote-preview-close" onclick="resetPostForm()">×</span><strong>@${handle}</strong>: ${safe.substring(0, 60)}...`;
    els.postInput.focus();
};

window.prepareProfileReply = handle => {
    els.postInput.value = `@${handle} ` + els.postInput.value;
    els.postInput.focus();
};

window.execSearch = async (q) => {
    const query = typeof q === 'string' ? q : document.getElementById('search-input')?.value.trim();
    if (!query) return;
    const si = document.getElementById('search-input');
    if (si) si.value = query;
    nav.push({ type: 'search' }, _activeView); updateBackBtn();
    switchView('search', els.searchView);
    try {
        const res = await api.searchPosts(query, postLimit);
        renderPosts(res.data.posts, document.getElementById('search-results'), getRenderContext());
    } catch (e) { console.error('execSearch:', e); }
};

// ─── コンテキストメニュー ─────────────────────────────────────────
window.showContextMenu = (x, y, items) => {
    if (!els.ctxMenu) return;
    const frag = document.createDocumentFragment();
    for (const item of items) {
        if (item.divider) {
            const d = document.createElement('div'); d.className = 'ctx-divider';
            frag.appendChild(d);
        } else {
            const d = document.createElement('div'); d.className = 'ctx-menu-item';
            if (item.color) d.style.color = item.color;
            d.innerHTML = item.label;
            d.onclick = e => { e.stopPropagation(); els.ctxMenu.classList.add('hidden'); item.action(); };
            frag.appendChild(d);
        }
    }
    els.ctxMenu.textContent = '';
    els.ctxMenu.appendChild(frag);
    els.ctxMenu.classList.remove('hidden');
    const rect = els.ctxMenu.getBoundingClientRect();
    els.ctxMenu.style.left = `${Math.max(0, Math.min(x, window.innerWidth  - rect.width  - 10))}px`;
    els.ctxMenu.style.top  = `${Math.max(0, Math.min(y, window.innerHeight - rect.height - 10))}px`;
};

// ─── イベント委譲（一括登録） ─────────────────────────────────────
function installDelegates() {
    document.addEventListener('click', e => {
        const a = e.target.closest('a[data-ext],a[data-search],a[data-profile]');
        if (a) {
            e.preventDefault(); e.stopPropagation();
            if (a.dataset.ext)     shell.openExternal(a.dataset.ext);
            else if (a.dataset.search)   window.execSearch(a.dataset.search);
            else if (a.dataset.profile)  window.loadProfile(a.dataset.profile);
            return;
        }
        const extBlock = e.target.closest('[data-ext]:not(a)');
        if (extBlock?.dataset.ext) {
            e.preventDefault(); e.stopPropagation();
            shell.openExternal(extBlock.dataset.ext);
            return;
        }
        
        const actEl = e.target.closest('[data-act]');
        if (!actEl) return;
        const act = actEl.dataset.act;
        if (!act || act === 'noop') return;
        const postEl = actEl.closest('.post');
        if (!postEl) return;
        e.preventDefault(); e.stopPropagation();

        const { uri, cid, rootUri, rootCid, handle } = postEl.dataset;
        const post = getStoredPost(uri);

        switch (act) {
            case 'profile':   window.loadProfile(actEl.dataset.actor || handle); break;
            case 'reply':     window.prepareReply(uri, cid, handle, rootUri, rootCid); break;
            case 'quote':     window.prepareQuote(uri, cid, handle, post?.record?.text || post?.value?.text || ''); break;
            case 'repost': {
                if (!post) break;
                const isReposted = !!post.viewer?.repost;
                const ogUri = post.viewer?.repost;
                
                actEl.classList.toggle('reposted', !isReposted);
                post.repostCount = Math.max(0, (post.repostCount || 0) + (isReposted ? -1 : 1));
                actEl.innerHTML = `${getIcon('repost')} ${post.repostCount || 0}`;
                post.viewer = post.viewer || {};
                post.viewer.repost = isReposted ? null : 'pending';
                
                window.doRepost(uri, cid, ogUri || null).then(res => {
                    if (res && res.action === 'created') post.viewer.repost = res.uri;
                }).catch(() => { /* エラー時は無視 */ });
                break;
            }
            case 'like': {
                if (!post) break;
                const isLiked = !!post.viewer?.like;
                const ogUri = post.viewer?.like;
                
                actEl.classList.toggle('liked', !isLiked);
                post.likeCount = Math.max(0, (post.likeCount || 0) + (isLiked ? -1 : 1));
                actEl.innerHTML = `${getIcon('like')} ${post.likeCount || 0}`;
                post.viewer = post.viewer || {};
                post.viewer.like = isLiked ? null : 'pending';
                
                window.doLike(uri, cid, ogUri || null).then(res => {
                    if (res && res.action === 'created') post.viewer.like = res.uri;
                }).catch(() => { /* エラー時は無視 */ });
                break;
            }
            case 'bookmark': {
                if (!post) break;
                const isBm = window.aeruneBookmarks.has(post.uri) || !!post.viewer?.bookmark;
                
                actEl.classList.toggle('bookmarked', !isBm);
                if (isBm) window.aeruneBookmarks.delete(post.uri);
                else window.aeruneBookmarks.add(post.uri);
                
                post.viewer = post.viewer || {};
                post.viewer.bookmark = isBm ? null : 'bookmarked';
                actEl.innerHTML = getIcon('bookmark');
                
                window.toggleBookmark(post);
                break;
            }
            case 'delete': {
                if (confirm(t('delete_confirm'))) {
                    postEl.style.display = 'none';
                    window.deletePost(uri).catch(() => {
                        postEl.style.display = '';
                    });
                }
                break;
            }
            case 'open-image': window.openModal(actEl.dataset.url || actEl.dataset.fullsize || ''); break;
            case 'open-quote': {
                const rec = getStoredQuote(actEl.dataset.qid);
                if (rec) window.openQuoteModal(e, rec);
                break;
            }
        }
    }, true);

    document.addEventListener('dblclick', e => {
        if (hasSelection()) return;
        const postEl = e.target.closest('.post');
        if (!postEl || e.target.closest('a,[data-act]')) return;
        if (postEl.dataset.notif === '1') {
            postEl.dataset.reason === 'follow'
                ? window.loadProfile(postEl.dataset.actor)
                : postEl.dataset.thread && window.loadThread(postEl.dataset.thread);
            return;
        }
        if (postEl.dataset.noThread === '1') return;
        if (postEl.dataset.uri) window.loadThread(postEl.dataset.uri);
    }, true);

    document.addEventListener('contextmenu', e => {
        const postEl = e.target.closest('.post');
        if (!postEl || hasSelection()) return;
        e.preventDefault(); e.stopPropagation();

        if (e.target.tagName === 'IMG') {
            window.showContextMenu(e.clientX, e.clientY, [
                { label: t('save_image'), action: () => downloadImage(e.target.dataset.fullsize || e.target.src) }
            ]);
            return;
        }

        const { uri, did, actor, reason, thread, following, muted, blocking } = postEl.dataset;

        if (postEl.dataset.notif === '1') {
            const isMe = api.session && did === api.session.did;
            const opts = [];
            if (reason !== 'follow' && thread) opts.push({ label: t('nav_thread'), action: () => window.loadThread(thread) });
            opts.push({ label: t('ctx_profile'), action: () => window.loadProfile(actor) });
            if (!isMe) {
                opts.push({ divider: true });
                opts.push({ label: following ? t('ctx_unfollow') : t('ctx_follow'), action: () => window.toggleFollow(did, following) });
                opts.push({ label: muted     ? t('ctx_unmute')   : t('ctx_mute'),   action: () => window.toggleMute(did, muted) });
                opts.push({ label: blocking  ? t('ctx_unblock')  : t('ctx_block'),  action: () => window.toggleBlock(did, blocking), color: '#d93025' });
            }
            if (opts.length) window.showContextMenu(e.clientX, e.clientY, opts);
            return;
        }

        const post = getStoredPost(uri);
        if (!post) return;

        const au = post.author;
        const pv = post.viewer || {};
        const av = au.viewer || {};
        const root = post.record?.reply?.root || { uri: post.uri, cid: post.cid };
        const isMe2 = api.session && au.did === api.session.did;
        const isBm  = window.aeruneBookmarks.has(post.uri) || !!pv.bookmark;

        const opts = [
            { label: t('ctx_reply'),    action: () => window.prepareReply(post.uri, post.cid, au.handle, root.uri, root.cid) },
            { label: t('ctx_repost'),   action: () => window.doRepost(post.uri, post.cid, pv.repost || null) },
            { label: t('ctx_quote'),    action: () => window.prepareQuote(post.uri, post.cid, au.handle, post.record?.text || '') },
            { divider: true },
            { label: isBm ? t('ctx_unbookmark') : t('ctx_bookmark'), action: () => window.toggleBookmark(post) },
            { divider: true },
            { label: t('ctx_profile'),  action: () => window.loadProfile(au.handle) },
        ];
        if (isMe2) {
            opts.push({ divider: true });
            opts.push({ label: `${t('ctx_pin')} / ${t('ctx_unpin')}`, action: () => window.togglePin(post) });
        } else {
            opts.push({ divider: true });
            opts.push({ label: av.following ? t('ctx_unfollow') : t('ctx_follow'), action: () => window.toggleFollow(au.did, av.following) });
            opts.push({ label: av.muted     ? t('ctx_unmute')   : t('ctx_mute'),   action: () => window.toggleMute(au.did, av.muted) });
            opts.push({ label: av.blocking  ? t('ctx_unblock')  : t('ctx_block'),  action: () => window.toggleBlock(au.did, av.blocking), color: '#d93025' });
        }
        window.showContextMenu(e.clientX, e.clientY, opts);
    }, true);
}

// ─── ビュー切り替え ───────────────────────────────────────────────
let _activeView = null;
const ALL_VIEWS = () => [els.timelineDiv, els.notifDiv, els.chatView, els.searchView, els.profileView, els.threadView, els.settingsView, els.bookmarksView];

function switchView(viewId, activeDiv) {
    if (!els.viewTitle) return;
    if (_activeView === activeDiv) return; 

    els.viewTitle.setAttribute('data-i18n', 'nav_' + viewId);
    els.viewTitle.textContent = t('nav_' + viewId);

    if (_activeView) _activeView.classList.add('hidden');
    ALL_VIEWS().forEach(d => { if (d && d !== activeDiv) d.classList.add('hidden'); });
    if (activeDiv) activeDiv.classList.remove('hidden');
    _activeView = activeDiv;

    document.querySelectorAll('.nav-links li').forEach(li => li.classList.remove('active'));
    document.getElementById(`nav-${viewId}`)?.classList.add('active');
    if (els.dropZone) {
        els.dropZone.style.display = ['chat', 'settings', 'bookmarks'].includes(viewId) ? 'none' : '';
    }
}

// ─── 翻訳 ─────────────────────────────────────────────────────────
function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); });
}

// ─── 投稿フォーム ─────────────────────────────────────────────────
function resetPostForm() {
    els.postInput.value = '';
    els.postInput.placeholder = t('post_placeholder');
    els.quotePreview.classList.add('hidden');
    els.quotePreview.innerHTML = '';
    selectedImages = []; replyTarget = null; quoteTarget = null;
    updateImagePreview();
}
window.resetPostForm = resetPostForm;

function updateImagePreview() {
    if (!els.imagePreviewContainer) return;
    const frag = document.createDocumentFragment();
    selectedImages.forEach((obj, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'img-preview-wrap';
        wrap.innerHTML =
            `<img src="${obj.url}" title="クリックで削除" style="cursor:pointer;" onclick="window.removeImg(${i});event.stopPropagation();">` +
            `<div class="img-controls">` +
            `<button onclick="window.moveImg(${i},-1);event.stopPropagation();" ${i===0?'disabled':''}>◀</button>` +
            `<input type="text" placeholder="ALT" value="${obj.alt}" oninput="window.updateAlt(${i},this.value)" onclick="event.stopPropagation();">` +
            `<button onclick="window.moveImg(${i},1);event.stopPropagation();" ${i===selectedImages.length-1?'disabled':''}>▶</button>` +
            `<button onclick="window.removeImg(${i});event.stopPropagation();" style="color:#ff6b6b;font-weight:bold;">✖</button>` +
            `</div>`;
        frag.appendChild(wrap);
    });
    els.imagePreviewContainer.textContent = '';
    els.imagePreviewContainer.appendChild(frag);
}

window.moveImg   = (i, d) => { const tmp = selectedImages[i]; selectedImages[i] = selectedImages[i+d]; selectedImages[i+d] = tmp; updateImagePreview(); };
window.updateAlt = (i, v) => { selectedImages[i].alt = v; };
window.removeImg = i => { selectedImages.splice(i, 1); updateImagePreview(); };

async function processIncomingImages(files) {
    if (!files?.length) return;
    for (const f of files) {
        if (selectedImages.length >= 4) break;
        const c = await compressImage(f);
        selectedImages.push({ id: Date.now() + Math.random(), file: f, url: URL.createObjectURL(f), blob: c.blob, width: c.width, height: c.height, alt: '' });
    }
    updateImagePreview();
}

// ─── 投稿送信 ─────────────────────────────────────────────────────
async function sendPost() {
    const text = els.postInput.value.trim();
    if (!text && !selectedImages.length && !quoteTarget) return;

    const rt = new RichText({ text });
    await rt.detectFacets(api.agent);
    if (rt.graphemeLength > 300) {
        alert(t('post_too_long', rt.graphemeLength - 300));
        return;
    }

    const btn = document.getElementById('post-btn');
    try {
        if (btn) btn.disabled = true;
        let imagesEmbed, finalEmbed;

        if (selectedImages.length) {
            const blobs = [];
            for (const obj of selectedImages) {
                const res = await api.uploadBlob(new Uint8Array(await obj.blob.arrayBuffer()));
                blobs.push({ image: res.data.blob, alt: obj.alt || '', aspectRatio: { width: obj.width, height: obj.height } });
            }
            imagesEmbed = { $type: 'app.bsky.embed.images', images: blobs };
        }

        if (quoteTarget) {
            const rec = { $type: 'app.bsky.embed.record', record: quoteTarget };
            finalEmbed = imagesEmbed
                ? { $type: 'app.bsky.embed.recordWithMedia', media: imagesEmbed, record: rec }
                : rec;
        } else {
            finalEmbed = imagesEmbed;
        }

        const postData = { text: rt.text, facets: rt.facets, embed: finalEmbed, createdAt: new Date().toISOString() };
        if (replyTarget) postData.reply = { root: replyTarget.root, parent: { uri: replyTarget.uri, cid: replyTarget.cid } };

        await api.post(postData);
        localStorage.removeItem('aerune_draft_text');
        resetPostForm();
        setTimeout(() => viewLoader.fetchTimeline(postLimit), 500);
    } catch (e) {
        console.error('sendPost:', e);
        alert(t('post_failed'));
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ─── ログイン/アカウント ──────────────────────────────────────────
async function login() {
    const id  = document.getElementById('id').value.trim();
    const pw  = document.getElementById('pw').value.trim();
    const btn = document.getElementById('login-btn');
    try {
        btn.disabled = true; btn.innerText = 'Connecting...';
        const res = await api.login(id, pw);
        if (res.success) {
            savedAccounts = savedAccounts.filter(a => a.did !== res.data.did);
            savedAccounts.push(res.data);
            await ipcRenderer.invoke('save-session', savedAccounts);
            await switchAccount(res.data.did);
        }
    } catch (e) {
        const msg = `${t('login_failed')}\n\n${t('error_details')}\n${e.message || e}\n\n${t('network_check')}`;
        if (confirm(msg)) shell.openExternal('https://bsky.app');
    } finally {
        btn.disabled = false;
        btn.innerText = t('login_btn');
    }
}

async function switchAccount(did) {
    const sess = savedAccounts.find(a => a.did === did);
    if (!sess) return;
    try {
        await api.resumeSession(sess);
        currentDid = did;
        els.loginForm.classList.add('hidden');
        if (els.app) els.app.style.opacity = '1';
        setupLoggedInUI();
    } catch { showLoginForm(); }
}

function showLoginForm() {
    els.loginForm.classList.remove('hidden');
    if (els.app) els.app.style.opacity = '0.3';
}

function renderAccountList() {
    const container = document.getElementById('account-list');
    if (!container) return;
    const frag = document.createDocumentFragment();
    for (const acc of savedAccounts) {
        const d = document.createElement('div');
        d.className = `account-item${acc.did === currentDid ? ' active' : ''}`;
        d.textContent = `@${acc.handle}`;
        d.onclick = () => { if (acc.did !== currentDid) switchAccount(acc.did); };
        frag.appendChild(d);
    }
    container.textContent = '';
    container.appendChild(frag);
}

async function setupLoggedInUI() {
    try {
        const res = await api.getProfile(api.session.did);
        const el = document.getElementById('profile-snippet');
        if (el) el.innerHTML =
            `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">` +
            `<img src="${res.data.avatar}" style="width:40px;height:40px;border-radius:50%;">` +
            `<strong>${res.data.displayName || res.data.handle}</strong></div>`;
    } catch {}
    renderAccountList();
    syncBookmarksData();
    nav.push({ type: 'home' }); updateBackBtn();
    switchView('home', els.timelineDiv);
    viewLoader.fetchTimeline(postLimit);
    setInterval(checkNotifs, 30000);
}

async function syncBookmarksData() {
    try {
        const r = await fetch(`${api.pdsUrl}/xrpc/app.bsky.bookmark.getBookmarks?limit=100`, {
            headers: { 'Authorization': `Bearer ${api.session.accessJwt}` }
        });
        if (!r.ok) return;
        const data = await r.json();
        window.aeruneBookmarks.clear();
        for (const b of (data.bookmarks || [])) {
            const uri = b.subject?.uri || b.record?.uri;
            if (uri) window.aeruneBookmarks.add(uri);
        }
    } catch {}
}

async function checkNotifs() {
    try {
        const r = await api.countUnreadNotifications();
        els.notifBadge?.classList.toggle('hidden', r.data.count === 0);
    } catch {}
}

// ─── ミュート/ブロックモーダル ────────────────────────────────────
window.showListModal = (title, fetcher, type) => {
    let modal = document.getElementById('list-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'list-modal';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;';
        modal.innerHTML =
            `<div style="background:white;width:400px;max-width:90%;max-height:80%;border-radius:12px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.2);">` +
            `<div style="padding:15px 20px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;font-weight:bold;font-size:1.1em;">` +
            `<span id="list-modal-title"></span><span style="cursor:pointer;color:gray;font-size:1.2em;" onclick="document.getElementById('list-modal').style.display='none'">✖</span></div>` +
            `<div id="list-modal-body" style="padding:15px;overflow-y:auto;flex:1;"></div></div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', e => { if (e.target.id === 'list-modal') modal.style.display = 'none'; });
    }
    document.getElementById('list-modal-title').textContent = title;
    const body = document.getElementById('list-modal-body');
    body.innerHTML = '<div style="text-align:center;color:gray;padding:20px;">Loading...</div>';
    modal.style.display = 'flex';

    fetcher().then(users => {
        if (!users?.length) {
            body.innerHTML = '<div style="text-align:center;color:gray;padding:20px;">該当するアカウントはありません。</div>';
            return;
        }
        const frag = document.createDocumentFragment();
        for (const user of users) {
            const d = document.createElement('div');
            d.style.cssText = 'display:flex;align-items:center;padding:10px 0;border-bottom:1px solid #f0f0f0;';
            d.innerHTML =
                `<img src="${user.avatar||''}" style="width:40px;height:40px;border-radius:50%;margin-right:12px;background:#eee;cursor:pointer;" onclick="window.loadProfile('${user.handle}');document.getElementById('list-modal').style.display='none';">` +
                `<div style="flex:1;overflow:hidden;"><div style="font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;" onclick="window.loadProfile('${user.handle}');document.getElementById('list-modal').style.display='none';">${user.displayName||user.handle}</div>` +
                `<div style="color:gray;font-size:.85em;">@${user.handle}</div></div>` +
                `<button class="action-btn" style="color:#d93025;border:1px solid #d93025;border-radius:15px;padding:4px 12px;font-weight:bold;opacity:1;" onclick="window.un${type}User('${user.did}',this)">解除</button>`;
            frag.appendChild(d);
        }
        body.textContent = '';
        body.appendChild(frag);
    }).catch(err => {
        body.innerHTML = `<div style="color:red;padding:20px;">Error: ${err.message}</div>`;
    });
};

window.showMutes  = () => actions.showMutes(t);
window.showBlocks = () => actions.showBlocks(t);

window.unMuteUser = async (did, btn) => {
    try {
        btn.disabled = true; btn.textContent = '処理中';
        await api.unmute(did);
        btn.textContent = '解除済'; btn.style.color = 'gray'; btn.style.borderColor = 'gray';
    } catch (e) { alert('Failed: ' + e.message); btn.disabled = false; btn.textContent = '解除'; }
};

window.unBlockUser = async (did, btn) => {
    try {
        btn.disabled = true; btn.textContent = '処理中';
        const p = await api.getProfile(did);
        if (p.data.viewer?.blocking) {
            const rkey = p.data.viewer.blocking.split('/').pop();
            await api.agent.com.atproto.repo.deleteRecord({ repo: api.session.did, collection: 'app.bsky.graph.block', rkey });
            btn.textContent = '解除済'; btn.style.color = 'gray'; btn.style.borderColor = 'gray';
        } else { alert('ブロック情報が見つかりません'); btn.disabled = false; btn.textContent = '解除'; }
    } catch (e) { alert('Failed: ' + e.message); btn.disabled = false; btn.textContent = '解除'; }
};

// ─── チャット ─────────────────────────────────────────────────────
async function fetchConvos() {
    try {
        const res = await api.getChatAgent().chat.bsky.convo.listConvos({ limit: 20 });
        const frag = document.createDocumentFragment();
        for (const convo of res.data.convos) {
            const other = convo.members.find(m => m.did !== api.session.did);
            if (!other) continue;
            const d = document.createElement('div');
            d.className = `convo-item${convo.id === currentConvoId ? ' active' : ''}`;
            d.innerHTML = `<img src="${other.avatar||''}" style="width:40px;border-radius:50%;"> <strong>${other.displayName||other.handle}</strong>`;
            d.onclick = () => loadConvo(convo.id);
            frag.appendChild(d);
        }
        els.convoList.textContent = '';
        els.convoList.appendChild(frag);
    } catch (e) { console.error('fetchConvos:', e); }
}

async function loadConvo(convoId) {
    currentConvoId = convoId;
    if (els.chatInputArea) els.chatInputArea.classList.remove('hidden');
    try {
        const chatAgent = api.getChatAgent();
        const [convoRes, msgRes] = await Promise.all([
            chatAgent.chat.bsky.convo.getConvo({ convoId }),
            chatAgent.chat.bsky.convo.getMessages({ convoId, limit: 50 })
        ]);
        const other = convoRes.data.convo.members.find(m => m.did !== api.session.did);
        if (other && els.chatHeader) {
            els.chatHeader.innerHTML = `<img src="${other.avatar||''}" style="width:30px;height:30px;border-radius:50%;vertical-align:middle;margin-right:10px;" loading="lazy"> <strong>${other.displayName||other.handle}</strong>`;
        }
        const frag = document.createDocumentFragment();
        for (const msg of msgRes.data.messages.reverse()) {
            const isMine = msg.sender.did === api.session.did;
            const b = document.createElement('div');
            b.style.cssText = `margin:5px;padding:8px;border-radius:10px;align-self:${isMine?'flex-end':'flex-start'};background:${isMine?'#0085ff':'#eee'};color:${isMine?'white':'black'};max-width:80%;word-break:break-word;`;
            let html = linkify(msg.text || '');
            if (isMine) html = html.replace(/color:var\(--bsky-blue\);/g, 'color:white;text-decoration:underline;');
            b.innerHTML = html;
            frag.appendChild(b);
        }
        els.chatMessages.textContent = '';
        els.chatMessages.appendChild(frag);
        els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
    } catch (e) { console.error('loadConvo:', e); }
}

const sendChatMessage = async () => {
    const input = document.getElementById('chat-msg-input');
    if (!input?.value.trim() || !currentConvoId) return;
    const text = input.value.trim();
    input.value = '';
    try {
        await api.getChatAgent().chat.bsky.convo.sendMessage({ convoId: currentConvoId, message: { text } });
        loadConvo(currentConvoId);
    } catch { alert('DMの送信に失敗しました。'); input.value = text; }
};

window.startDirectMessage = async (did) => {
    try {
        nav.push({ type: 'chat' }, _activeView); updateBackBtn();
        switchView('chat', els.chatView);
        const [profile, convoRes] = await Promise.all([
            api.getProfile(did),
            api.getChatAgent().chat.bsky.convo.getConvoForMembers({ members: [did] })
        ]);
        if (els.chatHeader) {
            els.chatHeader.innerHTML = `<img src="${profile.data.avatar||''}" style="width:30px;height:30px;border-radius:50%;vertical-align:middle;margin-right:10px;"> <strong>${profile.data.displayName||profile.data.handle}</strong>`;
        }
        await fetchConvos();
        loadConvo(convoRes.data.convo.id);
    } catch { alert('DMを開始できませんでした。'); }
};

window.downloadImage = downloadImage;

// ─── 初期化 ───────────────────────────────────────────────────────
async function initApp() {
    const get = id => document.getElementById(id);

    Object.assign(els, {
        app:                   get('app'),
        timelineDiv:           get('timeline'),
        notifDiv:              get('notifications'),
        notifBadge:            get('notif-badge'),
        chatView:              get('chat-view'),
        convoList:             get('convo-list'),
        chatHeader:            get('chat-header'),
        chatMessages:          get('chat-messages'),
        chatInputArea:         get('chat-input-area'),
        searchView:            get('search-view'),
        profileView:           get('profile-view'),
        threadView:            get('thread-view'),
        settingsView:          get('settings-view'),
        viewTitle:             get('view-title'),
        postInput:             get('post-input'),
        loginForm:             get('login-form'),
        dropZone:              get('drop-zone'),
        quotePreview:          get('quote-preview'),
        imagePreviewContainer: get('image-preview-container'),
        ctxMenu:               get('ctx-menu'),
        refreshBtn:            get('refresh-btn'),
        quoteModal:            get('quote-modal'),
        quoteModalBody:        get('quote-modal-body'),
    });

    els.bookmarksView = get('bookmarks-view') || (() => {
        const v = document.createElement('div');
        v.id = 'bookmarks-view'; v.className = 'content hidden';
        els.timelineDiv.parentNode.appendChild(v);
        return v;
    })();

    initModules();
    installDelegates();

    if (els.refreshBtn) {
        els.refreshBtn.innerHTML = getIcon('refresh');
        els.refreshBtn.addEventListener('click', () => {
            if (!els.timelineDiv.classList.contains('hidden'))     viewLoader.fetchTimeline(postLimit);
            else if (!els.notifDiv.classList.contains('hidden'))   viewLoader.fetchNotifications(postLimit);
            else if (!els.chatView.classList.contains('hidden'))   fetchConvos();
            else if (els.bookmarksView && !els.bookmarksView.classList.contains('hidden'))
                                                                    viewLoader.fetchBookmarks(postLimit);
        });
    }

    document.querySelectorAll('img[src*="image.svg"]').forEach(img => {
        const span = document.createElement('span');
        span.className = img.className || 'icon-btn';
        span.innerHTML = getIcon('image');
        span.style.cursor = 'pointer';
        img.replaceWith(span);
        span.addEventListener('click', () => get('image-input')?.click());
    });

    if (els.viewTitle && !get('back-btn')) {
        const b = document.createElement('button');
        b.id = 'back-btn'; b.className = 'icon-btn'; b.textContent = '◀';
        b.style.cssText = 'display:none;margin-right:10px;';
        b.onclick = goBack;
        els.viewTitle.parentNode.insertBefore(b, els.viewTitle);
    }

    if (!get('nav-bookmarks')) {
        const li = document.createElement('li');
        li.id = 'nav-bookmarks'; li.setAttribute('data-i18n', 'nav_bookmarks');
        li.textContent = t('nav_bookmarks');
        li.onclick = () => { nav.push({ type: 'bookmarks' }, _activeView); updateBackBtn(); switchView('bookmarks', els.bookmarksView); viewLoader.fetchBookmarks(postLimit); };
        li.style.display = showBookmarksConfig ? 'block' : 'none';
        get('nav-profile')?.parentNode.insertBefore(li, get('nav-profile').nextSibling);
    }

    if (els.settingsView && !get('setting-bookmark-tab')) {
        const h3 = els.settingsView.querySelector('h3');
        if (h3) {
            const bm = document.createElement('div');
            bm.style.marginBottom = '20px';
            bm.innerHTML = `<label style="display:flex;align-items:center;font-weight:bold;cursor:pointer;"><input type="checkbox" id="setting-bookmark-tab" style="margin-right:8px;width:18px;height:18px;" ${showBookmarksConfig?'checked':''}><span data-i18n="settings_bookmark_tab">${t('settings_bookmark_tab')}</span></label>`;
            const sib = h3.nextElementSibling;
            (sib?.nextElementSibling ? h3.parentNode.insertBefore(bm, sib.nextElementSibling) : h3.parentNode.appendChild(bm));
        }
    }

    if (els.settingsView && !get('setting-time-format-wrap')) {
        const wrap = document.createElement('div');
        wrap.id = 'setting-time-format-wrap';
        wrap.style.cssText = 'margin-bottom:20px;';
        wrap.innerHTML =
            `<div style="font-weight:bold;margin-bottom:8px;" data-i18n="settings_time_format">${t('settings_time_format')}</div>` +
            `<div style="display:flex;gap:16px;">` +
            `<label style="cursor:pointer;display:flex;align-items:center;gap:6px;">` +
            `<input type="radio" name="aerune_time_format" value="relative" ${(window.aeruneTimeFormat||'relative')==='relative'?'checked':''}>` +
            `<span data-i18n="settings_time_relative">${t('settings_time_relative')}</span>` +
            `</label>` +
            `<label style="cursor:pointer;display:flex;align-items:center;gap:6px;">` +
            `<input type="radio" name="aerune_time_format" value="absolute" ${window.aeruneTimeFormat==='absolute'?'checked':''}>` +
            `<span data-i18n="settings_time_absolute">${t('settings_time_absolute')}</span>` +
            `</label>` +
            `</div>`;
        const bmWrap = get('setting-bookmark-tab')?.closest('div');
        if (bmWrap) {
            if (bmWrap.nextElementSibling) {
                bmWrap.parentNode.insertBefore(wrap, bmWrap.nextElementSibling);
            } else {
                bmWrap.parentNode.appendChild(wrap);
            }
        } else {
            els.settingsView.appendChild(wrap);
        }
    }

    const sl = get('setting-lang'),  sli = get('setting-limit'),  sn = get('setting-nsfw');
    if (sl)  sl.value   = currentLang;
    if (sli) sli.value  = postLimit;
    if (sn)  sn.checked = nsfwBlur;

    applyTranslations();

    document.querySelectorAll('[data-i18n="settings_mutes"]').forEach(el => {
        el.style.cursor = 'pointer'; el.style.color = 'var(--bsky-blue)';
        el.onclick = () => window.showMutes();
    });
    document.querySelectorAll('[data-i18n="settings_blocks"]').forEach(el => {
        el.style.cursor = 'pointer'; el.style.color = 'var(--bsky-blue)';
        el.onclick = () => window.showBlocks();
    });

    if (els.postInput) {
        els.postInput.style.minHeight = '80px';
        els.postInput.value = localStorage.getItem('aerune_draft_text') || '';
        els.postInput.addEventListener('input', () => localStorage.setItem('aerune_draft_text', els.postInput.value));
    }

    if (els.dropZone) {
        els.dropZone.addEventListener('dragover',  e => { e.preventDefault(); e.stopPropagation(); els.dropZone.classList.add('drag-over'); });
        els.dropZone.addEventListener('dragleave', e => { e.preventDefault(); e.stopPropagation(); els.dropZone.classList.remove('drag-over'); });
        els.dropZone.addEventListener('drop', async e => {
            e.preventDefault(); e.stopPropagation(); els.dropZone.classList.remove('drag-over');
            await processIncomingImages(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')));
        });
    }

    document.addEventListener('click', e => { if (!e.button && els.ctxMenu) els.ctxMenu.classList.add('hidden'); });

    // ─── イベントリスナー ──────────────────────────────────────────
    get('login-btn')?.addEventListener('click', login);
    get('login-cancel-btn')?.addEventListener('click', () => { els.loginForm.classList.add('hidden'); if (els.app) els.app.style.opacity = '1'; });
    get('post-btn')?.addEventListener('click', sendPost);

    get('nav-home')?.addEventListener('click',          () => { nav.push({type:'home'}, _activeView); updateBackBtn(); switchView('home', els.timelineDiv); viewLoader.fetchTimeline(postLimit); });
    get('nav-notifications')?.addEventListener('click', () => { nav.push({type:'notifications'}, _activeView); updateBackBtn(); switchView('notifications', els.notifDiv); viewLoader.fetchNotifications(postLimit); });
    get('nav-chat')?.addEventListener('click',          () => { nav.push({type:'chat'}, _activeView); updateBackBtn(); switchView('chat', els.chatView); fetchConvos(); });
    get('nav-search')?.addEventListener('click',        () => { nav.push({type:'search'}, _activeView); updateBackBtn(); switchView('search', els.searchView); });
    get('nav-profile')?.addEventListener('click',       () => window.loadProfile(api.session.did));
    get('nav-settings')?.addEventListener('click',      () => { nav.push({type:'settings'}, _activeView); updateBackBtn(); switchView('settings', els.settingsView); });

    get('search-exec-btn')?.addEventListener('click', () => window.execSearch());
    get('search-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') window.execSearch(); });
    get('add-account-btn')?.addEventListener('click', () => { els.loginForm.classList.remove('hidden'); if (els.app) els.app.style.opacity = '0.3'; });

    get('logout-btn')?.addEventListener('click', () => {
        actions.logout(currentDid, savedAccounts,
            () => { currentDid = null; const al = get('account-list'); if (al) al.textContent = ''; showLoginForm(); },
            (did, accounts) => { savedAccounts = accounts; switchAccount(did); }
        );
    });

    get('settings-save-btn')?.addEventListener('click', () => {
        const nl  = get('setting-lang')?.value || currentLang;
        const nli = Math.min(100, Math.max(10, parseInt(get('setting-limit')?.value) || 30));
        const nb  = get('setting-nsfw')?.checked ?? nsfwBlur;
        const nbm = get('setting-bookmark-tab')?.checked ?? showBookmarksConfig;
        const ntf = document.querySelector('input[name="aerune_time_format"]:checked')?.value || window.aeruneTimeFormat || 'relative';

        localStorage.setItem('aerune_lang',           nl);
        localStorage.setItem('aerune_post_limit',     nli.toString());
        localStorage.setItem('aerune_nsfw_blur',      nb.toString());
        localStorage.setItem('aerune_show_bookmarks', nbm.toString());
        localStorage.setItem('aerune_time_format',    ntf);

        currentLang = nl; nsfwBlur = nb; showBookmarksConfig = nbm; postLimit = nli;
        window.aeruneTimeFormat = ntf;
        const sli2 = get('setting-limit'); if (sli2) sli2.value = nli;
        get('nav-bookmarks')?.style.setProperty('display', nbm ? 'block' : 'none');
        applyTranslations();

        const msg = get('settings-msg');
        if (msg) { msg.textContent = t('settings_saved'); setTimeout(() => { msg.textContent = ''; }, 3000); }
    });

    get('modal-close')?.addEventListener('click', () => get('image-modal')?.classList.add('hidden'));
    get('image-modal')?.addEventListener('click', e => { if (e.target.id === 'image-modal') e.target.classList.add('hidden'); });
    get('quote-modal-close')?.addEventListener('click', () => els.quoteModal?.classList.add('hidden'));
    get('image-input')?.addEventListener('change', async e => { await processIncomingImages(Array.from(e.target.files)); e.target.value = ''; });

    get('chat-send-btn')?.addEventListener('click', sendChatMessage);
    get('chat-msg-input')?.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); sendChatMessage(); } });

    window.addEventListener('keydown', e => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && document.activeElement === els.postInput) {
            e.preventDefault(); sendPost();
        }
        if (e.key === 'Escape') {
            resetPostForm();
            els.quoteModal?.classList.add('hidden');
            get('image-modal')?.classList.add('hidden');
        }
    });

    window.addEventListener('paste', async e => {
        if (e.clipboardData?.files.length) {
            const imgs = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'));
            if (imgs.length) { e.preventDefault(); await processIncomingImages(imgs); }
        }
    });

    // セッション復元
    try {
        const data = await ipcRenderer.invoke('load-session');
        if (data && (Array.isArray(data) ? data.length : data.did)) {
            savedAccounts = Array.isArray(data) ? data : [data];
            await switchAccount(savedAccounts[0].did);
        } else { showLoginForm(); }
    } catch { showLoginForm(); }
}

initApp();