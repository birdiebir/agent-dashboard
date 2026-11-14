// P70 手機自我診斷回報（2026-11-05）：手機把「自己現在的狀態」寫到 signal 分支的 signal/phone_diag.json，電腦直接讀。
// 只放計數、狀態、時間、錯誤碼，不放任何內文（payload、對話、題目、token、金鑰、檔案內容一律不進來）。
// 不走 outbox：outbox 卡住時診斷也會跟著卡，所以直接呼叫 client.updateFile，每次整份覆寫。
// TODO（快路徑，這次不做）：電腦端的 tunnel 開著時，PWA 可以改直接 POST 診斷到 tunnel，不經 GitHub。
import { queuedItems } from './outbox.js';

export const DIAG_PATH = 'signal/phone_diag.json';
export const DIAG_ERR_KEY = 'agent.diagErr';
export const DIAG_LAST_KEY = 'agent.diagLast';
export const DIAG_THROTTLE_MS = 60000;
export const DIAG_ERR_MAX = 10;
export const DIAG_MESSAGE = 'phone diag (手機)';
export const REFRESH_TIMINGS_KEY = 'agent.refreshTimings';
// 手機 epoch 毫秒；拒絕空白、指數、未來與過期值。通知 URL 與 SW 訊息共用。
export function validPushAt(value, now = globalThis.Date.now()) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d{13}$/.test(value))) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= now - 86400000 && n <= now + 60000 ? n : null;
}
const timingMs = (n) => Number.isSafeInteger(n) && n > 0 ? n : null;
const timingTabs = ['home', 'record', 'chat', 'todo', 'tasks', 'projects', 'mine', 'reminders', 'reports', 'settings', 'notices', 'more', 'feed', 'health'];
// 白名單投影：本機儲存遭污染也不把內容或編號帶進診斷。
export function refreshTimings(rows) {
  return (Array.isArray(rows) ? rows : []).slice(-20).map((r) => ({
    pushAt: timingMs(r?.pushAt), foregroundAt: timingMs(r?.foregroundAt),
    dataAt: timingMs(r?.dataAt), domAt: timingMs(r?.domAt),
    visible: r?.visible === true, tab: timingTabs.includes(r?.tab) ? r.tab : null,
  }));
}
export function loadRefreshTimings(storage) {
  try { return refreshTimings(JSON.parse(storage.getItem(REFRESH_TIMINGS_KEY))); } catch { return []; }
}

const MS = (typeof globalThis !== 'undefined' && globalThis.Date) || Date;
const iso = (ms) => (Number.isFinite(ms) && ms > 0 ? new MS(ms).toISOString() : null);
export const clip = (s, n = 200) => String(s == null ? '' : s).slice(0, n);
const tail4 = (id) => String(id == null ? '' : id).slice(-4);

// 例外 → 一行文字：HTTP 狀態（有的話）加訊息前 200 字
export function errText(e) {
  if (e == null) return '';
  const st = e.status != null && e.status !== '' ? e.status + ' ' : '';
  const m = e && e.message != null ? e.message : e;
  return clip(st + m, 200);
}

const headOf = (it) => (it ? {
  id: tail4(it.id), kind: it.kind, createdAt: iso(it.createdAt), attempts: it.attempts || 0, state: it.state,
  err: clip(it.err, 200), code: clip(it.code, 40),
} : null);

// P70 推播根治：通知狀態一行（只有布林與狀態字，不放 endpoint／金鑰）。ctx.push＝{enabled, permission, hasSub, disabledByPc, lastRepairAt(ms), lastRepairResult}
export function pushDiag(p) {
  const x = p && typeof p === 'object' ? p : {};
  return {
    enabled: !!x.enabled, permission: clip(x.permission, 20) || 'unknown', hasSub: x.hasSub == null ? null : !!x.hasSub,
    disabledByPc: x.disabledByPc == null ? null : !!x.disabledByPc,
    lastRepairAt: iso(x.lastRepairAt), lastRepairResult: x.lastRepairResult ? clip(x.lastRepairResult, 20) : null,
  };
}

// P69 快路徑：只放「有沒有設定、網域種類、上次門鈴／長輪詢結果與時間」。不放金鑰、金鑰編號、完整網址、留言內容。
// ctx.fastpath＝{configured, urlOk, expiresAt(秒), polling, bell:{ok,why,at}, poll:{ok,why,at}, replies}
const fpResult = (r) => (r && typeof r === 'object' ? { ok: !!r.ok, why: r.ok ? '' : clip(r.why, 30), at: iso(r.at) } : null);
export function fastpathDiag(f) {
  const x = f && typeof f === 'object' ? f : {};
  return {
    configured: !!x.configured, domain: x.configured ? (x.urlOk ? 'trycloudflare' : 'other') : null,
    expiresAt: Number.isFinite(x.expiresAt) ? iso(x.expiresAt * 1000) : null, polling: !!x.polling,
    lastBell: fpResult(x.bell), lastPoll: fpResult(x.poll), replies: Number.isFinite(x.replies) ? x.replies | 0 : 0,
  };
}

