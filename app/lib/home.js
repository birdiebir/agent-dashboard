// 首頁（v3 UI/UX 檢視後新設計）的純函式，不碰 DOM、不碰儲存空間。
// 三塊：一行狀態、重要提醒（最多 4 列）、精簡額度；其餘收進「更多資訊」。
// 可調參數都集中在這裡，改這幾個常數就能調整首頁行為。
import { deadlineDate, isBacklogSection } from './questions.js';
import { deadlineOf, tlabel, ACTIVE_STATES } from './tasks.js';
import { isDeferred, HOME_SOON_DAYS, HOME_WEEK_DAYS } from './reminders.js';

export const JOURNAL_REMIND_AT = '17:45'; // 這個時間之後，今天的日記還沒寫完才進提醒
export const SOON_DAYS = 3; // 1～3 天內到期＝第 2 層
export const WEEK_DAYS = 7; // 4～7 天內到期＝第 7 層（只顯示，不計入數字）
export const MAX_ROWS = 4; // 首頁預設顯示幾列，其餘「還有 N 件」
// D7（今日必答標題日期比今天舊）：'label'＝照算並在提醒列標日期（預設，建議 A）；'drop'＝舊超過 STALE_TODAY_DAYS 天就不算重要；'plain'＝照算不標
export const STALE_TODAY_MODE = 'label';
export const STALE_TODAY_DAYS = 2;

export { isBacklogSection };

const pad = (n) => String(n).padStart(2, '0');
const dayNum = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
// 'YYYYMMDD'（deadlineDate／deadlineOf 的格式）→ 與今天相差的天數（今天＝0，明天＝1，昨天＝-1）
function diffDays(ymd, today) {
  return Math.round(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))) / 86400000 - today);
}
const hhmmOf = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());
export const afterRemindTime = (now) => hhmmOf(now) >= JOURNAL_REMIND_AT;

// Questions.md 區段標題「今日必答 2026-10-24（5 題）」裡的日期；沒有回 null
export function sectionDate(section) {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(section || ''));
  return m ? m[1] + m[2] + m[3] : null;
}

const TIER_KIND = { 1: 'deadline', 2: 'deadline', 3: 'waiting', 4: 'journal', 5: 'today', 6: 'review', 7: 'soon' };

