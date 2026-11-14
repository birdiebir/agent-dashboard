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
//   對話：Live.md 對話區那一串有沒有 ↳ 回覆（先用手機編號 m-xxxxxxxx 找串，找不到再用內容＋時間）；P62 起再看 signal/chat_status.json（已送達／處理中／已回覆）
//   升格請求、維持任務：Task.md 該任務現在的狀態
import { TWDate as Date } from './tz.js';
import { parseReceived, parseQuestionBank, parseSupplements, parseDoingLine } from './questions.js';
import { isKnownKind } from './outbox.js';
import { parseThreads } from './chat.js';
import { findThread } from './chatstatus.js';
import { readJournal } from './journal.js';
import { normTitle, findOpenTasks } from './taskedit.js';
import { stamp, cleanText } from './edit.js';
import { previewOfRecord, recordPhase } from './records.js';
import { remoteOpenPhase } from './remoteopen.js';
import { remoteOffPhase } from './remoteoff.js';
import { parseReply, orderIntent, ORDER_TEXT } from './p72home.js';
import { xIdFor } from './hub.js';

export const HANDLED_KEEP_DAYS = 30; // 已處理超過 30 天自動移除
export const RECEIVED_STALE_DAYS = 3; // P70 mine：電腦已收到超過這麼久一律當作已收下（回答結題後不會再出現在 state.json）
export const REMOTEOPEN_STALE_HOURS = 24; // P70 mine：叫電腦開遠端的請求超過 24 小時就過期，不再算失敗／處理中
export const STALE_UNSEEN_HOURS = 36; // 送出超過這麼久、在 Task.md 與 state.json 都找不到＝已經被處理並清掉了

export const KIND_LABEL = { answer: '回答', journal: '日記', note: '筆記', task: '任務', chat: '對話', promote: '升格請求', keep: '維持任務', record: '紀錄', done: '提醒完成', reply: '提醒回覆', pushsub: '通知設定', remoteopen: '叫電腦開遠端', remoteoff: '關遠端', desk: '交給電腦' };
export const KIND_ICON = { answer: '❓', journal: '📔', note: '📝', task: '✅', chat: '💬', promote: '⬆️', keep: '↩️', record: '📚', done: '☑️', reply: '💬', pushsub: '🔔', remoteopen: '📡', remoteoff: '🔌', desk: '💻' };
export const PHASE_LABEL = { queued: '排隊中', failed: '沒送出', waiting: '等電腦', received: '電腦已收到', handled: '已處理', sent: '已送出', unknown: '不認得' };
export const FILTERS = [['all', '全部'], ['queued', '排隊中'], ['waiting', '等電腦'], ['received', '電腦已收到'], ['handled', '已處理'], ['failed', '失敗']];

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
  else if (item.kind === 'done') lines = ['完成：' + (p.title || ''), p.say ? '想跟 Agent 說：' + p.say : p.note || ''];
  else if (item.kind === 'reply') lines = ['回覆：' + (p.content || ''), p.title || ''];
  else if (item.kind === 'chat' && parseReply(p.content)) { const r = parseReply(p.content); const it = r.kind === 'order' ? orderIntent(r.text) : null; lines = [r.kind === 'ask' ? '回答提問：' + r.text : '交辦：' + (it && it !== 'problem' ? ORDER_TEXT[it] : r.text)]; } // P72：回送前綴不原樣露出
  else if (item.kind === 'record') lines = [previewOfRecord(p)];
  else if (item.kind === 'remoteopen') lines = ['叫電腦開遠端模式'];
  else if (item.kind === 'remoteoff') lines = ['叫電腦關遠端模式'];
  else if (item.kind === 'desk') lines = [p.on ? '交給電腦：開（首頁卡片由電腦接手）' : '交給電腦：關（交回手機，卡片放回首頁）'];
  else if (item.kind === 'pushsub') lines = [p.action === 'remove' ? '關閉這支手機的通知' : '開啟這支手機的通知'];
  else lines = String(p.content || '').split('\n');
  lines = lines.flatMap((l) => String(l).split('\n')).map((l) => l.trim()).filter(Boolean);
  return clip(lines.slice(0, 2).join('\n'), 200);
}

