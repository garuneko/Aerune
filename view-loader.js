// view-loader.js (optimized)
const { hasSelection, downloadImage, linkify, renderRichText, escAttr } = require('./utils.js');
const { createPostElement, renderPosts } = require('./post-renderer.js');

class ViewLoader {
    constructor(api, getCtx, els) {
        this.api = api;
        this.getCtx = getCtx;
        this.els = els;
        this.cursors = { home: null, profile: null, search: null };
        this.isLoading = false; 
    }

    async fetchTimeline(isAppend = false) {
        if (this.isLoading) return;
        this.isLoading = true;
        if (!isAppend) this.cursors.home = null;

        try {
            const res = await this.api.getTimeline(30, this.cursors.home);
            this.cursors.home = res.data.cursor;

            const postMap = new Map();
            for (const item of res.data.feed) {
                if (!postMap.has(item.post.uri)) postMap.set(item.post.uri, item);
                if (item.reply && !item.reason) {
                    if (item.reply.parent && !postMap.has(item.reply.parent.uri)) postMap.set(item.reply.parent.uri, { post: item.reply.parent, reason: null });
                    if (item.reply.root && !postMap.has(item.reply.root.uri)) postMap.set(item.reply.root.uri, { post: item.reply.root, reason: null });
                }
            }

            const newFeed = [];
            const seenUris = new Set();
            const myDid = this.api.session?.did;

            for (const item of res.data.feed) {
                if (seenUris.has(item.post.uri)) continue;

                let shouldSkip = false;
                if (item.reply && !item.reason) {
                    const isMyPost = item.post.author.did === myDid;
                    const pAuthor = item.reply.parent?.author;
                    const rAuthor = item.reply.root?.author;
                    const isParentMe = pAuthor && pAuthor.did === myDid;

                    if (!isMyPost && !isParentMe) {
                        const isParentValid = pAuthor && (pAuthor.did === myDid || !!pAuthor.viewer?.following);
                        const isRootValid = rAuthor && (rAuthor.did === myDid || !!rAuthor.viewer?.following);
                        if (!isParentValid || !isRootValid) shouldSkip = true;
                    }
                }

                if (shouldSkip) { seenUris.add(item.post.uri); continue; }

                const threadChain = [];
                let currentItem = item;

                while (currentItem.reply && !currentItem.reason) {
                    const parentUri = currentItem.reply.parent?.uri;
                    if (!parentUri) break;
                    const parentItem = postMap.get(parentUri);
                    if (!parentItem) break;
                    if (seenUris.has(parentUri)) break;
                    threadChain.unshift(parentItem); 
                    currentItem = parentItem;
                }

                for (const p of threadChain) {
                    if (!seenUris.has(p.post.uri)) { newFeed.push(p); seenUris.add(p.post.uri); }
                }

                if (!seenUris.has(item.post.uri)) { newFeed.push(item); seenUris.add(item.post.uri); }
            }

            renderPosts(newFeed, this.els.timelineDiv, this.getCtx(), isAppend);
        } catch (e) { console.error('fetchTimeline:', e); }
        finally { this.isLoading = false; }
    }       
     
    async fetchNotifications(limit) {
        try {
            const [notifRes] = await Promise.all([this.api.listNotifications(limit)]);
            const notifs = notifRes.data.notifications;
            const ctx = this.getCtx();

            const uris = notifs.filter(n => (n.reason === 'like' || n.reason === 'repost') && n.reasonSubject).map(n => n.reasonSubject);
            const postMap = {};
            if (uris.length) {
                const chunks = [];
                for (let i = 0; i < uris.length; i += 25) chunks.push(uris.slice(i, i + 25));
                const results = await Promise.all(chunks.map(c => this.api.getPosts(c)));
                results.forEach(r => r.data.posts.forEach(p => { postMap[p.uri] = p.record.text; }));
            }

            const fragment = document.createDocumentFragment();
            for (const n of notifs) {
                const div = document.createElement('div');
                div.className = 'post notif';
                div.dataset.notif = '1';
                div.dataset.reason = n.reason || '';
                div.dataset.thread = n.reasonSubject || n.uri || '';
                div.dataset.actor  = n.author?.handle || '';
                div.dataset.did    = n.author?.did || '';
                div.dataset.following = n.author?.viewer?.following || '';
                div.dataset.muted    = n.author?.viewer?.muted    || '';
                div.dataset.blocking = n.author?.viewer?.blocking  || '';

                const previewText = (n.reason === 'like' || n.reason === 'repost') ? postMap[n.reasonSubject] : n.record?.text;
                const preview = previewText ? `<div class="post-text" style="color:gray;font-size:.85em;margin-top:4px;padding:4px 8px;border-left:2px solid #ddd;">${linkify(previewText)}</div>` : '';

                div.innerHTML = `<img src="${escAttr(n.author?.avatar||'')}" class="post-avatar" loading="lazy" decoding="async">` +
                                `<div class="post-content"><strong>${escAttr(n.author?.displayName||n.author?.handle||'')}</strong> ` +
                                `<span>${ctx.t('notif_' + n.reason)}</span>${preview}</div>`;
                fragment.appendChild(div);
            }

            requestAnimationFrame(() => {
                this.els.notifDiv.textContent = '';
                this.els.notifDiv.appendChild(fragment);
            });

            this.api.updateSeenNotifications().catch(() => {});
            this.api.countUnreadNotifications().then(r => { this.els.notifBadge?.classList.toggle('hidden', r.data.count === 0); }).catch(() => {});
        } catch (e) { console.error('fetchNotifications:', e); }
    }

