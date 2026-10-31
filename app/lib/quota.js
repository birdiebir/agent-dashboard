// 額度卡的新鮮度判斷（純函式）。資料來自 parseQuota：{five:{pct,note}, weekly:{pct,note}, readAt:'HH:MM'|null}
// Live.md 額度區：「- **weekly**：96%（10/26（一）19:00 重置）」「- **5 小時**：0%（這個窗口 18:50～23:50）」「- 數字讀取時間 18:57」
// 規則：
//  · 讀取時間只有 HH:MM，沒有日期：視為今天；比現在晚超過 1 小時就當成昨天。
//  · 距今超過 60 分鐘＝過時（電腦沒在更新）。
//  · 「重置」時間落在「讀取時間」之後、而且已經過了＝已重置，舊數字不能當現在的數字（5 小時：窗口結束時間同理）。
//  · 任何解析不到的地方都退回原文／「—」，不丟錯。
import { updatedAt, updatedAgeMinutes, STALE_MINUTES } from './status.js';

export const QUOTA_STALE_MINUTES = 60;

// 額度嚴重度：≥95 'bad'（快用完）、≥80 'warn'（偏高）、其他 ''；文字另外標出來（色盲、陽光下也看得出）
export const sevOf = (pct) => (typeof pct !== 'number' ? '' : pct >= 95 ? 'bad' : pct >= 80 ? 'warn' : '');
export const SEV_TEXT = { warn: '偏高', bad: '快用完' };
const pad = (n) => String(n).padStart(2, '0');

// 「數字讀取時間」兩種格式都吃：新「10-26 20:45」（live_md.py 10-26 起）、舊「20:45」（只有時間）。
// parse.js 的 parseQuota 與這裡共用這一個函式。回傳 {month, day, time}（舊格式 month／day 是 null）或 null
export function parseReadTime(s) {
  const m = /(?:(\d{1,2})-(\d{1,2})\s+)?(\d{1,2}):(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  return { month: m[1] ? Number(m[1]) : null, day: m[2] ? Number(m[2]) : null, time: m[3] + ':' + m[4] };
}

// 讀取時刻。有日期的用該日期；只有 HH:MM 的舊格式，用 Live.md「最後更新」的月日當基準：
// 讀取時刻比最後更新時刻晚超過 10 分鐘（兩者通常同一輪寫，差幾分鐘內算同一天）就算前一天；
// 連「最後更新」都沒有時：視為今天，比現在晚超過 1 小時就當昨天。
function readAtDate(q, now, updated) {
  const t = /^(\d{1,2}):(\d{2})$/.exec(String((q && q.readAt) || ''));
  if (!t) return null;
  const h = Number(t[1]); const mi = Number(t[2]);
  if (q.readDate && q.readDate.month) {
    let d = new Date(now.getFullYear(), q.readDate.month - 1, q.readDate.day, h, mi);
    if (d.getTime() - now.getTime() > 12 * 3600 * 1000) d = new Date(now.getFullYear() - 1, q.readDate.month - 1, q.readDate.day, h, mi);
    return d;
  }
  const base = updatedAt(updated, now);
  if (base) {
    let d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, mi);
    if (d.getTime() - base.getTime() > 10 * 60 * 1000) d = new Date(d.getTime() - 86400000);
    return d;
  }
  let d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, mi);
  if (d.getTime() - now.getTime() > 3600 * 1000) d = new Date(d.getTime() - 86400000);
  return d;
}

// 「10/26（一）19:00 重置」→ Date；「窗口 18:50～23:50」→ 結束時間（跨午夜算隔天）
export function resetTimeOf(note, now, readAt) {
  const s = String(note || '');
  let m = /(\d{1,2})\/(\d{1,2}).*?(\d{1,2}):(\d{2})\s*重置/.exec(s);
  if (m) {
    let d = new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]), Number(m[3]), Number(m[4]));
    if (d.getTime() - now.getTime() > 200 * 86400000) d = new Date(now.getFullYear() - 1, Number(m[1]) - 1, Number(m[2]), Number(m[3]), Number(m[4]));
    return d;
  }
  m = /(\d{1,2}):(\d{2})\s*[～~\-–]\s*(\d{1,2}):(\d{2})/.exec(s);
  if (m && readAt) {
    const day = (h, mi) => new Date(readAt.getFullYear(), readAt.getMonth(), readAt.getDate(), h, mi);
    const start = day(Number(m[1]), Number(m[2]));
    let end = day(Number(m[3]), Number(m[4]));
    // 跨午夜的窗口（例如 22:00～03:00）：在晚上那段讀的，結束是隔天；過了午夜才讀的，結束就是當天
    if (end.getTime() <= start.getTime() && readAt.getTime() >= start.getTime()) end = new Date(end.getTime() + 86400000);
    return end;
  }
  return null;
}

