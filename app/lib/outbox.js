// 寫入紀錄（outbox，P46 v4 M3）：手機的每一筆寫入都先建一筆再送。純函式＋傳進來的 storage，不碰全域。
//
//   {id:'m-<英數>', kind, payload, createdAt, state:'queued'|'sending'|'sent'|'failed', attempts, err, code, sentAt, result}
//
// kind：answer（回答，含照建議、延後、不確定、需要討論、手機補答）｜journal（日記改寫）｜note（筆記）｜task（新增任務）｜
//       chat（對話）｜promote（升格請求）｜keep（維持任務）｜record（紀錄中心：電影、動漫、健身的新增／修改／封存／復原，v5 M3）
//
// 狀態機（只有這幾條路，其他丟錯）：
//   queued  → sending   開始送（attempts +1；同時間只送一筆、依建立順序）
//   sending → sent      寫入成功（含「早就寫過了」noop）
//   sending → queued    網路錯誤：留著，之後有網路、切回前景、手動重新整理、App 啟動、解鎖後自動再送
//   sending → failed    非網路錯誤（重試 3 次仍 409、題號重複、日記已收錄、找不到任務…）：留著，顯示白話原因，使用者按「重試」或「刪除」
//   failed  → queued    使用者按重試（attempts 歸零）
//   queued／failed／sent → 刪除（送出中不能刪）
import { KEYS } from './local.js';
import { GitHubError } from './github.js';
import { errMsg } from './errmsg.js';

export const KINDS = ['answer', 'journal', 'note', 'task', 'chat', 'promote', 'keep', 'record', 'done', 'reply']; // done／reply：提醒打勾完成、回覆（2026-10-30）
export const STATES = ['queued', 'sending', 'sent', 'failed'];
export const ID_RE = /^m-[A-Za-z0-9]{4,32}$/;
export const SENT_KEEP_MS = 90 * 24 * 3600 * 1000; // 已送出的紀錄最久留 90 天（已處理的 30 天就移除，見 lib/mine.js）

// 手機編號：m- 加 8 個小寫英數（電腦端 mobile_sync 認 m-[A-Za-z0-9]+）
export function newId(rand) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let r = rand;
  if (!r) {
    r = (n) => {
      const c = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : null;
      if (c) return c.getRandomValues(new Uint32Array(1))[0] % n;
      return Math.floor(Math.random() * n);
    };
  }
  let s = 'm-';
  for (let i = 0; i < 8; i++) s += alphabet[r(alphabet.length)];
  return s;
}

export function createItem(kind, payload, now = Date.now(), id) {
  if (!KINDS.includes(kind)) throw new Error('不支援的寫入種類：' + kind);
  if (!payload || typeof payload !== 'object') throw new Error('寫入內容不能是空的');
  const mid = id || newId();
  if (!ID_RE.test(mid)) throw new Error('寫入編號格式不對：' + mid);
  return { id: mid, kind, payload, createdAt: now, state: 'queued', attempts: 0, err: '', code: '', sentAt: 0, result: null, rev: 0 };
}

// 版本號（v4.3.1）：每次狀態轉換、重試、改內容都 +1；雙分頁合併時取較大的那筆
export const revOf = (x) => (x && Number.isInteger(x.rev) && x.rev >= 0 ? x.rev : 0);

// ---------- 存取 ----------
// 不認得的 kind（新版 App 寫的、這個版本還不會送）：原樣留著、不送、不算排隊（v5 M3 第 4 點，定案：以後加 kind 才不會被舊版吃掉）
export const isKnownKind = (k) => KINDS.includes(k);
const FOREIGN_KIND = /^[A-Za-z][A-Za-z0-9_-]{0,30}$/;
function normalize(x) {
  if (!x || typeof x !== 'object' || !ID_RE.test(String(x.id)) || !(KINDS.includes(x.kind) || (typeof x.kind === 'string' && FOREIGN_KIND.test(x.kind)))) return null;
  if (!x.payload || typeof x.payload !== 'object' || Array.isArray(x.payload) || !Number.isFinite(x.createdAt)) return null;
  const state = STATES.includes(x.state) ? x.state : 'queued';
  return {
    id: x.id, kind: x.kind, payload: x.payload, createdAt: x.createdAt,
    state: state === 'sending' ? 'queued' : state, // 上次送到一半 App 被關掉：回到排隊，重送靠編號／內容比對不會重複
    attempts: Number.isInteger(x.attempts) && x.attempts >= 0 ? x.attempts : 0,
    err: typeof x.err === 'string' ? x.err : '', code: typeof x.code === 'string' ? x.code : '',
    sentAt: Number.isFinite(x.sentAt) ? x.sentAt : 0,
    result: x.result && typeof x.result === 'object' ? x.result : null,
    rev: revOf(x), // 注意：sending 存成 queued 但 rev 保留（別頁合併時會拿到比較大的 queued，因為沒有鎖不會送，見 test/v43）
  };
}

