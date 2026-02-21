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

    // ─── プロフィール ─────────────────────────────────────────────
    async getProfile(actor) { return await this.agent.getProfile({ actor }); }

    // ─── タイムライン / フィード ──────────────────────────────────
    async getTimeline(limit = 30) { return await this.agent.getTimeline({ limit }); }
    async getAuthorFeed(actor, limit = 30) { return await this.agent.getAuthorFeed({ actor, limit }); }

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
    async listNotifications(limit = 30) { return await this.agent.listNotifications({ limit }); }
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
    async searchPosts(query, limit = 30) {
        return await this.agent.app.bsky.feed.searchPosts({ q: query, limit });
    }

    // ─── チャット ─────────────────────────────────────────────────
    getChatAgent() {
        if (!this.chatAgent) this._initChatAgent();
        return this.chatAgent;
    }
}

module.exports = BskyAPI;