// openCards：openCards() 的結果；tasks：parseTasks().tasks；
// journal：{ today:{state, filled, hasFree}, yesterday:{found, checked, filled, month, day} }（可省略）
// 回傳 {rows, count, importantQids, backlog}；rows 已排序，每列 {tier, kind, chip, id, title, date, count, target}
// routines：lib/reminders.js routineView() 的結果（可省略）；reminds：oneTimeReminders() 的結果（可省略）。
// 2026-10-30：[remind] 任務不再走下面「有期限欄位的任務」那條（很多提醒的日期寫在標題裡、讓它漏掉或算錯），
// 一次性提醒改看 reminds（跟電腦版看板同一套日期判斷），定期提醒改看 routines（電腦端用看板規則算好的下次日期）。
export function buildReminders({ openCards = [], tasks = [], journal = null, now = new Date(), doing = [], routines = null, reminds = null } = {}) {
  const today = dayNum(now);
  const ents = [];
  let seq = 0;
  const add = (e) => ents.push({ date: null, count: 1, seq: seq++, ...e });
  const importantQids = [];
  let backlog = 0;
  const todayCards = [];
  const stillCards = [];

  for (const c of openCards) {
    if (isBacklogSection(c.section)) continue; // 擱置區：不上首頁、不算其他題目
    const date = deadlineDate(c.deadline);
    const diff = date ? diffDays(date, today) : null;
    const row = { id: c.qid, title: c.title, date, target: { type: 'q', id: c.qid } };
    if (date && diff <= 0) {
      add({ ...row, tier: 1, chip: diff < 0 ? '⏰ 逾期 ' + -diff + ' 天' : '⏰ 今天' });
      importantQids.push(c.qid);
    } else if (date && diff <= SOON_DAYS) {
      add({ ...row, tier: 2, chip: diff === 1 ? '⏰ 明天' : '⏰ ' + diff + ' 天後' });
      importantQids.push(c.qid);
    } else if (!date && c.liveKind === 'deadline') {
      add({ ...row, tier: 2, chip: '⏰ 有期限' });
      importantQids.push(c.qid);
    } else if (c.liveKind === 'red') {
      add({ ...row, tier: 2, chip: '🔴 卡住' });
      importantQids.push(c.qid);
    } else if (c.stillYours) {
      stillCards.push(c);
      importantQids.push(c.qid);
    } else if (c.today && !(STALE_TODAY_MODE === 'drop' && staleDays(c.section, today) > STALE_TODAY_DAYS)) {
      todayCards.push(c);
      importantQids.push(c.qid);
    } else if (date && diff <= WEEK_DAYS) {
      add({ ...row, tier: 7, chip: '📅 ' + diff + ' 天後' });
    } else backlog++;
  }

  const todayIso = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  for (const t of tasks) {
    if (t.tag === 'remind') continue; // 見上面說明
    if (isDeferred(t, todayIso)) continue; // 「X 起才處理」還沒到日：先不提醒
    const date = deadlineOf(t);
    const diff = date ? diffDays(date, today) : null;
    const active = ACTIVE_STATES.includes(t.state);
    const row = { id: tlabel(t.tnum), title: t.title, date, target: { type: 'task', id: t.key } };
    if (active && date && diff <= 0) add({ ...row, tier: 1, chip: diff < 0 ? '⏰ 逾期 ' + -diff + ' 天' : '⏰ 今天' });
    else if (active && date && diff <= SOON_DAYS) add({ ...row, tier: 2, chip: diff === 1 ? '⏰ 明天' : '⏰ ' + diff + ' 天後' });
    else if (t.state === 'waiting') add({ ...row, tier: 3, chip: '🙋 等你' });
    else if (active && date && diff <= WEEK_DAYS) add({ ...row, tier: 7, chip: '📅 ' + diff + ' 天後' });
  }

  // 一次性提醒（Task.md 未打勾的 [remind]）：今天或已過（過 7 天內）→ 第 1 層；3 天內 → 第 2 層；7 天內 → 第 7 層
  for (const r of (reminds && reminds.soon) || []) {
    const row = { id: '', title: r.t.title, date: r.date.replace(/-/g, ''), target: { type: 'task', id: r.t.key } };
    if (r.days <= 0) add({ ...row, tier: 1, chip: r.days < 0 ? '⏰ 逾期 ' + -r.days + ' 天' : '⏰ 今天' });
    else if (r.days <= HOME_SOON_DAYS) add({ ...row, tier: 2, chip: r.days === 1 ? '⏰ 明天' : '⏰ ' + r.days + ' 天後' });
    else if (r.days <= HOME_WEEK_DAYS) add({ ...row, tier: 7, chip: '📅 ' + r.days + ' 天後' });
  }

  // 定期提醒：這期還沒做（Task.md 有未打勾的提醒）→ 第 2 層；要你做的下次日期是今天 → 第 1 層、3 天內 → 第 2 層、7 天內 → 第 7 層。
  // 產出給你看的（auto）只有「等你看」才進來；日期已過但電腦還沒更新的不猜
  for (const r of routines ? [...routines.you, ...routines.auto] : []) {
    const date = r.next ? r.next.replace(/-/g, '') : null;
    const target = r.pending ? { type: 'task', id: r.pend[0].key } : { type: 'reminders', id: '' };
    const base = { id: '', title: r.name, date, target };
    if (r.pending) add({ ...base, tier: 2, chip: r.who === 'auto' ? '👀 等你看' : '● 這期還沒做', count: 1 });
    else if (r.who === 'you' && r.diff != null && r.diff >= 0) {
      if (r.diff === 0) add({ ...base, tier: 1, chip: '⏰ 今天' });
      else if (r.diff <= HOME_SOON_DAYS) add({ ...base, tier: 2, chip: r.diff === 1 ? '⏰ 明天' : '⏰ ' + r.diff + ' 天後' });
      else if (r.diff <= HOME_WEEK_DAYS) add({ ...base, tier: 7, chip: '📅 ' + r.diff + ' 天後' });
    }
  }

  if (journal) {
    const j = journal.today;
    if (j && ['none', 'template', 'partial'].includes(j.state) && afterRemindTime(now)) {
      const left = 3 - (j.filled || 0);
      add({ tier: 4, chip: '📝 日記', id: '', title: j.state === 'partial' ? '今天的日記還差 ' + left + ' 題' : '今天的日記還沒寫', target: { type: 'journal', id: 'today' } });
    }
    const y = journal.yesterday;
    if (y && y.found && !y.checked && (y.filled || 0) < 3) {
      add({ tier: 4, chip: '📝 日記', id: '', title: '昨天 ' + pad(y.month) + '/' + pad(y.day) + ' 還沒填完', target: { type: 'journal', id: 'yesterday' } });
    }
  }

  if (stillCards.length) {
    add({
      tier: 3, chip: '⏳ 電腦已收到', id: stillCards.length === 1 ? stillCards[0].qid : '', count: stillCards.length,
      title: stillCards.length === 1 ? '還有你要做的：' + stillCards[0].title : stillCards.length + ' 題電腦已收到、還有你要做的',
      target: { type: 'todo-today', id: stillCards[0].qid },
    });
  }

  if (todayCards.length) {
    const oldest = todayCards.map((c) => sectionDate(c.section)).filter(Boolean).sort()[0];
    const old = oldest && STALE_TODAY_MODE !== 'plain' && diffDays(oldest, today) < 0;
    add({
      tier: 5, chip: '❓ 今日必答', id: '', count: todayCards.length,
      title: (old ? oldest.slice(4, 6) + '-' + oldest.slice(6, 8) + ' 的' : '') + '今日必答 ' + todayCards.length + ' 題',
      target: { type: 'todo-today', id: todayCards[0].qid },
    });
  }

  // v5：動手題（不算問題，在任務頁的動手區）。一列「🛠 動手 N 件」；有期限的照期限排（逾期／3 天內提前到第 1、2 層，其餘第 5 層）
  if (doing.length) {
    const dates = doing.map((c) => deadlineDate(c.deadline)).filter(Boolean).sort();
    const first = dates[0] || null;
    const diff = first ? diffDays(first, today) : null;
    const tier = first && diff <= 0 ? 1 : first && diff <= SOON_DAYS ? 2 : 5;
    add({ tier, chip: '🛠', id: '', count: doing.length, date: first, title: '動手 ' + doing.length + ' 件', target: { type: 'tasks-doing', id: '' } });
  }

  const reviews = tasks.filter((t) => t.state === 'review' && t.tag !== 'remind');
  if (reviews.length === 1) add({ tier: 6, chip: '👀 待驗收', id: tlabel(reviews[0].tnum), title: reviews[0].title, target: { type: 'task', id: reviews[0].key } });
  else if (reviews.length > 1) add({ tier: 6, chip: '👀 待驗收', id: '', count: reviews.length, title: reviews.length + ' 個結果待驗收', target: { type: 'tasks-review', id: '' } });

  ents.sort((a, b) => a.tier - b.tier || (a.date && b.date ? (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) : a.date ? -1 : b.date ? 1 : 0) || a.seq - b.seq);
  const rows = ents.map(({ seq: _s, ...r }) => ({ kind: TIER_KIND[r.tier], ...r }));
  const count = rows.filter((r) => r.tier <= 6).reduce((n, r) => n + r.count, 0); // 第 7 層「近期」不計入
  return { rows, count, importantQids, backlog };
}

