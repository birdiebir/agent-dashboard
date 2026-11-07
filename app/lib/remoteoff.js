// P69：手機叫電腦關遠端（純函式，不碰 DOM）。契約：D:\Personal\Agent\docs\手機關遠端契約.md
// 跟「叫電腦開遠端」（lib/remoteopen.js）寫同一個檔 signal/remote_request.json，後寫的覆蓋先寫的。
// 請求格式（鍵要剛好這四個）：{"id":"m-xxxxxxxx","created_at":"ISO（含時區）","action":"off","hours":null}
// id 沿用 outbox 項目編號（每按一次產生新的）；重送同一筆＝同一個 id＝檔案不變（noop）。
import { TWDate as Date } from './tz.js';
import { REMOTE_REQUEST_PATH, NO_REPLY_MS, NO_REPLY_TEXT, SUPERSEDED_TEXT, isoSeconds } from './remoteopen.js';

export { REMOTE_REQUEST_PATH };
export const CONFIRM_OFF_TEXT = '要關掉電腦的遠端模式嗎？關了之後留言要等你下次開遠端才會處理';
export const OLD_OPENER_REASON = '請求格式不對，沒有開'; // 舊版開啟器看不懂 action:"off" 時的固定回報
export const OLD_OPENER_TEXT = '電腦端還沒更新，重開電腦後再試';

const REQ_ID_RE = /^m-[a-z0-9]{8}$/;

export function remoteOffPayload(id, now) {
  if (!REQ_ID_RE.test(String(id))) throw new Error('遠端請求編號格式不對：' + id);
  return { id, created_at: isoSeconds(now) };
}

export function requestBody(payload) {
  const p = payload || {};
  if (!REQ_ID_RE.test(String(p.id)) || typeof p.created_at !== 'string' || !p.created_at) throw new Error('遠端請求內容不對');
  return JSON.stringify({ id: p.id, created_at: p.created_at, action: 'off', hours: null }, null, 2) + '\n';
}

// outbox_exec 的 mutate：檔案裡已經是同一個 id＝原樣回傳（noop，重送不重複）；否則直接覆蓋成這一筆
export function applyRemoteOff(text, payload) {
  if (text != null && String(text).trim() !== '') {
    let cur = null;
    try { cur = JSON.parse(text); } catch (e) { cur = null; }
    if (cur && typeof cur === 'object' && cur.id === (payload || {}).id) return text;
  }
  return requestBody(payload);
}

const R = (phase, label) => ({ phase, label });
const at = (s) => { const t = Date.parse(s || ''); return Number.isFinite(t) ? t : NaN; };

// 已送出（state='sent'）的一筆。契約第 5 節表格：
//   opener.req_id 等於這個 id 才算電腦端處理過這一筆；off_done／already_off＝已關；rejected／failed＝失敗
//   沒有 opener 回報：remote.on 已是 false 而且狀態檔更新時間晚於「送出時間減 60 秒」＝已關；送出超過 4 分鐘、遠端還開著＝電腦沒回應
export function remoteOffPhase(item, status, now = Date.now()) {
  const op = status && status.opener && status.opener.req_id === item.id ? status.opener : null;
  const sentAt = item.sentAt || item.createdAt;
  if (!op) {
    // 被之後的請求取代：opener 只記最後一筆。別筆的處理時間晚於這一筆送出，或關掉後又重開了，這一筆就不再等
    const other = status && status.opener && status.opener.req_id !== item.id ? at(status.opener.at) : NaN;
    if (Number.isFinite(other) && other > sentAt) return { phase: 'handled', label: SUPERSEDED_TEXT, superseded: true };
    const since = status && status.remote ? at(status.remote.since) : NaN;
    if (status && status.remote && status.remote.on === true && Number.isFinite(since) && since > sentAt) return { phase: 'handled', label: SUPERSEDED_TEXT, superseded: true };
    const off = !!(status && status.remote && status.remote.on === false);
    if (off && at(status.updated_at) >= sentAt - 60000) return R('handled', '電腦已關遠端');
    const on = !!(status && status.remote && status.remote.on);
    if (on && now - sentAt > NO_REPLY_MS) return R('failed', NO_REPLY_TEXT);
    return R('waiting', '已送出，等電腦');
  }
  switch (op.result) {
    case 'off_done': return R('handled', op.reason || '電腦已關遠端');
    case 'already_off': return R('handled', op.reason || '遠端模式本來就關著');
    case 'rejected':
      if (op.reason === OLD_OPENER_REASON) return R('failed', OLD_OPENER_TEXT);
      return R('failed', op.reason || '電腦沒關成遠端');
    default: return R('failed', op.reason || '電腦沒關成遠端'); // failed 與其他：reason 是電腦端固定字串
  }
}

// #remote-slot 的「關遠端」按鈕狀態。回傳 null＝不顯示（遠端沒開）；否則 {disabled, label, note, phase}
//   有一筆還在途中（排隊、送出、等電腦）→ 停用「等待中…」；失敗或沒回應可再按（新 id）
export function remoteOffButtonState({ items = [], status = null, remoteOn = false, now = Date.now() } = {}) {
  if (!remoteOn) return null;
  const mine = items.filter((x) => x && x.kind === 'remoteoff').sort((a, b) => a.createdAt - b.createdAt);
  const last = mine[mine.length - 1];
  const base = { disabled: false, label: '🔌 關遠端', note: '', phase: 'idle' };
  if (!last) return base;
  if (last.state === 'queued' || last.state === 'sending') return { ...base, disabled: true, label: '等待中…', note: last.state === 'sending' ? '送出中…' : '已存在手機，連上網路後送出', phase: 'queued' };
  if (last.state === 'failed') return { ...base, note: last.err || '沒送出，可以再按一次', phase: 'failed' };
  const ph = remoteOffPhase(last, status, now);
  if (ph.phase === 'waiting') return { ...base, disabled: true, label: '等待中…', note: ph.label, phase: 'waiting' };
  if (ph.phase === 'failed') return { ...base, note: ph.label, phase: 'failed' };
  if (ph.superseded) return base; // 已被之後的請求取代（例如關掉後又重開）：不卡住按鈕
  // handled 但畫面上遠端還是開著：可能是狀態檔還沒更新，也可能是之後又重新開了遠端
  const since = status && status.remote ? at(status.remote.since) : NaN;
  if (Number.isFinite(since) && since > last.createdAt) return base; // 這次遠端是關了之後新開的
  const sentAt = last.sentAt || last.createdAt;
  if (now - sentAt > NO_REPLY_MS) return base;
  return { ...base, disabled: true, label: '等待中…', note: '電腦已回報關閉，等畫面更新', phase: 'waiting' };
}
