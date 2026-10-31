// 解析 Live.md / Questions.md / Task.md（純函式，不碰 DOM）
import { parseReadTime } from './quota.js';

export function findSection(lines, keyword) {
  const start = lines.findIndex((l) => /^## /.test(l) && l.includes(keyword));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

const toLines = (t) => String(t).replace(/\r/g, '').split('\n');

function sectionOf(lines, keyword) {
  const s = findSection(lines, keyword);
  if (!s) return null;
  return { title: lines[s.start].replace(/^##\s+/, '').trim(), body: lines.slice(s.start + 1, s.end) };
}

// 從 start 位置的括號開始，找對應的右括號（支援巢狀、全形半形）
function balanced(str, start) {
  const open = '（(', close = '）)';
  let depth = 0;
  for (let i = start; i < str.length; i++) {
    if (open.includes(str[i])) depth++;
    else if (close.includes(str[i])) {
      depth--;
      if (depth === 0) return str.slice(start + 1, i);
    }
  }
  return null;
}

export function parseQuota(text) {
  const lines = toLines(text);
  const a = lines.findIndex((l) => l.includes('<!-- 額度 -->'));
  const b = lines.findIndex((l) => l.includes('<!-- /額度 -->'));
  const res = { five: null, weekly: null, readAt: null };
  if (a < 0 || b < 0 || b < a) return res;
  for (const l of lines.slice(a + 1, b)) {
    const m = /\*\*(5 小時|weekly)\*\*\s*[：:]\s*(\d+(?:\.\d+)?)\s*%/i.exec(l);
    if (m) {
      const rest = l.slice(m.index + m[0].length);
      const p = rest.search(/[（(]/);
      const note = p >= 0 && rest.slice(0, p).trim() === '' ? balanced(rest, p) : null;
      const key = m[1].toLowerCase() === 'weekly' ? 'weekly' : 'five';
      res[key] = { pct: Number(m[2]), note: note || '' };
    }
    const r = /數字讀取時間\s*(.*)$/.exec(l);
    const rt = r ? parseReadTime(r[1]) : null; // 新舊兩種格式共用 quota.js 的解析
    if (rt) { res.readAt = rt.time; res.readDate = rt.month ? { month: rt.month, day: rt.day } : null; }
  }
  return res;
}

export function parseUpdated(text) {
  const lines = toLines(text);
  const first = lines.findIndex((l) => l.startsWith('>'));
  if (first < 0) return null;
  const block = [];
  for (let i = first; i < lines.length && lines[i].startsWith('>'); i++) block.push(lines[i]);
  const m = /最後更新\s*(\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{2})/.exec(block.join('\n'));
  return m ? { date: m[1], time: m[2] } : null;
}

export function parseWaiting(text) {
  const sec = sectionOf(toLines(text), '等你');
  if (!sec) return [];
  const groups = [];
  let cur = null;
  for (const l of sec.body) {
    const h = /^###\s+(.*)$/.exec(l);
    if (h) {
      const title = h[1].trim();
      const kind = title.includes('⏰') ? 'deadline' : title.includes('🔴') ? 'red' : title.includes('🟡') ? 'yellow' : 'other';
      cur = { title, kind, items: [] };
      groups.push(cur);
      continue;
    }
    const it = /^- (✅\s*)?\*\*(Q\d+[^*]*)\*\*\s*(.*)$/.exec(l); // 「- ✅ **Q161②** …」是已處理的項目
    if (it) {
      if (!cur) { cur = { title: '', kind: 'other', items: [] }; groups.push(cur); }
      const qm = /^(Q\d+)\s*(.*)$/.exec(it[2].trim());
      // lines：縮排子行原樣保留（解析選項用）；text 維持舊行為（子行用空白串在後面）；done：✅ 開頭（行首或內文開頭）＝已處理
      cur.items.push({ label: it[2], qid: qm[1], sub: qm[2].trim(), text: it[3], head: it[3], lines: [], done: !!it[1] || /^✅/.test(it[3].trim()) });
    } else if (cur && cur.items.length && /^\s+\S/.test(l)) {
      const last = cur.items[cur.items.length - 1];
      last.text += ' ' + l.trim();
      last.lines.push(l);
    }
  }
  return groups;
}

export function parseChat(text) {
  const sec = sectionOf(toLines(text), '對話');
  const messages = [];
  let hidden = 0;
  if (!sec) return { messages, hidden };
  let attach = true; // 上一則是否可接回覆；範例被隱藏時，它底下的回覆也一起隱藏
  for (const l of sec.body) {
    if (!l.trim()) continue;
    const agent = /^\s*- ↳\s*(?:(\d{1,2}:\d{2})\s*)?Agent\s*[：:]\s*(.*)$/.exec(l);
    if (agent) {
      if (!attach) { hidden++; continue; }
      messages.push({ role: 'agent', time: agent[1] || '', text: agent[2] });
      continue;
    }
    if (!l.startsWith('- ')) continue;
    if (l.includes('（範例）')) { attach = false; hidden++; continue; }
    attach = true;
    const you = /^- 💬\s*你\s*(?:（([^）]*)）)?\s*[：:]\s*(.*)$/.exec(l);
    if (you) messages.push({ role: 'you', time: you[1] || '', text: you[2] });
    else messages.push({ role: 'agent', time: '', text: l.replace(/^- /, '') });
  }
  return { messages, hidden };
}

export function parseLive(text) {
  const lines = toLines(text);
  const now = sectionOf(lines, '現在');
  const status = now ? ((now.body.find((l) => /^- 狀態[：:]/.test(l)) || '').replace(/^- 狀態[：:]\s*/, '')) : '';
  const sched = sectionOf(lines, '接下來');
  const prog = sectionOf(lines, '進度');
  return {
    updated: parseUpdated(text),
    quota: parseQuota(text),
    now: now ? { title: now.title, status, md: now.body.filter((l) => !/^- 狀態[：:]/.test(l)).join('\n') } : null,
    schedule: sched ? { title: sched.title, md: sched.body.join('\n') } : null,
    waiting: parseWaiting(text),
    chat: parseChat(text),
    progress: prog ? { title: prog.title, md: prog.body.join('\n') } : null,
    progressLines: progressLines(text),
  };
}

// Questions.md：回傳每題 {qid, title, hasAnswerLine, answered}
export function parseQuestions(text) {
  const lines = toLines(text);
  const res = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^###\s+(Q\d+)\s*[｜|]\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) if (/^#{2,3} /.test(lines[j])) { end = j; break; }
    const ai = lines.slice(i, end).findIndex((l) => /^答：/.test(l));
    let answered = false;
    if (ai >= 0) {
      const block = lines.slice(i + ai, end);
      answered = block[0].replace(/^答：/, '').trim() !== '' || block.slice(1).some((l) => l.trim());
    }
    res.push({ qid: m[1], title: m[2].trim(), hasAnswerLine: ai >= 0, answered });
  }
  return res;
}

// 首頁「重要事項」：只取 ⏰ 有期限那組，最多 max 題
export function importantItems(waiting, max = 3) {
  return waiting.filter((g) => g.kind === 'deadline').flatMap((g) => g.items).slice(0, max);
}

// Live.md「今天的進度」：每個「- 」開頭的行（去掉前綴），新的在上面
export function progressLines(live) {
  const sec = sectionOf(toLines(live), '進度');
  if (!sec) return [];
  return sec.body.filter((l) => /^- /.test(l)).map((l) => l.replace(/^- /, '').trim());
}

// Questions.md「## 今日必答」底下每題：{qid, title, body, answer, hasAnswerLine}
export function parseTodayQuestions(text) {
  const lines = toLines(text);
  const s = findSection(lines, '今日必答');
  if (!s) return [];
  const res = [];
  for (let i = s.start + 1; i < s.end; i++) {
    const m = /^###\s+(Q\d+)\s*[｜|]\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let end = s.end;
    for (let j = i + 1; j < s.end; j++) if (/^###\s/.test(lines[j])) { end = j; break; }
    const block = lines.slice(i + 1, end);
    const ai = block.findIndex((l) => /^答：/.test(l));
    const body = (ai >= 0 ? block.slice(0, ai) : block).join('\n').trim();
    const answer = ai >= 0 ? [block[ai].replace(/^答：/, ''), ...block.slice(ai + 1)].join('\n').trim() : '';
    res.push({ qid: m[1], title: m[2].trim(), body, answer, hasAnswerLine: ai >= 0 });
  }
  return res;
}

// Task.md：「## 任務」底下未打勾的第一層項目，附子項
export function parseTasks(text) {
  const lines = toLines(text);
  const s = findSection(lines, '任務');
  if (!s) return [];
  const tasks = [];
  let cur = null;
  for (let i = s.start + 1; i < s.end; i++) {
    const l = lines[i];
    const top = /^- \[( |x|X)\]\s*(.*)$/.exec(l);
    if (top) {
      if (top[1] === ' ') {
        const tag = /^\[([^\]]+)\]\s*(.*)$/.exec(top[2]);
        cur = { tag: tag ? tag[1] : '', title: tag ? tag[2] : top[2], children: [] };
        tasks.push(cur);
      } else cur = null;
      continue;
    }
    if (/^\S/.test(l)) { cur = null; continue; }
    if (cur && l.trim()) cur.children.push(l);
  }
  for (const t of tasks) {
    const min = Math.min(...t.children.map((c) => /^\s*/.exec(c)[0].length), Infinity);
    t.childrenMd = Number.isFinite(min) ? t.children.map((c) => c.slice(min)).join('\n') : '';
  }
  return tasks;
}
