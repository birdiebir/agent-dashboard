// 任務頁的資料整理（純函式，不碰 DOM）。
// 解析沿用 journal.js 的 parseTaskBlocks（照 task_md.py 切任務區塊），這裡只加：標籤／專案／狀態／T 編號／筆記。
// T 編號只存在 App 端（localStorage agent.tnum，只存雜湊與數字），不寫進 Task.md（Q204 還沒答）。
import { parseTaskBlocks } from './journal.js';
import { isMetaLine, NOTE_MARK } from './edit.js';

export const PENDING_RE = /⚠️?\s*待確認\s*[：:]?\s*/;
const ZW = /\u200b/g;
const toLines = (t) => String(t).split('\n').map((l) => l.replace(/\r$/, ''));

// FNV-1a 32 bit → 8 位十六進位
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    h ^= cp & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (cp >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (cp >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// 去掉 ⚠️待確認 以後的字，回傳 {title, reason}
export function splitPending(text) {
  const t = String(text || '').replace(ZW, '');
  const m = PENDING_RE.exec(t);
  if (!m) return { title: t.trim(), reason: '', pending: false };
  return { title: t.slice(0, m.index).trim(), reason: t.slice(m.index + m[0].length).trim(), pending: true };
}

// 正規化標題（去標籤、去待確認以後、壓空白）的雜湊
export function taskKey(title) {
  return fnv1a(splitPending(title).title.replace(/\s+/g, ' ').trim());
}

const QID_G = /\b(?:Q|KB)\d+\b/g;
const PID_G = /\bP\d+\b/g;
const dedent = (l) => l.replace(/^( {4}|\t)/, '').replace(/^\u200b/, '');
const metaOf = (sub, label) => {
  const hits = sub.filter((l) => new RegExp('^\\s*-\\s*' + label + '[：:]').test(l));
  if (!hits.length) return '';
  return hits[hits.length - 1].replace(new RegExp('^\\s*-\\s*' + label + '[：:]\\s*'), '').trim();
};

export const STATE_LABEL = {
  waiting: '需要你的回答', resumable: '已回答，等電腦接著做', review: '結果待你看', doing: 'Agent 處理中', todo: '等 Agent 處理',
  done: '已完成', cancelled: '已取消', failed: '失敗', promoted: '已升格',
};
export const STATE_ICON = {
  waiting: '🙋', resumable: '▶️', review: '👀', doing: '🏃', todo: '⏳', done: '✅', cancelled: '🚫', failed: '❌', promoted: '⬆️',
};

// 單一任務的狀態判斷（依序，第一個符合的算）
export function classify({ checked, title, reason, pending, sub, qids, answered, accepted, key, waitLocal, fromApp }) {
  const result = metaOf(sub, '結果');
  if (checked) {
    let state;
    if (/取消/.test(result)) state = 'cancelled';
    else if (/失敗/.test(result)) state = 'failed';
    else if (/升格/.test(result) || /→\s*P\d+/.test(result)) state = 'promoted';
    // 只有手機 App 交辦的任務才要你驗收；電腦端或 Task.md 直接寫的舊任務打勾就算完成（不然第一次開會一次冒出一堆待驗收）
    else state = fromApp && !accepted.has(key) ? 'review' : 'done';
    return { state, stateLabel: STATE_LABEL[state] + (state === 'review' && result ? '：' + result : '') };
  }
  if (pending) {
    if (qids.length && qids.every((q) => answered.has(q))) return { state: 'resumable', stateLabel: STATE_LABEL.resumable };
    return { state: 'waiting', stateLabel: STATE_LABEL.waiting + (reason ? '：' + reason : '') };
  }
  const prog = sub.filter((l) => /^\s*-\s*進度[：:]/.test(l));
  if (prog.length) {
    const p = prog[prog.length - 1].replace(/^\s*-\s*進度[：:]\s*/, '').trim();
    return { state: 'doing', stateLabel: STATE_LABEL.doing + (p ? '：' + p : '') };
  }
  return { state: 'todo', stateLabel: waitLocal ? '等待本機（電腦上線後處理）' : STATE_LABEL.todo };
}

// 取得 Task.md 裡每個任務（排除 [journal] 與「📝 筆記」）。
// opts：{answered:Set<qid>, accepted:Set<key>, waitLocal:bool, tnum:{next,map}}
// 回傳 {tasks, notes, tnum, tnumChanged}；tasks 依檔案順序。
export function parseTasks(taskText, opts = {}) {
  const answered = opts.answered || new Set();
  const accepted = opts.accepted || new Set();
  const known = opts.knownPids ? new Set(opts.knownPids) : null; // 沒給清單：維持舊行為
  const lines = toLines(taskText);
  const { tasks: blocks } = parseTaskBlocks(lines);
  const tasks = [];
  const notes = [];
  for (const b of blocks) {
    const head = b.head;
    if (head.tag === 'journal') continue;
    const sp = splitPending(head.text);
    const sub = b.sub.map((i) => lines[i]);
    const attach = b.attach.map((i) => lines[i]);
    if (sp.title.includes(NOTE_MARK)) { notes.push(buildNote(b, sp, sub, attach)); continue; }
    const key = taskKey(head.text);
    const explicit = [];
    for (const t of head.tags) if (/^P\d+$/i.test(t)) { const p = t.toUpperCase(); if (!explicit.includes(p)) explicit.push(p); }
    const inferred = [];
    for (const m of (sp.title + '\n' + sub.join('\n')).matchAll(PID_G)) {
      if (explicit.includes(m[0]) || inferred.includes(m[0])) continue;
      if (known && !known.has(m[0])) continue; // 推測只認 Project.md 總覽表裡有的 PID
      inferred.push(m[0]);
    }
    if (known && inferred.length > 1) inferred.length = 1; // 推測最多 1 個（標題先、子行後）
    const qids = [];
    for (const m of (sp.reason + '\n' + sub.join('\n')).matchAll(QID_G)) if (!qids.includes(m[0])) qids.push(m[0]);
    const c = classify({ checked: head.checked, title: sp.title, reason: sp.reason, pending: sp.pending, sub, qids, answered, accepted, key, waitLocal: !!opts.waitLocal, fromApp: sub.some((l) => /^\s*-\s*(來源|送出)[：:]\s*手機 App/.test(l)) });
    const prog = sub.filter((l) => /^\s*-\s*進度[：:]/.test(l));
    // [remind] 是使用者自己要做的事，不是等 Agent 處理（QC 建議 10）
    if (head.tag === 'remind' && c.state === 'todo') c.stateLabel = '提醒：你要做';
    tasks.push({
      key, tnum: 0, tag: head.tag || 'agent', tags: head.tags,
      projects: explicit.length ? explicit : inferred, projectInferred: !explicit.length && inferred.length > 0,
      title: sp.title, bodyMd: bodyOf(sub, attach), state: c.state, stateLabel: c.stateLabel, reason: sp.reason,
      result: metaOf(sub, '結果'), progress: prog.length ? prog[prog.length - 1].replace(/^\s*-\s*進度[：:]\s*/, '').trim() : '',
      mid: metaOf(sub, '手機編號'), qids, deadline: metaOf(sub, '期限'), fromApp: sub.some((l) => /^\s*-\s*(來源|送出)[：:]\s*手機 App/.test(l)), checked: head.checked,
    });
  }
  const t = assignTnums(tasks.map((x) => x.key), opts.tnum);
  for (const x of tasks) x.tnum = t.tnum.map[x.key];
  return { tasks, notes, tnum: t.tnum, tnumChanged: t.changed };
}

function bodyOf(sub, attach) {
  const keep = sub.filter((l) => !/^\s*-\s*(結果|期限|手機編號)[：:]/.test(l)).map(dedent);
  return [...keep, ...attach].join('\n').replace(/^\n+|\n+$/g, '');
}

// T 編號：第一次看到的任務依 Task.md 由下往上（舊的先）配號；已經有的不變。不改傳入的物件
export function assignTnums(keys, store) {
  const cur = store && typeof store === 'object' && store.map && typeof store.map === 'object' ? store : { next: 1, map: {} };
  const map = { ...cur.map };
  let next = Number.isInteger(cur.next) && cur.next > 0 ? cur.next : 1;
  let changed = false;
  for (let i = keys.length - 1; i >= 0; i--) {
    if (Object.prototype.hasOwnProperty.call(map, keys[i])) continue;
    map[keys[i]] = next++;
    changed = true;
  }
  return { tnum: { next, map }, changed };
}

export const tlabel = (n) => 'T' + n;

// ---------- 分組 ----------
// v4 M2：過期的 [remind]（標題裡的日期比今天早超過 3 天、沒打勾）收進「過期提醒」；
// 「最近完成」只列結果日期在 7 天內的 [x]，沒有日期或更早的收進「更早完成」。
export const OVERDUE_REMIND_DAYS = 3;
export const RECENT_DONE_DAYS = 7;
export const GROUP_DEFS = [
  ['waiting', '等我'], ['review', '待驗收'], ['doing', '處理中'], ['todo', '待處理'], ['recent', '最近完成'], ['remind', '提醒'],
  ['overdue', '過期提醒'], ['older', '更早完成'],
];
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
// 日期沒有年份：先當成今年；如果已經過了半年以上（例如 12 月看到「1/5」），就當成明年。提醒多半指向未來，不往前一年推
function mdDate(month, day, now) {
  const d = new Date(now.getFullYear(), month - 1, day);
  if (d.getMonth() !== month - 1) return null; // 2/31 這種不存在的日期
  return now.getTime() - d.getTime() > 180 * 86400000 ? new Date(now.getFullYear() + 1, month - 1, day) : d;
}
// 提醒的日期：標題裡所有 MM/DD（也看「期限：」），回傳最晚的那個（一個提醒有好幾個日期時，最晚的才是真的期限）；沒有回 null
export function remindDate(t, now = new Date()) {
  const ds = [];
  for (const m of String(t.title || '').matchAll(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/g)) {
    const mo = Number(m[1]); const da = Number(m[2]);
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) { const d = mdDate(mo, da, now); if (d) ds.push(d); }
  }
  const dl = /(\d{4})-(\d{2})-(\d{2})/.exec(t.deadline || '');
  if (dl) ds.push(new Date(Number(dl[1]), Number(dl[2]) - 1, Number(dl[3])));
  return ds.length ? new Date(Math.max(...ds.map((d) => d.getTime()))) : null;
}
export function isOverdueRemind(t, now = new Date()) {
  if (t.tag !== 'remind' || t.checked) return false;
  const d = remindDate(t, now);
  return !!d && Math.round((dayStart(now) - dayStart(d)) / 86400000) > OVERDUE_REMIND_DAYS;
}
// 打勾任務的結果日期（結果行裡第一個 YYYY-MM-DD）；沒有回 null
export function resultDate(t) {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(t.result || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
export function groupTasks(tasks, now = new Date()) {
  const of = (t) => {
    if (t.tag === 'remind') return isOverdueRemind(t, now) ? 'overdue' : 'remind';
    if (t.state === 'waiting' || t.state === 'resumable') return 'waiting';
    if (t.state === 'review') return 'review';
    if (t.state === 'doing') return 'doing';
    if (t.state === 'todo') return 'todo';
    const d = resultDate(t);
    return d && Math.round((dayStart(now) - dayStart(d)) / 86400000) <= RECENT_DONE_DAYS ? 'recent' : 'older';
  };
  return GROUP_DEFS.map(([key, label]) => ({ key, label, items: tasks.filter((t) => of(t) === key) }));
}

// ---------- 專案／題目關聯 ----------
// opts.explicitOnly：只列明確 [PXX] 標籤的（工作專案）
export function tasksOfProject(tasks, pid, opts = {}) {
  return tasks.filter((t) => t.projects.includes(pid) && !(opts.explicitOnly && t.projectInferred));
}
export const tasksOfQuestion = (tasks, qid) => tasks.filter((t) => t.qids.includes(qid));

// 近期重要：有期限（YYYY-MM-DD）的未完成任務，日期近的在前
export function deadlineOf(t) {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(t.deadline || '');
  return m ? m[1] + m[2] + m[3] : null;
}
export const ACTIVE_STATES = ['waiting', 'resumable', 'doing', 'todo'];
export const isActiveTask = (t) => ACTIVE_STATES.includes(t.state) && t.tag !== 'remind';

// ---------- 首頁「需要你處理」 ----------
export function attention(tasks, nQuestions) {
  const waiting = tasks.filter((t) => t.state === 'waiting' && t.tag !== 'remind');
  const review = tasks.filter((t) => t.state === 'review' && t.tag !== 'remind');
  const parts = [];
  if (nQuestions) parts.push(nQuestions + ' 個問題');
  if (waiting.length) parts.push(waiting.length + ' 個任務等你');
  if (review.length) parts.push(review.length + ' 個結果待驗收');
  return { total: nQuestions + waiting.length + review.length, nQuestions, waiting, review, parts, text: parts.join('｜') };
}

// ---------- 筆記 ----------
function buildNote(b, sp, sub, attach) {
  const head = sp.title.replace(/^.*?📝\s*筆記[^：:]*[：:]\s*/, '');
  const content = [head, ...sub.filter((l) => !isMetaLine(l)).map(dedent), ...attach].join('\n').trim();
  const result = metaOf(sub, '結果');
  const state = b.head.checked ? 'done' : sp.pending ? 'confirm' : 'wait';
  return {
    key: taskKey(b.head.text), mid: metaOf(sub, '手機編號'), content, source: metaOf(sub, '來源'), url: metaOf(sub, '網址'), result, reason: sp.reason, state,
    stateLabel: state === 'done' ? '已收錄' + (result ? '：' + result : '') : state === 'confirm' ? '需要確認' + (sp.reason ? '：' + sp.reason : '') : '等 Agent 收錄',
  };
}
export function parseNotes(taskText) { return parseTasks(taskText).notes; }

// ---------- 對話的 context ----------
const cut20 = (s) => [...String(s || '').replace(/\s+/g, ' ').trim()].slice(0, 20).join('');
export function ctxPrefix(ctx) {
  if (!ctx) return '';
  if (ctx.kind === 'project') return '［' + ctx.id + (ctx.label ? ' ' + ctx.label : '') + '］';
  if (ctx.kind === 'task') return '［' + ctx.id + (ctx.label ? ' ' + cut20(ctx.label) : '') + (ctx.pid ? '｜' + ctx.pid : '') + '］';
  return '';
}
export function withCtx(ctx, text) {
  const t = String(text || '').trim();
  const p = ctxPrefix(ctx);
  return p ? p + ' ' + t : t;
}
// 反向：從一則留言開頭拆出 context。回傳 {pid, tid, rest}
export function parseCtx(text) {
  const m = /^［([^］]*)］\s*/.exec(String(text || ''));
  if (!m) return { pid: '', tid: '', rest: String(text || '') };
  const pid = (/\bP\d+\b/.exec(m[1]) || [''])[0];
  const tid = (/^T\d+\b/.exec(m[1]) || [''])[0];
  return { pid, tid, rest: String(text).slice(m[0].length) };
}
export const escalateLine = (task, choice) => tlabel(task.tnum) + ' ' + cut20(task.title) + '：' + choice;
export const wantsPromote = (t) => /升格/.test(t.reason || '');

// ---------- 升格成專案（Q210 A） ----------
// 表單預設值：專案名稱＝任務標題前 30 字；理由＝⚠️待確認 原因裡「建議升格專案：」後面的字（沒有就空白）
export function promoteDefaults(task) {
  const name = [...String(task.title || '').replace(/\s+/g, ' ').trim()].slice(0, 30).join('');
  const m = /建議升格專案[：:]\s*(.+)$/.exec(String(task.reason || '').replace(/\s+/g, ' ').trim());
  return { name, reason: m ? m[1].trim() : '' };
}
// 一行的升格請求（固定格式，主 session 一眼看懂）。欄位內的換行壓成空白、「｜」換成「/」，避免破壞欄位分隔
const oneLine = (s, max) => [...String(s || '').replace(/\s+/g, ' ').replace(/｜/g, '/').trim()].slice(0, max).join('');
export function promoteLine(task, { name = '', reason = '' } = {}) {
  return '［升格專案］來源任務 ' + tlabel(task.tnum) + '「' + oneLine(task.title, 400) + '」｜建議專案名：' + oneLine(name, 60) +
    '｜理由：' + oneLine(reason, 200) + '｜原任務保留，請開 Project.md 專案段並在原任務結果寫「已升格 → PXX」';
}

// ---------- v5 M2：提醒事項頁 ----------
// 未完成的 [remind] 依日期排（沒日期的在後、系統自動加的「今日必答」最後）、過期的標紅（日期比今天早）；已打勾的另外放
export function remindLists(tasks, now = new Date()) {
  const today = dayStart(now);
  const rows = tasks.filter((t) => t.tag === 'remind').map((t, i) => {
    const d = remindDate(t, now);
    return { t, i, date: d, overdue: !t.checked && !!d && dayStart(d) < today, auto: /^今日必答/.test(t.title) };
  });
  const open = rows.filter((x) => !x.t.checked).sort((a, b) =>
    (a.auto - b.auto) || (a.date && b.date ? a.date - b.date : a.date ? -1 : b.date ? 1 : 0) || a.i - b.i);
  return { open, done: rows.filter((x) => x.t.checked) };
}

// Task.md「## 定期提醒設定」表格（照 routine_ops.remind_settings 移植）：表頭開頭是「| 提醒名稱」，之後連續的「|」行；
// 欄數不足 5 的列 routine 會靜默略過，這裡不能靜默：回傳 {ok:false, name, cells} 讓畫面顯示警告。
// 欄位：提醒名稱｜頻率｜提醒內容｜核實方式｜狀態｜最後異動（最後一欄可缺）
const cellsOf = (ln) => ln.trim().replace(/^\|+/, '').replace(/\|+$/, '').split('|').map((c) => c.trim());
export function parseRemindSettings(taskText) {
  const rows = [];
  let inTable = false;
  for (const raw of toLines(taskText)) {
    const ln = raw;
    if (ln.startsWith('| 提醒名稱')) { inTable = true; continue; }
    if (!inTable) continue;
    if (!ln.startsWith('|')) break;
    const c = cellsOf(ln);
    if (c.every((x) => /^[-:\s]*$/.test(x))) continue; // 分隔線或全空白列
    if (c.length >= 5) rows.push({ ok: true, name: c[0], freq: c[1], content: c[2], verify: c[3], status: c[4], changed: c[5] || '' });
    else rows.push({ ok: false, name: c[0] || '（沒有名稱）', cells: c.length, content: c.slice(1).join(' ｜ ') });
  }
  return rows;
}