    async fetchBookmarks() {
        if (!this.els.bookmarksView) return;
        this.els.bookmarksView.innerHTML = '<div style="padding:20px;text-align:center;">Loading...</div>';
        const ctx = this.getCtx();
        try {
            const fetchRes = await fetch(`${this.api.pdsUrl}/xrpc/app.bsky.bookmark.getBookmarks?limit=50`, { 
                headers: { 'Authorization': `Bearer ${this.api.session.accessJwt}` } 
            });
            if (!fetchRes.ok) throw new Error(`HTTP ${fetchRes.status}`);
            
            const data = await fetchRes.json();
            window.aeruneBookmarks.clear();
            const uris = [];
            for (const b of (data.bookmarks || [])) {
                const uri = b.subject?.uri || b.record?.uri;
                if (uri) { uris.push(uri); window.aeruneBookmarks.add(uri); }
            }
            
            if (!uris.length) { 
                this.els.bookmarksView.innerHTML = `<div style="padding:20px;text-align:center;">${ctx.t('no_bookmarks')}</div>`; 
                return; 
            }

            const chunks = [];
            for (let i = 0; i < uris.length; i += 25) chunks.push(uris.slice(i, i + 25));
            const responses = await Promise.all(chunks.map(c => this.api.getPosts(c)));

            const feedItems = [];
            responses.forEach(r => r.data.posts.forEach(post => { 
                post.viewer = { ...post.viewer, bookmark: 'bookmarked' }; 
                feedItems.push({ post }); 
            }));
            
            renderPosts(feedItems, this.els.bookmarksView, ctx);
        } catch (e) { 
            this.els.bookmarksView.innerHTML = `<div style="padding:20px;text-align:center;color:red;">${ctx.t('bookmark_failed')}<br><small style="color:gray;">${e.message}</small></div>`; 
        }
    }

    async loadThread(uri) {
        const container = document.getElementById('thread-content');
        if (!container) return;
        container.innerHTML = '<div style="padding:20px;text-align:center;">Loading Thread...</div>';
        const ctx = this.getCtx();
        try {
            const res = await this.api.getPostThread(uri);
            const fragment = document.createDocumentFragment();
            const walk = (item, isRoot = false) => {
                if (item.parent) walk(item.parent);
                if (item.post) fragment.appendChild(createPostElement(item.post, ctx, isRoot));
                if (item.replies) {
                    for (const r of item.replies) {
                        if (!r.post) continue;
                        const el = createPostElement(r.post, ctx);
                        el.style.cssText = 'margin-left:40px;border-left:2px solid #eee;';
                        fragment.appendChild(el);
                    }
                }
            };
            walk(res.data.thread, true);
            requestAnimationFrame(() => { container.textContent = ''; container.appendChild(fragment); });
        } catch { container.innerHTML = '<div style="padding:20px;">Failed to load thread.</div>'; }
    }

