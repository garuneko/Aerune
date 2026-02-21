// navigation.js
class Navigation {
    constructor() {
        this.stack = [];
        this.current = null;
    }

    /**
     * 新しい状態を履歴に追加
     */
    push(state) {
        // 現在の状態があり、かつ新しい状態と異なる場合のみスタックに保存
        if (this.current && JSON.stringify(this.current) !== JSON.stringify(state)) {
            this.stack.push(this.current);
        }
        this.current = state;
    }

    /**
     * 前の状態を取り出す
     */
    pop() {
        if (this.stack.length > 0) {
            this.current = this.stack.pop();
            return this.current;
        }
        return null;
    }

    /**
     * 戻れる状態があるか
     */
    get canGoBack() {
        return this.stack.length > 0;
    }
}

module.exports = Navigation;