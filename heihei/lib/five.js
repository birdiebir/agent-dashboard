// P74 R1／R2：手機 App 五欄版（首頁、底欄、嘿嘿快捷鍵）的純函式。不碰 DOM、不碰儲存空間。
// 開關在設定頁的「首頁版面」（agent.homelayout 設成 'five'），預設關；也可以用網址 ?layout=five 臨時開（不寫進儲存空間）。
// 規格：docs/專案紀錄/P74_R1R3_規格.md（電腦端那份在 D:\Personal\Agent）。畫面在 app.js，這裡只決定「畫什麼」。
import { detailView, clockText } from './workstatus.js';
import { askBoard, orderBoard } from './p72home.js';
import { saidFor } from './p72.js';
import { approxAgo } from './quota.js';
import { parseQuote } from './quote.js';
import { editPayload, isKnownKind } from './outbox.js';

// ---------- 底欄 ----------
export const OLD_TABS = ['home', 'record', 'chat', 'todo', 'tasks']; // 現在的底欄（開關關著）
export const FIVE_TABS = ['home', 'record', 'chat', 'todo', 'notices']; // 五欄版：首頁、紀錄、嘿嘿、問答、通知
export const mainTabsFor = (five) => (five === true ? FIVE_TABS : OLD_TABS);
export const isFiveLayout = (raw) => raw === 'five';

// 底欄數字：0 不顯示，超過 99 顯示 99+
export function badgeText(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  return n > 99 ? '99+' : String(Math.floor(n));
}

// ---------- 嘿嘿輸入框上方的快捷鍵 ----------
export const DEFAULT_CHIPS = ['今日進度', '下班 Routine', '資產月報'];
export const CHIP_MAX = 12; // 使用者自己設的每顆最多幾字（預設的「下班 Routine」有 10 字）
export const CHIP_COUNT = 3;
export const CHIPS_KEY = 'agent.quickchips';
const clip = (v, n) => [...String(v)].slice(0, n).join('');
const cleanChips = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string').map((x) => clip(x.trim(), CHIP_MAX)).filter(Boolean).slice(0, CHIP_COUNT) : []);
// 存的文字 → 清單；沒存、壞掉、空清單都退回預設
export function loadChips(raw) {
  if (raw == null || raw === '') return DEFAULT_CHIPS.slice();
  let a;
  try { a = JSON.parse(raw); } catch (e) { return DEFAULT_CHIPS.slice(); }
  const out = cleanChips(a);
  return out.length ? out : DEFAULT_CHIPS.slice();
}
// 設定頁存檔用：整理後的 JSON 文字；全空＝回預設（回 null，呼叫端把儲存刪掉）
export function saveChips(list) {
  const out = cleanChips(list);
  return out.length ? JSON.stringify(out) : null;
}
// 點快捷鍵：填進輸入框（不送出）。輸入框有字就接在後面
export function applyChip(cur, text) {
  const c = String(cur == null ? '' : cur);
  if (!c.trim()) return text;
  return c + (/\s$/.test(c) ? '' : ' ') + text;
}

// ---------- 首頁 ----------
export const WANT_MAX = 2; // 要你：最多幾張
export const RUN_MAX_FIVE = 3; // 在跑：最多幾列
export const DONE_ROWS = 2; // 剛做完：幾列（前兩格件數少時補到 3）

// 經過時間：「8 分」「1 小時 5 分」「2 小時」；不是數字回空字串
export function durText(ms) {
  if (!Number.isFinite(ms)) return '';
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 1) return '剛開始';
  if (m < 60) return m + ' 分';
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return hh + ' 小時' + (mm ? ' ' + mm + ' 分' : '');
}

// 在跑的一列。entry＝{item, view}（detailView 的項目）
export function runRow(item, view, now) {
  const quiet = item.lastMs != null ? Math.max(0, Math.floor((now - item.lastMs) / 60000)) : null;
  const act = item.activity;
  const nowText = act && act.text ? '現在：' + act.text + (act.atMs != null ? '　' + clockText(act.atMs) : '') : quiet != null ? quiet + ' 分前更新' : '';
  if (item.auto) { // 電腦自動登記的前景視窗：只說「現在在忙」，沒有開始時間、預計、詳情，不算卡住
    return { id: item.id, name: item.name, who: '', item, auto: true, elapsed: '', etaText: '', nowText: '現在在忙', orange: false, view };
  }
  return {
    id: item.id, name: item.name, who: item.who || '', item,
    elapsed: item.startedMs != null ? durText(now - item.startedMs) : '',
    etaText: item.etaMs != null ? '預計 ' + clockText(item.etaMs) : '',
    nowText,
    orange: !!item.stuck || (view && (view.kind === 'late' || view.kind === 'silent')),
    view,
  };
}

