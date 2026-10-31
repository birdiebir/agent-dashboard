// 「我寫過的」：outbox 每一筆現在是什麼狀態（純函式，不碰 DOM、不碰儲存空間）。
//
// phase：
//   queued    排隊中（含送出中）：還在手機上
//   failed    沒送出：非網路錯誤，要使用者按重試或刪除
//   waiting   已送出、電腦還沒收（寫進 GitHub 了，電腦下次開視窗才會看到）
//   received  電腦已收到、處理中或在等你
//   handled   電腦已處理完
//   sent      紀錄中心（record）已送出，但還沒抓回紀錄檔確認：不需要電腦處理，所以不算「等電腦收」
//   unknown   這個版本不認得的種類（新版 App 寫的）：原樣留著、不送、不算「電腦還沒收」、也不會被自動清掉
// 電腦處理狀態從這幾個地方推：
//   回答：Questions.md「已收到答案…」那一行、state.json questions（已收到／已處理）、答案還在不在 Questions.md
//   任務、筆記：Task.md 以「手機編號」找到的任務；Task.md 清掉後看 state.json tasks（mid 對應）
//   日記：Task.md 那天的日記打勾，或 state.json journal 有那一天
//   對話：Live.md 對話區那一串有沒有 ↳ 回覆
//   升格請求、維持任務：Task.md 該任務現在的狀態
import { parseReceived, parseQuestionBank, parseSupplements, parseDoingLine } from './questions.js';
import { isKnownKind } from './outbox.js';
import { parseThreads } from './chat.js';
import { readJournal } from './journal.js';
import { normTitle, findOpenTasks } from './taskedit.js';
import { stamp, cleanText } from './edit.js';
import { previewOfRecord, recordPhase } from './records.js';

export const HANDLED_KEEP_DAYS = 30; // 已處理超過 30 天自動移除
export const STALE_UNSEEN_HOURS = 36; // 送出超過這麼久、在 Task.md 與 state.json 都找不到＝已經被處理並清掉了

export const KIND_LABEL = { answer: '回答', journal: '日記', note: '筆記', task: '任務', chat: '對話', promote: '升格請求', keep: '維持任務', record: '紀錄', done: '提醒完成', reply: '提醒回覆' };
export const KIND_ICON = { answer: '❓', journal: '📔', note: '📝', task: '✅', chat: '💬', promote: '⬆️', keep: '↩️', record: '📚', done: '☑️', reply: '💬' };
export const PHASE_LABEL = { queued: '排隊中', failed: '沒送出', waiting: '等電腦', received: '電腦已收到', handled: '已處理', sent: '已送出', unknown: '不認得' };
export const FILTERS = [['all', '全部'], ['queued', '排隊中'], ['waiting', '等電腦'], ['handled', '已處理'], ['failed', '失敗']];

const pad = (n) => String(n).padStart(2, '0');
const oneLine = (s) => cleanText(s).replace(/\s*\n+\s*/g, ' ').trim();
const clip = (s, n) => { const a = [...String(s || '')]; return a.length > n ? a.slice(0, n).join('') + '…' : a.join(''); };

// 內容前兩行（列表上顯示用）
export function previewOf(item) {
  const p = item.payload || {};
  let lines = [];
  if (item.kind === 'answer') {
    const d = parseDoingLine(p.answer); // 動手狀態回寫：顯示「動手：進行中｜備註」
    lines = [(p.qid ? p.qid + '｜' : '') + (d ? '動手：' + d.state + (d.note ? '｜' + d.note : '') : (p.answer || ''))];
  }
  else if (item.kind === 'journal') lines = (p.answers || []).map((a, i) => (a && a.trim() ? (i + 1) + '. ' + a.trim() : '')).filter(Boolean);
  else if (item.kind === 'promote') lines = ['升格成專案：' + (p.name || ''), p.reason || ''];
  else if (item.kind === 'keep') lines = ['維持任務：' + (p.title || '')];
  else if (item.kind === 'done') lines = ['完成：' + (p.title || ''), p.note || ''];
  else if (item.kind === 'reply') lines = ['回覆：' + (p.content || ''), p.title || ''];
  else if (item.kind === 'record') lines = [previewOfRecord(p)];
  else lines = String(p.content || '').split('\n');
  lines = lines.flatMap((l) => String(l).split('\n')).map((l) => l.trim()).filter(Boolean);
  return clip(lines.slice(0, 2).join('\n'), 200);
}

