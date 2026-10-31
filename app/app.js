import { createClient, GitHubError, normalizeRepo, normalizePrefix } from './lib/github.js';
import { errMsg } from './lib/errmsg.js';
import { parseLive } from './lib/parse.js';
import { parseThreads, splitRecentThreads, systemLine } from './lib/chat.js';
import { buildActivity } from './lib/activity.js';
import {
  MISSING, pkey, waitText, allProjects, sortProjects, filterBy, PFILTERS, STATUS_TEXT, isWaiting, isEmptyCell, hasDeadlineText, rankOf, projectSummary, relatedQids, projectsByQid,
} from './lib/projectview.js';
import { renderMarkdown, inline } from './lib/md.js';
import { FILES } from './lib/actions.js';
import { newId, createItem, loadOutbox, syncOutbox, dropOutbox, retryAll, processOutbox, retry as retryOb, removeItem as removeOb, editPayload, outboxCounts } from './lib/outbox.js';
import { executeItem } from './lib/outbox_exec.js';
import { buildMineCtx, deriveMine, filterMine, filterCounts, groupByDate, notReceivedCount, queuedCount, purgeIds, failedCount, todoPass, FILTERS } from './lib/mine.js';
import { readState, usableState, STATE_FILE } from './lib/pcstate.js';
import { getDraft, setDraft, clearDraft, clearAllDrafts, useStorage, hasDraft, setEdit, appendDraft } from './lib/drafts.js';
import {
  buildCards, applyStillYours, answerPayload, bodyForDisplay, reconcileIfLoaded, cardState, openCards, composeAnswer, summarize, writeItems, groupLabel, hasDeadline, deadlineDate, QUICK,
  parseDoingLine, doingPayload, doingStatus, isDoingOpen, doingCards,
} from './lib/questions.js';
import { journalStatus, mdLabel, WEEKDAYS, JOURNAL_QUESTIONS, readJournal, journalDays, pointStatus } from './lib/journal.js';
import {
  parseTasks, groupTasks, tlabel, tasksOfProject, tasksOfQuestion, parseRemindSettings, ctxPrefix, withCtx, parseCtx, escalateLine, wantsPromote, promoteDefaults, promoteLine, STATE_ICON,
} from './lib/tasks.js';
import { PROMOTE_CLEAR_STATES } from './lib/local.js';
import { KEYS, memStorage, loadSent, saveSent, loadTnum, saveTnum, loadAccepted, addAccepted, loadRecentP, pushRecentP, clearLocalState, projectOptions, loadPromoteReq, addPromoteReq, removePromoteReq, promoteStale, loadHomeMore, saveHomeMore, loadQGroups, saveQGroups, loadQSort, saveQSort } from './lib/local.js';
import { formatUpdated, isStale, STALE_MINUTES, updatedAgeMinutes, agentStatus, runningNow, remoteActive, syncStatus, latestPcPush, readHealth, tabFromParam, chatReplyHint } from './lib/status.js';
import { projectSection } from './lib/projects.js';
import { quotaBest, sevOf, SEV_TEXT } from './lib/quota.js';
import { AGENT_NAME, AGENT_ICON } from './lib/brand.js';
import { SORTS, groupCards, isCollapsed, toggledCollapsed } from './lib/qlist.js';
import { routineView, routinePrefixes, oneTimeReminders, remindTabSections, dueText, routinesStaleNote, isoOf } from './lib/reminders.js';
import { buildReminders, visibleRows, statusLineView, moreSummary, journalIcon, nowStatusView } from './lib/home.js';
import { convertCommits } from './lib/commits.js';
import { createVault, validPin, MAX_FAILS } from './lib/pin.js';
import { saveCache as saveCacheLib, loadCache as loadCacheLib, clearCache } from './lib/cache.js';
import { RECORD_FILES, RECORD_SCHEMA_FILE } from './lib/github.js';
import { mergeRecordOp, newRecordId, isoLocal } from './lib/records.js';
import { buildRecord } from './lib/records_schema.js';
import { createRecordsUI } from './lib/records_ui.js';
import { REPORT_INDEX, KINDS as REPORT_KINDS, parseReportIndex, reportPath, reportsSummary } from './lib/reports.js';
import { TASK_TABS, resolveTaskTab, taskTabOfGroup, taskTabForOpen, lockDoingTab, ACTIVE_GROUPS, REC_TABS, resolveRecTab, tabBar } from './lib/tabs.js';

const CFG_KEY = 'agent.config';
const CACHE_KEY = 'agent.cache';
const params = new URLSearchParams(location.search);
const demo = params.get('demo') === '1'; // 示範模式：不讀 localStorage、不呼叫 API
const TITLES = { home: '首頁', record: '紀錄', chat: AGENT_NAME, tasks: '任務', projects: '專案', todo: '問題', more: '更多', feed: '動態', health: '健康狀態', settings: '設定', mine: '我寫過的', reminders: '提醒事項', reports: '報表' };
const MAIN_TABS = ['home', 'record', 'chat', 'todo', 'tasks']; // 底部導覽五格（中央是對話；v4.1 問題取代專案）
const MORE_PAGES = ['projects', 'more', 'feed', 'health', 'settings', 'mine', 'reminders', 'reports']; // 次要頁：底部沒有高亮，標題列左邊有「‹ 返回」
const WORK_HINT = '工作細節用泛稱'; // Q207 還沒答，先放中性提醒
// D3：首頁狀態列放第一（true，建議 A）；改成 false 就變成「提醒在最上、狀態列第二」（B）
const STATUS_FIRST = true;
const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const scrollBehavior = () => (reduceMotion() ? 'auto' : 'smooth');

const state = {
  tab: 'home', cfg: null, client: null, data: null, token: '', locked: false,
  offline: false, error: '', loading: false,
  // 草稿在 lib/drafts.js（存這台手機，agent.draft.*）；sent＝送出的答案紀錄（存這台手機 agent.sent，保留 14 天，重開 App 還在）
  sent: [], sel: {}, openQ: undefined, qfilter: 'important', autoQ: null, qsort: 'important', qgroups: null, lastDrawDay: '', qproj: 'all', jsent: {},
  expanded: new Set(), pfilter: '進行中',
  lastMain: 'home', backTo: '', doingNote: null, rtab: 'journal', ttab: null, jday: 'today', jbase: null,
  tf: { open: false, mode: 'auto', pid: '', deadline: '', type: 'agent' }, nf: { source: '', url: '' }, chatCtx: null,
  tnum: { next: 1, map: {} }, accepted: new Set(), recentP: [],
  stOpen: false, remAll: false, promoteReq: {}, pf: null, rform: null, // rform：提醒的完成／回覆小表單 {key, mode}
  // 狀態列細節、提醒「還有 N 件」、升格請求（任務雜湊→時間）、升格表單
  pending: false, lastFetch: 0, gen: 0, wantTab: '', recDirty: false, // recDirty：剛寫過紀錄，下一次 refresh 重抓紀錄檔
  // v4 M3：寫入紀錄（outbox，存這台手機 agent.outbox）、是否正在送、最後一次送成功的時間（右上角小提示用）、我寫過的頁的篩選與展開
  ob: [], obRev: 0, flushing: false, lastSentAt: 0, noFlush: false, mfilter: 'all', mopen: null,
  obUnsaved: false, obDeleted: new Set(), // v4.3：寫入紀錄存不進手機（空間不足）；本分頁刪掉的編號（跟別的分頁合併時不要復活）
};
const UNSAVED_MSG = '⚠ 手機空間不足，這筆只在畫面上，先不要關 App，等它送出';

const $ = (id) => document.getElementById(id);
const vault = demo ? null : createVault(localStorage);
const ls = demo ? memStorage() : localStorage; // 示範模式的草稿與 T 編號都只放記憶體

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid);
  return e;
}

// 會用 innerHTML 的地方只有 mdBlock／inlineHtml：內容一律先經過 renderMarkdown / inline（已 escape）
function mdBlock(text, cls = 'md') {
  const d = h('div', { class: cls });
  d.innerHTML = renderMarkdown(text);
  return d;
}
function inlineHtml(text, cls = '') {
  const d = h('div', { class: cls });
  d.innerHTML = inline(text);
  return d;
}

const hhmm = (ts) => {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};

let toastTimer = 0;
let toastSticky = false;
function toast(msg, isErr = false, sticky = false) {
  const t = $('toast');
  // 寫入紀錄沒存進手機時，不能說「已存手機」：改成持續顯示的紅字提示
  if (state.obUnsaved && /已存手機/.test(msg)) { msg = UNSAVED_MSG; isErr = true; sticky = true; }
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastSticky = sticky;
  if (!sticky) toastTimer = setTimeout(() => { t.hidden = true; }, isErr ? 6000 : 3500);
}

// ---------- 設定與快取 ----------
function loadCfg() {
  if (demo) return { repo: 'demo/demo', branch: 'main', token: '', prefix: '' };
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || null; } catch (e) { return null; }
}
function saveCfg(cfg) { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }
// 離線快取（v5 M3）：PIN 關著明文照舊；PIN 開著改存「用 vault 金鑰 AES-GCM 加密」的版本，解鎖後才讀得到（lib/cache.js）
async function loadCache() {
  if (demo) return null;
  return loadCacheLib(localStorage, { pin: !!(state.cfg && state.cfg.pin), key: vault ? vault.cacheKey() : null });
}
let cacheChain = Promise.resolve();
function saveCache() {
  if (demo || !state.data) return;
  // 開 PIN 時不留明文快取（10-26 查核：PIN 只鎖 token、快取卻是明文，同網域頁面讀得到）：lib/cache.js 開 PIN 時一律刪明文、只存加密版
  const pin = !!(state.cfg && state.cfg.pin);
  const snap = state.data;
  cacheChain = cacheChain.then(() => saveCacheLib(localStorage, snap, { pin, key: vault ? vault.cacheKey() : null })).catch(() => {});
}

function makeClient(cfg, token) {
  if (demo) return demoClient();
  const [owner, repo] = cfg.repo.split('/');
  return createClient({ owner, repo, branch: cfg.branch || 'main', token, prefix: cfg.prefix || '' });
}

// 示範模式用的記憶體 client：只在頁面裡，不連網路
let demoStore = null;
function demoClient() {
  return {
    async getFile(path) { return { text: demoStore[path], sha: 'demo' }; },
    async updateFile(path, mutate) {
      const next = mutate(demoStore[path]);
      const changed = next !== demoStore[path];
      demoStore[path] = next;
      return { text: next, changed, tries: 1 };
    },
    async listCommits() { return demoStore.commits; },
  };
}

// 示範用報表（全是假內容、假數字）：週回顧 8 份（測「更早的」收起）、月報 2 份；?noreports=1 模擬電腦還沒推送
function demoReports(now) {
  const iso = now.toISOString();
  const items = [];
  const files = {};
  for (let i = 0; i < 8; i++) {
    const id = '2030-W' + String(20 - i).padStart(2, '0');
    const file = 'weekly-' + id + '.md';
    items.push({ kind: 'weekly', id, title: '週回顧 ' + id + '（範例）', file, updated: iso });
    files['mobile/reports/' + file] = ['# 週回顧 ' + id + '（範例）', '', '> 示範資料，不是真的週報。', '', '## 一句話', '假的一句話摘要。', '',
      '## 本週完成', '- **假專案**：做完第一步', '- 假的生活事項', ''].join('\n');
  }
  for (const id of ['2030-04', '2030-03']) {
    const file = 'monthly-' + id + '.md';
    items.push({ kind: 'monthly', id, title: id + ' 個人月報（範例）', file, updated: iso });
    files['mobile/reports/' + file] = ['# ' + id + ' 個人月報（範例）', '', '## 財務', '', '| 項目 | 月底 | 較上月 |', '|---|---|---|',
      '| 範例帳戶 | NT$123,456 | +1,234（+1.0%） |', '| 範例外幣 | USD$1,000 | -10（-1.0%） |', '', '## 我做了什麼', '- 假的工作事項', ''].join('\n');
  }
  return { 'mobile/reports/index.json': JSON.stringify({ version: 1, generated_at: iso, items }), ...files };
}

// 示範用 mobile/state.json（電腦端狀態投影檔的假資料）：電腦 20 分鐘前推送過，Q811 已收到，兩筆假任務一筆處理中一筆完成
function demoState(now) {
  const iso = (ms) => new Date(ms).toISOString();
  const md = (d) => String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return {
    version: 1, generated_at: iso(now.getTime() - 20 * 60000), pc: { last_seen: iso(now.getTime() - 20 * 60000), source: 'routine' },
    remote: { on: false, until: null },
    questions: [{ id: 'Q811', title: '假題目：已收到的題', status: '已收到', answered: md(now), answer: '補充一句假的', still_yours: false },
      { id: 'Q812', title: '假題目：已收到但還要你動手', status: '已收到', answered: '', answer: '', still_yours: true }],
    quota: { h5: 12, h5_reset: iso(now.getTime() + 4 * 3600000), d7: 61, d7_reset: iso(now.getTime() + 3 * 86400000), read_at: iso(now.getTime() - 60000) },
    tasks: [
      { mid: 'm-demo0002', title: '整理假會議紀錄', state: 'open', result: null, progress: '整理到第三段', date: md(now) },
      { mid: 'm-demo0003', title: '寄出假報告', state: 'done', result: '已寄出（假）', progress: null, date: md(now) },
    ],
    journal: [], truncated: 0,
  };
}

// 示範用「我寫過的」（?seed=outbox）：各種狀態都有；不會真的送（state.noFlush），截圖才看得到排隊中
function demoOutbox(now) {
  const t = now.getTime();
  const MIN = 60000;
  const d = new Date(t);
  const mk = (id, kind, payload, ago, patch = {}) => ({ ...createItem(kind, payload, t - ago * MIN, id), ...patch });
  const dk = String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const q = (qid, answer, title) => ({ qid, answer, summary: summarize(answer), title, items: [{ qid, sub: '', title }], quick: '', viaLive: false });
  return [
    mk('m-demo0001', 'task', { tag: 'agent', content: '整理本週假簡報的假重點\n補上假附件', project: 'auto', deadline: '', where: '手機 App 任務頁' }, 3, { err: '連不上網路，連上後會自動再送' }),
    mk('m-demo0004', 'note', { content: '假筆記：下次開會先講假結論', source: '假來源', url: '' }, 1, { state: 'sending', attempts: 1 }),
    mk('m-demo0005', 'answer', q('Q803', '先照假建議做', '假題目：自由回答，沒有選項'), 120, { state: 'failed', attempts: 1, err: '這題在題目檔重複，先不送，請到電腦確認（Q803）', code: 'dup' }),
    mk('m-demo0006', 'journal', { day: { month: d.getMonth() + 1, day: d.getDate() }, dk, answers: ['假里程碑：把假報告寄出', '', ''], base: ['', '', ''] }, 300, { state: 'sent', sentAt: t - 299 * MIN }),
    mk('m-demo0007', 'chat', { content: '幫我看一下假報告寄出了沒' }, 40, { state: 'sent', sentAt: t - 39 * MIN }),
    mk('m-demo0008', 'answer', q('Q811', '補充一句假的', '假題目：已收到的題'), 24 * 60 + 30, { state: 'sent', sentAt: t - (24 * 60 + 29) * MIN }),
    mk('m-demo0002', 'task', { tag: 'agent', content: '整理假會議紀錄', project: 'auto', deadline: '', where: '手機 App 任務頁' }, 24 * 60 + 90, { state: 'sent', sentAt: t - (24 * 60 + 89) * MIN }),
    mk('m-demo0003', 'task', { tag: 'agent', content: '寄出假報告', project: 'P901', deadline: '', where: '手機 App 任務頁' }, 3 * 24 * 60, { state: 'sent', sentAt: t - (3 * 24 * 60 - 1) * MIN }),
    mk('m-demo0009', 'keep', { title: '假任務：已經不在清單的那件', key: 'deadbeef', tnum: 9 }, 3 * 24 * 60 + 5, { state: 'sent', sentAt: t - (3 * 24 * 60 + 4) * MIN }),
  ];
}

// 示範用 Live.md：最後更新改成「現在往前 5 分鐘」（不然假日期會顯示成資料過期），並補一段假額度（讀不到額度的畫面測試另有 fixture）
function demoLive(text, now) {
  const p2 = (n) => String(n).padStart(2, '0');
  const at = (ms) => new Date(now.getTime() + ms);
  const hm = (d) => p2(d.getHours()) + ':' + p2(d.getMinutes());
  const md = (d) => p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  const reset = at(3 * 86400000 + 3600000);
  const quota = ['<!-- 額度 -->', '- **5 小時**：42%（這個窗口 ' + hm(at(-2 * 3600000)) + '～' + hm(at(3 * 3600000)) + '）', '- **weekly**：86%（' + p2(reset.getMonth() + 1) + '/' + p2(reset.getDate()) + '（三）' + p2(reset.getHours()) + ':00 重置）', '- 數字讀取時間 ' + hm(at(-180000)), '<!-- /額度 -->', ''].join('\n');
  // {{MD-N}}＝N 天前的 MM-DD（對話串的日期，讓「最近 3 天」「更早的對話」永遠對得上）
  const days = (t) => t.replace(/\{\{MD-(\d+)\}\}/g, (_, n) => md(new Date(now.getFullYear(), now.getMonth(), now.getDate() - Number(n))));
  return days(text.replace('> 最後更新 03-05 14:20', '> 最後更新 ' + md(at(-300000)) + ' ' + hm(at(-300000))).replace('\n## 🏃 現在', '\n' + quota + '\n## 🏃 現在'));
}

// 示範用 commits：整串時間平移到「最新一筆是 25 分鐘前」（電腦同步狀態列才不會永遠是離線）
function demoCommits(list, now) {
  const dates = list.map((c) => Date.parse(c.commit.author.date));
  const shift = now.getTime() - 25 * 60000 - Math.max(...dates);
  return list.map((c, i) => ({ ...c, commit: { ...c.commit, author: { ...c.commit.author, date: new Date(dates[i] + shift).toISOString() } } }));
}

// 示範用 Task.md 裡的 {{TODAY}}／{{YESTERDAY}} 換成當天與昨天的 MM/DD（日記頁才看得到「今天」與「昨天」）
function demoTask(text, now) {
  const md = (d) => String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
  // {{SLASH-N}}＝N 天前的 MM/DD（提醒標題裡的日期，示範「過期提醒」）
  const sl = (t) => t.replace(/\{\{SLASH-(\d+)\}\}/g, (_, n) => md(new Date(now.getFullYear(), now.getMonth(), now.getDate() - Number(n))));
  return sl(text).split('{{TODAY}}').join(md(now)).split('{{YESTERDAY}}').join(md(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)));
}

// 示範資料裡的 {{D+N}}／{{D-N}} 換成「今天加減 N 天」的 YYYY-MM-DD（讓提醒的逾期、明天、N 天後永遠對得上）
function demoDates(text, now) {
  return text.replace(/\{\{D([+-])(\d+)\}\}/g, (_, sg, n) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (sg === '-' ? -1 : 1) * Number(n));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  });
}

// 示範用紀錄中心資料：{{TS-N}}＝N 天前的時間戳、{{D±N}}＝日期、"{{WD+N}}"＝N 天後是星期幾（1～7）；?recmode=preview 時 schema-version 改成預覽
function demoRecords(files, now, mode) {
  const iso = (ms) => new Date(ms).toISOString().replace('Z', '+00:00');
  const out = {};
  for (const [k, v] of Object.entries(files)) {
    out[k] = demoDates(v, now)
      .replace(/\{\{TS-(\d+)\}\}/g, (_, n) => iso(now.getTime() - Number(n) * 86400000 - 60000))
      .replace(/"\{\{WD\+(\d+)\}\}"/g, (_, n) => String(((new Date(now.getFullYear(), now.getMonth(), now.getDate() + Number(n)).getDay() + 6) % 7) + 1));
  }
  const sv = JSON.parse(out['records/schema-version.json']);
  sv.mode = mode;
  out['records/schema-version.json'] = JSON.stringify(sv, null, 2) + '\n';
  return out;
}

// ---------- 抓資料 ----------
const HEALTH_FILE = 'dashboard/health.json'; // 私人 repo；.gitignore 白名單有它。只讀，不在寫入白名單
const missingOk = (e) => {
  if (e instanceof GitHubError && e.status === 404) return { text: '' };
  throw e;
};

// 回傳 changed：五個檔的文字或最新 commit 跟上一次不同。沒變就不用整頁重畫（約 95% 的輪詢結果是沒變的）
async function fetchAll() {
  const c = state.client;
  const gen = state.gen;
  const [live, questions, task, project, health, stateF, cm] = await Promise.all([
    c.getFile(FILES.live), c.getFile(FILES.questions).catch(missingOk), c.getFile(FILES.task),
    c.getFile(FILES.project).catch(missingOk),
    // health.json 讀不到（沒有、沒權限）不影響其他頁：當成沒有
    c.getFile(HEALTH_FILE).catch(() => ({ text: '' })),
    // mobile/state.json（電腦端狀態投影檔，只讀）：404、沒權限都當成沒有，壞掉的 JSON 由 readState 當成沒有
    c.getFile(STATE_FILE).catch(() => ({ text: '' })),
    // commits 跟檔案並行抓（首屏一次往返）；失敗只影響動態頁
    c.listCommits(30).then((r) => ({ list: convertCommits(r) })).catch((e) => ({ err: errMsg(e) })),
  ]);
  if (gen !== state.gen) return true; // 抓的途中使用者按了清除：不要把資料寫回
  const prev = state.data || {};
  const commits = cm.list || null;
  const next = {
    live: live.text, questions: questions.text, task: task.text, project: project.text, healthText: (health && health.text) || '', stateText: (stateF && stateF.text) || '',
    commits: commits || prev.commits || [], commitsErr: cm.err || '', fetchedAt: Date.now(),
    records: prev.records, // 紀錄中心的資料另外抓（fetchRecords），這裡原樣帶過去
  };
  const firstSha = (l) => (l && l[0] && (l[0].sha || l[0].time || l[0].text)) || '';
  const changed = !state.data || ['live', 'questions', 'task', 'project', 'healthText', 'stateText'].some((k) => prev[k] !== next[k]) ||
    firstSha(prev.commits) !== firstSha(next.commits) || (prev.commitsErr || '') !== next.commitsErr;
  state.data = next;
  state.offline = false;
  state.error = '';
  state.lastFetch = Date.now();
  saveCache();
  return changed;
}

// ---------- 紀錄中心的資料（v5 M3）----------
// 啟動時、在紀錄頁／我寫過的頁時、剛寫過紀錄之後才抓（不跟著每 60 秒輪詢所有頁）。5 個資料檔＋schema-version.json（只讀）。404＝還沒建立（存 null）
async function fetchRecords() {
  const c = state.client;
  const gen = state.gen;
  if (!state.data) return false;
  const prev = state.data.records || { texts: {}, schema: undefined, fetchedAt: 0, err: '' };
  const errs = [];
  const got = await Promise.all([RECORD_SCHEMA_FILE, ...RECORD_FILES].map(async (n) => {
    try { const r = await c.getFile(n); return [n, r.text == null ? null : r.text]; } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return [n, null];
      errs.push(e); return [n, undefined];
    }
  }));
  if (gen !== state.gen || !state.data) return false;
  const texts = { ...prev.texts };
  let schema = prev.schema;
  let changed = !state.data.records;
  for (const [n, t] of got) {
    if (t === undefined) continue; // 這次沒抓到：沿用上次的
    if (n === RECORD_SCHEMA_FILE) { if (schema !== t) changed = true; schema = t; } else { if (texts[n] !== t) changed = true; texts[n] = t; }
  }
  const err = errs.length ? errMsg(errs[0]) : '';
  if ((prev.err || '') !== err) changed = true;
  state.data.records = { texts, schema, fetchedAt: errs.length === got.length ? prev.fetchedAt || 0 : Date.now(), err };
  state.recDirty = false;
  saveCache();
  return changed;
}
const wantRecords = () => !!state.data && (!state.data.records || state.recDirty || state.tab === 'record' || state.tab === 'mine');

