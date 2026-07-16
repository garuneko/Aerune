const test = require('node:test');
const assert = require('node:assert/strict');
const {
    canonicalReactionReason,
    groupNotificationsForDisplay,
    threadConnectionFlags
} = require('../display-utils.js');

test('canonicalReactionReason folds via-repost variants into their visible action', () => {
    assert.equal(canonicalReactionReason('like-via-repost'), 'like');
    assert.equal(canonicalReactionReason('repost-via-repost'), 'repost');
    assert.equal(canonicalReactionReason('follow'), '');
});

test('groupNotificationsForDisplay groups matching reactions without reordering rows', () => {
    const notifications = [
        { id: 'a', reason: 'like', reasonSubject: 'at://post/1' },
        { id: 'b', reason: 'follow' },
        { id: 'c', reason: 'like-via-repost', reasonSubject: 'at://post/1' },
        { id: 'd', reason: 'repost', reasonSubject: 'at://post/1' }
    ];
    const groups = groupNotificationsForDisplay(notifications, item => item.id);
    assert.deepEqual(groups.map(group => [group.reason, group.notifications.map(item => item.id)]), [
        ['like', ['a', 'c']],
        ['follow', ['b']],
        ['repost', ['d']]
    ]);
});

test('threadConnectionFlags identifies both sides of adjacent parent-child chains', () => {
    const items = [
        { post: { uri: 'root' } },
        { post: { uri: 'reply-1' }, reply: { parent: { uri: 'root' } } },
        { post: { uri: 'reply-2' }, reply: { parent: { uri: 'reply-1' } } },
        { post: { uri: 'other' } }
    ];
    assert.deepEqual(threadConnectionFlags(items), [
        { connectsToPrevious: false, connectsToNext: true },
        { connectsToPrevious: true, connectsToNext: true },
        { connectsToPrevious: true, connectsToNext: false },
        { connectsToPrevious: false, connectsToNext: false }
    ]);
});
