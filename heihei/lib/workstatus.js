// P71：工作狀態檔（signal/work_status.json，電腦寫、手機只讀）的讀取與畫面推導（純函式，不碰 DOM、不碰網路）。
// 契約 version 1（規格 P71_手機狀態卡_規格.md D）；畫面規則在 F、F2。
// 畫面只拿 readWorkStatus 的結果，不知道資料從哪來（來源在 datasource.js）。
import { TWDate as Date } from './tz.js';
import { agoText } from './status.js';
import { readDesk } from './desk.js';

export const WS_VERSION = 1;
export const PC_MODES = ['remote', 'desk', 'idle'];
export const PC_OFF_MIN = 15; // 心跳超過 15 分鐘沒更新＝電腦離線

const hm = (t) => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const dhm = (t, now) => (now - t > 20 * 3600000 ? (new Date(t).getMonth() + 1) + '/' + new Date(t).getDate() + ' ' : '') + hm(t); // 審查 #11：超過 20 小時補日期
// 首頁一行：電腦現在的模式＋資料更新時間。只用心跳（heartbeat_at、generated_at 取新的）判斷離線，不用內容時間。
export function pcModeLine(w, now) {
  if (!w) return null;
  const last = Math.max(...[w.heartbeatMs, w.generatedMs].filter(Number.isFinite), -Infinity);
  if (!Number.isFinite(last)) return null;
  const data = Number.isFinite(w.generatedMs) ? '｜資料 ' + dhm(w.generatedMs, now) + ' 更新' : '';
  if (now - last > PC_OFF_MIN * 60000) return { key: 'off', text: '電腦離線（最後 ' + dhm(last, now) + '）' + data, tone: 'warn' };
  const key = w.mode || (w.remote && w.remote.on ? 'remote' : '');
  const label = { remote: '遠端中', desk: '電腦前', idle: '待命' }[key] || '開著';
  return { key: key || 'on', text: '電腦：' + label + data, tone: '' };
}
export const USABLE_MAX_HOURS = 12; // 檔案超過這麼久：整份不採用，退回 Live.md 做法
export const ALIVE_MIN = 15; // 電腦活著＝檔案 15 分鐘內有重產（電腦端內容沒變時每 8 分鐘重發，收件排程每 10 分鐘跑）
export const FRESH_MIN = 5; // ≤5 分鐘：「N 分鐘前」
export const FROZEN_MIN = 30; // >30 分鐘：所有項目一律停住、卡片頂端橘色
export const PULSE_RECENT_MIN = 20; // 最後一次消息 20 分鐘內：藍色脈動點
export const LATE_MIN = 15; // 超過預計 15 分鐘：橘點
export const SILENT_MIN = 60; // 60 分鐘沒回報：橘點
export const SHOW_ITEMS = 3; // 首頁直接列幾項

