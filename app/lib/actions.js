// 把「讀最新 → 改一小段 → 寫回」的流程包起來（client 可替換成 mock）
import { GitHubError } from './github.js';
import { parseWaiting } from './parse.js';
import { applyJournal, applyJournalEdit } from './journal.js';
import { answerQuestion, appendChat, appendChatOnce, appendSupplement, insertTask, insertTaskV3, insertNote } from './edit.js';
import { addTaskSubline, checkTask } from './taskedit.js';
import { qidKind } from './questions.js';

export const FILES = { live: 'Live.md', questions: 'Questions.md', task: 'Task.md', project: 'Project.md' }; // project 唯讀
export const MSG = {
  live: 'Update Live.md (手機)',
  questions: 'Update Questions.md (手機)',
  task: 'Update Task.md (手機)',
};

export function sendChat(client, content, d = new Date()) {
  return client.updateFile(FILES.live, (t) => appendChat(t, content, d), MSG.live);
}

// 重送不重複版：同一行（含時間戳）已經在對話區就不再加
export function sendChatOnce(client, content, d = new Date()) {
  return client.updateFile(FILES.live, (t) => appendChatOnce(t, content, d), MSG.live);
}

// 升格請求、維持任務（§6 第 4 題 A）：不進對話區，改成 Task.md 該任務底下的一個子行。
// 找不到任務、有好幾筆同名 → 丟 blocked 錯誤（outbox 標成失敗並講原因）；同一子行已存在 → noop
export async function markTask(client, title, line) {
  let last = null;
  const res = await client.updateFile(FILES.task, (t) => {
    last = addTaskSubline(t, title, line);
    if (last.action === 'missing') throw blocked('在 Task.md 找不到這件任務（可能已經完成或被清掉），沒有送出', 'missing', []);
    if (last.action === 'ambiguous') throw blocked('Task.md 有 ' + last.count + ' 筆同名的任務，分不出是哪一筆，沒有送出；請到電腦處理', 'ambiguous', []);
    return last.text;
  }, MSG.task);
  return { ...res, action: last ? last.action : 'noop' };
}

// 提醒打勾完成（2026-10-30）：未打勾那筆改成 [x]＋結果子行；已經打勾了＝noop（不重寫）
export async function doneTask(client, title, line) {
  let last = null;
  const res = await client.updateFile(FILES.task, (t) => {
    last = checkTask(t, title, line);
    if (last.action === 'missing') throw blocked('在 Task.md 找不到這件提醒（可能已經被清掉），沒有送出', 'missing', []);
    if (last.action === 'ambiguous') throw blocked('Task.md 有 ' + last.count + ' 筆同名的提醒，分不出是哪一筆，沒有送出；請到電腦處理', 'ambiguous', []);
    return last.text;
  }, MSG.task);
  return { ...res, action: last ? last.action : 'noop' };
}

// 同題號的小題（①②…）合併成一組：一題一行
export function groupByQid(items) {
  const map = new Map();
  for (const it of items) {
    if (!map.has(it.qid)) map.set(it.qid, []);
    const subs = map.get(it.qid);
    const s = it.sub || '';
    if (!subs.includes(s)) subs.push(s);
  }
  return [...map].map(([qid, subs]) => ({ qid, subs }));
}

const answerText = (subs, content) => (subs.some(Boolean) ? subs.filter(Boolean).map((s) => s + content).join(' ') : content);

function blocked(message, code, qids) {
  const e = new Error(message);
  e.blocked = true; e.code = code; e.qids = qids;
  return e;
}