async function refresh(silent = false, force = false) {
  if (state.client && !state.locked) flushOutbox(); // 手動重新整理、60 秒輪詢、切回前景、online、啟動、解鎖後都會經過這裡：順便把排隊中的寫入再送一次
  if (state.loading || !state.client || state.locked) return;
  state.loading = true;
  const btn = $('btn-refresh');
  btn.disabled = true;
  btn.classList.add('spin');
  const hadProblem = !!(state.error || state.offline);
  let changed = true;
  try {
    changed = await fetchAll();
    if (wantRecords()) { try { if (await fetchRecords()) changed = true; } catch (e) { /* 紀錄檔抓不到不影響其他頁 */ } }
    purgeHandled(); // 已處理超過 30 天的寫入紀錄自動移除
  } catch (e) {
    if (e instanceof GitHubError) {
      state.error = errMsg(e);
      state.offline = false;
    } else {
      state.offline = true;
      state.error = '';
    }
    if (!silent) toast(errMsg(e), true);
  } finally {
    if (!silent && !state.error && !state.offline && state.data) { const pc = latestPcPush(state.data.commits || [], new Date()); toast('已拉到最新' + (pc ? '（電腦 ' + pc.hhmm + ' 同步）' : '')); }
    state.loading = false;
    btn.disabled = false;
    btn.classList.remove('spin');
  }
  // 自動輪詢且資料沒變、前後都沒有錯誤：只更新標題列與徽章，不重建整頁（首頁有「N 分鐘前」、健康頁有額度時間，照舊重畫）
  // 日期換了、或從背景切回來（force）一律整頁重畫：跨日的「今天／N 天後」不能留著舊畫面
  if (silent && !force && !changed && !hadProblem && !state.error && !state.offline && state.tab !== 'home' && state.tab !== 'health' && state.lastDrawDay === dayKey()) { renderChrome(); return; }
  render();
}

// ---------- 畫面 ----------
const mmddhhmm = (ms) => { const d = new Date(ms); const p2 = (n) => String(n).padStart(2, '0'); return p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
const dayKey = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
function isTyping() {
  const a = document.activeElement;
  // 游標在輸入框裡（不管有沒有字）就延後重畫，否則自動重新整理會把焦點和鍵盤收掉；blur 後照舊補畫
  return !!a && $('view').contains(a) && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || a.tagName === 'SELECT');
}

function render() {
  renderChrome();
  if (state.tab !== 'settings' && !state.locked && isTyping()) { state.pending = true; return; }
  state.pending = false;
  const view = $('view');
  let node;
  if (state.locked) node = viewLock();
  else if (state.tab === 'settings') node = viewSettings();
  else if (!state.data) node = h('div', { class: 'empty', text: state.loading ? '讀取中…' : '還沒有資料，請按「重新整理」' });
  else {
    try {
      const live = derive().p;
      node = { home: viewHome, record: viewRecord, chat: viewChat, tasks: viewTasks, projects: viewProjects, todo: viewTodo, more: viewMore, feed: viewFeed, health: viewHealth, mine: viewMine, reminders: viewReminders, reports: viewReports }[state.tab](live);
    } catch (e) {
      // 任何一頁的資料格式出問題，只影響那一頁，不能讓整個 App 空白
      node = h('div', { class: 'empty', text: '這一頁讀不出來（資料格式可能被改了）：' + (e && e.message ? e.message : e) });
    }
  }
  view.replaceChildren(node);
  state.lastDrawDay = dayKey();
  if (state.tab === 'chat') fitChatBar();
}

function renderChrome() {
  $('title').textContent = state.locked ? '已鎖定' : TITLES[state.tab];
  // 次要頁（待我／動態／健康／設定／更多）：底部導覽沒有高亮，標題列左邊出現「‹ 返回」
  const secondary = MORE_PAGES.includes(state.tab);
  for (const b of document.querySelectorAll('#tabs button')) {
    const on = b.dataset.tab === state.tab && !state.locked && !secondary;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  $('tabs').classList.toggle('inchat', state.tab === 'chat');
  document.body.classList.toggle('tab-chat', state.tab === 'chat' && !state.locked);
  $('btn-back').hidden = !(secondary && state.client && !state.locked);
  $('btn-more').classList.toggle('on', state.tab === 'more');
  const upd = $('updated');
  let text = '';
  let stale = false;
  let updatedText = '';
  let todoBadge = 0; // 底部「問題」徽章＝重要題數（跟首頁同一個定義；已存手機、排隊中的不算）
  const tbtn = document.querySelector('#tabs button[data-tab="tasks"]');
  const tb = tbtn.querySelector('.lbl');
  for (const old of tb.querySelectorAll('.count')) old.remove();
  tbtn.setAttribute('aria-label', '任務');
  if (state.data && !state.locked) {
    const live = derive().p;
    text = formatUpdated(live.updated); // MM-DD HH:MM
    stale = isStale(live.updated, new Date()) && remoteActive(live, new Date()); // 只有 ⚡ 即時模式（📡 開著而且沒過期）下 Live.md 超過 45 分鐘沒更新才算異常
    updatedText = text;
    const n = taskAttention(); // 等我的任務＋待驗收的任務（任務頁分頁籤上的數字）
    if (n) { tb.append(h('span', { class: 'count', text: String(n) })); tbtn.setAttribute('aria-label', '任務，' + n + ' 件需要你'); }
    todoBadge = getReminders().importantQids.length;
  }
  upd.textContent = state.tab === 'home' ? '' : text; // 首頁的狀態列已經有時間
  const qbtn = document.querySelector('#tabs button[data-tab="todo"]');
  const qlbl = qbtn.querySelector('.lbl');
  for (const old of qlbl.querySelectorAll('.count')) old.remove();
  if (todoBadge) qlbl.append(h('span', { class: 'count', text: String(todoBadge) }));
  qbtn.setAttribute('aria-label', todoBadge ? '問題，' + todoBadge + ' 題重要' : '問題');
  for (const old of $('btn-more').querySelectorAll('.count')) old.remove();
  $('btn-more').setAttribute('aria-label', '更多');
  const bn = $('banner');
  const staleMsg = '⚠ 資料可能過期（最後更新 ' + updatedText + '，超過 ' + STALE_MINUTES + ' 分鐘）';
  if (state.tab === 'home' && state.data && !state.locked && (state.error || state.offline)) {
    bn.hidden = true; // 首頁有資料時，錯誤與離線由狀態列說明，不講兩次
  } else if (state.error) {
    bn.hidden = false; bn.className = 'banner err'; bn.textContent = state.error;
  } else if (state.offline && state.data) {
    bn.hidden = false; bn.className = 'banner'; bn.textContent = '離線，資料時間 ' + hhmm(state.data.fetchedAt) + (stale ? '｜' + staleMsg : '');
  } else if (stale && state.tab !== 'home') { // 首頁的狀態列已經在講，不重複
    bn.hidden = false; bn.className = 'banner stale'; bn.textContent = staleMsg;
  } else bn.hidden = true;
  updatePill();
}

// 額度卡：數字旁標「HH:MM 的數字」；超過 60 分鐘醒目提示；重置時間已過就標「已重置」，舊數字變淡（lib/quota.js）
function quotaRow(r, stale, dateText = '') {
  const pct = r.pct;
  const cls = r.reset ? 'old' : sevOf(pct);
  const fill = h('div', { class: 'fill' });
  fill.style.width = Math.max(0, Math.min(100, pct || 0)) + '%';
  return h('div', { class: 'qrow ' + cls + (stale ? ' stale' : '') },
    h('div', { class: 'qhead' }, h('span', { class: 'qname', text: r.name }), h('span', { class: 'qpct', text: pct == null ? '—' : pct + '%' }),
      !r.reset && sevOf(pct) ? h('span', { class: 'qsev', text: (sevOf(pct) === 'bad' ? '⛔ ' : '⚠ ') + SEV_TEXT[sevOf(pct)] }) : null),
    h('div', { class: 'bar' }, fill),
    h('div', { class: 'qnote' + (dateText ? ' muted' : ''), text: (dateText && r.note ? dateText + ' ' : '') + (r.note || (pct == null ? '讀不到這項數字' : '')) }),
    r.reset ? h('div', { class: 'qreset', text: '⟳ 已重置（數字是重置前的）' }) : null);
}

// v4.2：Live.md 額度與電腦狀態檔（mobile/state.json）的額度取較新的；超過 3 小時改次要文字色並提示
const quotaOf = (p) => { const pc = pcState(); return quotaBest(p.quota, new Date(), p.updated, pc ? pc.quota : null); };
const quotaNext = (v) => (v.old ? h('div', { class: 'qnext', text: '電腦下次推送時更新' }) : null);

function quotaCard(p, title) {
  const v = quotaOf(p);
  const card = h('section', { class: 'card quota' + (v.stale ? ' stale' : '') + (v.old ? ' qold' : '') },
    h('h2', { text: title + (v.label ? '｜' + v.label + (v.ageText ? '（' + v.ageText + '）' : '') : '') }));
  if (v.stale) card.append(h('div', { class: 'qstale', text: v.liveFresh ? '⚠ 額度數字還沒更新（Live.md 其他內容是新的）' : '⚠ 數字可能已過時（電腦沒在更新）' }));
  if (!v.readAt) card.append(h('div', { class: 'hint', text: '讀不到「數字讀取時間」，無法判斷新舊' }));
  for (const r of v.rows) card.append(quotaRow(r, v.stale, v.dateText));
  if (v.old) card.append(quotaNext(v));
  return card;
}

// ---------- 1. 首頁（新設計，見 lib/home.js 與 docs/v3_UIUX檢視與優化方向.md 第 1 節） ----------
const dash = (s) => (s && String(s).trim() ? s : MISSING);

// 目前的 Agent 狀態（首頁與任務頁共用）
// pending 一律傳 0：狀態列只講 Agent 與同步，「等你」由重要提醒負責
function curStatus(p) {
  const now = new Date();
  const health = readHealth(state.data.healthText || '', now);
  return agentStatus({ now, updated: p.updated, error: state.error, offline: state.offline, health, running: runningNow(p), pending: 0, remote: remoteActive(p, now) });
}

// 任務清單（含 T 編號與狀態）。T 編號第一次配出來就存起來（只存雜湊與數字）
let taskMemo = { sig: '', val: null };
function taskInfo() {
  if (!state.data) return { tasks: [], notes: [] };
  const { p, cards } = derive();
  const answered = new Set(cards.filter((c) => cst(c) !== 'open').map((c) => c.qid));
  const waitLocal = curStatus(p).key === 'wait-local';
  const knownPids = allProjects(state.data.project || '').filter((x) => x.pid && !x.closed).map((x) => x.pid);
  const sig = [state.data.task, [...answered].join(','), state.accepted.size, waitLocal, JSON.stringify(state.tnum), knownPids.join(',')].join('\u0001');
  if (taskMemo.sig === sig) return taskMemo.val;
  const r = parseTasks(state.data.task || '', { answered, accepted: state.accepted, waitLocal, tnum: state.tnum, knownPids });
  if (r.tnumChanged) { state.tnum = r.tnum; saveTnum(ls, r.tnum); }
  // 升格請求只在任務還是「等我」時有意義：任務離開 waiting（升格完成、結案、被改狀態）就清掉那筆
  for (const t of r.tasks) if (PROMOTE_CLEAR_STATES.includes(t.state) && state.promoteReq[t.key] != null) state.promoteReq = removePromoteReq(ls, t.key);
  const sig2 = [state.data.task, [...answered].join(','), state.accepted.size, waitLocal, JSON.stringify(state.tnum), knownPids.join(',')].join('\u0001');
  taskMemo = { sig: sig2, val: r };
  return r;
}

function taskAttention() {
  return taskInfo().tasks.filter((t) => t.tag !== 'remind' && (t.state === 'waiting' || t.state === 'review')).length + doingOpenList().length;
}

const blurActive = () => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); };

// ---------- 寫入紀錄（outbox，v4 M3）：每一筆寫入先存手機、再送；規則在 lib/outbox.js ----------
const FILE_KEY = { questions: 'questions', task: 'task', live: 'live' };
const isOffline = () => state.offline || (typeof navigator !== 'undefined' && navigator.onLine === false);
// 存檔前先跟 storage 裡的合併（別的分頁可能寫過），再寫回；寫不進去先清快取（可重抓）再試，還是不行就持續提示
const freeCacheSpace = () => { if (!demo) { localStorage.removeItem(CACHE_KEY); clearCache(localStorage); } };
// v4.3.1：合併＋存檔在 lib/outbox.js 的 syncOutbox（含刪除墓碑 agent.outbox.del 與每筆的 rev），這裡只接線
const mergeFromStorage = () => { state.ob = syncOutbox(ls, state.ob, { deleted: state.obDeleted, persist: false }).list; };
function obChanged() {
  const r = syncOutbox(ls, state.ob, { deleted: state.obDeleted, freeSpace: freeCacheSpace });
  state.ob = r.list;
  const ok = r.ok;
  const was = state.obUnsaved;
  state.obUnsaved = !ok;
  state.obRev++;
  if (!ok) toast(UNSAVED_MSG, true, true);
  else if (was && toastSticky) { $('toast').hidden = true; toastSticky = false; }
}
// 刪掉的編號：記在本分頁的集合，也寫進 storage 的墓碑，別的分頁合併時才知道要丟掉（寫不進去不影響本分頁）
const dropOb = (ids) => { for (const id of ids) state.obDeleted.add(id); dropOutbox(ls, ids); };
function buzz() { try { if (navigator.vibrate) navigator.vibrate(15); } catch (e) { /* 沒有震動就算了 */ } }

// 電腦狀態檔（mobile/state.json）：同一份文字只解析一次
let pcsMemo = { text: null, val: null };
function pcState(nowMs = Date.now()) {
  const t = state.data ? state.data.stateText || '' : '';
  if (pcsMemo.text !== t) pcsMemo = { text: t, val: readState(t) };
  return usableState(pcsMemo.val, nowMs);
}

// 右上角小提示：已存手機 → 送出中… → 已送出 HH:MM（3 秒後收起）；沒網路、失敗會一直留著，點下去到「我寫過的」
let pillTimer = 0;
function updatePill() {
  const el = $('sendpill');
  if (!el) return;
  const c = outboxCounts(state.ob);
  let text = '';
  let cls = 'busy';
  if (state.obUnsaved) { text = '⚠ 手機空間不足，沒存到，先別關 App'; cls = 'bad'; }
  else if (c.sending) text = '⏳ 送出中…';
  else if (c.failed) { text = '⚠ ' + c.failed + ' 件沒送出，點這裡看'; cls = 'bad'; }
  else if (c.queued) {
    if (isOffline()) { text = '📵 ' + c.queued + ' 件存在手機，連上會自動送'; cls = 'warn'; } else text = '⏳ 已存手機 ' + c.queued + ' 件，等送出';
  } else if (state.lastSentAt && Date.now() - state.lastSentAt < 3000) {
    text = '✅ 已送出 ' + hhmm(state.lastSentAt); cls = 'ok';
    clearTimeout(pillTimer);
    pillTimer = setTimeout(updatePill, 3200);
  }
  // 首頁（狀態列與「你寫的 N 件」已經在講）、我寫過的（整頁就是狀態）不重複顯示，也不會蓋到狀態列
  // 空間不足的警告任何頁都要看得到
  el.hidden = !text || state.locked || (!state.obUnsaved && (state.tab === 'home' || state.tab === 'mine'));
  if (text) { el.textContent = text; el.className = 'sendpill ' + cls; }
}

// 一筆寫入：先建紀錄（有編號、狀態 queued）、立刻存手機、震一下，畫面馬上看得到，再背景送
function enqueue(kind, payload, id) {
  const item = createItem(kind, payload, Date.now(), id);
  state.ob.push(item);
  obChanged();
  buzz();
  updatePill();
  flushOutbox();
  return item;
}

// 紀錄中心的一筆寫入（v5 M3）。spec：{file, op, rtype, title, id?, typed?(create：表單欄位), patch?, base?}
// create：紀錄編號＝<前綴>-<outbox 編號>（重送天然去重）；update：排隊中的同一筆修改併進去（base 留最早的值），不每改一次就一個 commit
function enqueueRecord(spec) {
  const now = Date.now();
  if (spec.op === 'create') {
    const mid = newId();
    const id = newRecordId(spec.rtype, mid);
    const record = buildRecord(spec.rtype, id, spec.typed, isoLocal(now));
    return enqueue('record', { file: spec.file, op: 'create', rtype: spec.rtype, id, title: spec.title, record }, mid);
  }
  const payload = { file: spec.file, op: spec.op, rtype: spec.rtype, id: spec.id, title: spec.title };
  if (spec.op === 'update') { payload.patch = spec.patch; payload.base = spec.base || {}; }
  const queued = state.ob.filter((x) => x.kind === 'record' && x.state === 'queued' && x.payload.file === spec.file && x.payload.id === spec.id).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (queued && spec.op === 'update') {
    const merged = mergeRecordOp(queued, payload);
    if (merged) { editPayload(queued, merged); obChanged(); buzz(); updatePill(); flushOutbox(); return queued; }
  }
  return enqueue('record', payload);
}

// 存不進手機時，各處「已存手機」字樣改成講實話
const savedWord = () => (state.obUnsaved ? '只在畫面上（手機空間不足）' : '已存手機');

// 寫入成功後：把回來的新檔案文字放進畫面資料；回答要記進送出紀錄（agent.sent），升格請求記時間
function applyResult(item, r) {
  const p = item.payload || {};
  if (r && r.text != null && state.data && FILE_KEY[r.file]) state.data[FILE_KEY[r.file]] = r.text;
  if (item.kind === 'record' && r && r.path && state.data) {
    const rec = state.data.records || { texts: {}, schema: undefined, fetchedAt: 0, err: '' };
    state.data.records = { ...rec, texts: { ...rec.texts, [r.path]: r.text } };
    state.recDirty = true; // 寫入成功後重抓那一檔（refresh 會做）
  }
  if (item.kind === 'answer') {
    state.sent.push({
      qid: p.qid, at: item.createdAt, text: '', summary: p.summary || summarize(p.answer), received: false,
      target: r && r.supplement && r.supplement.includes(p.qid) ? 'supplement' : 'questions',
    });
    saveSent(ls, state.sent);
  } else if (item.kind === 'promote' && p.key) state.promoteReq = addPromoteReq(ls, p.key, item.createdAt);
}

// 依建立順序一筆一筆送（同時間只送一筆）。網路錯誤留在排隊；其他錯誤標失敗、繼續下一筆
// v4.3：同時開兩個分頁時，用瀏覽器的鎖讓同一時間只有一個分頁在送；拿不到鎖（別的分頁在送）就直接返回，不顯示錯誤
async function flushOutbox() {
  if (state.flushing || state.noFlush || !state.client || state.locked) return;
  if (!state.ob.some((x) => x.state === 'queued')) { updatePill(); return; }
  if (!demo && typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
    await navigator.locks.request('agent-outbox', { ifAvailable: true }, async (lock) => {
      if (!lock) return;
      await doFlush();
    });
    return;
  }
  await doFlush();
}

async function doFlush() {
  if (state.flushing || state.noFlush || !state.client || state.locked) return;
  // 開始送之前先跟 storage 合併：別的分頁剛送完的就不再送
  if (!demo) { mergeFromStorage(); state.obRev++; }
  if (!state.ob.some((x) => x.state === 'queued')) { updatePill(); return; }
  state.flushing = true;
  const client = state.client;
  let res = null;
  try {
    res = await processOutbox(() => state.ob, async (item) => {
      const r = await executeItem(client, item);
      applyResult(item, r);
      return r;
    }, {
      onChange: (it) => { if (it.state === 'sent') state.lastSentAt = Date.now(); obChanged(); updatePill(); render(); },
      shouldStop: () => state.client !== client || state.locked,
      skip: (it) => it.id === state.mopen, // 使用者正在編輯的那一筆先不送
    });
  } finally {
    state.flushing = false;
  }
  updatePill();
  if (res && res.failed) {
    const bad = state.ob.filter((x) => x.state === 'failed');
    toast('❌ ' + res.failed + ' 件沒送出：' + (bad.length ? bad[bad.length - 1].err : '') + '（到「我寫過的」可以重試或刪除）', true);
  }
  if (res && res.sent && !demo) refresh(true);
}

// 失敗的寫入：重試（日記衝突可以選「用我的版本覆蓋」）或刪除
function doRetry(id, patch = null) {
  const it = state.ob.find((x) => x.id === id);
  if (!it || it.state !== 'failed') return;
  retryOb(it, patch);
  obChanged();
  buzz();
  updatePill();
  render();
  flushOutbox();
}

// 全部重試：token 過期（401）或沒權限（403）時每一筆都會失敗，一次全部重新排隊
function doRetryAll() {
  const n = retryAll(state.ob);
  if (!n) return;
  obChanged();
  buzz();
  updatePill();
  render();
  flushOutbox();
  toast('已重新排隊 ' + n + ' 件');
}

// 別的分頁改了寫入紀錄：併進本分頁的記憶體（不回寫，避免兩邊互相觸發）
function onOutboxStorage(e) {
  if (!e || (e.key !== KEYS.outbox && e.key !== KEYS.outboxDel)) return; // 寫入紀錄或刪除墓碑被別的分頁改了
  mergeFromStorage();
  state.obRev++;
  updatePill();
  const a = document.activeElement; // 正在打字就先不重畫，免得打到一半的字消失
  if (!(a && /^(TEXTAREA|INPUT)$/.test(a.tagName))) render();
}

// 刪除時把使用者寫的內容放回草稿，不會白寫
function restoreDraft(it) {
  const p = it.payload || {};
  if (it.kind === 'answer') { if (p.answer && !Object.values(QUICK).includes(p.answer) && !parseDoingLine(p.answer)) setDraft('ans:' + p.qid, p.answer); }
  else if (it.kind === 'chat') appendDraft('chat', parseCtx(p.content || '').rest);
  else if (it.kind === 'task') appendDraft('taskv3', p.content || '');
  else if (it.kind === 'note') { appendDraft('note', p.content || ''); if (p.source) setDraft('note:source', p.source); if (p.url) setDraft('note:url', p.url); }
  else if (it.kind === 'journal') (p.answers || []).forEach((a, i) => { if (pointStatus((p.base || [])[i], a) === 'dirty') setEdit('jv:' + p.dk + ':' + (i + 1), a); });
  else if (it.kind === 'record') rui.restoreDraft(p); // 刪掉排隊中的紀錄：內容放回表單草稿
}
function doDelete(id) {
  const it = state.ob.find((x) => x.id === id);
  if (!it) return;
  if (it.state === 'sending') { toast('正在送出，等一下', true); return; }
  if (it.state !== 'sent') restoreDraft(it);
  try { state.ob = removeOb(state.ob, id); } catch (e) { toast('正在送出，等一下', true); return; }
  dropOb([id]); // 記下來：跟別的分頁合併時不要把這筆復活
  if (state.mopen === id) state.mopen = null;
  obChanged();
  updatePill();
  toast(it.state === 'sent' ? '已移除這筆紀錄' : '已刪除，內容放回草稿');
  render();
}

