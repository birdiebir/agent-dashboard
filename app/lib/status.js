// 頂端時間與「資料可能過期」判斷（純函式）
import { twTime } from './commits.js';
export const STALE_MINUTES = 45;

const pad = (n) => String(n).padStart(2, '0');

// parseUpdated 的結果 {date:'10-26', time:'19:28'} → 'MM-DD HH:MM'；讀不到回 ''
export function formatUpdated(updated) {
  if (!updated) return '';
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(updated.date || '');
  const t = /^(\d{1,2}):(\d{2})$/.exec(updated.time || '');
  if (!m || !t) return '';
  return pad(m[1]) + '-' + pad(m[2]) + ' ' + pad(t[1]) + ':' + t[2];
}

// Live.md 的「最後更新」沒有年份：假設是今年；如果算出來比現在晚超過 12 小時，就當成去年（跨年）
export function updatedAt(updated, now = new Date()) {
  if (!updated) return null;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(updated.date || '');
  const t = /^(\d{1,2}):(\d{2})$/.exec(updated.time || '');
  if (!m || !t) return null;
  let d = new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]), Number(t[1]), Number(t[2]));
  if (d.getTime() - now.getTime() > 12 * 3600 * 1000) d = new Date(now.getFullYear() - 1, Number(m[1]) - 1, Number(m[2]), Number(t[1]), Number(t[2]));
  return d;
}

export function updatedAgeMinutes(updated, now = new Date()) {
  const d = updatedAt(updated, now);
  return d ? Math.round((now.getTime() - d.getTime()) / 60000) : null;
}

export function isStale(updated, now = new Date()) {
  const age = updatedAgeMinutes(updated, now);
  return age != null && age > STALE_MINUTES;
}

// ---------- 首頁「Agent 狀態」 ----------
// 在跑：Live.md「現在」區的「- 在跑：…」那行；「無」「沒有」「—」或沒有這行都算沒在跑
export function runningNow(live) {
  const md = (live && live.now && live.now.md) || '';
  const m = /^- 在跑[：:]\s*(.+)$/m.exec(md);
  const v = m ? m[1].trim() : '';
  return v && !/^(無|沒有|—|-|無在跑)/.test(v) ? v : '';
}

// /remote 開著：remote_ctl.py 會在「現在」區放「- 📡 遠端模式：開啟中（到 …）」，off 時拿掉
export function remoteOn(live) {
  const md = (live && live.now && live.now.md) || '';
  return /^- 📡 遠端模式[：:]\s*開啟中/m.test(md);
}

const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

// 判斷依據（由上而下，第一個成立的就是狀態）：
//  1. 同步失敗：GitHub 回錯誤（401、403…）。離線（手機沒網路）也算同步失敗，但文字寫明是手機沒連上。
//  2. 等電腦上線：Live.md「最後更新」超過 45 分鐘沒動（Agent 每約 20 分鐘巡檢一次會改它），
//     而且「health.json 心跳日期」與「Live.md 最後更新日期」兩者中較新的那個也不是今天＝電腦今天還沒回報過。你寫的東西會排隊。
//  3. 資料可能過期：同樣超過 45 分鐘沒動，但這兩個日期有一個是今天（電腦今天有在跑，只是這陣子沒更新）。
//  4. 執行中：資料新鮮，而且 Live.md「在跑」有內容。
//  5. 等你：資料新鮮、沒在跑，但有待答題目。
//  6. 待命：以上都不是。
// 讀不到 Live.md「最後更新」時（格式被改）：不判斷過期，只看 4～6。
// 10-27（Q208 之後）：平常沒開 /remote 就沒人定期改 Live.md，「超過 45 分鐘沒動」是正常的，不算過期。
// remote=false 時 2、3 改成「沒開遠端」（手機資料照樣是最新的），「在跑」那行可能是舊的也不採信；有題目照樣顯示等你。
// remote 沒傳（預設 true）＝照舊判斷。
export function agentStatus({ now = new Date(), updated = null, error = '', offline = false, health = null, running = '', pending = 0, remote = true } = {}) {
  if (error) return { key: 'error', icon: '⚠️', label: '同步失敗', detail: error };
  if (offline) return { key: 'error', icon: '⚠️', label: '同步失敗', detail: '手機現在沒連上網路，顯示的是上次抓到的資料' };
  const age = updatedAgeMinutes(updated, now);
  if (age != null && age > STALE_MINUTES && !remote) {
    if (pending > 0) return { key: 'waiting-you', icon: '🙋', label: '等你', detail: pending + ' 題等你回答' };
    return { key: 'no-remote', icon: '🖥️', label: '沒開遠端', detail: '手機資料是最新的；電腦沒開 /remote，你寫的會等下次開電腦處理' };
  }
  if (age != null && age > STALE_MINUTES) {
    // 「電腦今天有沒有回報」取兩個證據中比較新的：health.json 心跳日期（只在 routine 收尾時寫，可能好幾天不動，
    // 但電腦其實有在跑）與 Live.md「最後更新」的日期。兩個都不是今天，才判成等電腦上線。
    const hb = health && health.heartbeat_at ? String(health.heartbeat_at) : '';
    const lu = ymd(updatedAt(updated, now));
    const newest = hb > lu ? hb : lu;
    if (newest < ymd(now)) return { key: 'wait-local', icon: '🖥️', label: '等電腦上線', detail: '電腦今天還沒回報（最近一次 ' + newest + '）；你寫的會先排隊' };
    return { key: 'stale', icon: '⏳', label: '資料可能過期', detail: 'Agent 最後更新已超過 ' + STALE_MINUTES + ' 分鐘' };
  }
  if (running) return { key: 'running', icon: '🏃', label: '執行中', detail: running };
  if (pending > 0) return { key: 'waiting-you', icon: '🙋', label: '等你', detail: pending + ' 題等你回答' };
  return { key: 'idle', icon: '✅', label: '待命', detail: '目前沒有進行中的工作，也沒有等你的題目' };
}