export function loadOutbox(storage, now = Date.now()) {
  let v = null;
  try { v = JSON.parse(storage.getItem(KEYS.outbox)); } catch (e) { v = null; }
  if (!Array.isArray(v)) return [];
  const out = [];
  const seen = new Set();
  for (const x of v) {
    const it = normalize(x);
    if (!it || seen.has(it.id)) continue;
    if (it.state === 'sent' && now - (it.sentAt || it.createdAt) > SENT_KEEP_MS) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

// 存檔並回報成功與否。寫不進去（空間不足）時先呼叫 opts.freeSpace()（例如刪掉可重抓的快取）再試一次；還是不行回 false。
export function persistOutbox(storage, list, { freeSpace } = {}) {
  const write = () => {
    if (list.length) storage.setItem(KEYS.outbox, JSON.stringify(list));
    else storage.removeItem(KEYS.outbox);
  };
  try { write(); return true; } catch (e) { /* 往下試著騰空間 */ }
  if (typeof freeSpace !== 'function') return false;
  try { freeSpace(); } catch (e) { /* 騰不出來就算了 */ }
  try { write(); return true; } catch (e) { return false; }
}

// 舊介面：回傳筆數。要知道有沒有存成功請用 persistOutbox
export function saveOutbox(storage, list, opts) {
  persistOutbox(storage, list, opts);
  return list.length;
}

// ---------- 刪除墓碑（v4.3.1）----------
// 跨分頁的刪除靠 storage 裡的墓碑 {編號: 刪除時間 ms}（KEYS.outboxDel），留 7 天，讀的時候清掉過期的。
export const TOMBSTONE_KEEP_MS = 7 * 24 * 3600 * 1000;

function writeTombstones(storage, map) {
  try {
    if (Object.keys(map).length) storage.setItem(KEYS.outboxDel, JSON.stringify(map));
    else storage.removeItem(KEYS.outboxDel);
    return true;
  } catch (e) { return false; }
}

export function loadTombstones(storage, now = Date.now()) {
  let v = null;
  let dirty = false;
  try { v = JSON.parse(storage.getItem(KEYS.outboxDel)); } catch (e) { v = null; dirty = true; } // 壞掉的內容清掉
  const out = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [id, t] of Object.entries(v)) {
      if (ID_RE.test(id) && Number.isFinite(t) && now - t <= TOMBSTONE_KEEP_MS) out[id] = t;
      else dirty = true;
    }
  } else if (v != null) dirty = true;
  if (dirty) writeTombstones(storage, out); // 過期的順手清掉
  return out;
}

// 記下「這幾筆被刪掉了」。寫不進去不丟錯（本分頁還有自己的 deleted 集合），回傳 {tombstones, ok}
export function dropOutbox(storage, ids, now = Date.now()) {
  const m = loadTombstones(storage, now);
  for (const id of ids) if (ID_RE.test(String(id))) m[id] = now;
  return { tombstones: m, ok: writeTombstones(storage, m) };
}

