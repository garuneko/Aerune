// post-renderer.js (optimized: single-pass innerHTML, precomputed icon strings)
const { escAttr, renderRichText } = require('./utils.js');

// Stores for event delegation
const postStore = new Map();
const quoteStore = new Map();
let quoteSeq = 0;

function clearStores() { postStore.clear(); quoteStore.clear(); quoteSeq = 0; }
function getPost(uri) { return postStore.get(uri); }
function getQuote(qid) { return quoteStore.get(qid); }

const NSFW_LABELS = new Set(['porn', 'sexual', 'nudity']);
const IMG_STYLE = 'object-fit:cover;max-height:400px;width:100%;border-radius:8px;';

function isNsfwPost(post) {
    return post.labels?.some(l => NSFW_LABELS.has(l.val))
        || post.author.labels?.some(l => NSFW_LABELS.has(l.val));
}

function renderImg(img, imgClass) {
    return `<img src="${escAttr(img.thumb)}" data-fullsize="${escAttr(img.fullsize)}" data-act="open-image" data-url="${escAttr(img.fullsize)}" class="${imgClass}" style="${IMG_STYLE}" loading="lazy" decoding="async">`;
}

function renderEmbedImages(images, imgClass) {
    return `<div class="post-images">${images.map(img => renderImg(img, imgClass)).join('')}</div>`;
}

function renderQuoteBlock(rec, imgClass) {
    const qid = String(++quoteSeq);
    quoteStore.set(qid, rec);
    let media = '';
    if (rec.embeds?.[0]?.$type === 'app.bsky.embed.images#view') {
        media = `<div class="post-images" style="margin-top:8px;">${rec.embeds[0].images.map(img => renderImg(img, imgClass)).join('')}</div>`;
    }
    return `<div class="embedded-quote" data-act="open-quote" data-qid="${qid}">
<strong>${escAttr(rec.author.displayName || rec.author.handle)}</strong> <span style="color:gray;">@${escAttr(rec.author.handle)}</span>
<div style="font-size:.9em;margin-top:4px;">${renderRichText(rec.value || rec.record)}</div>${media}</div>`;
}

function buildEmbed(embed, imgClass) {
    if (!embed) return '';
    const t = embed.$type;

    if (t === 'app.bsky.embed.images#view') {
        return renderEmbedImages(embed.images, imgClass);
    }
    if (t === 'app.bsky.embed.record#view') {
        const rec = embed.record;
        return rec?.author ? renderQuoteBlock(rec, imgClass) : '';
    }
    if (t === 'app.bsky.embed.recordWithMedia#view') {
        let html = embed.media?.images ? renderEmbedImages(embed.media.images, imgClass) : '';
        const rec = embed.record?.record;
        if (rec?.author) html += renderQuoteBlock(rec, imgClass);
        return html;
    }
    if (t === 'app.bsky.embed.external#view' && embed.external) {
        const ext = embed.external;
        const url = escAttr(ext.uri || '');
        const thumb = ext.thumb
            ? `<img src="${escAttr(ext.thumb)}" style="width:100%;max-height:200px;object-fit:cover;border-radius:6px;margin-bottom:6px;" loading="lazy" decoding="async">`
            : '';
        return `<div class="embedded-quote" style="cursor:pointer;" data-ext="${url}">${thumb}<div style="font-weight:bold;font-size:.9em;">${escAttr(ext.title||'')}</div><div style="color:gray;font-size:.8em;">${escAttr(ext.description||'')}</div><div style="color:var(--bsky-blue);font-size:.8em;margin-top:4px;">${escAttr(ext.uri||'')}</div></div>`;
    }
    return '';
}

function createPostElement(post, ctx, isThreadRoot = false, isQuoteModal = false, reason = null) {
    if (!post?.author) return document.createElement('div');

    const { api, t, getIcon, nsfwBlur, aeruneBookmarks } = ctx;
    if (post.uri) postStore.set(post.uri, post);

    const au = post.author;
    const pv = post.viewer || {};
    const root = post.record?.reply?.root || { uri: post.uri, cid: post.cid };

    const isMe = api.session && au.did === api.session.did;
    const imgClass = (isNsfwPost(post) && nsfwBlur) ? 'post-img-thumb nsfw-blur' : 'post-img-thumb';

    const embedHtml = buildEmbed(post.embed, imgClass);

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

    const div = document.createElement('div');
    div.className = 'post';
    div.dataset.uri    = post.uri  || '';
    div.dataset.cid    = post.cid  || '';
    div.dataset.rootUri = root.uri || '';
    div.dataset.rootCid = root.cid || '';
    div.dataset.handle = au.handle || '';
    div.dataset.did    = au.did    || '';
    div.dataset.noThread = isQuoteModal ? '1' : '0';
    if (isThreadRoot) div.style.borderLeft = '4px solid var(--bsky-blue)';

    // 一括innerHTML（reflow 1回）
    div.innerHTML =
        `<img src="${escAttr(au.avatar||'')}" class="post-avatar" loading="lazy" decoding="async" data-act="profile" data-actor="${escAttr(au.handle)}">` +
        `<div class="post-content">` +
            repostHtml +
            `<div class="post-header"><strong>${escAttr(au.displayName||au.handle)}</strong> <span style="color:gray;">@${escAttr(au.handle)}</span></div>` +
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

function renderPosts(posts, container, ctx) {
    if (!container) return;
    clearStores();

    const fragment = document.createDocumentFragment();
    let prevUri = null;
    let prevEl = null;

    for (const item of posts) {
        const post = item.post || item;
        const el = createPostElement(post, ctx, false, false, item.reason || null);
        if (item.reply?.parent?.uri === prevUri && prevEl) {
            prevEl.classList.add('thread-line');
        }
        prevUri = post.uri;
        prevEl = el;
        fragment.appendChild(el);
    }

    // rAFでDOM更新を1フレームにまとめる
    requestAnimationFrame(() => {
        container.textContent = ''; // innerHTML=''より高速
        container.appendChild(fragment);
    });
}

module.exports = { createPostElement, renderPosts, getPost, getQuote, clearStores };
