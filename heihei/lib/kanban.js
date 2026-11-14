// P74 第１段。輸入是既有 parser 的結果，絕不回傳原物件或工作原文。
import { askPhase, orderOverlay } from './p72home.js';

const ACCEPT_WAIT_MS = 60 * 60000;
const ORDER_TEXT_UNDO = '還有問題：還原：';
import { parseQuote } from './quote.js';
import { quotedWork, quotaLine } from './five.js';

export const COLUMNS = [
  ['doing', '在跑'], ['waiting', '等我'], ['review', '待驗收'], ['done', '剛完成'], ['todo', '等電腦'],
];
export const boardLayout = (raw) => raw === 'kanban' ? raw : null;
// 11-08 a-hbem8n（使用者選「全部照建議」）：沒選過版面、或存的值看不懂時，預設看板（手機資料被清掉也不會回到 v72）。
// v71、v72 標退場（RETIRED_LAYOUTS，到期日後刪程式）；five 是看板的底層，不刪，只從設定頁收起來。
export const LAYOUT_DEFAULT = 'kanban';
export const RETIRED_LAYOUTS = { v71: '2026-11-22', v72: '2026-11-22' };
export const resolveLayout = (raw) => boardLayout(raw) || (raw === 'v71' || raw === 'v72' || raw === 'five' ? raw : LAYOUT_DEFAULT);
// 等電腦＝只放「要他本人回電腦旁才能完成」的交辦（使用者 11-07 m-wgw1mhv9：剛收到、等別人、我猜是交辦混在一起很亂）。
// 電腦端在交辦備註開頭寫【回電腦】，後面三段用「｜」分開：要你做：…｜為什麼：…｜約 N 分鐘（沒寫標籤的依序當這三段）。
// 沒標記的「收到／我猜是交辦／等別人」放在「在跑」欄底下收合的「排隊中」。
export const PC_MARK = '【回電腦】';
export const stripPcMark = (note) => String(note || '').replace(/^\s*【回電腦】\s*/, '');
export function pcNeed(note) {
  const s = String(note || '').trim();
  if (!s.startsWith(PC_MARK)) return null;
  const out = { what: '', why: '', eta: '' };
  const loose = [];
  for (const raw of stripPcMark(s).split(/｜|\n/)) {
    const part = raw.trim();
    if (!part) continue;
    let m;
    if ((m = /^(?:要你做|你要做|要做)[^：:]{0,4}[：:]\s*(.+)$/.exec(part))) out.what ||= m[1];
    else if ((m = /^(?:為什麼|原因)[^：:]{0,8}[：:]\s*(.+)$/.exec(part))) out.why ||= m[1];
    else if ((m = /^(?:預估|預計|需要|要花)[^：:]{0,4}[：:]\s*(.+)$/.exec(part))) out.eta ||= m[1];
    else if (/^(?:約|大約|大概)\s*\d/.test(part) && !out.eta) out.eta = part;
    else loose.push(part);
  }
  for (const k of ['what', 'why', 'eta']) if (!out[k] && loose.length) out[k] = loose.shift();
  if (loose.length) out.what = [out.what, ...loose].filter(Boolean).join('；');
  return out.what || out.why || out.eta ? out : null;
}
const PC_STATES = new Set(['received', 'candidate', 'doing', 'waiting_other']);
// 在跑只放真的在跑的（使用者 11-07 m-acjp0g8a）：超過 2 小時沒有進度更新、也不在預計時間內的，降到「擱著」。
export const RUN_STALE_MS = 2 * 3600000;
// 11-09 m-tzhrb4fr：交辦標「進行中」但底下沒有工作在跑，超過 1 小時沒更新就不算在跑（跟電腦端 silent_min 一樣）
export const ORDER_QUIET_MS = 3600000;
const etaWord = (job) => (job.etaSrc === 'history' ? '（同類 ' + job.etaN + ' 件的中位數）' : job.etaSrc === 'calibrated' ? '（照同類 ' + job.etaN + ' 件校正）' : '');
// 在跑卡的核心是進度條（m-acjp0g8a、m-0vvnthde）：有步數畫「第 X／Y 步」；沒步數用「已跑多久／預計還剩多久」；兩個都沒有也要有條（不留白）
export function runInfo(job, now) {
  const steps = Number.isFinite(job.steps) && job.steps > 0 ? job.steps : null;
  const step = steps != null && Number.isFinite(job.step) ? Math.max(0, Math.min(job.step, steps)) : null;
  const text = job.stepText || (job.activity && job.activity.text) || '';
  const ran = job.startedMs != null && now ? Math.max(0, now - job.startedMs) : null;
  let mode, pct, label;
  if (steps != null) {
    mode = 'step'; pct = Math.round((step || 0) / steps * 100); label = '第 ' + (step || 0) + '／' + steps + ' 步';
  } else if (ran != null && job.etaMs != null) {
    mode = 'time'; pct = job.etaMs > job.startedMs ? Math.min(100, Math.round(ran / (job.etaMs - job.startedMs) * 100)) : 100;
    label = '已跑 ' + spanText(ran) + '｜' + (now <= job.etaMs ? '預計還剩 ' + spanText(job.etaMs - now) : '超過預計 ' + spanText(now - job.etaMs)) + etaWord(job);
  } else {
    mode = 'open'; pct = null; label = ran != null ? '已跑 ' + spanText(ran) + '（沒有預計時間）' : '在跑（沒有步數和預計時間）';
  }
  const late = steps != null && job.etaMs != null && now > job.etaMs ? '超過預計 ' + spanText(now - job.etaMs) : '';
  const quietMs = job.updatedMs != null && now ? now - job.updatedMs : null;
  return { mode, pct, label, text, step, steps, ago: quietMs != null ? agoText(quietMs) + '更新' : '', late,
    // 電腦端有給 active（11-09 起）就以電腦為準：它看得到視窗在不在忙、同類歷史估；舊電腦端照舊 2 小時規則
    stale: job.active === false ? true : job.active === true ? false : quietMs != null && quietMs > RUN_STALE_MS && !(job.etaMs != null && now <= job.etaMs), quietMs };
}
export const projectAtStart = (text) => (/^P\d+\b/.exec(String(text || '').trim()) || [''])[0];
const masked = (x) => !!x && (x.work === true || /^(?:一件工作|一件工作的交辦|一件工作在等你決定|一件背景工作)$/.test(x.name || x.title || x.q || '') || x.group === 'work');
const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const hasAnswer = (phase) => !['open', 'failed', 'pc', 'work'].includes(phase.key);
const taskColumn = { todo: 'todo', doing: 'doing', resumable: 'doing', waiting: 'waiting', review: 'review', done: 'done', cancelled: 'done', failed: 'done', promoted: 'done' };
const orderColumn = { received: 'todo', candidate: 'todo', doing: 'doing', waiting_user: 'waiting', waiting_other: 'todo', delivered: 'review' };
// 看板是用來監工（使用者 11-07 m-dlkawqs8）：只放他交辦的事。沒人回報的交辦收起來，不能假裝還在動。
const QUIET_MS = 12 * 3600000; // 交辦這麼久沒更新就收起來
const FINISHED_MS = 24 * 3600000; // 底下工作都跑完、沒人回報結案的，留這麼久
const QUIET_STATES = new Set(['received', 'candidate', 'doing', 'waiting_other']);
const TASK_CLOSED = new Set(['done', 'cancelled', 'failed', 'promoted']);
// Task.md 大多是 Agent 自己排的維護與之後才做的事，手機交辦的才算（手機補答只是抄答案）
const isHisTask = (t) => (!!t.mid || !!t.fromApp) && !/^手機補答/.test(t.title || '');