// ---------- 雙分頁合併（v4.3；v4.3.1 加墓碑與 rev）----------
// mine：本分頁記憶體裡的陣列；stored：loadOutbox 讀到的（可能是別的分頁寫的）；
// deleted：本分頁刪掉的編號（stored 裡的不要被復活）；tombstones：storage 裡的墓碑（物件 {id:時間}、Set 或陣列）——
//   墓碑裡的編號 mine 和 stored 都丟掉，只有 mine 正在 sending 的例外（送出迴圈還拿著它，保持原物件）
//  - stored 有、mine 沒有、不在 deleted／墓碑 → 加進來（別的分頁新增的）
//  - 兩邊都有：mine 正在送出 → 用 mine（送出迴圈還拿著它）；stored 已送出而 mine 不是 sent → 用 stored；其餘取 rev 大的，相同用 mine
// mine 裡的物件盡量沿用同一個參照；回傳依建立時間排序的新陣列
const toSet = (v) => (v instanceof Set ? v : new Set(Array.isArray(v) ? v : v && typeof v === 'object' ? Object.keys(v) : []));
export function mergeOutbox(mine, stored, { deleted, tombstones } = {}) {
  const del = toSet(deleted);
  const tomb = toSet(tombstones);
  const st = new Map((stored || []).map((x) => [x.id, x]));
  const out = [];
  const seen = new Set();
  for (const m of mine) {
    if (tomb.has(m.id) && m.state !== 'sending') continue;
    seen.add(m.id);
    const s = st.get(m.id);
    if (!s || m.state === 'sending') out.push(m);
    else if (s.state === 'sent' && m.state !== 'sent') out.push(s);
    else if (m.state === 'sent' && s.state !== 'sent') out.push(m); // 已送出永遠優先：別頁在送出期間改的舊版不能把它拉回排隊重送（複查 e2）
    else out.push(revOf(s) > revOf(m) ? s : m);
  }
  for (const s of st.values()) if (!seen.has(s.id) && !del.has(s.id) && !tomb.has(s.id)) out.push(s);
  return out.map((x, i) => [x, i]).sort((a, b) => a[0].createdAt - b[0].createdAt || a[1] - b[1]).map(([x]) => x);
}

// 合併＋存檔（app.js 的 obChanged／mergeFromStorage 都呼叫這個）：讀 storage 的寫入紀錄與墓碑 → 跟 mine 合併 →
// persist 不是 false 就存回去。回傳 {list, ok}；ok 是存檔結果（不存檔時固定 true）
export function syncOutbox(storage, mine, { deleted, freeSpace, now = Date.now(), persist = true } = {}) {
  const list = mergeOutbox(mine, loadOutbox(storage, now), { deleted, tombstones: loadTombstones(storage, now) });
  const ok = persist === false ? true : persistOutbox(storage, list, { freeSpace });
  return { list, ok };
}

// 全部重試：失敗的全部回到排隊（不帶 force），回傳件數
export function retryAll(list) {
  let n = 0;
  for (const it of list) if (it.state === 'failed') { retry(it); n++; }
  return n;
}

// ---------- 狀態機 ----------
const ALLOWED = { queued: ['sending'], sending: ['sent', 'queued', 'failed'], failed: ['queued'], sent: [] };

export function transition(item, to, patch = {}) {
  if (!item || !ALLOWED[item.state]) throw new Error('寫入紀錄壞了');
  if (!ALLOWED[item.state].includes(to)) throw new Error('寫入紀錄不能從「' + item.state + '」變成「' + to + '」');
  Object.assign(item, patch, { state: to, rev: revOf(item) + 1 });
  return item;
}
export const startSend = (item) => transition(item, 'sending', { attempts: item.attempts + 1 });
export const markSent = (item, now = Date.now(), result = null) => transition(item, 'sent', { sentAt: now, err: '', code: '', result });
export const backToQueue = (item, err = '') => transition(item, 'queued', { err: String(err || '') });
export const markFailed = (item, err = '', code = '') => transition(item, 'failed', { err: String(err || ''), code: String(code || '') });
// 失敗 → 重試。payloadPatch：重試時順便改內容（例如日記「用我的版本覆蓋」帶 force:true）
export function retry(item, payloadPatch = null) {
  transition(item, 'queued', { err: '', code: '', attempts: 0 });
  if (payloadPatch) item.payload = { ...item.payload, ...payloadPatch };
  return item;
}

