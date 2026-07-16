// post-renderer.js (v2.0.2: timestamp display, render optimization)
const { escAttr, escHTML, renderRichText } = require('./utils.js');
const { threadConnectionFlags } = require('./display-utils.js');

// Stores for event delegation
const postStore = new Map();
const quoteStore = new Map();
const imageStore = new Map();
let quoteSeq = 0;
let imageSeq = 0;
const MAX_STORE_SIZE = 1000;

function setStoreWithLimit(store, key, value) {
    if (store.size >= MAX_STORE_SIZE) {
        // Mapは挿入順を保持するため、最初のキーが一番古いデータになる
        store.delete(store.keys().next().value);
    }
    store.set(key, value);
}

function clearStores() { postStore.clear(); quoteStore.clear(); imageStore.clear(); quoteSeq = 0; imageSeq = 0; }
function getPost(uri) { return postStore.get(uri); }
function getQuote(qid) { return quoteStore.get(qid); }
function getImageSet(gid) { return imageStore.get(gid) || []; }

const NSFW_LABELS = new Set(['porn', 'sexual', 'nudity']);
const IMG_STYLE = 'object-fit:cover;max-height:400px;border-radius:8px;';
const MAX_EMBED_DEPTH = 2;

function isNsfwPost(post) {
    return post.labels?.some(l => NSFW_LABELS.has(l.val))
        || post.author.labels?.some(l => NSFW_LABELS.has(l.val));
}

const _relCache = new Map();

function localeForLang(lang = 'ja') {
    if (lang === 'pt-BR') return 'pt-BR';
    if (lang === 'ar') return 'ar';
    if (lang === 'en') return 'en';
    return 'ja';
}

function formatRelative(date, lang = 'ja') {
    const now = Date.now();
    const diff = Math.floor((now - date.getTime()) / 1000); // 秒
    const rtf = new Intl.RelativeTimeFormat(localeForLang(lang), { numeric: 'auto' });

    if (diff < 60) return rtf.format(-Math.max(1, diff), 'second');
    if (diff < 3600) return rtf.format(-Math.floor(diff / 60), 'minute');
    if (diff < 86400) return rtf.format(-Math.floor(diff / 3600), 'hour');
    if (diff < 86400 * 7) return rtf.format(-Math.floor(diff / 86400), 'day');

    // 1週間以上なら絶対表示にフォールバック
    return formatAbsolute(date);
}

function formatAbsolute(date) {
    // "2025/01/23 14:05" 形式
    const y = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    return `${y}/${mo}/${d} ${h}:${mi}`;
}

function formatTimestamp(isoString, timeFormat, lang = 'ja') {
    if (!isoString) return '';
    // キャッシュキー: isoString + format（ただし relative は分単位でバケット化）
    const now = Date.now();
    const cacheKey = timeFormat === 'relative'
        ? `${lang}|${isoString}|${Math.floor(now / 60000)}` // 1分単位で更新
        : `${lang}|${isoString}`;
    const cached = _relCache.get(cacheKey);
    if (cached) return cached;

    let result = '';
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return '';
        result = timeFormat === 'absolute' ? formatAbsolute(date) : formatRelative(date, lang);
    } catch { return ''; }

    // LRU-lite: 1000件超えたら古いものから削除
    if (_relCache.size >= 1000) _relCache.delete(_relCache.keys().next().value);
    _relCache.set(cacheKey, result);
    return result;
}

// ─── 画像レンダリング ────────────────────────────────────────────
function imageUrls(img) {
    return {
        thumb: img.thumb || img.fullsize || '',
        fullsize: img.fullsize || img.thumb || ''
    };
}

function renderImg(img, imgClass, gid, idx) {
    const altText = escAttr(img.alt || '');
    const urls = imageUrls(img);
    return `<img src="${escAttr(urls.thumb)}" alt="${altText}" title="${altText}" data-fullsize="${escAttr(urls.fullsize)}" data-act="open-image" data-gid="${escAttr(gid)}" data-idx="${idx}" data-url="${escAttr(urls.fullsize)}" class="${imgClass}" style="${IMG_STYLE}" loading="lazy" decoding="async">`;
}