// 建 ctx：一次算好各種查表，deriveMine 對每一筆只做查詢
// 傳入 {tasks, notes}：parseTasks 的結果（含 mid）；taskText／questionsText／liveText：最新抓到的原文；state：readState 的結果或 null
export function buildMineCtx({ tasks = [], notes = [], taskText = '', questionsText = '', liveText = '', state = null, now = Date.now(), fetchedAt = 0, records = null, recFetchedAt = 0 } = {}) {
  const byMid = new Map();
  for (const t of tasks) if (t.mid) byMid.set(t.mid, { kind: 'task', t });
  for (const n of notes) if (n.mid) byMid.set(n.mid, { kind: 'note', t: n });
  const bank = new Map();
  for (const q of parseQuestionBank(questionsText || '')) if (!q.listItem && !bank.has(q.qid)) bank.set(q.qid, q);
  return {
    now, fetchedAt, state, taskText, tasks, byMid, bank, records, recFetchedAt,
    got: parseReceived(questionsText || ''), supp: parseSupplements(questionsText || ''),
    haveQuestions: !!String(questionsText || '').trim(),
    threads: parseThreads(liveText || '', new Date(now)).threads,
  };
}

const ymdOf = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const dayNum = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000;

// state.json 的 answered 是 'MM-DD'（電腦收到那天，一定 ≥ 手機送出那天）
function answeredOnOrAfter(mmdd, createdAt) {
  const m = /^(\d{2})-(\d{2})$/.exec(String(mmdd || ''));
  if (!m) return false;
  const c = new Date(createdAt);
  let y = c.getFullYear();
  if (dayNum(y, Number(m[1]), Number(m[2])) < dayNum(c.getFullYear(), c.getMonth() + 1, c.getDate()) - 200) y += 1; // 跨年
  return dayNum(y, Number(m[1]), Number(m[2])) >= dayNum(c.getFullYear(), c.getMonth() + 1, c.getDate());
}

const R = (phase, label) => ({ phase, label });

// 手機補答被電腦端轉成 Task.md 任務「手機補答 Qxx：…」（子行「來源：手機 App 補答（MM-DD）」）：
// 找得到 → 電腦已收；任務打勾（或 state.json 該筆 done）→ 已處理：<結果>。同一題補答過好幾次時只認送出那天（含）之後建立的
const suppTitle = (title, qid) => normTitle(title).startsWith('手機補答 ' + qid + '：');
function suppTaskPhase(qid, item, ctx) {
  const res = (done, result) => (done ? R('handled', '已處理' + (result ? '：' + clip(result, 40) : '')) : R('received', '電腦已收（轉成任務處理中）'));
  const late = (mmdd) => !/^\d{2}-\d{2}$/.test(mmdd || '') || answeredOnOrAfter(mmdd, item.createdAt);
  const hits = (ctx.tasks || []).filter((t) => suppTitle(t.title, qid) && late(((/手機 App 補答（(\d{2}-\d{2})）/.exec(t.bodyMd || '')) || [])[1]));
  const sj = ctx.state ? ctx.state.tasks.filter((t) => suppTitle(t.title, qid) && late(String(t.date || '').slice(-5))) : [];
  if (!hits.length && !sj.length) return null;
  const open = hits.find((t) => t.state !== 'done' && !t.checked);
  if (open) return res(false);
  const t = hits[hits.length - 1];
  if (t) return res(true, t.result);
  if (sj.some((x) => x.state !== 'done')) return res(false);
  return res(true, sj[sj.length - 1].result);
}

