// P62 M3b：聊天頁的顯示邏輯（純函式，Node 可測）。規格 docs/P62_M3_聊天介面取捨.md §3。
// 資料契約在 chat.js（對話串）、chatstatus.js（三段狀態）、outbox（手機寫入紀錄）；這裡只決定「怎麼畫」。
import { TWDate as Date } from './tz.js';
import { msgPhase, findThread, PHASE_LABELS } from './chatstatus.js';
import { parseCtx } from './tasks.js';
import { AGENT_NAME } from './brand.js';

export const LONG_LINES = 8;
export const LONG_CHARS = 400;

// 對話串 → 對得到的 outbox chat 項目（只看已送出的）。一串最多配一筆、一筆最多配一串。
export function pairThreads(items, threads) {
  const out = new Map();
  const list = (items || [])
    .filter((x) => x && x.kind === 'chat' && x.state === 'sent')
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  for (const it of list) {
    const free = (threads || []).filter((t) => !out.has(t));
    const th = findThread(it, free);
    if (th) out.set(th, it);
  }
  return out;
}

const CLS = { sending: 'muted', sent: 'muted', offline_pc: 'warn', pc_stalled: 'warn', delivered: 'ok', processing: 'ok', stalled: 'warn' };

// 你的泡泡下面那行小字。已回覆（回覆泡泡就在下面）或沒有對應項目回 null
export function bubbleStatus(item, status, threads, remoteOn, now = Date.now()) {
  if (!item) return null;
  const r = msgPhase(item, status, threads, remoteOn, now);
  if (r.phase === 'replied') return null;
  return { phase: r.phase, label: r.label, cls: CLS[r.phase] || 'muted' };
}

// rows：[{thread, phase}]（最新在後；沒有對應項目的串 phase 給 null 或不放進來）。
// 只看最後一則有對應項目的留言：還在 delivered／processing／stalled 才回值
export function typingState(rows) {
  let last = null;
  for (const r of rows || []) if (r && r.phase) last = r;
  if (!last) return null;
  if (last.phase === 'delivered') return { phase: 'delivered', label: '已送達電腦，等' + AGENT_NAME + '接手' };
  if (last.phase === 'processing') return { phase: 'processing', label: PHASE_LABELS.processing };
  if (last.phase === 'stalled') return { phase: 'stalled', label: PHASE_LABELS.stalled };
  return null;
}

// 一則回覆（text＋children）超過 8 行或 400 字算長（剛好 8 行／400 字不算）。字數用字元數，不是位元組
export function replyLines(reply) { return 1 + ((reply && reply.children) || []).length; }
// 收合按鈕上寫的行數：Live.md 單行格式用「 ⏎ 」分段，也要算進去，不然長回覆寫「展開全文（1 行）」（11-07 m-ola0f1nt 查核）
export function shownLines(reply) {
  if (!reply) return 1;
  const parts = [reply.text || '', ...(reply.children || [])];
  return parts.reduce((n, s) => n + 1 + (String(s).match(/⏎/g) || []).length, 0);
}
// 要使用者回答或決定的回覆：不收起來（題目常寫在長回覆最後面，收起來就看不到）
export const ASKS_USER_RE = /要你決定|請你決定|你來決定|要你回答|請你回答|請回覆|等你回覆|請選|選一個|回「[^」]{1,8}」|要不要/;
export function asksUser(reply) {
  if (!reply) return false;
  return ASKS_USER_RE.test([reply.text || '', ...(reply.children || [])].join('\n'));
}
export function isLongReply(reply) {
  if (!reply) return false;
  const s = [reply.text || '', ...(reply.children || [])].join('\n');
  return replyLines(reply) > LONG_LINES || [...s].length > LONG_CHARS;
}

// state.expanded 的 key：用手機編號（沒有就用時間＋前 16 字），重新 parse 後不變
export function replyKey(thread, ri) {
  const base = thread.id || thread.rid || (thread.time || '') + '|' + [...String(thread.text || '')].slice(0, 16).join('');
  return 'chat:r:' + base + ':' + ri;
}

const stripBullet = (c) => String(c).replace(/^(\s*)[-*]\s+/, '$1');

export function quickSource(thread) { return AGENT_NAME + '對話 ' + (thread.time || ''); }

