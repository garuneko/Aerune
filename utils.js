// utils.js (optimized)
const { RichText } = require('@atproto/api');

// ---- selection ----
function hasSelection() {
    try {
        const s = window.getSelection();
        return s && !s.isCollapsed && s.toString().trim().length > 0;
    } catch { return false; }
}

// ---- image compress ----
async function compressImage(file, maxSize = 2000) {
    return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = ev => {
            const img = new Image();
            img.onload = () => {
                let w = img.width, h = img.height;
                if (w > maxSize || h > maxSize) {
                    if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
                    else { w = Math.round(w * maxSize / h); h = maxSize; }
                } else { w = Math.round(w); h = Math.round(h); }
                
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                
                // ↓ここを修正
                let quality = 0.85;
                const TARGET_SIZE = 950000; 
                
                const checkSize = () => {
                    canvas.toBlob(blob => {
                        // 容量オーバーかつ画質をまだ下げられる場合は再エンコード
                        if (blob.size > TARGET_SIZE && quality > 0.4) {
                            quality -= 0.1;
                            checkSize();
                        } else {
                            resolve({ blob, width: w, height: h });
                        }
                    }, 'image/jpeg', quality);
                };
                
                checkSize();
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// ---- download ----
async function downloadImage(url) {
    try {
        const blob = await fetch(url).then(r => r.blob());
        const a = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(blob),
            download: `aerune_img_${Date.now()}.jpg`
        });
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    } catch { alert('Download failed'); }
}

// ---- escaping ----
// Lookup-table approach is fastest for character replacement
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
const ESC_RE = /[&<>'"]/g;
function escHTML(s = '') { return String(s).replace(ESC_RE, c => ESC[c]); }
function escAttr(s = '') { return String(s).replace(ESC_RE, c => ESC[c]).replace(/\n/g, ' '); }

// ---- linkify (event-delegation friendly, no inline onclick) ----
// LRU-lite cache: Map preserves insertion order
const LC = new Map(); // linkify cache
const URL_RE = /(?:https?:\/\/|www\.)[a-zA-Z0-9\-.]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?|[a-zA-Z0-9\-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?/g;
const TAG_RE = /(?:^|\s)(#[^\s#]+)/g;
const MEN_RE = /(?:^|\s)(@[a-zA-Z0-9.-]+)/g;
const BLUE = 'color:var(--bsky-blue);text-decoration:none;';

function linkify(text) {
    if (!text) return '';
    const cached = LC.get(text);
    if (cached) return cached;

    let s = escHTML(text);

    s = s.replace(URL_RE, m => {
        if (m.includes('@') && !m.startsWith('http')) return m;
        if (!m.includes('.') || m.length < 5) return m;
        let url = m.startsWith('http') ? m : 'https://' + m;
        let punc = '';
        if (/[.,;!?)]/.test(url.at(-1))) { punc = url.at(-1); url = url.slice(0, -1); m = m.slice(0, -1); }
        return `<a href="${escAttr(url)}" data-ext="${escAttr(url)}" style="${BLUE}">${m}</a>${punc}`;
    });

    s = s.replace(TAG_RE, (_, tag) => {
        const sp = _.startsWith(' ') ? ' ' : '';
        return `${sp}<a href="#" data-search="${escAttr(tag.trim())}" style="${BLUE}">${tag}</a>`;
    });

    s = s.replace(MEN_RE, (_, h) => {
        const sp = _.startsWith(' ') ? ' ' : '';
        return `${sp}<a href="#" data-profile="${escAttr(h.trim().slice(1))}" style="${BLUE}">${h.trim()}</a>`;
    });

    if (LC.size >= 500) { LC.delete(LC.keys().next().value); }
    LC.set(text, s);
    return s;
}

// ---- rich text (LRU cache) ----
const RC = new Map();
function renderRichText(record) {
    if (!record?.text) return '';
    const fk = record.facets ? JSON.stringify(record.facets) : '';
    const key = record.text + '|' + fk;
    const cached = RC.get(key);
    if (cached) { RC.delete(key); RC.set(key, cached); return cached; }

    let html = '';
    if (record.facets?.length) {
        const rt = new RichText({ text: record.text, facets: record.facets });
        for (const seg of rt.segments()) {
            const tx = escHTML(seg.text);
            if (seg.isLink()) {
                html += `<a href="${escAttr(seg.link.uri)}" data-ext="${escAttr(seg.link.uri)}" style="${BLUE}">${tx}</a>`;
            } else if (seg.isMention()) {
                html += `<a href="#" data-profile="${escAttr(seg.mention.did)}" style="${BLUE}">${tx}</a>`;
            } else if (seg.isTag()) {
                html += `<a href="#" data-search="${escAttr(seg.tag.tag)}" style="${BLUE}">${tx}</a>`;
            } else {
                html += tx.replace(/\n/g, '<br>');
            }
        }
    } else {
        html = linkify(record.text).replace(/\n/g, '<br>');
    }

    if (RC.size >= 400) { RC.delete(RC.keys().next().value); }
    RC.set(key, html);
    return html;
}

module.exports = { hasSelection, compressImage, downloadImage, linkify, renderRichText, escHTML, escAttr };