const obChip = (it) => (it.state === 'sending' ? '⏳ 送出中…' : it.state === 'failed' ? '❌ 沒送出' : it.state === 'sent' ? '✅ 已送出 ' + hhmm(it.sentAt || it.createdAt) : '⏳ 排隊中，' + savedWord());

function obActions(it) {
  const row = h('div', { class: 'quick obacts' });
  if (it.state === 'failed') {
    row.append(h('button', { class: 'btn small', type: 'button', text: '重試', onclick: () => doRetry(it.id) }));
    if ((it.kind === 'journal' || it.kind === 'record') && it.code === 'conflict') row.append(h('button', { class: 'btn small ghost', type: 'button', text: '用我的版本覆蓋', onclick: () => doRetry(it.id, { force: true }) }));
  }
  if (it.state !== 'sending' && it.state !== 'sent') row.append(h('button', { class: 'btn small ghost', type: 'button', text: '刪除', onclick: () => doDelete(it.id) }));
  return row;
}

// 題目卡上的「已存手機／送出中／沒送出」
function obCardState(it) {
  if (!it) return h('div', { class: 'qstate' });
  const box = h('div', { class: 'qstate ob-' + it.state });
  if (it.state === 'failed') {
    box.append(h('div', { text: '❌ 沒送出：' + it.err }), obActions(it));
    return box;
  }
  box.append(h('div', { text: (it.state === 'sending' ? '⏳ 送出中…' : state.obUnsaved ? '⚠ ' + savedWord() + '，先別關 App｜' + hhmm(it.createdAt) : '⏳ 已存手機，連上網路會自動送｜' + hhmm(it.createdAt)) + '｜' + (it.payload.summary || '') }));
  if (it.state === 'queued') box.append(h('button', { class: 'btn small ghost', type: 'button', text: '改內容或刪除', onclick: () => { state.mopen = it.id; setTab('mine'); } }));
  return box;
}

// 還沒進到 Task.md／Live.md 畫面資料的寫入（排隊中、送出中、失敗，或剛送出、畫面資料還沒更新）：樂觀顯示用
function pendingOf(kind) {
  const ti = kind === 'task' || kind === 'note' ? taskInfo() : null;
  const seen = (it) => (ti ? (kind === 'task' ? ti.tasks : ti.notes).some((x) => x.mid === it.id) : true);
  return state.ob.filter((it) => it.kind === kind && (it.state !== 'sent' || (Date.now() - it.sentAt < 120000 && !seen(it)))).sort((a, b) => b.createdAt - a.createdAt);
}

function pendingCard(it) {
  const p = it.payload || {};
  const title = String(p.content || '').split('\n')[0];
  const box = h('div', { class: 'q taskcard pending ob-' + it.state });
  box.append(h('div', { class: 'ttitle' }, h('span', { class: 'qid', text: it.kind === 'note' ? '📝' : '新' }), h('span', { class: 'tname clamp2', text: title })));
  box.append(h('div', { class: 'tstatebox' }, h('span', { class: 'tag tstate ' + (it.state === 'failed' ? 'bad' : it.state === 'sent' ? 'review' : 'warn'), text: obChip(it) })));
  if (it.state === 'failed') box.append(h('div', { class: 'hint', text: it.err }));
  if (it.state !== 'sent') box.append(obActions(it));
  return box;
}

function pendingBubble(it) {
  const b = h('div', { class: 'bubble you pending' });
  b.append(h('span', { class: 'meta', text: obChip(it) + '｜' + hhmm(it.createdAt) }));
  b.append(inlineHtml(String((it.payload || {}).content || '')));
  if (it.state === 'failed') b.append(h('div', { class: 'hint', text: it.err }));
  if (it.state !== 'sent') b.append(obActions(it));
  return b;
}

// 升格請求、維持任務還沒送成功的那一筆（任務卡上顯示狀態用）
const obPending = (kind, key) => state.ob.find((x) => x.kind === kind && x.payload && x.payload.key === key && x.state !== 'sent');

// ---------- 我寫過的（v4 M3）：每一筆寫入現在是什麼狀態；排隊中可以改內容或刪除 ----------
let mrMemo = { sig: '', val: [] };
function mineRows() {
  const d = state.data;
  if (!d) return [];
  const sig = [state.obRev, d.task, d.questions, d.live, d.stateText, d.fetchedAt, d.records ? d.records.fetchedAt : 0, Math.floor(Date.now() / 60000)].join('|');
  if (mrMemo.sig === sig) return mrMemo.val;
  const ti = taskInfo();
  const ctx = buildMineCtx({ tasks: ti.tasks, notes: ti.notes, taskText: d.task || '', questionsText: d.questions || '', liveText: d.live || '', state: pcState(), now: Date.now(), fetchedAt: d.fetchedAt || 0, records: d.records ? d.records.texts : null, recFetchedAt: d.records ? d.records.fetchedAt || 0 : 0 });
  const val = deriveMine(state.ob, ctx);
  mrMemo = { sig, val };
  return val;
}

// 已處理超過 30 天的自動移除
function purgeHandled() {
  if (!state.ob.length || !state.data) return;
  try {
    const ids = purgeIds(mineRows(), Date.now());
    if (!ids.length) return;
    state.ob = state.ob.filter((x) => !ids.includes(x.id));
    dropOb(ids);
    obChanged();
  } catch (e) { /* 清不掉就留著 */ }
}

function goMine(r) {
  const j = r.jump;
  if (!j) return;
  if (j.type === 'q') {
    const dc = derive().cards.find((x) => x.qid === j.id);
    if (dc && dc.doing) { state.expanded.add('doing:' + j.id); state.ttab = 'doing'; setTab('tasks'); scrollToCard(j.id); return; } // 動手題在任務頁
    state.qfilter = 'all'; state.openQ = j.id; setTab('todo'); scrollToCard(j.id);
  }
  else if (j.type === 'chat') setTab('chat');
  else if (j.type === 'journal') { state.rtab = 'journal'; state.jday = j.id; setTab('record'); }
  else if (j.type === 'note') { state.rtab = 'note'; setTab('record'); }
  else if (j.type === 'record') rui.openRecord(j.rtype, j.id);
  else if (j.type === 'task') openTask(j.id);
  else { state.ttab = 'agent'; setTab('tasks'); } // 沒有更具體的線索（任務還沒進 Task.md 等）：落在「交辦 Agent」，剛寫的卡在那裡
}

// 排隊中、失敗的寫入可以直接改內容
function saveEdit(it, vals) {
  if (it.state === 'sending' || it.state === 'sent') { editLost(it, vals); return; }
  try {
    if (it.kind === 'journal') editPayload(it, { answers: vals.map((v) => v.trim()) });
    else {
      const t = (vals[0] || '').trim();
      if (!t) { toast('內容不能是空的，要不要改成刪除？', true); return; }
      if (it.kind === 'answer') editPayload(it, { answer: t, summary: summarize(t), quick: '', viaLive: false });
      else editPayload(it, { content: t });
    }
  } catch (e) { editLost(it, vals); return; }
  state.mopen = null;
  if (it.state === 'failed') { retryOb(it); obChanged(); toast('已更新，重新送出'); render(); flushOutbox(); return; }
  obChanged();
  toast('已更新');
  render();
  flushOutbox();
}

// 編輯到一半，那一筆已經在送或送出了：修改沒套用，把改過的內容放回草稿，並說清楚
function editLost(it, vals) {
  const t = (vals[0] || '').trim();
  if (it.kind === 'journal') vals.forEach((v, i) => { if (v.trim()) setEdit('jv:' + (it.payload.dk) + ':' + (i + 1), v.trim()); });
  else if (it.kind === 'answer') { if (t) setDraft('ans:' + it.payload.qid, t); }
  else if (it.kind === 'chat') appendDraft('chat', t);
  else if (it.kind === 'task') appendDraft('taskv3', t);
  else if (it.kind === 'note') appendDraft('note', t);
  state.mopen = null;
  toast('這筆剛剛已經送出，修改沒套用；改過的內容放回草稿了', true);
  obChanged();
  render();
}

function mineEditor(r) {
  const it = r.item;
  const p = it.payload || {};
  const areas = [];
  const wrap = h('div', { class: 'mineedit' });
  if (it.kind === 'journal') {
    JOURNAL_QUESTIONS.forEach((q, i) => {
      const ta = h('textarea', { rows: 2, 'aria-label': q });
      ta.value = (p.answers || [])[i] || '';
      areas.push(ta);
      wrap.append(h('label', { text: (i + 1) + '. ' + q }), ta);
    });
  } else {
    const ta = h('textarea', { rows: 4, 'aria-label': '內容' });
    ta.value = it.kind === 'answer' ? p.answer || '' : p.content || '';
    areas.push(ta);
    wrap.append(ta);
  }
  wrap.append(h('div', { class: 'quick' }, h('button', { class: 'btn small', type: 'button', text: '儲存修改', onclick: () => saveEdit(it, areas.map((a) => a.value)) }),
    h('button', { class: 'btn small ghost', type: 'button', text: '先收起來', onclick: () => { state.mopen = null; render(); flushOutbox(); } })));
  return wrap;
}

function mineRow(r) {
  const it = r.item;
  const open = state.mopen === it.id && (it.state === 'queued' || it.state === 'failed');
  const box = h('div', { class: 'q minerow ph-' + r.phase, id: 'm-' + it.id });
  const head = h('button', {
    class: 'mhead', type: 'button', 'aria-expanded': open ? 'true' : 'false',
    onclick: () => { if (r.jump) goMine(r); else if (it.state === 'queued' || it.state === 'failed') { state.mopen = open ? null : it.id; render(); if (open) flushOutbox(); } },
  },
  h('div', { class: 'mtop' }, h('span', { class: 'mico', text: r.icon }), h('span', { class: 'mkind', text: r.kindLabel }), h('span', { class: 'mtime', text: r.time }), h('span', { class: 'tag mchip ph-' + r.phase, text: r.chip })),
  h('div', { class: 'mprev' + (open ? '' : ' clamp2'), text: r.preview }),
  h('div', { class: 'mlabel', text: r.label }));
  box.append(head);
  if (it.state === 'failed') box.append(obActions(it));
  else if (it.state === 'queued' && !open) box.append(h('div', { class: 'hint mhint', text: '點一下可以改內容或刪除' }));
  if (open && r.editable) box.append(mineEditor(r), it.state === 'queued' ? obActions(it) : null);
  return box;
}

function viewMine() {
  const rows = mineRows();
  const wrap = h('div', { class: 'minepage' });
  const n = notReceivedCount(rows);
  wrap.append(h('section', { class: 'card sumcard' },
    h('div', { class: 'bignum', text: String(n) }),
    h('div', { class: 'sumtitle', text: n ? '件電腦還沒收' : '你寫的都收到了' }),
    h('div', { class: 'hint sumhint', text: '共 ' + rows.length + ' 筆｜已處理的留 30 天' })));
  const counts = filterCounts(rows);
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': '篩選' });
  const fl = failedCount(state.ob) ? [FILTERS.find(([k]) => k === 'failed'), ...FILTERS.filter(([k]) => k !== 'failed')] : FILTERS; // 有失敗就把「失敗」放第一個、標紅
  for (const [k, label] of fl) {
    chips.append(h('button', {
      class: 'chip' + (state.mfilter === k ? ' active' : '') + (k === 'failed' && counts[k] ? ' bad' : ''), type: 'button', text: label + ' ' + counts[k], 'aria-pressed': state.mfilter === k ? 'true' : 'false',
      onclick: () => { state.mfilter = k; render(); },
    }));
  }
  wrap.append(h('div', { class: 'chipwrap' }, chips));
  // 2 件以上失敗（常見原因：token 過期或沒權限，每一筆都失敗），而且正在看「失敗」或「全部」：一鍵全部重試
  const nFail = failedCount(state.ob);
  if (nFail >= 2 && (state.mfilter === 'failed' || state.mfilter === 'all')) {
    wrap.append(h('div', { class: 'retryall' },
      h('button', { class: 'btn small', type: 'button', text: '全部重試（' + nFail + ' 件）', onclick: doRetryAll }),
      h('span', { class: 'hint', text: '都失敗的話，先到設定檢查 token' })));
  }
  const shown = filterMine(rows, state.mfilter);
  if (!shown.length) wrap.append(h('div', { class: 'empty', text: rows.length ? '這個分類沒有項目' : '還沒有寫過東西。從手機送出的回答、日記、筆記、任務、對話都會記在這裡。' }));
  for (const g of groupByDate(shown, new Date())) {
    wrap.append(h('div', { class: 'group-title', text: g.label + ' ' + g.rows.length }));
    for (const r of g.rows) wrap.append(mineRow(r));
  }
  return wrap;
}

