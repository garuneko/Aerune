// renderer.js 
// Aerune メインエントリーポイント

const { clipboard, ipcRenderer, shell, webUtils } = require('electron');
const nodeFs = require('fs');
const nodeOs = require('os');
const nodePath = require('path');
const { RichText } = require('@atproto/api');
const { hasSelection, compressImage, downloadImage, linkify, renderRichText, escHTML, escAttr } = require('./utils.js');
const Navigation = require('./navigation.js');
const BskyAPI = require('./bsky-api.js');
const { ICON_CACHE, translations } = require('./constants.js');
const { createPostElement, renderPosts, getPost: getStoredPost, getQuote: getStoredQuote, getImageSet, clearStores, formatRelative } = require('./post-renderer.js');
const AppActions = require('./actions.js');
const ViewLoader = require('./view-loader.js');
const appPackage = require('./package.json');

// ─── グローバル状態 ───────────────────────────────────────────────
const api = new BskyAPI();
const nav = new Navigation();
const els = {};
let savedAccounts = [], currentDid = null;
let selectedImages = [], replyTarget = null, quoteTarget = null;
let selectedVideo = null, isPosting = false, postAbortController = null;
let autoQuoteUrl = null, quoteResolveTimer = null, draftSaveTimer = null;
let activeCompressionJobId = null;
let currentConvoId = null;
const searchState = {
    mode: 'posts',
    query: '',
    postCursor: null,
    actorCursor: null,
    loading: false,
    requestId: 0,
    debounceTimer: null,
    lastKey: '',
    pending: false
};
const chatState = {
    convoCursor: null,
    convoLoading: false,
    convoExhausted: false,
    messageCursorByConvoId: new Map(),
    messageLoadingByConvoId: new Set(),
    messageExhaustedByConvoId: new Set()
};
let notifTimer = null;
let imageModalState = { urls: [], index: 0 };
let reportDialogFinish = null;
window.aeruneBookmarks = new Set();

const feedState = {
    preferences: [],
    savedFeeds: [],
    suggestedFeeds: [],
    searchResults: [],
    searchQuery: '',
    selectedFeed: null,
    selectedLocalList: false,
    configuredDid: null,
    isLoading: false,
    errorMessage: ''
};

// ─── 設定 ─────────────────────────────────────────────────────────
const RTL_LANGS = new Set(['ar']);
const normalizeLanguage = (lang = '') => {
    const value = String(lang || '').replace('_', '-').toLowerCase();
    if (value.startsWith('ja')) return 'ja';
    if (value.startsWith('ar')) return 'ar';
    if (value === 'pt-br' || value.startsWith('pt')) return 'pt-BR';
    return 'en';
};
const clampFontSizeLevel = (value) => {
    const n = Number(value);
    return [-1, 0, 1, 2].includes(n) ? n : 0;
};
let currentLang = normalizeLanguage(localStorage.getItem('aerune_lang') || navigator.language);
let nsfwBlur = localStorage.getItem('aerune_nsfw_blur') !== 'false';
let showBookmarksConfig = localStorage.getItem('aerune_show_bookmarks') !== 'false';
let autoRefreshEnabled = localStorage.getItem('aerune_auto_refresh') !== 'false';
let restoreScrollEnabled = localStorage.getItem('aerune_restore_scroll') !== 'false';
let fontSizeLevel = clampFontSizeLevel(localStorage.getItem('aerune_font_size_level'));
let currentMuteWords = [];
let currentMuteRules = [];
window.aeruneTimeFormat = localStorage.getItem('aerune_time_format') || 'relative';
window.aeruneImageDisplayStyle = localStorage.getItem('aerune_image_display_style') || 'carousel';

const timelineState = {
    pollTimer: null,
    isChecking: false,
    hasNew: false,
    sourceKey: 'home',
    lastManualRefreshAt: 0,
    checkIntervalMs: 30000,
    manualRefreshCooldownMs: 30000
};
const VIDEO_UPLOAD_MAX_BYTES = 100000000;
const VIDEO_COMPRESSION_TARGET_BYTES = 95000000;

// ─── i18n ────────────────────────────────────────────────────────
const t = (key, ...args) => {
    let text = translations[currentLang]?.[key] ?? translations.en?.[key] ?? key;
    for (let i = 0; i < args.length; i++) text = text.replace(`{${i}}`, args[i]);
    return text;
};

function applyLanguageDirection() {
    const isRTL = RTL_LANGS.has(currentLang);
    document.documentElement.lang = currentLang;
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
    document.body?.classList.toggle('rtl', isRTL);
}

function applyFontSizeLevel() {
    fontSizeLevel = clampFontSizeLevel(fontSizeLevel);
    const offset = fontSizeLevel === -1 ? -2 : fontSizeLevel === 1 ? 2 : fontSizeLevel === 2 ? 4 : 0;
    document.documentElement.style.setProperty('--aerune-font-offset', `${offset}px`);
    document.body?.setAttribute('data-font-size', String(fontSizeLevel));
}

function applyDisplayPreferences() {
    applyLanguageDirection();
    applyFontSizeLevel();
}

// ─── アイコン (事前キャッシュ済みHTML文字列を返すだけ) ────────────
const getIcon = (key) => ICON_CACHE[key] || '';

const getRenderContext = () => ({
    api, t, getIcon, nsfwBlur,
    lang: currentLang,
    aeruneBookmarks: window.aeruneBookmarks,
    timeFormat: window.aeruneTimeFormat || 'relative',
    imageDisplayStyle: window.aeruneImageDisplayStyle || 'carousel',
    restoreScrollEnabled,
    muteWords: currentMuteWords,
    muteRules: currentMuteRules,
    shouldMutePost,
    isLocalListMember,
    setNotificationBadge,
    rememberNotificationIds,
    showToast,
});

// ─── TL基盤状態 ──────────────────────────────────────────────────
const accountKey = (prefix) => `${prefix}_${currentDid || api.session?.did || 'anon'}`;
const muteWordsKey = () => accountKey('aerune_mute_words');
const muteRulesKey = () => accountKey('aerune_mute_rules');
const LOCAL_LIST_SOURCE_VALUE = '__aerune_local_list__';
const timelineSourceKey = () => feedState.selectedLocalList ? 'local-list' : (feedState.selectedFeed?.value ? `feed:${feedState.selectedFeed.value}` : 'home');
const localListKey = () => accountKey('aerune_local_list_members');
const notificationUnreadKey = () => accountKey('aerune_notif_unread_count');
const recentNotificationIdsKey = () => accountKey('aerune_recent_notification_ids');

function normalizeLocalListMember(member) {
    if (!member || typeof member !== 'object' || !member.did) return null;
    return {
        did: String(member.did),
        handle: String(member.handle || ''),
        displayName: String(member.displayName || ''),
        avatar: String(member.avatar || ''),
        addedAt: member.addedAt || new Date().toISOString()
    };
}

function normalizeLocalListMembers(members) {
    const seen = new Set();
    const normalized = [];
    for (const member of Array.isArray(members) ? members : []) {
        const item = normalizeLocalListMember(member);
        if (!item || seen.has(item.did)) continue;
        seen.add(item.did);
        normalized.push(item);
    }
    return normalized;
}

function readLocalListMembers() {
    try {
        const raw = localStorage.getItem(localListKey());
        const members = raw ? JSON.parse(raw) : [];
        return normalizeLocalListMembers(members);
    } catch {
        return [];
    }
}

function saveLocalListMembers(members) {
    localStorage.setItem(localListKey(), JSON.stringify(normalizeLocalListMembers(members)));
}

function isLocalListMember(did) {
    if (!did) return false;
    return readLocalListMembers().some(member => member.did === did);
}

function toggleLocalListMember(actor) {
    if (!actor?.did) return false;
    const members = readLocalListMembers();
    const idx = members.findIndex(member => member.did === actor.did);
    if (idx >= 0) {
        members.splice(idx, 1);
        saveLocalListMembers(members);
        syncLocalListButtons(actor.did, false);
        renderLocalListSettings();
        renderFeedControls();
        refreshLocalListTimelineIfActive();
        showToast(t('locallist_title'), t('locallist_removed'));
        return false;
    }
    members.push({
        did: actor.did,
        handle: actor.handle || '',
        displayName: actor.displayName || '',
        avatar: actor.avatar || '',
        addedAt: new Date().toISOString()
    });
    saveLocalListMembers(members);
    syncLocalListButtons(actor.did, true);
    renderLocalListSettings();
    renderFeedControls();
    refreshLocalListTimelineIfActive();
    showToast(t('locallist_title'), t('locallist_added'));
    return true;
}

function removeLocalListMember(did) {
    if (!did) return;
    const next = readLocalListMembers().filter(member => member.did !== did);
    saveLocalListMembers(next);
    syncLocalListButtons(did, false);
    renderLocalListSettings();
    renderFeedControls();
    refreshLocalListTimelineIfActive();
    showToast(t('locallist_title'), t('locallist_removed'));
}

function syncLocalListButtons(did, isMember = isLocalListMember(did)) {
    if (!did) return;
    document.querySelectorAll(`[data-act="local-list-toggle"][data-did="${CSS.escape(did)}"]`).forEach(btn => {
        btn.classList.toggle('is-member', isMember);
        btn.textContent = isMember ? t('locallist_remove') : t('locallist_add_member');
    });
}

function currentTimelineSource() {
    if (feedState.selectedLocalList) {
        return {
            kind: 'local-list',
            value: LOCAL_LIST_SOURCE_VALUE,
            displayName: t('locallist_title'),
            members: readLocalListMembers()
        };
    }
    return feedState.selectedFeed;
}

function localListImportItem(item) {
    if (typeof item === 'string') return { did: item };
    if (item?.did) return item;
    if (item?.subject?.did) return item.subject;
    if (item?.actor?.did) return item.actor;
    return null;
}

function parseLocalListImport(text) {
    const data = JSON.parse(text);
    const rawItems = Array.isArray(data)
        ? data
        : (Array.isArray(data?.members) ? data.members
            : (Array.isArray(data?.items) ? data.items
                : (Array.isArray(data?.localList) ? data.localList : [])));
    return normalizeLocalListMembers(rawItems.map(localListImportItem));
}

function exportLocalList() {
    const members = readLocalListMembers();
    const payload = {
        schema: 'aerune.localList.v1',
        exportedAt: new Date().toISOString(),
        accountDid: currentDid || api.session?.did || null,
        members
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aerune-local-list-${date}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(t('locallist_title'), t('locallist_exported'));
}

async function importLocalListFile(file) {
    if (!file) return;
    try {
        const incoming = parseLocalListImport(await file.text());
        if (!incoming.length) throw new Error(t('locallist_import_invalid'));
        const byDid = new Map(readLocalListMembers().map(member => [member.did, member]));
        for (const member of incoming) {
            const existing = byDid.get(member.did) || {};
            byDid.set(member.did, {
                ...existing,
                ...member,
                addedAt: existing.addedAt || member.addedAt || new Date().toISOString()
            });
        }
        saveLocalListMembers([...byDid.values()]);
        renderLocalListSettings();
        renderFeedControls();
        for (const member of incoming) syncLocalListButtons(member.did, true);
        refreshLocalListTimelineIfActive();
        showToast(t('locallist_title'), t('locallist_imported', String(incoming.length)));
    } catch (e) {
        alert(`${t('locallist_import_failed')}\n${e.message || e}`);
    }
}

function setNotificationBadge(count) {
    const safeCount = Math.max(0, Number(count) || 0);
    try { localStorage.setItem(notificationUnreadKey(), String(safeCount)); } catch {}
    if (!els.notifBadge) return;
    els.notifBadge.textContent = safeCount > 99 ? '99+' : (safeCount > 0 ? String(safeCount) : '');
    els.notifBadge.classList.toggle('hidden', safeCount === 0);
}

function readRecentNotificationIds() {
    try {
        const raw = localStorage.getItem(recentNotificationIdsKey());
        const ids = raw ? JSON.parse(raw) : [];
        return Array.isArray(ids) ? ids.filter(Boolean).map(String) : [];
    } catch {
        return [];
    }
}

function notificationFingerprint(n) {
    if (viewLoader?.notificationId) return viewLoader.notificationId(n);
    return [n?.uri, n?.cid, n?.indexedAt, n?.author?.did, n?.reason, n?.reasonSubject].filter(Boolean).join('|');
}

function rememberNotificationIds(ids) {
    const merged = [];
    const seen = new Set();
    for (const id of ids || []) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        merged.push(id);
        if (merged.length >= 80) break;
    }
    try { localStorage.setItem(recentNotificationIdsKey(), JSON.stringify(merged)); } catch {}
}

function showToast(title, body = '') {
    let toast = document.getElementById('app-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'app-toast';
        document.body.appendChild(toast);
    }
    toast.innerHTML = `<strong>${escHTML(title)}</strong>${body ? `<span>${escHTML(body)}</span>` : ''}`;
    toast.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.classList.remove('show'), 4200);
}

function parseMuteWords(raw) {
    const seen = new Set();
    return String(raw || '')
        .split(/[\n,]/)
        .map(word => word.trim())
        .filter(word => word && !seen.has(word.toLowerCase()) && seen.add(word.toLowerCase()));
}

function normalizeMuteRule(rule) {
    const value = String(rule?.value || '').trim();
    if (!value) return null;
    const targets = Array.isArray(rule.targets) && rule.targets.length ? rule.targets : ['content'];
    const actorTarget = rule.actorTarget === 'exclude-following' ? 'exclude-following' : 'all';
    const expiresAt = rule.expiresAt || null;
    return { value, targets: [...new Set(targets)], actorTarget, expiresAt };
}

function ruleIsExpired(rule) {
    return !!rule.expiresAt && Date.parse(rule.expiresAt) <= Date.now();
}

function legacyWordsToRules(words) {
    return words.map(value => ({ value, targets: ['content'], actorTarget: 'all', expiresAt: null }));
}

function readMuteRules() {
    try {
        const raw = localStorage.getItem(muteRulesKey());
        const rules = raw ? JSON.parse(raw) : [];
        return Array.isArray(rules) ? rules.map(normalizeMuteRule).filter(Boolean).filter(rule => !ruleIsExpired(rule)) : [];
    } catch {
        return [];
    }
}

function writeMuteRules(rules) {
    const active = rules.map(normalizeMuteRule).filter(Boolean).filter(rule => !ruleIsExpired(rule));
    currentMuteRules = active;
    currentMuteWords = active
        .filter(rule => rule.targets.includes('content'))
        .map(rule => rule.value);
    localStorage.setItem(muteRulesKey(), JSON.stringify(active));
    localStorage.setItem(muteWordsKey(), currentMuteWords.join('\n'));
    renderMuteRulesList();
}

function postTextParts(post) {
    return [
        post?.record?.text,
        post?.value?.text,
        post?.embed?.record?.record?.value?.text,
        post?.embed?.record?.record?.record?.text,
        post?.embed?.record?.record?.value?.record?.text
    ].filter(Boolean);
}

