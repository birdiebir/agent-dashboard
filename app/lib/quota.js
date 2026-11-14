// 額度卡的新鮮度判斷（純函式）。資料來自 parseQuota：{five:{pct,note}, weekly:{pct,note}, readAt:'HH:MM'|null}
// Live.md 額度區：「- **weekly**：96%（10/26（一）19:00 重置）」「- **5 小時**：0%（這個窗口 18:50～23:50）」「- 數字讀取時間 18:57」
// 規則：
//  · 讀取時間只有 HH:MM，沒有日期：視為今天；比現在晚超過 1 小時就當成昨天。
//  · 距今超過 60 分鐘＝過時（電腦沒在更新）。
//  · 「重置」時間落在「讀取時間」之後、而且已經過了＝已重置，舊數字不能當現在的數字（5 小時：窗口結束時間同理）。
//  · 任何解析不到的地方都退回原文／「—」，不丟錯。
import { TWDate as Date } from './tz.js';
import { updatedAt, updatedAgeMinutes, STALE_MINUTES, agoText } from './status.js';

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
    ageText: agoText(age),
    rows: [mk('5 小時', q.five), mk('weekly', q.weekly)],
  };
}

// ---------- 2026-11-04：額度顯示整理＋副帳號額度 ----------
// 顯示用名稱：App 上一律中文（weekly → 每週）；quotaView 的 rows[].name 維持原樣（測試與 pcQuotaToLive 共用）
export const DISPLAY_NAME = { '5 小時': '5 小時', weekly: '每週' };

// 一眼看懂的重置說明：5 小時「這個窗口 08:10～13:10」→「13:10 重置」；weekly 本來就是「11/09（一）19:00 重置」；解析不到退回原文
export function shortNote(name, note, now = new Date(), readAt = null) {
  const s = String(note || '').replace(/\s*[｜|].*$/, '').trim();
  if (!s) return '';
  if (/重置\s*$/.test(s)) return s;
  const rt = resetTimeOf(s, now, readAt);
  return rt ? pad(rt.getHours()) + ':' + pad(rt.getMinutes()) + ' 重置' : s;
}

// 副帳號額度（電腦 state.json 的 quotaB，pcstate.readState 轉好的）。
// 只回「還有意義」的列：窗口／週期已經重置（reset 時間 <= 現在）的那一列直接拿掉，不顯示舊數字也不顯示 0；
// 沒有 weekly 就沒有那一列。兩列都沒有回 null（App 整塊隱藏）。
export function quotaBView(rq, now = new Date()) {
  if (!rq || typeof rq.readMs !== 'number') return null;
  const nowMs = now.getTime();
  if (rq.readMs - nowMs > 5 * 60000) return null; // 時鐘不準
  const nm = rq.label || '副帳號'; // 顯示名稱由電腦 state.json 帶來（私人 repo 的資料），程式不寫死
  const rows = [];
  const hm = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  if (typeof rq.h5 === 'number' && typeof rq.h5ResetMs === 'number' && rq.h5ResetMs > nowMs) {
    rows.push({ name: nm + ' 5 小時', pct: rq.h5, note: hm(rq.h5ResetMs) + ' 重置' });
  }
  if (typeof rq.d7 === 'number' && typeof rq.d7ResetMs === 'number' && rq.d7ResetMs > nowMs) {
    const wd = new Date(rq.d7ResetMs);
    rows.push({ name: nm + ' 每週', pct: rq.d7, note: pad(wd.getMonth() + 1) + '/' + pad(wd.getDate()) + '（' + WEEKDAY[wd.getDay()] + '）' + hm(rq.d7ResetMs) + ' 重置' });
  }
  if (!rows.length) return null;
  const age = Math.max(0, Math.round((nowMs - rq.readMs) / 60000));
  const d = new Date(rq.readMs);
  return {
    rows, age,
    ageText: agoText(age),
    label: nm + ' ' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + hm(rq.readMs) + ' 的數字', // 只有電腦上那個帳號的視窗開著才會更新，所以一定標讀取時間
    old: age > QUOTA_OLD_MINUTES,
  };
}

// ---------- 2026-11-04（晚）：兩塊額度固定都出現 ----------
// 手機額度區固定兩塊：公司、個人（名稱由電腦 state.json 的 quota_label／quota_b.label 帶來，程式只有中性預設詞）。
// 個人那塊（原「副帳號」）不再因為沒資料整塊消失：兩個來源都太舊 → idle，顯示「<名稱>：最後更新 HH:MM（約 N 小時前）」並淡化。
const clockOf = (ms, now) => { const d = new Date(ms); const t = pad(d.getHours()) + ':' + pad(d.getMinutes()); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate() ? t : pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + t; };
export function approxAgo(min) {
  if (min == null || !Number.isFinite(min)) return '';
  if (min < 60) return '約 ' + Math.max(1, Math.round(min)) + ' 分鐘前';
  if (min < 1440) return '約 ' + Math.round(min / 60) + ' 小時前';
  return '約 ' + Math.round(min / 1440) + ' 天前';
}
export function quotaBBlock(rq, now = new Date(), fallbackLabel = '個人') {
  const label = (rq && rq.label) || fallbackLabel;
  const v = quotaBView(rq, now);
  if (v && !v.old) {
    return { fresh: true, label, rows: v.rows.map((r) => ({ ...r, name: r.name.replace(/^.* (5 小時|每週)$/, '$1') })), ageText: v.ageText, old: false, idleText: '' };
  }
  const ok = rq && typeof rq.readMs === 'number';
  const age = ok ? Math.max(0, Math.round((now.getTime() - rq.readMs) / 60000)) : null;
  const idleText = label + '：' + (ok ? '最後更新 ' + clockOf(rq.readMs, now) + '（' + approxAgo(age) + '）' : '還沒有資料');
  return { fresh: false, label, rows: [], ageText: ok ? agoText(age) : '', old: true, idleText };
}