function answerPhase(item, ctx) {
  const qid = (item.payload || {}).qid;
  const sq = ctx.state ? ctx.state.questions.filter((x) => x.id === qid && answeredOnOrAfter(x.answered, item.createdAt)) : [];
  if (sq.length) return sq.some((x) => x.status === '已處理') ? R('handled', '電腦已處理') : R('received', '電腦已收到');
  const sp = suppTaskPhase(qid, item, ctx);
  if (sp) return sp;
  // 補充還躺在「## 手機補答」區（電腦還沒轉走）：就算題號早在「已收到答案」那行，這一次的補充仍是等電腦收
  if (ctx.supp.get(qid) && !(ctx.state && sq.length)) return R('waiting', '已寫進手機補答區，等電腦收');
  if (ctx.got.has(qid)) return R('received', '電腦已收到（等 routine 套用）');
  const q = ctx.bank.get(qid);
  const still = !!((q && q.answer) || ctx.supp.get(qid));
  if (still) return R('waiting', '已寫進 Questions.md，等電腦收');
  // 答案不在了：電腦收走了。但資料必須是送出之後才抓的，不然只是還沒更新
  if (ctx.haveQuestions && ctx.fetchedAt >= item.sentAt) return R('received', '電腦已收到');
  return R('waiting', '已寫進 Questions.md，等電腦收');
}

function journalPhase(item, ctx) {
  const d = (item.payload || {}).day || {};
  const r = readJournal(ctx.taskText, d.month, d.day);
  if (r.found && r.checked) return R('handled', r.state === 'collected' ? '已收錄' : '電腦已處理');
  const c = new Date(item.createdAt);
  const year = d.month === 12 && c.getMonth() === 0 ? c.getFullYear() - 1 : c.getFullYear();
  const ymd = year + '-' + pad(d.month) + '-' + pad(d.day);
  if (ctx.state && ctx.state.journal.some((j) => j.date === ymd)) return R('handled', '已收錄到知識庫');
  if (r.found) return R('waiting', r.state === 'pending' ? '電腦標了待確認' : '等電腦收錄');
  return ctx.now - item.sentAt > STALE_UNSEEN_HOURS * 3600000 ? R('handled', '日記已從任務清單清掉') : R('waiting', '等電腦收錄');
}

const noteLabel = { wait: R('waiting', '等電腦收錄'), confirm: R('received', '電腦要你確認'), done: R('handled', '已收錄') };
function taskStateRes(t) {
  switch (t.state) {
    case 'done': return R('handled', '已完成' + (t.result ? '：' + clip(t.result, 40) : ''));
    case 'cancelled': return R('handled', '已取消');
    case 'failed': return R('handled', '電腦回報失敗' + (t.result ? '：' + clip(t.result, 40) : ''));
    case 'promoted': return R('handled', '已升格' + (t.result ? '：' + clip(t.result, 40) : ''));
    case 'waiting': return R('received', '電腦在等你回答');
    case 'resumable': return R('received', '已回答，等電腦接著做');
    case 'review': return R('received', '結果待你看' + (t.result ? '：' + clip(t.result, 40) : ''));
    case 'doing': return R('received', '電腦處理中' + (t.progress ? '：' + clip(t.progress, 40) : ''));
    default: return R('waiting', '已在任務清單，等電腦處理');
  }
}

function taskPhase(item, ctx) {
  const hit = ctx.byMid.get(item.id);
  if (hit) {
    if (hit.kind === 'note') { const n = hit.t; const r = noteLabel[n.state] || noteLabel.wait; return n.state === 'done' && n.result ? R('handled', '已收錄：' + clip(n.result, 40)) : r; }
    return taskStateRes(hit.t);
  }
  const s = ctx.state ? ctx.state.tasks.find((x) => x.mid === item.id) : null;
  if (s) {
    if (s.state === 'done') return R('handled', '已完成' + (s.result ? '：' + clip(s.result, 40) : ''));
    if (s.state === 'pending') return R('received', '電腦要你確認');
    return s.progress ? R('received', '電腦處理中：' + clip(s.progress, 40)) : R('waiting', '等電腦處理');
  }
  if (item.result && item.result.reason === 'dup') return R('handled', '任務清單裡早就有同樣的內容');
  return ctx.now - item.sentAt > STALE_UNSEEN_HOURS * 3600000 ? R('handled', '已從任務清單清掉（處理完了）') : R('waiting', '等電腦收');
}