function postTags(post) {
    const tags = new Set();
    const text = post?.record?.text || post?.value?.text || '';
    for (const match of text.matchAll(/(^|\s)#([^\s#]+)/g)) {
        tags.add(String(match[2] || '').toLowerCase());
    }
    for (const facet of (post?.record?.facets || post?.value?.facets || [])) {
        for (const feature of (facet.features || [])) {
            if (feature.$type === 'app.bsky.richtext.facet#tag' && feature.tag) {
                tags.add(String(feature.tag).toLowerCase());
            }
        }
    }
    return tags;
}

function shouldMutePost(post) {
    const active = currentMuteRules.filter(rule => !ruleIsExpired(rule));
    if (!active.length || !post) return false;
    const text = postTextParts(post).join('\n').toLowerCase();
    const tags = postTags(post);
    const authorIsFollowing = !!post.author?.viewer?.following;
    for (const rule of active) {
        if (rule.actorTarget === 'exclude-following' && authorIsFollowing) continue;
        const value = String(rule.value || '').toLowerCase();
        if (rule.targets.includes('content') && value && text.includes(value)) return true;
        if (rule.targets.includes('tag')) {
            const tag = value.startsWith('#') ? value.slice(1) : value;
            if (tag && tags.has(tag)) return true;
        }
    }
    return false;
}

function loadMuteWords() {
    const legacy = parseMuteWords(localStorage.getItem(muteWordsKey()) || '');
    currentMuteRules = readMuteRules();
    if (!currentMuteRules.length && legacy.length) {
        currentMuteRules = legacyWordsToRules(legacy);
        localStorage.setItem(muteRulesKey(), JSON.stringify(currentMuteRules));
    }
    currentMuteWords = currentMuteRules.filter(rule => rule.targets.includes('content')).map(rule => rule.value);
    const input = document.getElementById('setting-mute-words');
    if (input) input.value = currentMuteWords.join('\n');
    renderMuteRulesList();
}

function saveMuteWordsFromSettings() {
    const input = document.getElementById('setting-mute-words');
    if (!input) return;
    const simpleRules = legacyWordsToRules(parseMuteWords(input.value));
    const advanced = currentMuteRules.filter(rule => (
        rule.expiresAt ||
        rule.actorTarget !== 'all' ||
        rule.targets.includes('tag') ||
        !rule.targets.includes('content')
    ));
    writeMuteRules([...simpleRules, ...advanced]);
    input.value = currentMuteWords.join('\n');
    syncMuteRulesToServer().catch(e => console.warn('syncMuteRulesToServer:', e));
}

async function syncMuteRulesFromServer() {
    try {
        const remote = await api.getMutedWords();
        if (Array.isArray(remote) && remote.length) {
            writeMuteRules(remote);
            return;
        }
    } catch (e) {
        console.warn('syncMuteRulesFromServer:', e);
    }
    loadMuteWords();
}

async function syncMuteRulesToServer() {
    if (!api.session) return;
    await api.putMutedWords(currentMuteRules.filter(rule => !ruleIsExpired(rule)));
}

function muteRuleExpiryLabel(rule) {
    if (!rule.expiresAt) return t('mute_rule_never');
    const ms = Date.parse(rule.expiresAt) - Date.now();
    if (ms <= 0) return t('mute_rule_expired');
    const days = Math.ceil(ms / 86400000);
    if (days <= 1) return t('mute_rule_24h');
    if (days <= 7) return t('mute_rule_7d');
    return t('mute_rule_30d');
}

function muteRuleTargetLabel(rule) {
    const hasContent = rule.targets.includes('content');
    const hasTag = rule.targets.includes('tag');
    if (hasContent && hasTag) return `${t('mute_rule_content')} + ${t('mute_rule_tag')}`;
    if (hasTag) return t('mute_rule_tag');
    return t('mute_rule_content');
}

function renderMuteRulesList() {
    const list = document.getElementById('mute-rules-list');
    if (!list) return;
    const active = currentMuteRules.filter(rule => !ruleIsExpired(rule));
    if (!active.length) {
        list.innerHTML = `<div class="mod-status">${escHTML(t('mute_rules_empty'))}</div>`;
        return;
    }
    list.innerHTML = active.map((rule, index) =>
        `<div class="mod-rule-row">` +
        `<div class="mod-rule-main">` +
        `<strong>${escHTML(rule.value)}</strong>` +
        `<span>${escHTML(muteRuleTargetLabel(rule))} · ${escHTML(muteRuleExpiryLabel(rule))}${rule.actorTarget === 'exclude-following' ? ` · ${escHTML(t('mute_rule_exclude_following'))}` : ''}</span>` +
        `</div>` +
        `<button type="button" data-act="mute-rule-remove" data-index="${index}">${escHTML(t('feeds_remove'))}</button>` +
        `</div>`
    ).join('');
}

function addMuteRuleFromSettings() {
    const value = document.getElementById('mute-rule-value')?.value.trim();
    if (!value) return;
    const target = document.getElementById('mute-rule-target')?.value || 'content';
    const expiry = document.getElementById('mute-rule-expiry')?.value || 'never';
    const excludeFollowing = !!document.getElementById('mute-rule-exclude-following')?.checked;
    const expiresAt = expiry === 'never' ? null : new Date(Date.now() + (
        expiry === '24h' ? 86400000 :
        expiry === '7d' ? 7 * 86400000 :
        30 * 86400000
    )).toISOString();
    const targets = target === 'both' ? ['content', 'tag'] : [target];
    const next = currentMuteRules.filter(rule => !(rule.value.toLowerCase() === value.toLowerCase() && rule.targets.join('|') === targets.join('|')));
    next.push({ value, targets, actorTarget: excludeFollowing ? 'exclude-following' : 'all', expiresAt });
    writeMuteRules(next);
    document.getElementById('mute-rule-value').value = '';
    syncMuteRulesToServer().then(() => showToast(t('settings_moderation'), t('settings_saved'))).catch(e => alert(e.message || e));
}

function removeMuteRuleAt(index) {
    const active = currentMuteRules.filter(rule => !ruleIsExpired(rule));
    active.splice(index, 1);
    writeMuteRules(active);
    syncMuteRulesToServer().catch(e => alert(e.message || e));
}

function resetTimelineNotice() {
    timelineState.hasNew = false;
    timelineState.sourceKey = timelineSourceKey();
    renderTimelineNotice();
}

function renderTimelineNotice() {
    const notice = els.timelineNotice;
    if (!notice) return;
    const shouldShow = timelineState.hasNew &&
        timelineState.sourceKey === timelineSourceKey() &&
        els.timelineDiv &&
        !els.timelineDiv.classList.contains('hidden');
    notice.classList.toggle('hidden', !shouldShow);
    if (!shouldShow) {
        notice.textContent = '';
        return;
    }
    notice.innerHTML =
        `<button data-act="timeline-show-new">` +
        `${escHTML(t('timeline_new_posts'))}` +
        `</button>`;
}

function markTimelineManualRefresh() {
    timelineState.lastManualRefreshAt = Date.now();
    resetTimelineNotice();
}

async function refreshCurrentTimeline(options = {}) {
    markTimelineManualRefresh();
    await viewLoader.fetchTimeline(false, { skipCache: true, scrollToTop: !!options.scrollToTop });
}

async function checkTimelineUpdates() {
    if (!autoRefreshEnabled) return;
    if (!api.session || !viewLoader || timelineState.isChecking) return;
    if (viewLoader.isLoading) return;
    if (!els.timelineDiv || els.timelineDiv.classList.contains('hidden')) return;
    if (Date.now() - timelineState.lastManualRefreshAt < timelineState.manualRefreshCooldownMs) return;

    const sourceKey = timelineSourceKey();
    timelineState.isChecking = true;
    try {
        const hasNew = await viewLoader.hasNewTimelineItems();
        if (sourceKey !== timelineSourceKey()) return;
        timelineState.hasNew = hasNew;
        timelineState.sourceKey = sourceKey;
        renderTimelineNotice();
    } finally {
        timelineState.isChecking = false;
    }
}

function startTimelinePolling() {
    stopTimelinePolling();
    if (!api.session || !autoRefreshEnabled) return;
    timelineState.pollTimer = setInterval(checkTimelineUpdates, timelineState.checkIntervalMs);
}

function stopTimelinePolling() {
    if (timelineState.pollTimer) clearInterval(timelineState.pollTimer);
    timelineState.pollTimer = null;
}

// ─── 投稿下書き・動画 ────────────────────────────────────────────
const postDraftKey = () => accountKey('aerune_post_draft');

function openDraftDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('aerune_drafts', 1);
        req.onupgradeneeded = () => {
            req.result.createObjectStore('drafts');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function draftStore(mode = 'readonly') {
    const db = await openDraftDB();
    return db.transaction('drafts', mode).objectStore('drafts');
}

async function getDraft() {
    const store = await draftStore();
    return await new Promise((resolve, reject) => {
        const req = store.get(postDraftKey());
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

async function putDraft(draft) {
    const store = await draftStore('readwrite');
    return await new Promise((resolve, reject) => {
        const req = store.put(draft, postDraftKey());
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

async function deleteDraft() {
    localStorage.removeItem('aerune_draft_text');
    try {
        const store = await draftStore('readwrite');
        await new Promise((resolve, reject) => {
            const req = store.delete(postDraftKey());
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.warn('deleteDraft:', e);
    }
}

function scheduleDraftSave() {
    if (!currentDid) return;
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => {
        saveDraftNow().catch(e => console.warn('saveDraftNow:', e));
    }, 700);
}

async function saveDraftNow() {
    if (!currentDid) return;
    const text = els.postInput?.value || '';
    const hasContent = text.trim() || selectedImages.length || selectedVideo || quoteTarget;
    if (!hasContent) {
        await deleteDraft();
        return;
    }
    const draft = {
        text,
        quoteTarget,
        autoQuoteUrl,
        images: selectedImages.map(img => ({
            blob: img.blob,
            width: img.width,
            height: img.height,
            alt: img.alt || ''
        })),
        video: selectedVideo ? {
            blob: selectedVideo.blob,
            width: selectedVideo.width,
            height: selectedVideo.height,
            duration: selectedVideo.duration,
            name: selectedVideo.name,
            type: selectedVideo.type,
            size: selectedVideo.size,
            needsCompression: !!selectedVideo.needsCompression
        } : null,
        savedAt: Date.now()
    };
    await putDraft(draft);
}

async function restoreDraftForCurrentAccount() {
    if (!currentDid || !els.postInput) return;
    selectedImages.forEach(img => { if (img.url) URL.revokeObjectURL(img.url); });
    if (selectedVideo?.url) URL.revokeObjectURL(selectedVideo.url);
    selectedImages = [];
    selectedVideo = null;
    quoteTarget = null;
    autoQuoteUrl = null;
    els.postInput.value = '';
    updateImagePreview();
    updateVideoPreview();

    try {
        const draft = await getDraft();
        if (!draft) {
            const legacy = localStorage.getItem('aerune_draft_text');
            if (legacy) els.postInput.value = legacy;
            return;
        }
        if (Date.now() - (draft.savedAt || 0) > 7 * 86400000) {
            await deleteDraft();
            return;
        }
        els.postInput.value = draft.text || '';
        quoteTarget = draft.quoteTarget || null;
        autoQuoteUrl = draft.autoQuoteUrl || null;
        selectedImages = (draft.images || []).map((img, idx) => ({
            id: Date.now() + idx,
            file: null,
            blob: img.blob,
            width: img.width,
            height: img.height,
            alt: img.alt || '',
            url: URL.createObjectURL(img.blob)
        }));
        if (draft.video?.blob) {
            selectedVideo = {
                ...draft.video,
                file: null,
                url: URL.createObjectURL(draft.video.blob)
            };
        }
        updateImagePreview();
        updateVideoPreview();
        renderQuotePreview();
        if (draft.text || selectedImages.length || selectedVideo) showPostProgress(t('draft_restored'), false);
    } catch (e) {
        console.warn('restoreDraftForCurrentAccount:', e);
    }
}

function formatBytes(bytes) {
    const mb = Number(bytes || 0) / 1000000;
    return `${mb.toFixed(1)} MB`;
}

function formatDuration(seconds) {
    return String(Math.round(seconds || 0));
}

function canCompressVideoLocally() {
    return process.platform === 'darwin' && process.arch === 'arm64';
}

function videoFilePath(file) {
    try {
        return webUtils?.getPathForFile?.(file) || file?.path || '';
    } catch {
        return file?.path || '';
    }
}

function safeVideoFileName(name) {
    const base = String(name || 'input-video').replace(/[^\w.-]+/g, '_').slice(0, 80);
    return base || 'input-video';
}

async function materializeVideoInput(video) {
    if (video.sourcePath) return { inputPath: video.sourcePath, cleanup: async () => {} };
    if (!video.file && !video.blob) throw new Error('Video source is missing.');
    const dir = await nodeFs.promises.mkdtemp(nodePath.join(nodeOs.tmpdir(), 'aerune-video-input-'));
    const name = safeVideoFileName(video.name || 'input-video');
    const inputPath = nodePath.join(dir, name);
    const source = video.file || video.blob;
    await nodeFs.promises.writeFile(inputPath, Buffer.from(await source.arrayBuffer()));
    return {
        inputPath,
        cleanup: async () => nodeFs.promises.rm(dir, { recursive: true, force: true }).catch(() => {})
    };
}

async function cleanupCompressedVideo(tempDir) {
    if (!tempDir) return;
    try {
        await ipcRenderer.invoke('video-compress-cleanup', tempDir);
    } catch (e) {
        console.warn('video-compress-cleanup:', e);
    }
}

async function compressSelectedVideoForUpload() {
    if (!selectedVideo) return null;
    const isMp4 = selectedVideo.type === 'video/mp4' || /\.mp4$/i.test(selectedVideo.name || '');
    const needsCompression = selectedVideo.needsCompression || !isMp4 || selectedVideo.size > VIDEO_UPLOAD_MAX_BYTES;
    if (!needsCompression) return { ...selectedVideo, cleanup: async () => {} };
    if (!canCompressVideoLocally()) throw new Error(t('video_mp4_only'));

    const jobId = `video-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const input = await materializeVideoInput(selectedVideo);
    activeCompressionJobId = jobId;

    try {
        const result = await ipcRenderer.invoke('video-compress-start', {
            jobId,
            inputPath: input.inputPath,
            inputName: selectedVideo.name || 'video',
            duration: selectedVideo.duration,
            maxBytes: VIDEO_UPLOAD_MAX_BYTES
        });
        const data = await nodeFs.promises.readFile(result.outputPath);
        await cleanupCompressedVideo(result.tempDir);
        return {
            ...selectedVideo,
            blob: new Blob([data], { type: 'video/mp4' }),
            name: result.name || 'aerune-video.mp4',
            type: 'video/mp4',
            size: result.size || data.byteLength,
            needsCompression: false,
            compressed: true,
            cleanup: input.cleanup
        };
    } catch (e) {
        await input.cleanup();
        throw e;
    } finally {
        activeCompressionJobId = null;
    }
}

ipcRenderer.on('video-compress-progress', (_event, data) => {
    if (!data || data.jobId !== activeCompressionJobId) return;
    const pct = String(Math.max(0, Math.min(100, Math.round((data.progress || 0) * 100))));
    showPostProgress(t((data.attempt || 1) > 1 ? 'video_compress_retry' : 'video_compressing', pct));
});

function readVideoMetadata(file, url) {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () => resolve({
            width: video.videoWidth || 0,
            height: video.videoHeight || 0,
            duration: video.duration || 0
        });
        video.onerror = () => reject(new Error(t('video_mp4_only')));
        video.src = url || URL.createObjectURL(file);
    });
}

async function probeVideoMetadata(file, url, sourcePath) {
    try {
        return await readVideoMetadata(file, url);
    } catch (browserError) {
        if (!canCompressVideoLocally()) throw browserError;
        const input = await materializeVideoInput({
            file,
            blob: file,
            sourcePath,
            name: file?.name || 'input-video'
        });
        try {
            return await ipcRenderer.invoke('video-probe', { inputPath: input.inputPath });
        } catch (probeError) {
            console.warn('video-probe:', probeError);
            throw new Error(t('video_probe_failed'));
        } finally {
            await input.cleanup();
        }
    }
}

async function processVideoFile(file) {
    if (!file) return;
    if (selectedImages.length) return alert(t('video_with_images_error'));
    const isMp4 = file.type === 'video/mp4' || /\.mp4$/i.test(file.name || '');
    const supportsCompression = canCompressVideoLocally();
    if (!isMp4 && !supportsCompression) return alert(t('video_mp4_only'));
    if (!supportsCompression && file.size > VIDEO_UPLOAD_MAX_BYTES) return alert(t('video_too_large', formatBytes(file.size)));

    const url = URL.createObjectURL(file);
    const sourcePath = videoFilePath(file);
    try {
        const meta = await probeVideoMetadata(file, url, sourcePath);
        if (meta.duration > 180.5) {
            URL.revokeObjectURL(url);
            return alert(t('video_too_long', formatDuration(meta.duration)));
        }

        try {
            const limits = await api.getVideoUploadLimits();
            const estimatedUploadSize = (!isMp4 || file.size > VIDEO_UPLOAD_MAX_BYTES)
                ? VIDEO_COMPRESSION_TARGET_BYTES
                : file.size;
            if (limits.data && limits.data.canUpload === false) {
                URL.revokeObjectURL(url);
                return alert(t('video_upload_limit', limits.data.message || limits.data.error || 'limit'));
            }
            if (limits.data?.remainingDailyBytes != null && estimatedUploadSize > limits.data.remainingDailyBytes) {
                URL.revokeObjectURL(url);
                return alert(t('video_upload_limit', formatBytes(limits.data.remainingDailyBytes)));
            }
        } catch (e) {
            console.warn('getVideoUploadLimits:', e);
        }

        clearVideo(false);
        selectedVideo = {
            file,
            blob: file,
            url,
            sourcePath,
            width: meta.width,
            height: meta.height,
            duration: meta.duration,
            name: file.name || `video_${Date.now()}.mp4`,
            type: file.type || 'video/mp4',
            size: file.size,
            needsCompression: !isMp4 || file.size > VIDEO_UPLOAD_MAX_BYTES
        };
        updateVideoPreview();
        scheduleDraftSave();
    } catch (e) {
        URL.revokeObjectURL(url);
        alert(e.message || t('video_mp4_only'));
    }
}

function clearVideo(save = true) {
    if (selectedVideo?.url) URL.revokeObjectURL(selectedVideo.url);
    selectedVideo = null;
    if (els.videoInput) els.videoInput.value = '';
    updateVideoPreview();
    if (save) scheduleDraftSave();
}

function updateVideoPreview() {
    const container = els.videoPreviewContainer;
    if (!container) return;
    container.textContent = '';
    if (!selectedVideo) return;
    const wrap = document.createElement('div');
    wrap.className = 'video-preview-wrap';
    wrap.innerHTML =
        `<video src="${escAttr(selectedVideo.url)}" preload="metadata" controls></video>` +
        `<div class="video-preview-meta">` +
        `<strong>${escHTML(selectedVideo.name || t('video_ready'))}</strong>` +
        `<span>${escHTML(formatBytes(selectedVideo.size))} · ${escHTML(formatDuration(selectedVideo.duration))}s</span>` +
        `${selectedVideo.needsCompression ? `<span>${escHTML(t('video_will_compress'))}</span>` : ''}` +
        `<button type="button" data-act="remove-video">${escHTML(t('video_remove'))}</button>` +
        `</div>`;
    container.appendChild(wrap);
}

function showPostProgress(message, busy = true) {
    const el = els.postProgress;
    if (!el) return;
    el.classList.remove('hidden');
    el.innerHTML = busy
        ? `<span>${escHTML(message)}</span><button type="button" data-act="cancel-post">${escHTML(t('cancel'))}</button>`
        : `<span>${escHTML(message)}</span>`;
    if (!busy) setTimeout(() => el.classList.add('hidden'), 2500);
}

function hidePostProgress() {
    els.postProgress?.classList.add('hidden');
    if (els.postProgress) els.postProgress.textContent = '';
}

function cancelPost() {
    if (activeCompressionJobId) {
        ipcRenderer.invoke('video-compress-cancel', activeCompressionJobId).catch(e => console.warn('video-compress-cancel:', e));
    }
    postAbortController?.abort();
}

function extractBskyPostUrl(text) {
    const re = /https:\/\/bsky\.app\/profile\/([^/\s]+)\/post\/([A-Za-z0-9]+)/;
    const match = String(text || '').match(re);
    if (!match) return null;
    return { url: match[0], actor: decodeURIComponent(match[1]), rkey: match[2] };
}

function renderQuotePreview() {
    if (!els.quotePreview) return;
    if (!quoteTarget) {
        els.quotePreview.classList.add('hidden');
        els.quotePreview.innerHTML = '';
        return;
    }
    const author = quoteTarget.author || {};
    const text = quoteTarget.record?.text || quoteTarget.value?.text || '';
    els.quotePreview.classList.remove('hidden');
    els.quotePreview.innerHTML =
        `<span class="quote-preview-close" data-act="clear-quote">×</span>` +
        `<strong>@${escHTML(author.handle || '')}</strong>: ${escHTML(text.substring(0, 80))}`;
}

function scheduleQuoteUrlResolve() {
    if (quoteResolveTimer) clearTimeout(quoteResolveTimer);
    const match = extractBskyPostUrl(els.postInput?.value || '');
    if (!match) {
        if (autoQuoteUrl) {
            autoQuoteUrl = null;
            quoteTarget = null;
            renderQuotePreview();
            scheduleDraftSave();
        }
        return;
    }
    if (match.url === autoQuoteUrl) return;
    quoteResolveTimer = setTimeout(() => resolveQuoteUrl(match), 700);
}

async function resolveQuoteUrl(match) {
    try {
        const did = match.actor.startsWith('did:')
            ? match.actor
            : (await api.resolveHandle(match.actor)).data.did;
        const uri = `at://${did}/app.bsky.feed.post/${match.rkey}`;
        const res = await api.getPostThread(uri);
        const post = res.data.thread?.post;
        if (!post) return;
        quoteTarget = post;
        autoQuoteUrl = match.url;
        renderQuotePreview();
        scheduleDraftSave();
    } catch (e) {
        console.warn('resolveQuoteUrl:', e);
    }
}

// ─── フィード管理 ────────────────────────────────────────────────
const feedSelectionKey = () => `aerune_selected_feed_${currentDid || 'anon'}`;

function feedTitle(feed) {
    return feed?.displayName || feed?.title || feed?.value || '';
}

function feedByline(feed) {
    return feed?.creator?.handle || feed?.creatorHandle || '';
}

function savedFeedFromGenerator(generator, pinned = false) {
    return {
        id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        type: 'feed',
        value: generator.uri,
        pinned,
        displayName: generator.displayName,
        description: generator.description || '',
        avatar: generator.avatar || '',
        creatorHandle: generator.creator?.handle || ''
    };
}

function extractSavedFeeds(preferences) {
    for (const pref of preferences || []) {
        if (!pref || typeof pref !== 'object') continue;
        const type = pref.$type;

        if (type === 'app.bsky.actor.defs#savedFeedsPrefV2' && Array.isArray(pref.items)) {
            return pref.items
                .filter(item => (item?.type || 'feed') === 'feed' && item?.value)
                .map(item => ({
                    id: item.id || item.value,
                    type: 'feed',
                    value: item.value,
                    pinned: !!item.pinned
                }));
        }

        if (type === 'app.bsky.actor.defs#savedFeedsPref') {
            const pinned = Array.isArray(pref.pinned) ? pref.pinned : [];
            const saved = Array.isArray(pref.saved) ? pref.saved : [];
            const seen = new Set();
            return [...pinned, ...saved]
                .filter(uri => uri && !seen.has(uri) && seen.add(uri))
                .map(uri => ({ id: uri, type: 'feed', value: uri, pinned: pinned.includes(uri) }));
        }
    }
    return [];
}

function preservedSavedFeedItems(preferences) {
    const pref = (preferences || []).find(p => p?.$type === 'app.bsky.actor.defs#savedFeedsPrefV2');
    if (!pref || !Array.isArray(pref.items)) return [];
    return pref.items.filter(item => item?.type && item.type !== 'feed');
}

async function hydrateSavedFeeds(items) {
    const uris = [...new Set(items.map(item => item.value).filter(Boolean))];
    if (!uris.length) return items;
    const details = new Map();

    for (let i = 0; i < uris.length; i += 25) {
        try {
            const res = await api.getFeedGenerators(uris.slice(i, i + 25));
            for (const feed of (res.data.feeds || [])) details.set(feed.uri, feed);
        } catch (e) {
            console.warn('hydrateSavedFeeds:', e);
        }
    }

    return items.map(item => {
        const feed = details.get(item.value);
        if (!feed) return item;
        return {
            ...item,
            displayName: feed.displayName,
            description: feed.description || '',
            avatar: feed.avatar || '',
            creatorHandle: feed.creator?.handle || ''
        };
    });
}

function setSelectedFeedFromStorage() {
    const savedUri = localStorage.getItem(feedSelectionKey());
    feedState.selectedLocalList = savedUri === LOCAL_LIST_SOURCE_VALUE;
    feedState.selectedFeed = savedUri
        && !feedState.selectedLocalList
        ? feedState.savedFeeds.find(feed => feed.value === savedUri) || null
        : null;
    if (savedUri && !feedState.selectedFeed && !feedState.selectedLocalList) localStorage.removeItem(feedSelectionKey());
}

async function refreshFeedPreferences() {
    feedState.isLoading = true;
    feedState.errorMessage = '';
    renderFeedControls();
    renderFeedsView();

    try {
        const res = await api.getPreferences();
        feedState.preferences = res.data.preferences || [];
        feedState.savedFeeds = await hydrateSavedFeeds(extractSavedFeeds(feedState.preferences));
        setSelectedFeedFromStorage();
    } catch (e) {
        feedState.errorMessage = e.message || String(e);
    } finally {
        feedState.isLoading = false;
        renderFeedControls();
        renderFeedsView();
    }
}

async function configureFeedsForCurrentAccount(force = false) {
    if (!api.session?.did) return;
    if (!force && feedState.configuredDid === api.session.did) {
        renderFeedControls();
        renderFeedsView();
        return;
    }

    feedState.configuredDid = api.session.did;
    feedState.preferences = [];
    feedState.savedFeeds = [];
    feedState.searchResults = [];
    feedState.searchQuery = '';
    feedState.suggestedFeeds = [];
    feedState.selectedFeed = null;
    feedState.selectedLocalList = false;
    await refreshFeedPreferences();
    await loadSuggestedFeeds();
}

async function saveFeedPreferences() {
    const preserved = preservedSavedFeedItems(feedState.preferences);
    const prefObject = {
        $type: 'app.bsky.actor.defs#savedFeedsPrefV2',
        items: preserved.concat(feedState.savedFeeds.map(feed => ({
            id: feed.id || feed.value,
            type: 'feed',
            value: feed.value,
            pinned: !!feed.pinned
        })))
    };

    const updated = (feedState.preferences || []).filter(pref => {
        const type = pref?.$type;
        return type !== 'app.bsky.actor.defs#savedFeedsPrefV2' &&
            type !== 'app.bsky.actor.defs#savedFeedsPref';
    });
    updated.push(prefObject);

    feedState.isLoading = true;
    feedState.errorMessage = '';
    renderFeedControls();
    renderFeedsView();
    try {
        await api.putPreferences(updated);
        feedState.preferences = updated;
        setSelectedFeedFromStorage();
    } catch (e) {
        feedState.errorMessage = e.message || String(e);
    } finally {
        feedState.isLoading = false;
        renderFeedControls();
        renderFeedsView();
    }
}

async function loadSuggestedFeeds() {
    feedState.errorMessage = '';
    try {
        const res = await api.getSuggestedFeeds(30);
        feedState.suggestedFeeds = res.data.feeds || [];
    } catch (e) {
        console.warn('loadSuggestedFeeds:', e);
    }
    renderFeedsView();
}

async function runFeedSearch() {
    const input = document.getElementById('feed-search-input');
    const query = input?.value.trim();
    if (!query) {
        feedState.searchResults = [];
        feedState.searchQuery = '';
        renderFeedsView();
        return;
    }
    feedState.searchQuery = query;
    feedState.isLoading = true;
    feedState.errorMessage = '';
    renderFeedsView();
    try {
        const res = await api.searchFeeds(query, 50);
        feedState.searchResults = res.data.feeds || [];
    } catch (e) {
        feedState.errorMessage = e.message || String(e);
    } finally {
        feedState.isLoading = false;
        renderFeedsView();
    }
}

function selectTimelineFeed(uri) {
    viewLoader?.saveTimelineScroll();
    feedState.selectedLocalList = uri === LOCAL_LIST_SOURCE_VALUE;
    feedState.selectedFeed = uri && !feedState.selectedLocalList ? feedState.savedFeeds.find(feed => feed.value === uri) || null : null;
    if (feedState.selectedLocalList) localStorage.setItem(feedSelectionKey(), LOCAL_LIST_SOURCE_VALUE);
    else if (feedState.selectedFeed) localStorage.setItem(feedSelectionKey(), feedState.selectedFeed.value);
    else localStorage.removeItem(feedSelectionKey());
    resetTimelineNotice();
    renderFeedControls();
    switchView('home', els.timelineDiv);
    viewLoader.fetchTimeline();
}

function refreshLocalListTimelineIfActive() {
    if (!feedState.selectedLocalList || !els.timelineDiv || els.timelineDiv.classList.contains('hidden')) return;
    viewLoader?.fetchTimeline(false, { skipCache: true });
}

async function addFeedByUri(uri) {
    const source = [...feedState.suggestedFeeds, ...feedState.searchResults].find(feed => feed.uri === uri);
    if (!source || feedState.savedFeeds.some(feed => feed.value === uri)) return;
    feedState.savedFeeds.push(savedFeedFromGenerator(source));
    await saveFeedPreferences();
}

async function removeFeedByUri(uri) {
    feedState.savedFeeds = feedState.savedFeeds.filter(feed => feed.value !== uri);
    if (feedState.selectedFeed?.value === uri) {
        feedState.selectedFeed = null;
        localStorage.removeItem(feedSelectionKey());
        viewLoader.fetchTimeline();
    }
    await saveFeedPreferences();
}

async function toggleFeedPinned(uri) {
    const feed = feedState.savedFeeds.find(item => item.value === uri);
    if (!feed) return;
    feed.pinned = !feed.pinned;
    await saveFeedPreferences();
}

async function moveFeed(uri, dir) {
    const idx = feedState.savedFeeds.findIndex(feed => feed.value === uri);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= feedState.savedFeeds.length) return;
    const [item] = feedState.savedFeeds.splice(idx, 1);
    feedState.savedFeeds.splice(next, 0, item);
    await saveFeedPreferences();
}

function renderFeedControls() {
    const bar = els.timelineSourceBar;
    if (!bar) return;
    const saved = feedState.savedFeeds;
    const pinned = saved.filter(feed => feed.pinned);
    const selectedValue = feedState.selectedLocalList ? LOCAL_LIST_SOURCE_VALUE : (feedState.selectedFeed?.value || '');
    const localListLabel = `${t('locallist_title')} (${readLocalListMembers().length})`;

    const options = [
        `<option value="" ${!selectedValue ? 'selected' : ''}>${escHTML(t('timeline_home'))}</option>`,
        `<option value="${LOCAL_LIST_SOURCE_VALUE}" ${selectedValue === LOCAL_LIST_SOURCE_VALUE ? 'selected' : ''}>${escHTML(localListLabel)}</option>`,
        ...saved.map(feed => `<option value="${escAttr(feed.value)}" ${selectedValue === feed.value ? 'selected' : ''}>${escHTML(feedTitle(feed))}</option>`)
    ].join('');
    const chips = pinned.map(feed =>
        `<button class="feed-chip${selectedValue === feed.value ? ' active' : ''}" data-act="feed-select" data-uri="${escAttr(feed.value)}">${escHTML(feedTitle(feed))}</button>`
    ).join('');

    bar.innerHTML =
        `<div class="feed-source-controls">` +
        `<span class="feed-source-label">${escHTML(t('feeds_source'))}</span>` +
        `<button class="feed-chip${!selectedValue ? ' active' : ''}" data-act="feed-select-home">${escHTML(t('timeline_home'))}</button>` +
        `<button class="feed-chip${selectedValue === LOCAL_LIST_SOURCE_VALUE ? ' active' : ''}" data-act="feed-select-local-list">${escHTML(t('locallist_title'))}</button>` +
        `<div class="feed-chip-row">${chips}</div>` +
        `<select id="feed-source-select" class="feed-source-select">${options}</select>` +
        `</div>` +
        `<button class="feed-manager-btn" data-act="feed-open-manager">${escHTML(t('feeds_open_manager'))}</button>`;

    const select = document.getElementById('feed-source-select');
    if (select) select.onchange = e => selectTimelineFeed(e.target.value);
}

function feedRow(feed, mode, index = 0, total = 0) {
    const saved = feedState.savedFeeds.find(item => item.value === (feed.value || feed.uri));
    const uri = feed.value || feed.uri;
    const title = feedTitle(feed);
    const byline = feedByline(feed);
    const desc = feed.description || '';
    const avatar = feed.avatar || '';
    const likeCount = typeof feed.likeCount === 'number' ? t('feed_like_count', String(feed.likeCount)) : '';
    const isSelected = feedState.selectedFeed?.value === uri;
    const meta = [byline ? t('feed_by_author', byline) : '', likeCount].filter(Boolean).join(' · ');

    let actions = '';
    if (mode === 'saved') {
        actions =
            `<button data-act="feed-select" data-uri="${escAttr(uri)}">${escHTML(isSelected ? t('feeds_selected') : t('feeds_source'))}</button>` +
            `<button data-act="feed-pin" data-uri="${escAttr(uri)}">${escHTML(saved?.pinned ? t('feeds_unpin') : t('feeds_pin'))}</button>` +
            `<button data-act="feed-move" data-uri="${escAttr(uri)}" data-dir="-1" ${index === 0 ? 'disabled' : ''}>${escHTML(t('feeds_move_up'))}</button>` +
            `<button data-act="feed-move" data-uri="${escAttr(uri)}" data-dir="1" ${index === total - 1 ? 'disabled' : ''}>${escHTML(t('feeds_move_down'))}</button>` +
            `<button data-act="feed-remove" data-uri="${escAttr(uri)}">${escHTML(t('feeds_remove'))}</button>`;
    } else {
        actions = saved
            ? `<span class="feed-badge">${escHTML(t('feeds_selected'))}</span>`
            : `<button data-act="feed-add" data-uri="${escAttr(uri)}">${escHTML(t('feeds_add'))}</button>`;
    }

    return `<div class="feed-row">` +
        `<img class="feed-avatar" src="${escAttr(avatar)}" loading="lazy" decoding="async">` +
        `<div class="feed-main">` +
        `<div class="feed-title-line"><span class="feed-title">${escHTML(title)}</span>${saved?.pinned ? `<span class="feed-badge">${escHTML(t('feeds_pin'))}</span>` : ''}</div>` +
        `${meta ? `<div class="feed-meta">${escHTML(meta)}</div>` : ''}` +
        `${desc ? `<div class="feed-desc">${escHTML(desc)}</div>` : ''}` +
        `</div>` +
        `<div class="feed-actions">${actions}</div>` +
        `</div>`;
}

function renderFeedList(items, mode) {
    if (!items.length) return `<div class="feed-status">${escHTML(mode === 'saved' ? t('feeds_saved_empty') : t('feeds_none'))}</div>`;
    return `<div class="feed-row-list">${items.map((feed, idx) => feedRow(feed, mode, idx, items.length)).join('')}</div>`;
}

function renderFeedsView() {
    if (!els.feedsView) return;
    const searchItems = feedState.searchResults.length ? feedState.searchResults : feedState.suggestedFeeds;
    els.feedsView.innerHTML =
        `<div class="feeds-panel">` +
        `<div class="feeds-header"><h3>${escHTML(t('feeds_manage'))}</h3><button data-act="feed-refresh">${escHTML(t('feeds_refresh'))}</button></div>` +
        `${feedState.errorMessage ? `<div class="feed-error">${escHTML(t('feeds_error'))}: ${escHTML(feedState.errorMessage)}</div>` : ''}` +
        `${feedState.isLoading ? `<div class="feed-status">${escHTML(t('feeds_loading'))}</div>` : ''}` +
        `<section class="feeds-section">` +
        `<div class="feeds-section-title"><h4>${escHTML(t('feeds_saved'))}</h4></div>` +
        `${renderFeedList(feedState.savedFeeds, 'saved')}` +
        `</section>` +
        `<section class="feeds-section">` +
        `<div class="feeds-section-title"><h4>${escHTML(feedState.searchResults.length ? t('feeds_search_results') : t('feeds_suggested'))}</h4></div>` +
        `<div class="feed-search-bar"><input id="feed-search-input" type="text" value="${escAttr(feedState.searchQuery)}" placeholder="${escAttr(t('feeds_search_placeholder'))}"><button data-act="feed-search">${escHTML(t('search_btn'))}</button></div>` +
        `${renderFeedList(searchItems, 'candidate')}` +
        `</section>` +
        `</div>`;

    const input = document.getElementById('feed-search-input');
    if (input) input.onkeydown = e => {
        if (e.key === 'Enter') runFeedSearch();
    };
}

window.openFeedsManager = () => {
    nav.push({ type: 'feeds' }, _activeView);
    updateBackBtn();
    switchView('feeds', els.feedsView);
    renderFeedsView();
};

// ─── ナビゲーション ───────────────────────────────────────────────
function updateBackBtn() {
    const b = document.getElementById('back-btn');
    if (b) b.style.display = nav.canGoBack ? 'inline-block' : 'none';
}

function goBack() {
    const prev = nav.pop(); 
    if (!prev) return;
    updateBackBtn();

    const restoreScroll = (container) => {
        if (!container || prev._scrollTop == null) return;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            container.scrollTop = prev._scrollTop;
        }));
    };

    switch (prev.type) {
        case 'home':
            switchView('home', els.timelineDiv);
            viewLoader.fetchTimeline().then(() => viewLoader.restoreTimelineScroll(timelineSourceKey()));
            break;
        case 'notifications':
            switchView('notifications', els.notifDiv);
            viewLoader.fetchNotifications().then(() => restoreScroll(els.notifDiv));
            break;
        case 'chat':
            switchView('chat', els.chatView);
            fetchConvos();
            break;
        case 'search':
            switchView('search', els.searchView);
            restoreScroll(document.getElementById('search-results'));
            break;
        case 'profile':
            window.loadProfile(prev.actor, true);
            break;
        case 'thread':
            window.loadThread(prev.uri, true);
            break;
        case 'settings':
            switchView('settings', els.settingsView);
            break;
        case 'bookmarks':
            switchView('bookmarks', els.bookmarksView);
            viewLoader.fetchBookmarks().then(() => restoreScroll(els.bookmarksView));
            break;
        case 'feeds':
            switchView('feeds', els.feedsView);
            renderFeedsView();
            break;
    }
}

// ─── モジュール初期化 ─────────────────────────────────────────────
let viewLoader, actions;

function initModules() {
    viewLoader = new ViewLoader(api, getRenderContext, els, currentTimelineSource);
    actions = new AppActions(api, t, {
        timeline:  () => viewLoader.fetchTimeline(),
        bookmarks: () => viewLoader.fetchBookmarks(),
        current:   () => {
            if (!els.timelineDiv.classList.contains('hidden'))         viewLoader.fetchTimeline();
            else if (els.profileView && !els.profileView.classList.contains('hidden') && nav.current?.type === 'profile')
                                                                        viewLoader.loadProfile(nav.current.actor);
            else if (els.bookmarksView && !els.bookmarksView.classList.contains('hidden'))
                                                                        viewLoader.fetchBookmarks();
        },
        profile:   actor => viewLoader.loadProfile(actor)
    }, ipcRenderer, nav);
}

// ─── グローバル公開 (必要最小限) ──────────────────────────────────

window.loadProfile = (actor, isBack = false) => {
    if (!isBack) { nav.push({ type: 'profile', actor }, _activeView); updateBackBtn(); }
    switchView('profile', els.profileView);
    viewLoader.loadProfile(actor);
};

window.loadThread = (uri, isBack = false) => {
    if (!isBack) { nav.push({ type: 'thread', uri }, _activeView); updateBackBtn(); }
    switchView('thread', els.threadView);
    viewLoader.loadThread(uri);
};

function renderImageModal() {
    const img = document.getElementById('modal-image');
    const modal = document.getElementById('image-modal');
    const prev = document.getElementById('modal-prev');
    const next = document.getElementById('modal-next');
    const counter = document.getElementById('modal-counter');
    const urls = imageModalState.urls;
    const index = imageModalState.index;
    if (!img || !modal || !urls.length) return;
    img.src = urls[index] || '';
    modal.classList.remove('hidden');
    if (prev) prev.disabled = index <= 0;
    if (next) next.disabled = index >= urls.length - 1;
    if (counter) counter.textContent = urls.length > 1 ? `${index + 1} / ${urls.length}` : '';
}

function stepImageModal(dir) {
    const nextIndex = imageModalState.index + dir;
    if (nextIndex < 0 || nextIndex >= imageModalState.urls.length) return;
    imageModalState.index = nextIndex;
    renderImageModal();
}

function closeImageModal() {
    const modal = document.getElementById('image-modal');
    const img = document.getElementById('modal-image');
    if (modal) modal.classList.add('hidden');
    if (img) img.src = '';
    imageModalState = { urls: [], index: 0 };
}

window.openModal = (input, startIndex = 0) => {
    const urls = (Array.isArray(input) ? input : [input]).filter(Boolean);
    if (!urls.length) return;
    imageModalState = {
        urls,
        index: Math.max(0, Math.min(Number(startIndex) || 0, urls.length - 1))
    };
    renderImageModal();
};

window.openQuoteModal = (e, rec) => {
    if (!els.quoteModal || !els.quoteModalBody) return;
    const quotePost = {
        ...rec,
        record: rec.value || rec.record || {},
        embed: rec.embed || rec.embeds?.[0] || null,
        viewer: rec.viewer || {}
    };
    els.quoteModalBody.textContent = '';
    els.quoteModalBody.appendChild(createPostElement(quotePost, getRenderContext(), false, true));
    els.quoteModal.classList.remove('hidden');
};

window.prepareReply = (uri, cid, handle, rootUri, rootCid) => {
    replyTarget = { uri, cid, root: { uri: rootUri || uri, cid: rootCid || cid } };
    els.postInput.placeholder = t('reply_placeholder', handle);
    els.postInput.focus();
};

window.prepareQuote = (uri, cid, handle, text) => {
    quoteTarget = {
        uri,
        cid,
        author: { handle },
        record: { text }
    };
    autoQuoteUrl = null;
    renderQuotePreview();
    els.postInput.focus();
    scheduleDraftSave();
};

window.prepareProfileReply = handle => {
    els.postInput.value = `@${handle} ` + els.postInput.value;
    els.postInput.focus();
};

function postText(post) {
    return post?.record?.text || post?.value?.text || '';
}

function postPermalink(post) {
    const handle = post?.author?.handle || post?.author?.did || '';
    const rkey = String(post?.uri || '').split('/').pop() || '';
    return handle && rkey ? `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(rkey)}` : '';
}

function copyPlainText(text) {
    clipboard.writeText(String(text || ''));
    showPostProgress(t('copied'), false);
}

function deeplTargetLang() {
    if (currentLang === 'pt-BR') return 'pt-BR';
    if (currentLang === 'ar') return 'ar';
    if (currentLang === 'ja') return 'ja';
    return 'en';
}

function openPostInDeepL(post) {
    const text = postText(post).trim();
    if (!text) return;
    const url = `https://www.deepl.com/translator#auto/${deeplTargetLang()}/${encodeURIComponent(text)}`;
    shell.openExternal(url);
}

async function sendPostByDirectMessage(post) {
    const target = prompt(t('dm_recipient_prompt'));
    if (!target) return;
    const actor = target.trim().replace(/^@/, '');
    if (!actor) return;
    try {
        const profile = await api.getProfile(actor);
        const availability = await api.getConvoAvailability(profile.data.did).catch(() => ({ data: { canChat: false } }));
        if (!availability.data?.canChat) throw new Error(t('dm_unavailable'));
        const convoId = availability.data.convo?.id || (await api.getChatAgent().chat.bsky.convo.getConvoForMembers({ members: [profile.data.did] })).data.convo.id;
        const text = [postPermalink(post), postText(post)].filter(Boolean).join('\n\n');
        await api.getChatAgent().chat.bsky.convo.sendMessage({
            convoId,
            message: { text }
        });
        alert(t('dm_sent'));
    } catch (e) {
        console.error('sendPostByDirectMessage:', e);
        alert(`${t('dm_failed')}\n${e.message || e}`);
    }
}

const REPORT_REASONS = [
    ['com.atproto.moderation.defs#reasonSpam', 'report_reason_spam'],
    ['com.atproto.moderation.defs#reasonViolation', 'report_reason_violation'],
    ['com.atproto.moderation.defs#reasonMisleading', 'report_reason_misleading'],
    ['com.atproto.moderation.defs#reasonSexual', 'report_reason_sexual'],
    ['com.atproto.moderation.defs#reasonRude', 'report_reason_rude'],
    ['com.atproto.moderation.defs#reasonOther', 'report_reason_other']
];

function showReportDialog() {
    return new Promise(resolve => {
        const modal = document.getElementById('report-modal');
        const select = document.getElementById('report-reason');
        const note = document.getElementById('report-note');
        const submit = document.getElementById('report-submit');
        const cancel = document.getElementById('report-cancel');
        const close = document.getElementById('report-modal-close');
        if (!modal || !select || !note || !submit || !cancel || !close) {
            resolve(null);
            return;
        }
        select.textContent = '';
        for (const [value, key] of REPORT_REASONS) {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = t(key);
            select.appendChild(opt);
        }
        note.value = '';
        modal.classList.remove('hidden');
        const finish = value => {
            modal.classList.add('hidden');
            modal.onclick = null;
            submit.onclick = cancel.onclick = close.onclick = null;
            reportDialogFinish = null;
            resolve(value);
        };
        reportDialogFinish = finish;
        submit.onclick = () => finish({ reasonType: select.value, reason: note.value });
        cancel.onclick = () => finish(null);
        close.onclick = () => finish(null);
        modal.onclick = e => { if (e.target === modal) finish(null); };
    });
}

async function reportPostFromMenu(post) {
    if (!post?.uri || !post?.cid) return;
    const result = await showReportDialog();
    if (!result) return;
    await actions.reportPost(post.uri, post.cid, result.reasonType, result.reason);
}

async function reportAccountFromActor(did) {
    if (!did) return;
    const result = await showReportDialog();
    if (!result) return;
    await actions.reportAccount(did, result.reasonType, result.reason);
}

function openNotificationTarget(el) {
    if (!el) return;
    const target = el.dataset.notifTarget;
    const uri = el.dataset.targetUri || el.dataset.thread || '';
    const actor = el.dataset.actor || '';
    if (target === 'thread' && uri) window.loadThread(uri);
    else if (actor) window.loadProfile(actor);
}

window.openNotificationDetail = (detailId) => {
    const detail = window.aeruneNotificationDetails?.get(detailId);
    if (!detail) return;
    const reason = detail.reason || 'like';
    const title = t(`notif_detail_${reason}`, String(detail.notifications.length));
    window.showListModal(title, async () => detail.notifications.map(n => n.author).filter(Boolean), null);
};

function setSearchMode(mode, run = true) {
    const nextMode = mode === 'users' ? 'users' : 'posts';
    if (searchState.mode !== nextMode) searchState.lastKey = '';
    searchState.mode = nextMode;
    document.querySelectorAll('.search-mode-btn').forEach(btn => {
        const active = btn.dataset.mode === searchState.mode;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (run) scheduleSearch(true);
}

function scheduleSearch(immediate = false) {
    if (searchState.debounceTimer) clearTimeout(searchState.debounceTimer);
    const delay = immediate ? 0 : 350;
    searchState.debounceTimer = setTimeout(() => window.execSearch(undefined, false), delay);
}

function renderSearchStatus(message, isError = false) {
    const container = document.getElementById('search-results');
    if (!container) return;
    container.innerHTML = `<div class="search-status${isError ? ' search-error' : ''}">${escHTML(message)}</div>`;
}

function actorFromDataset(el) {
    return {
        did: el.dataset.did || '',
        handle: el.dataset.handle || '',
        displayName: el.dataset.displayName || '',
        avatar: el.dataset.avatar || ''
    };
}

function renderActorRow(actor) {
    const isSelf = api.session && actor.did === api.session.did;
    const following = actor.viewer?.following || '';
    const localMember = isLocalListMember(actor.did);
    const desc = actor.description ? `<div class="actor-desc">${renderRichText({ text: actor.description })}</div>` : '';
    const actionsHtml = isSelf ? '' : (
        `<div class="actor-actions">` +
        `<button type="button" data-act="toggle-follow" data-did="${escAttr(actor.did)}" data-following="${escAttr(following)}">${escHTML(following ? t('ctx_unfollow') : t('ctx_follow'))}</button>` +
        `<button type="button" data-act="local-list-toggle" data-did="${escAttr(actor.did)}" data-handle="${escAttr(actor.handle)}" data-display-name="${escAttr(actor.displayName || '')}" data-avatar="${escAttr(actor.avatar || '')}" class="${localMember ? 'is-member' : ''}">${escHTML(localMember ? t('locallist_remove') : t('locallist_add_member'))}</button>` +
        `<button type="button" data-act="report-account" data-did="${escAttr(actor.did)}" class="danger-action">${escHTML(t('ctx_report_account'))}</button>` +
        `</div>`
    );
    return `<div class="actor-row">` +
        `<img src="${escAttr(actor.avatar || '')}" alt="" class="actor-avatar" data-act="profile" data-actor="${escAttr(actor.did)}" loading="lazy" decoding="async">` +
        `<div class="actor-main" data-act="profile" data-actor="${escAttr(actor.did)}">` +
        `<div class="actor-name">${escHTML(actor.displayName || actor.handle || actor.did)}</div>` +
        `<div class="actor-handle">@${escHTML(actor.handle || actor.did)}</div>` +
        desc +
        `</div>` +
        actionsHtml +
        `</div>`;
}

function renderActorResults(actors, append) {
    const container = document.getElementById('search-results');
    if (!container) return;
    if (!append) container.textContent = '';
    if (!actors.length && !append) {
        renderSearchStatus(t('search_no_users'));
        return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'actor-list';
    wrap.innerHTML = actors.map(renderActorRow).join('');
    container.appendChild(wrap);
}

window.execSearch = async (q, isAppend = false) => {
    const query = (typeof q === 'string' ? q : document.getElementById('search-input')?.value || '').trim();
    const si = document.getElementById('search-input');
    if (si) si.value = query;
    if (!query) {
        searchState.query = '';
        searchState.postCursor = null;
        searchState.actorCursor = null;
        searchState.lastKey = '';
        renderSearchStatus(t('search_enter_keyword'));
        return;
    }
    if (!isAppend && _activeView !== els.searchView) {
        nav.push({ type: 'search' }, _activeView);
        updateBackBtn();
    }
    switchView('search', els.searchView);
    setSearchMode(searchState.mode, false);

    if (!isAppend) {
        searchState.query = query;
        searchState.postCursor = null;
        searchState.actorCursor = null;
    }
    if (searchState.loading) {
        if (!isAppend) searchState.pending = true;
        return;
    }
    const cursor = searchState.mode === 'users' ? searchState.actorCursor : searchState.postCursor;
    if (isAppend && !cursor) return;

    const key = `${searchState.mode}:${query}:${cursor || ''}`;
    if (!isAppend && key === searchState.lastKey) return;

    const requestId = ++searchState.requestId;
    searchState.loading = true;
    if (!isAppend) renderSearchStatus(t('searching'));
    try {
        if (searchState.mode === 'users') {
            const res = await api.searchActors(query, 50, isAppend ? searchState.actorCursor : undefined);
            if (requestId !== searchState.requestId) return;
            searchState.actorCursor = res.data.cursor || null;
            renderActorResults(res.data.actors || [], isAppend);
        } else {
            const res = await api.searchPosts(query, 50, isAppend ? searchState.postCursor : undefined);
            if (requestId !== searchState.requestId) return;
            searchState.postCursor = res.data.cursor || null;
            const posts = (res.data.posts || []).filter(post => !shouldMutePost(post));
            if (!posts.length && !isAppend) renderSearchStatus(t('search_no_posts'));
            else renderPosts(posts, document.getElementById('search-results'), getRenderContext(), isAppend);
        }
        searchState.lastKey = key;
    } catch (e) {
        console.error('execSearch:', e);
        if (!isAppend) renderSearchStatus(`${t('search_failed')}\n${e.message || e}`, true);
    } finally {
        searchState.loading = false;
        if (searchState.pending && !isAppend) {
            searchState.pending = false;
            scheduleSearch(true);
        }
    }
};

window.showContextMenu = (x, y, items) => {
    if (!els.ctxMenu) return;
    const frag = document.createDocumentFragment();
    for (const item of items) {
        if (item.divider) {
            const d = document.createElement('div'); d.className = 'ctx-divider';
            frag.appendChild(d);
        } else {
            const d = document.createElement('div'); d.className = 'ctx-menu-item';
            if (item.color) d.style.color = item.color;
            d.innerHTML = item.label;
            d.onclick = e => { e.stopPropagation(); els.ctxMenu.classList.add('hidden'); item.action(); };
            frag.appendChild(d);
        }
    }
    els.ctxMenu.textContent = '';
    els.ctxMenu.appendChild(frag);
    els.ctxMenu.classList.remove('hidden');
    const rect = els.ctxMenu.getBoundingClientRect();
    els.ctxMenu.style.left = `${Math.max(0, Math.min(x, window.innerWidth  - rect.width  - 10))}px`;
    els.ctxMenu.style.top  = `${Math.max(0, Math.min(y, window.innerHeight - rect.height - 10))}px`;
};

// ─── イベント委譲（一括登録） ─────────────────────────────────────
function installDelegates() {
    document.addEventListener('click', e => {
        const a = e.target.closest('a[data-ext],a[data-search],a[data-profile]');
        if (a) {
            e.preventDefault(); e.stopPropagation();
            if (a.dataset.ext)     shell.openExternal(a.dataset.ext);
            else if (a.dataset.search)   window.execSearch(a.dataset.search);
            else if (a.dataset.profile)  window.loadProfile(a.dataset.profile);
            return;
        }
        const actEl = e.target.closest('[data-act]');
        const extBlock = actEl ? null : e.target.closest('[data-ext]:not(a)');
        if (extBlock?.dataset.ext) {
            e.preventDefault(); e.stopPropagation();
            shell.openExternal(extBlock.dataset.ext);
            return;
        }

        const notifRow = actEl ? null : e.target.closest('.notif[data-notif-target]');
        if (notifRow && !hasSelection()) {
            e.preventDefault(); e.stopPropagation();
            openNotificationTarget(notifRow);
            return;
        }
        
        if (!actEl) return;
        const act = actEl.dataset.act;
        if (!act || act === 'noop') return;
        
        // ▼ ポスト外（画像プレビューやモーダル等）の処理 ▼
        switch (act) {
            case 'remove-video': {
                e.preventDefault(); e.stopPropagation();
                clearVideo();
                return;
            }
            case 'cancel-post': {
                e.preventDefault(); e.stopPropagation();
                cancelPost();
                return;
            }
            case 'clear-quote': {
                e.preventDefault(); e.stopPropagation();
                quoteTarget = null;
                autoQuoteUrl = null;
                renderQuotePreview();
                scheduleDraftSave();
                return;
            }
            case 'reveal-media': {
                e.preventDefault(); e.stopPropagation();
                actEl.closest('.media-hidden')?.classList.remove('media-hidden');
                return;
            }
            case 'timeline-show-new': {
                e.preventDefault(); e.stopPropagation();
                refreshCurrentTimeline({ scrollToTop: true });
                return;
            }
            case 'feed-open-manager': {
                e.preventDefault(); e.stopPropagation();
                window.openFeedsManager();
                return;
            }
            case 'feed-select-home': {
                e.preventDefault(); e.stopPropagation();
                selectTimelineFeed('');
                return;
            }
            case 'feed-select-local-list': {
                e.preventDefault(); e.stopPropagation();
                selectTimelineFeed(LOCAL_LIST_SOURCE_VALUE);
                return;
            }
            case 'feed-select': {
                e.preventDefault(); e.stopPropagation();
                selectTimelineFeed(actEl.dataset.uri || '');
                return;
            }
            case 'feed-add': {
                e.preventDefault(); e.stopPropagation();
                addFeedByUri(actEl.dataset.uri);
                return;
            }
            case 'feed-remove': {
                e.preventDefault(); e.stopPropagation();
                removeFeedByUri(actEl.dataset.uri);
                return;
            }
            case 'feed-pin': {
                e.preventDefault(); e.stopPropagation();
                toggleFeedPinned(actEl.dataset.uri);
                return;
            }
            case 'feed-move': {
                e.preventDefault(); e.stopPropagation();
                moveFeed(actEl.dataset.uri, parseInt(actEl.dataset.dir, 10));
                return;
            }
            case 'feed-refresh': {
                e.preventDefault(); e.stopPropagation();
                refreshFeedPreferences().then(loadSuggestedFeeds);
                return;
            }
            case 'feed-search': {
                e.preventDefault(); e.stopPropagation();
                runFeedSearch();
                return;
            }
            case 'search-mode': {
                e.preventDefault(); e.stopPropagation();
                setSearchMode(actEl.dataset.mode, true);
                return;
            }
            case 'profile-relations': {
                e.preventDefault(); e.stopPropagation();
                window.openProfileRelations(actEl.dataset.actor, actEl.dataset.relation);
                return;
            }
            case 'start-dm': {
                e.preventDefault(); e.stopPropagation();
                window.startDirectMessage(actEl.dataset.did);
                return;
            }
            case 'profile-reply': {
                e.preventDefault(); e.stopPropagation();
                window.prepareProfileReply(actEl.dataset.handle);
                return;
            }
            case 'toggle-follow': {
                e.preventDefault(); e.stopPropagation();
                actions.toggleFollow(actEl.dataset.did, actEl.dataset.following);
                return;
            }
            case 'local-list-toggle': {
                e.preventDefault(); e.stopPropagation();
                toggleLocalListMember(actorFromDataset(actEl));
                return;
            }
            case 'local-list-remove': {
                e.preventDefault(); e.stopPropagation();
                removeLocalListMember(actEl.dataset.did);
                return;
            }
            case 'local-list-export': {
                e.preventDefault(); e.stopPropagation();
                exportLocalList();
                return;
            }
            case 'local-list-import': {
                e.preventDefault(); e.stopPropagation();
                document.getElementById('local-list-import-input')?.click();
                return;
            }
            case 'report-account': {
                e.preventDefault(); e.stopPropagation();
                reportAccountFromActor(actEl.dataset.did);
                return;
            }
            case 'notif-load-more': {
                e.preventDefault(); e.stopPropagation();
                viewLoader.fetchNotifications(true);
                return;
            }
            case 'notification-detail': {
                e.preventDefault(); e.stopPropagation();
                window.openNotificationDetail(actEl.dataset.detailId);
                return;
            }
            case 'mute-rule-add': {
                e.preventDefault(); e.stopPropagation();
                addMuteRuleFromSettings();
                return;
            }
            case 'mute-rule-remove': {
                e.preventDefault(); e.stopPropagation();
                removeMuteRuleAt(parseInt(actEl.dataset.index, 10));
                return;
            }
            case 'mod-list-mute': {
                e.preventDefault(); e.stopPropagation();
                subscribeModerationList('mute');
                return;
            }
            case 'mod-list-block': {
                e.preventDefault(); e.stopPropagation();
                subscribeModerationList('block');
                return;
            }
            case 'show-list-mutes': {
                e.preventDefault(); e.stopPropagation();
                showModerationLists('mute');
                return;
            }
            case 'show-list-blocks': {
                e.preventDefault(); e.stopPropagation();
                showModerationLists('block');
                return;
            }
            case 'mod-list-unmute': {
                e.preventDefault(); e.stopPropagation();
                unsubscribeModerationList('mute', actEl.dataset.uri);
                return;
            }
            case 'mod-list-unblock': {
                e.preventDefault(); e.stopPropagation();
                unsubscribeModerationList('block', actEl.dataset.blockUri);
                return;
            }
            case 'labeler-subscribe': {
                e.preventDefault(); e.stopPropagation();
                subscribeLabelerFromSettings();
                return;
            }
            case 'show-labelers': {
                e.preventDefault(); e.stopPropagation();
                showSubscribedLabelers();
                return;
            }
            case 'labeler-unsubscribe': {
                e.preventDefault(); e.stopPropagation();
                unsubscribeLabeler(actEl.dataset.did);
                return;
            }
            case 'settings-account-switch': {
                e.preventDefault(); e.stopPropagation();
                switchAccount(actEl.dataset.did);
                return;
            }
            case 'settings-account-remove': {
                e.preventDefault(); e.stopPropagation();
                removeSavedAccount(actEl.dataset.did);
                return;
            }
            case 'settings-clear-cache': {
                e.preventDefault(); e.stopPropagation();
                clearAppCache();
                return;
            }
            case 'chat-load-convos': {
                e.preventDefault(); e.stopPropagation();
                fetchConvos(true);
                return;
            }
            case 'chat-retry-convos': {
                e.preventDefault(); e.stopPropagation();
                fetchConvos(false);
                return;
            }
            case 'chat-load-more': {
                e.preventDefault(); e.stopPropagation();
                loadConvo(currentConvoId, { prepend: true });
                return;
            }
            case 'remove-img': {
                e.preventDefault(); e.stopPropagation();
                const idx = parseInt(actEl.dataset.idx, 10);
                if (selectedImages[idx]?.url) URL.revokeObjectURL(selectedImages[idx].url);
                selectedImages.splice(idx, 1);
                updateImagePreview();
                scheduleDraftSave();
                return;
            }
            case 'move-img': {
                e.preventDefault(); e.stopPropagation();
                const idx = parseInt(actEl.dataset.idx, 10);
                const dir = parseInt(actEl.dataset.dir, 10);
                const tmp = selectedImages[idx];
                selectedImages[idx] = selectedImages[idx + dir];
                selectedImages[idx + dir] = tmp;
                updateImagePreview();
                scheduleDraftSave();
                return;
            }
            case 'prevent-click':
                e.stopPropagation();
                return;
            case 'unmod': {
                e.preventDefault(); e.stopPropagation();
                const modType = actEl.dataset.type;
                const targetDid = actEl.dataset.did;
                actEl.disabled = true; actEl.textContent = '処理中';
                if (modType === 'Mute') {
                    api.unmute(targetDid)
                        .then(() => { actEl.textContent = '解除済'; actEl.style.cssText = 'color:gray;border:1px solid gray;border-radius:15px;padding:4px 12px;'; })
                        .catch(err => { alert('Failed: ' + err.message); actEl.disabled = false; actEl.textContent = '解除'; });
                } else {
                    api.getProfile(targetDid).then(p => {
                        if (p.data.viewer?.blocking) {
                            const rkey = p.data.viewer.blocking.split('/').pop();
                            return api.agent.com.atproto.repo.deleteRecord({ repo: api.session.did, collection: 'app.bsky.graph.block', rkey });
                        } else throw new Error('ブロック情報が見つかりません');
                    }).then(() => {
                        actEl.textContent = '解除済'; actEl.style.cssText = 'color:gray;border:1px solid gray;border-radius:15px;padding:4px 12px;';
                    }).catch(err => { alert('Failed: ' + err.message); actEl.disabled = false; actEl.textContent = '解除'; });
                }
                return;
            }
            case 'profile': {
                // モーダル等から呼ばれた場合のフォールバック
                if (!actEl.closest('.post') && actEl.dataset.actor) {
                    e.preventDefault(); e.stopPropagation();
                    window.loadProfile(actEl.dataset.actor);
                    const modal = document.getElementById('list-modal');
                    if (modal) modal.style.display = 'none';
                    return;
                }
                break;
            }
        }

        // ▼ ポスト内（タイムライン等）の処理 ▼
        const postEl = actEl.closest('.post');
        if (!postEl) return;
        e.preventDefault(); e.stopPropagation();

        const { uri, cid, rootUri, rootCid, handle } = postEl.dataset;
        const post = getStoredPost(uri);

        switch (act) {
            case 'profile':   window.loadProfile(actEl.dataset.actor || handle); break;
            case 'reply':     window.prepareReply(uri, cid, handle, rootUri, rootCid); break;
            case 'quote':     window.prepareQuote(uri, cid, handle, post?.record?.text || post?.value?.text || ''); break;
            case 'repost': {
                if (!post) break;
                const isReposted = !!post.viewer?.repost;
                const ogUri = post.viewer?.repost;
                
                actEl.classList.toggle('reposted', !isReposted);
                post.repostCount = Math.max(0, (post.repostCount || 0) + (isReposted ? -1 : 1));
                actEl.innerHTML = `${getIcon('repost')} ${post.repostCount || 0}`;
                post.viewer = post.viewer || {};
                post.viewer.repost = isReposted ? null : 'pending';
                
                actions.doRepost(uri, cid, ogUri || null).then(res => {
                    if (res && res.action === 'created') post.viewer.repost = res.uri;
                }).catch(() => { /* エラー時は無視 */ });
                break;
            }
            case 'like': {
                if (!post) break;
                const isLiked = !!post.viewer?.like;
                const ogUri = post.viewer?.like;
                
                actEl.classList.toggle('liked', !isLiked);
                post.likeCount = Math.max(0, (post.likeCount || 0) + (isLiked ? -1 : 1));
                actEl.innerHTML = `${getIcon('like')} ${post.likeCount || 0}`;
                post.viewer = post.viewer || {};
                post.viewer.like = isLiked ? null : 'pending';
                
                actions.doLike(uri, cid, ogUri || null).then(res => {
                    if (res && res.action === 'created') post.viewer.like = res.uri;
                }).catch(() => { /* エラー時は無視 */ });
                break;
            }
            case 'bookmark': {
                if (!post) break;
                const isBm = window.aeruneBookmarks.has(post.uri) || !!post.viewer?.bookmark;
                
                actEl.classList.toggle('bookmarked', !isBm);
                if (isBm) window.aeruneBookmarks.delete(post.uri);
                else window.aeruneBookmarks.add(post.uri);
                
                post.viewer = post.viewer || {};
                post.viewer.bookmark = isBm ? null : 'bookmarked';
                actEl.innerHTML = getIcon('bookmark');
                
                actions.toggleBookmark(post);
                break;
            }
            case 'delete': {
                if (confirm(t('delete_confirm'))) {
                    postEl.style.display = 'none';
                    actions.deletePost(uri).catch(() => {
                        postEl.style.display = '';
                    });
                }
                break;
            }
            case 'open-image': {
                if (actEl.classList.contains('nsfw-blur')) {
                    actEl.classList.remove('nsfw-blur');
                    break;
                }
                const gid = actEl.dataset.gid;
                const idx = parseInt(actEl.dataset.idx || '0', 10);
                const images = gid ? getImageSet(gid) : [];
                window.openModal(images.length ? images : (actEl.dataset.url || actEl.dataset.fullsize || ''), Number.isInteger(idx) ? idx : 0);
                break;
            }
            case 'open-quote': {
                const rec = getStoredQuote(actEl.dataset.qid);
                if (rec) window.openQuoteModal(e, rec);
                break;
            }
        }
    }, true);

    document.addEventListener('input', e => {
        const input = e.target.closest('input[data-alt-idx]');
        if (!input) return;
        const idx = parseInt(input.dataset.altIdx, 10);
        if (!Number.isInteger(idx) || !selectedImages[idx]) return;
        selectedImages[idx].alt = input.value;
        scheduleDraftSave();
    });

    document.addEventListener('dblclick', e => {
        if (hasSelection()) return;
        const postEl = e.target.closest('.post');
        if (!postEl || e.target.closest('a,[data-act]')) return;
        if (postEl.dataset.notif === '1') {
            postEl.dataset.reason === 'follow'
                ? window.loadProfile(postEl.dataset.actor)
                : postEl.dataset.thread && window.loadThread(postEl.dataset.thread);
            return;
        }
        if (postEl.dataset.noThread === '1') return;
        if (postEl.dataset.uri) window.loadThread(postEl.dataset.uri);
    }, true);

    document.addEventListener('contextmenu', e => {
        const postEl = e.target.closest('.post');
        if (!postEl || hasSelection()) return;
        e.preventDefault(); e.stopPropagation();

        if (e.target.tagName === 'IMG') {
            window.showContextMenu(e.clientX, e.clientY, [
                { label: t('save_image'), action: () => downloadImage(e.target.dataset.fullsize || e.target.src) }
            ]);
            return;
        }

        const { uri, did, actor, reason, thread, following, muted, blocking } = postEl.dataset;

        if (postEl.dataset.notif === '1') {
            const isMe = api.session && did === api.session.did;
            const opts = [];
            if (reason !== 'follow' && thread) opts.push({ label: t('nav_thread'), action: () => window.loadThread(thread) });
            opts.push({ label: t('ctx_profile'), action: () => window.loadProfile(actor) });
            if (!isMe) {
                opts.push({ divider: true });
                opts.push({ label: following ? t('ctx_unfollow') : t('ctx_follow'), action: () => actions.toggleFollow(did, following) });
                opts.push({ label: muted     ? t('ctx_unmute')   : t('ctx_mute'),   action: () => actions.toggleMute(did, muted) });
                opts.push({ label: blocking  ? t('ctx_unblock')  : t('ctx_block'),  action: () => actions.toggleBlock(did, blocking), color: '#d93025' });
            }
            if (opts.length) window.showContextMenu(e.clientX, e.clientY, opts);
            return;
        }

        const post = getStoredPost(uri);
        if (!post) return;

        const au = post.author;
        const pv = post.viewer || {};
        const av = au.viewer || {};
        const root = post.record?.reply?.root || { uri: post.uri, cid: post.cid };
        const isMe2 = api.session && au.did === api.session.did;
        const isBm  = window.aeruneBookmarks.has(post.uri) || !!pv.bookmark;
        const bodyText = postText(post).trim();

        const opts = [
            { label: t('ctx_reply'),    action: () => window.prepareReply(post.uri, post.cid, au.handle, root.uri, root.cid) },
            { label: t('ctx_repost'),   action: () => actions.doRepost(post.uri, post.cid, pv.repost || null) },
            { label: t('ctx_quote'),    action: () => window.prepareQuote(post.uri, post.cid, au.handle, post.record?.text || '') },
            { divider: true },
            { label: isBm ? t('ctx_unbookmark') : t('ctx_bookmark'), action: () => actions.toggleBookmark(post) },
            { label: t('ctx_copy_url'), action: () => copyPlainText(postPermalink(post)) },
            { label: t('ctx_copy_text'), action: () => copyPlainText(postText(post)) },
            ...(bodyText ? [{ label: t('ctx_translate_deepl'), action: () => openPostInDeepL(post) }] : []),
            { label: t('ctx_send_dm'), action: () => sendPostByDirectMessage(post) },
            { divider: true },
            { label: t('ctx_profile'),  action: () => window.loadProfile(au.handle) },
        ];
        if (isMe2) {
            opts.push({ divider: true });
            opts.push({ label: `${t('ctx_pin')} / ${t('ctx_unpin')}`, action: () => actions.togglePin(post) });
        } else {
            opts.push({ divider: true });
            opts.push({ label: av.following ? t('ctx_unfollow') : t('ctx_follow'), action: () => actions.toggleFollow(au.did, av.following) });
            opts.push({ label: av.muted     ? t('ctx_unmute')   : t('ctx_mute'),   action: () => actions.toggleMute(au.did, av.muted) });
            opts.push({ label: av.blocking  ? t('ctx_unblock')  : t('ctx_block'),  action: () => actions.toggleBlock(au.did, av.blocking), color: '#d93025' });
            opts.push({ label: t('ctx_report'), action: () => reportPostFromMenu(post), color: '#d93025' });
        }
        window.showContextMenu(e.clientX, e.clientY, opts);
    }, true);
}

// ─── ビュー切り替え ───────────────────────────────────────────────
let _activeView = null;
const ALL_VIEWS = () => [els.timelineDiv, els.feedsView, els.notifDiv, els.chatView, els.searchView, els.profileView, els.threadView, els.settingsView, els.bookmarksView];

function switchView(viewId, activeDiv) {
    if (!els.viewTitle) return;

    els.viewTitle.setAttribute('data-i18n', 'nav_' + viewId);
    els.viewTitle.textContent = t('nav_' + viewId);

    if (_activeView !== activeDiv) {
        if (_activeView === els.timelineDiv && activeDiv !== els.timelineDiv) viewLoader?.saveTimelineScroll();
        if (_activeView) _activeView.classList.add('hidden');
        ALL_VIEWS().forEach(d => { if (d && d !== activeDiv) d.classList.add('hidden'); });
        if (activeDiv) activeDiv.classList.remove('hidden');
    }
    _activeView = activeDiv;

    document.querySelectorAll('.nav-links li').forEach(li => li.classList.remove('active'));
    document.getElementById(`nav-${viewId}`)?.classList.add('active');
    if (els.timelineSourceBar) {
        els.timelineSourceBar.classList.toggle('hidden', viewId !== 'home');
    }
    renderTimelineNotice();
    if (els.dropZone) {
        els.dropZone.style.display = ['chat', 'settings', 'bookmarks', 'feeds'].includes(viewId) ? 'none' : '';
    }
}

// ─── 翻訳 ─────────────────────────────────────────────────────────
function applyTranslations() {
    applyDisplayPreferences();
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); });
    document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.getAttribute('data-i18n-title')); });
    if (els.videoPickBtn) els.videoPickBtn.title = t('video_select');
    refreshLocalizedDynamicUi();
}

function refreshLocalizedDynamicUi() {
    if (els.viewTitle) {
        const key = els.viewTitle.getAttribute('data-i18n');
        if (key) els.viewTitle.textContent = t(key);
    }
    document.querySelectorAll('.post-timestamp[data-ts]').forEach(el => {
        el.textContent = window.aeruneTimeFormat === 'absolute'
            ? new Date(el.dataset.ts).toLocaleString(currentLang)
            : formatRelative(new Date(el.dataset.ts), currentLang);
    });
    renderTimelineNotice();
    renderFeedControls();
    if (els.feedsView && !els.feedsView.classList.contains('hidden')) renderFeedsView();
    renderMuteRulesList();
    renderSettingsAccounts();
    renderLocalListSettings();
    updateVideoPreview();
    renderQuotePreview();
}

// ─── 投稿フォーム ─────────────────────────────────────────────────
function resetPostForm() {
    els.postInput.value = '';
    els.postInput.placeholder = t('post_placeholder');
    els.quotePreview.classList.add('hidden');
    els.quotePreview.innerHTML = '';
    selectedImages.forEach(obj => { if (obj.url) URL.revokeObjectURL(obj.url); });
    selectedImages = []; replyTarget = null; quoteTarget = null; autoQuoteUrl = null;
    clearVideo(false);
    updateImagePreview();
    hidePostProgress();
    deleteDraft();
}
window.resetPostForm = resetPostForm;

function updateImagePreview() {
    if (!els.imagePreviewContainer) return;
    const frag = document.createDocumentFragment();
    selectedImages.forEach((obj, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'img-preview-wrap';
        wrap.innerHTML =
            `<img src="${obj.url}" title="クリックで削除" style="cursor:pointer;" data-act="remove-img" data-idx="${i}">` +
            `<div class="img-controls">` +
            `<button data-act="move-img" data-idx="${i}" data-dir="-1" ${i===0?'disabled':''}>◀</button>` +
            `<input type="text" placeholder="ALT" value="${escAttr(obj.alt || '')}" data-act="prevent-click" data-alt-idx="${i}">` +
            `<button data-act="move-img" data-idx="${i}" data-dir="1" ${i===selectedImages.length-1?'disabled':''}>▶</button>` +
            `<button data-act="remove-img" data-idx="${i}" style="color:#ff6b6b;font-weight:bold;">✖</button>` +
            `</div>`;
        frag.appendChild(wrap);
    });
    els.imagePreviewContainer.textContent = '';
    els.imagePreviewContainer.appendChild(frag);
}

async function processIncomingImages(files) {
    if (!files?.length) return;
    if (selectedVideo) return alert(t('video_with_images_error'));
    for (const f of files) {
        if (selectedImages.length >= 4) break;
        const c = await compressImage(f);
        selectedImages.push({ id: Date.now() + Math.random(), file: f, url: URL.createObjectURL(f), blob: c.blob, width: c.width, height: c.height, alt: '' });
    }
    updateImagePreview();
    scheduleDraftSave();
}

// ─── 投稿送信 ─────────────────────────────────────────────────────
async function sendPost() {
    const text = els.postInput.value.trim();
    if (isPosting) return;
    if (!text && !selectedImages.length && !selectedVideo && !quoteTarget) return;
    if (selectedImages.length && selectedVideo) return alert(t('video_with_images_error'));

    const rt = new RichText({ text });
    await rt.detectFacets(api.agent);
    if (rt.graphemeLength > 300) {
        alert(t('post_too_long', rt.graphemeLength - 300));
        return;
    }

    const btn = document.getElementById('post-btn');
    postAbortController = new AbortController();
    isPosting = true;
    let preparedVideo = null;
    try {
        if (btn) btn.disabled = true;
        let imagesEmbed, videoEmbed, finalEmbed;

        if (selectedVideo) {
            preparedVideo = await compressSelectedVideoForUpload();
            if (preparedVideo.size > VIDEO_UPLOAD_MAX_BYTES) throw new Error(t('video_too_large', formatBytes(preparedVideo.size)));
            showPostProgress(t('video_uploading', '0'));
            const videoBlob = await api.uploadVideoToBluesky(preparedVideo.blob, {
                name: preparedVideo.name || `video_${Date.now()}.mp4`,
                signal: postAbortController.signal,
                onProgress: (progress) => {
                    if (progress >= 0.75 && progress < 1) {
                        showPostProgress(t('video_processing'));
                    } else {
                        showPostProgress(t('video_uploading', String(Math.round(progress * 100))));
                    }
                }
            });
            videoEmbed = {
                $type: 'app.bsky.embed.video',
                video: videoBlob
            };
            if (preparedVideo.width > 0 && preparedVideo.height > 0) {
                videoEmbed.aspectRatio = {
                    width: Math.round(preparedVideo.width),
                    height: Math.round(preparedVideo.height)
                };
            }
        } else if (selectedImages.length) {
            const blobs = [];
            for (const obj of selectedImages) {
                const res = await api.uploadBlob(new Uint8Array(await obj.blob.arrayBuffer()));
                blobs.push({ image: res.data.blob, alt: obj.alt || '', aspectRatio: { width: obj.width, height: obj.height } });
            }
            imagesEmbed = { $type: 'app.bsky.embed.images', images: blobs };
        }

        if (quoteTarget) {
            const rec = { $type: 'app.bsky.embed.record', record: { uri: quoteTarget.uri, cid: quoteTarget.cid } };
            const media = videoEmbed || imagesEmbed;
            finalEmbed = media
                ? { $type: 'app.bsky.embed.recordWithMedia', media, record: rec }
                : rec;
        } else {
            finalEmbed = videoEmbed || imagesEmbed;
        }

        let actualReplyTarget = replyTarget;
        if (!actualReplyTarget && !els.threadView.classList.contains('hidden') && nav.current?.type === 'thread') {
            const threadPost = getStoredPost(nav.current.uri);
            if (threadPost) {
                const rootUri = threadPost.record?.reply?.root?.uri || threadPost.uri;
                const rootCid = threadPost.record?.reply?.root?.cid || threadPost.cid;
                actualReplyTarget = {
                    uri: threadPost.uri,
                    cid: threadPost.cid,
                    root: { uri: rootUri, cid: rootCid }
                };
            }
        }

        const postData = { text: rt.text, facets: rt.facets, embed: finalEmbed, createdAt: new Date().toISOString() };
        if (actualReplyTarget) postData.reply = { root: actualReplyTarget.root, parent: { uri: actualReplyTarget.uri, cid: actualReplyTarget.cid } };

        showPostProgress(t('send'));
        await api.post(postData);
        resetPostForm();
        
        setTimeout(() => {
            if (!els.threadView.classList.contains('hidden') && nav.current?.type === 'thread') {
                viewLoader.loadThread(nav.current.uri);
            } else if (!els.profileView.classList.contains('hidden') && nav.current?.type === 'profile') {
                viewLoader.loadProfile(nav.current.actor);
            } else {
                viewLoader.fetchTimeline();
            }
        }, 500);
    } catch (e) {
        console.error('sendPost:', e);
        if (e.name === 'AbortError') {
            showPostProgress(t('cancel'), false);
        } else {
            hidePostProgress();
            alert(selectedVideo ? `${t('video_failed')}\n${e.message || e}` : t('post_failed'));
        }
    } finally {
        if (btn) btn.disabled = false;
        isPosting = false;
        postAbortController = null;
        try { await preparedVideo?.cleanup?.(); }
        catch (cleanupError) { console.warn('video input cleanup:', cleanupError); }
        if (!els.postProgress?.classList.contains('hidden') && !selectedVideo) hidePostProgress();
    }
}

// ─── ログイン/アカウント ──────────────────────────────────────────
async function login() {    
    const id  = document.getElementById('id').value.trim();
    const pw  = document.getElementById('pw').value.trim();
    const btn = document.getElementById('login-btn');
    
    if (!id || !pw) return alert(t('login_empty'));

    try {
        btn.disabled = true; btn.innerText = 'Connecting...';
        const res = await api.login(id, pw);
        if (res.success) {
            savedAccounts = savedAccounts.filter(a => a.did !== res.data.did);
            savedAccounts.push(res.data);
            await ipcRenderer.invoke('save-session', savedAccounts);

            // 💡 ログイン成功したら入力欄を空にする
            document.getElementById('id').value = '';
            document.getElementById('pw').value = '';

            await switchAccount(res.data.did);
        }
    } catch (e) {
        const errStr = String(e.message || e).toLowerCase();
        
        if (errStr.includes('app password')) {
            if (confirm(t('login_app_pw_req'))) shell.openExternal('https://bsky.app/settings/app-passwords');
        } else if (errStr.includes('invalid identifier or password') || errStr.includes('unauthorized') || errStr.includes('authentication required')) {
            alert(t('login_invalid'));
        } else if (errStr.includes('rate limit')) {
            alert(t('login_rate_limit'));
        } else if (errStr.includes('fetch') || errStr.includes('network') || errStr.includes('failed to fetch')) {
            alert(t('login_network'));
        } else {
            const msg = `${t('login_failed')}\n\n${t('error_details')}\n${e.message || e}\n\n${t('login_unknown')}`;
            if (confirm(msg)) shell.openExternal('https://bsky.app');
        }
    } finally {
        btn.disabled = false;
        btn.innerText = t('login_btn');
    }
}

async function switchAccount(did) {
    const sess = savedAccounts.find(a => a.did === did);
    if (!sess) return;
    try {
        await api.resumeSession(sess);
        currentDid = did;
        const savedUnread = localStorage.getItem(notificationUnreadKey());
        if (savedUnread == null) {
            els.notifBadge?.classList.add('hidden');
        } else {
            setNotificationBadge(Number(savedUnread) || 0);
        }
        await syncMuteRulesFromServer();
        api.configureSubscribedLabelers().catch(e => console.warn('configureSubscribedLabelers:', e));
        stopTimelinePolling();
        resetTimelineNotice();
        els.loginForm.classList.add('hidden');
        if (els.app) els.app.style.opacity = '1';
        await configureFeedsForCurrentAccount(true);
        await restoreDraftForCurrentAccount();
        setupLoggedInUI();
        renderLocalListSettings();
        if (notifTimer) clearInterval(notifTimer);
        notifTimer = setInterval(checkNotifs, 30000);
    } catch { showLoginForm(); }
}

function showLoginForm() {
    stopTimelinePolling();
    els.loginForm.classList.remove('hidden');
    if (els.app) els.app.style.opacity = '0.3';
}

function renderAccountList() {
    const container = document.getElementById('account-list');
    if (!container) return;
    const frag = document.createDocumentFragment();
    for (const acc of savedAccounts) {
        const d = document.createElement('div');
        d.className = `account-item${acc.did === currentDid ? ' active' : ''}`;
        d.textContent = `@${acc.handle}`;
        d.onclick = () => { if (acc.did !== currentDid) switchAccount(acc.did); };
        frag.appendChild(d);
    }
    container.textContent = '';
    container.appendChild(frag);
    renderSettingsAccounts();
    renderLocalListSettings();
}

function renderSettingsAccounts() {
    const container = document.getElementById('settings-accounts-list');
    if (!container) return;
    if (!savedAccounts.length) {
        container.innerHTML = `<div class="settings-empty">${escHTML(t('accounts_none'))}</div>`;
        return;
    }
    container.innerHTML = savedAccounts.map(acc => {
        const active = acc.did === currentDid;
        return `<div class="settings-account-row${active ? ' active' : ''}">` +
            `<div class="settings-account-main">` +
            `<strong>${escHTML(acc.handle || acc.did)}</strong>` +
            `<span>${escHTML(acc.did || '')}</span>` +
            `</div>` +
            `<div class="settings-account-actions">` +
            `<button type="button" data-act="settings-account-switch" data-did="${escAttr(acc.did)}" ${active ? 'disabled' : ''}>${escHTML(active ? t('account_current') : t('account_switch'))}</button>` +
            `<button type="button" class="danger-action" data-act="settings-account-remove" data-did="${escAttr(acc.did)}">${escHTML(t('account_remove'))}</button>` +
            `</div>` +
            `</div>`;
    }).join('');
}

function renderLocalListSettings() {
    const container = document.getElementById('settings-local-list-list');
    const countEl = document.getElementById('settings-local-list-count');
    if (!container) return;
    const members = readLocalListMembers();
    if (countEl) countEl.textContent = t('locallist_count', String(members.length));
    if (!members.length) {
        container.innerHTML = `<div class="settings-empty">${escHTML(t('locallist_empty'))}</div>`;
        return;
    }
    container.innerHTML = members.map(member => {
        const title = member.displayName || member.handle || member.did;
        const handle = member.handle ? `@${member.handle}` : member.did;
        const addedAt = member.addedAt ? new Date(member.addedAt).toLocaleString(currentLang) : '';
        return `<div class="settings-local-list-row">` +
            `<img class="settings-local-list-avatar" src="${escAttr(member.avatar || '')}" alt="" loading="lazy" decoding="async">` +
            `<div class="settings-local-list-main">` +
            `<strong>${escHTML(title)}</strong>` +
            `<span>${escHTML(handle)}</span>` +
            `${addedAt ? `<small>${escHTML(t('locallist_added_at', addedAt))}</small>` : ''}` +
            `</div>` +
            `<div class="settings-account-actions">` +
            `<button type="button" data-act="profile" data-actor="${escAttr(member.did)}">${escHTML(t('locallist_open_profile'))}</button>` +
            `<button type="button" class="danger-action" data-act="local-list-remove" data-did="${escAttr(member.did)}">${escHTML(t('locallist_remove'))}</button>` +
            `</div>` +
            `</div>`;
    }).join('');
}

async function removeSavedAccount(did) {
    if (!did || !confirm(t('account_remove_confirm'))) return;
    const wasCurrent = did === currentDid;
    savedAccounts = savedAccounts.filter(acc => acc.did !== did);
    await ipcRenderer.invoke('save-session', savedAccounts);
    renderAccountList();
    renderSettingsAccounts();
    renderLocalListSettings();
    if (!wasCurrent) return;
    if (savedAccounts.length) {
        await switchAccount(savedAccounts[0].did);
    } else {
        currentDid = null;
        showLoginForm();
    }
}

async function clearAppCache() {
    if (!confirm(t('cache_clear_confirm'))) return;
    const prefixes = [
        'aerune_timeline_cache_',
        'aerune_timeline_scroll_',
        'aerune_post_draft_',
        'aerune_quote_url_'
    ];
    let removed = 0;
    for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && prefixes.some(prefix => key.startsWith(prefix))) {
            localStorage.removeItem(key);
            removed++;
        }
    }
    try {
        if (window.caches?.keys) {
            const names = await window.caches.keys();
            await Promise.all(names.map(name => window.caches.delete(name)));
        }
    } catch (e) {
        console.warn('clear renderer cache:', e);
    }
    try {
        await ipcRenderer.invoke('clear-cache');
    } catch (e) {
        console.warn('clear electron cache:', e);
    }
    clearStores();
    if (viewLoader) {
        viewLoader.cursors = { home: null, profile: null, search: null };
        viewLoader.exhausted = {};
        viewLoader.notificationCursor = null;
        viewLoader.notificationItems = [];
    }
    resetTimelineNotice();
    showToast(t('settings_cache'), removed ? t('cache_cleared_detail', String(removed)) : t('cache_cleared'));
    if (els.timelineDiv && !els.timelineDiv.classList.contains('hidden')) {
        refreshCurrentTimeline({ scrollToTop: true });
    }
}

