// P74 M3「對話接得上」：送給雲端主機的信封（RLW1）多帶最近幾則對話與 ↩ 引用原文。純函式，Node 可測。
// 契約（欄位名稱、上限）在 lib/cloudsource.js 的 normCtx；這裡只負責從畫面上的對話串挑出要帶的那幾則。
//   · 有 ↩m-編號 引用：沿著引用鏈尋根；內容最多取最近 6 串
//   · 沒有引用，或引用的那串不在手機上：取同一聊天最近的
//   · 工作串（work 旗標、被遮成「一件工作」、含工作字）一律跳過，公司資料不上主機；正在送的這則自己也不算
import { parseQuote, lookupQuote, messageText } from './quote.js';
import { isWorkThread } from './hub.js';
import { CTX_MAX_MSGS, QUOTE_MAX_CHARS, normCtx } from './cloudsource.js';

const pad = (n) => String(n).padStart(2, '0');
// thread／reply 的 when（{month, day, minutes}，台北時間、沒有年）→ ISO "YYYY-MM-DDTHH:MM:00+08:00"；
// 年份取 now 的台北年，月份比現在晚就算去年（跨年）。不完整就 ''（那則不帶）
export function atOf(when, now = Date.now()) {
  if (!when || !Number.isInteger(when.month) || !Number.isInteger(when.day) || !Number.isInteger(when.minutes)) return '';
  if (when.month < 1 || when.month > 12 || when.day < 1 || when.day > 31 || when.minutes < 0 || when.minutes >= 1440) return '';
  const tw = new Date(now + 8 * 3600000);
  const year = tw.getUTCFullYear() - (when.month > tw.getUTCMonth() + 1 ? 1 : 0);
  return year + '-' + pad(when.month) + '-' + pad(when.day) + 'T' + pad(Math.floor(when.minutes / 60)) + ':' + pad(when.minutes % 60) + ':00+08:00';
}

// 一串對話攤平成訊息（舊到新）：你說的那句＋每則回覆
export function threadMessages(t, now = Date.now()) {
  const out = [];
  if (!t) return out;
  if (!t.orphan && String(t.text || '').trim()) out.push({ role: 'user', text: messageText(t, -1), at: atOf(t.when, now) });
  (t.replies || []).forEach((r, i) => out.push({ role: 'agent', text: messageText(t, i), at: atOf(r.when || t.when, now) }));
  return out.filter((m) => m.text);
}

// threads：chatThreads() 的結果（舊到新）；content：這則要送的原文（含 ↩ 前綴）；selfId：這則的 m-編號；
// skipIds：要跳過的編號（例如手機上排隊中的工作留言）。回 {ctx?, quote?, reply_to?, thread?}（已套 normCtx 的上限）
export function buildCtx(threads, content, selfId = '', skipIds = new Set(), now = Date.now()) {
  const ok = (t) => t && t.id !== selfId && !skipIds.has(t.id) && !isWorkThread(t);
  const list = (threads || []).filter(ok);
  const q = parseQuote(content).quote;
  const chain = [];
  let root = '';
  if (q && /^m-[a-z0-9]{8}$/.test(q.id || '')) {
    const seen = new Set();
    let id = q.id;
    while (id && !seen.has(id)) {
      seen.add(id);
      const t = list.find((x) => x.id === id);
      if (!t) break;
      root = t.id;
      if (chain.length < CTX_MAX_MSGS) chain.unshift(t);
      const up = parseQuote(t.text).quote;
      id = up && /^m-[a-z0-9]{8}$/.test(up.id || '') ? up.id : '';
    }
  }
  const pool = chain.length ? chain : list.slice(-CTX_MAX_MSGS);
  const msgs = pool.flatMap((t) => threadMessages(t, now)).filter((m) => m.at).slice(-CTX_MAX_MSGS);
  let quote = '';
  if (q && !q.kind) {
    const target = q.id ? (threads || []).find((x) => x.id === q.id) : null;
    if (!target || ok(target)) quote = [...lookupQuote(list, q)].slice(0, QUOTE_MAX_CHARS).join('');
  }
  const replyTo = q && /^m-[a-z0-9]{8}$/.test(q.id || '') ? q.id : '';
  return normCtx(msgs, quote, { reply_to: replyTo, thread: root || replyTo });
}
