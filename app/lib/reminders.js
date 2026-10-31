// 提醒（首頁「重要提醒」與更多頁「提醒事項」）的純函式，不碰 DOM、不碰儲存空間。
// 2026-10-30（Task m-vit8np2q）：使用者反映手機提醒有很多過時、錯誤的資訊，改成跟電腦版看板（agent-board）同一套來源與判斷：
//   - 定期（例行）：電腦端 mobile_sync.py 用看板的規則（hooks\routines.ts nextDue／skipDonePeriods）算好，放在 mobile/state.json 的 routines；
//     手機只讀「下次日期」，並用 Task.md 目前未打勾的提醒判斷「這期還沒做」（打勾後馬上更新，不用等電腦重推）。
//     停用的列不會出現（電腦端只送啟用的列）。
//   - 一次性：Task.md 未打勾的 [remind]，日期判斷照看板 hooks\deadlines.ts（reminderDate／dueSoon：14 天內、已過 7 天內才算）。
//     已打勾、已過期很久、今日必答（自動產生）、屬於某個定期提醒（歸定期那邊顯示）、「X 起才處理」還沒到日的都不顯示。
// 可調參數集中在最上面。

export const SOON_DAYS = 14; // 一次性提醒：14 天內才列
export const OVERDUE_DAYS = 7; // 已過期：過了 7 天內還列，更久就不顯示
export const HOME_SOON_DAYS = 3; // 首頁：3 天內到期＝第 2 層
export const HOME_WEEK_DAYS = 7; // 首頁：4～7 天＝第 7 層（只顯示，不計入數字）
export const ROUTINE_STALE_DAYS = 2; // 電腦端 routines 超過這麼多天沒更新就標警示

const pad = (n) => String(n).padStart(2, '0');
export const isoOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const utcDay = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
export const daysBetween = (fromIso, toIso) => Math.round(utcDay(toIso) - utcDay(fromIso));