const MAX = { title: 40, said: 80, note: 300, proof: 300, ask: 200, opt: 40, /* 11-08 m-3j7eyfwo：提問全文跟電腦端 ASK_Q_MAX／ASK_OPT_MAX 一致，不再截成刪節號 */ ifNo: 80, toText: 40, name: 40, who: 20, stepText: 40, reason: 40, result: 60, nextText: 60, stateText: 60, waitTitle: 40, waitReason: 80, waitAsk: 200, activity: 40, parkReason: 40 };
const pad = (n) => String(n).padStart(2, '0');
const clip = (v, n) => [...String(v)].slice(0, n).join('');
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const ms = (v) => { if (typeof v !== 'string') return null; const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
const str = (v, n) => (typeof v === 'string' && v.trim() ? clip(v.trim(), n) : null);
const posInt = (v) => (Number.isInteger(v) && v > 0 ? v : null);
const FROM_RE = /^m-[A-Za-z0-9]{4,32}$/;
const CODE_RE = /^P\d{1,4}$/;
const QID_RE = /^(?:Q|KB)\d{1,5}$/;
const WAIT_SOURCES = ['question', 'job', 'project'];
const ORDER_RE = /^o-[a-z0-9]{6}$/;
const ASK_RE = /^[aw]-[a-z0-9]{6}$/;
const JOB_RE = /^j-[a-z0-9]{6}$/;
const ORDER_STATES = ['received', 'candidate', 'doing', 'waiting_user', 'waiting_other', 'delivered'];
const ORDER_TEXT = { received: '收到', candidate: '我猜是交辦？', doing: '進行中', waiting_user: '等你', waiting_other: '等別人或時間', delivered: '做完待你驗收' };
const DONE_KINDS = ['job', 'board'];
const STATE_KEYS = ['busy', 'stuck', 'waiting', 'idle'];
const ITEM_KINDS = ['agent', 'schedule', 'you'];
const STUCK_KINDS = ['overdue', 'silent'];
const LIVE_KINDS = ['busy', 'idle', 'waiting', 'gone'];

// P74 M3：idle_days 只收 0 以上的整數，其他一律當沒有
const idleDaysOf = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

const posDays = (v, d) => (Number.isInteger(v) && v > 0 ? v : d);
function readExpiry(e) {
  const o = isObj(e) ? e : {};
  return { orderIdleDays: posDays(o.order_idle_days, 7), youJobIdleDays: posDays(o.you_job_idle_days, 3) };
}

function readItem(o) {
  if (!isObj(o)) return null;
  const started = ms(o.started_at);
  const updated = ms(o.updated_at);
  const last = ms(o.last_activity);
  const step = Number.isInteger(o.step) && o.step >= 0 ? o.step : null;
  return {
    id: typeof o.id === 'string' ? clip(o.id, 20) : '',
    name: str(o.name, MAX.name) || '一件工作',
    who: str(o.who, MAX.who),
    startedMs: started, etaMs: ms(o.eta),
    step: posInt(o.steps) ? step : null, steps: posInt(o.steps),
    stepText: str(o.step_text, MAX.stepText),
    updatedMs: updated,
    lastMs: last != null ? last : updated != null ? updated : started,
    from: typeof o.from === 'string' && FROM_RE.test(o.from) ? o.from : null,
    waiting: o.waiting === true,
    code: typeof o.code === 'string' && CODE_RE.test(o.code) ? o.code : null,
    reason: str(o.reason, MAX.reason),
    order: typeof o.order === 'string' && ORDER_RE.test(o.order) ? o.order : null,
    // P74 R0 新欄位（舊檔沒有就是空值）：kind 工作種類、stuck 卡住種類、live 視窗狀態、activity 現在在做什麼、auto 電腦自動登記的視窗、park_reason 擱著原因
    kind: ITEM_KINDS.includes(o.kind) ? o.kind : null,
    stuck: STUCK_KINDS.includes(o.stuck) ? o.stuck : null,
    live: LIVE_KINDS.includes(o.live) ? o.live : null,
    activity: isObj(o.activity) && str(o.activity.text, MAX.activity) ? { text: str(o.activity.text, MAX.activity), atMs: ms(o.activity.at), src: str(o.activity.src, 12) } : null,
    auto: o.auto === true,
    compat: o.compat === true, // 電腦端複製進 unknown[] 給舊 App 看的（五欄版要濾掉，免得重複）
    parkReason: str(o.park_reason, MAX.parkReason),
    // P74 M3：電腦端推導的「閒置」旗標（舊檔沒有就是 false／null，行為跟以前一樣）
    stale: o.stale === true, idleDays: idleDaysOf(o.idle_days),
    // 11-09 m-tzhrb4fr：電腦端判斷「真的在跑」（舊檔沒有＝null，App 照舊用 2 小時規則）；預計時間來源（calibrated＝手填×同類校正、history＝同類中位數）
    active: o.active === true ? true : o.active === false ? false : null,
    etaSrc: ['history', 'calibrated', 'manual'].includes(o.eta_src) ? o.eta_src : null,
    etaN: posInt(o.eta_n),
  };
}

function readDone(o) {
  if (!isObj(o)) return null;
  return {
    id: typeof o.id === 'string' ? clip(o.id, 20) : '',
    name: str(o.name, MAX.name) || '一件工作',
    result: str(o.result, MAX.result),
    ok: o.ok !== false,
    endedMs: ms(o.ended_at),
    from: typeof o.from === 'string' && FROM_RE.test(o.from) ? o.from : null,
    code: typeof o.code === 'string' && CODE_RE.test(o.code) ? o.code : null,
    kind: DONE_KINDS.includes(o.kind) ? o.kind : null,
    startedMs: ms(o.started_at),
    steps: posInt(o.steps), step: posInt(o.steps) && Number.isInteger(o.step) && o.step >= 0 ? o.step : null,
    stepText: str(o.step_text, MAX.stepText),
    order: typeof o.order === 'string' && ORDER_RE.test(o.order) ? o.order : null,
  };
}

// P72：交辦（使用者說的一件事）。工作類（work）只留固定標題，原話、備註、成品一律不留
function readOrder(o) {
  if (!isObj(o) || typeof o.id !== 'string' || !ORDER_RE.test(o.id) || !ORDER_STATES.includes(o.state)) return null;
  const work = o.work === true;
  const strList = (a, re) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && re.test(x)) : []);
  return {
    id: o.id,
    title: work ? '一件工作的交辦' : str(o.title, MAX.title) || '一件交辦',
    said: work ? null : str(o.said, MAX.said),
    saidMs: work ? null : ms(o.said_at),
    from: typeof o.from === 'string' && FROM_RE.test(o.from) ? o.from : null,
    links: posInt(o.links) || 1,
    state: o.state,
    stateText: str(o.state_text, 20) || ORDER_TEXT[o.state],
    note: work ? null : str(o.note, MAX.note),
    proof: work ? null : str(o.proof, MAX.proof),
    jobs: strList(o.jobs, JOB_RE), asks: strList(o.asks, ASK_RE),
    createdMs: ms(o.created_at), updatedMs: ms(o.updated_at), work,
    workTag: !work && o.work_tag === true, // 11-08 full 模式：原本算工作的交辦，卡上加「工作」小標
    stale: o.stale === true, idleDays: idleDaysOf(o.idle_days), // P74 M3：電腦端推導的閒置旗標；舊檔沒有就是 false／null
    // 11-09 m-p0dymauc：電腦收過的手機操作編號（x-／m-）；舊檔沒有＝[]，送出狀態照舊用時間判斷
    userOps: Array.isArray(o.user_ops) ? o.user_ops.filter((x) => typeof x === 'string' && /^[xm]-[a-z0-9]{8}$/.test(x)).slice(-20) : [],
  };
}