// 首頁狀態列下面那一行小字
function mineLine() {
  if (state.obUnsaved) return h('div', { class: 'mineline bad', role: 'alert' }, h('span', { text: UNSAVED_MSG }));
  const f = failedCount(state.ob);
  if (f) {
    return h('button', { class: 'mineline bad', type: 'button', onclick: () => { state.mfilter = 'failed'; setTab('mine'); } },
      h('span', { text: '⚠ ' + f + ' 件沒送出' }), h('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }));
  }
  const n = state.data ? notReceivedCount(mineRows()) : 0;
  if (!n) return null;
  return h('button', { class: 'mineline', type: 'button', onclick: () => setTab('mine') },
    h('span', { text: '你寫的 ' + n + ' 件電腦還沒收' }), h('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }));
}

function scrollToId(id) {
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
  });
}

// 跳到任務頁並展開那一張
function openTask(key) {
  const g = groupTasks(taskInfo().tasks, new Date()).find((x) => x.items.some((t) => t.key === key));
  if (g && COLLAPSED_TASK_GROUPS.includes(g.key)) state.expanded.add('tg:' + g.key);
  state.expanded.add('task:' + key);
  state.ttab = taskTabForOpen(groupTasks(taskInfo().tasks, new Date()), key); // 任務在哪個分頁就切過去（提醒在「提醒」，其餘或找不到在「交辦 Agent」）
  setTab('tasks');
  scrollToId('t-' + key);
}

function openProject(pr) {
  state.pfilter = '全部';
  state.expanded.add(pkey(pr));
  setTab('projects');
}

// 開新增任務表單（可預填內容與專案）
function openTaskForm({ content = '', pid = '' } = {}) {
  if (content) appendDraft('taskv3', content);
  state.tf = { open: true, mode: pid ? 'pick' : 'auto', pid, deadline: '', type: 'agent' };
  state.ttab = 'agent'; // 新增表單在「交辦 Agent」分頁
  setTab('tasks');
}

// 開對話頁並帶 context
function startChat(ctx, prefill = '') {
  state.chatCtx = ctx;
  if (prefill) appendDraft('chat', prefill);
  setTab('chat');
}

const ctxText = (c) => (c.kind === 'project' ? c.id + ' · ' + (c.name || c.label || '') : c.id + ' · ' + [...String(c.label || '')].slice(0, 20).join(''));

function sendQuick(key, area, okMsg) {
  const v = area.ta.value.trim();
  if (!v) { toast('請先寫點內容', true); return; }
  enqueue('chat', { content: withCtx(state.chatCtx, v) }); // 先存手機、立刻出現在對話裡（排隊中），送成功才是真的寫進 Live.md「對話」區
  clearDraft(key);
  blurActive();
  toast('✅ 已存手機 ' + hhmm(Date.now()) + '｜' + (isOffline() ? '沒網路，連上會自動送' : '送出中'));
  state.pending = false;
  render();
  if (state.tab === 'chat') scrollBottom();
}

// 精簡額度（首頁）：每項一行「名稱｜bar｜百分比＋文字」，過時時標題列右邊提示；健康頁仍用完整的 quotaCard
function quotaCompact(p) {
  const v = quotaOf(p);
  const head = h('div', { class: 'qmhead' }, h('h2', { text: '額度' }));
  const card = h('section', { class: 'card quota qmini' + (v.stale ? ' stale' : '') + (v.old ? ' qold' : ''), role: 'button', tabindex: '0', 'aria-label': '額度，點開看健康狀態' });
  card.append(head);
  if (v.rows.every((r) => r.pct == null)) {
    head.append(h('span', { class: 'hint', text: '讀不到（Live.md 沒有額度區）' }));
  } else {
    if (v.stale) head.append(h('span', { class: 'qmwarn', text: '⚠ ' + (v.source === 'pc' ? v.label.replace(/ 的數字$/, '') : v.readAt.replace(/^(\d):/, '0$1:')) + ' 的數字，' + v.ageText }));
    else if (v.label) head.append(h('span', { class: 'hint', text: v.label }));
    for (const r of v.rows) {
      const sev = r.reset ? '' : sevOf(r.pct);
      const fill = h('div', { class: 'fill' });
      fill.style.width = Math.max(0, Math.min(100, r.pct || 0)) + '%';
      card.append(h('div', { class: 'qmrow ' + (r.reset ? 'old' : sev) },
        h('span', { class: 'qmname', text: r.name }), h('div', { class: 'bar' }, fill),
        h('span', { class: 'qmpct', text: r.pct == null ? '—' : r.pct + '%' + (sev ? ' ' + (sev === 'bad' ? '⛔ ' : '⚠ ') + SEV_TEXT[sev] : '') + (r.reset ? ' ⟳ 已重置' : '') })));
    }
    const notes = v.rows.filter((r) => r.note);
    if (notes.length) {
      const same = notes.length === v.rows.length && notes.every((r) => r.note === notes[0].note);
      card.append(h('div', { class: 'qnote' + (v.dateText ? ' muted' : ''), text: (v.dateText ? v.dateText + ' ' : '') + (same ? notes[0].note : notes.map((r) => r.name + '：' + r.note).join('｜')) }));
    }
    if (v.old) card.append(quotaNext(v));
  }
  const go = () => setTab('health');
  card.addEventListener('click', go);
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  return card;
}

// 重要提醒列點下去要做的事（lib/home.js 只給 target，不碰 DOM）
function goReminder(t) {
  if (t.type === 'q') { state.qfilter = 'open'; state.openQ = t.id; setTab('todo'); scrollToCard(t.id); }
  else if (t.type === 'todo-today') { state.qfilter = 'important'; state.openQ = t.id; setTab('todo'); scrollToCard(t.id); }
  else if (t.type === 'task') openTask(t.id);
  else if (t.type === 'journal') { state.rtab = 'journal'; state.jday = t.id; setTab('record'); }
  else if (t.type === 'tasks-review') { state.ttab = 'agent'; setTab('tasks'); scrollToId('tg-review'); }
  else if (t.type === 'tasks-doing') { state.ttab = 'doing'; setTab('tasks'); }
  else if (t.type === 'reminders') setTab('reminders');
}

function remindersCard(rem) {
  const card = h('section', { class: 'card remcard' });
  card.append(h('div', { class: 'remhead' }, h('h2', { text: '重要提醒' }), rem.count ? h('span', { class: 'remcount', text: String(rem.count) }) : null));
  const { shown, hidden } = visibleRows(rem.rows, state.remAll);
  if (!rem.rows.length) card.append(h('div', { class: 'remempty', text: '✅ 目前沒有要你處理的事' }));
  for (const r of shown) {
    card.append(h('button', { class: 'remrow rk-' + r.kind, type: 'button', onclick: () => goReminder(r.target) },
      h('span', { class: 'rk', text: r.chip }),
      h('span', { class: 'remtitle' }, r.id ? h('span', { class: 'qid', text: r.id }) : null, h('span', { class: 'oneline', text: r.title })),
      h('span', { class: 'chev', 'aria-hidden': 'true', text: '›' })));
  }
  if (hidden) card.append(h('button', { class: 'remmore', type: 'button', text: '還有 ' + hidden + ' 件 ▾', onclick: () => { state.remAll = true; render(); } }));
  if (rem.backlog) {
    card.append(h('button', { class: 'remrow remback', type: 'button', onclick: () => { state.qfilter = 'open'; setTab('todo'); } },
      h('span', { class: 'remtitle' }, h('span', { class: 'oneline', text: '其他題目 ' + rem.backlog + ' 題（有空再答）' })), h('span', { class: 'chev', 'aria-hidden': 'true', text: '›' })));
  }
  if (rem.importantQids.length) {
    card.append(h('button', {
      class: 'btn wide', type: 'button', text: '回答下一題（' + rem.importantQids.length + '）',
      onclick: () => { state.qfilter = 'important'; state.openQ = rem.importantQids[0]; setTab('todo'); scrollToCard(rem.importantQids[0]); },
    }));
  }
  return card;
}

// 電腦同步狀態（lib/status.js syncStatus）：離線＝瀏覽器說沒網路，或最近一次抓取因為網路失敗
function currentSync(p, now = new Date()) {
  const off = state.offline || (typeof navigator !== 'undefined' && navigator.onLine === false);
  return syncStatus({ commits: state.data.commits || [], live: p, now, offline: off, fetchedAt: state.data.fetchedAt, state: pcState(now.getTime()), queued: queuedCount(state.ob) });
}

function statusLineCard(p, st) {
  const now = new Date();
  const sy = currentSync(p, now);
  const v = statusLineView(st, {
    ageMin: updatedAgeMinutes(p.updated, now), offline: state.offline, error: state.error,
    fetchedAt: state.data.fetchedAt ? hhmm(state.data.fetchedAt) : '', sync: sy,
  });
  const box = h('div', { class: 'statuswrap' });
  const bar = h('button', {
    class: 'statusline st-' + st.key + ' sy-' + sy.key, type: 'button', 'aria-expanded': state.stOpen ? 'true' : 'false',
    onclick: () => { if (v.action === 'settings') setTab('settings'); else { state.stOpen = !state.stOpen; render(); } },
  }, h('span', { class: 'sl-text', text: v.text }), h('span', { class: 'sl-right', text: v.right }), h('span', { class: 'chev', 'aria-hidden': 'true', text: v.action === 'settings' || !state.stOpen ? '›' : '⌄' }));
  box.append(bar);
  if (state.stOpen && v.action !== 'settings') {
    box.append(h('div', { class: 'stopen' },
      h('div', { class: 'stdetail', text: st.detail }),
      nowStatusLine(p),
      h('div', { class: 'hint', text: '電腦最後推送 ' + (sy.pc ? sy.pc.time : '—') + '｜Agent 最後更新 ' + (formatUpdated(p.updated) || '—') + '｜手機同步 ' + (state.data.fetchedAt ? hhmm(state.data.fetchedAt) : '—') }),
      h('button', { class: 'btn ghost small', type: 'button', text: '健康狀態 ›', onclick: () => setTab('health') })));
  }
  return box;
}

// Live.md「現在」區的狀態行；Live.md 最後更新不是今天，前面標 MM-DD 並用次要文字色（判斷在 lib/home.js nowStatusView）
function nowStatusLine(p) {
  const v = nowStatusView(p, new Date());
  return v ? h('div', { class: 'hint nowstatus' + (v.old ? ' muted' : ''), text: v.text }) : null;
}

function moreInfo(p) {
  const now = new Date();
  const { tasks } = taskInfo();
  const act = buildActivity(state.data.commits || [], p.progressLines, now, { progressDate: p.updated && p.updated.date, hideOldProgress: true }); // 進度不是今天的不上首頁
  const events = act.filter((a) => a.type === 'event').length;
  const doing = tasks.filter((t) => t.state === 'doing' && t.tag !== 'remind').slice(0, 3);
  const text = state.data.project || '';
  const top = sortProjects(allProjects(text)).filter((x) => rankOf(x) < 4).slice(0, 3);
  const js = journalStatus(state.data.task || '', now);
  const det = h('details', { class: 'card homemore' },
    h('summary', {}, h('span', { class: 'mtitle', text: '更多資訊' }), h('span', { class: 'msum', text: moreSummary({ events, doing: doing.length, projects: top.length, journalFilled: js.filled }) })));
  det.open = loadHomeMore(ls);
  det.addEventListener('toggle', () => saveHomeMore(ls, det.open));

  // 最近動態
  const feed = act.slice(0, 3);
  det.append(h('h3', { class: 'msec', text: '最近動態' }));
  if (feed.length) {
    det.append(h('ul', { class: 'nowfeed' }, ...feed.map((a) => h('li', {}, h('div', { class: 'clamp1', text: a.type === 'group' ? a.kind + '更新 ×' + a.count : a.text }),
      h('div', { class: 'meta', text: (a.type === 'group' ? a.to : a.time) + (a.type === 'group' ? '' : '｜' + a.actor) })))));
  } else det.append(h('p', { class: 'hint', text: '沒有動態' }));
  det.append(h('div', { class: 'actions' }, h('button', { class: 'btn ghost wide', type: 'button', text: '看全部動態', onclick: () => setTab('feed') })));

  // 進行中的任務
  det.append(h('h3', { class: 'msec', text: '進行中的任務' }));
  if (!doing.length) det.append(h('p', { class: 'hint', text: '目前沒有處理中的任務' }));
  for (const t of doing) {
    det.append(h('button', { class: 'homeproj', type: 'button', onclick: () => openTask(t.key) },
      h('div', { class: 'ptitle' }, h('span', { class: 'pid', text: tlabel(t.tnum) }), h('span', { class: 'pname clamp1', text: t.title })),
      h('div', { class: 'pline' }, h('b', { text: '🏃' }), h('span', { class: 'clamp1', text: t.progress || 'Agent 處理中' }))));
  }

  // 主要專案（有期限且等我 → 有期限 → Agent 可做 → 一般；暫停與結案不列；最多 3 個）
  det.append(h('h3', { class: 'msec', text: '主要專案' }));
  if (!top.length) det.append(h('p', { class: 'hint', text: '讀不到進行中的專案（Project.md 的「總覽」表）' }));
  for (const pr of top) {
    det.append(h('button', { class: 'homeproj', type: 'button', onclick: () => openProject(pr) },
      h('div', { class: 'ptitle' }, h('span', { class: 'pid', text: pr.pid }), h('span', { class: 'pname', text: pr.name })),
      h('div', { class: 'pline' }, h('b', { text: (STATUS_TEXT[pr.status] || '') + (isWaiting(pr) && pr.status !== '🟡' ? '｜等我' : '') }), h('span', { class: 'clamp1', text: dash(pr.next) }))));
  }
  det.append(h('div', { class: 'actions' }, h('button', { class: 'btn ghost wide', type: 'button', text: '看全部專案', onclick: () => { state.pfilter = '進行中'; setTab('projects'); } })));

  // 今日日記（圖示和文字要一致：partial 不是打勾）
  const written = js.state === 'filled' || js.state === 'collected' || js.state === 'done';
  det.append(h('h3', { class: 'msec', text: '今日日記' }),
    h('div', { class: 'homerow' }, h('span', { class: 'sticon', text: journalIcon(js.state) }),
      h('span', { class: 'sumtitle', text: (JSTATE[js.state] || '今天還沒寫') + (js.state === 'partial' ? '（' + js.filled + '/3）' : '') })),
    h('div', { class: 'actions' }, h('button', { class: 'btn ghost wide', type: 'button', text: written ? '看／補充日記' : js.state === 'partial' ? '繼續寫日記' : '寫日記', onclick: () => { state.rtab = 'journal'; setTab('record'); } })));
  return det;
}

// ---------- 首頁：一行狀態 → 重要提醒 → 精簡額度 → 更多資訊（預設收合）----------
function viewHome(p) {
  const st = curStatus(p);
  const wrap = h('div', { class: 'homepage' });
  const statusEl = statusLineCard(p, st);
  const remEl = remindersCard(getReminders());
  const mineEl = mineLine(); // 你寫的 N 件電腦還沒收 ›（0 件不顯示）
  // mineEl 可能是 null（0 件不顯示）；DOM 的 append(null) 會印出「null」字樣，要先濾掉
  const parts = STATUS_FIRST ? [statusEl, mineEl, remEl] : [remEl, statusEl, mineEl];
  wrap.append(...parts.filter(Boolean));
  wrap.append(quotaCompact(p), moreInfo(p));
  return wrap;
}

// 草稿框：內容存在這台手機（lib/drafts.js，agent.draft.*），切分頁、關掉 App 都還在；送出成功才清。
// opts.initial：沒有草稿時textarea 的預設內容（日記帶入目前已送出的內容）；opts.base：內容跟 base 一樣就不算草稿
function draftArea(key, placeholder, rows, opts = {}) {
  const ta = h('textarea', { placeholder, rows: rows || 3 });
  ta.value = (hasDraft(key) && !(opts.noClear && !getDraft(key).trim())) ? getDraft(key) : (opts.initial || ''); // opts.noClear：空白草稿不當成「清空」，照樣預填已寫過的答案（日記）； 草稿是空字串＝使用者清空，不能再填回舊答案
  const note = h('div', { class: 'draft-hint', text: '草稿已存在這台手機' });
  note.hidden = !getDraft(key).trim();
  ta.addEventListener('input', () => {
    if (opts.base != null && ta.value.trim() === String(opts.base).trim()) clearDraft(key);
    else if (opts.base != null) setEdit(key, ta.value);
    else setDraft(key, ta.value);
    note.hidden = !getDraft(key).trim();
  });
  ta.addEventListener('blur', () => { if (state.pending) setTimeout(render, 0); });
  const wrap = h('div', { class: 'draftbox' }, ta, note, opts.work ? h('div', { class: 'hint', text: WORK_HINT }) : null);
  wrap.ta = ta;
  return wrap;
}

// ---------- 2. 待我（Questions.md 全部題目＋Live.md「等你」，依題號去重） ----------
// 一次 render 只解析一次：Live.md／Questions.md 沒換、送出紀錄沒變，就重用上次的解析結果（換內容時 state.data.x 引用會變，自動失效）
let dMemo = { live: null, questions: null, sentKey: '', val: null, id: 0 };
const sentKeyOf = () => state.sent.length + ':' + state.sent.filter((r) => r.received).length + ':' + state.obRev;
// 還沒送成功的回答（排隊中、送出中、失敗）：題號 → outbox 項目（同一題取最後一筆）。這些卡片不算待答
let pmMemo = { rev: -1, val: new Map() };
function pendMap() {
  if (pmMemo.rev === state.obRev) return pmMemo.val;
  const m = new Map();
  for (const it of [...state.ob].sort((a, b) => a.createdAt - b.createdAt)) if (it.kind === 'answer' && it.state !== 'sent' && it.payload && it.payload.qid) m.set(it.payload.qid, it);
  pmMemo = { rev: state.obRev, val: m };
  return m;
}
const cst = (c) => cardState(c, state.sent, Date.now(), pendMap());
// 還要動手的卡（任務頁「我要動手 N」、任務徽章、首頁「🛠 動手 N 件」共用）
function doingOpenList() {
  if (!state.data) return [];
  const pm = pendMap();
  return derive().cards.filter((c) => isDoingOpen(c, pm.get(c.qid)));
}
const opn = (cards) => openCards(cards, state.sent, pendMap());
function derive() {
  const d = state.data;
  if (dMemo.val && dMemo.live === d.live && dMemo.questions === d.questions && dMemo.sentKey === sentKeyOf() && dMemo.pcText === (d.stateText || '')) return dMemo.val;
  const p = parseLive(d.live);
  const pcs = pcState();
  const cards = applyStillYours(buildCards(d.questions || '', p.waiting), pcs ? pcs.questions : []);
  const before = state.sent.filter((r) => r.received).length;
  reconcileIfLoaded(state.sent, cards, d.questions); // Questions.md 讀不到時不標成「已收到」
  if (state.sent.filter((r) => r.received).length !== before) saveSent(ls, state.sent);
  const open = opn(cards);
  dMemo = { live: d.live, questions: d.questions, sentKey: sentKeyOf(), pcText: d.stateText || '', val: { p, cards, open }, id: dMemo.id + 1 };
  return dMemo.val;
}

function currentCards() { return derive().cards; }

// 提醒資料（首頁「重要提醒」與「提醒事項」頁共用）：定期提醒用電腦端 state.json 的 routines（看板規則算的下次日期），
// 一次性提醒用 Task.md 未打勾的 [remind]（看板的日期判斷）。state.json 沒有 routines（舊檔、讀不到）→ routines 為 null，只用提醒表的名稱分流
function reminderData(now = new Date()) {
  const todayIso = isoOf(now);
  const tasks = withDoneOverlay(taskInfo().tasks); // 手機剛按完成的先當成已打勾
  const pc = pcState(now.getTime());
  const raw = pc && pc.routines ? pc.routines : null;
  const routines = raw ? routineView(raw, tasks, todayIso) : null;
  const settings = parseRemindSettings(state.data.task || '');
  const reminds = oneTimeReminders(tasks, todayIso, routinePrefixes(raw, settings));
  return { todayIso, tasks, routines, reminds, settings, staleNote: raw ? routinesStaleNote(pc.generatedMs, now.getTime()) : null, raw };
}

// 重要提醒（首頁）：以分鐘為單位重算（跨 17:45、跨日會自動更新）
let rMemo = { sig: '', val: null };
function getReminders() {
  if (!state.data) return { rows: [], count: 0, importantQids: [], backlog: 0 };
  const now = new Date();
  const dv = derive();
  const { tasks } = taskInfo();
  const sig = [dMemo.id, state.data.task, state.data.stateText, JSON.stringify(state.tnum), state.accepted.size, state.obRev, Math.floor(now.getTime() / 60000)].join('\x01'); // obRev：手機按了完成，首頁提醒要馬上少一件
  if (rMemo.sig === sig) return rMemo.val;
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yr = readJournal(state.data.task || '', y.getMonth() + 1, y.getDate());
  const js = journalStatus(state.data.task || '', now);
  const journal = { today: js, yesterday: { found: yr.found, checked: yr.checked, filled: yr.filled, month: y.getMonth() + 1, day: y.getDate() } };
  const rd = reminderData(now);
  const val = buildReminders({ openCards: dv.open, tasks: rd.tasks, journal, now, doing: doingOpenList(), routines: rd.routines, reminds: rd.reminds });
  rMemo = { sig, val };
  return val;
}

function pendingCount() {
  if (!state.data) return 0;
  return derive().open.length;
}

const deadlineChip = (d) => (hasDeadline(d) ? '期限 ' + (d.length > 22 ? d.slice(0, 22) + '…' : d) : '');

function optionButtons(c) {
  const sel = state.sel[c.qid] || (state.sel[c.qid] = new Set());
  // 選項分組（lib/questions.js parseOptionGroups）：每組單選／可複選各自算；沒有分組資訊（舊資料）就整題當一組
  const groups = c.groups && c.groups.length ? c.groups : [{ name: '', multi: c.multi, keys: c.options.map((o) => o.key) }];
  const wrap = h('div', { class: 'optgroups' });
  const btns = [];
  const paint = () => {
    for (const { b, o } of btns) {
      const on = sel.has(o.key);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.firstChild.textContent = (on ? '✓ ' : '') + o.key;
    }
  };
  groups.forEach((g, gi) => {
    const box = h('div', { class: 'opts', role: 'group', 'aria-label': (g.name ? g.name + '：' : '') + (g.multi ? '選項（可複選）' : '選項（單選）') });
    const opts = c.options.filter((o) => g.keys.includes(o.key));
    for (const o of opts) {
      const b = h('button', {
        class: 'opt', type: 'button', 'aria-pressed': 'false',
        onclick: () => {
          if (state.busy) return;
          if (g.multi) { if (sel.has(o.key)) sel.delete(o.key); else sel.add(o.key); } else if (sel.has(o.key)) sel.delete(o.key); else { for (const k of g.keys) sel.delete(k); sel.add(o.key); }
          paint();
        },
      }, h('span', { class: 'okey', text: o.key }), h('span', { class: 'olabel', text: o.label + (o.rec && !/建議/.test(o.label) ? '（建議）' : '') }));
      btns.push({ b, o });
      box.append(b);
    }
    if (groups.length > 1 || g.name) wrap.append(h('div', { class: 'ogroup-name', text: g.name || '第 ' + (gi + 1) + ' 組' + (g.multi ? '（可複選）' : '') }));
    wrap.append(box);
  });
  paint();
  return wrap;
}

// 待我頁用：題號 → 相關專案／任務（viewTodo 每次重算）
let qlinks = { proj: new Map(), tasks: [] };

// 題目的作答區：說明、選項按鈕、自由輸入、送出（問題頁的展開卡與動手卡的選項共用）。opts.quick：要不要放「照建議／不確定／需要討論」
function answerForm(c, st, opts = {}) {
  const out = [];
  const shown = bodyForDisplay(c.body, c.options);
  if (shown.length && opts.body !== false) out.push(mdBlock(shown.join('\n'), 'more md'));
  const groupsN = c.groups ? c.groups.length : 1;
  if (c.options.length) {
    out.push(h('div', { class: 'hint', text: groupsN > 1 ? '選項（每組選一個，點一下選取）' : c.multi ? '選項（可複選，點一下選取）' : '選項（單選，點一下選取）' }), optionButtons(c));
  } else if (c.choice) {
    out.push(h('div', { class: 'hint choicemiss', text: '選項格式讀不到，請直接打字' })); // 題庫標了「題型：選擇」但 App 解析不到選項
  }
  const area = draftArea('ans:' + c.qid, c.options.length ? '補充說明（選填）' : '寫下你的答案', c.options.length ? 2 : 4);
  const submit = () => {
    const sel = state.sel[c.qid] || new Set();
    const letters = c.options.filter((o) => sel.has(o.key)).map((o) => o.key);
    const ans = composeAnswer(letters, area.ta.value, c.options.map((o) => o.key));
    if (!ans) { toast('請先選一個選項或寫點內容', true); return; }
    sendAnswer(c, ans);
  };
  out.push(area, h('div', { class: 'actions' }, h('button', { class: 'btn wide', type: 'button', text: st === 'open' || st === 'doing' ? '送出答案' : '送出補充', onclick: submit })));
  if (opts.quick !== false) {
    // 快速按鈕：照建議／不確定。「延後」「需要討論」不再畫按鈕（QUICK.later、QUICK.discuss 常數保留給舊的寫入紀錄；10-29 需要討論從沒用過，想討論直接打字）
    const quick = h('div', { class: 'quick', role: 'group', 'aria-label': '快速回答' });
    if (c.suggest) quick.append(h('button', { class: 'btn ghost', type: 'button', text: '照建議' + (c.suggestKey ? '（' + c.suggestKey + '）' : ''), onclick: () => sendAnswer(c, QUICK.suggest) }));
    quick.append(
      h('button', { class: 'btn ghost', type: 'button', text: '不確定', onclick: () => sendAnswer(c, QUICK.unsure) }));
    out.push(quick);
  }
  return out;
}

function questionCard(c, st) {
  const open = state.openQ === c.qid;
  const rec = [...state.sent].reverse().find((r) => r.qid === c.qid);
  const dated = !!deadlineDate(c.deadline);
  const box = h('div', { class: 'q qcard' + (dated || c.liveKind === 'deadline' ? ' deadline' : '') + (st !== 'open' ? ' done' : '') + (st === 'ghost' ? ' ghost' : ''), id: 'q-' + c.qid });
  // 能展開的卡：標題區是一顆 button（跟任務卡一樣點了展開／收合）；button 裡不能再放 button，所以專案／任務 chip 在 button 外面
  const expandable = st !== 'queued' && st !== 'failed' && st !== 'ghost' && c.source !== 'dup';
  const meta = h('div', { class: 'qmeta' },
    h('span', { class: 'qid', text: c.qid }),
    c.backlog ? h('span', { class: 'tag', text: '擱置' }) : null,
    c.today ? h('span', { class: 'tag', text: '今日必答' }) : null,
    hasDeadline(c.deadline) ? h('span', { class: 'tag warn', text: deadlineChip(c.deadline) }) : (c.liveKind === 'deadline' ? h('span', { class: 'tag warn', text: '有期限' }) : null),
    c.category ? h('span', { class: 'tag', text: c.category }) : null);
  const title = inlineHtml(c.title, open ? 'qtitle' : 'qtitle clamp');
  if (expandable) {
    const hint = st === 'open' ? (c.options.length ? '點一下選擇或作答' : '點一下作答') : st === 'sent' ? '已送出｜點一下補充或修改' : '電腦已收到｜點一下補充';
    box.append(h('button', {
      class: 'qhead', type: 'button', 'aria-expanded': open ? 'true' : 'false',
      onclick: () => { state.openQ = open ? null : c.qid; render(); },
    }, meta, title, open ? null : h('div', { class: 'qtap', text: hint })));
  } else box.append(h('div', { class: 'qhead static' }, meta, title));
  const rp = qlinks.proj.get(c.qid) || [];
  const rt = tasksOfQuestion(qlinks.tasks, c.qid);
  if (rp.length || rt.length) {
    box.append(h('div', { class: 'relchips' },
      ...rp.map((pr) => h('button', { class: 'tag chiplink', type: 'button', text: pr.pid + ' · ' + pr.name, onclick: () => openProject(pr) })),
      ...rt.map((t) => h('button', { class: 'tag chiplink', type: 'button', text: tlabel(t.tnum) + ' · ' + [...t.title].slice(0, 14).join(''), onclick: () => openTask(t.key) }))));
  }
  if (c.blocker) box.append(h('div', { class: 'qblock', text: '卡住：' + c.blocker }));
  if (st === 'queued' || st === 'failed') {
    box.append(obCardState(pendMap().get(c.qid)));
    return box; // 已經存在手機了（或失敗了）：不再放回答按鈕，要改要刪到「我寫過的」
  }
  if (st === 'sent') {
    box.append(h('div', { class: 'qstate sent', text: rec ? '⏳ 已送出 ' + hhmm(rec.at) + '｜' + rec.summary + '｜等電腦收' + (rec.target === 'supplement' ? '（手機補答）' : '') : '⏳ 已有答案（等電腦收）：' + summarize(c.answer) }));
  } else if (st === 'received') {
    box.append(h('div', { class: 'qstate received', text: '✅ 電腦已收到' + (rec ? '｜' + hhmm(rec.at) + ' 送的「' + rec.summary + '」' : '') }));
  } else if (st === 'open' && c.stillYours) {
    box.append(h('div', { class: 'qstate stillyours', text: '⏳ 電腦已收到，還有你要做的' }));
  } else if (st === 'pc') {
    box.append(h('div', { class: 'qstate received', text: '✅ 電腦已收到' + (rec ? '｜' + hhmm(rec.at) + ' 送的「' + rec.summary + '」' : '（等 routine 套用）') }));
  } else if (st === 'ghost') {
    box.append(h('div', { class: 'qstate ghost', text: '電腦那邊可能已處理（題目檔裡已經沒有這題）' }));
    return box; // 沒有回答按鈕
  }
  if (c.source === 'dup') {
    box.append(h('div', { class: 'qblock', text: '⚠ 這題在題目檔重複，沒辦法從手機回答，請到電腦確認' }));
    return box; // 一定送不出去，不放回答按鈕（QC 建議 6）
  }
  if (c.live.length && c.source === 'questions') box.append(h('div', { class: 'hint', text: 'Live.md 等你：' + c.live.map((l) => l.label).join('、') }));
  if (!open) return box;
  box.append(...answerForm(c, st));
  return box;
}

// 待我頁目前篩選（重要／待答／已送出／全部＋專案）通過的題目；viewTodo 與送出後找下一題共用，順序才會跟畫面一致
function inTodoFilter(c, impSet) {
  const st = cst(c);
  if (state.qproj !== 'all' && !(qlinks.proj.get(c.qid) || []).some((pr) => pr.pid === state.qproj)) return false;
  return todoPass(state.qfilter, st, { backlog: c.backlog, important: impSet.has(c.qid) });
}

function viewTodo(p) {
  const cards = currentCards(p).filter((c) => !c.doing); // 動手題在任務頁的動手區
  const open = opn(cards);
  const nOpen = open.length;
  const nSent = cards.filter((c) => !['open', 'ghost', 'failed'].includes(cst(c))).length;
  const impSet = new Set(getReminders().importantQids);
  if (state.openQ === undefined) { const first = state.qfilter === 'important' ? open.find((c) => impSet.has(c.qid)) : open[0]; state.openQ = first ? first.qid : null; state.autoQ = state.openQ; }
  const wrap = h('div');
  const projs = allProjects(state.data.project || '');
  qlinks = { proj: projectsByQid(projs, cards), tasks: taskInfo().tasks };
  wrap.append(h('section', { class: 'card sumcard' },
    h('div', { class: 'bignum', text: String(nOpen) }),
    h('div', { class: 'sumtitle', text: nOpen ? '題等你回答' : '目前沒有待答的題目' }),
    h('div', { class: 'hint sumhint', text: '已送出 ' + nSent + '｜共 ' + cards.length })));
  const recent = state.sent.slice(-3).reverse();
  if (recent.length) {
    // 預設收合，第一屏留給題目
    wrap.append(h('details', { class: 'card feed recent' }, h('summary', { text: '送出紀錄 ' + state.sent.length + ' 筆（點開看狀態）' }),
      h('ul', {}, ...recent.map((r) => h('li', {}, h('div', { text: r.qid + '｜' + r.summary }),
        h('div', { class: 'meta', text: '已送出 ' + hhmm(r.at) + '｜' + (r.received ? '✅ 電腦已收到' : '⏳ 等電腦收' + (r.target === 'supplement' ? '（手機補答）' : '')) }))))));
  }
  const nImp = open.filter((c) => impSet.has(c.qid)).length;
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': '篩選' });
  for (const [k, label] of [['important', '重要 ' + nImp], ['open', '待答 ' + nOpen], ['sent', '已送出 ' + nSent], ['all', '全部 ' + cards.length]]) {
    chips.append(h('button', {
      class: 'chip' + (state.qfilter === k ? ' active' : ''), type: 'button', text: label, 'aria-pressed': state.qfilter === k ? 'true' : 'false',
      onclick: () => { state.qfilter = k; render(); },
    }));
  }
  wrap.append(h('div', { class: 'chipwrap' }, chips));
  // 依專案篩選：只列有相關題目的專案
  const selRow = h('div', { class: 'qselrow' }); // P50c：專案篩選和排序併成一行（原本各佔一行）
  const withQ = projs.filter((pr) => cards.some((c) => (qlinks.proj.get(c.qid) || []).includes(pr)));
  if (state.qproj !== 'all' && !withQ.some((pr) => pr.pid === state.qproj)) state.qproj = 'all';
  if (withQ.length) {
    const ps = h('select', { 'aria-label': '依專案篩選' }, h('option', { value: 'all', text: '全部專案' }), ...withQ.map((pr) => h('option', { value: pr.pid, text: pr.pid + ' ' + pr.name })));
    ps.value = state.qproj;
    ps.addEventListener('change', () => { state.qproj = ps.value; blurActive(); render(); }); // 先 blur：isTyping() 把 select 也算輸入中，有焦點時 render 會被延後
    selRow.append(ps);
  }
  const list = cards.filter((c) => inTodoFilter(c, impSet));
  // 排序（記在 agent.qsort）
  const ss = h('select', { 'aria-label': '排序方式' }, ...SORTS.map(([k, label]) => h('option', { value: k, text: '排序：' + label })));
  ss.value = state.qsort;
  ss.addEventListener('change', () => { state.qsort = ss.value; saveQSort(ls, state.qsort); blurActive(); render(); });
  selRow.append(ss);
  wrap.append(selRow);
  if (!list.length) wrap.append(h('div', { class: 'empty', text: state.qfilter === 'open' ? '全部回答完了 🎉' : state.qfilter === 'important' ? '沒有重要題了，其他題目在「待答」' : '這個分類沒有題目' }));
  // 依分類分組（今日必答最前、擱置最後），每組可收合（記在 agent.qgroups，只存分類名稱）
  const groups = groupCards(list, state.qsort, impSet);
  for (const g of groups) {
    // 使用者明確打開的題（不是頁面一開始自動展開的第一題）所在的組強制展開，才看得到那一題
    const hasOpen = !!state.openQ && state.openQ !== state.autoQ && g.cards.some((c) => c.qid === state.openQ);
    const collapsed = isCollapsed(g, state.qgroups, state.qfilter, hasOpen);
    wrap.append(h('button', {
      class: 'group-title gtoggle' + (collapsed ? ' collapsed' : ''), type: 'button', 'aria-expanded': collapsed ? 'false' : 'true',
      onclick: () => { if (g.cards.some((c) => c.qid === state.openQ)) state.openQ = null; state.qgroups = toggledCollapsed(state.qgroups, g.key, collapsed, g, state.qfilter); saveQGroups(ls, state.qgroups); render(); }, // 依畫面目前狀態（含強制展開）反轉
    }, h('span', { class: 'gchev', 'aria-hidden': 'true', text: collapsed ? '▸' : '▾' }), h('span', { text: g.label })));
    if (collapsed) continue;
    for (const c of g.cards) wrap.append(questionCard(c, cst(c)));
  }
  return wrap;
}

async function guarded(fn) {
  if (state.busy) return undefined;
  state.busy = true;
  setBusy(true);
  try { return await fn(); } catch (e) { toast(errMsg(e), true); if (e.partial && !demo) refresh(true); return undefined; } finally { state.busy = false; setBusy(false); }
}

// 送出中：整頁按鈕與輸入框變灰，防止重複送出
function setBusy(on) {
  for (const b of $('view').querySelectorAll('button, textarea, input, select')) b.disabled = on;
  document.body.classList.toggle('busy', on);
}

function scrollToCard(qid) {
  requestAnimationFrame(() => {
    const el = qid && document.getElementById('q-' + qid);
    if (el) el.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
  });
}

// 送出一題的答案：先存手機（寫入紀錄），畫面立刻變成「已存手機」，再背景送；自動展開下一題未回答的題目
function sendAnswer(c, answer) {
  const now = new Date();
  enqueue('answer', answerPayload(c, answer));
  clearDraft('ans:' + c.qid);
  state.sel[c.qid] = new Set();
  blurActive();
  if (c.doing) { // 動手卡用選項／文字回答：留在任務頁，不跳下一題
    state.ttab = lockDoingTab(state.ttab);
    toast('✅ 已存手機 ' + hhmm(now.getTime()) + (isOffline() ? '（沒網路，連上會自動送）' : ''));
    state.pending = false;
    render();
    return true;
  }
  const p = parseLive(state.data.live);
  const cards = currentCards(p).filter((x) => !x.doing);
  const open = opn(cards);
  // 下一題：照目前篩選＋分組排序後畫面上的順序往下找（剛答的這題先留在清單裡當起點）；「還有 N 題」也用目前篩選的數量
  const impSet = new Set(getReminders().importantQids);
  qlinks = { proj: projectsByQid(allProjects(state.data.project || ''), cards), tasks: taskInfo().tasks };
  const flat = groupCards(cards.filter((x) => x.qid === c.qid || inTodoFilter(x, impSet)), state.qsort, impSet).flatMap((g) => g.cards);
  const cand = flat.filter((x) => !x.backlog && cst(x) === 'open' && inTodoFilter(x, impSet));
  const pool = state.qfilter === 'sent' ? open : cand;
  const idx = flat.findIndex((x) => x.qid === c.qid);
  const next = flat.slice(idx + 1).find((x) => pool.includes(x)) || pool[0] || null;
  state.openQ = next ? next.qid : null;
  toast('✅ 已存手機 ' + hhmm(now.getTime()) + '｜' + (pool.length ? '還有 ' + pool.length + ' 題待答' : '全部回答完了') + (isOffline() ? '（沒網路，連上會自動送）' : ''));
  state.pending = false;
  render();
  scrollToCard(state.openQ);
  return true;
}

// ---------- 任務頁（新增任務＋依狀態分組） ----------
const TF_RESET = { open: false, mode: 'auto', pid: '', deadline: '', type: 'agent' };

function taskFormCard() {
  const tf = state.tf;
  if (!tf.open) {
    return h('section', { class: 'card slim' }, h('button', { class: 'btn wide', type: 'button', text: '＋新增任務', onclick: () => { state.tf = { ...TF_RESET, open: true }; render(); } }));
  }
  const popts = projectOptions(allProjects(state.data.project || ''), state.recentP, tf.pid);
  const choices = popts.choices;
  const area = draftArea('taskv3', '要 Agent 做什麼？', 4, { work: true });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '專案' });
  const sel = h('select', { 'aria-label': '選擇專案' });
  const addGroup = (label, items) => {
    if (!items.length) return;
    sel.append(h('optgroup', { label }, ...items.map((c) => h('option', { value: c.pid, text: c.pid + ' ' + c.name }))));
  };
  if (popts.extra) sel.append(h('optgroup', { label: '不在進行中清單' }, h('option', { value: popts.extra.pid, text: popts.extra.pid + (popts.extra.name ? ' ' + popts.extra.name : '') + '（' + popts.extra.note + '）' })));
  addGroup('最近用過', choices.filter((c) => c.recent));
  addGroup('進行中', choices.filter((c) => !c.recent));
  sel.append(h('optgroup', { label: '其他' }, h('option', { value: 'none', text: '不屬於任何專案' })));
  sel.value = popts.value;
  const paintSeg = () => {
    seg.replaceChildren(
      h('button', { class: 'chip' + (tf.mode === 'auto' ? ' active' : ''), type: 'button', 'aria-pressed': tf.mode === 'auto' ? 'true' : 'false', text: '● 自動', onclick: () => { tf.mode = 'auto'; paintSeg(); } }),
      h('button', { class: 'chip' + (tf.mode === 'pick' ? ' active' : ''), type: 'button', 'aria-pressed': tf.mode === 'pick' ? 'true' : 'false', text: '○ 選擇', onclick: () => { tf.mode = 'pick'; tf.pid = sel.value; paintSeg(); } }));
    sel.hidden = tf.mode !== 'pick';
    autoHint.hidden = tf.mode !== 'auto';
  };
  const autoHint = h('div', { class: 'hint', text: '由 Agent 判斷屬於哪個專案、獨立任務，或建議升格成專案' });
  sel.addEventListener('change', () => { tf.pid = sel.value; });
  const date = h('input', { type: 'date', 'aria-label': '期限（選填）' });
  date.value = tf.deadline || '';
  date.addEventListener('change', () => { tf.deadline = date.value; });
  const type = h('select', { 'aria-label': '類型' }, h('option', { value: 'agent', text: '交給 Agent' }), h('option', { value: 'remind', text: '提醒我' }));
  type.value = tf.type;
  type.addEventListener('change', () => { tf.type = type.value; });
  paintSeg();
  const submit = () => {
    const content = area.ta.value.trim();
    if (!content) { toast('請先寫點內容', true); return; }
    const project = tf.mode === 'auto' ? 'auto' : sel.value;
    if (!project) { toast('請選一個專案，或改選「自動」／「不屬於任何專案」', true); return; } // 不要默默寫成不屬於任何專案
    enqueue('task', { tag: tf.type, content, project, deadline: tf.deadline, where: '手機 App 任務頁' });
    blurActive();
    clearDraft('taskv3');
    if (/^P\d+$/.test(project)) state.recentP = pushRecentP(ls, project);
    state.tf = { ...TF_RESET };
    toast('✅ 已存手機 ' + hhmm(Date.now()) + '｜' + (isOffline() ? '沒網路，連上會自動送' : '送出中'));
    state.pending = false;
    render();
    window.scrollTo(0, 0);
  };
  return h('section', { class: 'card' }, h('h2', { text: '＋新增任務' }),
    h('label', { text: '任務' }), area,
    h('label', { text: '專案' }), seg, autoHint, sel,
    h('label', { text: '期限（選填）' }), date,
    h('details', { class: 'guide' }, h('summary', { text: '進階' }), h('label', { text: '類型' }), type),
    h('div', { class: 'actions' },
      h('button', { class: 'btn wide', type: 'button', text: '送出', onclick: submit }),
      h('button', { class: 'btn ghost', type: 'button', text: '取消', onclick: () => { state.tf = { ...TF_RESET }; render(); } })));
}