async function setupLoggedInUI() {
    try {
        const res = await api.getProfile(api.session.did);
        const el = document.getElementById('profile-snippet');
        if (el) el.innerHTML =
            `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">` +
            `<img src="${res.data.avatar}" style="width:40px;height:40px;border-radius:50%;">` +
            `<strong>${res.data.displayName || res.data.handle}</strong></div>`;
    } catch {}
    renderAccountList();
    renderFeedControls();
    syncBookmarksData();
    checkNotifs();
    nav.push({ type: 'home' }); updateBackBtn();
    switchView('home', els.timelineDiv);
    viewLoader.fetchTimeline();
    startTimelinePolling();
}

async function syncBookmarksData() {
    try {
        const r = await fetch(`${api.pdsUrl}/xrpc/app.bsky.bookmark.getBookmarks?limit=100`, {
            headers: { 'Authorization': `Bearer ${api.session.accessJwt}` }
        });
        if (!r.ok) return;
        const data = await r.json();
        window.aeruneBookmarks.clear();
        for (const b of (data.bookmarks || [])) {
            const uri = b.subject?.uri || b.record?.uri;
            if (uri) window.aeruneBookmarks.add(uri);
        }
    } catch {}
}

async function checkNotifs() {
    try {
        const [countRes, listRes] = await Promise.all([
            api.countUnreadNotifications(),
            api.listNotifications(10).catch(() => ({ data: { notifications: [] } }))
        ]);
        const count = Number(countRes.data.count) || 0;
        const prevRaw = localStorage.getItem(notificationUnreadKey());
        const prev = prevRaw == null ? count : Number(prevRaw) || 0;
        const previousIdsRaw = localStorage.getItem(recentNotificationIdsKey());
        const previousIds = readRecentNotificationIds();
        const previousSet = new Set(previousIds);
        const latestNotifs = Array.isArray(listRes.data.notifications) ? listRes.data.notifications : [];
        const latestIds = latestNotifs.map(notificationFingerprint).filter(Boolean);
        const newIds = previousIdsRaw == null ? [] : latestIds.filter(id => !previousSet.has(id));
        setNotificationBadge(count);
        rememberNotificationIds([...latestIds, ...previousIds]);
        const toastCount = count > prev ? count - prev : newIds.length;
        if (toastCount > 0 && _activeView !== els.notifDiv) {
            showToast(t('notif_toast_title'), t('notif_toast_body', String(toastCount)));
        }
    } catch {}
}