// P72：提問（某個工作在等你一句話）。kind=pc 是視窗在等授權，手機答不了；工作類不留選項
function readAsk(o) {
  if (!isObj(o) || typeof o.id !== 'string' || !ASK_RE.test(o.id)) return null;
  const work = o.work === true;
  const kind = o.kind === 'pc' ? 'pc' : 'text';
  // 工作題（11-08 a-hw9nbo ②）：電腦端只在選項本身乾淨時才帶選項來，照收；題目照舊遮
  const opts = kind === 'pc' || !Array.isArray(o.opts) ? [] : o.opts.map((x) => str(x, MAX.opt)).filter(Boolean).slice(0, 3);
  const def = Number.isInteger(o.default) && o.default >= 0 && o.default < opts.length ? o.default : null;
  return {
    id: o.id, kind, work, to: str(o.to, 40) || '',
    toText: work ? '一個工作' : str(o.to_text, MAX.toText) || '某個視窗',
    q: work ? '一件工作在等你決定' : kind === 'pc' ? '視窗在等你按允許或選擇' : str(o.q, MAX.ask) || '在等你一句話',
    opts, def, ifNo: work ? null : str(o.if_no, MAX.ifNo),
    sinceMs: ms(o.since), byMs: ms(o.by_time),
    order: typeof o.order === 'string' && ORDER_RE.test(o.order) ? o.order : null,
    ref: typeof o.ref === 'string' && QID_RE.test(o.ref) ? o.ref : null,
    answered: o.answered === true, answer: work ? null : str(o.answer, 200), answeredMs: ms(o.answered_at), gotMs: ms(o.got_at),
    workTag: !work && o.work_tag === true,
  };
}

// 等你清單的一項（電腦端 waiting.items）：題目、專案、背景工作三種來源
function readWait(o) {
  if (!isObj(o) || !WAIT_SOURCES.includes(o.source)) return null;
  const title = str(o.title, MAX.waitTitle);
  const ask = str(o.ask, MAX.waitAsk);
  const id = typeof o.id === 'string' && o.id.trim() ? clip(o.id.trim(), 24) : '';
  if (!title || !ask || !id) return null;
  return {
    id, source: o.source, title, ask, reason: bareReason(str(o.reason, MAX.waitReason)) || str(o.reason, MAX.waitReason) || '在等你',
    sinceMs: ms(o.since),
    qid: typeof o.qid === 'string' && QID_RE.test(o.qid) ? o.qid : null,
    code: typeof o.code === 'string' && CODE_RE.test(o.code) ? o.code : null,
  };
}

