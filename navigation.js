// navigation.js (v2.0.2)
class Navigation {
    constructor() {
        this.stack = [];
        this.current = null;
    }

    /**
     * 新しい状態を履歴に追加。
     * scrollContainer を渡すと現在のスクロール位置を current に保存してからスタックへ積む。
     * @param {object} state
     * @param {Element|null} scrollContainer
     */
    push(state, scrollContainer = null) {
        if (this.current && JSON.stringify(this.current) !== JSON.stringify(state)) {
            const entry = { ...this.current };
            if (scrollContainer) {
                entry._scrollTop = scrollContainer.scrollTop;
            }
            this.stack.push(entry);
        }
        this.current = state;
    }

    /**
     * 前の状態を取り出す。
     * 戻り値に _scrollTop が含まれる場合がある（呼び出し側で復元すること）。
     * @returns {object|null}
     */
    pop() {
        if (this.stack.length === 0) return null;
        const prev = this.stack.pop();
        // _scrollTop は復元用の内部値。current には残さない
        const { _scrollTop, ...cleanState } = prev;
        this.current = cleanState;
        // ただし呼び出し側でスクロール復元できるよう _scrollTop を含めて返す
        return prev;
    }

    /** 戻れる状態があるか */
    get canGoBack() {
        return this.stack.length > 0;
    }

    /** スタックを完全にリセット（ログアウト等） */
    reset() {
        this.stack = [];
        this.current = null;
    }
}

module.exports = Navigation;