// ─── ミュート/ブロックモーダル ────────────────────────────────────
window.showListModal = (title, fetcher, type) => {
    let modal = document.getElementById('list-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'list-modal';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;';
        modal.innerHTML =
            `<div style="background:white;width:400px;max-width:90%;max-height:80%;border-radius:12px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.2);">` +
            `<div style="padding:15px 20px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;font-weight:bold;font-size:1.1em;">` +
            `<span id="list-modal-title"></span><span style="cursor:pointer;color:gray;font-size:1.2em;" onclick="document.getElementById('list-modal').style.display='none'">✖</span></div>` +
            `<div id="list-modal-body" style="padding:15px;overflow-y:auto;flex:1;"></div></div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', e => { if (e.target.id === 'list-modal') modal.style.display = 'none'; });
    }
    document.getElementById('list-modal-title').textContent = title;
    const body = document.getElementById('list-modal-body');
    body.innerHTML = '<div style="text-align:center;color:gray;padding:20px;">Loading...</div>';
    modal.style.display = 'flex';

    fetcher().then(users => {
        if (!users?.length) {
            body.innerHTML = `<div style="text-align:center;color:gray;padding:20px;">${escHTML(t('list_empty'))}</div>`;
            return;
        }
        const frag = document.createDocumentFragment();
        for (const user of users) {
            const d = document.createElement('div');
            d.style.cssText = 'display:flex;align-items:center;padding:10px 0;border-bottom:1px solid #f0f0f0;';
            const actionLabel = type === 'Block' ? t('ctx_unblock') : t('ctx_unmute');
            const action = type
                ? `<button class="action-btn" data-act="unmod" data-type="${escAttr(type)}" data-did="${escAttr(user.did)}" style="color:#d93025;border:1px solid #d93025;border-radius:15px;padding:4px 12px;font-weight:bold;opacity:1;">${escHTML(actionLabel)}</button>`
                : '';
            d.innerHTML =
                `<img src="${escAttr(user.avatar||'')}" class="action-btn" data-act="profile" data-actor="${escAttr(user.did || user.handle)}" style="width:40px;height:40px;border-radius:50%;margin-right:12px;background:#eee;cursor:pointer;padding:0;">` +
                `<div style="flex:1;overflow:hidden;">` +
                `<div class="action-btn" data-act="profile" data-actor="${escAttr(user.did || user.handle)}" style="font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;padding:0;color:inherit;">${escHTML(user.displayName||user.handle||user.did)}</div>` +
                `<div style="color:gray;font-size:.85em;">@${escHTML(user.handle||user.did)}</div></div>` +
                action;
            frag.appendChild(d);
        }
        body.textContent = '';
        body.appendChild(frag);
    }).catch(err => {
        body.innerHTML = `<div style="color:red;padding:20px;">Error: ${err.message}</div>`;
    });
};

window.showMutes  = () => actions.showMutes(t);
window.showBlocks = () => actions.showBlocks(t);

window.openProfileRelations = (actor, relation) => {
    const mode = relation === 'followers' ? 'followers' : 'follows';
    const title = mode === 'followers' ? t('stats_followers') : t('stats_following');
    window.showListModal(title, async () => {
        const res = mode === 'followers'
            ? await api.getFollowers(actor, 100)
            : await api.getFollows(actor, 100);
        return res.data.followers || res.data.follows || [];
    }, null);
};

function showHtmlModal(title, html) {
    let modal = document.getElementById('html-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'html-modal';
        modal.className = 'html-modal';
        modal.innerHTML =
            `<div class="html-modal-content">` +
            `<div class="html-modal-title"><span id="html-modal-title"></span><button type="button" id="html-modal-close">x</button></div>` +
            `<div id="html-modal-body"></div>` +
            `</div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });
        modal.querySelector('#html-modal-close').onclick = () => modal.classList.remove('show');
    }
    modal.querySelector('#html-modal-title').textContent = title;
    modal.querySelector('#html-modal-body').innerHTML = html;
    modal.classList.add('show');
}