// ---------- 2026-11-05：個人額度也從 Live.md 額度區讀（state.json 的 quota_b 只有答題時才會更新，常常超過 3 小時）----------
// 格式（電腦 live_md.py 的個人額度那行）：「- **<名稱>**：5 小時 16%（22:30 重置）｜每週 66%（11/07（六）16:00 重置）｜讀取 21:26」
// 用格式辨識（標籤取 ** 裡的字），程式不寫死名稱；「沒開視窗…」「還沒有資料」的行沒有數字，回 null（交給 state.json）。
const QB_LINE = /^\s*-\s*\*\*([^*]{1,20})\*\*\s*[：:]\s*5 小時\s*(\d+(?:\.\d+)?)\s*%[（(]\s*(\d{1,2}):(\d{2})\s*重置[）)](?:\s*[｜|]\s*每週\s*(\d+(?:\.\d+)?)\s*%[（(]\s*(\d{1,2})\/(\d{1,2}).*?(\d{1,2}):(\d{2})\s*重置[）)])?\s*[｜|]\s*讀取\s*(\d{1,2}):(\d{2})/;
export function parseQuotaBLive(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const a = lines.findIndex((l) => l.includes('<!-- 額度 -->'));
  const b = lines.findIndex((l) => l.includes('<!-- /額度 -->'));
  if (a < 0 || b < 0 || b < a) return null;
  for (const l of lines.slice(a + 1, b)) {
    const m = QB_LINE.exec(l);
    if (!m) continue;
    return {
      label: m[1].trim(), h5: Number(m[2]), h5Reset: { h: Number(m[3]), mi: Number(m[4]) },
      d7: m[5] != null ? Number(m[5]) : null, d7Reset: m[5] != null ? { month: Number(m[6]), day: Number(m[7]), h: Number(m[8]), mi: Number(m[9]) } : null,
      readAt: { h: Number(m[10]), mi: Number(m[11]) },
    };
  }
  return null;
}

// 轉成跟 pcstate.readQuotaB 同形 {label,h5,h5ResetMs,d7,d7ResetMs,readMs}。
// 讀取只有 HH:MM：日期基準＝公司額度的「數字讀取時間」（readAtDate），沒有就用 Live.md 最後更新（updated），再沒有用現在；
// 比基準晚超過 10 分鐘（用現在當基準時 1 小時）就退一天。重置時間取讀取之後的第一個該時刻（5 小時）／該月日（每週）。
export function quotaBFromLive(raw, now = new Date(), updated = null, quota = null) {
  if (!raw) return null;
  let base = quota && quota.readAt ? readAtDate(quota, now, updated) : null;
  if (!base) base = updatedAt(updated, now);
  let tol = 10 * 60 * 1000;
  if (!base) { base = now; tol = 3600 * 1000; }
  let rd = new Date(base.getFullYear(), base.getMonth(), base.getDate(), raw.readAt.h, raw.readAt.mi);
  if (rd.getTime() - base.getTime() > tol) rd = new Date(rd.getTime() - 86400000);
  const readMs = rd.getTime();
  let h5 = new Date(rd.getFullYear(), rd.getMonth(), rd.getDate(), raw.h5Reset.h, raw.h5Reset.mi);
  if (h5.getTime() < readMs) h5 = new Date(h5.getTime() + 86400000);
  let d7ResetMs = null;
  if (raw.d7Reset) {
    let d = new Date(rd.getFullYear(), raw.d7Reset.month - 1, raw.d7Reset.day, raw.d7Reset.h, raw.d7Reset.mi);
    if (readMs - d.getTime() > 200 * 86400000) d = new Date(rd.getFullYear() + 1, raw.d7Reset.month - 1, raw.d7Reset.day, raw.d7Reset.h, raw.d7Reset.mi);
    d7ResetMs = d.getTime();
  }
  return { label: raw.label, h5: raw.h5, h5ResetMs: h5.getTime(), d7: raw.d7, d7ResetMs, readMs };
}

// 兩個來源（state.json quota_b、Live.md 那行）取讀取時間較新的；一樣新取前者；只有一邊有就用那邊
export function newerQuotaB(a, b) {
  const ok = (x) => x && typeof x.readMs === 'number';
  if (!ok(a)) return ok(b) ? b : null;
  if (!ok(b)) return a;
  return b.readMs > a.readMs ? b : a;
}