// 文字 → 內部結構；壞 JSON、版本不對、必要欄位型別不對一律 null（呼叫端當沒有這個檔，退回舊路徑）。只留認得的欄位
export function readWorkStatus(text) {
  let j;
  try { j = JSON.parse(String(text)); } catch (e) { return null; }
  if (!isObj(j) || j.version !== WS_VERSION) return null;
  const gen = ms(j.generated_at);
  if (gen == null) return null;
  for (const k of ['running', 'unknown', 'done_today']) if (j[k] !== undefined && !Array.isArray(j[k])) return null;
  if (j.state !== undefined && j.state !== null && !isObj(j.state)) return null;
  const list = (a, f) => (Array.isArray(a) ? a.map(f).filter(Boolean) : []);
  const rem = isObj(j.remote) ? j.remote : {};
  const st = isObj(j.state) ? j.state : {};
  const nx = isObj(j.next) ? j.next : null;
  const wc = isObj(j.waiting) && Number.isInteger(j.waiting.count) && j.waiting.count >= 0 ? j.waiting.count : null;
  return {
    version: WS_VERSION, generatedMs: gen,
    maskWords: isObj(j.mask_words) ? { work: Array.isArray(j.mask_words.work) ? j.mask_words.work : [], test: Array.isArray(j.mask_words.test) ? j.mask_words.test : [] } : null, // a-tq57u1：第二道遮罩的字眼（只走私人 repo）
    workDetail: j.work_detail === 'full' ? 'full' : 'index', // 11-08 m-bj7y3o1m：full＝電腦端已經只遮客戶名／金額／編號／合約保密的測試專案，手機不再自己遮工作
    remote: { on: rem.on === true, untilMs: ms(rem.until) },
    state: { key: STATE_KEYS.includes(st.key) ? st.key : '', text: str(st.text, MAX.stateText) || '', sinceMs: ms(st.since) },
    running: list(j.running, readItem),
    unknown: list(j.unknown, readItem),
    // P74 R0：擱著、排程、你自己的待辦、電腦心跳。舊檔沒有 → null（五欄版容忍不存在）
    parked: Array.isArray(j.parked) ? list(j.parked, readItem) : null,
    schedules: Array.isArray(j.schedules) ? list(j.schedules, readItem) : null,
    mine: Array.isArray(j.mine) ? list(j.mine, readItem) : null,
    heartbeatMs: ms(j.heartbeat_at),
    // P74 M3：到期門檻（天）；沒有或 null（關掉、舊檔）→ 交辦 7、你的待辦 3
    expiry: readExpiry(j.expiry),
    // o-8lx1rc 第一階段（11-07）：電腦模式；舊檔沒有 → ''（呼叫端退回看 remote.on）
    mode: PC_MODES.includes(j.mode) ? j.mode : '',
    modeSinceMs: ms(j.mode_since),
    // P74 o-7rpss6（11-10）：我回電腦開關；舊檔沒有 → null（當成關）
    desk: readDesk(j.desk),
    done: list(j.done_today, readDone),
    waitingCount: wc,
    waitItems: isObj(j.waiting) && Array.isArray(j.waiting.items) ? j.waiting.items.map(readWait).filter(Boolean) : null,
    // P72：舊檔沒有這三個欄位 → null（呼叫端退回 P71 版面）
    orders: Array.isArray(j.orders) ? j.orders.map(readOrder).filter(Boolean) : null,
    asks: Array.isArray(j.asks) ? j.asks.map(readAsk).filter(Boolean) : null,
    home: isObj(j.home) ? {
      qCount: Number.isInteger(j.home.q_count) && j.home.q_count >= 0 ? j.home.q_count : null,
      qDeadline: Array.isArray(j.home.q_deadline) ? j.home.q_deadline.filter(isObj).map((d) => ({ qid: typeof d.qid === 'string' && QID_RE.test(d.qid) ? d.qid : null, title: str(d.title, 40) || '', due: str(d.due, 12) || '' })).filter((d) => d.qid && d.title).slice(0, 5) : [],
    } : null,
    next: nx && str(nx.text, MAX.nextText) ? { text: str(nx.text, MAX.nextText), atMs: ms(nx.at) } : null,
  };
}

// 原因開頭的「等你／等我／在等你」拿掉，避免「等你：等你決定…」重複
export function bareReason(r) {
  return String(r || '').replace(/^\s*(?:在)?等(?:你|我)\s*[：:，,]?\s*/, '').trim();
}

// 檔案年齡（分鐘，整數、不小於 0）
export function ageMin(w, now) {
  return Math.max(0, Math.floor((now - w.generatedMs) / 60000));
}