// 只保留畫面所需欄位，工作提問不保留 q／opts／ifNo／answer 等原文。
function safeAsk(a, phase, work) {
  const privateAsk = work || masked(a);
  // 工作題但電腦端帶了乾淨的選項（11-08 a-hw9nbo ②）：題目照舊遮，選項與送出狀態保留，卡上可以直接按
  const workOpts = privateAsk && a.work === true && Array.isArray(a.opts) && a.opts.length > 0;
  return {
    type: privateAsk ? 'work' : a.kind === 'pc' ? 'pc' : 'ask', key: a.id,
    ask: { id: a.id, kind: a.kind, work: privateAsk, toText: privateAsk ? '一件工作' : a.toText,
      q: privateAsk ? '一件工作' : a.q, opts: privateAsk && !workOpts ? [] : [...a.opts], def: privateAsk && !workOpts ? null : a.def,
      ifNo: privateAsk ? null : String(a.ifNo || '').replace(/^不回的話[：:]\s*/, '') || null, sinceMs: a.sinceMs },
    phase: privateAsk && !workOpts ? { key: 'work', text: '', tone: null } : { ...phase }, order: null,
  };
}

// 問答頁只放知識確認（使用者 11-07 m-sec2wtia）。題庫分類是自由文字，先用白名單；KB 開頭的題號一律算知識題
const KNOWLEDGE_CATEGORIES = new Set(['知識庫', '個人側寫', '家族與房地產']);
export const isKnowledgeQuestion = (c) => !!c && (/^KB/.test(c.qid || '') || KNOWLEDGE_CATEGORIES.has(String(c.category || '').trim()));
// 提問全文（11-08 m-3j7eyfwo「問題全文被刪節號擋住」）：超過這個字數才可能超過 4 行，先收成 4 行、量過真的有超出才出「展開全文」
export const ASK_LONG_CHARS = 56;
export const isLongAsk = (q) => String(q || '').length > ASK_LONG_CHARS;
// 獨立提問（沒有交辦、工作）的卡片標題就是問題本身：卡片上不再重複畫一次標題
export const titleRepeatsAsk = (c) => !!c && !!c.title && (c.asks || []).some((x) => x && x.ask && x.ask.q === c.title);
// 驗收卡上的決定項還有幾件沒答（還沒送出答案的；送出失敗的也算沒答）
export const pendingDecisions = (asks) => (asks || []).filter((x) => x && x.type === 'ask' && x.phase && ['open', 'failed'].includes(x.phase.key)).length;
export const KANBAN_COLUMN_MAX = 30; // 單欄最多畫幾張：真實資料「結案」有 85 張，全畫太長