// 排隊中（或失敗後）改內容；送出中、已送出不能改
export function editPayload(item, patch) {
  if (item.state !== 'queued' && item.state !== 'failed') throw new Error('只有排隊中或失敗的寫入可以改內容');
  item.payload = { ...item.payload, ...patch };
  item.rev = revOf(item) + 1;
  return item;
}

// 刪除（送出中不能刪，會跟正在寫的那一筆搶）。回傳新陣列；找不到原樣回傳
export function removeItem(list, id) {
  const it = list.find((x) => x.id === id);
  if (!it) return list;
  if (it.state === 'sending') throw new Error('正在送出，等一下再刪');
  return list.filter((x) => x.id !== id);
}

// ---------- 錯誤分類 ----------
// network：沒網路、逾時、GitHub 暫時有問題（5xx、429、速率限制）→ 留在排隊，之後自動再送
// 其他（blocked、401／403／404、409／422 重試 3 次仍失敗、內部錯誤）→ failed，給白話原因
export function classifyError(e) {
  if (e && e.blocked) return { network: false, code: e.code || 'blocked', message: e.message };
  if (e instanceof GitHubError) {
    const s = e.status;
    if (s >= 500 || s === 408 || s === 429 || (s === 403 && /rate limit|abuse|secondary/i.test(e.message))) return { network: true, code: 'http' + s, message: '連不上 GitHub（' + s + '），稍後會自動再送' };
    return { network: false, code: 'http' + s, message: errMsg(e) };
  }
  if (e && (e.name === 'AbortError' || (e instanceof TypeError && /fetch|network|load failed|failed to|internet/i.test(String(e.message))))) return { network: true, code: 'network', message: '連不上網路，連上後會自動再送' };
  return { network: false, code: 'error', message: e && e.message ? e.message : String(e) };
}

// ---------- 送出迴圈 ----------
const byCreated = (a, b) => a.createdAt - b.createdAt;
export const queuedItems = (list) => list.map((x, i) => [x, i]).filter(([x]) => x.state === 'queued' && isKnownKind(x.kind)).sort((a, b) => byCreated(a[0], b[0]) || a[1] - b[1]).map(([x]) => x);

// 依建立順序一筆一筆送（同時間只送一筆）。execute(item) 回傳結果（存進 item.result）或丟錯。
// 網路錯誤 → 那一筆回到排隊、整個迴圈停（不重複打網路）；其他錯誤 → 那一筆失敗，繼續送下一筆。
// onChange(item)：每次狀態變化後呼叫（呼叫端存檔、更新畫面）。shouldStop()：想中途停下來（例如被鎖定、換了 client）
// list 可以是陣列，或「回傳目前最新陣列」的函式：每一輪都重讀，使用者在送出途中刪掉的項目就不會再被送（QC 必修 1）。
// skip(item)：回傳 true 的項目這一輪先不送（例如使用者正在編輯那一筆）
export async function processOutbox(list, execute, { now = () => Date.now(), onChange = () => {}, shouldStop = () => false, skip = () => false } = {}) {
  const res = { sent: 0, failed: 0, offline: false, tried: 0 };
  const cur = () => (typeof list === 'function' ? list() : list);
  if (cur().some((x) => x.state === 'sending')) return res; // 已經有一筆在送
  for (;;) {
    if (shouldStop()) break;
    const item = queuedItems(cur()).filter((x) => !skip(x))[0];
    if (!item) break;
    startSend(item);
    res.tried++;
    onChange(item);
    try {
      const r = await execute(item);
      markSent(item, now(), r && typeof r === 'object' ? { action: r.action || '', reason: r.reason || '' } : null);
      res.sent++;
      onChange(item);
    } catch (e) {
      const c = classifyError(e);
      if (c.network) {
        backToQueue(item, c.message);
        res.offline = true;
        onChange(item);
        break;
      }
      markFailed(item, c.message, c.code);
      res.failed++;
      onChange(item);
    }
  }
  return res;
}

export function outboxCounts(list) {
  const c = { queued: 0, sending: 0, sent: 0, failed: 0 };
  for (const x of list) if (c[x.state] != null && isKnownKind(x.kind)) c[x.state]++; // 不認得的 kind 不算排隊／失敗（也不會送）
  return c;
}