function renderEmbedImages(images, imgClass, imageDisplayStyle = 'carousel') {
    const list = (images || []).filter(Boolean).slice(0, 10);
    if (!list.length) return '';
    const gid = String(++imageSeq);
    setStoreWithLimit(imageStore, gid, list.map(img => imageUrls(img).fullsize).filter(Boolean));
    const countClass = `post-images-count-${Math.min(list.length, 4)}`;
    const styleClass = list.length > 1 && imageDisplayStyle === 'carousel' ? 'post-images-carousel' : 'post-images-grid';
    return `<div class="post-images ${countClass} ${styleClass}" data-gid="${gid}">${list.map((img, idx) => renderImg(img, imgClass, gid, idx)).join('')}</div>`;
}

function renderEmbedVideo(video, isNsfw) {
    const src = escAttr(video.playlist || video.cid || '');
    const poster = escAttr(video.thumbnail || '');
    const alt = escAttr(video.alt || '');
    if (!src && !poster) return '';
    const ar = video.aspectRatio;
    const aspect = ar?.width && ar?.height ? ` style="aspect-ratio:${Number(ar.width)}/${Number(ar.height)};"` : '';
    const openUrl = src || poster;
    return `<div class="post-video${isNsfw ? ' media-hidden' : ''}"${aspect}>` +
        (src
            ? `<video src="${src}" ${poster ? `poster="${poster}"` : ''} controls preload="metadata" playsinline title="${alt}"></video>`
            : `<img src="${poster}" alt="${alt}" loading="lazy" decoding="async">`) +
        (isNsfw ? `<button type="button" class="media-reveal" data-act="reveal-media">NSFW</button>` : '') +
        `<button type="button" class="video-open-btn" data-ext="${openUrl}">Open</button>` +
        `</div>`;
}

function renderExternal(ext, isNsfw) {
    const url = escAttr(ext.uri || '');
    if (!url) return '';
    const thumb = ext.thumb
        ? `<img src="${escAttr(ext.thumb)}" class="external-thumb" alt="" loading="lazy" decoding="async">`
        : '';
    return `<div class="external-card${isNsfw && ext.thumb ? ' media-hidden' : ''}" data-ext="${url}">` +
        thumb +
        (isNsfw && ext.thumb ? `<button type="button" class="media-reveal" data-act="reveal-media">NSFW</button>` : '') +
        `<div class="external-title">${escHTML(ext.title || '')}</div>` +
        `<div class="external-desc">${escHTML(ext.description || '')}</div>` +
        `<div class="external-url">${escHTML(ext.uri || '')}</div>` +
        `</div>`;
}

function renderQuoteBlock(rec, imgClass, isNsfw, depth = 0, imageDisplayStyle = 'carousel') {
    if (depth > MAX_EMBED_DEPTH) return '';
    const qid = String(++quoteSeq);
    setStoreWithLimit(quoteStore, qid, rec);
    const record = rec.value || rec.record || {};
    const author = rec.author || {};
    const embeds = Array.isArray(rec.embeds) ? rec.embeds : [];
    const media = embeds.map(embed => buildEmbed(embed, imgClass, isNsfw, depth + 1, imageDisplayStyle)).join('');
    const displayName = author.displayName || author.handle || '';
    const handle = author.handle || '';
    return `<div class="embedded-quote" data-act="open-quote" data-qid="${qid}">
<div class="embedded-quote-header"><strong>${escHTML(displayName)}</strong> <span>@${escHTML(handle)}</span></div>
<div class="embedded-quote-text">${renderRichText(record)}</div>${media}</div>`;
}

