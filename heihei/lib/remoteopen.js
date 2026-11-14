// P62 M5b：手機叫電腦開遠端（純函式，不碰 DOM）。設計 docs/P62_第一段設計.md §3.7(b)。
// 手機寫 signal/remote_request.json，電腦端 remote_opener.py 驗證後開視窗，結果寫回 signal/chat_status.json 的 opener。
// 請求格式（電腦端 check_schema 要求欄位完全一致）：{"id":"m-xxxxxxxx","created_at":"ISO（含時區）","action":"open_remote","hours":null}
// id 沿用 outbox 項目編號（m- 加 8 個小寫英數），每按一次產生新的；重送同一筆＝同一個 id＝檔案不變（noop）。
import { TWDate as Date } from './tz.js';
export const REMOTE_REQUEST_PATH = 'signal/remote_request.json';
export const COOLDOWN_MS = 10 * 60 * 1000; // 跟電腦端 cooldown_min 預設一致：剛叫過，10 分鐘內不能再叫
export const NO_REPLY_MS = 4 * 60 * 1000; // 電腦端 3 分鐘內沒進遠端會自己回報失敗；再多給 1 分鐘，仍沒有 opener 回報＝電腦沒回應
export const NO_REPLY_TEXT = '電腦沒回應，可能關機或睡著；電腦關著時先用 Gemini App';
export const SUPERSEDED_TEXT = '已被之後的請求取代';
export const CONFIRM_TEXT = '要叫電腦開遠端嗎？';

const REQ_ID_RE = /^m-[a-z0-9]{8}$/; // 電腦端 ID_RE：只收小寫英數

export function isoSeconds(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// outbox payload：{id, created_at}。id 必須符合電腦端格式
export function remoteOpenPayload(id, now) {
  if (!REQ_ID_RE.test(String(id))) throw new Error('遠端請求編號格式不對：' + id);
  return { id, created_at: isoSeconds(now) };
}

export function requestBody(payload) {
  const p = payload || {};
  if (!REQ_ID_RE.test(String(p.id)) || typeof p.created_at !== 'string' || !p.created_at) throw new Error('遠端請求內容不對');
  return JSON.stringify({ id: p.id, created_at: p.created_at, action: 'open_remote', hours: null }, null, 2) + '\n';
}

// outbox_exec 的 mutate：檔案裡已經是同一個 id＝原樣回傳（noop，重送不重複）；否則直接覆蓋成這一筆
export function applyRemoteOpen(text, payload) {
  if (text != null && String(text).trim() !== '') {
    let cur = null;
    try { cur = JSON.parse(text); } catch (e) { cur = null; }
    if (cur && typeof cur === 'object' && cur.id === (payload || {}).id) return text;
  }
  return requestBody(payload);
}

const R = (phase, label) => ({ phase, label });
const at = (s) => { const t = Date.parse(s || ''); return Number.isFinite(t) ? t : NaN; };

// 已送出（state='sent'）的一筆：電腦收了沒、開了沒。status＝readChatStatus 的結果或 null
//   opener.req_id 等於這個 id 才算電腦端處理過這一筆；沒有就看送出多久了
export function remoteOpenPhase(item, status, now = Date.now()) {
  const op = status && status.opener && status.opener.req_id === item.id ? status.opener : null;
  const on = !!(status && status.remote && status.remote.on);
  if (!op) {
    // 被之後的請求取代：opener 只記最後一筆，別筆的處理時間晚於這一筆送出＝這一筆已經不用等
    const other = status && status.opener && status.opener.req_id !== item.id ? at(status.opener.at) : NaN;
    if (Number.isFinite(other) && other > (item.sentAt || item.createdAt)) return R('handled', SUPERSEDED_TEXT);
    if (on && at(status.remote.since) >= item.createdAt - 60000) return R('handled', '電腦已開遠端'); // 沒看到 opener 回報、但遠端剛好開了
    return now - (item.sentAt || item.createdAt) > NO_REPLY_MS ? R('failed', NO_REPLY_TEXT) : R('waiting', '已送出，等電腦');
  }
  switch (op.result) {
    case 'launched':
      if (on) return R('handled', '電腦已開遠端');
      return now - (at(op.at) || item.sentAt || item.createdAt) > NO_REPLY_MS ? R('failed', '電腦沒開成遠端（沒有進入遠端模式）') : R('received', '電腦已開視窗，等進入遠端模式');
    case 'already_on': return R('handled', op.reason || '電腦已經在遠端模式');
    case 'cooldown': return R('failed', op.reason || '太頻繁，冷卻時間過了再試');
    default: return R('failed', op.reason || '電腦沒開成遠端'); // rejected、failed：reason 是電腦端固定字串
  }
}

// #remote-slot 的按鈕狀態。回傳 null＝不顯示（遠端已開）；否則 {disabled, label, note, phase}
//   items：outbox 全部項目；remoteOn：true／false；
//   順序：遠端開著不顯示 → 有一筆還在途中（排隊、送出、等電腦）→ 停用「等待中」；
//         剛叫過 10 分鐘內，或電腦回 cooldown → 停用並顯示原因；其餘（含失敗）可再按
export function remoteButtonState({ items = [], status = null, remoteOn = false, now = Date.now() } = {}) {
  if (remoteOn) return null;
  const mine = items.filter((x) => x && x.kind === 'remoteopen').sort((a, b) => a.createdAt - b.createdAt);
  const last = mine[mine.length - 1];
  const base = { disabled: false, label: '📡 叫電腦開遠端', note: '', phase: 'idle' };
  if (!last) return base;
  if (last.state === 'queued' || last.state === 'sending') return { ...base, disabled: true, label: '等待中…', note: last.state === 'sending' ? '送出中…' : '已存在手機，連上網路後送出', phase: 'queued' };
  if (last.state === 'failed') return { ...base, note: last.err || '沒送出，可以再按一次', phase: 'failed' };
  const ph = remoteOpenPhase(last, status, now);
  if (ph.phase === 'waiting' || ph.phase === 'received') return { ...base, disabled: true, label: '等待中…', note: ph.label, phase: ph.phase };
  const wait = last.createdAt + COOLDOWN_MS - now;
  const cool = status && status.opener && status.opener.req_id === last.id && status.opener.result === 'cooldown';
  if (ph.phase === 'failed') {
    if (cool && wait > 0) return { ...base, disabled: true, label: '稍後再叫', note: ph.label + '（約 ' + Math.ceil(wait / 60000) + ' 分鐘後）', phase: 'cooldown' };
    return { ...base, note: ph.label, phase: 'failed' };
  }
  // handled 但遠端現在是關著的（開了又關掉）：剛叫過的冷卻期間停用
  if (wait > 0) return { ...base, disabled: true, label: '稍後再叫', note: '剛叫過電腦，約 ' + Math.ceil(wait / 60000) + ' 分鐘後才能再叫', phase: 'cooldown' };
  return base;
}
