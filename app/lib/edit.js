// 修改文字內容（純函式）：只動需要動的那一小段，其餘一個字都不變
import { findSection } from './parse.js';

const pad = (n) => String(n).padStart(2, '0');
export function stamp(d = new Date()) {
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

const eolOf = (text) => (String(text).includes('\r\n') ? '\r' : '');
// 送出前統一清理（控制字元會讓本機 Python 的 splitlines／strip 把一行切成兩行或截斷任務區）：
// C0 控制字元（保留 tab、換行）、DEL、U+0085 清掉；U+2028／2029 轉成換行；\r\n 與單獨的 \r 都變成 \n
// （寫回時由各函式的換行邏輯補回 CRLF）
export function cleanText(s) {
  return String(s == null ? '' : s)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u0085]/g, '');
}
const oneLine = (s) => cleanText(s).replace(/\s*\n+\s*/g, ' ').trim();

export function formatChatLine(content, d = new Date()) {
  return '- 💬 你（' + stamp(d) + '）：' + oneLine(content);
}

const noStamp = (l) => String(l).replace(/\r/g, '').replace(/^(- 💬 你)（[^）]*）/, '$1').trim();

// 在「對話」區塊最後（下一個「## 」之前、最後一個非空白行之後）加入幾行
// opts.skipExisting：對話區已經有同樣內容的行（不看時間）就不重複加（重送答案用）
export function appendChatLines(liveText, newLines, opts = {}) {
  const lines = String(liveText).split('\n');
  const s = findSection(lines, '對話');
  if (!s) throw new Error('Live.md 找不到「對話」區塊');
  if (opts.skipExisting) {
    const have = new Set(lines.slice(s.start + 1, s.end).map(noStamp));
    newLines = newLines.filter((l) => !have.has(noStamp(l)));
    if (!newLines.length) return String(liveText);
  }
  let at = s.start + 1;
  for (let i = s.end - 1; i > s.start; i--) {
    if (lines[i].trim()) { at = i + 1; break; }
  }
  const cr = eolOf(liveText);
  lines.splice(at, 0, ...newLines.map((l) => l + cr));
  return lines.join('\n');
}

// 重送用：同一行（含時間戳）已經在對話區就不再加（網路逾時但其實寫入成功時，重送不會變兩行）。
// 時間戳來自 outbox 項目的 createdAt，重送時固定不變
export function appendChatOnce(liveText, content, d = new Date()) {
  const line = formatChatLine(content, d);
  const lines = String(liveText).split('\n');
  const s = findSection(lines, '對話');
  if (!s) throw new Error('Live.md 找不到「對話」區塊');
  if (lines.slice(s.start + 1, s.end).some((l) => l.replace(/\r/g, '').trim() === line)) return String(liveText);
  return appendChatLines(liveText, [line]);
}

export function appendChat(liveText, content, d = new Date()) {
  return appendChatLines(liveText, [formatChatLine(content, d)]);
}

export const STOP_LINE = /^(## |### |---|已收到答案|（產生時間)/;
const QID_RE = /^(?:Q|KB)\d+$/; // Q191、KB107 都是題號

// ---------- 「## 手機補答」區（v4 M2）----------
// 手機補答＝題目在 Questions.md 出現過、但沒有可寫的「答：」（擱置清單題、已收到答案那行的題號、題號重複不算）時，
// 答案寫進這一區的新區塊「### Qxx｜標題」＋「答：…」。電腦端 questions_sync.collect 收的時候（BLOCK／ANS／STOP 規則跟一般題目相同）：
// 題在題庫開放區（待回答、部分已回答）→ 照舊寫回題庫回答欄；已解決、擱置、KB 已寫回、題庫找不到 →
// 在 Task.md 新增 `- [ ] [agent] 手機補答 Qxx：…` 任務，並從 Questions.md 清掉（2026-10-28 起）。
// 這一區裡的標題不算題目本身：countQuestion／questionBlock 都要略過，不然補答會讓題號變成「重複」。
export const SUPP_NAME = '手機補答';
const SUPP_HEAD_RE = /^## 手機補答/;
const SECTION_STOP = /^(## |已收到答案|（產生時間|---)/;

function suppRange(lines) {
  const s = lines.findIndex((l) => SUPP_HEAD_RE.test(l));
  if (s < 0) return null;
  let end = lines.length;
  for (let i = s + 1; i < lines.length; i++) if (SECTION_STOP.test(lines[i])) { end = i; break; }
  return { start: s, end };
}

const headRe = (qid) => new RegExp('^###\\s+' + qid + '(?!\\d)');

// 主要區域（不含手機補答區）裡這題的 ### 標題行號
function headingIdx(lines, qid) {
  if (!QID_RE.test(qid)) throw new Error('題號格式不對：' + qid);
  const re = headRe(qid);
  const sr = suppRange(lines);
  const out = [];
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i]) && !(sr && i > sr.start && i < sr.end)) out.push(i);
  return out;
}