function renderFeedGenerator(generator) {
    if (!generator) return '';
    return `<div class="external-card">` +
        `<div class="external-title">${escHTML(generator.displayName || generator.name || '')}</div>` +
        `<div class="external-desc">${escHTML(generator.description || '')}</div>` +
        `<div class="external-url">${escHTML(generator.creator?.handle ? `@${generator.creator.handle}` : generator.uri || '')}</div>` +
        `</div>`;
}

function buildEmbed(embed, imgClass, isNsfw = false, depth = 0, imageDisplayStyle = 'carousel') {
    if (!embed) return '';
    const t = embed.$type;

    if (t === 'app.bsky.embed.images#view' || t === 'app.bsky.embed.gallery#view') {
        return renderEmbedImages(embed.images || embed.displayImages, imgClass, imageDisplayStyle);
    }
    if (t === 'app.bsky.embed.video#view') {
        return renderEmbedVideo(embed.video || embed, isNsfw);
    }
    if (t === 'app.bsky.embed.record#view') {
        const rec = embed.record;
        if (rec?.feedGenerator) return renderFeedGenerator(rec.feedGenerator);
        return rec?.author ? renderQuoteBlock(rec, imgClass, isNsfw, depth, imageDisplayStyle) : '';
    }
    if (t === 'app.bsky.embed.recordWithMedia#view') {
        let html = '';
        if (embed.media?.$type === 'app.bsky.embed.video#view') {
            html = renderEmbedVideo(embed.media.video || embed.media, isNsfw);
        } else if (embed.media?.images || embed.media?.displayImages) {
            html = renderEmbedImages(embed.media.images || embed.media.displayImages, imgClass, imageDisplayStyle);
        }
        const rec = embed.record?.record;
        if (rec?.feedGenerator) html += renderFeedGenerator(rec.feedGenerator);
        else if (rec?.author) html += renderQuoteBlock(rec, imgClass, isNsfw, depth, imageDisplayStyle);
        return html;
    }
    if (t === 'app.bsky.embed.external#view' && embed.external) {
        return renderExternal(embed.external, isNsfw);
    }
    return '';
}

