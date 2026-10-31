// Live.md「對話」區：把「你的行」與底下縮排的「↳ Agent 回覆」配成一串（純函式）。
// 真實結構（Live.md 對話區）：
//   - 💬 你（18:08，在 Task.md）：…           ← 第 0 欄的 - 行＝使用者說的話（也有沒寫「💬 你」的，例如「- 我 PWA…」）
//       - ↳ 18:17 Agent：…                    ← 縮排的 ↳ 行＝Agent 回覆（可以有好幾則）
//           - 子項…                           ← 再縮排的行＝上一則回覆的細項（v2 會整段丟掉）
// 時間：使用者的括號裡可能是「HH:MM」「MM-DD HH:MM」「HH:MM～HH:MM」「HH:MM，在 Task.md」；Agent 只有 HH:MM。
// 排序：沒有日期的視為「今天」，所以同一天的對話照時間排；有 MM-DD 的照該日期。沒有任何時間的串沿用前一串的位置。
const toLines = (t) => String(t).replace(/\r/g, '').split('\n');
const indentOf = (l) => l.length - l.trimStart().length;
const REPLY = /^\s+-\s*↳\s*(?:(\d{1,2}:\d{2})\s*)?Agent\s*[：:]\s*(.*)$/;
const TOP_REPLY = /^-\s*↳\s*(?:(\d{1,2}:\d{2})\s*)?Agent\s*[：:]\s*(.*)$/;
const YOU =/^-\s*💬\s*你\s*(?:（([^）]*)）)?\s*[：:]\s*(.*)$/;

