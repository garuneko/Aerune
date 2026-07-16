// view-loader.js (optimized)
const { hasSelection, downloadImage, linkify, renderRichText, escHTML, escAttr } = require('./utils.js');
const { createPostElement, renderPosts } = require('./post-renderer.js');
const { canonicalReactionReason, groupNotificationsForDisplay } = require('./display-utils.js');

class ViewLoader {
    constructor(api, getCtx, els, getTimelineSource = () => null) {
        this.api = api;
        this.getCtx = getCtx;
        this.els = els;
        this.getTimelineSource = getTimelineSource;
        this.cursors = { home: null, profile: null, search: null };
        this.exhausted = {};
        this.timelineRequestId = 0;
        this.activeTimelineSourceKey = null;
        this.notificationCursor = null;
        this.notificationExhausted = false;
        this.notificationLoading = false;
        this.notificationItems = [];
        this.isLoading = false; 
    }

    timelineInfo() {
        const source = this.getTimelineSource?.();
        const sourceKey = source?.kind === 'local-list'
            ? 'local-list'
            : (source?.value ? `feed:${source.value}` : 'home');
        return { source, sourceKey, did: this.api.session?.did || 'anon' };
    }

    storageSafe(value) {
        return encodeURIComponent(value).replace(/%/g, '_');
    }

    timelineCacheKey(sourceKey) {
        const { did } = this.timelineInfo();
        return `aerune_timeline_cache_${this.storageSafe(did)}_${this.storageSafe(sourceKey)}`;
    }

    timelineScrollKey(sourceKey) {
        const { did } = this.timelineInfo();
        return `aerune_timeline_scroll_${this.storageSafe(did)}_${this.storageSafe(sourceKey)}`;
    }

    readTimelineCache(sourceKey) {
        if (typeof localStorage === 'undefined') return null;
        try {
            const raw = localStorage.getItem(this.timelineCacheKey(sourceKey));
            if (!raw) return null;
            const cache = JSON.parse(raw);
            const age = Date.now() - (cache.savedAt || 0);
            if (!Array.isArray(cache.feed) || age > 86400000) {
                localStorage.removeItem(this.timelineCacheKey(sourceKey));
                return null;
            }
            return cache;
        } catch {
            localStorage.removeItem(this.timelineCacheKey(sourceKey));
            return null;
        }
    }

    writeTimelineCache(sourceKey, feed, cursor) {
        if (typeof localStorage === 'undefined' || !Array.isArray(feed)) return;
        const key = this.timelineCacheKey(sourceKey);
        const cache = { savedAt: Date.now(), cursor: cursor || null, feed: feed.slice(0, 60) };
        try {
            localStorage.setItem(key, JSON.stringify(cache));
        } catch {
            try {
                cache.feed = cache.feed.slice(0, 25);
                localStorage.setItem(key, JSON.stringify(cache));
            } catch {
                localStorage.removeItem(key);
            }
        }
    }

    getExistingTimelineUris() {
        return new Set(Array.from(this.els.timelineDiv?.querySelectorAll('.post[data-uri]') || [])
            .map(el => el.dataset.uri)
            .filter(Boolean));
    }

    getTopTimelineUri() {
        return this.els.timelineDiv?.querySelector('.post[data-uri]')?.dataset.uri || '';
    }

    saveTimelineScroll() {
        if (this.getCtx().restoreScrollEnabled === false) return;
        if (typeof localStorage === 'undefined') return;
        if (!this.els.contentEl || this.els.timelineDiv?.classList.contains('hidden')) return;
        const { sourceKey } = this.timelineInfo();
        localStorage.setItem(this.timelineScrollKey(sourceKey), String(this.els.contentEl.scrollTop || 0));
    }

