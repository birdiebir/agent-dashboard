// 待我頁的題目資料（純函式，不碰 DOM）：
// Questions.md 全部題目（今日必答＋各分類）＋ Live.md「等你」，依題號去重，解析分類／期限／卡住／選項，
// 並組出要寫進「答：」的文字。格式依據 questions_sync.py：標題「### Q191｜…」（:197-260）、
// 分類列「分類：x｜期限：y｜卡住：z」（render，:321-338）、答案欄「答：」（:37、:218）。
// 格式異常時一律「少解析一點」而不是丟錯：解析不出選項就只剩自由文字與快速按鈕。

import { STOP_LINE, countQuestion, hasQuestion } from './edit.js';

const toLines =(t) => String(t).replace(/\r/g, '').split('\n');
const HEAD = /^###\s+((?:Q|KB)\d+)\s*[｜|]\s*(.*)$/;
const LIST_HEAD = /^\s*[-*]\s+((?:Q|KB)\d+)\s*[｜|]\s*(.*)$/; // 擱置區的清單格式：「- Q36｜標題（分類）」

// 區段標題含「不用答」或「擱置」＝擱置區：不算待答、不催（D2＝A）
export const isBacklogSection = (s) => /不用答|擱置/.test(s || '');
const CIRCLED = /[①②③④⑤⑥⑦⑧⑨⑩]/;

export const QUICK = {
  suggest: '照建議',
  later: '延後', // Questions.md 開頭說明：「想跳過寫『延後』」
  unsure: '不確定', // 同上：「不確定就寫『不確定』」
  discuss: '需要討論',
};

// ---------- 選項 ----------
// canonical 寫法（routine.md 1h 步驟 4）：單組一行一個 `- A：<按鈕文字>｜<影響>`（建議的寫 `- A（建議）：…`）；
// 多組每組前一行 `- 小題①：<這組在決定什麼>`，底下 `- A1：…`／`- A2：…`（下一組 B1／B2…）。
// 同時相容舊寫法 V1～V6（盤點 §2.2）：一行用「／」分開、`- 選項：` `- 要你回答：` 前綴、縮排的 `A 甲 → …`。
// V7（敘述型多組決定）不硬解，退回自由輸入。代號只認「行首」，不在整段文字裡抓 A1。
const OPT_LINE = /^([A-H][1-9]?)\s*(?:[（(]([^）)]*)[）)])?\s*[：:.、)）]\s*(.+)$/; // A：…　A1：…　A（建議）：…　A. …
const OPT_SEG = /^([A-H])(?:\s*[（(]([^）)]*)[）)])?(?:\s*[：:.、)）]\s*|\s+)(\S.*)$/; // 一行裡用「／」隔開的片段，允許「A 照做」
const OPT_ARROW = /^([A-H])\s+(\S.*→.*)$/; // V6：縮排的「A 原創 → 留這份…」（只認有縮排的行，避免誤抓敘述句）
const LETTERS_ONLY = /^[A-H](?:\s*(?:[、,，/／]|或者|或)\s*[A-H])+(?![A-Za-z0-9])/; // 「A、B 或 C，或自己定」是指示句不是選項（Q80）
const SUBQ_HEAD = /^小題\s*[①-⑳0-9一二三四五六七八九十]*\s*([（(][^）)]*[）)])?\s*[：:]\s*(.*)$/; // 組名行：`- 小題①：…`
const CIRCLED_HEAD = /^[①-⑳]\s*(.*)$/; // V6 小題標題：`- ① …`

function cutLabel(s) {
  let t = String(s).trim();
  const c = t.search(CIRCLED);
  if (c > 0) t = t.slice(0, c).trim(); // 「E 其他（寫一下）②有沒有…」後面接的是下一小題
  return t;
}

const stripBullet = (l) => String(l == null ? '' : l).replace(/^\s*(?:[-*]\s+)?/, '').trim();
const clipName = (s, n = 22) => { const a = [...String(s || '').replace(/\s+/g, ' ').trim()]; return a.length > n ? a.slice(0, n).join('') + '…' : a.join(''); };