function stateTag(t) {
  const cls = t.state === 'waiting' || t.state === 'resumable' ? 'warn' : t.state === 'review' ? 'review' : t.state === 'failed' ? 'bad' : '';
  return h('span', { class: 'tag tstate ' + cls, text: (STATE_ICON[t.state] || '') + ' ' + t.stateLabel });
}

// tags：給了就取代狀態標籤（提醒分頁用日期標籤，每張都寫「提醒：你要做」沒有資訊量）
function taskCard(t, pmap, cards, tags = null) {
  const open = state.expanded.has('task:' + t.key);
  const box = h('div', { class: 'q taskcard st-' + t.state, id: 't-' + t.key });
  const head = h('button', {
    class: 'thead', type: 'button', 'aria-expanded': open ? 'true' : 'false',
    onclick: () => { if (open) state.expanded.delete('task:' + t.key); else state.expanded.add('task:' + t.key); render(); },
  }, h('div', { class: 'ttitle' }, h('span', { class: 'qid', text: tlabel(t.tnum) }), h('span', { class: open ? 'tname' : 'tname clamp2', text: t.title })));
  if (t.projects.length) {
    head.append(h('div', { class: 'tproj', text: t.projects.map((pid) => pid + (pmap.get(pid) ? ' · ' + pmap.get(pid).name : '')).join('、') + (t.projectInferred ? '（推測）' : '') }));
  }
  head.append(h('div', { class: 'tstatebox' }, ...(tags || [stateTag(t)])));
  const mo = t.mid ? state.ob.find((x) => x.id === t.mid) : null;
  if (mo) head.append(h('div', { class: 'hint', text: '手機寫入｜' + hhmm(mo.createdAt) + ' 存手機，' + (mo.sentAt ? hhmm(mo.sentAt) + ' 送出' : '還沒送出') }));
  if (state.promoteReq[t.key] && t.state === 'waiting' && !promoteStale(state.promoteReq[t.key])) head.append(h('div', { class: 'hint promoted-hint', text: '⬆️ 已送出升格請求 ' + hhmm(state.promoteReq[t.key]) + '，等主 Agent 開專案' }));
  box.append(head);
  if (t.tag === 'remind' && !t.checked && !/^今日必答/.test(t.title)) box.append(remindActs(t)); // 提醒：不用先點開就能完成／回覆
  if (!open) return box;
  const d = h('div', { class: 'detail tdetail' });
  if (t.bodyMd) d.append(mdBlock(t.bodyMd, 'md'));
  if (t.result) d.append(h('div', { class: 'pline' }, h('b', { text: '結果' }), h('span', { text: t.result })));
  if (t.deadline) d.append(h('div', { class: 'pline' }, h('b', { text: '期限' }), h('span', { text: t.deadline })));
  const known = new Set(cards.map((c) => c.qid));
  for (const q of t.qids.filter((x) => known.has(x))) {
    d.append(h('button', { class: 'btn ghost wide relq', type: 'button', onclick: () => { state.qfilter = 'all'; state.openQ = q; setTab('todo'); scrollToCard(q); } }, h('span', { class: 'qid', text: q }), h('span', { class: 'clamp1', text: (cards.find((c) => c.qid === q) || {}).title })));
  }
  const acts = h('div', { class: 'quick' });
  const ctx = { kind: 'task', id: tlabel(t.tnum), label: t.title, pid: t.projects[0] || '' };
  if (t.state === 'waiting' || t.state === 'resumable') {
    acts.append(h('button', { class: 'btn', type: 'button', text: '回覆這件事', onclick: () => startChat(ctx) }));
    if (t.state === 'waiting' && wantsPromote(t)) {
      const at = state.promoteReq[t.key];
      const po = obPending('promote', t.key); // 升格請求還在手機上（排隊中、送出中、失敗）
      const pk = obPending('keep', t.key);
      const openForm = () => { state.promoteReq = removePromoteReq(ls, t.key); state.pf = { key: t.key, ...promoteDefaults(t) }; render(); };
      if (po) {
        acts.append(h('div', { class: 'promoted-note ob-' + po.state, role: 'status', text: '⬆️ 升格請求 ' + obChip(po) + (po.state === 'failed' ? '：' + po.err : '') }));
        if (po.state !== 'sending') acts.append(obActions(po));
      } else if (at && promoteStale(at)) {
        // 超過 24 小時還在等我：改成可以再送一次（按了重新展開表單）
        acts.append(h('button', { class: 'btn ghost promoted-stale', type: 'button', text: '⬆️ 已送出 ' + mmddhhmm(at) + '，還沒處理？再送一次', onclick: openForm }));
      } else if (at) acts.append(h('div', { class: 'promoted-note', role: 'status', text: '⬆️ 已送出升格請求 ' + hhmm(at) + '，等主 Agent 開專案' }));
      else if (state.pf && state.pf.key === t.key) acts.append(promoteForm(t));
      else acts.append(h('button', { class: 'btn ghost', type: 'button', text: '升格專案', onclick: openForm }));
      if (pk) {
        acts.append(h('div', { class: 'promoted-note ob-' + pk.state, role: 'status', text: '↩️ 維持任務 ' + obChip(pk) + (pk.state === 'failed' ? '：' + pk.err : '') }));
        if (pk.state !== 'sending') acts.append(obActions(pk));
      } else if (!at && !po) acts.append(h('button', { class: 'btn ghost', type: 'button', text: '維持任務', onclick: () => sendKeep(t) }));
    }
  }
  if (t.state === 'review') {
    acts.append(
      h('button', { class: 'btn', type: 'button', text: '接受結果', onclick: () => { state.accepted = addAccepted(ls, t.key); toast('已標記完成（只存在這支手機）'); render(); } }),
      h('button', { class: 'btn ghost', type: 'button', text: '需要修改', onclick: () => startChat(ctx, '需要修改：') }),
      h('button', { class: 'btn ghost', type: 'button', text: '後續任務', onclick: () => openTaskForm({ content: '接續 ' + tlabel(t.tnum) + '：', pid: t.projects[0] || '' }) }));
  }
  if (acts.children.length) d.append(acts);
  box.append(d);
  return box;
}