// 等我＝進行中的工作卡住等他（提問、交辦 waiting_user、工作 waiting、他交辦的 Task 在等他）。題庫的題一律只在問答頁（使用者 11-07 m-pp588fvx）
export function buildBoard({ ws = null, tasks = [], projects = [], sends = new Map(), now = 0 } = {}) {
  const w = ws || {};
  const orders = w.orders || [];
  const running = (w.running || []).filter((j) => !j.kind || j.kind === 'agent');
  const dones = w.done || []; // readWorkStatus 把 done_today 正規化成 done。
  const asks = w.asks || [];
  const limbo = new Set([...(w.parked || []), ...(w.mine || []), ...(w.unknown || [])].map((j) => j.id));
  const full = w.workDetail === 'full'; // 11-08 m-bj7y3o1m：full 時不再用 Project.md 的工作專案編號把整組遮掉
  const workPids = full ? new Set() : new Set(projects.filter(masked).map((p) => p.pid).filter(Boolean));
  const privateItem = (x) => masked(x) || workPids.has(projectAtStart(x.name || x.title || x.q)) || (x.projects || []).some((p) => workPids.has(p));
  const groups = orders.map((o) => ({ order: o, jobs: [], dones: [], asks: [], tasks: [] }));
  const groupForJob = (j) => groups.find((g) => g.order.id === j.order || g.order.jobs.includes(j.id));
  const loose = [];
  for (const j of running) { const g = groupForJob(j); if (g) g.jobs.push(j); else loose.push({ jobs: [j], dones: [], asks: [], tasks: [] }); }
  for (const d of dones) { const g = groupForJob(d); if (g) g.dones.push(d); else loose.push({ jobs: [], dones: [d], asks: [], tasks: [] }); }
  groups.push(...loose);
  for (const a of asks) {
    let g = groups.find((g) => g.order && (g.order.id === a.order || g.order.id === a.to || g.order.asks.includes(a.id)));
    if (!g) g = groups.find((g) => [...g.jobs, ...g.dones].some((j) => j.id === a.to));
    if (!g) { g = { jobs: [], dones: [], asks: [], tasks: [] }; groups.push(g); }
    g.asks.push(a);
  }
  // Task／交辦去重：唯一相同手機編號優先，否則雙方唯一完全同名。
  // 不把同一 P 的不同任務合併，也不以包含、相似度或被遮罩名稱判斷。
  const eligible = tasks.filter((t) => t.tag !== 'remind');
  const unmatched = [];
  let ambiguous = 0;
  for (const t of eligible) {
    const sameMid = t.mid ? groups.filter((g) => [g.order, ...g.jobs, ...g.dones].some((x) => x && x.from === t.mid)) : [];
    const title = norm(t.title);
    const sameTitle = privateItem(t) ? [] : groups.filter((g) => [g.order, ...g.jobs, ...g.dones].some((x) => x && !privateItem(x) && norm(x.title || x.name) === title));
    const candidates = sameMid.length ? sameMid : sameTitle;
    const uniqueTask = sameMid.length ? eligible.filter((x) => x.mid === t.mid).length === 1 : eligible.filter((x) => norm(x.title) === title).length === 1;
    if (candidates.length === 1 && uniqueTask) candidates[0].tasks.push(t);
    else { if (candidates.length) ambiguous++; unmatched.push(t); }
  }
  const columns = COLUMNS.map(([key, label]) => ({ key, label, cards: [], old: [], stale: [] })); // stale：P74 M3 電腦端標閒置的交辦，欄底摺起來
  const queue = []; // 排隊中：剛收到、我猜是交辦、等別人或時間、沒開工的手機交辦（不算等電腦）
  const idle = []; // 擱著：在跑但超過 2 小時沒有進度、又過了預計時間（m-acjp0g8a）
  const windows = []; // 電腦自動登記的視窗（s-…）：在忙但沒登記工作，沒有進度可看，不佔在跑
  const all = [];
  const add = (column, card, old = false, stale = false) => {
    all.push(card);
    if (stale) { const sc = columns.find((x) => x.key === (column === 'idle' ? 'doing' : column)); if (sc) { sc.stale.push(card); return; } }
    if (column === 'todo' && !card.pc && card.candidate) { columns.find((x) => x.key === 'waiting').cards.push(card); return; } // 11-09：「是不是交辦」要你判斷 → 等我（排隊中不畫了）
    if (column === 'todo' && !card.pc) { queue.push(card); return; }
    if (column === 'idle') { idle.push(card); return; }
    if (column === 'windows') { windows.push(card); return; }
    const c = columns.find((x) => x.key === column); (old ? c.old : c.cards).push(card);
  };
  const chatAsks = [];
  for (const g of groups) {
    const o = g.order;
    const items = [o, ...g.jobs, ...g.dones, ...g.tasks, ...g.asks].filter(Boolean);
    const work = items.some(privateItem);
    const title = o ? o.title : g.jobs[0]?.name || g.dones[0]?.name || g.asks[0]?.q || '';
    const childPids = [...new Set([...g.jobs, ...g.tasks].map((x) => projectAtStart(x.name || x.title)).filter(Boolean))];
    const pid = work ? '' : projectAtStart(title) || (childPids.length === 1 ? childPids[0] : '');
    const phases = g.asks.map((a) => ({ a, phase: askPhase(a, sends.get(a.id), now) }));
    const visibleAsks = phases.filter(({ a, phase }) => !a.answered && phase.key !== 'delivered');
    const askCards = visibleAsks.map(({ a, phase }) => safeAsk(a, phase, work));
    const workTag = !work && items.some((x) => x && x.workTag === true);
    chatAsks.push(...askCards);
    const needsAnswer = phases.some(({ a, phase }) => !a.answered && !hasAnswer(phase));
    let column = o ? orderColumn[o.state] : g.jobs.length ? 'doing' : g.dones.length ? 'done' : 'waiting';
    if (needsAnswer || g.jobs.some((j) => j.waiting)) column = 'waiting';
    // 11-09 m-wvjbuzoe：在跑只放任務（job 或交辦）。只有提問、沒有交辦也沒有工作的，答完就不上看板（不放在跑）
    else if (phases.length && column === 'waiting') { if (!o && !g.jobs.length) continue; column = 'doing'; }
    // 驗收卡附決定項（11-08 x-wobdz9dn）：留在待驗收，決定項畫在驗收卡上，不拆成另一張「等我」卡
    if (o && o.state === 'delivered' && needsAnswer && !g.jobs.some((j) => j.waiting)) column = 'review';
    // 與交辦合併的 Task 若已有「待驗收」，保留真實的待驗收訊號。
    if (!needsAnswer && g.tasks.some((t) => t.state === 'review')) column = 'review';
    if (!column || (!o && !g.jobs.length && !g.dones.length && !visibleAsks.length)) continue;
    const job = g.jobs[0];
    // 【回電腦】：沒有工作在跑、沒有題目卡著、不是待驗收 → 一律放等電腦，不因為久沒更新收起來、也不當成跑完
    const pc = o && !work && !g.jobs.length && !needsAnswer && column !== 'review' && PC_STATES.has(o.state) ? pcNeed(o.note) : null;
    if (pc) column = 'todo';
    const quiet = !pc && !!o && !g.jobs.length && !needsAnswer && column !== 'review' && QUIET_STATES.has(o.state);
    const finished = quiet && o.jobs.length > 0 && !o.jobs.some((id) => limbo.has(id));
    if (finished) column = 'done';
    // 按了通過：立刻算結案，放剛完成，可還原（11-07 m-jtp3v7ts）。電腦忙時回覆常要等二十幾分鐘，所以 stuck 1 小時內不跳回去；
    // 超過 1 小時電腦還沒收、或根本沒送出的，留在待驗收照實顯示
    const ov = o && o.state === 'delivered' ? orderOverlay(o, sends.get(o.id), now) : null;
    const lastSend = ov ? sends.get(o.id).slice(-1)[0] : null;
    const accepted = !!ov && ov.intent === 'ok' && (['sent', 'sending', 'queued'].includes(ov.key)
      || (ov.key === 'stuck' && now - lastSend.createdAt <= ACCEPT_WAIT_MS));
    if (accepted) column = 'done';
    const quietFor = quiet && now && o.updatedMs != null ? now - o.updatedMs : 0;
    const old = quiet && quietFor > (finished ? FINISHED_MS : QUIET_MS);
    const lastAt = job ? job.updatedMs : o?.updatedMs;
    const said = now && lastAt != null && !g.dones.length ? agoText(now - lastAt) + '更新' : '';
    const late = job && now && job.etaMs != null && now > job.etaMs ? '超過預計 ' + agoText(now - job.etaMs).replace(/前$/, '') : '';
    const line = column === 'waiting' ? (job?.waiting && job.reason) || '停住了，等你決定' :
      job ? [job.stepText, job.startedMs != null ? '開始：' + timeText(job.startedMs) : '', job.etaMs != null ? '預計：' + timeText(job.etaMs) : '', late].filter(Boolean).join('｜') :
      o?.state === 'waiting_other' ? stripPcMark(o.note) || '等別的工作' :
      finished ? g.dones[0]?.result || stripPcMark(o.note) || '工作跑完了，還沒回報結案' :
      g.dones[0]?.result || stripPcMark(o?.note) || (o?.state === 'received' ? '收到了，還沒開始回報進度' : '');
    const sent = ov && ov.intent === 'problem' && lastSend.text.startsWith(ORDER_TEXT_UNDO) ? '已送出還原，等電腦放回待驗收' : ov && ov.intent === 'problem' ? ov.text : '';
    const sub = accepted ? (ov.key === 'stuck' ? '已結案 ✓，電腦還沒記下，忙完會補上' : '已結案 ✓，電腦記下中')
      : work || pc ? '' : sent || [line, said].filter(Boolean).join('｜');
    const key = o?.id || job?.id || g.dones[0]?.id || g.asks[0]?.id;
    const run = column === 'doing' && job && !job.waiting ? runInfo(job, now) : null;
    let target = column;
    if (run && job.auto && g.jobs.every((j) => j.auto) && !o) target = 'windows';
    else if (run && run.stale && g.jobs.every((j) => runInfo(j, now).stale)) target = 'idle';
    // 交辦標「進行中」但底下沒有工作在跑：一樣超過 2 小時沒更新就擱著（不能假裝還在動）
    const orderQuiet = !run && column === 'doing' && !g.jobs.length && !needsAnswer && o && now && o.updatedMs != null ? now - o.updatedMs : 0;
    if (orderQuiet > ORDER_QUIET_MS) target = 'idle';
    // P74 M3：電腦端說這張交辦閒置（stale）→ 欄底摺成「N 天以上沒動」。待驗收不折（App 有自己的「N 天以上沒驗收」）；
    // 有工作在跑、有題目卡著、已按結案、【回電腦】卡（要你回電腦做的事不收起來）都不折。沒有 stale 欄位（舊電腦端）＝跟以前一樣
    const foldStale = !!o && o.stale === true && o.state !== 'delivered' && !accepted && !needsAnswer && !g.jobs.length && !pc && target !== 'windows' && column !== 'review' && column !== 'done';
    const idleSub = target !== 'idle' ? '' : run ? Math.floor(run.quietMs / 3600000) + ' 小時沒更新' + (run.text && !work ? '｜停在：' + run.text : '')
      : Math.floor(orderQuiet / 3600000) + ' 小時沒更新' + (o.note && !work ? '｜' + stripPcMark(o.note) : '');
    // bornMs：這張卡什麼時候出現（交辦建立 → 工作開始 → 做完 → 提問出現），「交給電腦」用來分「交出去以前」和「之後新交辦」（lib/desk.js）
    const d0 = g.dones[0];
    const bornMs = o ? o.createdMs : job ? job.startedMs : d0 ? (d0.startedMs ?? d0.endedMs) : g.asks[0] ? g.asks[0].sinceMs : null;
    add(target, { key, type: 'task', title: work ? '一件工作' : title, work, workTag, pid, bornMs: Number.isFinite(bornMs) ? bornMs : null, sub: target === 'idle' ? idleSub : target === 'windows' ? '視窗在忙，沒有登記工作進度' : run ? '' : sub,
      ...(run && target === 'doing' ? { run: work ? { ...run, text: '' } : run } : {}),
      progress: !work && job?.steps ? Math.min(100, Math.max(0, (job.step || 0) / job.steps * 100)) : null,
      asks: askCards, taskKey: g.tasks[0]?.key || '', projectKey: '', ...(accepted ? { accepted: true, undo: true } : {}), ...(pc ? { pc } : {}), ...(foldStale ? { idleDays: o.idleDays } : {}), ...(o && o.state === 'candidate' ? { candidate: true } : {}) }, old && !pc, foldStale);
  }
  // 電腦已經結案、清單裡沒有了：24 小時內還留在剛完成，不然按完就憑空消失。舊紀錄沒有名稱的不補
  for (const [id, list] of sends) {
    const last = list[list.length - 1];
    if (!last || last.kind !== 'order' || last.intent !== 'ok' || !last.title || last.obState !== 'sent') continue;
    if (orders.some((o) => o.id === id) || now - last.createdAt > FINISHED_MS) continue;
    add('done', { key: id, type: 'task', title: last.title, work: false, pid: '', bornMs: Number.isFinite(last.createdAt) ? last.createdAt : null, sub: '已結案 ✓｜' + timeText(last.createdAt), progress: null, asks: [], taskKey: '', projectKey: '', accepted: true, undo: true });
  }
  for (const t of unmatched) {
    const column = taskColumn[t.state];
    if (!column || TASK_CLOSED.has(t.state)) continue;
    if (!isHisTask(t)) continue;
    const work = privateItem(t) || (t.projects || []).some((p) => workPids.has(p));
    add(column, { key: 'task:' + t.key, type: 'task', title: work ? '一件工作' : t.title, work,
      pid: work ? '' : projectAtStart(t.title), sub: work ? '' : t.stateLabel || '', progress: null, asks: [], taskKey: t.key, projectKey: '' });
  }
  // 帶期限的題目不進看板（m-pp588fvx）：改放問答頁最上面「有期限」，不會因為問答頁只放知識題就看不到
  // 開啟時先看在跑；真的有工作停住等他才先看等我
  const waitingCards = columns.find((c) => c.key === 'waiting').cards;
  const doingCards = columns.find((c) => c.key === 'doing').cards;
  const blocked = waitingCards.some((c) => c.asks.length || c.type === 'task');
  return { columns, queue, idle, windows, staleDays: staleOrderDays(w), initialColumn: blocked || (!doingCards.length && waitingCards.length) ? 'waiting' : 'doing', chatAsks,
    unknownCount: (w.unknown || []).filter((j) => !j.compat).length,
    diagnostics: { ambiguous, duplicates: all.length - new Set(all.map((c) => c.key)).size, withoutProject: all.filter((c) => c.type === 'task' && !c.pid).length } };
}