// 從題目內文行抓出選項，回傳分好組的 [{name, multi, options:[{key, label, rec, group}]}]。
// 規則：
//  · 組：`- 小題N：` 或 `- ① …` 開新組；帶數字的代號（A1）字母換了也開新組（A1、A2 然後 B1、B2）；沒有標記就是一組
//  · 同一組裡同一個代號出現兩次 → 只放棄那一組（以前是整題放棄）
//  · 不同組出現同一個代號（例如三個小題各有 A／B）→ 代號無法對應，整題退回自由輸入
export function parseOptionGroups(bodyLines) {
  const groups = [];
  let cur = null;
  const open = (name = '', raw = name) => { cur = { name, raw, items: [], bad: false, digitLetter: '' }; groups.push(cur); return cur; };
  const add = (key, tag, label) => {
    if (!cur) open('');
    if (key.length > 1 && cur.items.length && cur.digitLetter && cur.digitLetter !== key[0]) open('');
    if (key.length > 1) cur.digitLetter = key[0];
    if (cur.items.some((o) => o.key === key)) { cur.bad = true; return; }
    cur.items.push({ key, label: cutLabel(label), rec: /建議/.test(tag || '') || /（建議|\(建議/.test(label) });
  };
  for (const raw of Array.isArray(bodyLines) ? bodyLines : []) {
    let t = stripBullet(raw);
    const sq = SUBQ_HEAD.exec(t);
    if (sq) { open(clipName(sq[2]), (sq[1] || '') + sq[2]); continue; }
    const ch = CIRCLED_HEAD.exec(t);
    if (ch) open(t[0] + ' ' + clipName(ch[1]), ch[1]);
    const pre = /^(?:選項|要你回答|要回答|回答|請選)[：:]\s*(.*)$/.exec(t);
    if (pre) t = pre[1];
    if (LETTERS_ONLY.test(t)) continue; // 「要你回答：A、B 或 C」這種指示句
    const segs = t.split(/\s*[／]\s*/);
    if (segs.length >= 2) {
      const ms = segs.map((x) => OPT_SEG.exec(x.trim()));
      // 第一段常常帶著題目的前文（「…題目 A：甲 ／ B：乙」）：往回找最後一個「A：」
      if (!ms[0] && ms.slice(1).some(Boolean)) ms[0] = /(?:^|[\s，。？?）)])([A-H])\s*[：:]\s*(\S.*)$/.exec(segs[0].trim());
      if (ms.filter(Boolean).length >= 2) {
        for (const m of ms) if (m) add(m[1], m[2], m[3] === undefined ? m[2] : m[3]);
        continue;
      }
    }
    const m = OPT_LINE.exec(t);
    if (m) { add(m[1], m[2], m[3]); continue; }
    const ar = /^\s{2,}|^\t/.test(String(raw == null ? '' : raw)) ? OPT_ARROW.exec(t) : null;
    if (ar) add(ar[1], '', ar[2]);
  }
  const good = groups.filter((g) => !g.bad && g.items.length);
  const seen = new Set();
  for (const g of good) for (const o of g.items) { if (seen.has(o.key)) return []; seen.add(o.key); }
  let n = 0;
  const out = [];
  for (const g of good) {
    if (n + g.items.length > 32) break; // 最多 32 個按鈕：A～H 8 組、每組 2～4 個（P50 套用檔 Q142 有 8 組 17 個，16 會掉最後一組）
    n += g.items.length;
    out.push({ name: g.name, multi: isMulti(g.raw), options: g.items });
  }
  return out;
}

// 舊介面（一維陣列，單組最多 8 個）：parseOptionGroups 攤平。每個選項多一個 group（第幾組）
export function parseOptions(bodyLines) {
  const gs = parseOptionGroups(bodyLines);
  const flat = gs.flatMap((g, gi) => g.options.map((o) => ({ ...o, group: gi })));
  return gs.length <= 1 ? flat.slice(0, 8) : flat;
}

// 「建議：A。…」→ 'A'；「建議：A1、B2」→ 'A1、B2'；沒寫回 ''
export function suggestedKey(bodyLines) {
  for (const raw of bodyLines || []) {
    const m = /^建議[：:]\s*([A-H][1-9]?(?:\s*[、,，]\s*[A-H][1-9]?)*)(?![A-Za-z0-9])/.exec(stripBullet(raw));
    if (m) return m[1].replace(/\s+/g, '');
  }
  return '';
}