    restoreTimelineScroll(sourceKey) {
        if (typeof localStorage === 'undefined' || !this.els.contentEl) return;
        const saved = Number(localStorage.getItem(this.timelineScrollKey(sourceKey)));
        if (!Number.isFinite(saved) || saved < 0) return;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            this.els.contentEl.scrollTop = saved;
        }));
    }

    scrollTimelineTop() {
        if (!this.els.contentEl) return;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            this.els.contentEl.scrollTop = 0;
            this.saveTimelineScroll();
        }));
    }

    async hydrateReplyParents(feedItems, postMap) {
        const missing = [];
        for (const item of feedItems) {
            const parentUri = item.reply?.parent?.uri;
            if (parentUri && !postMap.has(parentUri)) missing.push(parentUri);
        }
        const unique = [...new Set(missing)];
        for (let i = 0; i < unique.length; i += 25) {
            try {
                const res = await this.api.getPosts(unique.slice(i, i + 25));
                for (const post of (res.data.posts || [])) {
                    if (post?.uri && !postMap.has(post.uri)) postMap.set(post.uri, { post, reason: null });
                }
            } catch (e) {
                console.warn('hydrateReplyParents:', e);
            }
        }
    }

    isMutedItem(item) {
        const ctx = this.getCtx();
        const post = item.post || item;
        if (ctx.shouldMutePost?.(post)) return true;
        const words = (ctx.muteWords || [])
            .map(w => String(w).trim().toLowerCase())
            .filter(Boolean);
        if (!words.length) return false;
        const parts = [
            post.record?.text,
            post.value?.text,
            post.embed?.record?.record?.value?.text,
            post.embed?.record?.record?.record?.text,
            post.embed?.record?.record?.value?.record?.text
        ].filter(Boolean);
        const text = parts.join('\n').toLowerCase();
        return words.some(word => text.includes(word));
    }

    async processTimelineFeed(feedItems) {
        const postMap = new Map();
        for (const item of feedItems) {
            if (!item?.post?.uri) continue;
            if (!postMap.has(item.post.uri)) postMap.set(item.post.uri, item);
            if (item.reply && !item.reason) {
                if (item.reply.parent && !postMap.has(item.reply.parent.uri)) postMap.set(item.reply.parent.uri, { post: item.reply.parent, reason: null });
                if (item.reply.root && !postMap.has(item.reply.root.uri)) postMap.set(item.reply.root.uri, { post: item.reply.root, reason: null });
            }
        }

        await this.hydrateReplyParents(feedItems, postMap);

        const newFeed = [];
        const seenUris = new Set();
        const myDid = this.api.session?.did;

        for (const item of feedItems) {
            if (!item?.post?.uri || seenUris.has(item.post.uri)) continue;

            let shouldSkip = false;
            if (item.reply && !item.reason) {
                const isMyPost = item.post.author.did === myDid;
                const parentUri = item.reply.parent?.uri;
                const rootUri = item.reply.root?.uri;
                const parentPost = item.reply.parent?.author ? item.reply.parent : postMap.get(parentUri)?.post;
                const rootPost = item.reply.root?.author ? item.reply.root : postMap.get(rootUri)?.post;
                const pAuthor = parentPost?.author;
                const rAuthor = rootPost?.author;
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

        return newFeed.filter(item => !this.isMutedItem(item));
    }

    postTimestamp(item) {
        const post = item?.post || item;
        const raw = post?.indexedAt || post?.record?.createdAt || post?.value?.createdAt || '';
        const ms = raw ? new Date(raw).getTime() : 0;
        return Number.isFinite(ms) ? ms : 0;
    }

    async fetchLocalListTimeline(source, sourceKey, limit, isAppend) {
        const members = Array.isArray(source?.members) ? source.members.filter(member => member?.did) : [];
        if (!members.length) return { data: { feed: [], cursor: null } };

        const existingCursors = isAppend && this.cursors[sourceKey] && typeof this.cursors[sourceKey] === 'object'
            ? this.cursors[sourceKey]
            : {};
        const perMemberLimit = Math.max(3, Math.min(15, Math.ceil((limit * 1.5) / members.length)));
        const responses = await Promise.all(members.map(async member => {
            const cursor = existingCursors[member.did];
            if (isAppend && !cursor) return { did: member.did, feed: [], cursor: null };
            try {
                const res = await this.api.getAuthorFeed(member.did, perMemberLimit, cursor);
                return {
                    did: member.did,
                    feed: Array.isArray(res.data.feed) ? res.data.feed : [],
                    cursor: res.data.cursor || null
                };
            } catch (e) {
                console.warn('fetchLocalListTimeline:', member.did, e);
                return { did: member.did, feed: [], cursor: cursor || null };
            }
        }));

        const nextCursors = {};
        const feed = [];
        for (const response of responses) {
            if (response.cursor) nextCursors[response.did] = response.cursor;
            feed.push(...response.feed);
        }

        feed.sort((a, b) => this.postTimestamp(b) - this.postTimestamp(a));
        return {
            data: {
                feed: feed.slice(0, limit),
                cursor: Object.keys(nextCursors).length ? nextCursors : null
            }
        };
    }

    async fetchTimelinePage(source, sourceKey, limit, isAppend) {
        if (source?.kind === 'local-list') return this.fetchLocalListTimeline(source, sourceKey, limit, isAppend);
        return source?.value
            ? this.api.getFeed(source.value, limit, this.cursors[sourceKey])
            : this.api.getTimeline(limit, this.cursors[sourceKey]);
    }

    renderTimelineStatus(message) {
        if (!this.els.timelineDiv) return;
        requestAnimationFrame(() => {
            this.els.timelineDiv.innerHTML = `<div class="feed-status">${escHTML(message)}</div>`;
        });
    }

    async fetchTimeline(isAppend = false, options = {}) {
        const { source, sourceKey } = this.timelineInfo();
        if (this.isLoading && (this.activeTimelineSourceKey == null || isAppend || this.activeTimelineSourceKey === sourceKey)) return;
        const requestId = ++this.timelineRequestId;
        this.isLoading = true;
        this.activeTimelineSourceKey = sourceKey;

        if (isAppend && this.exhausted[sourceKey]) {
            this.isLoading = false;
            this.activeTimelineSourceKey = null;
            return;
        }
        if (!isAppend) {
            this.cursors[sourceKey] = null;
            this.exhausted[sourceKey] = false;
        }

        try {
            if (!isAppend && !options.skipCache) {
                const cache = this.readTimelineCache(sourceKey);
                if (cache) {
                    const cachedFeed = await this.processTimelineFeed(cache.feed);
                    renderPosts(cachedFeed, this.els.timelineDiv, this.getCtx(), false);
                    if (this.getCtx().restoreScrollEnabled !== false) this.restoreTimelineScroll(sourceKey);
                }
            }

            const res = await this.fetchTimelinePage(source, sourceKey, 30, isAppend);
            if (this.timelineInfo().sourceKey !== sourceKey || this.timelineRequestId !== requestId) return;

            const rawFeed = Array.isArray(res.data.feed) ? res.data.feed : [];
            this.cursors[sourceKey] = res.data.cursor;
            this.exhausted[sourceKey] = !this.cursors[sourceKey] || rawFeed.length === 0;
            if (!isAppend) this.writeTimelineCache(sourceKey, rawFeed, this.cursors[sourceKey]);

            let newFeed = await this.processTimelineFeed(rawFeed);
            if (this.timelineInfo().sourceKey !== sourceKey || this.timelineRequestId !== requestId) return;
            if (isAppend) {
                const existing = this.getExistingTimelineUris();
                newFeed = newFeed.filter(item => !existing.has(item.post?.uri));
            }

            if (!isAppend && source?.kind === 'local-list' && !newFeed.length) {
                renderPosts([], this.els.timelineDiv, this.getCtx(), false);
                this.renderTimelineStatus(source.members?.length ? this.getCtx().t('locallist_no_posts') : this.getCtx().t('locallist_empty'));
            } else {
                renderPosts(newFeed, this.els.timelineDiv, this.getCtx(), isAppend);
            }
            if (options.scrollToTop) this.scrollTimelineTop();
            else if (!isAppend && this.getCtx().restoreScrollEnabled !== false) this.restoreTimelineScroll(sourceKey);
        } catch (e) { console.error('fetchTimeline:', e); }
        finally {
            if (this.timelineRequestId === requestId) {
                this.isLoading = false;
                this.activeTimelineSourceKey = null;
            }
        }
    }

    async hasNewTimelineItems() {
        const { source, sourceKey } = this.timelineInfo();
        const currentTop = this.getTopTimelineUri();
        if (!currentTop) return false;
        const savedCursor = this.cursors[sourceKey];
        try {
            this.cursors[sourceKey] = null;
            const res = await this.fetchTimelinePage(source, sourceKey, 10, false);
            if (this.timelineInfo().sourceKey !== sourceKey) return false;
            const feed = await this.processTimelineFeed(res.data.feed || []);
            const nextTop = feed.find(item => item.post?.uri)?.post?.uri || '';
            return !!nextTop && nextTop !== currentTop;
        } catch (e) {
            console.warn('hasNewTimelineItems:', e);
            return false;
        } finally {
            this.cursors[sourceKey] = savedCursor;
        }
    }
     
    notificationId(n) {
        return [n.uri, n.cid, n.indexedAt, n.author?.did, n.reason, n.reasonSubject].filter(Boolean).join('|');
    }

    notificationTarget(n) {
        if (n.reason === 'follow') return { type: 'profile', actor: n.author?.did || n.author?.handle || '' };
        const uri = canonicalReactionReason(n.reason)
            ? n.reasonSubject
            : (n.uri || n.reasonSubject);
        return uri ? { type: 'thread', uri } : { type: 'profile', actor: n.author?.did || n.author?.handle || '' };
    }

    groupNotifications(notifs) {
        return groupNotificationsForDisplay(notifs, n => this.notificationId(n)).map(item => ({
            ...item,
            target: this.notificationTarget(item.notifications[0])
        }));
    }

    notificationActorText(notifs, ctx) {
        const names = [];
        const seen = new Set();
        for (const n of notifs) {
            const did = n.author?.did || n.author?.handle || '';
            if (!did || seen.has(did)) continue;
            seen.add(did);
            names.push(n.author?.displayName || n.author?.handle || did);
        }
        if (names.length <= 2) return names.join(', ');
        return `${names.slice(0, 2).join(', ')} ${ctx.t('notif_actor_more', String(names.length - 2))}`;
    }

    renderNotificationItem(item, postMap, ctx) {
        const n = item.notifications[0];
        const target = item.target || this.notificationTarget(n);
        const reactionReason = canonicalReactionReason(item.reason || n.reason);
        const div = document.createElement('div');
        const isUnread = item.notifications.some(x => !x.isRead);
        const isGroup = item.notifications.length > 1;
        const detailId = reactionReason ? item.id : '';
        div.className = `post notif${isUnread ? ' notif-unread' : ''}${isGroup ? ' notif-group' : ''}`;
        div.dataset.notif = '1';
        div.dataset.reason = item.reason || n.reason || '';
        div.dataset.thread = target.uri || n.reasonSubject || n.uri || '';
        div.dataset.actor  = n.author?.did || n.author?.handle || '';
        div.dataset.did    = n.author?.did || '';
        div.dataset.following = n.author?.viewer?.following || '';
        div.dataset.muted    = n.author?.viewer?.muted    || '';
        div.dataset.blocking = n.author?.viewer?.blocking  || '';
        div.dataset.notifTarget = target.type || '';
        div.dataset.targetUri = target.uri || '';
        if (detailId) div.dataset.detailId = detailId;

        if (detailId && typeof window !== 'undefined') {
            window.aeruneNotificationDetails = window.aeruneNotificationDetails || new Map();
            window.aeruneNotificationDetails.set(detailId, {
                reason: item.reason,
                target,
                notifications: item.notifications,
                post: postMap[n.reasonSubject] || null
            });
        }

        const previewText = reactionReason ? postMap[n.reasonSubject]?.record?.text : n.record?.text;
        const preview = previewText ? `<div class="notif-preview">${linkify(previewText)}</div>` : '';
        const avatars = item.notifications.slice(0, 3).map(x =>
            `<img src="${escAttr(x.author?.avatar||'')}" class="notif-avatar" loading="lazy" decoding="async">`
        ).join('');
        const actorText = this.notificationActorText(item.notifications, ctx);
        const reasonKey = isGroup ? `notif_group_${item.reason}` : `notif_${n.reason}`;
        const reasonText = isGroup
            ? ctx.t(reasonKey, actorText, String(item.notifications.length))
            : ctx.t(reasonKey);
        const detail = reactionReason
            ? `<button type="button" class="notif-detail-btn" data-act="notification-detail" data-detail-id="${escAttr(detailId)}">${ctx.t('notif_view_reactions')}</button>`
            : '';

        div.innerHTML =
            `<div class="notif-avatar-stack">${avatars || `<img src="${escAttr(n.author?.avatar||'')}" class="notif-avatar" loading="lazy" decoding="async">`}</div>` +
            `<div class="post-content">` +
            `<div class="notif-title"><strong>${escHTML(isGroup ? actorText : (n.author?.displayName||n.author?.handle||''))}</strong> <span>${escHTML(reasonText)}</span></div>` +
            preview + detail +
            `</div>`;
        return div;
    }

    async fetchNotifications(isAppend = false) {
        if (this.notificationLoading) return;
        if (!this.els.notifDiv) return;
        if (!isAppend) {
            this.notificationCursor = null;
            this.notificationExhausted = false;
            this.notificationItems = [];
            this.els.notifDiv.innerHTML = `<div class="notif-status">${escHTML(this.getCtx().t('notifications_loading'))}</div>`;
            if (typeof window !== 'undefined') window.aeruneNotificationDetails = new Map();
        }
        if (isAppend && this.notificationExhausted) return;

        this.notificationLoading = true;
        const ctx = this.getCtx();
        try {
            this.els.notifDiv.querySelector('.notif-load-more')?.remove();
            const notifRes = await this.api.listNotifications(25, isAppend ? this.notificationCursor : undefined);
            const notifs = Array.isArray(notifRes.data.notifications) ? notifRes.data.notifications : [];
            this.notificationCursor = notifRes.data.cursor || null;
            this.notificationExhausted = !this.notificationCursor || notifs.length === 0;

            const existing = new Set(this.notificationItems.map(n => this.notificationId(n)));
            const visibleNotifs = notifs.filter(n => {
                if (canonicalReactionReason(n.reason) || !n.record?.text) return true;
                return !ctx.shouldMutePost?.({ record: n.record, author: n.author, uri: n.uri });
            });
            const fresh = isAppend ? visibleNotifs.filter(n => !existing.has(this.notificationId(n))) : visibleNotifs;
            this.notificationItems = isAppend ? this.notificationItems.concat(fresh) : fresh;
            ctx.rememberNotificationIds?.(this.notificationItems.map(n => this.notificationId(n)).filter(Boolean));

            const uris = [...new Set(this.notificationItems
                .filter(n => canonicalReactionReason(n.reason) && n.reasonSubject)
                .map(n => n.reasonSubject))];
            const postMap = {};
            if (uris.length) {
                const chunks = [];
                for (let i = 0; i < uris.length; i += 25) chunks.push(uris.slice(i, i + 25));
                const results = await Promise.all(chunks.map(c => this.api.getPosts(c).catch(() => ({ data: { posts: [] } }))));
                results.forEach(r => r.data.posts.forEach(p => { postMap[p.uri] = p; }));
            }

            const fragment = document.createDocumentFragment();
            for (const item of this.groupNotifications(this.notificationItems)) {
                fragment.appendChild(this.renderNotificationItem(item, postMap, ctx));
            }
            if (this.notificationCursor) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'notif-load-more';
                btn.dataset.act = 'notif-load-more';
                btn.textContent = ctx.t('notifications_load_more');
                fragment.appendChild(btn);
            }

            requestAnimationFrame(() => {
                this.els.notifDiv.textContent = '';
                if (!this.notificationItems.length) {
                    this.els.notifDiv.innerHTML = `<div class="notif-status">${escHTML(ctx.t('notifications_empty'))}</div>`;
                } else {
                    this.els.notifDiv.appendChild(fragment);
                }
            });

            if (!isAppend) {
                this.api.updateSeenNotifications().then(() => {
                    ctx.setNotificationBadge?.(0);
                }).catch(() => {});
            }
        } catch (e) {
            console.error('fetchNotifications:', e);
            if (!isAppend) {
                this.els.notifDiv.innerHTML = `<div class="notif-status notif-error">${escHTML(ctx.t('notifications_failed'))}</div>`;
            }
        } finally {
            this.notificationLoading = false;
        }
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
            
            renderPosts(feedItems.filter(item => !this.isMutedItem(item)), this.els.bookmarksView, ctx);
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
                const localListMember = ctx.isLocalListMember?.(p.did);
                let canChat = false;
                if (!isSelf) {
                    try {
                        const availability = await this.api.getConvoAvailability(p.did);
                        canChat = !!availability?.data?.canChat;
                    } catch {
                        canChat = false;
                    }
                }

                const rel = p.viewer?.following && p.viewer?.followedBy ? `<span class="relationship-badge">${ctx.t('mutual')}</span>`
                    : p.viewer?.following ? `<span class="relationship-badge">${ctx.t('following')}</span>`
                    : p.viewer?.followedBy ? `<span class="relationship-badge">${ctx.t('follow_me')}</span>` : '';

                const banner = p.banner ? `<img src="${escAttr(p.banner)}" style="width:100%;height:150px;object-fit:cover;" loading="lazy">` : `<div style="width:100%;height:150px;background:#ddd;"></div>`;
                const stats = `<div style="display:flex;gap:20px;margin-top:15px;border-top:1px solid #eee;padding-top:10px;font-size:.95em;">` +
                    `<span><strong>${p.postsCount||0}</strong> <span style="color:gray;">${ctx.t('stats_posts')}</span></span>` +
                    `<button type="button" class="profile-stat-link" data-act="profile-relations" data-relation="follows" data-actor="${escAttr(p.did)}"><strong>${p.followsCount||0}</strong> <span>${ctx.t('stats_following')}</span></button>` +
                    `<button type="button" class="profile-stat-link" data-act="profile-relations" data-relation="followers" data-actor="${escAttr(p.did)}"><strong>${p.followersCount||0}</strong> <span>${ctx.t('stats_followers')}</span></button>` +
                    `</div>`;

                const dmBtn    = !isSelf && canChat ? `<button data-act="start-dm" data-did="${escAttr(p.did)}" class="sidebar-action-btn" style="width:auto;padding:5px 15px;margin-right:10px;">${ctx.t('send_dm')}</button>` : '';
                const replyBtn = !isSelf ? `<button data-act="profile-reply" data-handle="${escAttr(p.handle)}" class="sidebar-action-btn" style="width:auto;padding:5px 15px;margin-right:10px;">${ctx.t('profile_reply')}</button>` : '';
                const followBtn = !isSelf ? `<button data-act="toggle-follow" data-did="${escAttr(p.did)}" data-following="${escAttr(p.viewer?.following||'')}" class="sidebar-action-btn" style="width:auto;padding:5px 15px;background:${p.viewer?.following?'#ccc':'var(--bsky-blue)'};">${p.viewer?.following ? ctx.t('ctx_unfollow') : ctx.t('ctx_follow')}</button>` : '';
                const localListBtn = !isSelf ? `<button data-act="local-list-toggle" data-did="${escAttr(p.did)}" data-handle="${escAttr(p.handle)}" data-display-name="${escAttr(p.displayName||'')}" data-avatar="${escAttr(p.avatar||'')}" class="sidebar-action-btn local-list-action${localListMember ? ' is-member' : ''}" style="width:auto;padding:5px 15px;margin-right:10px;">${localListMember ? ctx.t('locallist_remove') : ctx.t('locallist_add_member')}</button>` : '';
                const reportBtn = !isSelf ? `<button data-act="report-account" data-did="${escAttr(p.did)}" class="sidebar-action-btn danger-action" style="width:auto;padding:5px 15px;margin-right:10px;">${ctx.t('ctx_report_account')}</button>` : '';
                    
                header.innerHTML = banner +
                    `<div style="padding:20px;position:relative;">` +
                    `<img src="${escAttr(p.avatar||'')}" style="width:80px;height:80px;border-radius:50%;border:4px solid white;position:absolute;top:-40px;background:#eee;" loading="lazy">` +
                    `<div style="margin-top:40px;">` +
                    `<div style="font-size:20px;font-weight:bold;">${escHTML(p.displayName||p.handle)}${rel}</div>` +
                    `<div style="color:gray;">@${escHTML(p.handle)}</div>` +
                    `<div style="margin-top:10px;word-break:break-word;">${renderRichText({text:p.description||''})}</div>` +
                    stats +
                    `<div style="margin-top:15px;display:flex;gap:8px;flex-wrap:wrap;">${dmBtn}${replyBtn}${followBtn}${localListBtn}${reportBtn}</div>` +
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
            feedItems = feedItems.filter(item => !this.isMutedItem(item));
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