// items: [{qid, sub?, title?}]。v4 M2：答案「絕不」寫進 Live.md 對話區，只有兩個去處：
//  · Questions.md 有唯一的 ### 標題而且有「答：」→ 寫那裡（①②小題合成「①答案 ②答案」）
//  · 出現過但沒有可寫的答欄（擱置清單題、已收到答案那行、手機補答區已有）→ 寫進「## 手機補答」新區塊
// 完全沒出現（只在 Live「等你」）、題號重複、Questions.md 讀不到 → 丟錯誤、什麼都不寫（呼叫端的草稿留著）
// opts.dedupe：答案已經在檔案裡就不重寫（重送／網路逾時後再按都不會變兩份）
export async function answerMany(client, items, content, d = new Date(), opts = {}) {
  const dedupe = !!opts.dedupe;
  const groups = groupByQid(items);
  const titles = new Map();
  for (const it of items) if (it.title && !titles.has(it.qid)) titles.set(it.qid, it.title);
  let written = [];
  let supplement = [];
  let q;
  try {
    q = await client.updateFile(FILES.questions, (t) => {
      written = []; supplement = [];
      const kinds = groups.map((g) => [g, qidKind(t, g.qid)]);
      // 先全部檢查，有一題不能寫就整批不寫
      const dup = kinds.filter(([, k]) => k === 'dup').map(([g]) => g.qid);
      if (dup.length) throw blocked('這題在題目檔重複，先不送，請到電腦確認（' + dup.join('、') + '）', 'dup', dup);
      const absent = kinds.filter(([, k]) => k === 'absent').map(([g]) => g.qid);
      if (absent.length) throw blocked('這題在題目檔找不到（電腦那邊可能已處理），先不送（' + absent.join('、') + '）', 'absent', absent);
      let cur = t;
      for (const [g, k] of kinds) {
        const text = answerText(g.subs, content);
        if (k === 'writable') { cur = answerQuestion(cur, g.qid, text, { skipIfPresent: dedupe }); written.push(g.qid); }
        else { cur = appendSupplement(cur, g.qid, titles.get(g.qid) || g.qid, text, { skipIfPresent: dedupe }); supplement.push(g.qid); }
      }
      return cur;
    }, MSG.questions);
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) throw blocked('讀不到題目檔，先不送，請到電腦確認（Questions.md）', 'no-file', []);
    throw e;
  }
  return { questions: q, live: null, missing: [], duplicates: [], written, supplement };
}

export const hasSuggestion = (it) => /建議/.test(it.text || '');

// 「照建議」：只送文字含「建議」、而且送出前重抓 Live.md 後還在「等你」裡的題目
export async function answerSuggested(client, items, d = new Date(), opts = {}) {
  const fresh = await client.getFile(FILES.live);
  const still = new Set(parseWaiting(fresh.text).flatMap((g) => g.items.map((i) => i.label)));
  const ok = items.filter((it) => hasSuggestion(it) && still.has(it.label));
  if (!ok.length) return null;
  const r = await answerMany(client, ok, '照建議', d, opts);
  r.sent = ok;
  return r;
}

export function addTask(client, tag, content) {
  return client.updateFile(FILES.task, (t) => insertTask(t, tag, content), MSG.task);
}

// 日記：找 Task.md 裡當天的 [journal] 模板填入，沒有才新增一筆（細節見 journal.js）
export async function submitJournal(client, payload) {
  let last = null;
  const res = await client.updateFile(FILES.task, (t) => {
    last = applyJournal(t, payload);
    if (last.action === 'blocked') {
      const e = new Error('今天的日記已經被 Agent 收錄了，要補充請到「對話」頁留言');
      e.blocked = true;
      throw e;
    }
    return last.text;
  }, MSG.task);
  return { ...res, action: last ? last.action : 'noop' };
}

// v3 第 3 階段：新增任務（含專案／期限）。noop＝同樣內容已經在任務清單裡
export async function addTaskV3(client, opts) {
  let last = null;
  const res = await client.updateFile(FILES.task, (t) => { last = insertTaskV3(t, opts); return last.text; }, MSG.task);
  return { ...res, action: last ? last.action : 'noop' };
}

// 新增筆記（寫進 Task.md，標題含「📝 筆記」）
export async function addNote(client, opts) {
  let last = null;
  const res = await client.updateFile(FILES.task, (t) => { last = insertNote(t, opts); return last.text; }, MSG.task);
  return { ...res, action: last ? last.action : 'noop' };
}

// 日記三題改寫（payload：{now, day, answers, base}）。已收錄擋下來
export async function submitJournalEdit(client, payload) {
  let last = null;
  const res = await client.updateFile(FILES.task, (t) => {
    last = applyJournalEdit(t, payload);
    if (last.action === 'blocked') {
      const e = new Error('這天的日記已經被 Agent 收錄了，要補充請到「對話」頁留言');
      e.blocked = true;
      throw e;
    }
    if (last.action === 'missing') throw new Error('Task.md 找不到那天的日記條目');
    return last.text;
  }, MSG.task);
  return { ...res, action: last ? last.action : 'noop', points: last && last.points ? last.points : [] };
}