// 已經變成按鈕的選項行（- A：…、- A1：…、縮排的 A 甲 → …、- 小題①：…）不用在說明裡再顯示一次
const OPT_LINE_ONLY = /^\s*(?:[-*]\s+)?[A-H][1-9]?\s*(?:[（(][^）)]*[）)])?\s*[：:.、)）]\s*\S/;
const OPT_ARROW_ONLY = /^(?:\s{2,}|\t)(?:[-*]\s+)?[A-H]\s+\S.*→/;
const SUBQ_ONLY = /^\s*(?:[-*]\s+)?小題\s*[①-⑳0-9一二三四五六七八九十]*\s*(?:[（(][^）)]*[）)])?\s*[：:]/;
export const bodyForDisplay = (body, options) => ((options || []).length ? (body || []).filter((l) => !OPT_LINE_ONLY.test(l) && !OPT_ARROW_ONLY.test(l) && !SUBQ_ONLY.test(l)) : (body || []));

export const isMulti =(text) => /可複選|複選|可多選|多選/.test(String(text || ''));
export const hasSuggest = (text) => /建議/.test(String(text || ''));

// ---------- Questions.md ----------
// 分類列：「分類：x｜期限：y｜卡住：z｜題型：動手｜動手狀態：進行中（10-29）」；沒有認得的 token 一律放進 tags
export const DOING_STATES = ['還沒做', '進行中', '已完成'];
const DOING_LINE = /^動手狀態[：:]\s*(還沒做|進行中|已完成)(?:\s*[（(]([^）)]*)[）)])?\s*(?:[｜|]\s*(.*))?$/;
function metaOf(line) {
  const out = { category: '', deadline: '', blocker: '', tags: [], type: '', doingState: '', doingAt: '' };
  for (const part of String(line).split('｜')) {
    const p = part.trim();
    let m;
    if ((m = /^分類[：:]\s*(.*)$/.exec(p))) out.category = m[1].trim();
    else if ((m = /^期限[：:]\s*(.*)$/.exec(p))) out.deadline = m[1].trim();
    else if ((m = /^卡住[：:]\s*(.*)$/.exec(p))) out.blocker = m[1].trim();
    else if ((m = /^題型[：:]\s*(動手|問題|選擇)\s*$/.exec(p))) out.type = m[1];
    else if ((m = DOING_LINE.exec(p))) { out.doingState = m[1]; out.doingAt = (m[2] || '').trim(); }
    else if (p) out.tags.push(p);
  }
  return out;
}

const NO_DEADLINE = new Set(['', '無', '—', '-', '不卡', '無期限']);
export const hasDeadline = (d) => !NO_DEADLINE.has(String(d || '').trim());

export function deadlineDate(d) {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  return m ? m[1] + m[2] + m[3] : null;
}

export const isSupplementSection = (s) => /^手機補答/.test(s || '');

// 手機補答區：回傳 Map(題號 → 答案文字)。答案範圍的算法跟 questions_sync.parse_questions 一樣（到 STOP 行為止，空行不算）
export function parseSupplements(text) {
  const lines = toLines(text);
  const out = new Map();
  let inSupp = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^## /.test(l)) { inSupp = isSupplementSection(l.replace(/^##\s+/, '').trim()); continue; }
    if (/^(已收到答案|（產生時間|---)/.test(l)) inSupp = false;
    const m = inSupp ? HEAD.exec(l) : null;
    if (!m) continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) if (/^#{2,3} /.test(lines[j]) || /^(已收到答案|（產生時間|---)/.test(lines[j])) { end = j; break; }
    const block = lines.slice(i + 1, end);
    const ai = block.findIndex((x) => /^答：/.test(x));
    let aend = block.length;
    if (ai >= 0) for (let j = ai + 1; j < block.length; j++) if (STOP_LINE.test(block[j])) { aend = j; break; }
    const ans = ai >= 0 ? [block[ai].replace(/^答：/, ''), ...block.slice(ai + 1, aend)].map((x) => x.trim()).filter(Boolean).join('\n') : '';
    out.set(m[1], out.has(m[1]) && out.get(m[1]) ? out.get(m[1]) + '\n' + ans : ans);
  }
  return out;
}

// 「已收到答案、等 routine 套用：Q170、Q191…」那一行（電腦收了答案、還沒套用）：回傳題號 Set
export function parseReceived(text) {
  const out = new Set();
  for (const l of toLines(text)) {
    const m = /^已收到答案[^：:]*[：:](.*)$/.exec(l);
    if (m) for (const x of m[1].matchAll(/(?:Q|KB)\d+/g)) out.add(x[0]);
  }
  return out;
}