// 檔案可用嗎：null 或超過 12 小時 → false（退回 Live.md 做法）
export function usable(w, now) {
  if (!w) return false;
  return now - w.generatedMs <= USABLE_MAX_HOURS * 3600000;
}

// 台北時間 HH:MM
export function clockText(t) {
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

const minutes = (a, b) => Math.floor((a - b) / 60000);

// 一個進行中項目的畫面資料。ctx：{now, alive（電腦活著：檔案 15 分鐘內）, frozen（電腦 30 分鐘以上沒重產）}
// 活動狀態：pulse（藍色脈動，只有真的有消息）｜idle（靜止灰點）｜late（超過預計，橘）｜silent（久沒回報，橘）
export function itemView(it, ctx = {}) {
  const now = ctx.now;
  const alive = ctx.alive !== false;
  const frozen = ctx.frozen === true;
  const sub = [it.code, it.who, it.startedMs != null ? clockText(it.startedMs) + ' 開始' : ''].filter(Boolean).join('・');
  let progressText;
  let pct = null;
  if (it.steps) {
    progressText = it.step == null ? '共 ' + it.steps + ' 步' : '第 ' + it.step + '／' + it.steps + ' 步' + (it.stepText ? '：' + it.stepText : '');
    pct = Math.max(0, Math.min(100, Math.round(((it.step || 0) / it.steps) * 100)));
  } else {
    const done = it.startedMs != null ? Math.max(0, minutes(now, it.startedMs)) : null;
    const parts = [];
    if (done != null) parts.push('做了 ' + done + ' 分鐘');
    if (it.etaMs != null) parts.push('預計 ' + clockText(it.etaMs) + ' 做完');
    progressText = parts.join('，');
  }
  const base = { name: it.name, sub, progressText, pct, hasBar: pct != null, from: it.from, id: it.id };
  if (it.waiting) {
    return { ...base, activity: 'idle', kind: 'waiting', clickable: true, note: bareReason(it.reason) ? '等你：' + bareReason(it.reason) : '在等你' };
  }
  if (frozen) return { ...base, activity: 'idle', kind: null, clickable: false, note: '' };
  const lateMin = it.etaMs != null ? minutes(now, it.etaMs) : null;
  const quietMin = it.lastMs != null ? Math.max(0, minutes(now, it.lastMs)) : null;
  if (lateMin != null && lateMin >= LATE_MIN) return { ...base, activity: 'late', kind: 'late', clickable: true, note: '超過預計 ' + lateMin + ' 分鐘' };
  if (quietMin != null && quietMin >= SILENT_MIN) return { ...base, activity: 'silent', kind: 'silent', clickable: true, note: quietMin + ' 分鐘沒回報' };
  const recent = quietMin != null && quietMin < PULSE_RECENT_MIN;
  const etaAhead = it.etaMs != null && it.etaMs > now;
  if (alive && (recent || etaAhead)) return { ...base, activity: 'pulse', kind: null, clickable: false, note: '' };
  return { ...base, activity: 'idle', kind: null, clickable: false, note: quietMin != null && quietMin >= PULSE_RECENT_MIN ? quietMin + ' 分鐘沒新消息' : '' };
}

// 點項目帶到聊天頁輸入框的預填句（不自動送出）
export function askText(it, kind) {
  if (!it) return '現在做到哪了？';
  if (kind === 'waiting') return it.name + '在等我' + bareReason(it.reason) + '，要怎麼做？';
  if (kind === 'late' || kind === 'silent') return it.name + '超過預計時間了，現在做到哪？';
  return '現在做到哪了？';
}

const activeOf = (w) => w.running.filter((i) => !i.waiting);
const waitingOf = (w) => w.running.filter((i) => i.waiting);
function nextEta(w, now) {
  let best = null;
  for (const i of activeOf(w)) if (i.etaMs != null && i.etaMs >= now && (!best || i.etaMs < best.etaMs)) best = i;
  return best;
}

// 首頁狀態卡的上半部。opts：{now, remoteOn（App 另有訊號才傳；沒傳用檔案自己的）, pending（App 自己算的等你題數；沒傳用檔案的 waiting.count）}
export function cardView(w, opts = {}) {
  const now = opts.now;
  const age = ageMin(w, now);
  const alive = age <= ALIVE_MIN;
  const frozen = age > FROZEN_MIN;
  const level = age <= FRESH_MIN ? 'fresh' : age <= FROZEN_MIN ? 'ok' : 'old';
  const remoteOn = typeof opts.remoteOn === 'boolean' ? opts.remoteOn : w.remote.on && (w.remote.untilMs == null || w.remote.untilMs > now);
  const ictx = { now, alive, frozen };
  const active = activeOf(w);
  const views = active.map((i) => itemView(i, ictx));
  const stuckN = Math.max(views.filter((v) => v.kind === 'late' || v.kind === 'silent').length, !frozen && w.state.key === 'stuck' && active.length ? 1 : 0);
  const pending = Number.isInteger(opts.pending) && opts.pending >= 0 ? opts.pending : (w.waitingCount || 0);
  const you = Number.isInteger(opts.waitTotal) && opts.waitTotal >= 0 ? opts.waitTotal : pending + waitingOf(w).length;
  const run = active.length;
  const okDone = w.done.filter((d) => d.ok).length;
  const line2 = '背景 ' + run + ' 件在跑・今天做完 ' + okDone + ' 件・等你 ' + you + ' 件';

  let lamp;
  let headline;
  let banner = null;
  if (!remoteOn) {
    lamp = 'gray'; headline = '沒開遠端';
    if (frozen) banner = { tone: 'gray', text: '沒開遠端，這是 ' + clockText(w.generatedMs) + ' 的狀態', ask: false };
  } else if (frozen) {
    lamp = 'orange'; headline = '電腦 ' + age + ' 分鐘沒更新，可能睡著了';
    if (run + waitingOf(w).length > 0) banner = { tone: 'orange', text: '電腦 ' + age + ' 分鐘沒更新，工作可能已經做完或卡住', ask: true };
  } else if (stuckN > 0) {
    lamp = 'orange'; headline = '有 ' + stuckN + ' 件好像卡住了';
  } else if (run > 0) {
    lamp = 'blue'; headline = '正在做 ' + run + ' 件事';
  } else if (you > 0) {
    lamp = 'yellow'; headline = '有 ' + you + ' 件等你決定';
  } else {
    lamp = 'green'; headline = '沒有在做的事';
  }

  let line3 = null;
  if (!frozen) {
    if (run > 0) {
      const n = nextEta(w, now);
      if (n) line3 = '下一件預計 ' + clockText(n.etaMs) + ' 做完（' + n.name + '）';
    } else if (w.next) line3 = '下一步：' + w.next.text;
  }
  const ageLabel = level === 'fresh' ? agoText(age) : age + ' 分鐘前' + (level === 'ok' ? '的狀態' : '');
  return { lamp, headline, ageLabel, ageMin: age, level, alive, frozen, remoteOn, line2, line3, banner, counts: { run, done: okDone, you } };
}

// 動畫誠實：只有至少一項「進行中、沒在等你」真的是 pulse（電腦活著、最近有消息或預計時間還沒到）才脈動
export function anyPulse(w, now) {
  if (!w) return false;
  const age = ageMin(w, now);
  const ictx = { now, alive: age <= ALIVE_MIN, frozen: age > FROZEN_MIN };
  return activeOf(w).some((i) => itemView(i, ictx).activity === 'pulse');
}

// 聊天頁進行中列的點：pulse（有消息才動）｜late／silent（橘，靜止）｜idle（灰，靜止）
export function dotClass(w, now) {
  if (anyPulse(w, now)) return 'pulse';
  const age = ageMin(w, now);
  const ictx = { now, alive: age <= ALIVE_MIN, frozen: age > FROZEN_MIN };
  const acts = activeOf(w).map((i) => itemView(i, ictx).activity);
  if (acts.includes('late')) return 'late';
  if (acts.includes('silent')) return 'silent';
  return 'idle';
}

// 點開後的清單：全部進行中（各自的 itemView）、狀態不明、剛完成、下一步
export function detailView(w, opts = {}) {
  const now = opts.now;
  const age = ageMin(w, now);
  const ictx = { now, alive: age <= ALIVE_MIN, frozen: age > FROZEN_MIN };
  return {
    // 卡住的（超時、沒回報）排最前面，其餘維持檔案裡的順序（早到晚）
    items: w.running.map((it) => ({ item: it, view: itemView(it, ictx) })).map((x, i) => ({ ...x, i })).sort((a, b) => (a.view.kind === 'late' || a.view.kind === 'silent' ? 0 : 1) - (b.view.kind === 'late' || b.view.kind === 'silent' ? 0 : 1) || a.i - b.i).map(({ i: _i, ...x }) => x),
    unknown: w.unknown.map((it) => ({ compat: it.compat, name: it.name, sub: [it.code, it.who, it.startedMs != null ? clockText(it.startedMs) + ' 開始' : ''].filter(Boolean).join('・') })),
    done: w.done.map((d) => ({ name: d.name, sub: d.code || '', result: d.result, ok: d.ok, from: d.from, time: clockText(d.endedMs) })),
    next: w.next ? w.next.text : null,
  };
}

// 聊天頁膠囊下面的細列。沒在跑、檔案不可用回 null
export function chatRunLine(w, now) {
  if (!usable(w, now)) return null;
  const run = activeOf(w).length;
  if (!run) return null;
  const age = ageMin(w, now);
  if (age > FROZEN_MIN) return run + ' 件在跑（電腦 ' + age + ' 分鐘沒更新） ›';
  const n = nextEta(w, now);
  return run + ' 件在跑' + (n ? '・最快 ' + clockText(n.etaMs) + ' 做完' : '') + ' ›';
}

// ---------- P71 修正：每一項都能點開看詳情、「等你」清單、帶問題去聊天 ----------

// 沒有特別情境時，問聊天的預填句（等你、超時照 askText）
export function askForItem(it, kind) {
  if (!it) return '現在做到哪了？';
  if (kind === 'waiting' || kind === 'late' || kind === 'silent') return askText(it, kind);
  return it.name + '現在做到哪了？';
}

// 「等你」清單：背景工作、題目、專案。openCards＝App 自己知道的待答題 [{qid,title}]；有傳（含空陣列）就以它為準
// （答掉的不列、檔案還沒有的新題補上），沒傳（null）用檔案裡的。檔案是舊格式（沒有 items）時，工作只列進行中掛「等你」的
// opts.sources（P72 快修 F2）：只留這幾種來源（首頁傳 ['job']：題庫題與專案「等你」欄不上首頁）；沒傳＝三種都要
export function waitList(w, opts = {}) {
  const cards = Array.isArray(opts.openCards) ? opts.openCards : null;
  const items = w.waitItems;
  const want = Array.isArray(opts.sources) ? opts.sources : WAIT_SOURCES;
  const out = [];
  const fromItem = (e) => ({ key: 'w:' + e.id, source: e.source, title: e.title, reason: e.reason, ask: e.ask, qid: e.qid, code: e.code, sinceMs: e.sinceMs });
  const sub = (e) => {
    if (e.source === 'question') return (e.qid ? e.qid + '・' : '') + '題目';
    if (e.source === 'project') return (e.code ? e.code + '・' : '') + '專案';
    return '背景工作' + (e.sinceMs != null ? '・' + clockText(e.sinceMs) + ' 起' : '');
  };
  // 背景工作
  if (!want.includes('job')) { /* 不要背景工作 */ } else if (items) {
    for (const e of items.filter((x) => x.source === 'job')) out.push(fromItem(e));
  } else {
    for (const it of waitingOf(w)) {
      out.push({ key: 'w:' + (it.id || it.name), source: 'job', title: it.name, reason: bareReason(it.reason) || '在等你', ask: askText(it, 'waiting'), qid: null, code: it.code, sinceMs: it.updatedMs });
    }
  }
  // 題目
  const fileQ = items && want.includes('question') ? items.filter((x) => x.source === 'question') : [];
  if (!want.includes('question')) { /* 不要題目 */ } else if (cards) {
    for (const c of cards) {
      if (!c || !QID_RE.test(String(c.qid))) continue;
      const f = fileQ.find((x) => x.qid === c.qid);
      if (f) { out.push(fromItem(f)); continue; }
      const title = clip(String(c.title || c.qid).trim() || c.qid, MAX.waitTitle);
      out.push({ key: 'w:q-' + c.qid, source: 'question', title, reason: '要你回答這一題', ask: '關於「' + title + '」這題，我想先問…', qid: c.qid, code: null, sinceMs: null });
    }
  } else {
    for (const f of fileQ) out.push(fromItem(f));
  }
  // 專案
  if (items && want.includes('project')) for (const e of items.filter((x) => x.source === 'project')) out.push(fromItem(e));
  const seen = new Set();
  return out.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true))).map((e) => ({ ...e, sub: sub(e) }));
}