// 提醒文字裡的日期（跟看板 hooks\deadlines.ts reminderDate 一致）：有「最晚 11/13」「期限 11/13」「11/13 前」優先，沒有就取第一個。
// 年份用今年；比今天早半年以上的當成明年。不存在的日期（13/40、2/31）不算。沒有日期回 ''。
export function reminderDate(text, todayIso) {
  // 兩位數的月-日（11-06）也算（看板 v0.9.1 一起加）；前面接英數字、斜線、冒號、點、連字號的不算（C6-20、21:30-22:00）
  const date = '(?:(\\d{4})[-/](\\d{1,2})[-/](\\d{1,2})|(\\d{1,2})/(\\d{1,2})|(?<![\\w/:.-])(\\d{2})-(\\d{2})(?![\\d-]))(?![\\d/])';
  const patterns = [
    new RegExp('(?:最晚|期限[：:]?)\\s*' + date),
    new RegExp('(?<![\\d/-])' + date + '(?:（.）)?\\s*(?:\\d{1,2}:\\d{2}\\s*)?前'),
    new RegExp('(?<![\\d/-])' + date),
  ];
  for (const re of patterns) {
    const m = re.exec(String(text || ''));
    if (!m) continue;
    const fullYear = m[1] ? Number(m[1]) : 0;
    const month = Number(m[2] || m[4] || m[6]);
    const day = Number(m[3] || m[5] || m[7]);
    const check = new Date(Date.UTC(fullYear || 2000, month - 1, day));
    if (month < 1 || month > 12 || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return '';
    if (fullYear) return fullYear + '-' + pad(month) + '-' + pad(day);
    const year = Number(todayIso.slice(0, 4));
    const iso = year + '-' + pad(month) + '-' + pad(day);
    return daysBetween(todayIso, iso) < -180 ? (year + 1) + '-' + pad(month) + '-' + pad(day) : iso;
  }
  return '';
}

// 「2027-01-01 起才處理，之前略過：…」「12-01 起才處理…」：回傳起算日（YYYY-MM-DD），沒有這種寫法回 ''
export function notBeforeDate(text, todayIso) {
  const m = /(?:^|[\s（(])(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[-/](\d{1,2}))\s*起才處理/.exec(String(text || ''));
  if (!m) return '';
  const month = Number(m[2] || m[4]);
  const day = Number(m[3] || m[5]);
  const check = new Date(Date.UTC(m[1] ? Number(m[1]) : 2000, month - 1, day));
  if (month < 1 || month > 12 || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return '';
  if (m[1]) return m[1] + '-' + pad(month) + '-' + pad(day);
  const year = Number(todayIso.slice(0, 4));
  const iso = year + '-' + pad(month) + '-' + pad(day);
  return daysBetween(todayIso, iso) < -180 ? (year + 1) + '-' + pad(month) + '-' + pad(day) : iso;
}
// 還沒到起算日（要先略過）？
export const isDeferred = (t, todayIso) => {
  const d = notBeforeDate(t.title, todayIso);
  return !!d && d > todayIso;
};

// 電腦端 routines（lib/pcstate.js 讀進來的）→ 顯示用的列。
// tasks：parseTasks().tasks（用來判斷這期有沒有未打勾的提醒）。
// 回傳 {you, auto, background, stale}：you＝要你做的、auto＝產出給你看的、background＝背景維護（只算數量）
export function routineView(routines, tasks, todayIso) {
  const open = tasks.filter((t) => t.tag === 'remind' && !t.checked);
  const rows = (routines || []).map((r) => {
    const pend = open.filter((t) => (r.match || []).some((p) => p && t.title.startsWith(p)));
    const diff = r.next ? daysBetween(todayIso, r.next) : null;
    let status;
    if (pend.length) status = r.who === 'auto' ? '● 等你看' : '● 這期還沒做';
    else if (diff == null) status = '—';
    else if (diff === 0) status = '今天';
    else if (diff < 0) status = '日期已過（等電腦更新）';
    else status = '下次 ' + Number(r.next.slice(5, 7)) + '/' + Number(r.next.slice(8, 10));
    return { ...r, diff, pend, pending: pend.length > 0, status };
  });
  // 有待辦的排前面，其次是下次日期近的（跟看板 routineRows 的排序一樣）
  rows.sort((a, b) => Number(b.pending) - Number(a.pending) || String(a.next || '9999').localeCompare(String(b.next || '9999')));
  return {
    you: rows.filter((r) => r.who === 'you'),
    auto: rows.filter((r) => r.who === 'auto' && !r.background),
    background: rows.filter((r) => r.background),
  };
}

// 屬於定期提醒的開頭（routines 的名稱與 match）；沒有 routines 時用提醒表啟用列的名稱
export function routinePrefixes(routines, settings = []) {
  const set = new Set();
  if (routines && routines.length) for (const r of routines) { set.add(r.name); for (const m of r.match || []) set.add(m); }
  else for (const s of settings) if (s.ok && /啟用/.test(s.status)) set.add(s.name);
  return [...set].filter(Boolean);
}

// 一次性提醒：Task.md 未打勾的 [remind]。
// 回傳 {soon, later, undated, expired, deferred, expiredItems, deferredItems}：soon＝期限在 -7～+14 天內（依日期排）、later＝更晚、
// undated＝沒寫日期、expired＝過期超過 7 天的數量、deferred＝還沒到起算日的數量；expiredItems／deferredItems 是同一批的列
// （首頁與提醒事項頁只顯示數量；任務頁的提醒分頁收起來列出，讓過期很久的還找得到）
export function oneTimeReminders(tasks, todayIso, prefixes = []) {
  const out = { soon: [], later: [], undated: [], expired: 0, deferred: 0, expiredItems: [], deferredItems: [] };
  for (const t of tasks) {
    if (t.tag !== 'remind' || t.checked) continue;
    if (isDaily(t)) continue; // routine 自動產生，首頁另有「今日必答」那一列
    if (prefixes.some((p) => t.title.startsWith(p))) continue; // 歸定期提醒顯示
    if (isDeferred(t, todayIso)) { out.deferred++; out.deferredItems.push({ t, date: notBeforeDate(t.title, todayIso), days: null }); continue; }
    const date = reminderDate(t.title, todayIso);
    if (!date) { out.undated.push({ t, date: '', days: null }); continue; }
    const days = daysBetween(todayIso, date);
    const row = { t, date, days };
    if (days < -OVERDUE_DAYS) { out.expired++; out.expiredItems.push(row); }
    else if (days <= SOON_DAYS) out.soon.push(row);
    else out.later.push(row);
  }
  out.soon.sort((a, b) => a.days - b.days);
  out.later.sort((a, b) => a.days - b.days);
  out.expiredItems.sort((a, b) => a.days - b.days);
  return out;
}

const isDaily = (t) => /^今日必答/.test(t.title);

// 任務頁「提醒」分頁（2026-10-30 使用者 22:14：這個分頁也要跟電腦對齊）：跟首頁、提醒事項頁同一套判斷，但列的是任務本身。
// routines：routineView() 的結果（沒有 routines 時傳 null）；prefixes：routinePrefixes()。
// 回傳 {periodic, soon, later, undated, expiredItems, deferredItems, done, daily, count}：
//   periodic＝這期還沒打勾的定期提醒（{t, routine, who}，who 'auto'＝電腦產出給你看）；
//   done＝已打勾的件數（不列，電腦整理時會移到已完成紀錄）；daily＝今日必答件數（在問題頁）；
//   count＝分頁上的數字（這期定期＋近期一次性）
export function remindTabSections(tasks, todayIso, routines, prefixes = []) {
  const rows = routines ? [...routines.you, ...routines.auto, ...routines.background] : [];
  const periodic = [];
  for (const t of tasks) {
    if (t.tag !== 'remind' || t.checked || isDaily(t)) continue;
    const p = prefixes.find((x) => t.title.startsWith(x));
    if (!p) continue;
    const r = rows.find((x) => x.pend.includes(t)) || rows.find((x) => x.name === p);
    periodic.push({ t, routine: r ? r.name : p, who: r ? r.who : '' });
  }
  const ot = oneTimeReminders(tasks, todayIso, prefixes);
  const reminds = tasks.filter((t) => t.tag === 'remind');
  return {
    periodic, soon: ot.soon, later: ot.later, undated: ot.undated, expiredItems: ot.expiredItems, deferredItems: ot.deferredItems,
    done: reminds.filter((t) => t.checked).length,
    daily: reminds.filter((t) => !t.checked && isDaily(t)).length,
    count: periodic.length + ot.soon.length,
  };
}

export const dueText = (days) => (days === 0 ? '今天' : days > 0 ? '還有 ' + days + ' 天' : '已過 ' + -days + ' 天');

// 電腦端 routines 是不是太久沒更新：回傳 null（沒問題）或警示文字
export function routinesStaleNote(generatedMs, nowMs) {
  if (generatedMs == null) return '電腦端還沒推送定期提醒';
  const days = Math.floor((nowMs - generatedMs) / 86400000);
  return days >= ROUTINE_STALE_DAYS ? '定期提醒的日期是電腦 ' + days + ' 天前算的' : null;
}