// 這個題號在 Questions.md 的狀況（answerMany 決定寫去哪裡用）：
//  'writable'   有唯一的 ### 標題而且有「答：」→ 寫進去
//  'dup'        題號重複 → 不敢寫
//  'supplement' 出現過（沒有答欄的標題、擱置清單題、已收到答案那行、手機補答區已有）→ 寫進「## 手機補答」
//  'absent'     完全沒出現 → 不寫
export function qidKind(questionsText, qid) {
  const t = String(questionsText || '');
  if (countQuestion(t, qid) > 1) return 'dup';
  if (hasQuestion(t, qid)) return 'writable';
  if (parseQuestionBank(t).some((q) => q.qid === qid) || parseReceived(t).has(qid) || parseSupplements(t).has(qid)) return 'supplement';
  return 'absent';
}

// 回傳 [{qid,title,section,today,category,deadline,blocker,tags,body,answer,hasAnswerLine,dupCount,order}]
export function parseQuestionBank(text) {
  const lines = toLines(text);
  const out = [];
  let section = '';
  let today = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^## /.test(l)) { section = l.replace(/^##\s+/, '').trim(); today = section.includes('今日必答'); continue; }
    const m = HEAD.exec(l);
    if (m && isSupplementSection(section)) continue; // 手機補答區的標題不是題目本身（見 parseSupplements）
    if (!m) {
      // 擱置區是清單格式（沒有 ### 標題、沒有「答：」）：每個清單項目變成一張卡，作答時寫到 Live.md 對話
      const lm = isBacklogSection(section) ? LIST_HEAD.exec(l) : null;
      if (lm) {
        let title = lm[2].trim();
        let category = '';
        const cm = /[（(]([^（）()]{1,12})[）)]$/.exec(title);
        if (cm && !/題|^\d+$/.test(cm[1])) { category = cm[1]; title = title.slice(0, cm.index).trim(); }
        out.push({
          qid: lm[1], title, section, today: false, category, deadline: '', blocker: '', tags: [], body: [],
          answer: '', hasAnswerLine: false, dupCount: 0, order: out.length, backlog: true, listItem: true,
        });
      }
      continue;
    }
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) if (/^#{2,3} /.test(lines[j])) { end = j; break; }
    const block = lines.slice(i + 1, end);
    const ai = block.findIndex((x) => /^答：/.test(x));
    const before = ai >= 0 ? block.slice(0, ai) : block;
    // 答案範圍到 STOP 行為止（questions_sync.py:50、:221）：最後一題後面接 ---、（產生時間）的內容不算答案
    let aend = block.length;
    if (ai >= 0) for (let j = ai + 1; j < block.length; j++) if (STOP_LINE.test(block[j])) { aend = j; break; }
    const answer = ai >= 0 ? [block[ai].replace(/^答：/, ''), ...block.slice(ai + 1, aend)].map((x) => x.trim()).filter(Boolean).join('\n') : '';
    let k = 0;
    while (k < before.length && !before[k].trim()) k++;
    const hasMeta = /^分類[：:]/.test((before[k] || '').trim());
    const meta = hasMeta ? metaOf(before[k]) : { category: '', deadline: '', blocker: '', tags: [], type: '', doingState: '', doingAt: '' };
    const body = before.slice(hasMeta ? k + 1 : 0);
    while (body.length && !body[0].trim()) body.shift();
    while (body.length && !body[body.length - 1].trim()) body.pop();
    out.push({
      qid: m[1], title: m[2].trim(), section, today, ...meta, body,
      answer, hasAnswerLine: ai >= 0, dupCount: 0, order: out.length, backlog: isBacklogSection(section),
    });
  }
  const count = new Map();
  for (const q of out) if (!q.listItem) count.set(q.qid, (count.get(q.qid) || 0) + 1); // 清單項目不是 ### 題目，不算題號重複
  for (const q of out) q.dupCount = count.get(q.qid) || 0;
  return out;
}

