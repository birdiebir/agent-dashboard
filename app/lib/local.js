// 只存在這台手機的小狀態（P46 v3 第 3 階段）：
//   agent.tnum     任務 T 編號 {next, map:{雜湊:數字}}（只存雜湊與數字，不存任務文字）
//   agent.accepted 按過「接受結果」的任務雜湊（只存雜湊）
//   agent.recentP  最近用過的專案編號（只存 PID，最多 3 個）
//   agent.promoteReq 已送出升格請求的任務 {任務雜湊: 送出時間戳}（只存雜湊與時間，不存任務文字）
//   agent.home.more 首頁「更多資訊」展開旗標（'1'＝展開，沒有＝收合）
//   agent.qgroups  待我頁收合的分組名稱 [名稱…]（只存分類名稱；沒存過＝用預設）
//   agent.qsort    待我頁排序方式（important／deadline／new／old）
//   agent.sent     送出紀錄（只存題號、時間、答案前 40 字、寫去哪、電腦收了沒；保留 14 天）
//   agent.outbox   寫入紀錄（v4 M3：回答、日記、筆記、任務、對話、升格請求、維持任務，每筆先存這裡再送；內容是使用者自己寫的原文，
//                  開 PIN 也不加密，跟草稿同一個原則〔Q202＝C〕；格式與規則在 lib/outbox.js）
//   agent.outbox.del 寫入紀錄的刪除墓碑（v4.3.1）{編號: 刪除時間 ms}，留 7 天；雙分頁時讓「別的分頁刪掉的」不會被這一頁寫回去
// 儲存空間由呼叫端傳進來（storage 參數）；示範模式傳 memStorage()，不碰真的 localStorage。
export const KEYS = { tnum: 'agent.tnum', accepted: 'agent.accepted', recentP: 'agent.recentP', promoteReq: 'agent.promoteReq', homeMore: 'agent.home.more', qgroups: 'agent.qgroups', qsort: 'agent.qsort', sent: 'agent.sent', outbox: 'agent.outbox', outboxDel: 'agent.outbox.del' };

export function memStorage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

function readJSON(storage, key, fallback) {
  try { const v = JSON.parse(storage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
}
function writeJSON(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); } catch (e) { /* 空間不足就算了 */ }
}

export function loadTnum(storage) {
  const v = readJSON(storage, KEYS.tnum, null);
  return v && typeof v === 'object' && v.map && typeof v.map === 'object' && !Array.isArray(v.map) ? v : { next: 1, map: {} };
}
export const saveTnum = (storage, v) => writeJSON(storage, KEYS.tnum, v);

export function loadAccepted(storage) {
  const v = readJSON(storage, KEYS.accepted, []);
  return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
}
export function addAccepted(storage, key) {
  const s = loadAccepted(storage);
  s.add(key);
  writeJSON(storage, KEYS.accepted, [...s]);
  return s;
}

export function loadRecentP(storage) {
  const v = readJSON(storage, KEYS.recentP, []);
  return Array.isArray(v) ? v.filter((x) => /^P\d+$/.test(x)).slice(0, 3) : [];
}
export function pushRecentP(storage, pid) {
  if (!/^P\d+$/.test(pid || '')) return loadRecentP(storage);
  const next = [pid, ...loadRecentP(storage).filter((x) => x !== pid)].slice(0, 3);
  writeJSON(storage, KEYS.recentP, next);
  return next;
}

// 升格請求：只存任務雜湊與送出時間（ms）
export function loadPromoteReq(storage) {
  const v = readJSON(storage, KEYS.promoteReq, {});
  const out = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, t] of Object.entries(v)) if (/^[0-9a-f]{8}$/.test(k) && Number.isFinite(t)) out[k] = t;
  return out;
}
export function addPromoteReq(storage, key, at) {
  const m = loadPromoteReq(storage);
  m[key] = at;
  writeJSON(storage, KEYS.promoteReq, m);
  return m;
}

// 首頁「更多資訊」展開旗標
export const loadHomeMore = (storage) => { try { return storage.getItem(KEYS.homeMore) === '1'; } catch (e) { return false; } };
export function saveHomeMore(storage, open) {
  try { if (open) storage.setItem(KEYS.homeMore, '1'); else storage.removeItem(KEYS.homeMore); } catch (e) { /* 忽略 */ }
}

// 待我頁分組收合（只存分類名稱）與排序
// 格式 {c:[使用者收合的組], e:[使用者展開的組]}：只存「跟預設不同」的選擇；舊格式（陣列）直接丟掉
const names = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string').slice(0, 60) : []);
export function loadQGroups(storage) {
  const v = readJSON(storage, KEYS.qgroups, null);
  return v && typeof v === 'object' && !Array.isArray(v) ? { c: names(v.c), e: names(v.e) } : null;
}
export const saveQGroups = (storage, v) => writeJSON(storage, KEYS.qgroups, { c: names(v && v.c), e: names(v && v.e) });
const SORT_KEYS = ['important', 'deadline', 'new', 'old'];
export function loadQSort(storage) { try { const v = storage.getItem(KEYS.qsort); return SORT_KEYS.includes(v) ? v : 'important'; } catch (e) { return 'important'; } }
export function saveQSort(storage, v) { try { if (SORT_KEYS.includes(v)) storage.setItem(KEYS.qsort, v); } catch (e) { /* 忽略 */ } }