const clockAgo = (t, now) => (Number.isFinite(t) ? clockText(t) + '（' + Math.max(0, minutes(now, t)) + ' 分鐘前）' : '');
const rowsOf = (pairs) => pairs.filter(([, v]) => v).map(([label, value]) => ({ label, value }));

// 進行中項目的詳情列與預填句。view＝itemView 的結果
export function runDetail(it, view, now) {
  const status = it.waiting ? '在等你' : view.note || (view.activity === 'pulse' ? '進行中，剛有新消息' : '進行中');
  const rows = rowsOf([
    ['在做什麼', it.name],
    ['做到哪', view.progressText],
    ['誰在做', it.who],
    ['專案', it.code],
    ['開始', it.startedMs != null ? clockText(it.startedMs) : ''],
    ['最後消息', clockAgo(it.lastMs, now)],
    ['預計完成', it.etaMs != null ? clockText(it.etaMs) : ''],
    ['等你什麼', it.waiting ? bareReason(it.reason) || '沒有寫原因' : ''],
    ['目前狀況', status],
  ]);
  return { rows, ask: askForItem(it, view.kind) };
}

// o-6dnuav（11-12）：聊天頁「N 件在跑」點開後的一列。只放資料裡真的有的欄位（沒有就不顯示，不猜）。
// 工作類（電腦端已把名稱遮成「一件工作…」）只留固定名稱、已跑多久、預計完成與狀態：不給誰在做、步驟說明、原話連結。
const isWorkName = (name) => /^一件工作/.test(String(name == null ? '' : name).trim());
export function runSpanText(min) {
  if (!Number.isFinite(min) || min < 0) return '';
  if (min < 60) return min + ' 分鐘';
  const hh = Math.floor(min / 60), mm = min % 60;
  return hh + ' 小時' + (mm ? ' ' + mm + ' 分' : '');
}
export function runPanelRow(it, view, now) {
  const work = isWorkName(it.name);
  const ran = it.startedMs != null && it.startedMs <= now ? '已跑 ' + runSpanText(minutes(now, it.startedMs)) : '';
  const eta = it.etaMs != null ? '預計 ' + clockText(it.etaMs) + ' 做完' : '';
  const meta = [work ? '' : it.who, ran, eta].filter(Boolean).join('・');
  const step = !work && it.steps ? (it.step == null ? '共 ' + it.steps + ' 步' : '第 ' + it.step + '／' + it.steps + ' 步' + (it.stepText ? '：' + it.stepText : '')) : '';
  const note = view.note || (view.activity === 'pulse' ? '進行中' : '');
  return { work, name: work ? '一件工作' : it.name, meta, step, note, tone: view.activity, from: work ? null : it.from };
}

