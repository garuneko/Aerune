// bsky-api.js
// BskyAgent の薄いラッパー。actions.js や view-loader.js から使用

const { BskyAgent, RichText } = require('@atproto/api');

class BskyAPI {
    constructor() {
        this.agent = new BskyAgent({ service: 'https://bsky.social' });
        this.chatAgent = null;
        this.RichText = RichText;
    }

    // ─── セッション情報 ───────────────────────────────────────────
    get session() { return this.agent.session; }

    // ─── PDS URL 取得 ─────────────────────────────────────────────
    get pdsUrl() {
        let url = 'https://bsky.social';
        if (this.agent.pdsUrl) url = this.agent.pdsUrl;
        else if (this.agent.api?.xrpc?.uri) url = this.agent.api.xrpc.uri;
        return url.toString().replace(/\/$/, '');
    }

    // ─── ログイン / セッション ─────────────────────────────────────
    async login(identifier, password) {
        const res = await this.agent.login({ identifier, password });
        this._initChatAgent();
        return res;
    }

    async resumeSession(sessionData) {
        const res = await this.agent.resumeSession(sessionData);
        this._initChatAgent();
        return res;
    }

    _initChatAgent() {
        this.chatAgent = this.agent.withProxy('bsky_chat', 'did:web:api.bsky.chat');
    }

    async _xrpc(endpoint, query = undefined, options = {}) {
        const url = new URL(`${this.pdsUrl}/xrpc/${endpoint}`);
        if (query) {
            for (const [key, value] of Object.entries(query)) {
                if (value == null) continue;
                if (Array.isArray(value)) {
                    value.forEach(v => { if (v != null) url.searchParams.append(key, v); });
                } else {
                    url.searchParams.set(key, value);
                }
            }
        }

        const headers = { ...(options.headers || {}) };
        if (this.session?.accessJwt) headers.Authorization = `Bearer ${this.session.accessJwt}`;
        const fetchOptions = { method: options.method || 'GET', headers };
        if (options.body !== undefined) {
            headers['Content-Type'] = 'application/json';
            fetchOptions.body = JSON.stringify(options.body);
        }

        const res = await fetch(url.toString(), fetchOptions);
        const text = await res.text();
        let data = null;
        if (text) {
            try { data = JSON.parse(text); }
            catch { data = { message: text }; }
        }
        if (!res.ok) {
            const message = data?.message || data?.error || `HTTP ${res.status}`;
            throw new Error(message);
        }
        return { data };
    }

    // ─── プロフィール ─────────────────────────────────────────────
    async getProfile(actor) { return await this.agent.getProfile({ actor }); }

// ─── タイムライン / フィード ──────────────────────────────────
    async getTimeline(limit = 30, cursor = undefined) { 
        const params = { limit };
        if (cursor) params.cursor = cursor;
        return await this.agent.getTimeline(params); 
    }

    async getFeed(uri, limit = 30, cursor = undefined) {
        const params = { feed: uri, limit };
        if (cursor) params.cursor = cursor;
        return await this._xrpc('app.bsky.feed.getFeed', params);
    }

    async getPreferences() {
        return await this._xrpc('app.bsky.actor.getPreferences');
    }

    async putPreferences(preferences) {
        return await this._xrpc('app.bsky.actor.putPreferences', undefined, {
            method: 'POST',
            body: { preferences }
        });
    }

    async getMutedWords() {
        const res = await this.getPreferences();
        const pref = (res.data.preferences || []).find(p => p.$type === 'app.bsky.actor.defs#mutedWordsPref');
        return pref?.items || [];
    }

    async putMutedWords(items) {
        const res = await this.getPreferences();
        const preferences = (res.data.preferences || [])
            .filter(p => p.$type !== 'app.bsky.actor.defs#mutedWordsPref');
        const normalizedItems = (items || []).map(item => {
            const next = { ...item };
            if (!next.expiresAt) delete next.expiresAt;
            return next;
        });
        preferences.push({
            $type: 'app.bsky.actor.defs#mutedWordsPref',
            items: normalizedItems
        });
        return await this.putPreferences(preferences);
    }

    async getListMutes(limit = 50, cursor = undefined) {
        const params = { limit };
        if (cursor) params.cursor = cursor;
        return await this._xrpc('app.bsky.graph.getListMutes', params);
    }