// 升格請求：任務離開 waiting 時清掉那筆；回傳新的 map
export function removePromoteReq(storage, key) {
  const m = loadPromoteReq(storage);
  if (key in m) { delete m[key]; writeJSON(storage, KEYS.promoteReq, m); }
  return m;
}
// 只有 Task.md 本身反映出結果時才清掉升格請求（resumable 是「題目答完了、等電腦接著做」，請求還在有效期）
export const PROMOTE_CLEAR_STATES = ['done', 'promoted', 'cancelled', 'failed', 'review', 'doing'];
export const PROMOTE_STALE_MS = 24 * 3600 * 1000;
export const promoteStale = (at, now = Date.now()) => now - at > PROMOTE_STALE_MS;

// 設定頁「清除這台手機的資料」：草稿由 drafts.clearAllDrafts 清
export function clearLocalState(storage) {
  for (const k of Object.values(KEYS)) { try { storage.removeItem(k); } catch (e) { /* 忽略 */ } }
}

// 任務表單下拉選單：projectChoices＋「要選的 pid 不在選單裡」時補一個選項（暫停／構想／已結案／不在 Project.md），
// 不能讓 select 變成空值而被默默寫成「不屬於任何專案」。回傳 {choices, extra:{pid,name,note}|null, value}
export function projectOptions(projects, recent = [], want = '') {
  const choices = projectChoices(projects, recent);
  let extra = null;
  if (/^P\d+$/.test(want || '') && !choices.some((c) => c.pid === want)) {
    const p = projects.find((x) => x.pid === want);
    const note = !p ? '不在 Project.md 總覽' : p.closed ? '已結案' : p.status === '⏸' ? '暫停' : p.status === '💡' ? '構想' : '非進行中';
    extra = { pid: want, name: p ? p.name : '', note };
  }
  const value = /^P\d+$/.test(want || '') ? want : (choices[0] ? choices[0].pid : 'none');
  return { choices, extra, value };
}

// 任務表單的專案選單：先列「進行中」（🟢🟡、未結案），最近用過的 3 個放最前面；已結案、暫停、構想不列。
// 回傳 [{pid, name, group, recent}]
export function projectChoices(projects, recent = []) {
  const active = projects.filter((p) => !p.closed && (p.status === '🟢' || p.status === '🟡') && /^P\d+$/.test(p.pid));
  const by = new Map(active.map((p) => [p.pid, p]));
  const first = recent.filter((id) => by.has(id)).map((id) => ({ ...by.get(id), recent: true }));
  const seen = new Set(first.map((p) => p.pid));
  return [...first, ...active.filter((p) => !seen.has(p.pid)).map((p) => ({ ...p, recent: false }))].map((p) => ({ pid: p.pid, name: p.name, group: p.group, recent: p.recent }));
}

// ---------- 送出紀錄（重開 App 還在）----------
// state.sent 的每一筆 {qid, at, text, summary, target, received} 存成 {q, at, s, t, r}：
// 只存題號、時間、答案前 40 字摘要（不存完整答案）、寫去哪（questions／supplement）、電腦收了沒。保留 14 天。
export const SENT_KEEP_MS = 14 * 24 * 3600 * 1000;
const clip40 = (s) => [...String(s || '')].slice(0, 41).join(''); // summarize 最多 40 字加「…」

export function loadSent(storage, now = Date.now()) {
  const v = readJSON(storage, KEYS.sent, []);
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const x of v) {
    if (!x || typeof x !== 'object' || !/^(?:Q|KB)\d+$/.test(x.q) || !Number.isFinite(x.at) || now - x.at > SENT_KEEP_MS) continue;
    out.push({ qid: x.q, at: x.at, text: '', summary: clip40(x.s), target: x.t === 'supplement' ? 'supplement' : 'questions', received: !!x.r });
  }
  return out;
}
export function saveSent(storage, list, now = Date.now()) {
  const keep = (list || []).filter((r) => r && Number.isFinite(r.at) && now - r.at <= SENT_KEEP_MS)
    .map((r) => ({ q: r.qid, at: r.at, s: clip40(r.summary), t: r.target === 'supplement' ? 'supplement' : 'questions', r: r.received ? 1 : 0 }));
  if (keep.length) writeJSON(storage, KEYS.sent, keep);
  else { try { storage.removeItem(KEYS.sent); } catch (e) { /* 忽略 */ } }
  return keep.length;
}