function staleDays(section, today) {
  const d = sectionDate(section);
  return d ? -diffDays(d, today) : 0;
}

// 預設顯示前 MAX_ROWS 列，其餘「還有 N 件」
export function visibleRows(rows, showAll = false, max = MAX_ROWS) {
  if (showAll || rows.length <= max) return { shown: rows, hidden: 0 };
  return { shown: rows.slice(0, max), hidden: rows.length - max };
}

// ---------- 狀態列 ----------
const ageText = (m) => (m == null ? '' : m < 1 ? '剛剛' : m < 60 ? m + ' 分鐘前' : Math.floor(m / 60) + ' 小時前');
// st：agentStatus() 的結果（pending 傳 0）；ctx：{ageMin, offline, error, fetchedAt:'HH:MM'}
// 回傳 {text, right, action}；action：'detail'（點開細節）｜'settings'（跳設定頁）
export function statusLineView(st, ctx = {}) {
  const age = ageText(ctx.ageMin);
  // v4 M2：有 ctx.sync（lib/status.js 的 syncStatus）就改用電腦同步狀態當主文字，既有的「執行中」疊在後面。
  // GitHub 回錯誤（token 不對等）還是照舊顯示「同步失敗」（那不是沒網路，要去設定）。
  if (ctx.sync) {
    const sy = ctx.sync;
    if (ctx.error) return { text: '⚠️ 同步失敗：' + [...String(ctx.error)].slice(0, 14).join(''), right: '去設定', action: 'settings' };
    if (sy.key === 'offline') return { text: sy.text, right: '', action: 'detail' };
    let text = sy.text;
    if (st.key === 'running') text += '｜🏃 ' + st.detail;
    if (sy.stale && sy.liveAgeMin != null) text += '｜⚠ Live ' + (sy.liveAgeMin >= 60 ? Math.floor(sy.liveAgeMin / 60) + ' 小時' : sy.liveAgeMin + ' 分鐘') + '沒更新';
    return { text, right: '', action: 'detail' }; // 手機同步時間放在點開的細節裡，讓主文字有地方換行
  }
  if (st.key === 'error') {
    if (ctx.offline && !ctx.error) return { text: '📴 離線，顯示 ' + (ctx.fetchedAt || '—') + ' 的資料', right: '', action: 'detail' };
    return { text: '⚠️ 同步失敗：' + [...String(ctx.error || st.detail || '')].slice(0, 14).join(''), right: '去設定', action: 'settings' };
  }
  if (st.key === 'running') return { text: '🏃 執行中：' + st.detail, right: age, action: 'detail' };
  if (st.key === 'stale') return { text: '⏳ 資料可能過期', right: ctx.ageMin != null ? 'Agent ' + (ctx.ageMin >= 60 ? Math.floor(ctx.ageMin / 60) + ' 小時' : ctx.ageMin + ' 分鐘') + '沒更新' : '', action: 'detail' };
  if (st.key === 'no-remote') return { text: '🖥️ 同步正常，沒開遠端', right: ctx.fetchedAt ? '同步 ' + ctx.fetchedAt : '', action: 'detail' };
  if (st.key === 'wait-local') {
    const m = /(\d{4})-(\d{2})-(\d{2})/.exec(st.detail || '');
    return { text: '🖥️ 等電腦上線', right: m ? '最近回報 ' + m[2] + '-' + m[3] : '', action: 'detail' };
  }
  return { text: '✅ 待命，同步正常', right: age, action: 'detail' };
}