    async getListBlocks(limit = 50, cursor = undefined) {
        const params = { limit };
        if (cursor) params.cursor = cursor;
        return await this._xrpc('app.bsky.graph.getListBlocks', params);
    }

    async muteActorList(listUri) {
        return await this._xrpc('app.bsky.graph.muteActorList', undefined, {
            method: 'POST',
            body: { list: listUri }
        });
    }

    async unmuteActorList(listUri) {
        return await this._xrpc('app.bsky.graph.unmuteActorList', undefined, {
            method: 'POST',
            body: { list: listUri }
        });
    }

    async blockActorList(listUri) {
        return await this.agent.com.atproto.repo.createRecord({
            repo: this.session.did,
            collection: 'app.bsky.graph.listblock',
            record: {
                $type: 'app.bsky.graph.listblock',
                subject: listUri,
                createdAt: new Date().toISOString()
            }
        });
    }

    async unblockActorList(blockUri) {
        const rkey = String(blockUri || '').split('/').pop();
        if (!rkey) throw new Error('Missing block record URI.');
        return await this.agent.com.atproto.repo.deleteRecord({
            repo: this.session.did,
            collection: 'app.bsky.graph.listblock',
            rkey
        });
    }

    async getLabelerServices(dids) {
        if (!dids?.length) return { data: { views: [] } };
        return await this._xrpc('app.bsky.labeler.getServices', { dids });
    }

    labelerDids(preferences) {
        const pref = [...(preferences || [])].reverse().find(p => p.$type === 'app.bsky.actor.defs#labelersPref');
        return (pref?.labelers || []).map(l => l.did).filter(Boolean);
    }

    async getSubscribedLabelerDids() {
        const res = await this.getPreferences();
        return this.labelerDids(res.data.preferences || []);
    }

    async configureSubscribedLabelers() {
        const dids = await this.getSubscribedLabelerDids();
        this.agent.configureLabelers?.(dids);
        return dids;
    }

    async setSubscribedLabelers(dids) {
        const res = await this.getPreferences();
        const uniqueDids = [...new Set((dids || []).filter(Boolean))];
        const preferences = (res.data.preferences || [])
            .filter(p => p.$type !== 'app.bsky.actor.defs#labelersPref');
        preferences.push({
            $type: 'app.bsky.actor.defs#labelersPref',
            labelers: uniqueDids.map(did => ({ did }))
        });
        const result = await this.putPreferences(preferences);
        this.agent.configureLabelers?.(uniqueDids);
        return result;
    }

    async subscribeLabeler(didOrHandle) {
        const did = String(didOrHandle || '').startsWith('did:')
            ? didOrHandle
            : (await this.resolveHandle(String(didOrHandle || '').replace(/^@/, ''))).data.did;
        const dids = await this.getSubscribedLabelerDids();
        if (!dids.includes(did)) dids.push(did);
        await this.setSubscribedLabelers(dids);
        return did;
    }

    async unsubscribeLabeler(did) {
        const dids = (await this.getSubscribedLabelerDids()).filter(item => item !== did);
        return await this.setSubscribedLabelers(dids);
    }

    async getFeedGenerators(uris) {
        if (!uris?.length) return { data: { feeds: [] } };
        return await this._xrpc('app.bsky.feed.getFeedGenerators', { feeds: uris });
    }

    async getSuggestedFeeds(limit = 50) {
        return await this._xrpc('app.bsky.feed.getSuggestedFeeds', { limit });
    }

    async searchFeeds(query, limit = 50) {
        return await this._xrpc('app.bsky.unspecced.getPopularFeedGenerators', { query, limit });
    }

    async resolveHandle(handle) {
        return await this._xrpc('com.atproto.identity.resolveHandle', { handle });
    }

    async getServiceAuth(aud, lxm, exp = Math.floor(Date.now() / 1000) + 1800) {
        return await this._xrpc('com.atproto.server.getServiceAuth', { aud, exp, lxm });
    }

    pdsDid() {
        try {
            const host = new URL(this.pdsUrl).host;
            return `did:web:${host}`;
        } catch {
            return 'did:web:bsky.social';
        }
    }