async function subscribeModerationList(mode) {
    const input = document.getElementById('mod-list-uri');
    const listUri = input?.value.trim();
    if (!listUri) return;
    try {
        if (mode === 'block') await api.blockActorList(listUri);
        else await api.muteActorList(listUri);
        if (input) input.value = '';
        showToast(t('settings_moderation'), mode === 'block' ? t('mod_list_block_done') : t('mod_list_mute_done'));
    } catch (e) {
        alert(e.message || e);
    }
}

async function unsubscribeModerationList(mode, value) {
    if (!value) return;
    try {
        if (mode === 'block') await api.unblockActorList(value);
        else await api.unmuteActorList(value);
        showToast(t('settings_moderation'), t('action_success'));
        showModerationLists(mode);
    } catch (e) {
        alert(e.message || e);
    }
}

async function showModerationLists(mode) {
    try {
        const res = mode === 'block' ? await api.getListBlocks(50) : await api.getListMutes(50);
        const lists = res.data.lists || [];
        const empty = `<div class="mod-status">${escHTML(t('feeds_none'))}</div>`;
        const html = lists.length ? lists.map(list => {
            const creator = list.creator?.handle ? `@${list.creator.handle}` : '';
            const action = mode === 'block'
                ? `<button type="button" data-act="mod-list-unblock" data-block-uri="${escAttr(list.viewer?.blocked || '')}">${escHTML(t('ctx_unblock'))}</button>`
                : `<button type="button" data-act="mod-list-unmute" data-uri="${escAttr(list.uri)}">${escHTML(t('ctx_unmute'))}</button>`;
            return `<div class="mod-list-row">` +
                `<img src="${escAttr(list.avatar || '')}" alt="">` +
                `<div><strong>${escHTML(list.name || list.uri)}</strong><span>${escHTML(creator)}</span></div>` +
                action +
                `</div>`;
        }).join('') : empty;
        showHtmlModal(mode === 'block' ? t('settings_block_lists') : t('settings_mute_lists'), html);
    } catch (e) {
        alert(e.message || e);
    }
}