const wantPhaseRank = (c) => (['queued', 'sending', 'sent', 'received', 'failed', 'stuck'].includes(c.phase.key) ? 0 : c.phase.key === 'pc' || c.phase.key === 'work' ? 2 : 1);

// 首頁整個模型。w＝readWorkStatus 的結果（orders、asks、parked… 可以是 null）。
// opts：{now, sends, threads, jobWaits, projectCount, dueRows, wantMore, runMore}
export function fiveHome(w, opts = {}) {
  const now = opts.now;
  const sends = opts.sends || new Map();
  // 要你：卡住提問（未答的）＋待驗收交辦。剛按下去、還在送的排最前面當回饋；其餘照「擋住幾件→等多久」
  const board = askBoard(w, { now, sends, jobWaits: opts.jobWaits || [], more: true, max: Infinity });
  const ob = orderBoard((w && w.orders) || [], { now, sends, threads: opts.threads || [], more: true, max: Infinity, reviewMore: true, reviewMax: Infinity });
  const list = [];
  for (const c of board.cards) {
    if (c.phase.key === 'delivered') continue; // 已送到的不佔位
    const block = c.order && c.order.jobs.length ? c.order.jobs.length : 1;
    list.push({ type: 'ask', card: c, rank: wantPhaseRank(c), block, since: c.sinceMs != null ? c.sinceMs : Infinity });
  }
  for (const c of ob.review) list.push({ type: 'order', card: c, rank: c.overlay ? 0 : 1, block: 0, since: c.order.updatedMs != null ? c.order.updatedMs : Infinity });
  list.sort((a, b) => a.rank - b.rank || b.block - a.block || a.since - b.since);
  const wantShown = opts.wantMore ? list : list.slice(0, WANT_MAX);
  const wants = { total: list.length, shown: wantShown.map(({ type, card, block, rank }) => ({ type, card, block, rank })), hidden: list.length - wantShown.length };

  // 在跑：只列真的在跑的（等人的不算、排程與你自己的待辦電腦端已分開；萬一還在裡面也不列）
  const entries = w ? detailView(w, { now }).items.filter((x) => !x.item.waiting && (x.item.kind == null || x.item.kind === 'agent')) : [];
  const rows = entries.map((e) => runRow(e.item, e.view, now)).map((r, i) => ({ ...r, i })).sort((a, b) => Number(b.orange) - Number(a.orange) || a.i - b.i).map(({ i: _i, ...r }) => r);
  const runShown = opts.runMore ? rows : rows.slice(0, RUN_MAX_FIVE);
  const run = { total: rows.length, rows: runShown, hidden: rows.length - runShown.length };

  // 剛做完：最新的在前；前兩格件數少就補到 3 列
  const dones = ((w && w.done) || []).slice().sort((a, b) => (b.endedMs || 0) - (a.endedMs || 0));
  const doneRows = wantShown.length + runShown.length <= 3 ? 3 : DONE_ROWS;
  const done = { total: dones.length, rows: dones.slice(0, doneRows).map((d) => ({ d, time: clockText(d.endedMs), ok: d.ok })) };

  // 7 天以上沒驗收：不佔要你名額、不算待答數字，問答頁底下收合
  const stale = ob.stale;
  // 待確認：候選交辦（我猜是交辦？）＋等別人或等時間的交辦。用原始狀態判斷，你剛按「是」之後還留在這裡看回饋
  // waiting_user、doing 沒掛任何工作的也放進來（不然五欄版哪裡都看不到）；掛了工作的在「在跑」「要你」裡
  const pendCards = ob.cards.filter((c) => c.order.state === 'candidate' || c.order.state === 'waiting_other'
    || ((c.order.state === 'waiting_user' || c.order.state === 'doing') && !(c.order.jobs && c.order.jobs.length)));
  const pending = { total: pendCards.length, cards: pendCards };
  const todo = {
    asks: list.filter((x) => x.type === 'ask' && x.rank !== 0).length,
    reviews: list.filter((x) => x.type === 'order' && x.rank !== 0).length,
    candidates: pendCards.filter((c) => c.buttons === 'candidate').length,
  };
  // P74 M3：你的工作超過幾天沒動（電腦端標 stale）→ 收進「N 天以上沒動」，不佔「你的待辦」件數；沒有 stale 欄位就跟以前一樣
  const mineAll = (w && w.mine) || [];
  const mine = mineAll.filter((j) => j.stale !== true);
  const mineStale = mineAll.filter((j) => j.stale === true);
  const parked = (w && w.parked) || [];
  const schedules = (w && w.schedules) || [];
  // 未開工：原話走 saidFor（含工作字、工作類交辦一律不顯示），不能直接用 o.said
  const unstarted = ((w && w.orders) || []).filter((o) => o.state === 'received' && !o.jobs.length)
    .map((o) => ({ order: o, said: saidFor({ said: o.said, saidMs: o.saidMs, from: o.from, work: o.work }, opts.threads || []) }));
  const due = opts.dueRows || [];
  const links = [];
  const add = (key, label, n, strong) => { if (n > 0) links.push({ key, text: label + ' ' + n + ' ›', n, strong: !!strong }); };
  add('projects', '專案', opts.projectCount || 0, true);
  add('pending', '待確認', pending.total);
  add('mine', '你的待辦', mine.length);
  add('minestale', ((w && w.expiry && w.expiry.youJobIdleDays) || 3) + ' 天以上沒動的待辦', mineStale.length);
  add('parked', '擱著', parked.length);
  add('schedules', '排程', schedules.length);
  add('unstarted', '未開工', unstarted.length);
  add('due', '今天到期', due.length);
  return { wants, run, done, links, parked, schedules, unstarted, due, pending, stale, mine, mineStale, todo };
}