    async getVideoUploadLimits() {
        const auth = await this.getServiceAuth('did:web:video.bsky.app', 'app.bsky.video.getUploadLimits');
        const res = await fetch('https://video.bsky.app/xrpc/app.bsky.video.getUploadLimits', {
            headers: { Authorization: `Bearer ${auth.data.token}` }
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
        return { data };
    }

    async uploadVideoToBluesky(videoBlob, options = {}) {
        const tokenRes = await this.getServiceAuth(this.pdsDid(), 'com.atproto.repo.uploadBlob');
        const name = options.name || `video_${Date.now()}.mp4`;
        const url = new URL('https://video.bsky.app/xrpc/app.bsky.video.uploadVideo');
        url.searchParams.set('did', this.session.did);
        url.searchParams.set('name', name);

        options.onProgress?.(0.05);
        const uploadRes = await fetch(url.toString(), {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${tokenRes.data.token}`,
                'Content-Type': 'video/mp4'
            },
            body: videoBlob,
            signal: options.signal
        });
        const uploadText = await uploadRes.text();
        let uploadData = {};
        if (uploadText) {
            try { uploadData = JSON.parse(uploadText); }
            catch { uploadData = { message: uploadText }; }
        }
        if (!uploadRes.ok && uploadRes.status !== 409) {
            throw new Error(uploadData.message || uploadData.error || `HTTP ${uploadRes.status}`);
        }

        options.onProgress?.(0.75);
        const initialStatus = uploadData.jobStatus || uploadData;
        if (initialStatus.blob) {
            options.onProgress?.(1);
            return initialStatus.blob;
        }
        if (!initialStatus.jobId) {
            throw new Error(uploadData.message || uploadData.error || 'Video upload did not return a job id.');
        }
        return await this.pollVideoJob(initialStatus.jobId, options);
    }

    async pollVideoJob(jobId, options = {}) {
        const sleep = (ms) => new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, ms);
            if (options.signal) {
                options.signal.addEventListener('abort', () => {
                    clearTimeout(timer);
                    const err = new Error('Aborted');
                    err.name = 'AbortError';
                    reject(err);
                }, { once: true });
            }
        });

        for (let attempt = 0; attempt < 90; attempt++) {
            if (attempt > 0) await sleep(2000);
            if (options.signal?.aborted) {
                const err = new Error('Aborted');
                err.name = 'AbortError';
                throw err;
            }
            options.onProgress?.(0.75 + Math.min(0.23, attempt / 90 * 0.23));
            const url = new URL('https://video.bsky.app/xrpc/app.bsky.video.getJobStatus');
            url.searchParams.set('jobId', jobId);
            const res = await fetch(url.toString(), { signal: options.signal });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);

            const status = data.jobStatus || data;
            if (status.state === 'JOB_STATE_COMPLETED') {
                if (!status.blob) throw new Error('Video job completed without a blob.');
                options.onProgress?.(1);
                return status.blob;
            }
            if (status.state === 'JOB_STATE_FAILED') {
                throw new Error(status.message || status.error || 'Video processing failed.');
            }
        }
        throw new Error('Video processing timed out.');
    }
    
    async getAuthorFeed(actor, limit = 30, cursor = undefined) { 
        const params = { actor, limit };
        if (cursor) params.cursor = cursor;
        return await this.agent.getAuthorFeed(params); 
    }

    async searchActors(query, limit = 30, cursor = undefined) {
        const params = { q: query, limit };
        if (cursor) params.cursor = cursor;
        return await this._xrpc('app.bsky.actor.searchActors', params);
    }

    async getFollows(actor, limit = 50, cursor = undefined) {
        const params = { actor, limit };
        if (cursor) params.cursor = cursor;
        return await this._xrpc('app.bsky.graph.getFollows', params);
    }

    async getFollowers(actor, limit = 50, cursor = undefined) {
        const params = { actor, limit };
        if (cursor) params.cursor = cursor;
        return await this._xrpc('app.bsky.graph.getFollowers', params);
    }
        
    // ─── スレッド ─────────────────────────────────────────────────
    async getPostThread(uri) {
        return await this.agent.getPostThread({ uri, depth: 10, parentHeight: 10 });
    }

    // ─── ポスト取得 ───────────────────────────────────────────────
    async getPosts(uris) { return await this.agent.getPosts({ uris }); }

    // ─── Like ─────────────────────────────────────────────────────
    async like(uri, cid) { return await this.agent.like(uri, cid); }
    async deleteLike(likeUri) { return await this.agent.deleteLike(likeUri); }

    // ─── Repost ───────────────────────────────────────────────────
    async repost(uri, cid) { return await this.agent.repost(uri, cid); }
    async deleteRepost(repostUri) { return await this.agent.deleteRepost(repostUri); }

    // ─── 投稿・削除 ───────────────────────────────────────────────
    async post(postData) { return await this.agent.post(postData); }
    async deletePost(uri) { return await this.agent.deletePost(uri); }

    // ─── Follow ───────────────────────────────────────────────────
    async follow(did) { return await this.agent.follow(did); }
    async deleteFollow(uri) { return await this.agent.deleteFollow(uri); }

    // ─── Mute / Block ─────────────────────────────────────────────
    async mute(did) { return await this.agent.mute(did); }
    async unmute(did) { return await this.agent.unmute(did); }

    // ─── 通知 ─────────────────────────────────────────────────────
    async countUnreadNotifications() { return await this.agent.countUnreadNotifications(); }
    async listNotifications(limit = 30, cursor = undefined) {
        const params = { limit };
        if (cursor) params.cursor = cursor;
        return await this.agent.listNotifications(params);
    }
    async updateSeenNotifications() { return await this.agent.updateSeenNotifications(); }

    // ─── 画像アップロード ─────────────────────────────────────────
    async uploadBlob(uint8array, encoding = 'image/jpeg') {
        return await this.agent.uploadBlob(uint8array, { encoding });
    }

    // ─── Repo操作（pin/unpin） ────────────────────────────────────
    async getRepoRecord(collection, rkey) {
        return await this.agent.com.atproto.repo.getRecord({
            repo: this.session.did,
            collection,
            rkey
        });
    }

    async putRepoRecord(collection, rkey, record) {
        return await this.agent.com.atproto.repo.putRecord({
            repo: this.session.did,
            collection,
            rkey,
            record
        });
    }

    // ─── Mute/Block リスト ────────────────────────────────────────
    async getMutes(limit = 50) { return await this.agent.app.bsky.graph.getMutes({ limit }); }
    async getBlocks(limit = 50) { return await this.agent.app.bsky.graph.getBlocks({ limit }); }

    // ─── 検索 ─────────────────────────────────────────────────────
    async searchPosts(query, limit = 30, cursor = undefined) {
        const params = { q: query, limit };
        if (cursor) params.cursor = cursor;
        return await this.agent.app.bsky.feed.searchPosts(params);
    }

    async reportPost(uri, cid, reasonType, reason = '') {
        const body = {
            reasonType,
            subject: {
                $type: 'com.atproto.repo.strongRef',
                uri,
                cid
            }
        };
        if (String(reason || '').trim()) body.reason = String(reason).trim();
        return await this._xrpc('com.atproto.moderation.createReport', undefined, {
            method: 'POST',
            body
        });
    }

    async reportAccount(did, reasonType, reason = '') {
        const body = {
            reasonType,
            subject: {
                $type: 'com.atproto.admin.defs#repoRef',
                did
            }
        };
        if (String(reason || '').trim()) body.reason = String(reason).trim();
        return await this._xrpc('com.atproto.moderation.createReport', undefined, {
            method: 'POST',
            body
        });
    }
        
    // ─── チャット ─────────────────────────────────────────────────
    getChatAgent() {
        if (!this.chatAgent) this._initChatAgent();
        return this.chatAgent;
    }

    async getConvoAvailability(memberDid) {
        const member = String(memberDid || '').trim();
        if (!member || member === this.session?.did) return { data: { canChat: false, convo: null } };

        const chat = this.getChatAgent();
        const method = chat?.chat?.bsky?.convo?.getConvoAvailability;
        if (typeof method === 'function') {
            try {
                return await method.call(chat.chat.bsky.convo, { members: [member] });
            } catch {}
        }

        const request = async (baseUrl, members, useProxy) => {
            const url = new URL(`${baseUrl.replace(/\/$/, '')}/xrpc/chat.bsky.convo.getConvoAvailability`);
            for (const m of members) url.searchParams.append('members', m);
            const headers = { Authorization: `Bearer ${this.session.accessJwt}` };
            if (useProxy) headers['atproto-proxy'] = 'did:web:api.bsky.chat#bsky_chat';
            const res = await fetch(url.toString(), { headers });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
            return { data };
        };

        try {
            return await request(this.pdsUrl, [member], true);
        } catch {
            return await request('https://api.bsky.chat', [this.session.did, member], false);
        }
    }
}

module.exports = BskyAPI;