// ---------- 選項分組（buildCards 與測試共用）----------
// 單組沒有自己的「可複選」字樣時，沿用整題文字判斷出來的 multi
function optionGroupsFor(body, multi) {
  const gs = parseOptionGroups(body);
  return gs.map((g) => ({ name: g.name, multi: g.multi || (gs.length === 1 && !!multi), keys: g.options.map((o) => o.key), options: g.options }));
}
const flatOptions = (groups) => {
  const flat = groups.flatMap((g, gi) => g.options.map((o) => ({ ...o, group: gi })));
  return groups.length <= 1 ? flat.slice(0, 8) : flat;
};

// ---------- 動手題 ----------
// 判斷順序：分類列 `題型：動手`／`題型：問題`（欄位優先）→ 沒有欄位時看標題開頭「動手：」（舊版 Questions.md、只在 Live 的卡都適用）
// 狀態：答案欄最後一行 `動手狀態：…` → 分類列的 `動手狀態：…` → 還沒做。（還沒送出的 outbox 優先，見 doingStatus）
const DO_TITLE = /^動手[：:]/;
export const isDoingTitle = (title) => DO_TITLE.test(String(title || '').trim());

// 答案文字裡最後一行 `動手狀態：<還沒做|進行中|已完成>（MM-DD HH:MM:SS）｜<備註>` → {state, at, note}；沒有回 null
export function parseDoingLine(text) {
  let out = null;
  for (const l of String(text == null ? '' : text).replace(/\r/g, '').split('\n')) {
    const m = DOING_LINE.exec(l.trim());
    if (m) out = { state: m[1], at: (m[2] || '').trim(), note: (m[3] || '').trim() };
  }
  return out;
}

const pad2 = (n) => String(n).padStart(2, '0');
// 要送出的答案一行。時間戳一定要帶，而且到秒（MM-DD HH:MM:SS，PO 10-29 QC 必修）：skipIfPresent 看「同內容是否已存在」，不帶時間的話「進行中 → 還沒做 → 進行中」第三次會被當成重複
export function doingAnswer(state, note, now = new Date()) {
  if (!DOING_STATES.includes(state)) throw new Error('不認得的動手狀態：' + state);
  const n = String(note || '').replace(/\s+/g, ' ').trim();
  return '動手狀態：' + state + '（' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()) + ' ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds()) + '）' + (n ? '｜' + n : '');
}

// 時間到秒以後同一秒內連點才可能產生一模一樣的一行；existing 裡已經有同一行就把時間往後挪一秒，確保每次都寫得進去
export function uniqueDoingAnswer(state, note, now, existing = []) {
  const have = new Set((existing || []).map((x) => String(x).trim()));
  let t = new Date(now.getTime());
  let a = doingAnswer(state, note, t);
  for (let i = 0; i < 60 && have.has(a); i++) { t = new Date(t.getTime() + 1000); a = doingAnswer(state, note, t); }
  return a;
}

export const DOING_KEY = { todo: '還沒做', doing: '進行中', done: '已完成' };
// 動手狀態回寫的 payload：走既有回答路徑（kind answer）；doing 欄只是標記，電腦端看的是 answer 那一行
export function doingPayload(card, state, note, now = new Date(), existing = []) {
  const answer = uniqueDoingAnswer(state, note, now, existing);
  const key = Object.keys(DOING_KEY).find((k) => DOING_KEY[k] === state);
  return { ...answerPayload(card, answer), doing: key };
}

function doingFor(type, title, answerText, metaState, metaAt) {
  const kind = type === '動手' || (type !== '問題' && isDoingTitle(title));
  if (!kind) return null;
  const line = parseDoingLine(answerText);
  if (line) return { state: line.state, at: line.at, note: line.note, from: 'answer' };
  if (metaState) return { state: metaState, at: metaAt, note: '', from: 'meta' };
  return { state: '還沒做', at: '', note: '', from: 'none' };
}

// 這張動手卡現在的狀態。pend：這題還沒送成功的 outbox 項目（可為 null）
// 回傳 {state, at, note, from:'outbox'|'answer'|'meta'|'none', answered}：answered＝已經用「選項／文字」另外回答過（不是動手狀態），這張卡不再算待動手
export function doingStatus(c, pend = null) {
  const d = c.doing || { state: '還沒做', at: '', note: '', from: 'none' };
  if (pend && pend.payload) {
    const line = parseDoingLine(pend.payload.answer);
    if (line) return { ...line, from: 'outbox', answered: false };
    return { ...d, from: 'outbox', answered: true };
  }
  const hasOther = !!String(c.answer || '').trim() && !parseDoingLine(c.answer);
  const gotOther = c.pcReceived && !c.stillYours && d.from !== 'answer';
  return { state: d.state, at: d.at, note: d.note, from: d.from, answered: hasOther || gotOther };
}

