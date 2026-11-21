// 「要你處理」單一數字口徑（2026-11-20 問答一次到位 2.2）。純函式，不碰 DOM、不碰儲存空間。
// 底欄問答的數字、問答頁「待答」、首頁「要你處理」摘要列都從這裡拿，不再各算各的。
//   asks      決定：手機答得了、還沒送出答案的決定卡（含候選交辦「是不是」）
//   today     今日必答：還沒送出的題庫題，是今日必答、沒有期限
//   deadline  有期限：還沒送出的題庫題，有期限（不管是不是今日必答）
//   others    其他：還沒送出的題庫題，不是今日必答也沒期限（有空再答，不算進 total）
//   review    待驗收：做完等你按「通過」的交辦卡
//   total     asks + today + deadline + review＝「今天要你動手的」
//   urgent    最急的一件：有日期的期限最近 → 等最久的決定 → 今日必答 → 待驗收；沒有回 null
// 已送出（本機有送出紀錄、或題卡狀態已不是 open）的不算；手機答不了的決定卡（要到電腦按的、沒有選項的工作題）不算。
import { dueOf, hasDue } from './questions.js';

const pad = (n) => String(n).padStart(2, '0');
// 'YYYYMMDD' → 'MM-DD'
export const mmdd = (ymd) => (ymd && ymd.length === 8 ? ymd.slice(4, 6) + '-' + ymd.slice(6, 8) : '');
// 台北時間的今天 'YYYYMMDD'（不靠本機時區）
export function todayYmd(now = Date.now()) {
  const d = new Date(now + 8 * 3600000);
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate());
}
const dayNum = (ymd) => Math.round(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))) / 86400000);

// 期限離今天幾天：{ days, text, soon }。3 天內（含今天、逾期）soon＝true，給橘底標籤用
export function dueInfo(ymd, now = Date.now()) {
  if (!ymd) return null;
  const days = dayNum(ymd) - dayNum(todayYmd(now));
  const text = days < 0 ? '逾期 ' + -days + ' 天' : days === 0 ? '今天到期' : '還有 ' + days + ' 天';
  return { days, text, soon: days <= 3 };
}

// 題目短名：拿掉開頭的題號、括號補充，最多 n 字（給摘要列「最急：…」用）
export function shortTitle(t, n = 16) {
  const s = String(t == null ? '' : t).replace(/^(?:Q|KB)\d+\s*[｜|:：]?\s*/, '').replace(/\s+/g, ' ').trim();
  const a = [...s];
  return a.length > n ? a.slice(0, n - 1).join('') + '…' : s;
}

const idSet = (sent) => new Set((sent instanceof Set ? [...sent] : Array.isArray(sent) ? sent : []).map((x) => (x && typeof x === 'object' ? x.qid || x.id : x)).filter(Boolean));

// 手機答得了的決定卡：type 'ask'（有沒有選項都能自己寫）；工作題要有選項；pc／job 不算
export const askAnswerable = (a) => !!a && (a.type === 'ask' || (a.type === 'work' && !!(a.ask && a.ask.opts && a.ask.opts.length)));

export function attention({ cards = [], stateOf = () => 'open', asks = [], orders = [], sent = [], now = Date.now() } = {}) {
  const gone = idSet(sent);
  const openQ = (cards || []).filter((c) => c && !c.backlog && !c.ghost && c.source !== 'dup' && stateOf(c) === 'open' && !gone.has(c.qid));
  const deadlineQ = openQ.filter((c) => hasDue(c)).sort((a, b) => (dueOf(a) || '99999999').localeCompare(dueOf(b) || '99999999') || a.order - b.order);
  const dueIds = new Set(deadlineQ.map((c) => c.qid));
  const todayQ = openQ.filter((c) => !dueIds.has(c.qid) && c.today);
  const othersQ = openQ.filter((c) => !dueIds.has(c.qid) && !c.today);
  const askList = (asks || []).filter((x) => askAnswerable(x) && x.phase && ['open', 'failed'].includes(x.phase.key) && !gone.has(x.key || (x.ask && x.ask.id)));
  const reviewList = (orders || []).filter((o) => o && o.buttons === 'delivered' && !gone.has(o.id));
  const candList = (orders || []).filter((o) => o && o.buttons === 'candidate' && !gone.has(o.id));
  const nAsks = askList.length + candList.length;
  const out = { asks: nAsks, today: todayQ.length, deadline: deadlineQ.length, others: othersQ.length, review: reviewList.length, total: 0, urgent: null };
  out.total = out.asks + out.today + out.deadline + out.review;
  const first = deadlineQ.find((c) => dueOf(c));
  if (first) out.urgent = { kind: 'question', id: first.qid, title: shortTitle(first.title), due: mmdd(dueOf(first)), ymd: dueOf(first), info: dueInfo(dueOf(first), now) };
  else if (deadlineQ.length) out.urgent = { kind: 'question', id: deadlineQ[0].qid, title: shortTitle(deadlineQ[0].title), due: '', ymd: '', info: null };
  else if (askList.length) {
    const a = [...askList].sort((x, y) => ((x.ask && x.ask.sinceMs) ?? Infinity) - ((y.ask && y.ask.sinceMs) ?? Infinity))[0];
    out.urgent = { kind: 'ask', id: a.key || (a.ask && a.ask.id), title: shortTitle(a.ask && a.ask.q), due: '', ymd: '', info: null, where: 'waiting' };
  } else if (candList.length) out.urgent = { kind: 'order', id: candList[0].id, title: shortTitle(candList[0].title), due: '', ymd: '', info: null, where: 'waiting' };
  else if (todayQ.length) out.urgent = { kind: 'question', id: todayQ[0].qid, title: shortTitle(todayQ[0].title), due: '', ymd: '', info: null };
  else if (reviewList.length) out.urgent = { kind: 'order', id: reviewList[0].id, title: shortTitle(reviewList[0].title), due: '', ymd: '', info: null, where: 'review' };
  return out;
}

// 首頁摘要列的段落：[{key, text}]，數字是 0 的段不放。key 對應點了去哪裡（ask→等我欄、question→問答頁、review→待驗收欄）
export function attentionSegments(att) {
  const seg = [];
  if (att.asks) seg.push({ key: 'ask', text: '決定 ' + att.asks });
  if (att.today) seg.push({ key: 'today', text: '今日必答 ' + att.today });
  if (att.deadline) seg.push({ key: 'deadline', text: '有期限 ' + att.deadline });
  if (att.review) seg.push({ key: 'review', text: '待驗收 ' + att.review });
  return seg;
}

// 第二行「最急：題目・期限 MM-DD ›」
export function urgentLine(att) {
  const u = att && att.urgent;
  if (!u) return '';
  return '最急：' + u.title + (u.due ? '・期限 ' + u.due : '') + ' ›';
}