function chatPhase(item, ctx) {
  const want = oneLine((item.payload || {}).content);
  const when = stamp(new Date(item.createdAt));
  const t = ctx.threads.find((x) => !x.orphan && x.text === want && x.time === when) || ctx.threads.find((x) => !x.orphan && x.text === want && !x.time);
  if (t) return t.replies.length ? R('handled', 'Agent 已回') : R('waiting', '等電腦看到');
  return ctx.now - item.sentAt > 24 * 3600000 ? R('handled', '對話已收進更早的紀錄') : R('waiting', '等電腦看到');
}

function markPhase(item, ctx, kind) {
  const title = (item.payload || {}).title || '';
  if (!findOpenTasks(ctx.taskText, title).matches.length) return R('handled', '那件任務已經不在清單裡（處理完了）');
  const t = ctx.tasks.find((x) => !x.checked && normTitle(x.title) === normTitle(title));
  if (!t || t.state === 'waiting') return R('waiting', kind === 'promote' ? '等電腦處理升格請求' : '等電腦看到');
  if (kind === 'promote') return t.state === 'promoted' ? R('handled', '已升格') : R('received', '電腦處理中');
  return R('handled', '已維持任務');
}

// 提醒打勾：送出後 Task.md 那筆已經是 [x]（或被 routine 歸檔清掉）＝已處理
function donePhase(item, ctx) {
  const title = (item.payload || {}).title || '';
  return findOpenTasks(ctx.taskText, title).matches.length ? R('waiting', '等手機重新抓到') : R('handled', '已打勾');
}

// 提醒回覆：那筆提醒底下出現「Agent 回覆」＝已處理；提醒已經不在清單＝已處理
function replyPhase(item, ctx) {
  const title = (item.payload || {}).title || '';
  const t = ctx.tasks.find((x) => normTitle(x.title) === normTitle(title));
  if (!t || t.checked) return R('handled', '那件提醒已經完成或清掉了');
  const body = t.bodyMd || '';
  return body.lastIndexOf('Agent 回覆') > body.lastIndexOf('手機回覆') ? R('handled', 'Agent 已回') : R('waiting', '等電腦看到'); // 最後一則手機回覆後面有 Agent 回覆才算
}

// 一筆的狀態 → {phase, label}
export function phaseOf(item, ctx) {
  if (!isKnownKind(item.kind)) return R('unknown', '這個版本不認得這種紀錄，先不處理（更新 App 後才會送）');
  if (item.state === 'failed') return R('failed', item.err || '沒送出');
  if (item.state === 'queued' || item.state === 'sending') {
    if (item.state === 'sending') return R('queued', '送出中…');
    return R('queued', item.err ? '排隊中（' + item.err.replace(/，.*$/, '') + '）' : '排隊中，已存在手機');
  }
  switch (item.kind) {
    case 'answer': return answerPhase(item, ctx);
    case 'journal': return journalPhase(item, ctx);
    case 'note': case 'task': return taskPhase(item, ctx);
    case 'chat': return chatPhase(item, ctx);
    case 'promote': return markPhase(item, ctx, 'promote');
    case 'keep': return markPhase(item, ctx, 'keep');
    case 'done': return donePhase(item, ctx);
    case 'reply': return replyPhase(item, ctx);
    case 'record': return recordPhase(item, ctx.records, ctx.recFetchedAt);
    default: return R('unknown', '這個版本不認得這種紀錄，先不處理'); // 不會走到（上面已擋掉），保險用；不能算「等電腦收」
  }
}

// 點一筆要跳去哪（只給 target，不碰 DOM）
function jumpOf(item, ctx) {
  const p = item.payload || {};
  if (item.kind === 'answer') return { type: 'q', id: p.qid };
  if (item.kind === 'chat') return { type: 'chat' };
  if (item.kind === 'journal') {
    const n = new Date(ctx.now);
    const y = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
    const d = p.day || {};
    const key = d.month === n.getMonth() + 1 && d.day === n.getDate() ? 'today' : d.month === y.getMonth() + 1 && d.day === y.getDate() ? 'yesterday' : 'today';
    return { type: 'journal', id: key };
  }
  if (item.kind === 'note') return { type: 'note', id: item.id };
  if (item.kind === 'record') return { type: 'record', id: p.id, file: p.file, rtype: p.rtype };
  if (item.kind === 'task') { const h = ctx.byMid.get(item.id); return h ? { type: 'task', id: h.t.key } : { type: 'tasks' }; }
  const t = ctx.tasks.find((x) => normTitle(x.title) === normTitle(p.title));
  return t ? { type: 'task', id: t.key } : { type: 'tasks' };
}