async function subscribeLabelerFromSettings() {
    const input = document.getElementById('labeler-did');
    const value = input?.value.trim();
    if (!value) return;
    try {
        await api.subscribeLabeler(value);
        if (input) input.value = '';
        showToast(t('settings_labelers'), t('labeler_subscribed'));
    } catch (e) {
        alert(e.message || e);
    }
}

async function unsubscribeLabeler(did) {
    if (!did) return;
    try {
        await api.unsubscribeLabeler(did);
        showToast(t('settings_labelers'), t('action_success'));
        showSubscribedLabelers();
    } catch (e) {
        alert(e.message || e);
    }
}

async function showSubscribedLabelers() {
    try {
        const dids = await api.getSubscribedLabelerDids();
        const services = dids.length ? (await api.getLabelerServices(dids)).data.views || [] : [];
        const known = new Map(services.map(item => [item.creator?.did, item]));
        const html = dids.length ? dids.map(did => {
            const labeler = known.get(did);
            const creator = labeler?.creator || { did, handle: did };
            return `<div class="mod-list-row">` +
                `<img src="${escAttr(creator.avatar || '')}" alt="">` +
                `<div><strong>${escHTML(creator.displayName || creator.handle || did)}</strong><span>${escHTML(creator.handle ? '@' + creator.handle : did)}</span></div>` +
                `<button type="button" data-act="labeler-unsubscribe" data-did="${escAttr(did)}">${escHTML(t('labeler_unsubscribe'))}</button>` +
                `</div>`;
        }).join('') : `<div class="mod-status">${escHTML(t('labeler_empty'))}</div>`;
        showHtmlModal(t('settings_labelers'), html);
    } catch (e) {
        alert(e.message || e);
    }
}