// 還要動手的卡（我要動手 N）：不是擱置、不是 ghost、狀態不是已完成、也沒有另外用選項回答過
export function isDoingOpen(c, pend = null) {
  if (!c.doing || c.backlog || c.ghost) return false;
  const s = doingStatus(c, pend);
  return s.state !== '已完成' && !s.answered;
}
// 動手區要列的卡（含已完成、已回答、等電腦收的，到它從 Questions.md 消失為止）：不含擱置與 ghost
export const doingCards = (cards) => (cards || []).filter((c) => c.doing && !c.backlog && !c.ghost);

// ---------- 合併 ----------
// waiting：parseWaiting(live) 的結果。回傳排序後的卡片陣列。
// 去重規則：同題號只留一張卡。card.source：
//  'questions'  Questions.md 有唯一的 ### 標題而且有「答：」→ 答案寫那裡（Live.md 的同題號項目附在卡片上當補充）
//  'supplement' Questions.md 出現過但沒有可寫的答欄（擱置清單題、已收到答案那行）→ 答案寫進「## 手機補答」
//  'dup'        題號重複 → 有回答按鈕，但送出時丟錯誤、什麼都不寫
//  'ghost'      只在 Live.md「等你」、Questions.md 完全沒有（或 Live 項目本身是 ✅）→ 灰色卡「電腦那邊可能已處理」，沒有回答按鈕
// card.pcReceived：題號在「已收到答案、等 routine 套用」那一行（電腦已收到，不算待答，只能補充）
export function buildCards(questionsText, waiting) {
  const text = questionsText || '';
  const bank = parseQuestionBank(text);
  const supp = parseSupplements(text);
  const got = parseReceived(text);
  const liveItems = (waiting || []).flatMap((g) => g.items.map((it) => ({ ...it, kind: g.kind })));
  const liveBy = new Map();
  for (const it of liveItems) {
    if (!liveBy.has(it.qid)) liveBy.set(it.qid, []);
    liveBy.get(it.qid).push(it);
  }
  const cards = [];
  const seen = new Set();
  // 同題號同時有正式 ### 題與擱置清單項目：以正式題為準（擱置清單只在沒有正式題時才用，不管誰排前面）
  const formal = new Set(bank.filter((q) => !q.listItem).map((q) => q.qid));
  for (const q of bank) {
    if (q.listItem && formal.has(q.qid)) continue;
    if (seen.has(q.qid)) continue; // 題號重複：只顯示第一張
    seen.add(q.qid);
    const live = (liveBy.get(q.qid) || []).filter((i) => !i.done); // ✅ 開頭的 Live 項目是已處理的，不算「還在等你」
    const all = [q.title, ...q.body].join('\n');
    const multi = isMulti(all);
    const groups = optionGroupsFor(q.body, multi);
    const options = flatOptions(groups);
    const writable = q.hasAnswerLine && q.dupCount === 1;
    const source = writable ? 'questions' : q.dupCount > 1 ? 'dup' : 'supplement';
    const ansText = writable ? q.answer : (supp.get(q.qid) || '');
    cards.push({
      qid: q.qid, title: q.title, source,
      // Live「等你」裡有這題＝還在待答，就算 Questions.md 把它放在擱置區也照 Live 算
      section: q.backlog && live.length ? 'Live.md 等你' : q.section, today: q.today, backlog: !!q.backlog && !live.length, category: q.category, deadline: q.deadline, blocker: q.blocker, tags: q.tags,
      body: q.body, options, groups, multi, suggest: hasSuggest(all), suggestKey: suggestedKey(q.body),
      answer: ansText, live, liveKind: live.length ? live[0].kind : '', order: q.order,
      pcReceived: !writable && source !== 'dup' && got.has(q.qid), ghost: false,
      doing: doingFor(q.type, q.title, ansText, q.doingState, q.doingAt), choice: q.type === '選擇',
    });
  }
  let n = bank.length;
  for (const [qid, items] of liveBy) {
    if (seen.has(qid)) continue;
    seen.add(qid);
    const alive = items.filter((i) => !i.done);
    const lines = items.flatMap((it) => it.lines || []);
    const first = items[0];
    const body = lines.map((x) => x.replace(/^\s+/, ''));
    const all = items.map((it) => it.text).join('\n');
    const received = got.has(qid);
    const ghost = !received && (!alive.length || !bank.some((q) => q.qid === qid)); // 沒出現在 Questions.md（也不在已收到那行）
    const liveGroups = optionGroupsFor(body.length ? body : [first.text], isMulti(all));
    cards.push({
      qid, title: String(first.head != null ? first.head : first.text).replace(/\s+/g, ' ').slice(0, 160), source: received ? 'supplement' : 'ghost', section: 'Live.md 等你', today: false, backlog: false,
      category: '', deadline: '', blocker: '', tags: [],
      body, options: flatOptions(liveGroups), groups: liveGroups, multi: isMulti(all), suggest: hasSuggest(all),
      suggestKey: suggestedKey(body), answer: received ? (supp.get(qid) || '') : '', live: items, liveKind: first.kind, order: n++,
      pcReceived: received, ghost,
      doing: doingFor('', String(first.head != null ? first.head : first.text), received ? (supp.get(qid) || '') : '', '', ''), choice: false,
    });
  }
  return sortCards(cards);
}