// ---------- 提醒：完成／回覆（2026-10-30 使用者：提醒也要能回應或勾完成）----------
// 完成＝Task.md 那筆改成 [x]＋「結果：手機打勾｜備註（日期，手機 App …）」；回覆＝底下加「手機回覆：…」，電腦 routine 看到會處理、
// 處理完在底下寫「Agent 回覆：…」（點開提醒就看得到）。兩種都先存手機（outbox），沒網路也能按。
function remindActs(t) {
  const wrap = h('div', { class: 'remacts' });
  const pd = obPending('done', t.key);
  const pr = obPending('reply', t.key);
  if (pd) wrap.append(obCardState(pd)); // 只會是失敗的（排隊中、送出中的完成會讓這張卡先藏起來）
  if (pr) wrap.append(obCardState(pr));
  const mode = state.rform && state.rform.key === t.key ? state.rform.mode : '';
  const cancel = h('button', { class: 'btn ghost', type: 'button', text: '取消', onclick: () => { state.rform = null; render(); } });
  if (mode === 'done') {
    const area = draftArea('rd:' + t.key, '備註（選填，一行）：例如「已辦好，下次 2027/11」', 1);
    wrap.append(area, h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', text: '確認完成', onclick: () => sendRemindDone(t, area.ta.value) }), cancel));
  } else if (mode === 'reply') {
    const area = draftArea('rr:' + t.key, '想跟 Agent 說什麼？例如「延到 11/10」「已問完，答案是…」「這個不用了」', 3);
    wrap.append(area, h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', text: '送出回覆', onclick: () => sendRemindReply(t, area.ta.value) }), cancel));
  } else if (!pd || pd.state === 'failed') {
    wrap.append(h('div', { class: 'quick' },
      h('button', { class: 'btn small', type: 'button', text: '✓ 完成', onclick: () => { state.rform = { key: t.key, mode: 'done' }; render(); } }),
      h('button', { class: 'btn small ghost', type: 'button', text: '💬 回覆', onclick: () => { state.rform = { key: t.key, mode: 'reply' }; render(); } })));
  }
  return wrap;
}

function sendRemindDone(t, note) {
  enqueue('done', { title: t.title, key: t.key, tnum: t.tnum, note: String(note || '').trim(), summary: '完成' });
  clearDraft('rd:' + t.key);
  state.rform = null;
  blurActive();
  toast('✅ 已存手機：完成「' + [...t.title].slice(0, 14).join('') + '」' + (isOffline() ? '（沒網路，連上會自動送）' : ''));
  state.pending = false;
  render();
}

function sendRemindReply(t, text) {
  if (!String(text || '').trim()) { toast('請先寫回覆內容', true); return; }
  enqueue('reply', { title: t.title, key: t.key, tnum: t.tnum, content: String(text).trim(), summary: '回覆' });
  clearDraft('rr:' + t.key);
  state.rform = null;
  blurActive();
  toast('✅ 已存手機：回覆，電腦整理時會處理' + (isOffline() ? '（沒網路，連上會自動送）' : ''));
  state.pending = false;
  render();
}

// 手機上按了完成、還沒失敗的提醒：畫面先當成已打勾（不用等電腦或重抓），失敗的會回來並顯示原因
function withDoneOverlay(tasks) {
  const keys = new Set(state.ob.filter((x) => x.kind === 'done' && x.state !== 'failed' && x.payload).map((x) => x.payload.key));
  return keys.size ? tasks.map((t) => (keys.has(t.key) && !t.checked ? { ...t, checked: true } : t)) : tasks;
}

// 升格成專案（Q210 A）：先展開小表單（名稱、理由都預填、可改），按「送出升格請求」才寫一行固定格式到 Live.md 對話
function promoteForm(t) {
  const pf = state.pf;
  const name = h('input', { type: 'text', value: pf.name, maxlength: '60', autocomplete: 'off', 'aria-label': '專案名稱' });
  name.addEventListener('input', () => { pf.name = name.value; });
  const reason = h('textarea', { rows: 2, placeholder: '理由（選填）', 'aria-label': '理由' });
  reason.value = pf.reason;
  reason.addEventListener('input', () => { pf.reason = reason.value; });
  return h('div', { class: 'promoteform' },
    h('label', { text: '專案名稱' }), name,
    h('label', { text: '理由' }), reason,
    h('div', { class: 'hint', text: '原任務會保留；主 Agent 開好專案後，會在原任務結果寫「已升格 → PXX」。' + WORK_HINT }),
    h('div', { class: 'quick' },
      h('button', { class: 'btn', type: 'button', text: '送出升格請求', onclick: () => sendPromote(t) }),
      h('button', { class: 'btn ghost', type: 'button', text: '取消', onclick: () => { state.pf = null; render(); } })));
}

function sendPromote(t) {
  const pf = state.pf;
  if (!pf || pf.key !== t.key) return;
  if (!pf.name.trim()) { toast('請先填專案名稱', true); return; }
  // 不再寫進對話區：改成 Task.md 該任務底下的一個子行「升格請求：名稱｜理由（時間 手機）」
  enqueue('promote', { title: t.title, key: t.key, tnum: t.tnum, name: pf.name, reason: pf.reason });
  state.pf = null;
  blurActive();
  toast('✅ 已存手機：升格請求 ' + hhmm(Date.now()));
  state.pending = false;
  render();
}

// 維持任務：Task.md 該任務底下加一個子行「維持任務（時間 手機）」，不進對話區
function sendKeep(t) {
  enqueue('keep', { title: t.title, key: t.key, tnum: t.tnum });
  blurActive();
  toast('✅ 已存手機：維持任務 ' + hhmm(Date.now()));
  state.pending = false;
  render();
}

const COLLAPSED_TASK_GROUPS = ['recent', 'overdue', 'older']; // 預設收合的組（過期提醒在「提醒」分頁，最近完成、更早完成在「交辦 Agent」分頁）

// 動手卡：標題（點了展開步驟）＋三段狀態鈕（還沒做／進行中／已完成）。狀態一改就送出（走回答路徑，kind answer）；
// 已完成先跳出一行備註框。有選項時展開後照放選項按鈕。
function sendDoing(c, st, note = '') {
  const existing = [...String(c.answer || '').split('\n'), ...state.ob.filter((x) => x.kind === 'answer' && x.payload && x.payload.qid === c.qid).map((x) => x.payload.answer)];
  enqueue('answer', doingPayload(c, st, note, new Date(), existing));
  state.ttab = lockDoingTab(state.ttab); // 最後一題做完 nDoing 變 0 也不跳走，才看得到「⏳ 已送出」
  state.doingNote = null;
  clearDraft('dn:' + c.qid);
  blurActive();
  toast('✅ 已存手機 ' + hhmm(Date.now()) + '｜' + st + (isOffline() ? '（沒網路，連上會自動送）' : ''));
  state.pending = false;
  render();
}

function doingCard(c) {
  const pend = pendMap().get(c.qid);
  const ds = doingStatus(c, pend);
  const key = 'doing:' + c.qid;
  const open = state.expanded.has(key);
  const finished = ds.state === '已完成' || ds.answered;
  const box = h('div', { class: 'q taskcard doingcard' + (finished ? ' done' : ''), id: 'q-' + c.qid });
  const title = c.title.replace(/^動手[：:]\s*/, '');
  const head = h('button', {
    class: 'thead', type: 'button', 'aria-expanded': open ? 'true' : 'false',
    onclick: () => { if (open) state.expanded.delete(key); else state.expanded.add(key); render(); },
  }, h('div', { class: 'ttitle' }, h('span', { class: 'qid', text: c.qid }), h('span', { class: open ? 'tname' : 'tname clamp2', text: title })));
  const tags = h('div', { class: 'tstatebox' },
    hasDeadline(c.deadline) ? h('span', { class: 'tag warn', text: deadlineChip(c.deadline) }) : null,
    c.category ? h('span', { class: 'tag', text: c.category }) : null);
  head.append(tags);
  box.append(head);
  if (pend) box.append(obCardState(pend));
  else if (ds.answered) box.append(h('div', { class: 'qstate received', text: '✅ 已用選項／文字回答，電腦處理中' }));
  else if (ds.from === 'answer') box.append(h('div', { class: 'qstate sent', text: '⏳ 已送出「' + ds.state + '」，等電腦收' }));
  else if (ds.from === 'meta' && ds.at) box.append(h('div', { class: 'hint', text: '電腦記錄：' + ds.state + '（' + ds.at + '）' }));
  if (!ds.answered) {
    const seg = h('div', { class: 'seg doingseg', role: 'group', 'aria-label': '動手狀態' });
    for (const st of ['還沒做', '進行中', '已完成']) {
      const on = ds.state === st;
      seg.append(h('button', {
        class: 'chip' + (on ? ' active' : ''), type: 'button', text: (on ? '✓ ' : '') + st, 'aria-pressed': on ? 'true' : 'false',
        onclick: () => {
          if (on && state.doingNote !== c.qid) return;
          if (st === '已完成') { state.ttab = lockDoingTab(state.ttab); state.doingNote = c.qid; render(); } else sendDoing(c, st);
        },
      }));
    }
    box.append(seg);
    if (state.doingNote === c.qid) {
      const area = draftArea('dn:' + c.qid, '做完了什麼？（選填，一行）', 1);
      box.append(area, h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', text: '確認完成', onclick: () => sendDoing(c, '已完成', area.ta.value) }),
        h('button', { class: 'btn ghost', type: 'button', text: '取消', onclick: () => { state.doingNote = null; render(); } })));
    }
  }
  if (open) {
    const d = h('div', { class: 'detail tdetail' });
    if (c.options.length || c.choice) d.append(...answerForm(c, 'doing', { quick: false }));
    else {
      const shown = bodyForDisplay(c.body, c.options);
      d.append(shown.length ? mdBlock(shown.join('\n'), 'more md') : h('div', { class: 'hint', text: '沒有步驟說明，細節在電腦的題庫裡' }));
    }
    box.append(d);
  }
  return box;
}

// 任務頁：頂端三個分頁（我要動手／交辦 Agent／提醒），一次只顯示一個分頁的內容。
// 使用者沒選過就走預設（有未完成的動手題停在「我要動手」，沒有停在「交辦 Agent」）；選過就記在 state.ttab（這次開著 App 期間）。
function viewTasks(p) {
  const { tasks } = taskInfo();
  const cards = currentCards(p).filter((c) => !c.doing); // 任務卡的「相關題目」按鈕只連到問題頁
  const pmap = new Map(allProjects(state.data.project || '').filter((x) => x.pid && !x.closed).map((x) => [x.pid, x]));
  const dcards = doingCards(currentCards(p));
  const pm = pendMap();
  const isOpen = (c) => isDoingOpen(c, pm.get(c.qid));
  const nDoing = dcards.filter(isOpen).length;
  const pendTasks = pendingOf('task'); // 剛寫的（排隊中、送出中、失敗，或剛送出）：馬上出現，不用等重抓
  const groups = groupTasks(tasks, new Date()).filter((g) => g.items.length);
  const nAgent = groups.filter((g) => ACTIVE_GROUPS.includes(g.key)).reduce((n, g) => n + g.items.length, 0) + pendTasks.length;
  const rd = reminderData();
  const rsec = remindTabSections(rd.tasks, rd.todayIso, rd.routines, routinePrefixes(rd.raw, rd.settings));
  const nRemind = rsec.count;
  const cur = resolveTaskTab(state.ttab, nDoing);
  const counts = { doing: nDoing, agent: nAgent, remind: nRemind };
  const wrap = h('div');
  wrap.append(tabBar(h, {
    items: TASK_TABS.map(([k, label]) => [k, label + (counts[k] ? ' ' + counts[k] : '')]),
    current: cur, label: '任務分頁',
    onPick: (k) => { blurActive(); state.ttab = k; render(); window.scrollTo(0, 0); }, // 先 blur：iOS 點按鈕不會讓輸入框失焦，render 會被當成輸入中而延後
  }));
  if (cur === 'doing') {
    if (!dcards.length) wrap.append(h('div', { class: 'empty', text: '目前沒有要你動手的事 🎉' }));
    else {
      const ordered = [...dcards.filter(isOpen), ...dcards.filter((c) => !isOpen(c))];
      for (const c of ordered) wrap.append(doingCard(c));
    }
    return wrap;
  }
  const renderGroup = (g, collapsible) => {
    const label = g.label + ' ' + g.items.length;
    if (collapsible) {
      const k = 'tg:' + g.key;
      const det = h('details', { class: 'card tgroup' }, h('summary', { text: label + (g.key === 'overdue' ? '（日期已過，預設收起）' : '（預設收起）') }));
      if (state.expanded.has(k)) det.open = true;
      det.addEventListener('toggle', () => { if (det.open) state.expanded.add(k); else state.expanded.delete(k); });
      for (const t of g.items) det.append(taskCard(t, pmap, cards));
      wrap.append(det);
    } else {
      wrap.append(h('div', { class: 'group-title', id: 'tg-' + g.key, text: label }));
      for (const t of g.items) wrap.append(taskCard(t, pmap, cards));
    }
  };
  if (cur === 'remind') {
    // 2026-10-30：跟首頁、「提醒事項」頁、電腦版看板同一套判斷（lib/reminders.js remindTabSections）。
    // 已打勾、今日必答不列；定期提醒照電腦算的期別；一次性的 14 天內＋過期 7 天內直接展開，其餘收起來
    const md = (iso) => Number(iso.slice(5, 7)) + '/' + Number(iso.slice(8, 10));
    const dateTag = (x) => (x.date ? h('span', { class: 'tag' + (x.days < 0 ? ' bad' : x.days === 0 ? ' review' : ''), text: md(x.date) + '｜' + dueText(x.days) }) : null);
    const card = (t, tags) => taskCard(t, pmap, cards, tags);
    const title = (id, text) => wrap.append(h('div', { class: 'group-title', id, text }));
    const you = rsec.periodic.filter((x) => x.who !== 'auto');
    const auto = rsec.periodic.filter((x) => x.who === 'auto');
    const routineTag = (x) => [h('span', { class: 'tag bad', text: '● 這期還沒做' }), h('span', { class: 'tag', text: x.routine })];
    if (you.length) { title('rt-you', '這期要做的定期提醒 ' + you.length); for (const x of you) wrap.append(card(x.t, routineTag(x))); }
    if (auto.length) { title('rt-auto', '電腦產出給你看 ' + auto.length); for (const x of auto) wrap.append(card(x.t, [h('span', { class: 'tag review', text: '● 等你看' })])); }
    title('rt-soon', '近期提醒 ' + rsec.soon.length);
    if (!rsec.soon.length) wrap.append(h('div', { class: 'empty', text: '14 天內沒有到期的提醒' }));
    for (const x of rsec.soon) wrap.append(card(x.t, [dateTag(x)]));
    const fold = (key, label, list, tagOf) => {
      if (!list.length) return;
      const det = h('details', { class: 'card tgroup' }, h('summary', { text: label + ' ' + list.length + '（預設收起）' }));
      // 從首頁或別頁點某個提醒進來（openTask 會把它標成展開）：它所在的那組也打開
      if (state.expanded.has(key) || list.some((x) => state.expanded.has('task:' + x.t.key))) det.open = true;
      det.addEventListener('toggle', () => { if (det.open) state.expanded.add(key); else state.expanded.delete(key); });
      for (const x of list) det.append(card(x.t, tagOf(x)));
      wrap.append(det);
    };
    fold('tr:later', '14 天後', rsec.later, (x) => [dateTag(x)]);
    fold('tr:undated', '沒寫日期', rsec.undated, () => [h('span', { class: 'tag', text: '沒寫日期' })]);
    fold('tr:expired', '過期超過 7 天', rsec.expiredItems, (x) => [dateTag(x)]);
    fold('tr:deferred', '還沒到起算日', rsec.deferredItems, (x) => [h('span', { class: 'tag', text: (x.date ? md(x.date) : '') + ' 起才處理' })]);
    const notes = [rsec.done ? '已打勾 ' + rsec.done + ' 件（電腦整理時會移到已完成紀錄）' : '', rsec.daily ? '今日必答在「問題」頁' : ''].filter(Boolean);
    if (notes.length) wrap.append(h('div', { class: 'hint', text: '不列：' + notes.join('；') + '。' }));
    if (rd.staleNote) wrap.append(h('div', { class: 'jstatus warn', text: '⚠ ' + rd.staleNote }));
    wrap.append(h('button', { class: 'btn ghost wide', type: 'button', text: '看定期提醒的下次日期（提醒事項）', onclick: () => setTab('reminders') }));
    return wrap;
  }
  wrap.append(taskFormCard());
  if (pendTasks.length) {
    wrap.append(h('div', { class: 'group-title', id: 'tg-pending', text: '剛寫的 ' + pendTasks.length }));
    for (const it of pendTasks) wrap.append(pendingCard(it));
  }
  if (!tasks.length && !pendTasks.length) wrap.append(h('div', { class: 'empty', text: '目前沒有任務。按上面的「＋新增任務」交辦給 Agent。' }));
  for (const g of groups.filter((x) => taskTabOfGroup(x.key) === 'agent')) renderGroup(g, COLLAPSED_TASK_GROUPS.includes(g.key));
  return wrap;
}

// ---------- 紀錄頁：日記（三題）＋筆記 ----------
const JSTATE = {
  none: '今天還沒寫',
  template: '今天還沒寫（Agent 已準備好模板）',
  partial: '已提交，但三題還沒填完',
  filled: '已提交，等 Agent 收錄',
  collected: '已收錄 ✅',
  done: 'Agent 已處理',
  pending: 'Agent 標了「待確認」，原文留在 Task.md',
};

// 紀錄中心（v5 M3）：日記、筆記照舊；健身、電影、動漫在 lib/records_ui.js
const rui = createRecordsUI({
  h, state, toast, render, enqueueRecord, isOffline, hhmm, savedWord: () => savedWord(), blurActive, setTab: (t) => setTab(t),
  getDraft, setDraft, hasDraft, setEdit, clearDraft,
  getOb: () => state.ob,
  getRecords: () => (state.data && state.data.records) || null,
  now: () => new Date(),
});

// 紀錄頁：頂端五個分頁（日記、筆記、健身、電影、動漫），一次只顯示一個。
// state.rtab 就是目前分頁（舊的 'home' 或不認得的值回到日記）；其他頁的深連結直接設 state.rtab 再 setTab('record') 就會落在對的分頁。
function viewRecord() {
  const cur = resolveRecTab(state.rtab);
  state.rtab = cur;
  const wrap = h('div');
  wrap.append(tabBar(h, {
    items: REC_TABS, current: cur, label: '紀錄類型',
    onPick: (k) => {
      blurActive(); // iOS 點按鈕不會讓輸入框失焦，不先 blur 的話 render 會被當成輸入中而延後
      if (k === state.rtab) rui.backToList(k); // 再點一次目前的分頁＝從詳情或表單回到清單
      state.rtab = k; render(); window.scrollTo(0, 0);
    },
  }));
  if (cur === 'fitness' || cur === 'movie' || cur === 'anime') wrap.append(rui.viewModule(cur));
  else wrap.append(cur === 'note' ? notePane() : journalPane());
  return wrap;
}

// 狀態列：草稿 → 已提交（三題 x/3）→ 等 Agent 收錄 → 已收進知識庫
function journalSteps(r, dirty) {
  let at = 0;
  if (dirty) at = 0;
  else if (r.state === 'collected' || r.state === 'done') at = 3;
  else if (r.state === 'filled') at = 2;
  else if (r.state === 'partial') at = 1;
  const names = ['草稿', '已提交（三題 ' + r.filled + '/3）', '等 Agent 收錄', '已收進知識庫'];
  return h('div', { class: 'jsteps', role: 'list' }, ...names.map((n, i) => h('span', { class: 'jstep' + (i === at ? ' on' : i < at ? ' past' : ''), role: 'listitem', text: n })));
}

// 還沒送成功的日記修改（同一天）疊在檔案答案上：回傳 {answers, items: Map 題序 → outbox 項目}
function journalOverlay(fileAnswers, dk) {
  const answers = fileAnswers.slice();
  const items = new Map();
  for (const it of state.ob.filter((x) => x.kind === 'journal' && x.state !== 'sent' && x.payload && x.payload.dk === dk).sort((a, b) => a.createdAt - b.createdAt)) {
    for (let i = 0; i < 3; i++) {
      if (String((it.payload.answers || [])[i] || '').trim() && pointStatus((it.payload.base || [])[i], (it.payload.answers || [])[i]) === 'dirty') { answers[i] = it.payload.answers[i]; items.set(i, it); }
    }
  }
  return { answers, items };
}

function journalPane() {
  const now = new Date();
  const taskText = state.data.task || '';
  const days = journalDays(taskText, now);
  if (!days.find((d) => d.key === state.jday)) state.jday = 'today';
  const day = days.find((d) => d.key === state.jday);
  const r = readJournal(taskText, day.month, day.day);
  const dk = String(day.month).padStart(2, '0') + String(day.day).padStart(2, '0');
  const ov = journalOverlay(r.answers, dk); // 還在排隊的修改疊在檔案內容上，送出後馬上看得到
  const eff = ov.answers;
  const wrap = h('div');
  if (days.length > 1) {
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': '日期' });
    for (const d of days) chips.append(h('button', { class: 'chip' + (d.key === state.jday ? ' active' : ''), type: 'button', text: d.label, 'aria-pressed': d.key === state.jday ? 'true' : 'false', onclick: () => { state.jday = d.key; render(); } }));
    wrap.append(h('div', { class: 'chipwrap' }, chips));
  }
  const dow = new Date(now.getFullYear(), day.month - 1, day.day).getDay();
  const dirtyAny = [0, 1, 2].some((i) => getDraft('jv:' + dk + ':' + (i + 1)).trim() && pointStatus(eff[i], getDraft('jv:' + dk + ':' + (i + 1))) === 'dirty');
  const head = h('section', { class: 'card' },
    h('h2', { text: (day.key === 'today' ? '今天 ' : '昨天 ') + mdLabel(new Date(now.getFullYear(), day.month - 1, day.day)) + '（週' + WEEKDAYS[dow] + '）' }),
    h('div', { class: 'jstatus ' + r.state, text: (r.found ? JSTATE[r.state] : '還沒寫') }),
    journalSteps(r, dirtyAny));
  if (r.state === 'collected' && r.result) head.append(h('div', { class: 'hint', text: r.result }));
  wrap.append(head);

  if (r.checked) {
    // 已收錄：三題唯讀
    const card = h('section', { class: 'card' });
    JOURNAL_QUESTIONS.forEach((q, i) => {
      card.append(h('label', { text: (i + 1) + '. ' + q }), h('div', { class: 'cur-answer' + (r.answers[i] ? '' : ' empty-ans'), text: r.answers[i] || '（沒填）' }));
    });
    card.append(h('div', { class: 'hint', text: '已收進知識庫，不能再從這裡改；要補充請到「' + AGENT_NAME + '」頁說。' }));
    wrap.append(card);
  } else {
    const tas = [];
    const stat = [];
    const card = h('section', { class: 'card' });
    JOURNAL_QUESTIONS.forEach((q, i) => {
      const key = 'jv:' + dk + ':' + (i + 1);
      const area = draftArea(key, q, 3, { initial: eff[i], base: eff[i], work: i === 0, noClear: true });
      const st = h('div', { class: 'pstat' });
      const paint = () => {
        const s = pointStatus(eff[i], area.ta.value);
        const at = state.jsent[dk + ':' + (i + 1)];
        const qi = ov.items.get(i); // 這一題還在手機上的那筆寫入
        st.className = 'pstat s-' + s;
        st.textContent = s === 'dirty' ? '✏️ 有修改未送出'
          : s === 'sent' ? (qi ? (qi.state === 'failed' ? '❌ 沒送出：' + qi.err : qi.state === 'sending' ? '⏳ 送出中…' : '⏳ ' + savedWord() + (at ? ' ' + hhmm(at) : '') + '｜排隊中') : '✅ 已送出' + (at ? ' ' + hhmm(at) : ''))
            : '未填';
      };
      area.ta.addEventListener('input', paint);
      paint();
      tas.push(area);
      stat.push(st);
      card.append(h('label', { text: (i + 1) + '. ' + q }), area, st);
    });
    card.append(h('div', { class: 'actions' }, h('button', {
      class: 'btn wide', type: 'button', text: '儲存',
      onclick: () => {
        const answers = tas.map((a) => a.ta.value);
        const same = answers.every((a, i) => !a.trim() || pointStatus(eff[i], a) !== 'dirty');
        if (same) { toast('沒有修改，不會寫入'); return; }
        sendJournal(day, dk, answers, eff);
      },
    })), h('div', { class: 'hint', text: '只送出有改的題目，會取代那一題原本的內容；沒改的題不動；留白的題不會刪掉原本寫過的答案。' }));
    wrap.append(card);
  }
  if (r.free.length) {
    const fc = h('section', { class: 'card' }, h('h2', { text: '先前的自由書寫（唯讀）' }));
    for (const f of r.free) fc.append(h('div', { class: 'cur-answer' }, h('div', { class: 'hint', text: '手機 ' + f.when }), h('div', { class: 'prewrap', text: f.text })));
    wrap.append(fc);
  }
  return wrap;
}

function sendJournal(day, dk, answers, base) {
  const dirty = [0, 1, 2].filter((i) => String(answers[i] || '').trim() && pointStatus(base[i], answers[i]) === 'dirty'); // 空白不送（不會清掉已寫的答案）
  if (!dirty.length) { toast('沒有修改，不會寫入'); return; }
  const now = Date.now();
  // base＝畫面上目前的內容（含還在排隊的修改）：重送、連續修改都靠它比對，不會誤判成電腦那邊也改過
  enqueue('journal', { day: { month: day.month, day: day.day }, dk, answers: answers.map(String), base: base.map(String) });
  for (const i of dirty) { state.jsent[dk + ':' + (i + 1)] = now; clearDraft('jv:' + dk + ':' + (i + 1)); }
  toast('✅ 日記已存手機 ' + hhmm(now) + '，' + (isOffline() ? '連上網路會自動送' : '送出中'));
  blurActive();
  state.pending = false;
  render();
  window.scrollTo(0, 0);
}

function notePane() {
  const wrap = h('div');
  const content = draftArea('note', '想記下來的內容（會請 Agent 收進知識庫）', 5, { work: true });
  const source = h('input', { type: 'text', placeholder: '例如：LINE 社群', autocomplete: 'off', 'aria-label': '來源（選填）' });
  source.value = getDraft('note:source');
  source.addEventListener('input', () => setDraft('note:source', source.value));
  const url = h('input', { type: 'text', placeholder: '網址（只存成文字，不會變成連結）', autocomplete: 'off', autocapitalize: 'off', 'aria-label': '網址（選填）' });
  url.value = getDraft('note:url');
  url.addEventListener('input', () => setDraft('note:url', url.value));
  wrap.append(h('section', { class: 'card' }, h('h2', { text: '📝 新增筆記' }),
    h('label', { text: '內容' }), content,
    h('label', { text: '來源（選填）' }), source,
    h('label', { text: '網址（選填）' }), url,
    h('div', { class: 'actions' }, h('button', {
      class: 'btn wide', type: 'button', text: '送出筆記',
      onclick: () => {
        const v = content.ta.value.trim();
        if (!v) { toast('請先寫點內容', true); return; }
        enqueue('note', { content: v, source: source.value, url: url.value });
        blurActive();
        clearDraft('note'); clearDraft('note:source'); clearDraft('note:url');
        toast('✅ 已存手機 ' + hhmm(Date.now()) + '｜' + (isOffline() ? '沒網路，連上會自動送' : '送出中，等 Agent 收進知識庫'));
        state.pending = false;
        render();
      },
    }))));
  const { notes } = taskInfo();
  const lc = h('div');
  const pendNotes = pendingOf('note');
  lc.append(h('div', { class: 'group-title', text: '筆記清單 ' + (notes.length + pendNotes.length) }));
  for (const it of pendNotes) lc.append(pendingCard(it));
  if (!notes.length && !pendNotes.length) lc.append(h('div', { class: 'empty', text: '還沒有筆記' }));
  for (const n of notes) {
    const box = h('div', { class: 'q notecard st-note-' + n.state },
      h('div', { class: 'qmeta' }, h('span', { class: 'tag' + (n.state === 'confirm' ? ' warn' : ''), text: (n.state === 'done' ? '✅ ' : n.state === 'confirm' ? '🙋 ' : '⏳ ') + n.stateLabel })),
      h('div', { class: 'prewrap notebody', text: n.content }));
    if (n.source) box.append(h('div', { class: 'hint', text: '來源：' + n.source }));
    if (n.url) box.append(h('div', { class: 'hint', text: '網址：' + n.url }));
    lc.append(box);
  }
  wrap.append(lc);
  return wrap;
}

// ---------- 3. 對話頁（中央按鈕）：全頁對話，你的話與 Agent 的 ↳ 回覆配成一串，照時間排 ----------
function viewChat(p) {
  const wrap = h('div', { class: 'chatpage' });
  const list = h('div', { class: 'chatlist' });
  const all = parseThreads(state.data.live, new Date()).threads;
  // 只顯示最近 3 天的串（以每串第一行的 MM-DD 判斷，沒日期的算舊的），其餘收進「更早的對話（N）」
  const { recent: threads, older } = splitRecentThreads(all, new Date());
  if (!threads.length && !older.length) list.append(h('div', { class: 'empty', text: '還沒有對話，在下面寫第一句吧' }));
  if (older.length) {
    const det = h('details', { class: 'card tgroup olderchat' }, h('summary', { text: '更早的對話（' + older.length + '）' }));
    if (state.expanded.has('chat:older')) det.open = true;
    det.addEventListener('toggle', () => { if (det.open) state.expanded.add('chat:older'); else state.expanded.delete('chat:older'); });
    for (const t of older) for (const node of chatBubbles(t, false, null)) det.append(node);
    list.append(det);
  }
  // 只在最新一串（有 Agent 回覆的）最後一則回覆後面加一列小按鈕（Q213＝A）；不會自動建立任何東西
  const recent = new Set(threads.filter((t) => t.replies.length).slice(-1));
  const area = chatArea();
  for (const t of threads) for (const node of chatBubbles(t, recent.has(t), area)) list.append(node);
  for (const it of pendingOf('chat').reverse()) list.append(pendingBubble(it)); // 還沒送成功的話：先顯示在最後，帶「排隊中」
  wrap.append(list);
  wrap.append(h('div', { class: 'hint chathint', text: chatReplyHint(currentSync(p)) }), h('div', { class: 'hint chathint', text: WORK_HINT }));
  wrap.append(area.bar);
  return wrap;
}

// 一串對話變成泡泡。升格請求、維持任務這類系統訊息摺成一行小字，不打斷聊天
function chatBubbles(t, withActions, area) {
  const out = [];
  if (!t.orphan) {
    const sys = systemLine(t.text);
    if (sys) out.push(h('div', { class: 'sysline', text: [t.time, sys].filter(Boolean).join('｜') }));
    else {
      const b = h('div', { class: 'bubble you' });
      b.append(h('span', { class: 'meta', text: [t.time, t.note].filter(Boolean).join('｜') || '你' }));
      b.append(inlineHtml(t.text));
      if (t.extra.length) b.append(mdBlock(t.extra.join('\n'), 'md'));
      out.push(b);
    }
  }
  t.replies.forEach((r, ri) => {
    const a = h('div', { class: 'bubble agent' });
    a.append(h('span', { class: 'meta', text: AGENT_NAME + (r.time ? ' ' + r.time : '') }));
    a.append(inlineHtml(r.text));
    if (r.children.length) a.append(mdBlock(r.children.join('\n'), 'md'));
    out.push(a);
    if (withActions && area && ri === t.replies.length - 1) out.push(replyActions(t, area));
  });
  return out;
}

// 回覆後面的小按鈕：建立任務／記為筆記／繼續聊（內容取你那則話，去掉 context 前綴）
function replyActions(t, area) {
  const raw = [t.text, ...(t.extra || [])].join('\n');
  const { pid, rest } = parseCtx(raw);
  return h('div', { class: 'replyacts' },
    h('button', { class: 'btn ghost small', type: 'button', text: '建立任務', onclick: () => openTaskForm({ content: rest, pid }) }),
    h('button', { class: 'btn ghost small', type: 'button', text: '記為筆記', onclick: () => { appendDraft('note', rest); state.rtab = 'note'; setTab('record'); } }),
    h('button', { class: 'btn ghost small', type: 'button', text: '繼續聊', onclick: () => { area.ta.focus(); } }));
}

// 固定在底部導覽上方的輸入列＋context chip
function chatArea() {
  const bar = h('div', { class: 'chatbar', id: 'chatbar' });
  if (state.chatCtx) {
    bar.append(h('div', { class: 'ctxchip' },
      h('span', { class: 'ctxtext', text: '正在討論：' + ctxText(state.chatCtx) }),
      h('button', { class: 'ctxx', type: 'button', 'aria-label': '清除討論對象', text: '✕', onclick: () => { state.chatCtx = null; render(); } })));
  }
  const ta = h('textarea', { placeholder: state.chatCtx ? '關於這件事想說什麼？' : '跟' + AGENT_NAME + '說…', rows: 2, 'aria-label': '訊息' });
  ta.value = getDraft('chat');
  ta.addEventListener('input', () => setDraft('chat', ta.value));
  const send = h('button', { class: 'btn', type: 'button', text: '送出', onclick: () => sendQuick('chat', { ta }, '已送出') });
  bar.append(h('div', { class: 'chatrow' }, ta, send));
  return { bar, ta };
}

// 輸入列高度給 CSS 用（內容底部要留出空間）；開著鍵盤時導覽收起來，輸入列貼底
function fitChatBar() {
  const bar = document.getElementById('chatbar');
  if (bar) document.body.style.setProperty('--chatbar-h', bar.offsetHeight + 'px');
}

function scrollBottom() { requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight)); }