// 首頁底下的額度表（使用者 11-07 m-g9yrfeof）。78％ 不再派新工作、80％ 全停，所以這兩條線變色
export const QUOTA_FRESH_MIN = 10; // m-cjzuwvqa：額度讀值超過 10 分鐘就標「可能已變動」（原本 60 分鐘才變淡，太鬆）
const quotaTone = (pct) => pct == null ? '' : pct >= 80 ? 'bad' : pct >= 78 ? 'warn' : '';
export function quotaTable(rows, now) {
  return rows.map(({ name, q }) => {
    const line = quotaLine(q, now, name);
    if (!line) return { name, h5: { text: '—', tone: '' }, d7: { text: '—', tone: '' }, at: '讀不到', stale: true };
    const cell = (n) => {
      const p = line.parts.find((x) => x.name === n);
      return !p ? { text: '—', tone: '' } : p.reset ? { text: '已重置', tone: '' } : { text: p.pct + '%', tone: quotaTone(p.pct) };
    };
    const old = line.ageMin == null || line.ageMin > QUOTA_FRESH_MIN;
    const at = line.ageMin == null ? '讀不到' : !old ? line.clock : line.ago + '，可能已變動';
    return { name, h5: cell('5 小時'), d7: cell('每週'), at, stale: old };
  });
}