export function parseWhen(s) {
  const m = /(?:(\d{1,2})-(\d{1,2})\s+)?(\d{1,2}):(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  return { month: m[1] ? Number(m[1]) : null, day: m[2] ? Number(m[2]) : null, minutes: Number(m[3]) * 60 + Number(m[4]), label: (m[1] ? m[1] + '-' + m[2] + ' ' : '') + m[3] + ':' + m[4] };
}

const dayKey = (w, now) => {
  const month = w.month || now.getMonth() + 1;
  const day = w.day || now.getDate();
  // 跨年：日期比今天晚超過一個月就當成去年
  let year = now.getFullYear();
  if (new Date(year, month - 1, day).getTime() - now.getTime() > 31 * 86400000) year -= 1;
  return Math.floor(new Date(year, month - 1, day).getTime() / 86400000) * 1440 + w.minutes;
};

export function parseThreads(liveText, now = new Date()) {
  const lines = toLines(liveText);
  const s = lines.findIndex((l) => /^## /.test(l) && l.includes('對話'));
  const threads = [];
  let hidden = 0;
  if (s < 0) return { threads, hidden };
  let end = lines.length;
  for (let i = s + 1; i < lines.length; i++) if (/^## /.test(lines[i])) { end = i; break; }
  let cur = null;
  let reply = null;
  let skip = false; // 「（範例）」那串連同底下的回覆一起隱藏
  for (let i = s + 1; i < end; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    if (/^- /.test(l)) {
      if (l.includes('（範例）') && !TOP_REPLY.test(l)) { skip = true; hidden++; cur = null; continue; }
      // 真實檔案裡也有沒縮排的頂層「- ↳ HH:MM Agent：…」：掛到上一串當回覆；沒有上一串就是獨立的 Agent 泡泡
      const top = TOP_REPLY.exec(l);
      if (top) {
        if (skip) { continue; }
        reply = { time: top[1] || '', text: top[2], children: [], when: parseWhen(top[1] || ''), indent: 0 };
        if (!cur) {
          cur = { role: 'you', orphan: true, time: '', note: '', text: '', extra: [], replies: [], when: null };
          threads.push(cur);
        }
        cur.replies.push(reply);
        continue;
      }
      reply = null;
      skip = false;
      const you = YOU.exec(l);
      cur = {
        role: 'you', time: '', note: '', text: you ? you[2] : l.replace(/^- /, ''), extra: [], replies: [], when: null,
      };
      if (you && you[1]) {
        cur.when = parseWhen(you[1]);
        cur.time = you[1].split(/[，,]/)[0].trim();
        cur.note = (you[1].split(/[，,]/)[1] || '').trim();
      }
      threads.push(cur);
      continue;
    }
    if (skip || !cur) continue;
    const r = REPLY.exec(l);
    if (r) {
      reply = { time: r[1] || '', text: r[2], children: [], when: parseWhen(r[1] || ''), indent: indentOf(l) };
      cur.replies.push(reply);
      continue;
    }
    // 比 ↳ 回覆縮得更深＝那則回覆的細項；跟 ↳ 同一層（或沒有回覆）＝掛在使用者那句底下的補充
    if (reply && indentOf(l) > reply.indent) reply.children.push(l);
    else cur.extra.push(l.trim());
  }
  for (const t of threads) for (const r of t.replies) {
    if (!r.children.length) continue;
    const min = Math.min(...r.children.map(indentOf));
    r.children = r.children.map((c) => c.slice(min));
  }
  // 排序鍵
  let prev = 0;
  threads.forEach((t, i) => {
    // 只有寫了 MM-DD 的才能知道是哪一天；沒寫日期的串沿用它在檔案裡前一串的位置（不要全當成今天再按時刻排）
    const w = t.when && t.when.month ? t.when : (t.replies.find((r) => r.when && r.when.month) || {}).when;
    t.key = w ? dayKey(w, now) : prev;
    prev = t.key;
    t.order = i;
  });
  threads.sort((a, b) => a.key - b.key || a.order - b.order);
  return { threads, hidden };
}

// ---------- v4 M2：過時內容（不改資料，只改顯示）----------
export const CHAT_RECENT_DAYS = 3; // 對話頁只顯示最近 3 天（今天、昨天、前天）的串

// 一串自己的日期（第一行括號裡的 MM-DD，沒有就看它的 Agent 回覆有沒有 MM-DD）；都沒寫回 null
function ownWhen(t) {
  if (!t) return null;
  if (t.when && t.when.month) return t.when;
  const r = (t.replies || []).find((x) => x.when && x.when.month);
  return r ? r.when : null;
}
function whenToDate(w, now) {
  let year = now.getFullYear();
  if (new Date(year, w.month - 1, w.day).getTime() - now.getTime() > 31 * 86400000) year -= 1;
  return new Date(year, w.month - 1, w.day);
}
export function threadDate(t, now = new Date()) {
  const w = ownWhen(t);
  return w ? whenToDate(w, now) : null;
}

// 每一串的日期：自己沒寫日期的（Agent 手寫的轉述）沿用「檔案順序中前一個有日期的串」的日期；最前面都沒有日期的才算 null（舊的）。
// 回傳 Map(串 → Date|null)。檔案順序用 t.order（parseThreads 依檔案順序編的號），沒有就用傳入順序
export function threadDates(threads, now = new Date()) {
  const byFile = [...(threads || [])].sort((a, b) => (a.order != null && b.order != null ? a.order - b.order : 0));
  const out = new Map();
  let last = null;
  for (const t of byFile) {
    const own = threadDate(t, now);
    if (own) last = own;
    out.set(t, own || last);
  }
  return out;
}

// 回傳 {recent, older}（各自保持原順序）。最前面就沒有日期的串算舊的
export function splitRecentThreads(threads, now = new Date(), days = CHAT_RECENT_DAYS) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dates = threadDates(threads, now);
  const recent = [];
  const older = [];
  for (const t of threads || []) {
    const d = dates.get(t);
    const diff = d ? Math.round((today - d.getTime()) / 86400000) : null;
    if (diff != null && diff < days) recent.push(t); else older.push(t);
  }
  return { recent, older };
}

// 系統訊息（升格請求、維持任務）：對話裡摺成一行小字。回傳顯示用的一行文字，不是系統訊息回 ''
export function systemLine(text) {
  const s = String(text || '').trim();
  let m = /^［升格專案］來源任務\s*(T\d+)「([^」]*)」/.exec(s);
  if (m) return '⬆️ 升格專案請求｜' + m[1] + ' ' + [...m[2]].slice(0, 24).join('');
  if (/^［升格專案］/.test(s)) return '⬆️ 升格專案請求';
  m = /^(T\d+)\s.*：維持任務$/.exec(s);
  if (m) return '↩️ 維持任務｜' + m[1];
  return '';
}