// 建 ctx：一次算好各種查表，deriveMine 對每一筆只做查詢
// 傳入 {tasks, notes}：parseTasks 的結果（含 mid）；taskText／questionsText／liveText：最新抓到的原文；state：readState 的結果或 null
export function buildMineCtx({ tasks = [], notes = [], taskText = '', questionsText = '', liveText = '', state = null, now = Date.now(), fetchedAt = 0, records = null, recFetchedAt = 0, chatStatus = null, workStatus = null, threads = null } = {}) {
  const byMid = new Map();
  for (const t of tasks) if (t.mid) byMid.set(t.mid, { kind: 'task', t });
  for (const n of notes) if (n.mid) byMid.set(n.mid, { kind: 'note', t: n });
  const bank = new Map();
  for (const q of parseQuestionBank(questionsText || '')) if (!q.listItem && !bank.has(q.qid)) bank.set(q.qid, q);
  return {
    now, fetchedAt, state, chatStatus, ws: workStatus, taskText, tasks, byMid, bank, records, recFetchedAt,
    got: parseReceived(questionsText || ''), supp: parseSupplements(questionsText || ''),
    haveQuestions: !!String(questionsText || '').trim(),
    threads: threads || parseThreads(liveText || '', new Date(now)).threads, // P74：json 模式傳進 hub 轉好的 threads，不再解析 Live.md
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

// P70 mine：回答「電腦已收到」的收尾判斷。
// 題目結了以後會從 state.json 的 questions 消失（v4 設計缺口），所以：
//   · state.json 明寫這題「已收到」（題號還在 questions）→ 一律維持 received，不套任何過期規則（QC 必修 1：不能蓋掉電腦明寫的狀態）
//   · 「已收到答案」那行有題號（got）：state 可能比收件舊，不套「不在 questions」規則；只在 state 不可用或題號不在 questions 時套 3 天保底
//   · 其他：state.json 可用、比送出時間新、題號已不在 questions → handled；state 不可用或題號不在 questions 且超過 3 天 → handled；其餘 received
function answerReceived(item, ctx, label, { allowGone = true } = {}) {
  const sent = item.sentAt || item.createdAt;
  const st = ctx.state;
  const qid = (item.payload || {}).qid;
  const usable = !!(st && Number.isFinite(st.generatedMs) && st.generatedMs - ctx.now <= 5 * 60000);
  const inState = usable && st.questions.some((x) => x.id === qid);
  if (inState) return R('received', label);
  if (allowGone && usable && st.generatedMs > sent) return R('handled', '電腦已收下（題目已不在待答）');
  if (ctx.now - sent > RECEIVED_STALE_DAYS * 86400000) return R('handled', '電腦已收下（超過 3 天）');
  return R('received', label);
}

function answerPhase(item, ctx) {
  const qid = (item.payload || {}).qid;
  const sq = ctx.state ? ctx.state.questions.filter((x) => x.id === qid && answeredOnOrAfter(x.answered, item.createdAt)) : [];
  if (sq.length) return sq.some((x) => x.status === '已處理') ? R('handled', '電腦已處理') : answerReceived(item, ctx, '電腦已收到');
  const sp = suppTaskPhase(qid, item, ctx);
  if (sp) return sp;
  // 補充還躺在「## 手機補答」區（電腦還沒轉走）：就算題號早在「已收到答案」那行，這一次的補充仍是等電腦收
  if (ctx.supp.get(qid) && !(ctx.state && sq.length)) return R('waiting', '已寫進手機補答區，等電腦收');
  if (ctx.got.has(qid)) return answerReceived(item, ctx, '電腦已收到（等 routine 套用）', { allowGone: false });
  const q = ctx.bank.get(qid);
  const still = !!((q && q.answer) || ctx.supp.get(qid));
  if (still) return R('waiting', '已寫進 Questions.md，等電腦收');
  // 答案不在了：電腦收走了。但資料必須是送出之後才抓的，不然只是還沒更新
  if (ctx.haveQuestions && ctx.fetchedAt >= item.sentAt) return answerReceived(item, ctx, '電腦已收到');
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

// P72：回答提問（↩a-）、對交辦的回覆（↩o-）用電腦端 work_status 推導「電腦收了沒」。
// 電腦端處理完會把提問（答了 24 小時、送到 10 分鐘後）和結案的交辦從清單拿掉，所以「編號已經不在清單」＝電腦處理過了：
// 前提是這份 work_status 是送出之後才產生的（比這次送出舊的檔案不能拿來說「已經沒有了」）。收件排程不寫 chat_status、
// 也不在對話區回覆，不能退回一般對話判斷（會永遠停在「等電腦看到」）。檔案比送出舊、或看不出來就回 null，退回一般判斷
function replyPhaseWs(item, ctx) {
  const r = parseReply((item.payload || {}).content);
  const w = ctx.ws;
  if (!r || !w || !(w.generatedMs >= (item.sentAt || item.createdAt || 0))) return null;
  if (r.kind === 'ask') {
    const a = (w.asks || []).find((x) => x.id === r.id);
    if (!a) return R('handled', '電腦已收下（提問已結案）');
    if (a.gotMs != null) return R('handled', '已送到' + (a.toText ? '：' + a.toText : ''));
    if (a.answered) return R('received', '電腦收到了，送往 ' + a.toText);
    return R('waiting', '等電腦收');
  }
  const it = orderIntent(r.text);
  const o = (w.orders || []).find((x) => x.id === r.id);
  if (it === 'ok') return o ? R('waiting', '等電腦記下結案') : R('handled', '已結案');
  if (it === 'no') return o ? R('waiting', '等電腦記下') : R('handled', '電腦記下了');
  if (it === 'yes') return o && o.state === 'candidate' ? R('waiting', '等電腦登記成交辦') : R('handled', '已登記成交辦');
  if (it === 'problem') {
    if (!o) return R('handled', '電腦處理過了（這件交辦已結案）');
    return o.updatedMs != null && o.updatedMs > (item.createdAt || 0) ? R('received', '電腦接手了') : null;
  }
  return null;
}

function chatPhase(item, ctx) {
  // auto 的答案不存手機；只保留成功旗標，重開後也不會誤算成等電腦收。
  if (item.payload?.mode === 'auto' && item.result?.via === 'cloud' && item.result.reason === 'cloud_answered') return R('handled', '雲端 AI 已回');
  const rp = replyPhaseWs(item, ctx);
  if (rp) return rp;
  const t = findThread(item, ctx.threads);
  const st = ctx.chatStatus && ctx.chatStatus.msgs ? ctx.chatStatus.msgs[item.id] : null;
  if ((t && t.replies.length) || (st && st.state === 'replied')) return R('handled', 'Agent 已回');
  if (st && st.state === 'processing') return R('received', '嘿嘿處理中');
  if (st && st.state === 'delivered') return R('received', '已送達電腦');
  if (t) return R('waiting', '等電腦看到');
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

const pushLabel = (item) => ((item.payload || {}).action === 'remove' ? '已取消通知' : '已登記通知');

// 提醒打勾：送出後 Task.md 那筆已經是 [x]（或被 routine 歸檔清掉）＝已處理
function donePhase(item, ctx) {
  const title = (item.payload || {}).title || '';
  if (findOpenTasks(ctx.taskText, title).matches.length) return R('waiting', '等手機重新抓到');
  // P70 D1：完成時有附話 → 打勾後還要等 Agent 回，跟提醒回覆同一套判斷（Agent 回了／提醒清掉＝handled，否則 received，3 天保底）
  if (String((item.payload || {}).say || '').trim()) return replyPhase(item, ctx);
  return R('handled', '已打勾');
}

// 子行開頭（`- 手機回覆：`／`- Agent 回覆：`，縮排幾格都算）逐行判斷；使用者打的字裡剛好有這幾個字不算（delta QC 建議 3，跟電腦端 startswith 一致）
const SUBLINE_HEAD = (label) => new RegExp('^[ \\t]*(?:[-*][ \\t]+)?' + label + '[ \\t]*[：:][ \\t]*');
function lastSubline(body, label) {
  const re = SUBLINE_HEAD(label);
  const ls = String(body || '').split('\n');
  for (let i = ls.length - 1; i >= 0; i--) if (re.test(ls[i])) return i;
  return -1;
}
const agentAfterPhone = (body) => { const ip = lastSubline(body, '手機回覆'); return ip >= 0 && lastSubline(body, 'Agent 回覆') > ip; };

// 提醒回覆：那筆提醒底下出現「Agent 回覆」＝已處理；提醒已經不在清單＝已處理
// P70 UX：提醒已打勾、但最後一則手機回覆後面沒有 Agent 回覆 → 不算處理完（電腦原本會跳過已打勾的提醒），判 received；超過 3 天跟回答同一套保底判 handled
function replyPhase(item, ctx) {
  const title = (item.payload || {}).title || '';
  const t = ctx.tasks.find((x) => normTitle(x.title) === normTitle(title));
  if (!t) return R('handled', '那件提醒已經清掉了');
  const body = t.bodyMd || '';
  if (agentAfterPhone(body)) return R('handled', 'Agent 已回'); // 最後一則手機回覆後面有 Agent 回覆才算
  if (t.checked) {
    const sent = item.sentAt || item.createdAt;
    return ctx.now - sent > RECEIVED_STALE_DAYS * 86400000 ? R('handled', '電腦已收下') : R('received', '提醒已完成，回覆等 Agent 看');
  }
  return R('waiting', '等電腦看到');
}

// P70 UX：提醒卡上的回覆回饋。ob＝outbox 清單；t＝提醒任務（key、bodyMd）。
// 回傳 null（沒有送出過的回覆）、{kind:'waiting', at}（已回覆，等 Agent）或 {kind:'agent', text}（Agent 已回：前 30 字）。不改寫入格式
export function replyNote(t, ob) {
  const sent = (ob || []).filter((x) => x.kind === 'reply' && x.state === 'sent' && x.payload && x.payload.key === t.key).sort((a, b) => (b.sentAt || b.createdAt) - (a.sentAt || a.createdAt))[0];
  if (!sent) return null;
  const body = String(t.bodyMd || '');
  const norm = (x) => String(x || '').replace(/｜/g, '/').replace(/\s+/g, ' ').trim();
  const probe = norm(sent.payload.content).slice(0, 12);
  const nb = norm(body);
  const ia = lastSubline(body, 'Agent 回覆');
  // 抓到的 Task.md 還沒含這則回覆（或根本沒有手機回覆）→ 一律當作還在等；有 Agent 回覆排在最後一則手機回覆後面才算 Agent 已回
  if (agentAfterPhone(body) && (!probe || nb.includes(probe))) {
    const line = body.split('\n')[ia].replace(/\r$/, '').replace(SUBLINE_HEAD('Agent 回覆'), '');
    return { kind: 'agent', text: [...line].slice(0, 30).join('') };
  }
  return { kind: 'waiting', at: sent.sentAt || sent.createdAt };
}

// 一筆的狀態 → {phase, label}
export function phaseOf(item, ctx) {
  if (!isKnownKind(item.kind)) return R('unknown', '這個版本不認得這種紀錄，先不處理（更新 App 後才會送）');
  const ph = phaseOfKnown(item, ctx);
  // P70 mine：叫電腦開遠端的請求超過 24 小時，失敗或處理中都已過期，不再算失敗（只改呈現，不動 outbox 的 state）
  if (item.kind === 'remoteopen' && (ph.phase === 'failed' || ph.phase === 'received') && ctx.now - item.createdAt > REMOTEOPEN_STALE_HOURS * 3600000) return R('handled', '已過期（超過 ' + REMOTEOPEN_STALE_HOURS + ' 小時）');
  // P69：關遠端同理（超過 24 小時還在等或失敗，不再算失敗／等待）
  if (item.kind === 'remoteoff' && (ph.phase === 'failed' || ph.phase === 'waiting') && ctx.now - item.createdAt > REMOTEOPEN_STALE_HOURS * 3600000) return R('handled', '已過期（超過 ' + REMOTEOPEN_STALE_HOURS + ' 小時）');
  return ph;
}

function phaseOfKnown(item, ctx) {
  if (item.state === 'failed') return R('failed', item.err || '沒送出');
  if (item.state === 'queued' || item.state === 'sending') {
    if (item.state === 'sending') return R('queued', '送出中…');
    if (item.kind === 'chat' && item.payload && item.payload.needs === 'local_login') return R('queued', '排隊中（等加密通道）');
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
    case 'pushsub': return R('sent', pushLabel(item)); // 不需要電腦處理：寫進訂閱檔就算登記完成，推播送不送由電腦端決定
    case 'remoteopen': return remoteOpenPhase(item, ctx.chatStatus, ctx.now);
    case 'remoteoff': return remoteOffPhase(item, ctx.chatStatus, ctx.now);
    case 'desk': return deskPhase(item, ctx.ws);
    case 'record': return recordPhase(item, ctx.records, ctx.recFetchedAt);
    default: return R('unknown', '這個版本不認得這種紀錄，先不處理'); // 不會走到（上面已擋掉），保險用；不能算「等電腦收」
  }
}

// 我回電腦開關（P74 o-7rpss6）：電腦端 work_status.json 的 desk.ops 有這筆的 x- 編號＝電腦收到了
function deskPhase(item, ws) {
  const ops = ws && ws.desk && Array.isArray(ws.desk.ops) ? ws.desk.ops : [];
  if (ops.includes(xIdFor(item.id))) return R('handled', '電腦收到了');
  return R('waiting', '已送出，等電腦收');
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
  if (item.kind === 'pushsub' || item.kind === 'remoteopen' || item.kind === 'remoteoff') return null;
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
  if (f === 'waiting') return rows.filter((r) => r.phase === 'waiting'); // P70 mine：不含 received（另有「電腦已收到」篩選）
  if (f === 'received') return rows.filter((r) => r.phase === 'received');
  if (f === 'handled') return rows.filter((r) => r.phase === 'handled' || r.phase === 'sent');
  if (f === 'failed') return rows.filter((r) => r.phase === 'failed');
  return rows;
}
export function filterCounts(rows) {
  const out = {};
  for (const [k] of FILTERS) out[k] = filterMine(rows, k).length;
  return out;
}

// 「你寫的 N 件電腦還沒收」：排隊中（含送出中）＋失敗＋已送出但電腦還沒收（waiting）；received、handled 不算
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