function agoText(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return '剛剛';
  if (m < 60) return m + ' 分鐘前';
  if (m < 1440) return Math.floor(m / 60) + ' 小時前';
  return Math.floor(m / 1440) + ' 天前';
}
function timeText(ms) { return new Date(ms + 8 * 3600000).toISOString().slice(11, 16); }
function spanText(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return m + ' 分';
  const hh = Math.floor(m / 60), mm = m % 60;
  return hh + ' 小時' + (mm ? ' ' + mm + ' 分' : '');
}

export const WORK_QUEUE_TEXT = '工作留言要等加密通道打開才能送，現在關著。';
// 有引用卻無法查證來源的舊留言也不提供降級，以免原工作已從狀態檔消失。
export function canSendPlain(it, { modern, cloudOn, isWorkId } = {}) {
  if (!modern || cloudOn || it?.kind !== 'chat' || it.state !== 'queued' || it.payload?.needs !== 'local_login') return false;
  const text = it.payload.content || '';
  return !it.payload.quotedWork && !quotedWork(text, isWorkId) && !parseQuote(text).quote;
}

// 顯示用：保留 fenced／indented code、inline code、網址與 Markdown 連結目的地。
export function agentPunctuation(text, modern) {
  if (!modern) return text;
  const lines = String(text || '').split('\n');
  let fence = null;
  return lines.map((line) => {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) { if (!fence) fence = f[1]; else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; return line; }
    if (fence || /^(?: {4}|\t)/.test(line)) return line;
    return line.split(/(`+[^`]*`+|https?:\/\/[^\s<>]+|\]\([^)]*\))/g).map((part, i) => i % 2 ? part : part.replace(/(?<=\p{Script=Han}),(?=\p{Script=Han})/gu, '，')).join('');
  }).join('\n');
}

// P74 M3：欄底「N 天以上沒動」的天數＝電腦端 work_status.expiry.order_idle_days（沒有或 null 當 7）
export const STALE_ORDER_DAYS = 7;
export const staleOrderDays = (ws) => (ws && ws.expiry && ws.expiry.orderIdleDays) || STALE_ORDER_DAYS;
