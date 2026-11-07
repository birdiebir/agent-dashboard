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