// 全部項目的顯示資料（新的在前）
export function deriveMine(list, ctx) {
  return [...list].sort((a, b) => b.createdAt - a.createdAt).map((item) => {
    const ph = phaseOf(item, ctx);
    return {
      item, id: item.id, kind: item.kind, kindLabel: KIND_LABEL[item.kind] || item.kind, icon: KIND_ICON[item.kind] || '•',
      preview: previewOf(item), phase: ph.phase, label: ph.label, chip: PHASE_LABEL[ph.phase],
      time: pad(new Date(item.createdAt).getHours()) + ':' + pad(new Date(item.createdAt).getMinutes()),
      state: item.state, jump: item.state === 'sent' ? jumpOf(item, ctx) : null,
      editable: (item.state === 'queued' || item.state === 'failed') && ['answer', 'journal', 'note', 'task', 'chat'].includes(item.kind),
    };
  });
}

export function filterMine(rows, f) {
  if (f === 'queued') return rows.filter((r) => r.phase === 'queued');
  if (f === 'waiting') return rows.filter((r) => r.phase === 'waiting' || r.phase === 'received');
  if (f === 'handled') return rows.filter((r) => r.phase === 'handled' || r.phase === 'sent');
  if (f === 'failed') return rows.filter((r) => r.phase === 'failed');
  return rows;
}
export function filterCounts(rows) {
  const out = {};
  for (const [k] of FILTERS) out[k] = filterMine(rows, k).length;
  return out;
}

// 「你寫的 N 件電腦還沒收」：排隊中＋送出中＋失敗＋已送出但電腦還沒收（waiting）
export const notReceivedCount = (rows) => rows.filter((r) => r.phase === 'queued' || r.phase === 'failed' || r.phase === 'waiting').length;
export const queuedCount = (list) => list.filter((x) => isKnownKind(x.kind) && (x.state === 'queued' || x.state === 'sending')).length;

const WD = ['日', '一', '二', '三', '四', '五', '六'];
// 依日期分組（新的在前）：今天／昨天／MM-DD（週X）
export function groupByDate(rows, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const groups = [];
  const by = new Map();
  for (const r of rows) {
    const c = new Date(r.item.createdAt);
    const key = ymdOf(r.item.createdAt);
    if (!by.has(key)) {
      const diff = Math.round((today - new Date(c.getFullYear(), c.getMonth(), c.getDate()).getTime()) / 86400000);
      const md = pad(c.getMonth() + 1) + '-' + pad(c.getDate());
      const g = { key, label: diff === 0 ? '今天 ' + md : diff === 1 ? '昨天 ' + md : md + '（週' + WD[c.getDay()] + '）', rows: [] };
      by.set(key, g); groups.push(g);
    }
    by.get(key).rows.push(r);
  }
  return groups;
}

// 該自動移除的編號：已處理超過 30 天
export function purgeIds(rows, now = Date.now()) {
  return rows.filter((r) => r.phase === 'handled' && r.item.state === 'sent' && now - (r.item.sentAt || r.item.createdAt) > HANDLED_KEEP_DAYS * 86400000).map((r) => r.id);
}

// 失敗（沒送出）的件數：首頁紅字、右上角提示共用
export const failedCount = (list) => list.filter((x) => x.state === 'failed').length;

// 待我頁篩選：這張題目卡要不要顯示。st＝cardState（open／failed／queued／sent…）。
// 「重要」「待答」除了待答的題目，也要顯示「送出失敗」的回答卡（不然預設畫面會看不到）
export function todoPass(filter, st, { backlog = false, important = false } = {}) {
  if (st === 'ghost') return filter === 'all';
  if (filter === 'important') return !backlog && (st === 'open' || st === 'failed') && important;
  if (filter === 'open') return !backlog && (st === 'open' || st === 'failed');
  return filter === 'all' || st !== 'open';
}