// ─── チャット ─────────────────────────────────────────────────────
async function fetchConvos(isAppend = false) {
    if (chatState.convoLoading) return;
    if (!isAppend) {
        chatState.convoCursor = null;
        chatState.convoExhausted = false;
        if (els.convoList) els.convoList.innerHTML = `<div class="chat-status">${escHTML(t('chat_loading'))}</div>`;
    }
    if (isAppend && chatState.convoExhausted) return;
    chatState.convoLoading = true;
    try {
        els.convoList?.querySelector('.chat-load-more')?.remove();
        const params = { limit: 20 };
        if (isAppend && chatState.convoCursor) params.cursor = chatState.convoCursor;
        const res = await api.getChatAgent().chat.bsky.convo.listConvos(params);
        chatState.convoCursor = res.data.cursor || null;
        chatState.convoExhausted = !chatState.convoCursor;
        const frag = document.createDocumentFragment();
        for (const convo of (res.data.convos || [])) {
            const other = convo.members.find(m => m.did !== api.session.did);
            if (!other) continue;
            const d = document.createElement('div');
            d.className = `convo-item${convo.id === currentConvoId ? ' active' : ''}`;
            const preview = convo.lastMessage?.text ? `<div class="convo-preview">${escHTML(convo.lastMessage.text)}</div>` : '';
            d.innerHTML = `<img src="${escAttr(other.avatar||'')}" style="width:40px;border-radius:50%;"> <div class="convo-summary"><strong>${escHTML(other.displayName||other.handle)}</strong>${preview}</div>`;
            d.onclick = () => loadConvo(convo.id);
            frag.appendChild(d);
        }
        if (!isAppend) els.convoList.textContent = '';
        els.convoList.appendChild(frag);
        if (!isAppend && !(res.data.convos || []).length) {
            els.convoList.innerHTML = `<div class="chat-status">${escHTML(t('chat_empty'))}</div>`;
        } else if (chatState.convoCursor) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'chat-load-more';
            btn.dataset.act = 'chat-load-convos';
            btn.textContent = t('chat_load_more');
            els.convoList.appendChild(btn);
        }
    } catch (e) {
        console.error('fetchConvos:', e);
        if (!isAppend && els.convoList) {
            els.convoList.innerHTML = `<div class="chat-status chat-error">${escHTML(t('chat_failed'))}<button type="button" data-act="chat-retry-convos">${escHTML(t('retry'))}</button></div>`;
        }
    } finally {
        chatState.convoLoading = false;
    }
}

async function loadConvo(convoId, options = {}) {
    if (!convoId) return;
    const prepend = !!options.prepend;
    if (chatState.messageLoadingByConvoId.has(convoId)) return;
    if (!prepend) {
        currentConvoId = convoId;
        chatState.messageCursorByConvoId.delete(convoId);
        chatState.messageExhaustedByConvoId.delete(convoId);
        if (els.chatMessages) els.chatMessages.innerHTML = `<div class="chat-status">${escHTML(t('chat_loading'))}</div>`;
    }
    const cursor = prepend ? chatState.messageCursorByConvoId.get(convoId) : null;
    if (prepend && !cursor) return;
    chatState.messageLoadingByConvoId.add(convoId);
    if (els.chatInputArea) els.chatInputArea.classList.remove('hidden');
    try {
        const chatAgent = api.getChatAgent();
        els.chatMessages?.querySelector('.chat-load-older')?.remove();
        const msgParams = { convoId, limit: 50 };
        if (cursor) msgParams.cursor = cursor;
        const [convoRes, msgRes] = await Promise.all([
            chatAgent.chat.bsky.convo.getConvo({ convoId }),
            chatAgent.chat.bsky.convo.getMessages(msgParams)
        ]);
        const other = convoRes.data.convo.members.find(m => m.did !== api.session.did);
        if (other && els.chatHeader) {
            els.chatHeader.innerHTML = `<img src="${escAttr(other.avatar||'')}" style="width:30px;height:30px;border-radius:50%;vertical-align:middle;margin-right:10px;" loading="lazy"> <strong>${escHTML(other.displayName||other.handle)}</strong>`;
        }
        chatState.messageCursorByConvoId.set(convoId, msgRes.data.cursor || '');
        if (!msgRes.data.cursor) chatState.messageExhaustedByConvoId.add(convoId);
        const frag = document.createDocumentFragment();
        const previousHeight = els.chatMessages?.scrollHeight || 0;
        for (const msg of (msgRes.data.messages || []).slice().reverse()) {
            const isMine = msg.sender.did === api.session.did;
            const b = document.createElement('div');
            b.style.cssText = `margin:5px;padding:8px;border-radius:10px;align-self:${isMine?'flex-end':'flex-start'};background:${isMine?'#0085ff':'#eee'};color:${isMine?'white':'black'};max-width:80%;word-break:break-word;`;
            let html = linkify(msg.text || '');
            if (isMine) html = html.replace(/color:var\(--bsky-blue\);/g, 'color:white;text-decoration:underline;');
            b.innerHTML = html;
            frag.appendChild(b);
        }
        if (!prepend) {
            els.chatMessages.textContent = '';
            if (msgRes.data.cursor) {
                const loadOlder = document.createElement('button');
                loadOlder.type = 'button';
                loadOlder.className = 'chat-load-older';
                loadOlder.dataset.act = 'chat-load-more';
                loadOlder.textContent = t('chat_load_older');
                els.chatMessages.appendChild(loadOlder);
            }
            els.chatMessages.appendChild(frag);
            els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
        } else {
            const first = els.chatMessages.firstChild;
            if (msgRes.data.cursor) {
                const loadOlder = document.createElement('button');
                loadOlder.type = 'button';
                loadOlder.className = 'chat-load-older';
                loadOlder.dataset.act = 'chat-load-more';
                loadOlder.textContent = t('chat_load_older');
                els.chatMessages.insertBefore(loadOlder, first);
            }
            els.chatMessages.insertBefore(frag, first);
            els.chatMessages.scrollTop = (els.chatMessages.scrollHeight || 0) - previousHeight;
        }
    } catch (e) {
        console.error('loadConvo:', e);
        if (!prepend && els.chatMessages) {
            els.chatMessages.innerHTML = `<div class="chat-status chat-error">${escHTML(t('chat_failed'))}</div>`;
        }
    } finally {
        chatState.messageLoadingByConvoId.delete(convoId);
    }
}

const sendChatMessage = async () => {
    const input = document.getElementById('chat-msg-input');
    if (!input?.value.trim() || !currentConvoId) return;
    const text = input.value.trim();
    input.value = '';
    try {
        await api.getChatAgent().chat.bsky.convo.sendMessage({ convoId: currentConvoId, message: { text } });
        loadConvo(currentConvoId);
    } catch { alert(t('dm_failed')); input.value = text; }
};

window.startDirectMessage = async (did) => {
    try {
        const [profile, availability] = await Promise.all([
            api.getProfile(did),
            api.getConvoAvailability(did).catch(() => ({ data: { canChat: false } }))
        ]);
        if (!availability.data?.canChat) {
            alert(t('dm_unavailable'));
            return;
        }
        nav.push({ type: 'chat' }, _activeView); updateBackBtn();
        switchView('chat', els.chatView);
        const convoId = availability.data.convo?.id || (await api.getChatAgent().chat.bsky.convo.getConvoForMembers({ members: [did] })).data.convo.id;
        if (els.chatHeader) {
            els.chatHeader.innerHTML = `<img src="${escAttr(profile.data.avatar||'')}" style="width:30px;height:30px;border-radius:50%;vertical-align:middle;margin-right:10px;"> <strong>${escHTML(profile.data.displayName||profile.data.handle)}</strong>`;
        }
        await fetchConvos();
        loadConvo(convoId);
    } catch (e) {
        console.error('startDirectMessage:', e);
        alert(`${t('dm_failed')}\n${e.message || e}`);
    }
};

window.downloadImage = downloadImage;

// ─── 初期化 ───────────────────────────────────────────────────────
function startRelativeTimeTicker() {
    setInterval(() => {
        if (window.aeruneTimeFormat === 'absolute') return;
        document.querySelectorAll('.post-timestamp[data-ts]').forEach(el => {
            el.textContent = formatRelative(new Date(el.dataset.ts), currentLang);
        });
    }, 60000);
}

