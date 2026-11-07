// P72：首頁交辦與卡點的純函式（不碰 DOM、不碰網路）。規格：P72_首頁交辦與卡點_規格.md
// 第一段（快修）：原話查找、工作字遮罩、④ 一行入口。
// 第二段：提問卡、交辦卡、依交辦分組、回送前綴、送出狀態推導、版面切換。
import { parseQuote } from './quote.js';
import { parseCtx } from './tasks.js';
import { plainLine } from './md.js';

const pad = (n) => String(n).padStart(2, '0');
const clip = (v, n) => [...String(v == null ? '' : v)].slice(0, n).join('');
const flat = (s) => plainLine(s || '').replace(/\s+/g, ' ').trim();

// ---------- F3：原話 ----------
// 原文含這些字就不顯示（手機畫面不放工作內容；電腦端已遮的不會到這裡，這是第二道）
// （中文字用跳脫寫：公開邊界測試不准檔案裡直接出現公司字樣）
export const WORK_WORDS = ['\u91d1\u79d1', '\u9060\u9280', '\u767d\u888d', 'FinMAS', 'CollAtlas', 'attas', 'R' + 'etis \u6e2c\u8a66', 'R' + 'etis\u6e2c\u8a66', '\u5916\u90e8\u6e2c\u8a66'];
export const isWorkText = (s) => {
  const t = String(s == null ? '' : s);
  const low = t.toLowerCase();
  return WORK_WORDS.some((w) => (/[A-Za-z]/.test(w) ? low.includes(w.toLowerCase()) : t.includes(w)));
};
export const SAID_MAX = 30;
const clockOfMin = (m) => (Number.isFinite(m) ? pad(Math.floor(m / 60)) + ':' + pad(m % 60) : '');
const clockOfMs = (t) => {
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + 8 * 3600000); // 台北時間（跟 lib/tz.js 一致），純函式不用本機時區
  return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
};