function questionBlock(lines, qid) {
  for (const i of headingIdx(lines, qid)) {
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) if (/^#{2,3} /.test(lines[j])) { end = j; break; }
    let ans = -1;
    for (let j = i + 1; j < end; j++) if (/^答：/.test(lines[j])) { ans = j; break; } // 跟 questions_sync.parse_questions 一樣取第一個
    // 答案範圍到 questions_sync.py 的 STOP 為止（:50、:221）：最後一題後面接 --- 或（產生時間）時不能寫到檔尾
    if (ans >= 0) for (let j = ans + 1; j < end; j++) if (STOP_LINE.test(lines[j])) { end = j; break; }
    if (ans >= 0) return { start: i, end, ans };
  }
  return null;
}

// Questions.md 裡有幾個同題號的標題（超過 1 個就不敢寫；手機補答區裡的不算）
export function countQuestion(questionsText, qid) {
  return headingIdx(String(questionsText).split('\n'), qid).length;
}

export function hasQuestion(questionsText, qid) {
  if (countQuestion(questionsText, qid) > 1) return false;
  return questionBlock(String(questionsText).split('\n'), qid) !== null;
}

// questions_sync.parse_questions 的 STOP（答案範圍結束的行首）與答案行本身；答案裡的行如果以這些開頭，
// 前面補一個空白，才不會被本機腳本當成答案結束或新的答案欄（questions_sync.py:50、218）
const STOP_RE = /^(#{1,6}\s|---|已收到答案|（產生時間|答[：:])/;

// 目前答案欄裡的文字行（去掉「答：」、每行 trim、去掉空行）
export function currentAnswerLines(questionsText, qid) {
  if (countQuestion(questionsText, qid) > 1) return null;
  const lines = String(questionsText).split('\n');
  const b = questionBlock(lines, qid);
  if (!b) return null;
  const out = [lines[b.ans].replace(/^答：/, ''), ...lines.slice(b.ans + 1, b.end)];
  return out.map((l) => l.replace(/\r/g, '').trim()).filter(Boolean);
}

// 回傳新文字；找不到該題（或沒有「答：」）回傳 null。已經有答案就接在後面
// opts.skipIfPresent：新答案的每一行已經連續出現在目前答案裡，就原樣回傳（不重寫，重送不會變兩份）
export function answerQuestion(questionsText, qid, answer, opts = {}) {
  if (countQuestion(questionsText, qid) > 1) return null;
  const lines = String(questionsText).split('\n');
  const b = questionBlock(lines, qid);
  if (!b) return null;
  const cr = eolOf(questionsText);
  const ans = cleanText(answer).trim().split('\n')
    .map((l) => (STOP_RE.test(l) ? ' ' + l : l));
  if (opts.skipIfPresent) {
    const have = currentAnswerLines(questionsText, qid) || [];
    const want = ans.map((l) => l.trim()).filter(Boolean);
    for (let i = 0; want.length && i + want.length <= have.length; i++) {
      if (want.every((w, k) => have[i + k] === w)) return questionsText;
    }
  }
  let lastNonBlank = b.ans;
  for (let j = b.end - 1; j > b.ans; j--) if (lines[j].trim()) { lastNonBlank = j; break; }
  const existing = lines[b.ans].replace(/^答：/, '').replace(/\r/g, '').trim() !== '' || lastNonBlank > b.ans;
  if (!existing) {
    const m = /^答：/.exec(lines[b.ans])[0];
    lines[b.ans] = m + ans[0] + cr;
    lines.splice(b.ans + 1, 0, ...ans.slice(1).map((l) => l + cr));
  } else {
    lines.splice(lastNonBlank + 1, 0, ...ans.map((l) => l + cr));
  }
  return lines.join('\n');
}

// ---------- 手機補答：寫進「## 手機補答」區 ----------
function suppBlock(lines, qid) {
  const sr = suppRange(lines);
  if (!sr) return null;
  const re = headRe(qid);
  for (let i = sr.start + 1; i < sr.end; i++) {
    if (!re.test(lines[i])) continue;
    let end = sr.end;
    for (let j = i + 1; j < sr.end; j++) if (/^#{2,3} /.test(lines[j])) { end = j; break; }
    let ans = -1;
    for (let j = i + 1; j < end; j++) if (/^答：/.test(lines[j])) { ans = j; break; }
    if (ans >= 0) for (let j = ans + 1; j < end; j++) if (STOP_LINE.test(lines[j])) { end = j; break; }
    return { start: i, end, ans, sr };
  }
  return null;
}

// 手機補答區裡這題的答案（每行 trim、去空行）；沒有這一區或這題回 null
export function supplementLines(questionsText, qid) {
  if (!QID_RE.test(qid)) throw new Error('題號格式不對：' + qid);
  const lines = String(questionsText).split('\n');
  const b = suppBlock(lines, qid);
  if (!b || b.ans < 0) return b ? [] : null;
  return [lines[b.ans].replace(/^答：/, ''), ...lines.slice(b.ans + 1, b.end)].map((l) => l.replace(/\r/g, '').trim()).filter(Boolean);
}

// 新區塊要插在哪：「## 擱置中」之前 → 「已收到答案」那行之前 → 「（產生時間」那行之前 → 檔尾
function suppInsertAt(lines) {
  for (const re of [/^## 擱置/, /^已收到答案/, /^（產生時間/]) {
    const i = lines.findIndex((l) => re.test(l));
    if (i >= 0) return i;
  }
  return -1;
}

// 把答案寫進 Questions.md 的「## 手機補答」區（沒有這一區就建立）。題號只能是 Q\d+／KB\d+（電腦端 BLOCK 的寫法）。
// 同題已在補答區就接在原本答案後面；opts.skipIfPresent：新答案每一行已連續出現在補答區，就原樣回傳。
export function appendSupplement(questionsText, qid, title, answer, opts = {}) {
  if (!QID_RE.test(qid)) throw new Error('題號格式不對：' + qid);
  const src = String(questionsText);
  const lines = src.split('\n');
  const cr = eolOf(src);
  const ans = cleanText(answer).trim().split('\n').map((l) => (STOP_RE.test(l) ? ' ' + l : l));
  if (!ans.join('').trim()) throw new Error('答案是空的');
  const b = suppBlock(lines, qid);
  if (b) {
    if (opts.skipIfPresent) {
      const have = supplementLines(src, qid) || [];
      const want = ans.map((l) => l.trim()).filter(Boolean);
      for (let i = 0; want.length && i + want.length <= have.length; i++) {
        if (want.every((w, k) => have[i + k] === w)) return src;
      }
    }
    let last = b.ans >= 0 ? b.ans : b.start;
    for (let j = b.end - 1; j > last; j--) if (lines[j].trim()) { last = j; break; }
    if (b.ans < 0) { lines.splice(last + 1, 0, '' + cr, '答：' + ans[0] + cr, ...ans.slice(1).map((l) => l + cr)); return lines.join('\n'); }
    const existing = lines[b.ans].replace(/^答：/, '').replace(/\r/g, '').trim() !== '' || last > b.ans;
    if (!existing) {
      lines[b.ans] = '答：' + ans[0] + cr;
      lines.splice(b.ans + 1, 0, ...ans.slice(1).map((l) => l + cr));
    } else lines.splice(last + 1, 0, ...ans.map((l) => l + cr));
    return lines.join('\n');
  }
  const heading = '### ' + qid + '｜' + [...oneLine(title || qid)].slice(0, 80).join('');
  const block = [heading, '', '答：' + ans[0], ...ans.slice(1)];
  const sr = suppRange(lines);
  if (sr) {
    let at = sr.start + 1;
    for (let i = sr.end - 1; i > sr.start; i--) if (lines[i].trim()) { at = i + 1; break; }
    const ins = ['', ...block];
    if (at < lines.length && lines[at].trim()) ins.push('');
    lines.splice(at, 0, ...ins.map((l) => l + cr));
    return lines.join('\n');
  }
  let at = suppInsertAt(lines);
  const ins = ['## ' + SUPP_NAME, '', ...block, ''];
  if (at < 0) {
    // 檔尾：檔案以換行結尾時 split 會多一個空字串，新區塊要放在它前面
    at = lines.length && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
  }
  if (at > 0 && lines[at - 1].trim()) ins.unshift('');
  lines.splice(at, 0, ...ins.map((l) => l + cr));
  return lines.join('\n');
}

export const TASK_TAGS = ['agent', 'remind', 'journal'];

// 在「## 任務」標題的下一行插入，前後各留一行空白
export function insertTask(taskText, tag, content) {
  if (!TASK_TAGS.includes(tag)) throw new Error('不支援的標籤：' + tag);
  const text = oneLine(content);
  if (!text) throw new Error('內容是空的');
  const lines = String(taskText).split('\n');
  const h = lines.findIndex((l) => /^## 任務\s*$/.test(l));
  if (h < 0) throw new Error('Task.md 找不到「## 任務」');
  const cr = eolOf(taskText);
  const item = '- [ ] [' + tag + '] ' + text + cr;
  const nextBlank = h + 1 < lines.length && !lines[h + 1].replace(/\r/g, '').trim();
  lines.splice(h + 1, 0, ...(nextBlank ? [cr, item] : [cr, item, cr]));
  return lines.join('\n');
}

// ---------- v3 第 3 階段：新增任務／筆記（寫法必須能被 task_md.py 解析） ----------
// Python str.strip() 的空白＝JS trim 的空白，再加 \x1c–\x1f、\x85（JS 不算空白）；task_md.py:53 用 strip() == '---' 判斷任務區結束
export const pyStrip = (s) => String(s).replace(/^[\s\x1c-\x1f\x85]+|[\s\x1c-\x1f\x85]+$/g, '');
// 縮排後 strip() 仍等於 --- 會截斷任務區，前面放零寬空白避開
export const SAFE = (l) => (pyStrip(l) === '---' ? '\u200b' + l : l);

// 手機編號子行（電腦端 mobile_sync 認 `- 手機編號：m-<英數>`；縮排 4 格跟其他子行一致）
export const MID_RE = /^m-[A-Za-z0-9]+$/;
export const midLine = (mid) => '    - 手機編號：' + mid;
export function hasMobileId(taskText, mid) {
  if (!MID_RE.test(String(mid || ''))) return false;
  return String(taskText).split('\n').some((l) => l.replace(/\r/g, '').trim() === '- 手機編號：' + mid);
}
// 區塊 [head, 子行…]：編號放在第一個子行後面（沒有子行就接在標題後面）
function withMid(block, mid) {
  if (!mid) return block;
  if (!MID_RE.test(mid)) throw new Error('手機編號格式不對：' + mid);
  const out = block.slice();
  out.splice(Math.min(2, out.length), 0, midLine(mid));
  return out;
}

export const TITLE_MAX = 80;
const META_RE = /^\s*-\s*(期限|專案|來源|送出|收錄方式|網址|手機編號)[：:]/;
export const isMetaLine = (l) => META_RE.test(String(l));

// 內容 → {title, body:[縮排前的行]}。第一行 > 80 字就截在 80 字，其餘接到第二行；
export function splitContent(content, max = TITLE_MAX) {
  const lines = cleanText(content).trim().split('\n').map((l) => l.replace(/\s+$/, ''));
  // 開頭幾行只有標點或空白（例如手機輸入法多打的「。」）不能當標題：跳過它們，至少留一行
  while (lines.length > 1 && !/[\p{L}\p{N}]/u.test(lines[0])) lines.shift();
  let first = lines[0] || '';
  const rest = lines.slice(1);
  const chars = [...first];
  if (chars.length > max) {
    first = chars.slice(0, max).join('');
    rest.unshift(chars.slice(max).join(''));
  }
  while (rest.length && !rest[rest.length - 1].trim()) rest.pop();
  return { title: first, body: rest };
}

const stampTW = (d) => pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());

// 在「## 任務」標題的下一行插入整個區塊（行清單，不含換行），前後各留一行空白（規則同舊 insertTask）
export function insertBlock(taskText, block) {
  const lines = String(taskText).split('\n');
  const h = lines.findIndex((l) => /^## 任務\s*$/.test(l.replace(/\r$/, '')));
  if (h < 0) throw new Error('Task.md 找不到「## 任務」');
  const cr = eolOf(taskText);
  const items = block.map((l) => l + cr);
  const nextBlank = h + 1 < lines.length && !lines[h + 1].replace(/\r/g, '').trim();
  lines.splice(h + 1, 0, ...(nextBlank ? [cr, ...items] : [cr, ...items, cr]));
  return lines.join('\n');
}

const normC = (s) => String(s).replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
const halfBrackets = (s) => String(s).replace(/［/g, '[').replace(/］/g, ']');

// 已經有同內容的未打勾任務（標題＋非 meta 子行相同）→ 重送不重寫
function duplicateOf(taskText, titleText, body) {
  const want = [titleText, ...body.filter((l) => !isMetaLine(l))].map(normC).filter(Boolean);
  const lines = String(taskText).split('\n').map((l) => l.replace(/\r$/, ''));
  const h = lines.indexOf('## 任務');
  if (h < 0) return false;
  let end = lines.length;
  for (let i = h + 1; i < lines.length; i++) if (pyStrip(lines[i]) === '---') { end = i; break; }
  let cur = null;
  const tasks = [];
  for (let i = h + 1; i < end; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    if (/^-\s*\[ \]/.test(halfBrackets(l))) { cur = { head: halfBrackets(l), sub: [] }; tasks.push(cur); continue; }
    if (/^[-－]/.test(l)) { cur = null; continue; }
    if (cur && (l[0] === ' ' || l[0] === '\t')) cur.sub.push(l);
  }
  for (const t of tasks) {
    const m = /^-\s*\[ \]\s*((?:\[[^\]\n]*\]\s*)*)(.*)$/.exec(t.head);
    const head = (m ? m[2] : '').split(/⚠️?\s*待確認/)[0];
    const have = [head, ...t.sub.filter((l) => !isMetaLine(l))].map(normC).filter(Boolean);
    if (have.length === want.length && have.every((x, i) => x === want[i])) return true;
  }
  return false;
}

// 標題若以 [ 開頭，task_md 的 HEAD_RE 會把它當標籤吃掉，前面放零寬空白避開
const safeTitle = (t) => (/^[\[［]/.test(t) ? '\u200b' + t : t);

// 新增任務（v3）。opts：{tag:'agent'|'remind', content, project:'auto'|'none'|'P46', deadline:'YYYY-MM-DD'|'', now, where, mid}
// 回傳 {text, action:'created'|'noop'}
export function insertTaskV3(taskText, opts = {}) {
  const tag = opts.tag || 'agent';
  if (tag !== 'agent' && tag !== 'remind') throw new Error('不支援的標籤：' + tag);
  const { title, body } = splitContent(opts.content);
  if (!title.trim()) throw new Error('內容是空的');
  const pid = /^P\d+$/.test(opts.project || '') ? opts.project : '';
  const when = stampTW(opts.now || new Date());
  const head = '- [ ] [' + tag + '] ' + (pid ? '[' + pid + '] ' : '') + safeTitle(title);
  const sub = body.map((l) => (l.trim() ? '    ' + SAFE(l) : ''));
  const meta = [];
  if (opts.deadline && /^\d{4}-\d{2}-\d{2}$/.test(opts.deadline)) meta.push('    - 期限：' + opts.deadline);
  if (!pid) {
    if (opts.project === 'none') meta.push('    - 專案：不屬於任何專案');
    else meta.push('    - 專案：自動（請 Agent 判斷屬於哪個專案、獨立任務，或建議升格成專案）');
  }
  meta.push('    - 來源：' + (opts.where || '手機 App 任務頁') + ' ' + when);
  if (opts.mid && hasMobileId(taskText, opts.mid)) return { text: String(taskText), action: 'noop', reason: 'mid' };
  if (duplicateOf(taskText, title, body)) return { text: String(taskText), action: 'noop', reason: 'dup' };
  return { text: insertBlock(taskText, withMid([head, ...sub, ...meta], opts.mid)), action: 'created' };
}

export const NOTE_MARK = '📝 筆記';
// 新增筆記。opts：{content, source, url, now, mid}（mid：手機編號，帶了就加編號子行，而且 Task.md 已有同編號就當成功、不重寫）
export function insertNote(taskText, opts = {}) {
  const { title, body } = splitContent(opts.content);
  if (!title.trim()) throw new Error('內容是空的');
  const when = stampTW(opts.now || new Date());
  const source = oneLine(opts.source || '');
  const url = oneLine(opts.url || '');
  const lead = NOTE_MARK + '，請收進知識庫：';
  const head = '- [ ] [agent] ' + lead + title;
  const sub = body.map((l) => (l.trim() ? '    ' + SAFE(l) : ''));
  const meta = [];
  if (source) meta.push('    - 來源：' + source);
  if (url) meta.push('    - 網址：' + url);
  meta.push('    - 收錄方式：照 knowledge-base skill 分類、比對既有筆記後寫入；要查證的另開題，不要把筆記本身變任務');
  meta.push('    - 送出：手機 App 紀錄頁 ' + when);
  if (opts.mid && hasMobileId(taskText, opts.mid)) return { text: String(taskText), action: 'noop', reason: 'mid' };
  if (duplicateOf(taskText, lead + title, body)) return { text: String(taskText), action: 'noop', reason: 'dup' };
  return { text: insertBlock(taskText, withMid([head, ...sub, ...meta], opts.mid)), action: 'created' };
}