export function sortCards(cards) {
  // 有日期的期限排最前（越近越前面）；Live.md 標 ⏰ 的次之；「你下次清空…之前」這種沒日期的期限不排序，只在卡片上顯示
  const urgent = (c) => (deadlineDate(c.deadline) ? 0 : c.liveKind === 'deadline' ? 1 : 2);
  return [...cards].sort((a, b) => {
    const ua = urgent(a), ub = urgent(b);
    if (ua !== ub) return ua - ub;
    if (ua === 0) {
      const da = deadlineDate(a.deadline), db = deadlineDate(b.deadline);
      if (da !== db) return da < db ? -1 : 1;
    }
    if (a.today !== b.today) return a.today ? -1 : 1;
    return a.order - b.order;
  });
}

export function groupLabel(c) {
  if (deadlineDate(c.deadline) || c.liveKind === 'deadline') return '⏰ 有期限';
  if (c.today) return '📝 今日必答';
  return c.category || (c.section === 'Live.md 等你' ? '其他（Live.md 等你）' : '其他');
}

// ---------- 狀態 ----------
// 送出紀錄 rec：{qid, at, text, summary, target:'questions'|'supplement', received:false}（存在手機，見 local.js 的 loadSent/saveSent）
// 「電腦已收到」的判斷（整個流程只靠這一條）：
//  · 寫進 Questions.md 答欄或「## 手機補答」的答案：questions_sync.collect 收回後會把「答：」之後的內容清空（questions_sync.py:309-312），
//    重建後補答區也不見。所以這題的答案欄變回空白、或題目整個不見＝已收到。
// 推測：使用者自己手動清空答案也會誤判，只影響畫面文字，不影響資料。
export function reconcile(sent, cards) {
  const byQid = new Map(cards.map((c) => [c.qid, c]));
  for (const rec of sent) {
    if (rec.received) continue;
    const c = byQid.get(rec.qid);
    if (!c || !c.answer) rec.received = true;
  }
  return sent;
}

// Questions.md 讀不到（404 → 空字串）時，所有題目都「不見了」，不能因此把送出紀錄全標成已收到（QC 建議 5）
export function reconcileIfLoaded(sent, cards, questionsText) {
  if (!String(questionsText || '').trim()) return sent;
  return reconcile(sent, cards);
}

export const RECEIVED_SHADOW_MS = 24 * 3600 * 1000; // 「已收到」的紀錄超過一天就不再蓋住卡片：題目又出現在 Questions.md 代表 Agent 重新問了

