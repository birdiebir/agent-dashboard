// 日記寫進 Task.md（純函式）。依據：
//  · task_md.py:45-113 的解析規則：「## 任務」到第一個單獨一行 `---` 為止；第 0 欄的 `-` 開頭行是任務開頭；
//    縮排的行是子項目；沒縮排又不是任務開頭的行是「附件」（lint 會警告），所以多行一律縮排。
//  · routine_ops.py:431-441（ensure_journals）：routine 每天會補 `- [ ] [journal] MM/DD 日記` 模板，
//    已經有同月日的 journal（task_md.journal_dates，:209-221，只看標題裡第一個 M/D，不看有沒有勾）就不補，
//    所以手機必須沿用同樣的標題，才不會同一天出現兩筆。
//  · routine_ops.py:1071：三題任何一題「只剩 <佔位符>」整篇不處理；填法照使用者習慣在佔位符後面接答案。
//  · routine-tags.md:63-64：收錄後 `task done`＝`- [x]` 加 `- 結果：已收錄至 …`（task_md.mark_done，:146-153）。

import { cleanText, pyStrip, SAFE } from './edit.js';
export { pyStrip };

export const JOURNAL_PLACEHOLDERS = ['<今日最重要的里程碑>', '<最扯/搞笑的事>', '<最感謝的事>'];
export const JOURNAL_QUESTIONS = ['今日最重要的里程碑', '最扯／搞笑的事', '最感謝的事'];
export const TEMPLATE = JOURNAL_PLACEHOLDERS.map((p, i) => `${i + 1}. ${p}`);

const pad = (n) => String(n).padStart(2, '0');
const FULLWIDTH = { '［': '[', '］': ']', '－': '-', '　': ' ' };
const norm = (s) => s.replace(/[［］－　]/g, (c) => FULLWIDTH[c]);
const clean = (l) => l.replace(/\r$/, '');
const eolOf = (text) => (String(text).includes('\r\n') ? '\r' : '');
const HEAD_RE = /^-\s*(\[(?: |x|X|)\])?\s*((?:\[[^\]\n]*\]\s*)*)(.*)$/;
const KNOWN = new Set(['agent', 'journal', 'remind']);

export const mdLabel = (d) => pad(d.getMonth() + 1) + '/' + pad(d.getDate());
export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function parseHead(line) {
  const n = norm(line);
  const m = HEAD_RE.exec(n);
  const box = (m && m[1]) || '';
  const tags = m ? [...(m[2] || '').matchAll(/\[([^\]\n]*)\]/g)].map((x) => x[1].trim()).filter(Boolean) : [];
  return {
    checked: box.toLowerCase() === '[x]', hasBox: !!box, tags,
    tag: (tags.map((t) => t.toLowerCase()).find((t) => KNOWN.has(t))) || null,
    text: (m ? m[3] : n.slice(1)).trim(),
  };
}