// 今天做完（或沒做完）項目的詳情
export function doneDetail(d, now) {
  void now;
  const result = d.ok ? (d.result ? '做完了：' + d.result : '做完了（沒有另外留下說明）') : '沒做完：' + (d.result || '沒有寫原因');
  const rows = rowsOf([
    ['結果', result],
    ['最後一步', d.stepText],
    ['步驟', d.steps ? '共 ' + d.steps + ' 步，做到第 ' + (d.step || 0) + ' 步' : ''],
    ['專案', d.code],
    ['開始', d.startedMs != null ? clockText(d.startedMs) : ''],
    ['完成', d.endedMs != null ? clockText(d.endedMs) : ''],
    ['來源', d.kind === 'board' ? '專案看板回報完成（沒有更細的步驟紀錄）' : ''],
  ]);
  return { rows, ask: '關於「' + d.name + '」這件事，我想先問…' };
}

// 等你項目的詳情；qid 有值就多一個「去回答」
export function waitDetail(e, now) {
  void now;
  const from = e.source === 'question' ? '待答題目' + (e.qid ? ' ' + e.qid : '') : e.source === 'project' ? '專案' + (e.code ? ' ' + e.code : '') : '背景工作';
  const rows = rowsOf([
    ['在等什麼', e.reason],
    ['來源', from],
    ['開始等', e.sinceMs != null ? clockText(e.sinceMs) : ''],
  ]);
  return { rows, ask: e.ask, qid: e.qid || null };
}

// 推播帶來的工作編號 → 首頁卡上要打開哪一區、展開哪一列。找不到（檔案還沒更新、編號不對）回 null
export function jobTarget(w, id) {
  if (!w || typeof id !== 'string' || !/^[jb]-[a-z0-9]{6}$/.test(id)) return null; // j-＝工作、b-＝板上完成
  const r = w.running.find((i) => i.id === id);
  if (r) return r.waiting ? { sec: 'wait', key: 'w:' + id } : { sec: 'run', key: 'r:' + id };
  if (w.done.some((d) => d.id === id)) return { sec: 'done', key: 'd:' + id };
  return null;
}