// health.json → 顯示用資料。壞掉、缺欄位回 null；心跳／分數日期推算天數
export function readHealth(text, now = new Date()) {
  let j;
  try { j = JSON.parse(text); } catch (e) { return null; }
  if (!j || typeof j !== 'object') return null;
  const days = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    return Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) / 86400000);
  };
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    kb: num(j.kb), db: num(j.db), agent: num(j.agent), pc: num(j.pc),
    heartbeat_at: j.heartbeat_at || '', scores_at: j.scores_at || '',
    heartbeatDays: days(j.heartbeat_at), scoresDays: days(j.scores_at),
    criticalRed: Array.isArray(j.critical_red) ? j.critical_red.map(String) : [],
  };
}

// ---------- 網址 ?tab= ----------
// 3 階段起底部導覽是 首頁｜紀錄｜對話｜任務｜專案；舊的 journal 對應紀錄頁，more 對應「更多」頁，todo／feed／health／settings 仍是合法值。
// 白名單：只有這幾個值有效，其他（含注入字串、大小寫不同、空白）一律忽略、回首頁。activity 對應內部的 feed 頁。
const TAB_PARAM = {
  home: 'home', record: 'record', journal: 'record', tasks: 'tasks', projects: 'projects', chat: 'chat',
  todo: 'todo', more: 'more', mine: 'mine', reminders: 'reminders', reports: 'reports', activity: 'feed', feed: 'feed', health: 'health', settings: 'settings',
};
export function tabFromParam(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TAB_PARAM, value) ? TAB_PARAM[value] : '';
}

// ---------- v4 M2：電腦同步狀態（首頁狀態列）----------
// 規則（docs/v4_架構方案.md §2.1）：
//  📵 手機沒網路（navigator.onLine === false）或最近一次抓取失敗 →「📵 沒網路，顯示的是 HH:MM 的資料」
//  ⚡ Live「現在」區有「- 📡 遠端模式：開啟中（到 MM-DD HH:MM）」而且到期時間還沒過（沒寫到期時間就當開著）→「⚡ 遠端開著｜電腦 HH:MM 最後同步」（電腦最後推送超過 2 小時再加「（可能沒在跑）」，不是今天就寫 MM-DD HH:MM）
//  🖥️ 電腦最後一次推送在 12 小時內 →「🖥️ 電腦 HH:MM 同步過，下次開 Claude 視窗會收」（不是今天就寫 MM-DD HH:MM）
//  🌙 超過 12 小時 →「🌙 電腦離線（上次 MM-DD HH:MM），寫的會排隊」
// 「電腦最後推送」＝commits 裡最新一筆 Agent 寫的（commit 訊息結尾是「(手機)」的算手機；GitHub 網頁預設訊息「Update X.md」是你本人，也不算電腦）。
// 誠實限制：電腦開機但沒開任何 Claude 視窗，手機沒辦法知道；所以「🖥️」只代表「電腦最後一次推送的時間」。
export const PC_OFFLINE_HOURS = 12;
export const PC_LIVE_QUIET_HOURS = 2; // ⚡ 遠端開著，但電腦最後一次推送已經超過這麼多小時 → 加「（可能沒在跑）」
const sameCalendarDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const REMOTE_LINE = /^- 📡 遠端模式[：:]\s*開啟中(?:[（(]\s*到\s*(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})\s*[）)])?/m;

