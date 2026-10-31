// 在 Task.md 既有任務底下加一個子行（升格請求、維持任務：§6 第 4 題 A，系統訊息不進對話區）。純函式。
// 找任務的方式：用最新 Task.md，以任務第一行文字（去掉標籤、⚠️待確認 以後、零寬空白，空白壓成一個）找到「唯一一筆未打勾」的任務。
// 找不到、有好幾筆同名 → 不寫，回傳原因（呼叫端把這筆寫入標成失敗並講白話原因）。
import { parseTaskBlocks } from './journal.js';
import { splitPending } from './tasks.js';
import { stamp } from './edit.js';

const clean = (l) => String(l).replace(/\r$/, '');
const eolOf = (text) => (String(text).includes('\r\n') ? '\r' : '');
export const normTitle = (s) => splitPending(String(s || '')).title.replace(/\s+/g, ' ').trim();

// 回傳 {block, matches}：matches＝符合的未打勾任務區塊（journal 不算）
export function findOpenTasks(taskText, title) {
  const want = normTitle(title);
  const lines = String(taskText).split('\n').map(clean);
  const { tasks } = parseTaskBlocks(lines);
  const matches = want ? tasks.filter((b) => !b.head.checked && b.head.tag !== 'journal' && normTitle(b.head.text) === want) : [];
  return { lines, matches };
}

const oneLine = (s, max) => [...String(s || '').replace(/\s+/g, ' ').replace(/｜/g, '/').trim()].slice(0, max).join('');

// 升格請求子行：`    - 升格請求：<專案名稱>｜<理由>（MM-DD HH:MM 手機）`
export function promoteSubline({ name = '', reason = '', now = new Date() } = {}) {
  return '    - 升格請求：' + oneLine(name, 60) + '｜' + oneLine(reason, 200) + '（' + stamp(now) + ' 手機）';
}
// 維持任務子行：`    - 維持任務（MM-DD HH:MM 手機）`
export function keepSubline(now = new Date()) {
  return '    - 維持任務（' + stamp(now) + ' 手機）';
}

// 把 line 加在 title 那筆任務的最後（所有子行與附件後面）。
// 回傳 {text, action:'created'|'noop'|'missing'|'ambiguous', count}
// 同一子行已存在（整行相同，含時間戳）→ noop，不重寫。重送時時間戳固定（用 createdAt）所以不會變兩行；隔天再按一次時間不同，會新增一行
export function addTaskSubline(taskText, title, line) {
  const src = String(taskText);
  const { lines, matches } = findOpenTasks(src, title);
  if (!matches.length) return { text: src, action: 'missing', count: 0 };
  if (matches.length > 1) return { text: src, action: 'ambiguous', count: matches.length };
  const b = matches[0];
  const base = clean(line).trim();
  for (let i = b.start + 1; i < b.end; i++) {
    if (clean(lines[i]).trim() === base) return { text: src, action: 'noop', count: 1 };
  }
  const all = src.split('\n');
  all.splice(b.end, 0, line + eolOf(src));
  return { text: all.join('\n'), action: 'created', count: 1 };
}

// ---------- 提醒：手機打勾完成、回覆（2026-10-30 使用者：提醒也要能回應或勾完成）----------
const isoDay = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

// 完成的結果子行：`    - 結果：手機打勾｜<備註>（YYYY-MM-DD，手機 App MM-DD HH:MM）`。
// 「（YYYY-MM-DD，」是電腦端 task_md.RESULT_DATE 的格式：routine finish 照結果日期把它歸檔到已完成紀錄
export function doneSubline({ note = '', now = new Date() } = {}) {
  const n = oneLine(note, 200);
  return '    - 結果：手機打勾' + (n ? '｜' + n : '') + '（' + isoDay(now) + '，手機 App ' + stamp(now) + '）';
}
// 回覆子行：`    - 手機回覆：<內容>（MM-DD HH:MM 手機）`；電腦端 routine 看到沒處理的就列出來，處理完在後面加 `- Agent 回覆：…`
export function replySubline({ text = '', now = new Date() } = {}) {
  return '    - 手機回覆：' + oneLine(text, 400) + '（' + stamp(now) + ' 手機）';
}

// 把 title 那筆未打勾的任務改成 `- [x]`，並在最後加 line（結果子行）。
// 回傳 {text, action:'created'|'noop'|'missing'|'ambiguous', count}；已經是打勾的（電腦或 GitHub 上先勾了）→ noop
export function checkTask(taskText, title, line) {
  const src = String(taskText);
  const { lines, matches } = findOpenTasks(src, title);
  if (!matches.length) {
    const want = normTitle(title);
    const { tasks } = parseTaskBlocks(lines);
    const done = want && tasks.some((b) => b.head.checked && normTitle(b.head.text) === want);
    return { text: src, action: done ? 'noop' : 'missing', count: done ? 1 : 0 };
  }
  if (matches.length > 1) return { text: src, action: 'ambiguous', count: matches.length };
  const b = matches[0];
  const all = src.split('\n');
  const head = all[b.start];
  const fixed = head.replace(/^(\s*-\s*)\[ \]/, '$1[x]');
  if (fixed === head) return { text: src, action: 'missing', count: 0 };
  all[b.start] = fixed;
  all.splice(b.end, 0, line + eolOf(src));
  return { text: all.join('\n'), action: 'created', count: 1 };
}
