const REACTION_REASON_MAP = Object.freeze({
    like: 'like',
    'like-via-repost': 'like',
    repost: 'repost',
    'repost-via-repost': 'repost'
});

function canonicalReactionReason(reason = '') {
    return REACTION_REASON_MAP[String(reason)] || '';
}

function notificationGroupKey(notification) {
    const reason = canonicalReactionReason(notification?.reason);
    const subject = String(notification?.reasonSubject || '');
    return reason && subject ? `${reason}:${subject}` : '';
}

function groupNotificationsForDisplay(notifications, getId = () => '') {
    const items = [];
    const grouped = new Map();
    for (const notification of Array.isArray(notifications) ? notifications : []) {
        const key = notificationGroupKey(notification);
        if (!key) {
            items.push({ id: getId(notification), reason: notification?.reason || '', notifications: [notification] });
            continue;
        }
        if (!grouped.has(key)) {
            const item = { id: key, reason: canonicalReactionReason(notification.reason), notifications: [] };
            grouped.set(key, item);
            items.push(item);
        }
        grouped.get(key).notifications.push(notification);
    }
    return items;
}

function threadConnectionFlags(items) {
    const list = Array.isArray(items) ? items : [];
    return list.map((item, index) => {
        const post = item?.post || item;
        const previous = list[index - 1]?.post || list[index - 1];
        const nextItem = list[index + 1];
        const nextPost = nextItem?.post || nextItem;
        return {
            connectsToPrevious: !!previous?.uri && item?.reply?.parent?.uri === previous.uri,
            connectsToNext: !!post?.uri && nextItem?.reply?.parent?.uri === post.uri && !!nextPost?.uri
        };
    });
}

module.exports = {
    canonicalReactionReason,
    notificationGroupKey,
    groupNotificationsForDisplay,
    threadConnectionFlags
};