// updated：parseUpdated 的結果（Live.md 最後更新），舊格式的讀取時間靠它補日期；也用來判斷「Live.md 是新的、只有額度數字舊」
const WEEKDAY = '日一二三四五六';

// v4.2：電腦 state.json 的額度（pcstate.readState().quota）轉成 parseQuota 的格式，讓 quotaView 的重置判斷共用
export function pcQuotaToLive(pq) {
  const r = new Date(pq.readMs);
  const hm = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());
  const five = pq.h5 == null ? null : { pct: pq.h5, note: pq.h5ResetMs == null ? '' : '這個窗口 ' + hm(new Date(pq.h5ResetMs - 5 * 3600000)) + '～' + hm(new Date(pq.h5ResetMs)) };
  const wd = pq.d7ResetMs == null ? null : new Date(pq.d7ResetMs);
  const weekly = pq.d7 == null ? null : { pct: pq.d7, note: wd ? pad(wd.getMonth() + 1) + '/' + pad(wd.getDate()) + '（' + WEEKDAY[wd.getDay()] + '）' + hm(wd) + ' 重置' : '' };
  return { five, weekly, readAt: hm(r), readDate: { month: r.getMonth() + 1, day: r.getDate() } };
}

export const QUOTA_OLD_MINUTES = 180; // 超過 3 小時：改次要文字色並提示「電腦下次推送時更新」

// v4.2：Live.md 額度與電腦狀態檔額度取較新的（pcQuota 可省略）。回傳 quotaView 的結果，多 source（'live'|'pc'）與 old（超過 3 小時）
export function quotaBest(quota, now = new Date(), updated = null, pcQuota = null) {
  const live = quotaView(quota, now, updated);
  let v = live; let source = 'live';
  if (pcQuota && typeof pcQuota.readMs === 'number' && (live.atMs == null || pcQuota.readMs > live.atMs)) {
    v = quotaView(pcQuotaToLive(pcQuota), now, updated);
    source = 'pc';
    const d = new Date(pcQuota.readMs);
    v.label = '電腦 ' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' 的數字';
  }
  return { ...v, source, old: v.age != null && v.age > QUOTA_OLD_MINUTES };
}

export function quotaView(quota, now = new Date(), updated = null) {
  const q = quota || {};
  const at = readAtDate(q, now, updated);
  const lage = updatedAgeMinutes(updated, now);
  const liveFresh = lage != null && lage <= STALE_MINUTES;
  const sameDay = !!at && at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  const age = at ? Math.max(0, Math.round((now.getTime() - at.getTime()) / 60000)) : null;
  const stale = age != null && age > QUOTA_STALE_MINUTES;
  const mk = (name, v) => {
    if (!v) return { name, pct: null, note: '', reset: false };
    const rt = resetTimeOf(v.note, now, at);
    const reset = !!rt && rt.getTime() <= now.getTime() && (!at || rt.getTime() > at.getTime());
    return { name, pct: typeof v.pct === 'number' ? v.pct : null, note: v.note || '', reset };
  };
  return {
    readAt: q.readAt || '', age, stale, liveFresh, atMs: at ? at.getTime() : null,
    dateText: at && !sameDay ? pad(at.getMonth() + 1) + '-' + pad(at.getDate()) : '', // 數字不是今天讀的：附註前面標這個日期、淡化
    label: q.readAt ? (at && !sameDay ? pad(at.getMonth() + 1) + '-' + pad(at.getDate()) + ' ' : '') + q.readAt.replace(/^(\d):/, '0$1:') + ' 的數字' : '',
    ageText: age == null ? '' : age < 60 ? age + ' 分鐘前' : Math.floor(age / 60) + ' 小時' + (age % 60 ? ' ' + pad(age % 60) + ' 分' : '') + '前',
    rows: [mk('5 小時', q.five), mk('weekly', q.weekly)],
  };
}
