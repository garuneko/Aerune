// actions.js
// ポストへの各種アクション（like/repost/delete/bookmark/follow/mute/block/pin）

class AppActions {
    /**
     * @param {BskyAPI} api
     * @param {Function} t - 翻訳関数
     * @param {object} refresh - { timeline, bookmarks, current, profile }
     * @param {object} ipcRenderer
     * @param {object} nav - Navigation インスタンス
     */
    constructor(api, t, refresh, ipcRenderer, nav) {
        this.api = api;
        this.t = t;
        this.refresh = refresh;
        this.ipc = ipcRenderer;
        this.nav = nav;
    }

    // ─── Like ────────────────────────────────────────────────────
    async doLike(uri, cid, likeUri) {
        try {
            if (likeUri && likeUri !== 'null') await this.api.deleteLike(likeUri);
            else await this.api.like(uri, cid);
            this.refresh.current();
        } catch (e) { console.error('doLike:', e); }
    }

    // ─── Repost ──────────────────────────────────────────────────
    async doRepost(uri, cid, repostUri) {
        try {
            if (repostUri && repostUri !== 'null') await this.api.deleteRepost(repostUri);
            else await this.api.repost(uri, cid);
            this.refresh.current();
        } catch (e) { console.error('doRepost:', e); }
    }

    // ─── Delete ──────────────────────────────────────────────────
    async deletePost(uri) {
        if (!confirm(this.t('delete_confirm'))) return;
        try {
            await this.api.deletePost(uri);
            this.refresh.current();
        } catch (e) { alert(this.t('delete_failed')); }
    }

    // ─── Bookmark ─────────────────────────────────────────────────
    async toggleBookmark(post) {
        try {
            const isBookmarked = window.aeruneBookmarks.has(post.uri) || !!(post.viewer && post.viewer.bookmark);

            if (isBookmarked) {
                const res = await fetch(`${this.api.pdsUrl}/xrpc/app.bsky.bookmark.deleteBookmark`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.api.session.accessJwt}`
                    },
                    body: JSON.stringify({ uri: post.uri })
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                window.aeruneBookmarks.delete(post.uri);
                if (post.viewer) delete post.viewer.bookmark;
                alert(this.t('action_success'));
                // ブックマーク画面なら再描画
                if (this.nav && this.nav.current?.type === 'bookmarks') {
                    this.refresh.bookmarks();
                } else {
                    this.refresh.current();
                }
            } else {
                const res = await fetch(`${this.api.pdsUrl}/xrpc/app.bsky.bookmark.createBookmark`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.api.session.accessJwt}`
                    },
                    body: JSON.stringify({ uri: post.uri, cid: post.cid })
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                window.aeruneBookmarks.add(post.uri);
                if (!post.viewer) post.viewer = {};
                post.viewer.bookmark = 'bookmarked';
                alert(this.t('action_success'));
            }
        } catch (e) {
            console.error('toggleBookmark:', e);
            alert(`${this.t('bookmark_failed')}\nReason: ${e.message || String(e)}`);
        }
    }

    // ─── Follow / Unfollow ───────────────────────────────────────
    async toggleFollow(did, followingUri) {
        try {
            if (followingUri && followingUri !== 'undefined' && followingUri !== '') {
                await this.api.deleteFollow(followingUri);
            } else {
                await this.api.follow(did);
            }
            alert(this.t('action_success'));
            // プロフィール画面なら再描画
            if (this.nav && this.nav.current?.type === 'profile') {
                window.loadProfile(this.nav.current.actor, true);
            } else {
                this.refresh.current();
            }
        } catch (e) { alert('Failed: ' + e.message); }
    }

    // ─── Mute / Unmute ───────────────────────────────────────────
    async toggleMute(did, isMuted) {
        try {
            if (isMuted && isMuted !== 'false' && isMuted !== 'undefined' && isMuted !== '') {
                await this.api.unmute(did);
            } else {
                await this.api.mute(did);
            }
            alert(this.t('action_success'));
        } catch (e) { alert('Failed: ' + e.message); }
    }

    // ─── Block / Unblock ─────────────────────────────────────────
    async toggleBlock(did, blockingUri) {
        try {
            if (blockingUri && blockingUri !== 'undefined' && blockingUri !== '') {
                // ブロック解除: record削除
                const rkey = blockingUri.split('/').pop();
                await this.api.agent.com.atproto.repo.deleteRecord({
                    repo: this.api.session.did,
                    collection: 'app.bsky.graph.block',
                    rkey
                });
            } else {
                // ブロック
                await this.api.agent.app.bsky.graph.block.create(
                    { repo: this.api.session.did },
                    { subject: did, createdAt: new Date().toISOString() }
                );
            }
            alert(this.t('action_success'));
        } catch (e) { alert('Failed: ' + e.message); }
    }

    // ─── Pin / Unpin ─────────────────────────────────────────────
    async togglePin(post) {
        try {
            const res = await this.api.getRepoRecord('app.bsky.actor.profile', 'self');
            const record = res.data.value;
            if (record.pinnedPost && record.pinnedPost.uri === post.uri) {
                delete record.pinnedPost;
            } else {
                record.pinnedPost = { uri: post.uri, cid: post.cid };
            }
            await this.api.putRepoRecord('app.bsky.actor.profile', 'self', record);
            alert(this.t('action_success'));
            // 自分のプロフィール画面なら再描画
            if (this.nav && this.nav.current?.type === 'profile') {
                window.loadProfile(this.api.session.handle, true);
            }
        } catch (e) { alert('Failed to pin/unpin: ' + e.message); }
    }

    // ─── Logout ──────────────────────────────────────────────────
    async logout(currentDid, savedAccounts, onEmpty, onSwitch) {
        if (!confirm(this.t('logout_confirm'))) return;
        const newAccounts = savedAccounts.filter(acc => acc.did !== currentDid);
        await this.ipc.invoke('save-session', newAccounts);
        if (newAccounts.length > 0) {
            onSwitch(newAccounts[0].did, newAccounts);
        } else {
            onEmpty();
        }
    }

    // ─── ミュートリスト表示 ───────────────────────────────────────
    async showMutes(t) {
        window.showListModal(t('settings_mutes'), async () => {
            const res = await this.api.getMutes();
            return res.data.mutes;
        }, 'Mute');
    }

    // ─── ブロックリスト表示 ───────────────────────────────────────
    async showBlocks(t) {
        window.showListModal(t('settings_blocks'), async () => {
            const res = await this.api.getBlocks();
            return res.data.blocks;
        }, 'Block');
    }
}

module.exports = AppActions;