// ---------- 更多資訊摘要 ----------
// 動態 N・進行中 N・專案 N・日記 x/3；數量是 0 的項目不寫
export function moreSummary({ events = 0, doing = 0, projects = 0, journalFilled = 0 } = {}) {
  const parts = [];
  if (events) parts.push('動態 ' + events);
  if (doing) parts.push('進行中 ' + doing);
  if (projects) parts.push('專案 ' + projects);
  if (journalFilled) parts.push('日記 ' + journalFilled + '/3');
  return parts.join('・');
}

// ---------- 日記狀態圖示（圖示要和文字一致）----------
export function journalIcon(state) {
  if (state === 'collected' || state === 'done') return '✅';
  if (state === 'filled') return '⏳';
  if (state === 'partial') return '✏️';
  if (state === 'pending') return '🙋';
  return '📝';
}

// ---------- Live.md「現在」區的狀態行 ----------
// p：parseLive 的結果。Live.md 最後更新不是今天 → 前面標 MM-DD 並淡化（old=true）；沒有狀態行回 null
// （QC 必修 1：這個判斷原本寫在 app.js、regex 少一個反斜線永遠不成立；搬到這裡用行為測試鎖住）
export function nowStatusView(p, now = new Date()) {
  const st = p && p.now && p.now.status ? p.now.status : '';
  if (!st) return null;
  const upd = p.updated && /^(\d{1,2})-(\d{1,2})$/.exec(p.updated.date || '');
  const old = !!upd && (Number(upd[1]) !== now.getMonth() + 1 || Number(upd[2]) !== now.getDate());
  const stamp = old ? pad(upd[1]) + '-' + pad(upd[2]) + ' ' : '';
  return { text: '狀態：' + stamp + st, old };
}