// 到期時間沒有年份：取離現在最近的那一年（跨年也對）
function nearestYear(month, day, hour, minute, now) {
  let best = null;
  for (const y of [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]) {
    const d = new Date(y, month - 1, day, hour, minute);
    if (!best || Math.abs(d - now) < Math.abs(best - now)) best = d;
  }
  return best;
}

// live：parseLive 的結果（或 Live.md 原文）。回傳 {on, until: Date|null, expired}
export function remoteInfo(live, now = new Date()) {
  let md = '';
  if (typeof live === 'string') {
    const m = /^## .*現在[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(live);
    md = m ? m[1] : '';
  } else md = (live && live.now && live.now.md) || '';
  const m = REMOTE_LINE.exec(md);
  if (!m) return { on: false, until: null, expired: false, present: false };
  if (!m[1]) return { on: true, until: null, expired: false, present: true }; // 沒寫到期時間：當成開著
  const until = nearestYear(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), now);
  const expired = until.getTime() <= now.getTime();
  return { on: !expired, until, expired, present: true };
}
export const remoteActive = (live, now = new Date()) => remoteInfo(live, now).on;

// commit 時間（'MM-DD HH:MM' 台灣時間）→ 毫秒。有 ts（convertCommits 附的）就用 ts
function commitMs(c, now) {
  if (c && Number.isFinite(c.ts)) return c.ts;
  const m = /^(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec((c && c.time) || '');
  if (!m) return null;
  return nearestYear(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), now).getTime();
}

// commits：convertCommits 的結果（新的在前）。回傳 {ms, time:'MM-DD HH:MM', hhmm, subject} 或 null
export function latestPcPush(commits, now = new Date()) {
  let best = null;
  for (const c of commits || []) {
    const s = String((c && c.subject) || '');
    if (/\(手機\)\s*$/.test(s) || /^Update \S+\.md\s*$/.test(s)) continue; // 同 activity.js 的 actorOf：只有「Agent」算電腦
    const ms = commitMs(c, now);
    if (ms == null) continue;
    if (!best || ms > best.ms) best = { ms, time: c.time || '', hhmm: String(c.time || '').slice(6), subject: s };
  }
  return best;
}

const hm = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());
const mdhm = (d) => pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + hm(d);