// ─── メインのポスト要素生成 ──────────────────────────────────────
function createPostElement(post, ctx, isThreadRoot = false, isQuoteModal = false, reason = null) {
    if (!post?.author) return document.createElement('div');

    const { api, t, getIcon, nsfwBlur, aeruneBookmarks, timeFormat = 'relative', imageDisplayStyle = 'carousel', lang = 'ja' } = ctx;
    if (post.uri) setStoreWithLimit(postStore, post.uri, post);

    const au = post.author;
    const pv = post.viewer || {};
    const root = post.record?.reply?.root || { uri: post.uri, cid: post.cid };

    const isMe = api.session && au.did === api.session.did;
    const imgClass = (isNsfwPost(post) && nsfwBlur) ? 'post-img-thumb nsfw-blur' : 'post-img-thumb';

    const postIsNsfw = isNsfwPost(post) && nsfwBlur;
    const embedHtml = buildEmbed(post.embed, imgClass, postIsNsfw, 0, imageDisplayStyle);

    const repostHtml = (reason?.$type === 'app.bsky.feed.defs#reasonRepost')
        ? `<div style="font-size:.85em;color:gray;margin-bottom:4px;font-weight:bold;">${t('reposted_by', reason.by.displayName || reason.by.handle)}</div>`
        : '';

    const isBookmarked = aeruneBookmarks.has(post.uri) || !!pv.bookmark;

    // ブックマーク表示ロジック
    let bmHtml;
    if (isMe && post.bookmarkCount > 0) {
        bmHtml = `<button class="action-btn bookmarked" style="cursor:default;" data-act="noop">${getIcon('bookmark')} ${post.bookmarkCount}</button>`;
    } else if (isBookmarked && !isMe) {
        bmHtml = `<button class="action-btn bookmarked" style="cursor:default;" data-act="noop">${getIcon('bookmark')}</button>`;
    } else {
        bmHtml = `<button class="action-btn${isBookmarked ? ' bookmarked' : ''}" data-act="bookmark">${getIcon('bookmark')}</button>`;
    }

    const deleteHtml = isMe
        ? `<button class="action-btn" data-act="delete" style="margin-left:auto;">${getIcon('trash')}</button>`
        : '';

    // ─── 投稿日時 ────────────────────────────────────────────────
    // createdAt（投稿レコード）優先、なければ indexedAt（サーバインデックス時刻）
    const rawTs = post.record?.createdAt || post.indexedAt || '';
    const tsText = formatTimestamp(rawTs, timeFormat, lang);
    // ISO文字列をそのままtitle属性に入れ、ホバーで絶対時刻を見られるようにする
    const absTitle = rawTs ? escAttr(formatAbsolute(new Date(rawTs))) : '';
    const tsHtml = tsText
        ? `<span class="post-timestamp" data-ts="${rawTs}" title="${absTitle}" style="color:gray;font-size:.78em;margin-left:auto;white-space:nowrap;flex-shrink:0;padding-left:6px;">${escAttr(tsText)}</span>`
        : '';
    const div = document.createElement('div');
    div.className = 'post';
    div.dataset.uri      = post.uri  || '';
    div.dataset.cid      = post.cid  || '';
    div.dataset.rootUri  = root.uri  || '';
    div.dataset.rootCid  = root.cid  || '';
    div.dataset.handle   = au.handle || '';
    div.dataset.did      = au.did    || '';
    div.dataset.noThread = isQuoteModal ? '1' : '0';
    if (isThreadRoot) div.style.borderLeft = '4px solid var(--bsky-blue)';

    // post-header に日時を右寄せで差し込む（flexboxで左にユーザー名、右に時刻）
    div.innerHTML =
        `<img src="${escAttr(au.avatar||'')}" class="post-avatar" loading="lazy" decoding="async" data-act="profile" data-actor="${escAttr(au.handle)}">` +
        `<div class="post-content">` +
            repostHtml +
            `<div class="post-header" style="display:flex;align-items:baseline;gap:4px;flex-wrap:wrap;">` +
                `<strong>${escAttr(au.displayName||au.handle)}</strong>` +
                `<span style="color:gray;">@${escAttr(au.handle)}</span>` +
                tsHtml +
            `</div>` +
            `<div class="post-text">${renderRichText(post.record || post.value)}</div>` +
            embedHtml +
            `<div class="post-actions">` +
                `<button class="action-btn" data-act="reply">${getIcon('reply')} ${post.replyCount||0}</button>` +
                `<button class="action-btn${pv.repost ? ' reposted' : ''}" data-act="repost">${getIcon('repost')} ${post.repostCount||0}</button>` +
                `<button class="action-btn" data-act="quote">${getIcon('quote')}</button>` +
                `<button class="action-btn${pv.like ? ' liked' : ''}" data-act="like">${getIcon('like')} ${post.likeCount||0}</button>` +
                bmHtml +
                deleteHtml +
            `</div>` +
        `</div>`;

    return div;
}

// ─── 複数ポストの一括レンダリング ───────────────────────────────
function renderPosts(posts, container, ctx, isAppend = false) {
    if (!container) return;
    if (!isAppend) clearStores(); // 追記モードでなければクリア

    const fragment = document.createDocumentFragment();
    const connectionFlags = threadConnectionFlags(posts);
    for (const [index, item] of posts.entries()) {
        const post = item.post || item;
        const el = createPostElement(post, ctx, false, false, item.reason || null);
        if (connectionFlags[index].connectsToNext) el.classList.add('thread-line');
        fragment.appendChild(el);
    }

    // rAFでDOM更新を1フレームにまとめる（reflow最小化）
    requestAnimationFrame(() => {
        if (!isAppend) container.textContent = ''; // 追記モード時は初期化しない
        container.appendChild(fragment);
    });
}

// 💡 formatRelative などを外部に公開する！
module.exports = { createPostElement, renderPosts, getPost, getQuote, getImageSet, clearStores, formatRelative, formatAbsolute };