// ---------- 4. 專案 ----------
function viewProjects() {
  const text = state.data.project || '';
  const all = allProjects(text);
  const cards = buildCards(state.data.questions || '', parseLive(state.data.live).waiting);
  const wrap = h('div');
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': '專案篩選' });
  for (const f of PFILTERS) {
    chips.append(h('button', {
      class: 'chip' + (state.pfilter === f ? ' active' : ''), type: 'button', text: f,
      'aria-pressed': state.pfilter === f ? 'true' : 'false',
      onclick: () => { state.pfilter = f; render(); },
    }));
  }
  wrap.append(h('div', { class: 'chipwrap' }, chips));
  if (!all.length) {
    wrap.append(h('div', { class: 'empty', text: '讀不到專案清單（Project.md 的「總覽」表可能被改了格式），可以到「更多」從 GitHub 看原始檔。' }));
    return wrap;
  }
  const list = sortProjects(filterBy(all, state.pfilter));
  if (!list.length) wrap.append(h('div', { class: 'empty', text: '這個篩選目前沒有專案' }));
  for (const pr of list) wrap.append(projectCard(pr, text, cards));
  return wrap;
}

// 「等你」欄：寫「—」或「無」＝沒有要等的，顯示「無」；整格空白才是 Project.md 沒寫
function waitLine(label, val) {
  return labeled(label, waitText(val));
}

function labeled(label, val) {
  const missing = !val || !String(val).trim();
  return h('div', { class: 'pline' + (missing ? ' missing' : '') }, h('b', { text: label }), h('span', { text: missing ? MISSING : val }));
}

// 專案詳情的「相關任務」：依狀態分組；工作專案只列明確 [PXX] 標籤的，不做推測
function projectTasksBlock(pr) {
  const out = [];
  const { tasks } = taskInfo();
  const mine = tasksOfProject(tasks, pr.pid, { explicitOnly: pr.group === 'work' }).filter((t) => t.tag !== 'remind');
  out.push(h('div', { class: 'pline' }, h('b', { text: '相關任務' })));
  const defs = [['處理中', (t) => t.state === 'doing'], ['等我', (t) => t.state === 'waiting' || t.state === 'resumable'], ['待驗收', (t) => t.state === 'review'], ['待處理', (t) => t.state === 'todo'], ['最近完成', (t) => ['done', 'cancelled', 'failed', 'promoted'].includes(t.state)]];
  for (const [label, f] of defs) {
    const items = mine.filter(f);
    if (!items.length) continue;
    out.push(h('div', { class: 'hint', text: label + ' ' + items.length }));
    for (const t of items) {
      out.push(h('button', { class: 'btn ghost wide relq', type: 'button', onclick: () => openTask(t.key) },
        h('span', { class: 'qid', text: tlabel(t.tnum) }),
        h('span', { class: 'clamp1', text: t.title + '｜' + (STATE_ICON[t.state] || '') + ' ' + t.stateLabel + (t.projectInferred ? '（推測）' : '') })));
    }
  }
  if (!mine.length) out.push(h('p', { class: 'hint', text: '還沒有相關任務' }));
  const label = pr.group === 'work' ? '' : pr.name;
  out.push(h('div', { class: 'quick' },
    h('button', { class: 'btn ghost', type: 'button', text: '＋新增任務', onclick: () => openTaskForm({ pid: pr.pid }) }),
    h('button', { class: 'btn ghost', type: 'button', text: '跟' + AGENT_NAME + '討論這個專案', onclick: () => startChat({ kind: 'project', id: pr.pid, label, name: pr.name }) })));
  return out;
}

function projectCard(pr, text, cards) {
  const key = pkey(pr);
  const open = state.expanded.has(key);
  const sum = projectSummary(text, pr);
  const head = h('button', {
    class: 'phead', type: 'button', 'aria-expanded': open ? 'true' : 'false',
    onclick: () => { if (open) state.expanded.delete(key); else state.expanded.add(key); render(); },
  });
  head.append(h('div', { class: 'ptitle' },
    h('span', { class: 'pid', text: pr.pid || '—' }), h('span', { class: 'pname', text: pr.name })));
  head.append(h('div', { class: 'ptags' },
    h('span', { class: 'tag', text: pr.group === 'work' ? '工作' : pr.group === 'personal' ? '個人' : '分類—' }),
    // 🟡 本來就是「等你」：只顯示一個「等我」標籤；其他狀態（🟢 Agent 可做）但等你欄有內容，才另外加「等我」
    h('span', { class: 'tag' + (pr.status === '🟡' ? ' warn' : ''), text: (pr.status || '') + ' ' + (pr.status === '🟡' ? '等我' : (STATUS_TEXT[pr.status] || '狀態—')) }),
    isWaiting(pr) && pr.status !== '🟡' ? h('span', { class: 'tag warn', text: '等我' }) : null,
    hasDeadlineText(pr) && !pr.closed ? h('span', { class: 'tag warn', text: '有期限' }) : null));
  if (pr.closed) {
    head.append(labeled('結案', pr.closedAt));
  } else {
    if (pr.pct != null) {
      const fill = h('div', { class: 'fill' });
      fill.style.width = pr.pct + '%';
      head.append(h('div', { class: 'pprog' }, h('div', { class: 'bar' }, fill), h('span', { text: pr.progress })));
    } else head.append(labeled('完成度', pr.progress));
    head.append(labeled('下一步', pr.next));
    head.append(waitLine('等你', pr.waiting));
    if (sum.updated) head.append(labeled('最後更新', sum.updated)); // 沒有資料就整行不顯示
  }
  const card = h('div', { class: 'proj' }, head);
  if (!open) return card;
  const d = h('div', { class: 'detail' });
  if (pr.closed) {
    d.append(labeled('結果', sum.done));
  } else {
    d.append(labeled('目標', sum.goal), labeled('狀態', sum.status), labeled('完成度', sum.progress), labeled('最近完成', sum.done),
      labeled('下一步', sum.next), waitLine('等我處理', sum.waiting));
    if (!sum.found) d.append(h('p', { class: 'hint', text: 'Project.md 沒有「### ' + pr.pid + '」段落，只能顯示總覽表的欄位。' }));
    if (pr.group !== 'work') { // 工作專案只照 Project.md 原本寫的顯示，不加相關 Q 題
      const rel = relatedQids(pr, cards);
      if (rel.length) {
        d.append(h('div', { class: 'pline' }, h('b', { text: '相關 Q 題' })));
        for (const c of rel.slice(0, 6)) {
          d.append(h('button', { class: 'btn ghost wide relq', type: 'button', onclick: () => { state.qfilter = 'all'; state.openQ = c.qid; setTab('todo'); scrollToCard(c.qid); } },
            h('span', { class: 'qid', text: c.qid }), h('span', { class: 'clamp1', text: c.title })));
        }
      }
    }
    d.append(...projectTasksBlock(pr));
    const fkey = 'full:' + pr.pid;
    const showFull = state.expanded.has(fkey);
    d.append(h('button', {
      class: 'btn ghost wide', type: 'button', text: showFull ? '收起完整紀錄' : '看完整紀錄',
      onclick: () => { if (showFull) state.expanded.delete(fkey); else state.expanded.add(fkey); render(); },
    }));
    if (showFull) {
      let sec = null;
      try { sec = projectSection(text, pr.pid); } catch (e) { sec = null; }
      d.append(sec ? mdBlock(sec) : h('p', { class: 'hint', text: 'Project.md 沒有這個專案的段落' }));
    }
  }
  card.append(d);
  return card;
}

// ---------- 5. 動態（更多 → 動態）：commit＋今天的進度，低訊號合併 ----------
function viewFeed(p) {
  const wrap = h('div');
  if (state.data.commitsErr) wrap.append(h('div', { class: 'banner', text: '讀不到 commit：' + state.data.commitsErr }));
  const all = buildActivity(state.data.commits || [], p.progressLines, new Date(), { progressDate: p.updated && p.updated.date });
  // Live.md「今天的進度」不是今天的（Live.md 停在昨天）：標上日期，收進最下面的「更早」
  const items = all.filter((it) => !it.old);
  const olderItems = all.filter((it) => it.old);
  if (!items.length && !olderItems.length) wrap.append(h('div', { class: 'empty', text: '沒有動態' }));
  const tl = h('div', { class: 'timeline' });
  items.forEach((it, i) => {
    if (it.type === 'event') {
      tl.append(h('div', { class: 'ev' },
        h('div', { class: 'evhead' }, h('span', { class: 'evtime', text: it.time }), h('span', { class: 'tag', text: it.actor }), it.source === 'progress' ? h('span', { class: 'tag', text: '今天的進度' }) : null),
        h('div', { class: 'evtext', text: it.text }))); // 一律用 textContent
      return;
    }
    const key = 'grp:' + i + ':' + it.from;
    const open = state.expanded.has(key);
    const g = h('div', { class: 'ev low' },
      h('button', {
        class: 'evgroup', type: 'button', 'aria-expanded': open ? 'true' : 'false',
        onclick: () => { if (open) state.expanded.delete(key); else state.expanded.add(key); render(); },
      }, h('span', { class: 'evtime', text: it.from === it.to ? it.to : it.from + ' ～ ' + it.to }),
      h('span', { text: it.kind + '更新 ×' + it.count + (open ? '（收起）' : '（點開看）') })));
    if (open) g.append(h('ul', {}, ...it.items.map((x) => h('li', {}, h('span', { class: 'evtime', text: x.time }), h('span', { text: ' ' + x.text })))));
    tl.append(g);
  });
  wrap.append(tl);
  if (olderItems.length) {
    const det = h('details', { class: 'card tgroup' }, h('summary', { text: '更早的進度（' + olderItems.length + '）' }));
    if (state.expanded.has('feed:older')) det.open = true;
    det.addEventListener('toggle', () => { if (det.open) state.expanded.add('feed:older'); else state.expanded.delete('feed:older'); });
    for (const it of olderItems) {
      det.append(h('div', { class: 'ev' }, h('div', { class: 'evhead' }, h('span', { class: 'evtime', text: it.time }), h('span', { class: 'tag', text: it.actor }), h('span', { class: 'tag', text: '進度（' + it.time.slice(0, 5) + '）' })), h('div', { class: 'evtext', text: it.text })));
    }
    wrap.append(det);
  }
  return wrap;
}

// ---------- 更多 ----------
function viewMore() {
  const wrap = h('div', { class: 'morelist' });
  const item = (ico, label, sub, onclick) => h('button', { class: 'moreitem', type: 'button', onclick },
    h('span', { class: 'ico', text: ico }), h('span', {}, h('div', { class: 'moretitle', text: label }), h('div', { class: 'hint', text: sub })));
  const remSub = (() => {
    const rd = reminderData(new Date());
    const near = rd.reminds.soon.length;
    const todo = rd.routines ? rd.routines.you.filter((r) => r.pending).length + rd.routines.auto.filter((r) => r.pending).length : 0;
    return (near ? '近期 ' + near + ' 件' : '近期沒有') + (rd.routines ? '｜定期 ' + rd.routines.you.length + ' 項' + (todo ? '（' + todo + ' 項這期還沒做）' : '') : '｜定期提醒要等電腦推送');
  })();
  wrap.append(
    item('📁', '專案', (() => { const n = allProjects(state.data.project || '').filter((x) => x.pid && !x.closed).length; return n ? '進行中與全部專案（' + n + ' 個）' : '進行中與全部專案'; })(), () => { state.pfilter = '進行中'; setTab('projects'); }),
    item('🔔', '提醒事項', remSub, () => setTab('reminders')),
    item('📊', '報表', reportsSummary(rep.gen === state.gen ? rep.idx : null), () => { rep.open = ''; setTab('reports'); }),
    item('✍️', '我寫過的', (() => { const n = notReceivedCount(mineRows()); return (n ? n + ' 件電腦還沒收｜' : '都收到了｜') + '共 ' + state.ob.length + ' 筆'; })(), () => setTab('mine')),
    item('📜', '動態', '最近完成的事（額度、心跳已合併）', () => setTab('feed')),
    item('🩺', '健康狀態', '四套健康分數、電腦最後回報、額度', () => setTab('health')),
    item('⚙️', '設定', '連線、PIN、清除資料', () => setTab('settings')));
  return wrap;
}

// ---------- 提醒事項（2026-10-30 重做，跟電腦版看板同一套來源與判斷）----------
// 定期：電腦端 state.json 的 routines（看板規則算好的下次日期，停用的列不會出現）；
// 一次性：Task.md 未打勾的 [remind]，14 天內與過期 7 天內（更久的過期、已打勾、今日必答、屬於定期的、「X 起才處理」還沒到日的都不列）
function viewReminders() {
  const wrap = h('div');
  const now = new Date();
  const rd = reminderData(now);
  const md = (iso) => Number(iso.slice(5, 7)) + '/' + Number(iso.slice(8, 10));
  const tagEl = (text, cls) => h('span', { class: 'tag' + (cls ? ' ' + cls : ''), text });
  const taskRow = (x) => h('div', { class: 'q taskcard remitem' + (x.days != null && x.days < 0 ? ' overdue' : '') },
    h('button', { class: 'thead', type: 'button', onclick: () => openTask(x.t.key) },
      h('div', { class: 'ttitle' }, h('span', { class: 'tname clamp2', text: x.t.title })),
      h('div', { class: 'tstatebox' }, x.date ? tagEl(md(x.date) + '｜' + dueText(x.days), x.days < 0 ? 'bad' : '') : null)));

  // 一、定期
  wrap.append(h('div', { class: 'group-title', id: 'rg-routine', text: '定期提醒' + (rd.routines ? ' ' + rd.routines.you.length : '') }));
  if (!rd.routines) {
    wrap.append(h('div', { class: 'empty', text: '電腦還沒推送定期提醒的日期（mobile/state.json 沒有 routines），等 Agent 下次整理後會出現。' }));
  } else {
    if (rd.staleNote) wrap.append(h('div', { class: 'jstatus warn', text: '⚠ ' + rd.staleNote }));
    const settingByName = new Map(rd.settings.filter((x) => x.ok).map((x) => [x.name, x]));
    const routineRow = (r) => {
      const key = 'rt:' + r.name;
      const opened = state.expanded.has(key);
      const set = settingByName.get(r.name);
      const box = h('div', { class: 'q taskcard remsetting' + (r.pending ? ' overdue' : '') },
        h('button', {
          class: 'thead', type: 'button', 'aria-expanded': opened ? 'true' : 'false',
          onclick: () => { if (opened) state.expanded.delete(key); else state.expanded.add(key); render(); },
        }, h('div', { class: 'ttitle' }, h('span', { class: 'tname', text: r.name })),
        h('div', { class: 'tstatebox' }, tagEl(r.status, r.pending ? 'bad' : r.diff === 0 ? 'review' : ''), r.when ? tagEl(r.when) : null)),
        set ? h('div', { class: opened ? 'remcontent' : 'remcontent clamp2', text: set.content }) : null);
      if (opened && r.pend.length) box.append(h('button', { class: 'btn wide', type: 'button', text: '看這期的提醒', onclick: () => openTask(r.pend[0].key) }));
      if (opened && set) box.append(h('div', { class: 'hint', text: '核實方式：' + set.verify }));
      return box;
    };
    if (!rd.routines.you.length) wrap.append(h('div', { class: 'empty', text: '沒有要你做的定期提醒' }));
    for (const r of rd.routines.you) wrap.append(routineRow(r));
    if (rd.routines.auto.length) {
      wrap.append(h('div', { class: 'group-title', id: 'rg-auto', text: '電腦產出給你看 ' + rd.routines.auto.length }));
      for (const r of rd.routines.auto) wrap.append(routineRow(r));
    }
    if (rd.routines.background.length) wrap.append(h('div', { class: 'hint', text: '另有 ' + rd.routines.background.length + ' 項背景自動維護（品質檢查、巡檢等），不用處理。' }));
  }

  // 二、一次性
  const ot = rd.reminds;
  wrap.append(h('div', { class: 'group-title', id: 'rg-open', text: '近期提醒 ' + ot.soon.length }));
  if (!ot.soon.length) wrap.append(h('div', { class: 'empty', text: '14 天內沒有到期的提醒' }));
  for (const x of ot.soon) wrap.append(taskRow(x));
  const fold = (key, title, list) => {
    if (!list.length) return;
    const det = h('details', { class: 'card tgroup' }, h('summary', { text: title + ' ' + list.length + '（預設收起）' }));
    if (state.expanded.has(key)) det.open = true;
    det.addEventListener('toggle', () => { if (det.open) state.expanded.add(key); else state.expanded.delete(key); });
    for (const x of list) det.append(taskRow(x));
    wrap.append(det);
  };
  fold('rem:later', '14 天後', ot.later);
  fold('rem:undated', '沒寫日期', ot.undated);
  const hiddenNote = [ot.expired ? '已過期很久 ' + ot.expired + ' 件' : '', ot.deferred ? '還沒到起算日 ' + ot.deferred + ' 件' : ''].filter(Boolean).join('、');
  if (hiddenNote) wrap.append(h('div', { class: 'hint', text: '不列：' + hiddenNote + '（過期的在「任務」頁的提醒分頁）。' }));
  return wrap;
}

// ---------- 報表（2026-10-30：週回顧、個人月報；含金額）----------
// 電腦端 mobile_reports.py 推到私人 repo 的 mobile/reports/（只讀）。打開這頁才抓目錄、點了才抓那一份；
// 內容只放在記憶體（rep），不寫進手機儲存，也不進離線快取：關掉 App 就沒了，換 token／清除資料（state.gen 變了）也清掉
const rep = { gen: -1, idx: undefined, err: '', loading: false, texts: {}, textErr: {}, open: '' };
const REPORT_WEEKLY_SHOWN = 6; // 週回顧先列最近 6 份，其餘收起

function repReset() {
  if (rep.gen === state.gen) return;
  Object.assign(rep, { gen: state.gen, idx: undefined, err: '', loading: false, texts: {}, textErr: {}, open: '' });
}

async function loadReportIndex(force = false) {
  repReset();
  if (!state.client || rep.loading || (rep.idx !== undefined && !force)) return;
  const gen = state.gen;
  rep.loading = true;
  try {
    const r = await state.client.getFile(REPORT_INDEX);
    if (gen !== state.gen) return;
    rep.idx = r.text == null ? { weekly: [], monthly: [], generatedAt: '' } : parseReportIndex(r.text); // 示範模式沒有這個檔＝還沒推送
    rep.err = rep.idx ? '' : '報表目錄的格式讀不懂（電腦端 mobile_reports.py 產生的 index.json）';
    if (force) { rep.texts = {}; rep.textErr = {}; }
  } catch (e) {
    if (gen !== state.gen) return;
    if (e instanceof GitHubError && e.status === 404) { rep.idx = { weekly: [], monthly: [], generatedAt: '' }; rep.err = ''; } else rep.err = errMsg(e);
  } finally {
    if (gen === state.gen) rep.loading = false;
  }
  if (state.tab === 'reports' || state.tab === 'more') render();
}

async function loadReport(file) {
  const path = reportPath(file);
  if (!path || !state.client || rep.texts[file] != null || rep.textErr[file] === '…') return;
  const gen = state.gen;
  rep.textErr[file] = '…'; // 讀取中，避免重畫時重複抓
  try {
    const r = await state.client.getFile(path);
    if (gen !== state.gen) return;
    rep.texts[file] = r.text || '';
    delete rep.textErr[file];
  } catch (e) {
    if (gen !== state.gen) return;
    rep.textErr[file] = e instanceof GitHubError && e.status === 404 ? '電腦端已經沒有這份（可能改名或移走了），請重新整理目錄' : errMsg(e);
  }
  if (state.tab === 'reports') render();
}