// kind：'note'｜'remind'｜'agent' → 小卡預填文字。note 帶「問：」＋嘿嘿最後一則回覆；其餘是你那句（去掉 context 前綴）
export function quickDraft(kind, thread) {
  const { rest } = parseCtx([thread.text, ...(thread.extra || [])].join('\n'));
  if (kind !== 'note') return rest;
  const r = thread.replies && thread.replies.length ? thread.replies[thread.replies.length - 1] : null;
  const body = r ? [r.text, ...(r.children || []).map(stripBullet)].join('\n') : '';
  return '問：' + rest + (body ? '\n' + body : '');
}

// 遠端是否開著：狀態檔有 remote 就用它，沒有狀態檔退回 Live.md 的判斷
export function remoteOnFrom(status, liveRemoteActive) {
  if (status && status.remote) return status.remote.on === true;
  return !!liveRemoteActive;
}

// 狀態列文字（輸入列上方）
export function remoteText({ on, offline, pcQuiet, stalled } = {}) {
  if (offline) return '現在沒網路：你寫的會先存在手機，連上網路後自動送出。';
  if (stalled) return '⚠️ 電腦收留言的程式停了：留言先存著。可以按「叫電腦開遠端」重開。';
  if (on) return pcQuiet ? '遠端模式開著，但電腦好一陣子沒推送了（可能沒在跑）；你寫的會先存著。' : '📡 遠端開著，通常 10 秒內顯示已送達';
  return '電腦沒開遠端：留言先存著，下次開視窗才回';
}

// 標題列「嘿嘿」旁的小膠囊：優先順序 offline > stalled／pcQuiet／intake 警告 > on > off
// 回傳 {key, text, label}：key 對應 CSS（on 綠、off 灰、warn 橘、offline 紅）；label 給 aria-label
export function remoteBadge({ on, offline, pcQuiet, stalled, intakeWarn } = {}) {
  if (offline) return { key: 'offline', text: '離線', label: '遠端狀態：沒網路' };
  if (on && stalled) return { key: 'warn', text: '⚠️', label: '遠端狀態：監聽停了' };
  if (on && pcQuiet) return { key: 'warn', text: '⚠️', label: '遠端狀態：電腦好一陣子沒推送' };
  if (intakeWarn) return { key: 'warn', text: '⚠️', label: '遠端狀態：收件有警告' };
  if (on) return { key: 'on', text: '📡 遠端', label: '遠端狀態：開著' };
  return { key: 'off', text: '關', label: '遠端狀態：關著' };
}