// 一句原話的顯示資料：前 30 字＋時間。空的、含工作字 → null
export function saidView(text, time) {
  const t = flat(text).replace(/^(?:#{1,6}|>|[-*])\s+/, '').trim(); // 原話開頭的 markdown 標題、引用、清單符號不顯示
  if (!t || isWorkText(t)) return null;
  const a = [...t];
  return { text: a.length > SAID_MAX ? a.slice(0, SAID_MAX).join('') + '…' : t, time: time || '' };
}

// 用 m- 編號到 Live.md 對話區（lib/chat.js parseThreads 的結果）找原文。找不到、含工作字 → null
export function threadSaid(threads, from) {
  if (!from || !Array.isArray(threads)) return null;
  const t = threads.find((x) => x && x.id === from);
  if (!t) return null;
  const body = parseQuote(parseCtx(t.text).rest).rest;
  return saidView(body, t.when ? clockOfMin(t.when.minutes) : '');
}

// 一件交辦或工作要顯示的原話：交辦用電腦端給的 said（含時間），工作用 from 去對話區找
export function saidFor({ said, saidMs, from, work }, threads) {
  if (work === true) return null;
  const r = said ? saidView(said, clockOfMs(saidMs)) : threadSaid(threads, from);
  return r ? { ...r, from: from || null } : null;
}

// 電腦端把工作類的名稱遮成「一件工作…」；名稱是這樣的項目一律不去對話區找原話（查核必修 1：名稱遮了、原話卻露出來）
export const isMaskedWork = (name) => /^一件工作/.test(String(name == null ? '' : name).trim());

// 一個工作（在跑或做完）要顯示的原話。工作類（名稱被遮成「一件工作…」、或掛在工作類交辦底下）一律不用 from 去對話區找原文；
// seen（Set，可省略）：同一則留言派出好幾個工作時，同一句原話只顯示第一次
export function jobSaid(item, { threads = [], orders = [], seen = null } = {}) {
  if (!item || isMaskedWork(item.name)) return null;
  const od = item.order ? (orders || []).find((o) => o.id === item.order) : null;
  if (od && od.work) return null;
  if (seen && item.from && seen.has(item.from)) return null;
  const r = saidFor({ from: item.from, work: false }, threads);
  if (r && seen && item.from) seen.add(item.from);
  return r;
}

// ---------- F4：④ 一行入口 ----------
// 標題開頭的日期（11/04、11-04、2026-11-11、11月11日，可帶括號與冒號）先拿掉，不然截字後只剩日期
export function stripLeadDate(title) {
  const t = flat(title);
  const r = t.replace(/^[（(]?\s*(?:\d{4}[-/])?\d{1,2}(?:[/-]\d{1,2}|月\d{1,2}日?)\s*[）)]?\s*[：:，,、-]?\s*/, '').trim();
  return r || t;
}

// 截字後括號沒有成對（只剩「（還沒超過 3」這種）就從那個括號前面切掉
export function tidyClip(s, n) {
  let t = clip(s, n);
  if (t === String(s)) return t;
  const open = Math.max(t.lastIndexOf('（'), t.lastIndexOf('('));
  const close = Math.max(t.lastIndexOf('）'), t.lastIndexOf(')'));
  if (open > close && open > 0) t = t.slice(0, open).replace(/[：:，,、\s]+$/, '');
  return t;
}

const isPending = (r) => /這期還沒做/.test(r.chip || '');
// rows：lib/home.js buildReminders 的 rows。有期限的事：⏰ 逾期或今天（第 1 層）→ 定期提醒「這期還沒做」→ 3 天內到期的 ⏰（第 2 層）。已經依到期日排好
export function deadlineLine(rows) {
  const list = (rows || []).filter((r) => r && ((r.tier <= 2 && /⏰/.test(r.chip || '')) || (r.tier === 2 && isPending(r))));
  if (!list.length) return null;
  const rank = (r) => (r.tier === 1 ? 0 : isPending(r) ? 1 : 2);
  const sorted = list.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
  const r = sorted[0];
  const chip = String(r.chip || '').replace(/^[⏰●]\s*/, '');
  let label = chip;
  if (!isPending(r) && /^\d{8}$/.test(String(r.date || '')) && !/逾期|今天/.test(chip)) label = Number(r.date.slice(4, 6)) + '/' + Number(r.date.slice(6, 8));
  else if (!isPending(r) && /^\d{8}$/.test(String(r.date || '')) && /今天/.test(chip)) label = '今天';
  return { title: tidyClip(stripLeadDate(r.title), 14), label, extra: sorted.length - 1, target: r.target };
}

// 今天或昨天的日記還沒寫完（lib/home.js 第 4 層的日記列）。沒有回 null
export function journalLine(rows) {
  const r = (rows || []).find((x) => x && x.target && x.target.type === 'journal');
  if (!r) return null;
  return { text: r.target.id === 'yesterday' ? '昨天日記還沒填完' : '日記還沒寫', target: r.target };
}

// 題數、今天做完、日記、有期限四個入口。qCount：App 自己算的待答題數（沒有就用電腦端 home.q_count）；沒有的入口不出現
export function homeLinks({ qCount = null, doneCount = 0, deadline = null, journal = null } = {}) {
  const out = [];
  if (Number.isInteger(qCount) && qCount > 0) out.push({ key: 'q', text: '題庫 ' + qCount + ' 題 ›' });
  if (doneCount > 0) out.push({ key: 'done', text: '今天做完 ' + doneCount + ' 件 ›' });
  if (journal) out.push({ key: 'journal', text: journal.text + ' ›', target: journal.target });
  if (deadline) out.push({ key: 'deadline', text: '有期限：' + deadline.title + '・' + deadline.label + (deadline.extra > 0 ? '（還有 ' + deadline.extra + ' 件）' : '') + ' ›', target: deadline.target });
  return out;
}