// 問答頁「待答 N」與底欄藍色數字：畫面上看得到的所有待答＝擋著工作的提問＋待驗收＋候選交辦＋今日必答＋其他待答。
// todo＝fiveHome().todo（可為 null＝沒有狀態檔）；nToday、nOthers＝Questions.md 的題數
export const todoOpenCount = (todo, nToday, nOthers) => {
  const t = todo || { asks: 0, reviews: 0, candidates: 0 };
  return (t.asks || 0) + (t.reviews || 0) + (t.candidates || 0) + (nToday || 0) + (nOthers || 0);
};

// ---------- 嘿嘿的「工作」膠囊（只在五欄版）：工作內容只走加密留言，不走快答 ----------
export const isWorkCtx = (ctx) => !!ctx && ctx.work === true;
// pill＝使用者按的膠囊（記憶體）；工作專案追問時自動開、鎖住。開關關著一律無效
// quote＝正在引用的是工作內容（引用目標 work:true，或編號是工作的 a-／o-）：新舊版面都生效（安全優先），一律視為工作、鎖定
export function workChatState({ five, pill, ctx, quote }) {
  const q = quote === true;
  const locked = q || (!!five && isWorkCtx(ctx));
  return { on: q || (!!five && (!!pill || locked)), locked };
}
// 工作膠囊的狀態存在手機（agent.workmode，只存 1／0，不存內容）：重開 App 還亮著，直到使用者自己關。示範模式（?demo=1）的儲存空間是記憶體，不會真的寫
export const WORKMODE_KEY = 'agent.workmode';
export const loadWorkMode = (raw) => raw === '1';
// 送出計畫。工作開著：一定深思、needs=local_login（雲端永遠不領、只給電腦）。
// 工作留言只走加密留言（Q394④）：沒有雲端憑證時 wait＝true（留在手機排隊，等雲端打開才送），不會退回 GitHub 明文
export function chatSendPlan({ five, workOn, cloudOn, hubRoute, mode, quoteWork }) {
  void hubRoute; // 工作留言不看 json 模式：一律走雲端加密，不寫 Live.md／in/
  if (quoteWork === true || (five && workOn)) return { mode: 'thinking', needs: 'local_login', wait: !cloudOn };
  return { mode: cloudOn ? mode : 'thinking', needs: undefined, wait: false };
}