// 'open' 待答｜'sent' 已送出（送了還沒被電腦收，或檔案裡已有答案）｜'received' Agent 已收到（這次送的）
// 'pc' 電腦已收到（題號在「已收到答案」那一行，不算待答）｜'ghost' 電腦那邊可能已處理（只在 Live「等你」）
// v4 M3：pend（Map 題號 → outbox 項目，只放還沒送成功的）有這題 →
//   'queued' 排隊中或送出中（已存在手機）｜'failed' 沒送出（非網路錯誤，要重試或刪除）。這兩種都不算待答
export function cardState(card, sent, now = Date.now(), pend = null) {
  if (card.ghost) return 'ghost';
  const pi = pend && pend.get ? pend.get(card.qid) : null;
  if (pi) return pi.state === 'failed' ? 'failed' : 'queued';
  const rec = [...sent].reverse().find((r) => r.qid === card.qid && !(r.received && now - r.at > RECEIVED_SHADOW_MS));
  if (rec) return rec.received ? (card.pcReceived ? 'pc' : 'received') : 'sent';
  if (card.answer) return 'sent';
  return card.pcReceived && !card.stillYours ? 'pc' : 'open';
}

// v4.2：已收到、但還有你要做的題（stillYours）。兩個來源：
//  1) 電腦狀態檔 questions[].stillYours（題庫狀態欄含等你／待你／還沒答／未答）；題目不在 Questions.md 也不在 Live 時補一張卡
//  2) Live「等你」裡帶小題號（①～⑳）、文字含「等你」的項目，而且題號在「已收到答案」那行
// 回傳新的卡片陣列（不改原陣列）；stillYours 的卡片在 cardState 沒有別的狀態時算待答（'open'）
const SUBNUM = /^[①-⑳]/;
export function applyStillYours(cards, pcQuestions = []) {
  const mark = new Map((pcQuestions || []).filter((q) => q && q.stillYours).map((q) => [q.id, q]));
  const out = cards.map((c) => {
    const viaLive = c.pcReceived && (c.live || []).some((i) => !i.done && SUBNUM.test(i.sub || '') && /等你/.test(i.text || ''));
    return c.pcReceived && (mark.has(c.qid) || viaLive) && !c.backlog ? { ...c, stillYours: true } : c;
  });
  const have = new Set(cards.map((c) => c.qid));
  let n = cards.length;
  for (const [qid, q] of mark) {
    if (have.has(qid)) continue;
    out.push({
      qid, title: String(q.title || qid).replace(/\s+/g, ' ').slice(0, 160), source: 'supplement', section: '電腦已收到', today: false, backlog: false,
      category: '', deadline: '', blocker: '', tags: [], body: [], options: [], groups: [], multi: false, suggest: false, suggestKey: '',
      answer: '', live: [], liveKind: '', order: n++, pcReceived: true, ghost: false, stillYours: true, doing: null, choice: false,
    });
  }
  return out;
}

// 擱置區的題目不算待答（不進數字、不進「回答下一題」）
export const openCards = (cards, sent, pend = null) => cards.filter((c) => !c.backlog && !c.doing && cardState(c, sent, Date.now(), pend) === 'open'); // 動手題不算問題（在任務頁的動手區）

// ---------- 組答案 ----------
// letters：選到的選項代號（照選項順序）；text：自由文字。多選用頓號串起來；有自由文字接在後面
export function composeAnswer(letters, text, order = 'ABCDEFGH') {
  const ls = [...new Set(letters || [])].sort((a, b) => order.indexOf(a) - order.indexOf(b)); // order 可以是字串（單字母）或代號陣列（A1、B2…）
  const t = String(text || '').trim();
  if (ls.length && t) return ls.join('、') + '；' + t;
  if (ls.length) return ls.join('、');
  return t;
}

export function summarize(answer, max = 40) {
  const s = String(answer || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// 寫入項目（answerMany 的 items）：title 給「## 手機補答」新區塊當標題用
export function writeItems(card) {
  if (card.source === 'questions') return [{ qid: card.qid, sub: '', title: card.title }];
  return card.live.length ? card.live.map((i) => ({ qid: i.qid, sub: i.sub, label: i.label, text: i.text, title: card.title })) : [{ qid: card.qid, sub: '', title: card.title }];
}

// 回答 → outbox 的 payload（app.js 的 sendAnswer 與測試共用，離線重開後送出的內容跟當下按下去的一模一樣）
export function answerPayload(card, answer) {
  const quick = answer === QUICK.suggest;
  return {
    qid: card.qid, answer, summary: summarize(answer), title: card.title, items: writeItems(card),
    quick: quick ? 'suggest' : '', viaLive: quick && card.source !== 'questions' && card.live.length > 0,
  };
}