// 照 task_md.parse 切出任務區塊：{start,end,head,sub:[行號],attach:[行號]}；end 是最後一個非空行之後
export function parseTaskBlocks(rawLines) {
  const lines = rawLines.map(clean);
  const h = lines.indexOf('## 任務');
  if (h < 0) return { tasks: [], start: -1, end: -1 };
  let end = lines.length;
  for (let i = h + 1; i < lines.length; i++) if (lines[i].trim() === '---') { end = i; break; }
  const tasks = [];
  let cur = null;
  let prev = 'blank';
  for (let i = h + 1; i < end; i++) {
    const ln = lines[i];
    if (!ln.trim()) { prev = 'blank'; continue; }
    const topDash = ln.startsWith('-') || ln.startsWith('－');
    const strong = /^-\s*\[/.test(norm(ln));
    if (topDash && (strong || prev === 'blank' || prev === 'head' || cur === null)) {
      cur = { start: i, end: i + 1, head: parseHead(ln), sub: [], attach: [] };
      tasks.push(cur);
      prev = 'head';
      continue;
    }
    if (cur === null) { prev = 'other'; continue; }
    if (ln[0] === ' ' || ln[0] === '\t') { cur.sub.push(i); prev = 'sub'; } else { cur.attach.push(i); prev = 'attach'; }
    cur.end = i + 1;
  }
  return { tasks, start: h + 1, end };
}

export function findJournal(lines, month, day) {
  const { tasks } = parseTaskBlocks(lines);
  return tasks.find((t) => {
    if (t.head.tag !== 'journal') return false;
    const m = /(\d{1,2})\/(\d{1,2})/.exec(t.head.text);
    return m && Number(m[1]) === month && Number(m[2]) === day;
  }) || null;
}

const pointRe = (i) => new RegExp('^( {1,6}|\\t)' + i + '\\.\\s*(.*)$');
const stripPlaceholder = (s) => s.replace(/<[^>]*>/g, '').trim();
const FREE_MARK = '自由書寫（手機';

// 讀目前 Task.md 裡這一天日記的狀態。state：
//  none（沒有這天的條目）｜template（有模板、沒人填）｜partial（有填但三題沒填完）｜filled（三題都有內容）
//  ｜collected（已打勾＋結果寫已收錄）｜done（打勾但沒寫收錄）｜pending（⚠️待確認）
export function journalStatus(taskText, now = new Date()) {
  const lines = String(taskText).split('\n');
  const e = findJournal(lines, now.getMonth() + 1, now.getDate());
  if (!e) return { state: 'none', filled: 0, hasFree: false, result: '' };
  const sub = e.sub.map((i) => clean(lines[i]));
  let filled = 0;
  for (let k = 1; k <= 3; k++) {
    const row = sub.map((s) => pointRe(k).exec(s)).find(Boolean);
    if (row && stripPlaceholder(row[2])) filled++;
  }
  const hasFree = sub.some((s) => s.includes(FREE_MARK));
  const result = (sub.find((s) => /結果[：:]/.test(s)) || '').replace(/^.*結果[：:]\s*/, '');
  let state;
  if (e.head.checked) state = /收錄/.test(result) ? 'collected' : 'done';
  else if (e.head.text.includes('⚠️待確認')) state = 'pending';
  else if (filled === 3) state = 'filled';
  else if (filled > 0 || hasFree) state = 'partial';
  else state = 'template';
  return { state, filled, hasFree, result };
}

const indentLines = (text, n) => cleanText(text).trim().split('\n')
  .map((l) => (l.trim() ? ' '.repeat(n) + SAFE(l.replace(/\s+$/, '')) : ''));

// 新的內容是否已經連續出現在這個條目的子行裡（重送不重寫）
const cmpNorm = (s) => s.replace(/\u200b/g, '').replace(/<[^>]*>/g, '').replace(/^\s*（補充 \d{2}:\d{2}）/, '').trim();
function alreadyThere(subLines, textLines) {
  const have = subLines.map(cmpNorm).filter(Boolean);
  const want = textLines.map(cmpNorm).filter(Boolean);
  if (!want.length) return true;
  for (let i = 0; i + want.length <= have.length; i++) if (want.every((w, k) => have[i + k] === w)) return true;
  return false;
}

// 把日記寫進 Task.md。answers：三題的答案（可空字串）；free：自由書寫。
// 回傳 {text, action}：action = created（新增條目）｜filled（填進既有模板）｜noop（內容早就在了／沒有內容）｜
//   blocked（這天已收錄，不能再改）。只動這一個條目，其他行逐字不變。
export function applyJournal(taskText, { now = new Date(), answers = ['', '', ''], free = '' } = {}) {
  const src = String(taskText);
  const cr = eolOf(src);
  const lines = src.split('\n');
  const ans = [0, 1, 2].map((i) => cleanText(answers[i] || '').trim());
  const freeText = cleanText(free || '').trim();
  if (!ans.some(Boolean) && !freeText) return { text: src, action: 'noop', reason: 'empty' };
  const when = pad(now.getHours()) + ':' + pad(now.getMinutes());
  const entry = findJournal(lines, now.getMonth() + 1, now.getDate());

  // 條目內的行（不含標題），去掉 \r 以便比對；寫回時補回 \r
  const makeBody = (existing) => {
    const body = existing.slice();
    // 三題：由後往前處理，前面的行號才不會位移
    const pointIdx = [1, 2, 3].map((k) => body.findIndex((s) => pointRe(k).test(s)));
    const blockEnd = (idx) => {
      const ind = body[idx].length - body[idx].trimStart().length;
      // 遇到空行繼續往下找，碰到縮排比較淺的非空行才停（答案裡有空行時，補充內容才不會插到答案中間）
      let j = idx + 1;
      let last = idx + 1;
      while (j < body.length) {
        if (!body[j].trim()) { j++; continue; }
        if (body[j].length - body[j].trimStart().length > ind) { j++; last = j; } else break;
      }
      return last;
    };
    const missing = [];
    for (const k of [3, 2, 1]) {
      const a = ans[k - 1];
      if (!a) continue;
      const idx = pointIdx[k - 1];
      const aLines = a.split('\n');
      if (idx < 0) { missing.unshift({ k, aLines }); continue; }
      const m = pointRe(k).exec(body[idx]);
      const ind = m[1].length;
      const cur = m[2];
      const end = blockEnd(idx);
      const curBlock = [cur, ...body.slice(idx + 1, end)];
      if (!stripPlaceholder(cur)) {
        // 還沒填：接在佔位符後面（使用者習慣，routine 收錄時會拿掉 <…>）
        const first = cur.trim() ? cur.trim() + ' ' + aLines[0] : aLines[0];
        body.splice(idx, 1, ' '.repeat(ind) + k + '. ' + first, ...aLines.slice(1).map((l) => (l.trim() ? ' '.repeat(ind + 4) + SAFE(l) : '')));
      } else if (!alreadyThere(curBlock, aLines)) {
        const extra = aLines.map((l, n) => (l.trim() ? ' '.repeat(ind + 4) + (n === 0 ? '（補充 ' + when + '）' : '') + SAFE(l) : ''));
        body.splice(end, 0, ...extra);
      }
    }
    for (const { k, aLines } of missing) {
      const ph = JOURNAL_PLACEHOLDERS[k - 1];
      body.push('    ' + k + '. ' + ph + ' ' + aLines[0], ...aLines.slice(1).map((l) => (l.trim() ? '        ' + SAFE(l) : '')));
    }
    if (freeText) {
      const fl = indentLines(freeText, 8);
      const sameBlock = body.some((s, i) => s.includes(FREE_MARK) && alreadyThere(body.slice(i + 1), fl));
      if (!sameBlock) body.push('    - ' + FREE_MARK + ' ' + when + '）：', ...fl);
    }
    return body;
  };

  if (entry) {
    if (entry.head.checked) return { text: src, action: 'blocked', reason: 'collected' };
    const old = lines.slice(entry.start + 1, entry.end).map(clean);
    const body = makeBody(old);
    if (body.length === old.length && body.every((l, i) => l === old[i])) return { text: src, action: 'noop', reason: 'exists' };
    const out = lines.slice(0, entry.start + 1).concat(body.map((l) => l + cr), lines.slice(entry.end));
    return { text: out.join('\n'), action: 'filled' };
  }

  const h = lines.findIndex((l) => clean(l) === '## 任務');
  if (h < 0) throw new Error('Task.md 找不到「## 任務」');
  const body = makeBody(TEMPLATE.map((t) => '    ' + t));
  const block = ['- [ ] [journal] ' + mdLabel(now) + ' 日記', ...body].map((l) => l + cr);
  let pos = h + 1;
  while (pos < lines.length && !clean(lines[pos]).trim()) pos++; // 跟 task_md.insert_top 一樣：插在第一個非空行前面
  lines.splice(pos, 0, ...block, cr);
  return { text: lines.join('\n'), action: 'created' };
}

// ---------- v3 第 3 階段：三題改寫（Q206 B：手機也做三格，改寫整題，不再接「（補充）」） ----------
const LEAD_PH = /^\s*(<[^>]*>)\s*/;
const normAns = (s) => cleanText(s == null ? '' : s).replace(/\u200b/g, '').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').trim();

// 從條目內容行（不含標題）找第 k 題整段的範圍：{idx, end, ind}；沒有回 null
function pointRange(body, k) {
  const idx = body.findIndex((s) => pointRe(k).test(s));
  if (idx < 0) return null;
  const ind = body[idx].length - body[idx].trimStart().length;
  let j = idx + 1;
  let last = idx + 1;
  while (j < body.length) {
    if (!body[j].trim()) { j++; continue; }
    if (body[j].length - body[j].trimStart().length > ind) { j++; last = j; } else break;
  }
  return { idx, end: last, ind };
}

// 第 k 題目前的答案文字（去掉開頭的 <佔位符> 與子行縮排；多行、（補充 HH:MM）段落都帶進來）
function readPoint(body, k) {
  const r = pointRange(body, k);
  if (!r) return '';
  const m = pointRe(k).exec(body[r.idx]);
  const first = m[2].replace(LEAD_PH, '').replace(/\u200b/g, '');
  const strip = new RegExp('^ {0,' + (r.ind + 4) + '}');
  const rest = body.slice(r.idx + 1, r.end).map((l) => l.replace(strip, '').replace(/^\u200b/, '').replace(/\s+$/, ''));
  return normAns([first, ...rest].join('\n'));
}

// 讀某一天日記的內容：{found, checked, state, answers:[3], filled, free:[{when,text}], result}
export function readJournal(taskText, month, day) {
  const lines = String(taskText).split('\n');
  const e = findJournal(lines, month, day);
  if (!e) return { found: false, checked: false, state: 'none', answers: ['', '', ''], filled: 0, free: [], result: '' };
  const body = lines.slice(e.start + 1, e.end).map(clean);
  const answers = [1, 2, 3].map((k) => readPoint(body, k));
  const free = [];
  body.forEach((l, i) => {
    const m = /^\s*-\s*自由書寫（手機\s*(\d{1,2}:\d{2})）[：:]\s*(.*)$/.exec(l);
    if (!m) return;
    const ind = l.length - l.trimStart().length;
    const parts = m[2] ? [m[2]] : [];
    for (let j = i + 1; j < body.length; j++) {
      if (body[j].trim() && body[j].length - body[j].trimStart().length <= ind) break;
      parts.push(body[j].trim().replace(/^\u200b/, ''));
    }
    free.push({ when: m[1], text: parts.join('\n').trim() });
  });
  const result = (body.find((s) => /結果[：:]/.test(s)) || '').replace(/^.*結果[：:]\s*/, '');
  const checked = e.head.checked;
  const filled = answers.filter(Boolean).length;
  let state;
  if (checked) state = /收錄/.test(result) ? 'collected' : 'done';
  else if (e.head.text.includes('⚠️待確認')) state = 'pending';
  else if (filled === 3) state = 'filled';
  else if (filled > 0 || free.length) state = 'partial';
  else state = 'template';
  return { found: true, checked, state, answers, filled, free, result };
}

// 一題的小狀態：empty 未填｜dirty 有修改未送出｜sent 已送出
export function pointStatus(current, draft) {
  const c = normAns(current);
  if (draft != null && normAns(draft) !== c) return 'dirty';
  return c ? 'sent' : 'empty';
}

// 可以編輯的日期：今天，加上「昨天還沒收錄（Task.md 還在、沒打勾）」的昨天
export function journalDays(taskText, now = new Date()) {
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const out = [{ key: 'today', month: now.getMonth() + 1, day: now.getDate(), label: '今天 ' + mdLabel(now) }];
  const r = readJournal(taskText, y.getMonth() + 1, y.getDate());
  if (r.found && !r.checked) out.push({ key: 'yesterday', month: y.getMonth() + 1, day: y.getDate(), label: '昨天 ' + mdLabel(y) + (r.filled < 3 ? ' 還沒填完' : ' 還沒被收錄') });
  return out;
}

// 改寫三題。answers：三題的新內容；base（選填）：畫面載入當下的內容——只動「跟 base 不一樣」的題，
// 沒給 base 就拿目前檔案內容比；沒改的題逐字不動；空白的題保留（或補回）佔位符。
// day：{month, day}，預設今天。回傳 {text, action}：created｜edited｜noop｜blocked（已收錄）｜missing（那天沒有條目）
export function applyJournalEdit(taskText, { now = new Date(), day = null, answers = ['', '', ''], base = null } = {}) {
  const src = String(taskText);
  const cr = eolOf(src);
  const lines = src.split('\n');
  const month = day ? day.month : now.getMonth() + 1;
  const dd = day ? day.day : now.getDate();
  const ans = [0, 1, 2].map((i) => cleanText(answers[i] || '').replace(/\u200b/g, '').trim());
  const entry = findJournal(lines, month, dd);
  const isToday = month === now.getMonth() + 1 && dd === now.getDate();
  if (entry && entry.head.checked) return { text: src, action: 'blocked', reason: 'collected' };
  if (!entry && !isToday) return { text: src, action: 'missing', reason: 'no-entry' };

  const editBody = (body0) => {
    const body = body0.slice();
    let touched = false;
    const conflicts = [];
    if (base) {
      for (const k of [1, 2, 3]) {
        const cur = readPoint(body, k);
        const ref = normAns(base[k - 1]);
        const a = normAns(ans[k - 1]);
        if (a && a !== ref && cur !== ref && a !== cur) conflicts.push(k); // 兩邊都改了同一題：不覆蓋
      }
      if (conflicts.length) return { body, touched, conflicts };
    }
    for (const k of [3, 2, 1]) { // 由後往前，前面的行號才不會位移
      const a = ans[k - 1];
      const cur = readPoint(body, k);
      const ref = base ? normAns(base[k - 1]) : cur;
      if (normAns(a) === ref || normAns(a) === cur) continue;
      // 空白不代表「刪掉」：本次沒填的題保留 Task.md 現有答案（2026-10-30 資料遺失修正：第二次送出把第 1 題洗回佔位符）
      if (!a && cur) continue;
      const aLines = a ? a.split('\n') : [];
      const r = pointRange(body, k);
      if (!r) {
        if (!a) continue;
        body.push('    ' + k + '. ' + JOURNAL_PLACEHOLDERS[k - 1] + ' ' + aLines[0], ...aLines.slice(1).map((l) => (l.trim() ? '        ' + SAFE(l) : '')));
        touched = true;
        continue;
      }
      const m = pointRe(k).exec(body[r.idx]);
      const ph = (LEAD_PH.exec(m[2]) || [])[1] || (a ? '' : JOURNAL_PLACEHOLDERS[k - 1]);
      const first = [ph, aLines[0] || ''].filter(Boolean).join(' ');
      const out = [' '.repeat(r.ind) + k + '. ' + first, ...aLines.slice(1).map((l) => (l.trim() ? ' '.repeat(r.ind + 4) + SAFE(l) : ''))];
      body.splice(r.idx, r.end - r.idx, ...out);
      touched = true;
    }
    return { body, touched, conflicts };
  };

  if (entry) {
    const old = lines.slice(entry.start + 1, entry.end).map(clean);
    const { body, touched, conflicts } = editBody(old);
    if (conflicts.length) return { text: src, action: 'conflict', points: conflicts };
    if (!touched) return { text: src, action: 'noop', reason: 'unchanged' };
    return { text: lines.slice(0, entry.start + 1).concat(body.map((l) => l + cr), lines.slice(entry.end)).join('\n'), action: 'edited' };
  }
  if (!ans.some(Boolean)) return { text: src, action: 'noop', reason: 'empty' };
  const h = lines.findIndex((l) => clean(l) === '## 任務');
  if (h < 0) throw new Error('Task.md 找不到「## 任務」');
  const { body } = editBody(TEMPLATE.map((t) => '    ' + t));
  const block = ['- [ ] [journal] ' + pad(month) + '/' + pad(dd) + ' 日記', ...body].map((l) => l + cr);
  let pos = h + 1;
  while (pos < lines.length && !clean(lines[pos]).trim()) pos++;
  lines.splice(pos, 0, ...block, cr);
  return { text: lines.join('\n'), action: 'created' };
}
