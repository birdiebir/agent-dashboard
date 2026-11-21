// 對話頁「引用回覆」與長按選單的純函式（Node 可測）。
// 格式（寫進 Live.md 的留言內容最前面，電腦端 chat_status 認的 `- 💬 你（時間，m-編號）：內容` 行樣式不變）：
//   ↩m-xxxxxxxx｜內容            引用你自己的留言（m 編號是該留言的手機編號）
//   ↩m-xxxxxxxx@HH:MM｜內容      引用 Agent 的回覆（m 編號是該回覆所屬的留言，HH:MM 是回覆時間）
//   ↩「前20字」｜內容             被引用的訊息沒有 m 編號時的退路
// 若同時有討論對象前綴（［P12 …］），順序是：［…］ ↩…｜內容。
import { CHAT_ID_RE } from './chat.js';
import { parseCtx } from './tasks.js';
import { plainLine, BREAK_MARK } from './md.js';

const ID_SRC = String(CHAT_ID_RE.source).replace(/^\^|\$$/g, '');
// P72：↩a-編號｜（回答某個提問）、↩o-編號｜（對某件交辦的回覆）跟 m- 編號同一層
const QID_RE = new RegExp('^↩(' + ID_SRC + '|[ao]-[a-z0-9]{6})(?:@(\\d{1,2}:\\d{2}))?｜');
const QTXT_RE = /^↩「([^」]*)」｜/;
const CTX_HEAD_RE = /^(［[^］]*］\s*)/;

const flat = (s) => plainLine(s || '').replace(/\s+/g, ' ').trim();
export const cut = (s, n) => {
  const a = [...flat(s)];
  return a.length > n ? a.slice(0, n).join('') + '…' : a.join('');
};
const cutPlain = (s, n) => [...flat(s)].slice(0, n).join('');

// 拿掉內容開頭的 context 前綴與引用前綴，回傳 {head, quote, rest}
// quote：{id, at, snippet}，沒有引用就是 null。id 與 snippet 擇一有值
export function parseQuote(text) {
  const s = String(text == null ? '' : text);
  const hm = CTX_HEAD_RE.exec(s);
  const head = hm ? hm[1] : '';
  const body = s.slice(head.length);
  let m = QID_RE.exec(body);
  if (m && /^[ao]-/.test(m[1])) return { head, quote: { id: m[1], at: '', snippet: '', kind: m[1][0] === 'a' ? 'ask' : 'order' }, rest: body.slice(m[0].length) };
  if (m) return { head, quote: { id: m[1], at: m[2] || '', snippet: '' }, rest: body.slice(m[0].length) };
  m = QTXT_RE.exec(body);
  if (m) return { head, quote: { id: '', at: '', snippet: m[1] }, rest: body.slice(m[0].length) };
  return { head, quote: null, rest: body };
}

// 去掉引用前綴後的內容（保留討論對象前綴）
export function stripQuote(text) {
  const p = parseQuote(text);
  return p.head + p.rest;
}

// 複製用：去掉引用前綴；討論對象前綴也去掉（那是系統加的）
export function copyText(text) {
  return parseQuote(parseCtx(text).rest).rest.trim() || parseCtx(text).rest.trim();
}

// 一則訊息的純文字（使用者留言含補充行、Agent 回覆含細項），不含任何前綴
function threadBody(t) {
  return [parseQuote(parseCtx(t.text).rest).rest, ...(t.extra || [])].join('\n').trim();
}
function replyBody(r) {
  return [parseQuote(r.text).rest.split(BREAK_MARK).join(String.fromCharCode(10)), ...(r.children || []).map((c) => String(c).replace(/^(\s*)[-*]\s+/, '$1'))].join('\n').trim();
}

// 被引用的目標。ri：-1＝使用者那句，>=0＝第 ri 則回覆
export function quoteTarget(thread, ri) {
  const isReply = ri >= 0;
  const r = isReply ? thread.replies[ri] : null;
  const text = isReply ? r.text : thread.text;
  const time = isReply ? (r.time || '') : (thread.time || '');
  const body = cutPlain(parseQuote(parseCtx(text).rest).rest, 20);
  const id = thread.id || '';
  let prefix;
  if (id && !isReply) prefix = '↩' + id + '｜';
  else if (id && isReply && r.time) prefix = '↩' + id + '@' + r.time + '｜';
  else prefix = '↩「' + body.replace(/」/g, '』') + '」｜';
  return { prefix, label: body, time, who: isReply ? 'agent' : 'you' };
}

// 送出時把引用前綴放在內容最前面（空內容不加）
export function withQuote(ref, text) {
  const t = String(text || '').trim();
  return ref && ref.prefix && t ? ref.prefix + t : t;
}

// 在整份對話裡查被引用的原文：回傳純文字或 ''
export function lookupQuote(threads, quote) {
  if (!quote) return '';
  if (!quote.id) return quote.snippet || '';
  if (quote.kind) return ''; // 提問、交辦的標籤不在對話裡，由 quoteView 用 labels 查
  const t = (threads || []).find((x) => x.id === quote.id);
  if (!t) return '';
  if (quote.at) {
    const r = t.replies.find((x) => x.time === quote.at);
    return r ? replyBody(r) : '';
  }
  return threadBody(t);
}

// 渲染用：{head, quote:{text, found}|null, rest}。查不到原文就顯示前綴文字（found=false）
// labels（P72，可省略）：{編號: 標籤}。a-／o- 開頭的前綴畫成「回答：<問題前 20 字>」「交辦：<名稱>」，查不到標籤也不算引用失敗
export function quoteView(text, threads, labels = null) {
  const p = parseQuote(text);
  if (!p.quote) return { head: p.head, quote: null, rest: p.rest };
  if (p.quote.kind) {
    const lab = labels && typeof labels === 'object' ? labels[p.quote.id] : '';
    const ask = p.quote.kind === 'ask';
    return { head: p.head, quote: { text: (ask ? '回答：' : '交辦：') + (lab ? cut(lab, 20) : ask ? '（那個問題已結束）' : '（已結案或不在清單）'), found: true }, rest: p.rest };
  }
  const orig = lookupQuote(threads, p.quote);
  const raw = p.quote.id ? '↩' + p.quote.id + (p.quote.at ? '@' + p.quote.at : '') : '↩「' + p.quote.snippet + '」';
  return { head: p.head, quote: { text: orig ? cut(orig, 40) : raw, found: !!orig }, rest: p.rest };
}

// 選單「複製」「轉成任務」「記一筆」預設用的文字（不含前綴）。ri：-1＝使用者那句
export function messageText(thread, ri) {
  return ri >= 0 ? replyBody(thread.replies[ri]) : threadBody(thread);
}