// 輸入：commits、live（parseLive 結果或原文）、now、offline（手機沒網路／最近一次抓取失敗）、fetchedAt（毫秒，最後一次抓到資料的時間）
// 回傳 {key:'offline'|'live'|'pc-today'|'pc-recent'|'pc-offline'|'unknown', icon, text, pc, stale, liveAgeMin}
//  stale：只有 ⚡ 時才可能是 true（Live.md 超過 45 分鐘沒更新才算異常）
// v4 M3 新增兩個輸入：
//  state：lib/pcstate.js readState 的結果（mobile/state.json）。pc.last_seen 跟 commit 推得的「電腦最後推送」取較新的；
//         remote.on／until 當成 📡 行之外的第二訊號——只有 Live.md 完全沒有 📡 行（不是「過期了」）、
//         而且 state.json 比 Live.md「最後更新」新的時候才採信（不然電腦關了遠端、state.json 還沒更新，會誤報 ⚡）
//  queued：手機上還沒送出的寫入件數（離線時狀態列要寫「N 件存在手機，連上會自動送」）
export function syncStatus({ commits = [], live = null, now = new Date(), offline = false, fetchedAt = null, state = null, queued = 0 } = {}) {
  let pc = latestPcPush(commits, now);
  const st = state && (state.generatedMs == null || state.generatedMs - now.getTime() <= 5 * 60000) ? state : null;
  if (st && st.pcMs != null && st.pcMs - now.getTime() <= 5 * 60000 && (!pc || st.pcMs > pc.ms)) {
    const time = twTime(new Date(st.pcMs).toISOString());
    pc = { ms: st.pcMs, time, hhmm: time.slice(6), subject: 'state.json' };
  }
  if (offline) {
    const at = fetchedAt != null ? hm(new Date(fetchedAt)) : '—';
    const text = queued > 0 ? '📵 沒網路，' + queued + ' 件存在手機，連上會自動送（顯示的是 ' + at + ' 的資料）' : '📵 沒網路，顯示的是 ' + at + ' 的資料';
    return { key: 'offline', icon: '📵', text, pc, stale: false, liveAgeMin: null };
  }
  const parsed = typeof live === 'string' ? null : live;
  const info = remoteInfo(live, now);
  let remoteOnNow = info.on;
  let remoteVia = 'live';
  if (!info.on && !info.present && st && st.remote.on && st.remote.untilMs != null && st.remote.untilMs > now.getTime()) {
    const lu = parsed && parsed.updated ? updatedAt(parsed.updated, now) : null;
    if (st.generatedMs != null && (!lu || st.generatedMs >= lu.getTime())) { remoteOnNow = true; remoteVia = 'state'; }
  }
  if (remoteOnNow) {
    const updated = parsed ? parsed.updated : null;
    const age = updated ? updatedAgeMinutes(updated, now) : null;
    // 不假裝即時：📡 行只代表「遠端模式開著」，電腦當機或睡著時它還在。所以文字講「電腦最後同步」的時間，
    // 最後一次推送超過 PC_LIVE_QUIET_HOURS 小時就加「（可能沒在跑）」
    const pcMs = pc ? pc.ms : null;
    const quiet = pcMs != null && (now.getTime() - pcMs) / 3600000 > PC_LIVE_QUIET_HOURS;
    const sameDayPc = pcMs != null && sameCalendarDay(new Date(pcMs), now);
    const when = pc ? (sameDayPc ? pc.hhmm : mdhm(new Date(pcMs))) : '';
    return {
      key: 'live', icon: '⚡', pcQuiet: quiet || !pc, remoteVia,
      text: '⚡ 遠端開著' + (pc ? '｜電腦 ' + when + ' 最後同步' + (quiet ? '（可能沒在跑）' : '') : '｜讀不到電腦的推送紀錄（可能沒在跑）'), pc,
      stale: age != null && age > STALE_MINUTES, liveAgeMin: age,
    };
  }
  if (!pc) return { key: 'unknown', icon: '🖥️', text: '🖥️ 讀不到電腦的推送紀錄', pc: null, stale: false, liveAgeMin: null };
  const when = new Date(pc.ms);
  const ageH = (now.getTime() - pc.ms) / 3600000;
  if (ageH > PC_OFFLINE_HOURS) {
    return { key: 'pc-offline', icon: '🌙', text: '🌙 電腦離線（上次 ' + mdhm(when) + '），寫的會排隊', pc, stale: false, liveAgeMin: null };
  }
  const sameDay = when.getFullYear() === now.getFullYear() && when.getMonth() === now.getMonth() && when.getDate() === now.getDate();
  return {
    key: sameDay ? 'pc-today' : 'pc-recent', icon: '🖥️',
    text: '🖥️ 電腦 ' + (sameDay ? hm(when) : mdhm(when)) + ' 同步過，下次開 Claude 視窗會收', pc, stale: false, liveAgeMin: null,
  };
}

// 對話頁輸入列上面的說明（依電腦同步狀態；Q208：只有 /remote 開著才有人監聽）
export function chatReplyHint(sync) {
  if (sync && sync.key === 'live') return sync.pcQuiet ? '遠端模式開著，但電腦好一陣子沒推送了（可能沒在跑）；你寫的會先存著。' : '遠端模式開著，通常 1～2 分鐘內會回。';
  if (sync && sync.key === 'offline') return '現在沒網路：你寫的會先存在手機，連上網路後自動送出。';
  return '遠端模式沒開：電腦開著 Claude 視窗時才會看到，沒開的話下次開視窗才會回。';
}