// P74 hub v2：對話資料來源（json｜live）、有沒有退回 live 與原因、單則壞掉的計數、view.errors（電腦端記的壞檔，只放編號與原因）。不放內文。
// ctx.hub＝lib/hub.js hubDiagInfo 的結果（或 null＝這個版本之前的舊狀態）
export function hubDiag(h) {
  if (!h || typeof h !== 'object') return null;
  const fb = (Array.isArray(h.fallbacks) ? h.fallbacks : []).slice(-10).map((x) => ({ at: clip(x && x.at, 40), reason: clip(x && x.reason, 40), detail: clip(x && x.detail, 120) }));
  return {
    source: clip(h.source, 10), requested: clip(h.requested, 10), local: clip(h.local, 10), remote: h.remote ? clip(h.remote, 10) : null,
    fallback: h.fallback ? clip(h.fallback, 40) : null, fallbackDetail: clip(h.fallbackDetail, 120), fallbacks: fb,
    bad: Number.isFinite(h.bad) ? h.bad | 0 : 0, remoteBad: clip(h.remoteBad, 120), history: Number.isFinite(h.history) ? h.history | 0 : 0, viewAt: h.viewAt ? clip(h.viewAt, 40) : null,
    viewErrors: (Array.isArray(h.viewErrors) ? h.viewErrors : []).slice(0, 5).map((e) => ({ id: clip(e && e.id, 60), reason: clip(e && e.reason, 120) })),
  };
}

// ctx：{now, version, ua, standalone, onLine, locked, hasClient, rateRemaining, ob(寫入紀錄陣列), diag(state.diag), flushing, noFlush,
//       lock({held,pending}|null), loading, mine(deriveMine 的列), errors}
export function buildDiag(ctx = {}) {
  const now = Number.isFinite(ctx.now) ? ctx.now : MS.now();
  const ob = Array.isArray(ctx.ob) ? ctx.ob : [];
  const dg = ctx.diag || {};
  const fl = dg.flush || {};
  const rf = dg.refresh || {};
  const byState = { queued: 0, sending: 0, sent: 0, failed: 0 };
  const byKind = {};
  for (const x of ob) {
    if (byState[x.state] != null) byState[x.state]++;
    byKind[x.kind] = (byKind[x.kind] || 0) + 1;
  }
  const q = queuedItems(ob);
  const rows = Array.isArray(ctx.mine) ? ctx.mine : [];
  const counts = {};
  for (const r of rows) {
    const p = r.phase || '?';
    counts[p] = counts[p] || {};
    counts[p][r.kind] = (counts[p][r.kind] || 0) + 1;
  }
  const open = rows.filter((r) => r.phase === 'waiting' || r.phase === 'queued' || r.phase === 'failed')
    .slice().sort((a, b) => (a.item ? a.item.createdAt : 0) - (b.item ? b.item.createdAt : 0)).slice(0, 10)
    .map((r) => ({ kind: r.kind, phase: r.phase, label: clip(r.label, 60), createdAt: iso(r.item && r.item.createdAt), sentAt: iso(r.item && r.item.sentAt) }));
  const lock = ctx.lock && typeof ctx.lock === 'object' ? ctx.lock : null;
  const res = fl.lastResult && typeof fl.lastResult === 'object' ? fl.lastResult : null;
  return {
    v: 1,
    at: iso(now),
    app: { sw: clip(ctx.version, 80) || 'unknown', ua: clip(ctx.ua, 80), standalone: !!ctx.standalone },
    net: { onLine: ctx.onLine == null ? null : !!ctx.onLine },
    auth: { locked: !!ctx.locked, hasClient: !!ctx.hasClient },
    rate: { remaining: Number.isFinite(ctx.rateRemaining) ? ctx.rateRemaining : null, at: iso(now) },
    outbox: {
      total: ob.length, byState, byKind,
      head: headOf(q[0]),
      sendingItems: ob.filter((x) => x.state === 'sending').map((x) => ({ id: tail4(x.id), kind: x.kind, createdAt: iso(x.createdAt), attempts: x.attempts || 0 })),
      failed: ob.filter((x) => x.state === 'failed').slice(0, 10).map((x) => ({ id: tail4(x.id), kind: x.kind, createdAt: iso(x.createdAt), err: clip(x.err, 200), code: clip(x.code, 40) })),
    },
    flush: {
      flushing: !!ctx.flushing, noFlush: !!ctx.noFlush,
      lastStart: iso(fl.lastStart), lastEnd: iso(fl.lastEnd), lockMissAt: iso(fl.lockMissAt),
      lastResult: res ? { sent: res.sent | 0, failed: res.failed | 0, offline: !!res.offline, tried: res.tried | 0 } : null,
      lastError: clip(fl.lastError, 200),
      lockHeld: lock ? { supported: true, held: lock.held | 0, pending: lock.pending | 0 } : { supported: false, held: 0, pending: 0 },
    },
    refresh: { loading: !!ctx.loading, lastOk: iso(rf.lastOk), lastErr: clip(rf.lastErr, 200) },
    ...(ctx.refreshTimings ? { chatRefresh: refreshTimings(ctx.refreshTimings) } : {}),
    push: pushDiag(ctx.push),
    fastpath: fastpathDiag(ctx.fastpath),
    hub: hubDiag(ctx.hub),
    mine: { counts, waitingOldest: open },
    errors: (Array.isArray(ctx.errors) ? ctx.errors : []).slice(-DIAG_ERR_MAX).map((e) => ({ at: clip(e && e.at, 40), where: clip(e && e.where, 40), msg: clip(e && e.msg, 200) })),
  };
}