// LINE 式：時間放在氣泡外側下方。你的留言：「已送達 18:38｜附註」（沒狀態就「18:38｜附註」）
export function youMetaText({ time, note, status } = {}) {
  const head = [status, time].filter(Boolean).join(' ');
  return [head, note].filter(Boolean).join('｜');
}
// 嘿嘿的回覆：「18:39」，快路徑回覆前面加 ⚡
// by：回覆者的白話名稱（P74：可能是「雲端快答」這類）；預設的 Agent 名稱不重複顯示
export function agentMetaText({ time, fast, by } = {}) {
  return [by && by !== AGENT_NAME ? by : '', fast ? '⚡' : '', time].filter(Boolean).join(' ');
}
// 快路徑回覆的 at（ISO 字串）轉成本機 HH:MM；讀不出來回空字串
export function clockOf(at) {
  const d = new Date(at);
  if (!at || !Number.isFinite(d.getTime())) return '';
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// 嘿嘿回覆總數（A7 偵測有沒有新回覆用）
export function countReplies(threads) {
  let n = 0;
  for (const t of threads || []) n += (t.replies || []).length;
  return n;
}

// ---------- 回覆「看過了沒」的穩定編號（11-10 m-ifpzu9nl：聊天最底「嘿嘿在…底下補了回覆」一直顯示看過的舊回覆）----------
// 同一則回覆在三個來源的編號都不一樣：雲端先到的是 cloud:<留言>:<序號>，電腦正式寫進對話後變成 hub 的 r- 編號，
// 退回 Live.md 時又變成「第幾則」。只記來源編號的話，來源一換，看過的回覆全部又變成沒看過。
// 穩定編號只看「掛在哪則留言底下＋內容開頭」，三個來源算出來一樣。內容是空的回 ''（呼叫端退回來源編號）。
export const STABLE_KEY_CHARS = 40;
function stableNorm(reply) {
  const raw = [reply.text || '', ...((reply.children) || [])].join('');
  return [...raw.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[\s⏎*_`#>|~\-—・•]/g, '')];
}
// cyrb53：同步、不依賴 crypto 的 53 位元雜湊
function hash53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
// 11-13 U-08：新編號用「完整正規化內容」的雜湊（s2:），不再只取前 40 字（同串開頭相同會撞，新回覆被當成看過）
export function replyStableKey(thread, reply) {
  if (!reply) return '';
  const chars = stableNorm(reply);
  if (!chars.length) return '';
  const body = chars.join('');
  // 同串內容完全相同的回覆（例如工作回覆的固定字樣）：第 n 則（n>=1）加 #n，第 0 則編號不變
  let nth = 0;
  for (const o of (thread && thread.replies) || []) {
    if (o === reply) break;
    if (o && stableNorm(o).join('') === body) nth++;
  }
  return 's2:' + ((thread && thread.id) || '') + ':' + hash53(body) + ':' + chars.length + (nth ? '#' + nth : '');
}
// 舊格式（只取前 40 字）：只用在一次性遷移，把舊紀錄裡已看過的回覆補上新編號
export function replyLegacyKey(thread, reply) {
  if (!reply) return '';
  const s = stableNorm(reply).slice(0, STABLE_KEY_CHARS).join('');
  if (!s) return '';
  return 's:' + ((thread && thread.id) || '') + ':' + s;
}
// 聊天最底提示「嘿嘿 HH:MM 在…補了回覆」的位置文字（11-12 m-xak70t02：點了跳到很早以前的留言，使用者以為指錯）。
// 留言不是今天的，前面加「你 MM-DD 的」，一看就知道是哪天那則；獨立泡泡、留言沒有字（看不出是哪則）不猜，寫「前面」。
export const HINT_SNIP_CHARS = 14;
export function hintPlace(thread, now = new Date()) {
  if (!thread || thread.orphan) return '前面';
  const chars = [...String(thread.text || '').replace(/^(［[^］]*］\s*)?↩\S*?｜/, '$1').replace(/\s+/g, ' ').trim()];
  if (!chars.length) return '前面';
  const s = chars.slice(0, HINT_SNIP_CHARS).join('') + (chars.length > HINT_SNIP_CHARS ? '…' : '');
  const w = thread.when && thread.when.month ? thread.when : null;
  const d = new Date(now);
  const today = !w || (w.month === d.getMonth() + 1 && w.day === d.getDate());
  return (today ? '' : '你 ' + String(w.month).padStart(2, '0') + '-' + String(w.day).padStart(2, '0') + ' 的') + '「' + s + '」底下';
}
// 看過了嗎：來源編號或穩定編號任一個記過就算
export function replySeen(seen, legacyId, stableKey) {
  return !!seen && ((!!legacyId && seen.has(legacyId)) || (!!stableKey && seen.has(stableKey)));
}
// 這則回覆現在算不算「出現在畫面上」：一半以上看得到，或（比螢幕高的長回覆）佔了螢幕四成以上。
// 原本只有「一半以上」：比兩個螢幕高的長回覆永遠到不了一半，怎麼看都不會記成看過。
export const SEEN_RATIO = 0.5;
export const SEEN_VIEW_SHARE = 0.4;
export function seenEnough(ratio, visiblePx, viewportPx) {
  if (!(ratio > 0)) return false;
  return ratio >= SEEN_RATIO || (viewportPx > 0 && visiblePx >= viewportPx * SEEN_VIEW_SHARE);
}
// 11-13 U-09：比視窗高很多的回覆，intersectionRatio 永遠小於固定門檻（例如 20 倍高時最多 0.05）。
// 門檻依元素高度與視窗高度算：露出視窗的 40～100% 各設一個，換算成比例後排序去重。
export function seenThresholds(elHeight, viewportPx) {
  const base = [0.05, 0.1, 0.25, 0.5, 0.75, 1];
  if (!(elHeight > 0) || !(viewportPx > 0)) return base;
  const out = new Set(base.filter((x) => x <= 1));
  for (const k of [0.4, 0.45, 0.5, 0.6, 0.8, 1]) out.add(Math.min(1, (k * viewportPx) / elHeight));
  return [...out].sort((a, b) => a - b);
}