// ---------- 首頁頂端的額度那行 ----------
export const QUOTA_STALE_MIN = 60; // 讀取超過 1 小時：灰字加註「過時」
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
// q：{h5, h5ResetMs, d7, d7ResetMs, readMs}（lib/pcstate.js 的 quota／quotaB 或 hub 的 quotaBFromView，同一個形狀）。
// 回傳 {label, text, stale, readText, parts}；q 不是物件或兩個數字都沒有回 null。欄位缺、時間壞掉都不會有 NaN
export function quotaLine(q, now, label) {
  if (!q || typeof q !== 'object' || Array.isArray(q)) return null;
  const parts = [];
  const mk = (name, pct, resetMs) => {
    if (!fin(pct)) return;
    const reset = fin(resetMs) && fin(now) && resetMs <= now; // 重置時間已過：那個數字是上個窗口的，不能當現在的
    parts.push({ name, reset, text: name + ' ' + (reset ? '已重置，待更新' : Math.round(pct) + '%'), pct: reset ? null : Math.round(pct) });
  };
  mk('每週', q.d7, q.d7ResetMs);
  mk('5 小時', q.h5, q.h5ResetMs);
  if (!parts.length) return null;
  const main = parts.find((x) => !x.reset) || parts[0];
  const ageMin = fin(q.readMs) && fin(now) ? Math.max(0, Math.round((now - q.readMs) / 60000)) : null;
  const stale = ageMin == null || ageMin > QUOTA_STALE_MIN;
  const body = main.reset ? '已重置，待更新' : main.pct + '%';
  return {
    label: label || '', text: (label ? label + ' ' : '') + body + (stale ? '　過時' : ''), stale,
    readText: ageMin == null ? '' : clockText(q.readMs) + ' 讀取（' + approxAgo(ageMin) + '）',
    ageMin: ageMin == null ? undefined : ageMin, clock: fin(q.readMs) ? clockText(q.readMs) : '', ago: ageMin == null ? '' : approxAgo(ageMin),
    parts,
  };
}

// ---------- 引用工作內容一定是工作留言（新舊版面都生效，安全優先） ----------
// content：留言內容（可含［專案］前綴與 ↩編號｜ 引用前綴）；isWorkId(id)：這個編號（m-／a-／o-）的目標是不是工作。查不到＝不是
export const quotedWork = (content, isWorkId) => {
  const q = parseQuote(content).quote;
  return !!(q && q.id && typeof isWorkId === 'function' && isWorkId(q.id) === true);
};
// 送出前再判斷一次（不靠畫面狀態）：排隊中的對話留言，引用目標是工作卻沒帶 needs → 補上 needs=local_login（之後 doc 才會 work:true、只走加密通道）。回傳補了幾筆
export function markWorkQuotes(list, isWorkId) {
  let n = 0;
  for (const it of list) {
    if (it.state !== 'queued' || it.kind !== 'chat' || !isKnownKind(it.kind) || !it.payload || it.payload.needs === 'local_login') continue;
    if (quotedWork(it.payload.content, isWorkId)) { editPayload(it, { needs: 'local_login' }); n++; }
  }
  return n;
}

// ---------- 底部膠囊的排隊字樣：工作留言（等加密通道）和一般留言（等送出）分開寫 ----------
// queued：排隊中總數；work：其中工作留言幾件；沒有工作留言時字樣跟原本一模一樣
export function queuedPillText({ queued, work, offline, offlineWord }) {
  const w = Math.max(0, work || 0);
  const plain = Math.max(0, queued - w);
  if (!w) return offline ? '📵 ' + queued + ' ' + offlineWord : '⏳ 已存手機 ' + queued + ' 件，等送出';
  const parts = ['🔒 等加密通道 ' + w + ' 件'];
  if (plain) parts.push(offline ? '📵 ' + plain + ' ' + offlineWord : '⏳ 等送出 ' + plain + ' 件');
  return parts.join('　');
}
export const workQueuedCount = (list) => list.filter((x) => x.state === 'queued' && x.kind === 'chat' && x.payload && x.payload.needs === 'local_login').length;