    async loadProfile(actor, isAppend = false) {
        if (this.isLoading) return;
        this.isLoading = true;
        if (!isAppend) this.cursors.profile = null;

        const header  = document.getElementById('profile-header-container');
        const pinned  = document.getElementById('profile-pinned');
        const tl      = document.getElementById('profile-timeline');
        
        if (!isAppend) {
            if (header) header.innerHTML = 'Loading...';
            if (pinned) pinned.innerHTML = '';
            if (tl)     tl.innerHTML = '';
        }
        const ctx = this.getCtx();

        try {
            const [profileRes, feedRes] = await Promise.all([
                !isAppend ? this.api.getProfile(actor) : Promise.resolve(null),
                this.api.getAuthorFeed(actor, 30, this.cursors.profile)
            ]);
            
            this.cursors.profile = feedRes.data.cursor;

            if (!isAppend && profileRes) {
                const p = profileRes.data;
                const isSelf = this.api.session && p.did === this.api.session.did;

                const rel = p.viewer?.following && p.viewer?.followedBy ? `<span class="relationship-badge">${ctx.t('mutual')}</span>`
                    : p.viewer?.following ? `<span class="relationship-badge">${ctx.t('following')}</span>`
                    : p.viewer?.followedBy ? `<span class="relationship-badge">${ctx.t('follow_me')}</span>` : '';

                const banner = p.banner ? `<img src="${escAttr(p.banner)}" style="width:100%;height:150px;object-fit:cover;" loading="lazy">` : `<div style="width:100%;height:150px;background:#ddd;"></div>`;
                const stats = `<div style="display:flex;gap:20px;margin-top:15px;border-top:1px solid #eee;padding-top:10px;font-size:.95em;">` +
                    `<span><strong>${p.postsCount||0}</strong> <span style="color:gray;">${ctx.t('stats_posts')}</span></span>` +
                    `<span style="cursor:pointer;" data-ext="${escAttr('https://bsky.app/profile/'+p.handle+'/follows')}"><strong>${p.followsCount||0}</strong> <span style="color:gray;">${ctx.t('stats_following')}</span></span>` +
                    `<span style="cursor:pointer;" data-ext="${escAttr('https://bsky.app/profile/'+p.handle+'/followers')}"><strong>${p.followersCount||0}</strong> <span style="color:gray;">${ctx.t('stats_followers')}</span></span>` +
                    `</div>`;

                const dmBtn    = !isSelf ? `<button data-act="start-dm" data-did="${escAttr(p.did)}" class="sidebar-action-btn" style="width:auto;padding:5px 15px;margin-right:10px;">${ctx.t('send_dm')}</button>` : '';
                const replyBtn = !isSelf ? `<button data-act="profile-reply" data-handle="${escAttr(p.handle)}" class="sidebar-action-btn" style="width:auto;padding:5px 15px;margin-right:10px;">${ctx.t('profile_reply')}</button>` : '';
                const followBtn = !isSelf ? `<button data-act="toggle-follow" data-did="${escAttr(p.did)}" data-following="${escAttr(p.viewer?.following||'')}" class="sidebar-action-btn" style="width:auto;padding:5px 15px;background:${p.viewer?.following?'#ccc':'var(--bsky-blue)'};">${p.viewer?.following ? ctx.t('ctx_unfollow') : ctx.t('ctx_follow')}</button>` : '';
                    
                header.innerHTML = banner +
                    `<div style="padding:20px;position:relative;">` +
                    `<img src="${escAttr(p.avatar||'')}" style="width:80px;height:80px;border-radius:50%;border:4px solid white;position:absolute;top:-40px;background:#eee;" loading="lazy">` +
                    `<div style="margin-top:40px;">` +
                    `<div style="font-size:20px;font-weight:bold;">${escAttr(p.displayName||p.handle)}${rel}</div>` +
                    `<div style="color:gray;">@${escAttr(p.handle)}</div>` +
                    `<div style="margin-top:10px;word-break:break-word;">${renderRichText({text:p.description||''})}</div>` +
                    stats +
                    `<div style="margin-top:15px;display:flex;gap:8px;flex-wrap:wrap;">${dmBtn}${replyBtn}${followBtn}</div>` +
                    `</div></div>`;

                if (p.pinnedPost && pinned) {
                    try {
                        const pinRes = await this.api.getPosts([p.pinnedPost.uri]);
                        if (pinRes.data.posts.length) {
                            const pinnedEl = createPostElement(pinRes.data.posts[0], ctx);
                            const contentDiv = pinnedEl.querySelector('.post-content');
                            if (contentDiv) {
                                const badge = document.createElement('div');
                                badge.style.cssText = 'font-size:.85em;color:gray;margin-bottom:4px;font-weight:bold;';
                                badge.innerHTML = `${ctx.getIcon('pin')} ${ctx.t('pinned_post')}`;
                                contentDiv.insertBefore(badge, contentDiv.firstChild);
                            }
                            pinnedEl.style.border = '2px solid var(--bsky-blue)';
                            pinnedEl.style.backgroundColor = 'rgba(0,133,255,.05)';
                            pinned.appendChild(pinnedEl);
                        }
                    } catch (err) { console.error('pinned post:', err); }
                }
            }

            let feedItems = feedRes.data.feed;
            if (profileRes?.data?.pinnedPost) {
                feedItems = feedItems.filter(item => item.post.uri !== profileRes.data.pinnedPost.uri);
            }
            renderPosts(feedItems, tl, ctx, isAppend);
        } catch (e) {
            console.error('loadProfile:', e);
            if (!isAppend && header) {
                header.innerHTML = `<div style="padding:20px; text-align:center; color:red;">Failed to load profile.<br><small style="color:gray;">${e.message}</small></div>`;
            }
        } finally {
            this.isLoading = false;
        }
    }
}

module.exports = ViewLoader;