async function initApp() {
    // 💡 時間更新タイマーを起動
    startRelativeTimeTicker();

    // 一番下までスクロールしたら次を読み込む
    const contentEl = document.querySelector('.content');
    
    // 監視用のダミー要素（センチネル）を作成して末尾（投稿フォームの手前）に配置
    const sentinel = document.createElement('div');
    sentinel.id = 'scroll-sentinel';
    sentinel.style.height = '1px';
    contentEl.insertBefore(sentinel, document.getElementById('drop-zone'));

    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            // ダミー要素が画面（下から300px）に入ったらAppend発火
            if (!els.timelineDiv.classList.contains('hidden')) viewLoader.fetchTimeline(true);
            else if (!els.profileView.classList.contains('hidden')) viewLoader.loadProfile(nav.current?.actor, true);
            else if (!els.searchView.classList.contains('hidden')) window.execSearch(document.getElementById('search-input').value, true); 
            else if (!els.notifDiv.classList.contains('hidden')) viewLoader.fetchNotifications(true);
        }
    }, {
        root: contentEl,
        rootMargin: '0px 0px 300px 0px' // 下から300pxの位置で交差判定
    });
    observer.observe(sentinel);

    const get = id => document.getElementById(id);

    Object.assign(els, {
        app:                   get('app'),
        contentEl:             contentEl,
        timelineDiv:           get('timeline'),
        timelineSourceBar:      get('timeline-source-bar'),
        timelineNotice:         get('timeline-notice'),
        feedsView:              get('feeds-view'),
        notifDiv:              get('notifications'),
        notifBadge:            get('notif-badge'),
        chatView:              get('chat-view'),
        convoList:             get('convo-list'),
        chatHeader:            get('chat-header'),
        chatMessages:          get('chat-messages'),
        chatInputArea:         get('chat-input-area'),
        searchView:            get('search-view'),
        profileView:           get('profile-view'),
        threadView:            get('thread-view'),
        settingsView:          get('settings-view'),
        viewTitle:             get('view-title'),
        postInput:             get('post-input'),
        videoInput:            get('video-input'),
        videoPickBtn:          get('video-pick-btn'),
        videoPreviewContainer: get('video-preview-container'),
        postProgress:          get('post-progress'),
        loginForm:             get('login-form'),
        dropZone:              get('drop-zone'),
        quotePreview:          get('quote-preview'),
        imagePreviewContainer: get('image-preview-container'),
        ctxMenu:               get('ctx-menu'),
        refreshBtn:            get('refresh-btn'),
        quoteModal:            get('quote-modal'),
        quoteModalBody:        get('quote-modal-body'),
    });

    els.bookmarksView = get('bookmarks-view') || (() => {
        const v = document.createElement('div');
        v.id = 'bookmarks-view'; v.className = 'content hidden';
        els.timelineDiv.parentNode.appendChild(v);
        return v;
    })();

    initModules();
    installDelegates();

    let scrollSaveTimer = null;
    contentEl?.addEventListener('scroll', () => {
        if (scrollSaveTimer) return;
        scrollSaveTimer = setTimeout(() => {
            viewLoader?.saveTimelineScroll();
            scrollSaveTimer = null;
        }, 250);
    });

    if (els.refreshBtn) {
        els.refreshBtn.innerHTML = getIcon('refresh');
        els.refreshBtn.addEventListener('click', () => {
            if (!els.timelineDiv.classList.contains('hidden'))     refreshCurrentTimeline();
            else if (els.feedsView && !els.feedsView.classList.contains('hidden'))
                                                                    refreshFeedPreferences().then(loadSuggestedFeeds);
            else if (!els.notifDiv.classList.contains('hidden'))   viewLoader.fetchNotifications();
            else if (!els.chatView.classList.contains('hidden'))   fetchConvos();
            else if (els.bookmarksView && !els.bookmarksView.classList.contains('hidden'))
                                                                    viewLoader.fetchBookmarks();
        });
    }

    document.querySelectorAll('img[src*="image.svg"]').forEach(img => {
        const span = document.createElement('span');
        span.className = img.className || 'icon-btn';
        span.innerHTML = getIcon('image');
        span.style.cursor = 'pointer';
        img.replaceWith(span);
        span.addEventListener('click', () => get('image-input')?.click());
    });

    if (els.videoPickBtn) {
        els.videoPickBtn.innerHTML = getIcon('video');
        els.videoPickBtn.title = t('video_select');
        els.videoPickBtn.addEventListener('click', () => els.videoInput?.click());
    }

    if (els.viewTitle && !get('back-btn')) {
        const b = document.createElement('button');
        b.id = 'back-btn'; b.className = 'icon-btn'; b.textContent = '◀';
        b.style.cssText = 'display:none;margin-right:10px;';
        b.onclick = goBack;
        els.viewTitle.parentNode.insertBefore(b, els.viewTitle);
    }

    if (!get('nav-bookmarks')) {
        const li = document.createElement('li');
        li.id = 'nav-bookmarks'; li.setAttribute('data-i18n', 'nav_bookmarks');
        li.textContent = t('nav_bookmarks');
        li.onclick = () => { nav.push({ type: 'bookmarks' }, _activeView); updateBackBtn(); switchView('bookmarks', els.bookmarksView); viewLoader.fetchBookmarks(); };
        li.style.display = showBookmarksConfig ? 'block' : 'none';
        get('nav-profile')?.parentNode.insertBefore(li, get('nav-profile').nextSibling);
    }

    if (els.settingsView && !get('setting-bookmark-tab')) {
        const h3 = els.settingsView.querySelector('h3');
        if (h3) {
            const bm = document.createElement('div');
            bm.style.marginBottom = '20px';
            bm.innerHTML = `<label style="display:flex;align-items:center;font-weight:bold;cursor:pointer;"><input type="checkbox" id="setting-bookmark-tab" style="margin-right:8px;width:18px;height:18px;" ${showBookmarksConfig?'checked':''}><span data-i18n="settings_bookmark_tab">${t('settings_bookmark_tab')}</span></label>`;
            const sib = h3.nextElementSibling;
            (sib?.nextElementSibling ? h3.parentNode.insertBefore(bm, sib.nextElementSibling) : h3.parentNode.appendChild(bm));
        }
    }

    if (els.settingsView && !get('setting-time-format-wrap')) {
        const wrap = document.createElement('div');
        wrap.id = 'setting-time-format-wrap';
        wrap.style.cssText = 'margin-bottom:20px;';
        wrap.innerHTML =
            `<div style="font-weight:bold;margin-bottom:8px;" data-i18n="settings_time_format">${t('settings_time_format')}</div>` +
            `<div style="display:flex;gap:16px;">` +
            `<label style="cursor:pointer;display:flex;align-items:center;gap:6px;">` +
            `<input type="radio" name="aerune_time_format" value="relative" ${(window.aeruneTimeFormat||'relative')==='relative'?'checked':''}>` +
            `<span data-i18n="settings_time_relative">${t('settings_time_relative')}</span>` +
            `</label>` +
            `<label style="cursor:pointer;display:flex;align-items:center;gap:6px;">` +
            `<input type="radio" name="aerune_time_format" value="absolute" ${window.aeruneTimeFormat==='absolute'?'checked':''}>` +
            `<span data-i18n="settings_time_absolute">${t('settings_time_absolute')}</span>` +
            `</label>` +
            `</div>`;
        const bmWrap = get('setting-bookmark-tab')?.closest('div');
        if (bmWrap) {
            if (bmWrap.nextElementSibling) {
                bmWrap.parentNode.insertBefore(wrap, bmWrap.nextElementSibling);
            } else {
                bmWrap.parentNode.appendChild(wrap);
            }
        } else {
            els.settingsView.appendChild(wrap);
        }
    }

    if (els.settingsView && !get('settings-display-panel')) {
        const wrap = document.createElement('div');
        wrap.id = 'settings-display-panel';
        wrap.className = 'settings-panel';
        wrap.innerHTML =
            `<div class="settings-panel-title" data-i18n="settings_display">${t('settings_display')}</div>` +
            `<label class="settings-check"><input type="checkbox" id="setting-auto-refresh"> <span data-i18n="settings_auto_refresh">${t('settings_auto_refresh')}</span></label>` +
            `<label class="settings-check"><input type="checkbox" id="setting-restore-scroll"> <span data-i18n="settings_restore_scroll">${t('settings_restore_scroll')}</span></label>` +
            `<label class="settings-field"><span data-i18n="settings_image_display_style">${t('settings_image_display_style')}</span>` +
            `<select id="setting-image-display-style">` +
            `<option value="grid" data-i18n="settings_image_display_grid">${t('settings_image_display_grid')}</option>` +
            `<option value="carousel" data-i18n="settings_image_display_carousel">${t('settings_image_display_carousel')}</option>` +
            `</select></label>` +
            `<label class="settings-field"><span data-i18n="settings_font_size">${t('settings_font_size')}</span>` +
            `<select id="setting-font-size-level">` +
            `<option value="-1" data-i18n="settings_font_small">${t('settings_font_small')}</option>` +
            `<option value="0" data-i18n="settings_font_medium">${t('settings_font_medium')}</option>` +
            `<option value="1" data-i18n="settings_font_large">${t('settings_font_large')}</option>` +
            `<option value="2" data-i18n="settings_font_extra_large">${t('settings_font_extra_large')}</option>` +
            `</select></label>`;
        const timeWrap = get('setting-time-format-wrap');
        if (timeWrap?.nextElementSibling) {
            timeWrap.parentNode.insertBefore(wrap, timeWrap.nextElementSibling);
        } else if (timeWrap) {
            timeWrap.parentNode.appendChild(wrap);
        } else {
            els.settingsView.appendChild(wrap);
        }
    }

    if (els.settingsView && !get('settings-accounts-panel')) {
        const panel = document.createElement('div');
        panel.id = 'settings-accounts-panel';
        panel.className = 'settings-panel';
        panel.innerHTML =
            `<div class="settings-panel-title" data-i18n="settings_accounts">${t('settings_accounts')}</div>` +
            `<div id="settings-accounts-list" class="settings-account-list"></div>`;
        const moderationHeading = els.settingsView.querySelector('[data-i18n="settings_moderation"]');
        if (moderationHeading?.parentNode) moderationHeading.parentNode.insertBefore(panel, moderationHeading);
        else els.settingsView.appendChild(panel);
    }

    if (els.settingsView && !get('settings-local-list-panel')) {
        const panel = document.createElement('div');
        panel.id = 'settings-local-list-panel';
        panel.className = 'settings-panel settings-local-list-panel';
        panel.innerHTML =
            `<div class="settings-panel-title settings-local-list-title">` +
            `<span data-i18n="locallist_title">${t('locallist_title')}</span>` +
            `<span id="settings-local-list-count" class="settings-panel-count"></span>` +
            `</div>` +
            `<div class="settings-local-list-toolbar">` +
            `<button type="button" data-act="feed-select-local-list" data-i18n="locallist_open_timeline">${t('locallist_open_timeline')}</button>` +
            `<button type="button" data-act="local-list-export" data-i18n="locallist_export">${t('locallist_export')}</button>` +
            `<button type="button" data-act="local-list-import" data-i18n="locallist_import">${t('locallist_import')}</button>` +
            `<input type="file" id="local-list-import-input" accept="application/json,.json" class="hidden">` +
            `</div>` +
            `<div id="settings-local-list-list" class="settings-local-list"></div>`;
        const moderationHeading = els.settingsView.querySelector('[data-i18n="settings_moderation"]');
        if (moderationHeading?.parentNode) moderationHeading.parentNode.insertBefore(panel, moderationHeading);
        else els.settingsView.appendChild(panel);
    }

    if (els.settingsView && !get('setting-mute-words-wrap')) {
        const wrap = document.createElement('div');
        wrap.id = 'setting-mute-words-wrap';
        wrap.style.cssText = 'margin-bottom:20px;';
        wrap.innerHTML =
            `<label for="setting-mute-words" style="display:block;font-weight:bold;margin-bottom:8px;" data-i18n="settings_mute_words">${t('settings_mute_words')}</label>` +
            `<textarea id="setting-mute-words" rows="4" style="width:100%;max-width:520px;padding:10px;border:1px solid var(--border-color);border-radius:8px;resize:vertical;" data-i18n-placeholder="settings_mute_words_hint"></textarea>`;
        const anchor = get('moderation-list-container') || get('settings-display-panel') || get('setting-time-format-wrap');
        if (anchor?.nextElementSibling) {
            anchor.parentNode.insertBefore(wrap, anchor.nextElementSibling);
        } else if (anchor) {
            anchor.parentNode.appendChild(wrap);
        } else {
            els.settingsView.appendChild(wrap);
        }
    }

    if (els.settingsView && !get('mute-rules-panel')) {
        const panel = document.createElement('div');
        panel.id = 'mute-rules-panel';
        panel.className = 'moderation-panel';
        panel.innerHTML =
            `<div class="moderation-panel-title" data-i18n="mute_rules_advanced">${t('mute_rules_advanced')}</div>` +
            `<div class="mute-rule-form">` +
            `<input id="mute-rule-value" type="text" data-i18n-placeholder="mute_rule_placeholder" placeholder="${escAttr(t('mute_rule_placeholder'))}">` +
            `<select id="mute-rule-target">` +
            `<option value="content" data-i18n="mute_rule_content">${t('mute_rule_content')}</option>` +
            `<option value="tag" data-i18n="mute_rule_tag">${t('mute_rule_tag')}</option>` +
            `<option value="both" data-i18n="mute_rule_both">${t('mute_rule_both')}</option>` +
            `</select>` +
            `<select id="mute-rule-expiry">` +
            `<option value="never" data-i18n="mute_rule_never">${t('mute_rule_never')}</option>` +
            `<option value="24h" data-i18n="mute_rule_24h">${t('mute_rule_24h')}</option>` +
            `<option value="7d" data-i18n="mute_rule_7d">${t('mute_rule_7d')}</option>` +
            `<option value="30d" data-i18n="mute_rule_30d">${t('mute_rule_30d')}</option>` +
            `</select>` +
            `<label class="mute-rule-check"><input id="mute-rule-exclude-following" type="checkbox"> <span data-i18n="mute_rule_exclude_following">${t('mute_rule_exclude_following')}</span></label>` +
            `<button type="button" data-act="mute-rule-add" data-i18n="feeds_add">${t('feeds_add')}</button>` +
            `</div>` +
            `<div id="mute-rules-list" class="mod-rule-list"></div>`;
        const muteWrap = get('setting-mute-words-wrap');
        if (muteWrap?.nextElementSibling) {
            muteWrap.parentNode.insertBefore(panel, muteWrap.nextElementSibling);
        } else if (muteWrap) {
            muteWrap.parentNode.appendChild(panel);
        }
    }

    if (els.settingsView && !get('moderation-subscriptions-panel')) {
        const panel = document.createElement('div');
        panel.id = 'moderation-subscriptions-panel';
        panel.className = 'moderation-panel';
        panel.innerHTML =
            `<div class="moderation-panel-title" data-i18n="mod_subscriptions">${t('mod_subscriptions')}</div>` +
            `<div class="mod-sub-form">` +
            `<input id="mod-list-uri" type="text" data-i18n-placeholder="mod_list_uri_placeholder" placeholder="${escAttr(t('mod_list_uri_placeholder'))}">` +
            `<button type="button" data-act="mod-list-mute" data-i18n="mod_list_mute">${t('mod_list_mute')}</button>` +
            `<button type="button" data-act="mod-list-block" data-i18n="mod_list_block">${t('mod_list_block')}</button>` +
            `</div>` +
            `<div class="mod-sub-form">` +
            `<input id="labeler-did" type="text" data-i18n-placeholder="labeler_handle_placeholder" placeholder="${escAttr(t('labeler_handle_placeholder'))}">` +
            `<button type="button" data-act="labeler-subscribe" data-i18n="labeler_subscribe">${t('labeler_subscribe')}</button>` +
            `</div>` +
            `<div class="mod-sub-actions">` +
            `<button type="button" data-act="show-list-mutes" data-i18n="settings_mute_lists">${t('settings_mute_lists')}</button>` +
            `<button type="button" data-act="show-list-blocks" data-i18n="settings_block_lists">${t('settings_block_lists')}</button>` +
            `<button type="button" data-act="show-labelers" data-i18n="settings_labelers">${t('settings_labelers')}</button>` +
            `</div>`;
        const mutePanel = get('mute-rules-panel');
        if (mutePanel?.nextElementSibling) {
            mutePanel.parentNode.insertBefore(panel, mutePanel.nextElementSibling);
        } else if (mutePanel) {
            mutePanel.parentNode.appendChild(panel);
        }
    }

    if (els.settingsView && !get('settings-cache-panel')) {
        const panel = document.createElement('div');
        panel.id = 'settings-cache-panel';
        panel.className = 'settings-panel settings-cache-panel';
        panel.innerHTML =
            `<div class="settings-panel-title" data-i18n="settings_cache">${t('settings_cache')}</div>` +
            `<button type="button" class="danger-action" data-act="settings-clear-cache" data-i18n="settings_clear_cache">${t('settings_clear_cache')}</button>`;
        const aboutHeading = els.settingsView.querySelector('[data-i18n="settings_about"]');
        if (aboutHeading?.parentNode) aboutHeading.parentNode.insertBefore(panel, aboutHeading);
        else els.settingsView.appendChild(panel);
    }

    const sl = get('setting-lang'), sn = get('setting-nsfw');
    if (sl)  sl.value   = currentLang;
    if (sn)  sn.checked = nsfwBlur;
    const sar = get('setting-auto-refresh');
    const srs = get('setting-restore-scroll');
    const sis = get('setting-image-display-style');
    const sfs = get('setting-font-size-level');
    if (sar) sar.checked = autoRefreshEnabled;
    if (srs) srs.checked = restoreScrollEnabled;
    if (sis) sis.value = window.aeruneImageDisplayStyle || 'carousel';
    if (sfs) sfs.value = String(fontSizeLevel);
    loadMuteWords();
    renderMuteRulesList();
    renderSettingsAccounts();
    renderLocalListSettings();

    applyTranslations();

    const aboutVersion = get('about-version');
    if (aboutVersion) aboutVersion.textContent = `v${appPackage.version}`;

    document.querySelectorAll('[data-i18n="settings_mutes"]').forEach(el => {
        el.style.cursor = 'pointer'; el.style.color = 'var(--bsky-blue)';
        el.onclick = () => window.showMutes();
    });
    document.querySelectorAll('[data-i18n="settings_blocks"]').forEach(el => {
        el.style.cursor = 'pointer'; el.style.color = 'var(--bsky-blue)';
        el.onclick = () => window.showBlocks();
    });

    if (els.postInput) {
        els.postInput.style.minHeight = '80px';
        els.postInput.addEventListener('input', () => {
            scheduleQuoteUrlResolve();
            scheduleDraftSave();
        });
    }

    if (els.dropZone) {
        // ウィンドウ全体でD&Dを監視
        document.addEventListener('dragover', e => { 
            e.preventDefault(); e.stopPropagation(); 
            els.dropZone.style.display = 'flex'; // フォームを表示
            els.dropZone.classList.add('drag-over'); 
        });
        document.addEventListener('dragleave', e => { 
            e.preventDefault(); e.stopPropagation(); 
            if (e.clientX === 0 || e.clientY === 0) els.dropZone.classList.remove('drag-over'); 
        });
        document.addEventListener('drop', async e => {
            e.preventDefault(); e.stopPropagation(); 
            els.dropZone.classList.remove('drag-over');
            els.postInput.focus(); // すぐに入力できるようフォーカス
            const files = Array.from(e.dataTransfer.files);
            const images = files.filter(f => f.type.startsWith('image/'));
            const videos = files.filter(f => f.type.startsWith('video/'));
            if (images.length && videos.length) return alert(t('video_with_images_error'));
            if (videos.length) await processVideoFile(videos[0]);
            else await processIncomingImages(images);
        });
    }

    document.addEventListener('click', e => { if (!e.button && els.ctxMenu) els.ctxMenu.classList.add('hidden'); });

    // ─── イベントリスナー ──────────────────────────────────────────
    get('login-btn')?.addEventListener('click', login);
    get('login-cancel-btn')?.addEventListener('click', () => { els.loginForm.classList.add('hidden'); if (els.app) els.app.style.opacity = '1'; });
    get('post-btn')?.addEventListener('click', sendPost);

    get('nav-home')?.addEventListener('click',          () => { nav.push({type:'home'}, _activeView); updateBackBtn(); switchView('home', els.timelineDiv); viewLoader.fetchTimeline(); });
    get('nav-feeds')?.addEventListener('click',         () => window.openFeedsManager());
    get('nav-notifications')?.addEventListener('click', () => { nav.push({type:'notifications'}, _activeView); updateBackBtn(); switchView('notifications', els.notifDiv); viewLoader.fetchNotifications(); });
    get('nav-chat')?.addEventListener('click',          () => { nav.push({type:'chat'}, _activeView); updateBackBtn(); switchView('chat', els.chatView); fetchConvos(); });
    get('nav-search')?.addEventListener('click',        () => { nav.push({type:'search'}, _activeView); updateBackBtn(); switchView('search', els.searchView); });
    get('nav-profile')?.addEventListener('click',       () => window.loadProfile(api.session.did));
    get('nav-settings')?.addEventListener('click',      () => { nav.push({type:'settings'}, _activeView); updateBackBtn(); switchView('settings', els.settingsView); });

    get('search-exec-btn')?.addEventListener('click', () => window.execSearch(undefined, false));
    get('search-input')?.addEventListener('input', () => scheduleSearch(false));
    get('search-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); window.execSearch(undefined, false); } });
    get('local-list-import-input')?.addEventListener('change', async e => {
        await importLocalListFile(e.target.files?.[0]);
        e.target.value = '';
    });
    get('setting-lang')?.addEventListener('change', e => {
        const nextLang = normalizeLanguage(e.target.value || currentLang);
        currentLang = nextLang;
        localStorage.setItem('aerune_lang', nextLang);
        e.target.value = nextLang;
        applyTranslations();
        const msg = get('settings-msg');
        if (msg) msg.textContent = '';
    });
    get('add-account-btn')?.addEventListener('click', () => { 
        document.getElementById('id').value = '';
        document.getElementById('pw').value = '';
        els.loginForm.classList.remove('hidden'); 
        if (els.app) els.app.style.opacity = '0.3'; 
    });
    get('logout-btn')?.addEventListener('click', () => {
        actions.logout(currentDid, savedAccounts,
            () => { currentDid = null; const al = get('account-list'); if (al) al.textContent = ''; showLoginForm(); },
            (did, accounts) => { savedAccounts = accounts; switchAccount(did); }
        );
    });

    get('settings-save-btn')?.addEventListener('click', () => {
        const nl  = normalizeLanguage(get('setting-lang')?.value || currentLang);
        const nb  = get('setting-nsfw')?.checked ?? nsfwBlur;
        const nbm = get('setting-bookmark-tab')?.checked ?? showBookmarksConfig;
        const ntf = document.querySelector('input[name="aerune_time_format"]:checked')?.value || window.aeruneTimeFormat || 'relative';
        const nar = get('setting-auto-refresh')?.checked ?? autoRefreshEnabled;
        const nrs = get('setting-restore-scroll')?.checked ?? restoreScrollEnabled;
        const nis = get('setting-image-display-style')?.value || window.aeruneImageDisplayStyle || 'carousel';
        const nfl = clampFontSizeLevel(get('setting-font-size-level')?.value ?? fontSizeLevel);

        localStorage.setItem('aerune_lang',           nl);
        localStorage.setItem('aerune_nsfw_blur',      nb.toString());
        localStorage.setItem('aerune_show_bookmarks', nbm.toString());
        localStorage.setItem('aerune_time_format',    ntf);
        localStorage.setItem('aerune_auto_refresh',   nar.toString());
        localStorage.setItem('aerune_restore_scroll', nrs.toString());
        localStorage.setItem('aerune_image_display_style', nis);
        localStorage.setItem('aerune_font_size_level', String(nfl));

        currentLang = nl; nsfwBlur = nb; showBookmarksConfig = nbm;
        autoRefreshEnabled = nar;
        restoreScrollEnabled = nrs;
        fontSizeLevel = nfl;
        window.aeruneTimeFormat = ntf;
        window.aeruneImageDisplayStyle = nis;
        saveMuteWordsFromSettings();
        
        get('nav-bookmarks')?.style.setProperty('display', nbm ? 'block' : 'none');
        applyTranslations();
        if (autoRefreshEnabled) startTimelinePolling();
        else {
            stopTimelinePolling();
            resetTimelineNotice();
        }
        renderFeedControls();
        renderFeedsView();
        renderTimelineNotice();
        if (els.timelineDiv && !els.timelineDiv.classList.contains('hidden')) refreshCurrentTimeline();

        const msg = get('settings-msg');
        if (msg) { msg.textContent = t('settings_saved'); setTimeout(() => { msg.textContent = ''; }, 3000); }
    });

    get('modal-close')?.addEventListener('click', closeImageModal);
    get('modal-prev')?.addEventListener('click', e => { e.stopPropagation(); stepImageModal(-1); });
    get('modal-next')?.addEventListener('click', e => { e.stopPropagation(); stepImageModal(1); });
    get('image-modal')?.addEventListener('click', e => { if (e.target.id === 'image-modal') closeImageModal(); });
    get('quote-modal-close')?.addEventListener('click', () => els.quoteModal?.classList.add('hidden'));
    get('image-input')?.addEventListener('change', async e => { await processIncomingImages(Array.from(e.target.files)); e.target.value = ''; });
    get('video-input')?.addEventListener('change', async e => { await processVideoFile(e.target.files?.[0]); e.target.value = ''; });

    get('chat-send-btn')?.addEventListener('click', sendChatMessage);
    get('chat-msg-input')?.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); sendChatMessage(); } });

    window.addEventListener('keydown', e => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && document.activeElement === els.postInput) {
            e.preventDefault(); sendPost();
        }
        if (e.key === 'Escape') {
            resetPostForm();
            els.quoteModal?.classList.add('hidden');
            if (reportDialogFinish) reportDialogFinish(null);
            else get('report-modal')?.classList.add('hidden');
            closeImageModal();
        }
        if (!get('image-modal')?.classList.contains('hidden')) {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                stepImageModal(-1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                stepImageModal(1);
            }
        }
    });

    window.addEventListener('paste', async e => {
        if (e.clipboardData?.files.length) {
            const files = Array.from(e.clipboardData.files);
            const imgs = files.filter(f => f.type.startsWith('image/'));
            const videos = files.filter(f => f.type.startsWith('video/'));
            if (imgs.length || videos.length) e.preventDefault();
            if (imgs.length && videos.length) return alert(t('video_with_images_error'));
            if (videos.length) await processVideoFile(videos[0]);
            else if (imgs.length) await processIncomingImages(imgs);
        }
    });

    window.addEventListener('focus', () => {
        startTimelinePolling();
        checkTimelineUpdates();
    });
    window.addEventListener('blur', () => {
        viewLoader?.saveTimelineScroll();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            viewLoader?.saveTimelineScroll();
            stopTimelinePolling();
        } else {
            startTimelinePolling();
            checkTimelineUpdates();
        }
    });

    // セッション復元
    try {
        const data = await ipcRenderer.invoke('load-session');
        if (data && (Array.isArray(data) ? data.length : data.did)) {
            savedAccounts = Array.isArray(data) ? data : [data];
            await switchAccount(savedAccounts[0].did);
        } else { showLoginForm(); }
    } catch { showLoginForm(); }
}

initApp();