function viewReports() {
  repReset();
  if (rep.idx === undefined && !rep.err) loadReportIndex();
  const wrap = h('div');
  const all = rep.idx ? [...rep.idx.weekly, ...rep.idx.monthly] : [];
  const cur = rep.open ? all.find((x) => x.file === rep.open) : null;
  if (cur) {
    wrap.append(h('button', { class: 'btn ghost wide', type: 'button', text: '‹ 報表列表', onclick: () => { rep.open = ''; render(); window.scrollTo(0, 0); } }));
    const t = rep.texts[cur.file];
    const err = rep.textErr[cur.file];
    if (t != null) wrap.append(mdBlock(t, 'md reportmd'));
    else if (err && err !== '…') {
      wrap.append(h('div', { class: 'jstatus warn', text: '讀不到這份報表：' + err }));
      wrap.append(h('button', { class: 'btn wide', type: 'button', text: '再試一次', onclick: () => { delete rep.textErr[cur.file]; loadReport(cur.file); render(); } }));
    } else {
      loadReport(cur.file);
      wrap.append(h('div', { class: 'empty', text: '讀取中…' }));
    }
    return wrap;
  }
  rep.open = '';
  if (rep.err) {
    wrap.append(h('div', { class: 'jstatus warn', text: '讀不到報表目錄：' + rep.err }));
    wrap.append(h('button', { class: 'btn wide', type: 'button', text: '再試一次', onclick: () => { rep.err = ''; loadReportIndex(true); render(); } }));
    return wrap;
  }
  if (!rep.idx) { wrap.append(h('div', { class: 'empty', text: '讀取中…' })); return wrap; }
  const row = (x) => h('button', { class: 'moreitem', type: 'button', onclick: () => { rep.open = x.file; render(); window.scrollTo(0, 0); } },
    h('span', { class: 'ico', text: x.kind === 'weekly' ? '🗓️' : '📈' }),
    h('span', {}, h('div', { class: 'moretitle', text: x.title }), Date.parse(x.updated) ? h('div', { class: 'hint', text: '更新 ' + mmddhhmm(Date.parse(x.updated)) }) : null));
  for (const [kind, label] of REPORT_KINDS) {
    const list = rep.idx[kind];
    wrap.append(h('div', { class: 'group-title', id: 'rp-' + kind, text: label + ' ' + list.length }));
    if (!list.length) { wrap.append(h('div', { class: 'empty', text: '電腦還沒推送' + label })); continue; }
    const shown = kind === 'weekly' ? list.slice(0, REPORT_WEEKLY_SHOWN) : list;
    wrap.append(h('div', { class: 'morelist' }, ...shown.map(row)));
    const rest = list.slice(shown.length);
    if (rest.length) {
      const det = h('details', { class: 'card tgroup' }, h('summary', { text: '更早的' + label + ' ' + rest.length + '（預設收起）' }), h('div', { class: 'morelist' }, ...rest.map(row)));
      wrap.append(det);
    }
  }
  wrap.append(h('div', { class: 'hint', text: '電腦每次 routine 收尾時推送' + (Date.parse(rep.idx.generatedAt) ? '（最後 ' + mmddhhmm(Date.parse(rep.idx.generatedAt)) + '）' : '') + '。內容含金額，只放在這次開著的 App 裡，不存進手機。' }));
  wrap.append(h('button', { class: 'btn ghost wide', type: 'button', text: '重新整理目錄', onclick: () => { loadReportIndex(true); toast('重新抓報表目錄'); } }));
  return wrap;
}

// ---------- 健康狀態 ----------
// 來源：私人 repo 的 dashboard/health.json（.gitignore 白名單有它，用 GitHub API 讀；公開站沒有這個檔，
// 公開看板只把數字畫進 HTML）。欄位：kb、db、agent、pc（0～100 分；pc＝電腦效能 /pcqc，P48）、heartbeat_at（本機最後回報日期）、scores_at、critical_red
function viewHealth(p) {
  const now = new Date();
  const hl = readHealth(state.data.healthText || '', now);
  const wrap = h('div');
  const card = h('section', { class: 'card' }, h('h2', { text: '四套健康分數' }));
  if (!hl) {
    card.append(h('p', { class: 'hint', text: '讀不到 dashboard/health.json（私人 repo 沒有這個檔、token 沒權限，或格式壞了）。' }));
  } else {
    const row = (name, v) => h('div', { class: 'qrow' }, h('div', { class: 'qhead' }, h('span', { class: 'qname', text: name }), h('span', { class: 'qpct', text: v == null ? '—' : String(v) })));
    card.append(row('知識庫', hl.kb), row('資歷庫', hl.db), row('Agent', hl.agent), row('電腦效能', hl.pc));
    card.append(h('div', { class: 'hint', text: '分數日期 ' + (hl.scores_at || '—') + (hl.scoresDays != null ? '（' + hl.scoresDays + ' 天前）' : '') }));
    const hbWarn = hl.heartbeatDays != null && hl.heartbeatDays > 3;
    card.append(h('div', { class: 'jstatus' + (hbWarn || hl.heartbeatDays == null ? ' warn' : ''), text: (hbWarn || hl.heartbeatDays == null ? '⚠ ' : '✅ ') + '電腦最後回報 ' + (hl.heartbeat_at || '—') + (hl.heartbeatDays != null ? '（' + (hl.heartbeatDays === 0 ? '今天' : hl.heartbeatDays + ' 天前') + '）' : '') }));
    if (hl.criticalRed.length) card.append(h('div', { class: 'qstate', text: '關鍵紅燈：' + hl.criticalRed.join('、') }));
    else card.append(h('div', { class: 'hint', text: '沒有關鍵紅燈' }));
  }
  wrap.append(card);
  wrap.append(quotaCard(p, 'Agent 額度'));
  return wrap;
}

// ---------- 鎖定畫面 ----------
function viewLock() {
  const pin = h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '6', autocomplete: 'off', 'aria-label': 'PIN' });
  const status = h('div', { class: 'hint' });
  const go = async () => {
    const r = await vault.unlock(pin.value.trim());
    if (r.ok) {
      state.token = r.token; state.locked = false;
      if (state.wantTab) { state.tab = state.wantTab; state.wantTab = ''; } // 有 PIN：解鎖後才切到網址指定的分頁
      state.client = makeClient(state.cfg, state.token);
      const cache = await loadCache(); // 開 PIN：解鎖後才解得開加密快取
      if (cache && cache.live) state.data = cache;
      render();
      refresh(true);
    } else if (r.wiped) {
      localStorage.removeItem(CACHE_KEY); clearCache(localStorage); // 跟「忘記 PIN」一樣連快取一起清（明文與加密版），不然錯 5 次再重整就能看到快取
      state.cfg = { ...state.cfg, token: '', pin: false }; saveCfg(state.cfg);
      state.locked = false; state.tab = 'settings'; state.data = null;
      toast('PIN 錯太多次，token 已清除，請重新設定', true);
      render();
    } else {
      pin.value = '';
      status.textContent = r.invalid ? 'PIN 是 4～6 位數字' : 'PIN 不對，還剩 ' + r.left + ' 次（錯 ' + MAX_FAILS + ' 次會清除 token）';
    }
  };
  pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  return h('section', { class: 'card lock' },
    h('h2', { text: '請輸入 PIN' }), pin,
    h('div', { class: 'actions' }, h('button', { class: 'btn wide', type: 'button', text: '解鎖', onclick: go })),
    status,
    h('div', { class: 'actions' }, h('button', {
      class: 'btn ghost wide', type: 'button', text: '忘記 PIN：清除 token 重新設定',
      onclick: () => {
        if (!confirm('會清除這支手機上存的加密 token 和快取，要重新輸入 token。確定嗎？')) return;
        vault.wipe(); clearCache(localStorage);
        state.cfg = { ...state.cfg, token: '', pin: false }; saveCfg(state.cfg);
        state.locked = false; state.tab = 'settings'; state.data = null;
        render();
      },
    })));
}

// ---------- 設定 ----------
function viewSettings() {
  const cfg = state.cfg || {};
  const repo = h('input', { type: 'text', placeholder: 'owner/repo', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  repo.value = cfg.repo || '';
  const branch = h('input', { type: 'text', placeholder: 'main', autocomplete: 'off', autocapitalize: 'off' });
  branch.value = cfg.branch || 'main';
  const prefix = h('input', { type: 'text', placeholder: '（檔案在 repo 根目錄就留空）', autocomplete: 'off', autocapitalize: 'off' });
  prefix.value = cfg.prefix || '';
  const hasToken = !!(cfg.token || cfg.pin);
  const token = h('input', { type: 'password', placeholder: hasToken ? '已儲存；留空表示不變' : 'github_pat_…', autocomplete: 'off' });
  // PIN 預設開啟：還沒設定過就預設打勾；已設定過就照目前狀態
  const pinOn = h('input', { type: 'checkbox', id: 'pin-on' });
  pinOn.checked = !!(cfg.pin || !cfg.token);
  const pin1 = h('input', { type: 'password', inputmode: 'numeric', maxlength: '6', placeholder: cfg.pin ? '要換 PIN 才填；不換留空' : '4～6 位數字', autocomplete: 'off', 'aria-label': 'PIN' });
  const pin2 = h('input', { type: 'password', inputmode: 'numeric', maxlength: '6', placeholder: '再輸入一次', autocomplete: 'off', 'aria-label': '再輸入一次 PIN' });
  const pinBox = h('div', {}, h('label', { text: 'PIN（4～6 位數字）' }), pin1, h('label', { text: '確認 PIN' }), pin2);
  pinBox.hidden = !pinOn.checked;
  pinOn.addEventListener('change', () => { pinBox.hidden = !pinOn.checked; });
  const status = h('div', { class: 'hint' });
  const wrap = h('div');
  if (demo) wrap.append(h('div', { class: 'banner', text: '示範模式：使用假資料，不會讀取或寫入任何 token。' }));
  wrap.append(h('section', { class: 'card' },
    h('h2', { text: '連線設定' }),
    h('label', { text: 'Repo（owner/repo）' }), repo,
    h('label', { text: 'Branch' }), branch,
    h('label', { text: '路徑前綴（選填）' }), prefix,
    h('label', { text: 'GitHub token' }), token,
    h('div', { class: 'togglerow' }, pinOn, h('label', { for: 'pin-on', text: '打開時要 PIN' })),
    h('div', { class: 'hint', text: '不想每次輸入可以關，但手機借人或遺失時，token 能改你的檔。草稿、送出紀錄和還沒送出的寫入不加密，存在這台手機（開 PIN 也一樣）。' }),
    pinBox,
    h('div', { class: 'actions' },
      h('button', {
        class: 'btn', type: 'button', text: '儲存並測試',
        onclick: async () => {
          if (demo) { toast('示範模式不會儲存'); return; }
          const r = normalizeRepo(repo.value);
          const pre = normalizePrefix(prefix.value);
          const tk = token.value.trim() || state.token || cfg.token || '';
          if (!r) { status.textContent = 'Repo 要填「帳號/repo 名稱」，例如 octocat/hello-world（貼完整網址也可以）'; return; }
          if (pre === null) { status.textContent = '路徑前綴格式不對；檔案在 repo 最外層就留空'; return; }
          repo.value = r;
          if (!tk) { status.textContent = '請輸入 token'; return; }
          const wantPin = pinOn.checked;
          const newPin = pin1.value.trim();
          if (wantPin) {
            const needNew = !cfg.pin || token.value.trim() || newPin; // 沒設過、換 token、或填了新 PIN 都要有合格的 PIN
            if (needNew && !validPin(newPin)) { status.textContent = 'PIN 要是 4～6 位數字'; return; }
            if (needNew && newPin !== pin2.value.trim()) { status.textContent = '兩次輸入的 PIN 不一樣'; return; }
          }
          const next = { repo: r, branch: branch.value.trim() || 'main', token: '', prefix: pre, pin: wantPin };
          status.textContent = '測試中…';
          try {
            await makeClient(next, tk).getFile(FILES.live);
          } catch (e) { status.textContent = '測試失敗：' + errMsg(e); return; }
          if (wantPin) {
            if (!cfg.pin || token.value.trim() || newPin) await vault.enable(tk, newPin);
          } else {
            vault.wipe();
            next.token = tk;
          }
          saveCfg(next);
          state.cfg = next; state.token = tk; state.locked = false; state.client = makeClient(next, tk); state.tab = 'home';
          token.value = ''; pin1.value = ''; pin2.value = '';
          toast('已儲存');
          render();
          refresh(true);
        },
      }),
      h('button', {
        class: 'btn danger', type: 'button', text: '清除這台手機的資料',
        onclick: () => {
          if (demo) return;
          const pendN = state.ob.filter((x) => x.state !== 'sent').length;
          if (!confirm('會清除這支手機上存的 token、設定、快取、草稿、任務編號、送出紀錄和寫入紀錄' + (pendN ? '（還沒送出的 ' + pendN + ' 件也會一起刪掉，不會再送）' : '') + '。確定嗎？')) return;
          localStorage.removeItem(CFG_KEY); clearCache(localStorage); vault.wipe();
          state.gen++; state.cfg = null; state.client = null; state.data = null; state.token = '';
          clearAllDrafts(); clearLocalState(ls); // 草稿（agent.draft.*）、T 編號、已接受、最近專案都一起清
          dropOb(state.ob.map((x) => x.id)); state.obUnsaved = false;
          state.ob = []; state.obRev++; state.mopen = null; state.mfilter = 'all'; // 寫入紀錄（agent.outbox）已由 clearLocalState 清掉
          state.sent = []; state.sel = {}; state.jsent = {}; state.tnum = { next: 1, map: {} }; state.accepted = new Set(); state.recentP = []; state.promoteReq = {}; state.qsort = 'important'; state.qgroups = null; state.pf = null; state.chatCtx = null; state.tf = { ...TF_RESET };
          taskMemo = { sig: '', val: null };
          render();
        },
      })),
    status));
  wrap.append(h('section', { class: 'card steps' },
    h('h2', { text: '怎麼建立 token（fine-grained）' }),
    h('ol', {},
      h('li', { text: '在電腦或手機瀏覽器登入 GitHub，到 Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。' }),
      h('li', { text: 'Repository access 選「Only select repositories」，只勾這一個 repo。' }),
      h('li', { text: 'Permissions → Repository permissions，只開 Contents: Read and write（Metadata 會自動是唯讀）。其他都不要開。' }),
      h('li', { text: '設定到期日（建議 90 天內），按 Generate token，複製以 github_pat_ 開頭的字串貼到上面。' }),
      h('li', { text: 'token 存在這台手機的瀏覽器裡（localStorage）；打開 PIN 時存的是加密後的內容，解開的 token 只放在記憶體。同一個網域（birdiebir.github.io）底下的其他網頁，理論上讀得到儲存的內容，所以 token 只授權這一個 repo、只開 Contents、到期日自己設定（建議 90 天）；手機遺失時，到 GitHub 撤銷這個 token。' }))));
  return wrap;
}

// ---------- 下拉重新整理 ----------
function initPullToRefresh() {
  const ptr = $('ptr');
  const TRIGGER = 56;
  let y0 = null;
  let pull = 0;
  const reset = () => { y0 = null; pull = 0; ptr.className = 'ptr'; ptr.hidden = true; };
  window.addEventListener('touchstart', (e) => {
    const t = e.target;
    const skip = t.closest && t.closest('textarea, input, select, .chips');
    y0 = (window.scrollY <= 0 && e.touches.length === 1 && !skip && !state.locked) ? e.touches[0].clientY : null;
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    const dy = e.touches[0].clientY - y0;
    if (dy <= 0 || window.scrollY > 0) { if (pull) reset(); return; }
    pull = Math.min(dy * 0.5, 90);
    ptr.hidden = false;
    ptr.className = 'ptr show';
    ptr.textContent = pull >= TRIGGER ? '放開重新整理' : '下拉重新整理';
  }, { passive: true });
  window.addEventListener('touchend', () => {
    const go = pull >= TRIGGER;
    reset();
    if (go) { refresh(false); checkAppUpdate(); }
  }, { passive: true });
  window.addEventListener('touchcancel', reset, { passive: true });
}

// ---------- 啟動 ----------
function setTab(tab) {
  if (MAIN_TABS.includes(tab)) state.lastMain = tab;
  // 從「更多」進去的次要頁，返回回到更多；其他來源照舊回到最後一個主要頁
  if (MAIN_TABS.includes(tab) || tab === 'more') state.backTo = '';
  else if (state.tab === 'more' && MORE_PAGES.includes(tab)) state.backTo = 'more';
  if (tab === 'record' && state.tab === 'record' && MAIN_TABS.includes(tab)) rui.backToList(state.rtab); // 在紀錄頁再點一次底部「紀錄」＝目前分頁回到清單
  if (tab !== 'home') state.remAll = false; // 離開首頁就收回「還有 N 件」，下次回來從預設 4 列開始
  state.tab = tab;
  render();
  window.scrollTo(0, tab === 'chat' ? document.body.scrollHeight : 0);
  if (tab === 'chat') scrollBottom();
}

async function init() {
  for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => setTab(b.dataset.tab));
  $('btn-refresh').addEventListener('click', () => { refresh(false); checkAppUpdate(); });
  $('btn-more').addEventListener('click', () => setTab('more'));
  $('btn-back').addEventListener('click', () => setTab(state.backTo || state.lastMain || 'home'));
  useStorage(ls); // 草稿存這台手機（示範模式只放記憶體）
  state.tnum = loadTnum(ls); state.accepted = loadAccepted(ls); state.recentP = loadRecentP(ls); state.promoteReq = loadPromoteReq(ls);
  state.qsort = loadQSort(ls); state.qgroups = loadQGroups(ls); state.sent = loadSent(ls);
  state.ob = loadOutbox(ls); // 上次沒送完的寫入（送到一半被關掉的回到排隊）；有 client 之後的 refresh 會自動重送
  // 中央按鈕的名稱與圖示只在 lib/brand.js 設定（用 textContent，CSP 不受影響）
  const cbtn = document.querySelector('#tabs button.center');
  cbtn.querySelector('.cico').textContent = AGENT_ICON;
  cbtn.querySelector('.lbl').textContent = AGENT_NAME;
  cbtn.setAttribute('aria-label', '開啟' + AGENT_NAME);
  initPullToRefresh();

  if (demo) {
    let d;
    try { d = await import('./demo/demo-data.js'); } catch (e) {
      $('view').textContent = '示範資料不在這個版本';
      return;
    }
    const t0 = new Date();
    // ?recbulk=N：電影、動漫各多補 N 筆假紀錄（截圖與量測清單密度用；只在示範模式、只讀 demo/ 裡的假資料產生器）
    const nBulk = Math.min(200, Math.max(0, Number(params.get('recbulk')) || 0));
    if (nBulk && d.records) { try { d = { ...d, records: (await import('./demo/bulk.js')).withBulk(d.records, nBulk) }; } catch (e) { /* 沒有產生器就用原本的假資料 */ } }
    const today = t0.getFullYear() + '-' + String(t0.getMonth() + 1).padStart(2, '0') + '-' + String(t0.getDate()).padStart(2, '0');
    demoStore = {
      'Live.md': demoLive(d.live, t0), 'Questions.md': demoDates(d.questions, t0),
      // ?many=1：多加幾件逾期、今天、待驗收的假任務（截圖用，看提醒很多時首頁怎麼收）
      'Task.md': demoDates(demoTask(params.get('many') === '1' ? d.task.replace('## 任務\n\n', '## 任務\n\n' + d.manyTask) : d.task, t0), t0), 'Project.md': d.project, commits: demoCommits(d.commits, t0),
      [HEALTH_FILE]: JSON.stringify({ agent: 90, db: 88, kb: 99, heartbeat_at: today, scores_at: today, critical_red: [] }),
      [STATE_FILE]: JSON.stringify(demoState(t0)),
      ...(params.get('noreports') === '1' ? {} : demoReports(t0)),
      ...(params.get('norecords') === '1' ? {} : demoRecords(d.records || {}, t0, params.get('recmode') === 'preview' ? 'preview' : 'live')),
    };
    if (params.get('seed') === 'outbox') { state.ob = demoOutbox(t0).filter((x) => params.get('nofail') !== '1' || x.state !== 'failed'); state.noFlush = true; } // 截圖用：各種狀態的寫入紀錄，而且不送出
  }
  state.cfg = loadCfg();
  // 網址 ?tab=：只收白名單的值，讀完立刻用 replaceState 拿掉（重新整理才不會一直跳回去）
  const wantTab = tabFromParam(params.get('tab'));
  if (params.has('tab')) {
    const u = new URL(location.href);
    u.searchParams.delete('tab');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  }
  if (!demo && state.cfg && state.cfg.pin && vault.hasVault()) {
    state.locked = true; // 有 PIN：解開前不載入快取、不建立 client
  } else {
    const cache = await loadCache();
    if (cache && cache.live) state.data = cache;
  }
  if (demo && /^P\d+$/.test(params.get('open') || '')) state.expanded.add('proj:' + params.get('open')); // 示範截圖用
  if (state.locked) {
    state.wantTab = wantTab; // 等使用者輸入 PIN
  } else if (!demo && (!state.cfg || !state.cfg.token)) {
    state.tab = 'settings'; // 還沒設定連線：一律先到設定
  } else {
    if (wantTab) state.tab = wantTab;
    state.token = state.cfg.token || '';
    state.client = makeClient(state.cfg, state.token);
  }
  render();
  if (state.client) { await refresh(true); if (demo && state.tab === 'chat') scrollBottom(); }

  setInterval(() => {
    if (document.visibilityState === 'visible' && state.client && !demo && state.tab !== 'settings') refresh(true);
  }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.client && !demo && Date.now() - state.lastFetch > 60000) refresh(true, true);
    if (document.visibilityState === 'visible') { flushOutbox(); updatePill(); } // 切回前景：先把排隊中的再送一次
  });
  window.addEventListener('online', () => { updatePill(); if (state.client && !demo) refresh(true); else flushOutbox(); });
  window.addEventListener('offline', () => { updatePill(); render(); });
  $('sendpill').addEventListener('click', () => setTab('mine'));
  if (!demo) window.addEventListener('storage', onOutboxStorage); // 別的分頁改了寫入紀錄
  // 草稿已經存在這台手機，不需要離開前提醒
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') renderChrome();
  });

  // 鍵盤：viewport 設了 interactive-widget=resizes-content，鍵盤彈出時畫面會縮小、固定在底部的導覽會被頂到鍵盤上面，
  // 所以輸入中先把導覽收起來（輸入完或按別處就回來），並把輸入框捲到看得到的位置
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'checkbox'))) {
      document.body.classList.add('typing');
      setTimeout(() => { if (document.activeElement === t && t.scrollIntoView) t.scrollIntoView({ block: 'center' }); }, 300);
    }
  });
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      const a = document.activeElement;
      if (!a || !(a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type !== 'checkbox'))) document.body.classList.remove('typing');
    }, 100);
  });

  initUpdatePrompt();
}

// 新版提示：sw.js 不再自動 skipWaiting，新版會等著；偵測到等待中的新版就顯示「有新版本，點這裡更新」，
// 點了才叫它 skipWaiting，換好（controllerchange）再重新整理。不用把 App 完全關掉再開。
// 10-27：使用者手動重新整理（下拉、⟳）時改成自動換新版，不用再點提示（checkAppUpdate）。
let swReg = null;
let swWanted = false;
function applyUpdate() {
  if (!swReg || !swReg.waiting || !navigator.serviceWorker.controller) return false;
  swWanted = true;
  swReg.waiting.postMessage({ type: 'SKIP_WAITING' });
  return true;
}
// 手動重新整理：問伺服器有沒有新版，有就直接換（草稿存手機，重載不會掉）。
// 正在送出（state.busy）不換，留提示按鈕；新版還在下載就等它裝好，最多 15 秒。
async function checkAppUpdate() {
  if (!swReg || demo) return;
  try { await swReg.update(); } catch (e) { return; }
  const w = swReg.installing;
  if (w) {
    await new Promise((res) => {
      const t = setTimeout(res, 15000);
      w.addEventListener('statechange', () => { if (w.state !== 'installing') { clearTimeout(t); res(); } });
    });
  }
  if (state.busy || !swReg.waiting) return;
  toast('有新版本，更新中…');
  applyUpdate();
}
function initUpdatePrompt() {
  if (!('serviceWorker' in navigator) || demo) { if (demo && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {}); return; }
  const btn = $('update');
  navigator.serviceWorker.register('sw.js').then((reg) => {
    swReg = reg;
    const offer = () => {
      if (!reg.waiting || !navigator.serviceWorker.controller) return;
      btn.hidden = false;
      btn.onclick = () => applyUpdate();
    };
    offer();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') offer(); });
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (swWanted) location.reload(); });
}

if (window.top !== window.self) {
  // 防被別的網頁用 iframe 嵌入
  document.body.replaceChildren(h('p', { class: 'empty', text: '這個頁面不能被嵌入其他網頁，請直接開啟網址。' }));
} else {
  init();
}