// navigator.locks.query() → {held, pending}（只數 agent-outbox）。不支援或丟錯回 null
export async function lockInfo(locks, name = 'agent-outbox') {
  try {
    if (!locks || typeof locks.query !== 'function') return null;
    const q = await locks.query();
    const f = (a) => (Array.isArray(a) ? a.filter((x) => x && x.name === name).length : 0);
    return { held: f(q && q.held), pending: f(q && q.pending) };
  } catch (e) { return null; }
}

// caches.keys() 裡 agent-app-<commit>：頁面端取得 sw 版本的做法（SW 的 VERSION 部署時被換成 commit sha，快取名稱就是它）
export const versionFromCaches = (keys) => {
  const v = (keys || []).filter((k) => String(k).startsWith('agent-app-')).map((k) => String(k).slice('agent-app-'.length));
  return v.length ? v.join(',') : 'unknown';
};

// ---------- 本機累積的診斷錯誤（寫失敗時存起來，下次成功寫入時帶上）----------
export function loadDiagErrs(storage) {
  try {
    const v = JSON.parse(storage.getItem(DIAG_ERR_KEY));
    return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object').slice(-DIAG_ERR_MAX) : [];
  } catch (e) { return []; }
}
export function pushDiagErr(storage, where, err, now = MS.now()) {
  try {
    const list = loadDiagErrs(storage);
    list.push({ at: iso(now), where: clip(where, 40), msg: errText(err) });
    storage.setItem(DIAG_ERR_KEY, JSON.stringify(list.slice(-DIAG_ERR_MAX)));
  } catch (e) { /* 存不了就算了，診斷不能影響本業 */ }
}
export function clearDiagErrs(storage) { try { storage.removeItem(DIAG_ERR_KEY); } catch (e) { /* 忽略 */ } }

// 比對「內容有沒有變」用：去掉 at，另外去掉 rate（每次 API 呼叫剩餘額度都會變，不算內容變）
export const diagSig = (d) => JSON.stringify({ ...d, at: '', rate: null });

// 送出器：getCtx() 回傳 buildDiag 的 ctx（可以是 Promise）；getClient() 回傳 {client, locked}
// send(reason)：鎖著或沒有 client → 只存本機、不寫；同 reason 60 秒內最多一次；內容沒變不寫；寫失敗存 agent.diagErr，永遠不丟例外。
export function createDiagSender({ getCtx, storage, signalBranch = 'signal', now = () => MS.now() }) {
  const lastAt = {};
  let lastSig = '';
  let inflight = false;
  return async function sendDiag(reason = 'manual') {
    try {
      const ctx = await getCtx();
      const t = now();
      const diag = buildDiag({ ...ctx, now: t, errors: loadDiagErrs(storage) });
      try { storage.setItem(DIAG_LAST_KEY, JSON.stringify(diag)); } catch (e) { /* 存不了就算了 */ }
      if (!ctx.client || ctx.locked) return { skipped: 'locked' };
      if (lastAt[reason] != null && t - lastAt[reason] < DIAG_THROTTLE_MS) return { skipped: 'throttle' };
      if (inflight) return { skipped: 'inflight' };
      const sig = diagSig(diag);
      if (sig === lastSig) return { skipped: 'same' };
      lastAt[reason] = t;
      inflight = true;
      try {
        await ctx.client.updateFile(DIAG_PATH, () => JSON.stringify(diag), DIAG_MESSAGE, 1, { ref: signalBranch, create: true });
        lastSig = sig;
        clearDiagErrs(storage);
        return { sent: true };
      } catch (e) {
        pushDiagErr(storage, 'write:' + reason, e, t);
        return { error: errText(e) };
      } finally { inflight = false; }
    } catch (e) {
      try { pushDiagErr(storage, 'build:' + reason, e); } catch (e2) { /* 忽略 */ }
      return { error: errText(e) };
    }
  };
}
