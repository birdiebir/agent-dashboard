import { TWDate as Date, nowMs, clockSkewMs } from './lib/tz.js';
import { createClient, GitHubError, normalizeRepo, normalizePrefix, SIGNAL_STATUS_FILE } from './lib/github.js';
import { readChatStatus, msgPhase, listenerStalled, intakeAlertText } from './lib/chatstatus.js';
import { separatorPlan } from './lib/datesep.js';
import { pairThreads, bubbleStatus, typingState, isLongReply, replyLines, shownLines, asksUser, replyKey, remoteOnFrom, remoteText, remoteBadge, youMetaText, agentMetaText, clockOf, countReplies } from './lib/chatview.js';
import { nextDelay, latestPendingChatAt, latestReplyAt, replyCount, BURST_WINDOW_MS } from './lib/chatpoll.js';
import { errMsg } from './lib/errmsg.js';
import { CONSENSUS_PATH, CONSENSUS_TITLE, consensusParts, sectionKind } from './lib/consensus.js';
import { parseLive } from './lib/parse.js';
import { parseThreads, splitRecentThreads, systemLine, replyLabels, threadDates } from './lib/chat.js';
import { quoteTarget, withQuote, quoteView, messageText, copyText } from './lib/quote.js';
import { buildActivity } from './lib/activity.js';
import {
  MISSING, pkey, waitText, allProjects, sortProjects, splitProjects, STATUS_TEXT, isWaiting, isEmptyCell, hasDeadlineText, rankOf, isActive, projectSummary, relatedQids, projectsByQid,
} from './lib/projectview.js';
import { renderMarkdown, inline } from './lib/md.js';
import { DOC_INDEX_PATH, DOC_INDEX_TTL_MS, parseDocIndex, docFromHash, docFromHref, docHash, splitDocText } from './lib/doclinks.js';
import { FILES } from './lib/actions.js';
import { newId, createItem, loadOutbox, syncOutbox, dropOutbox, retryAll, processOutbox, retry as retryOb, removeItem as removeOb, editPayload, outboxCounts } from './lib/outbox.js';
import { executeItem } from './lib/outbox_exec.js';
import { buildMineCtx, replyNote, deriveMine, filterMine, filterCounts, groupByDate, notReceivedCount, queuedCount, purgeIds, failedCount, FILTERS } from './lib/mine.js';
import { readState, usableState, STATE_FILE } from './lib/pcstate.js';
import { getDraft, setDraft, clearDraft, clearAllDrafts, useStorage, hasDraft, setEdit, appendDraft } from './lib/drafts.js';
import {
  buildCards, applyStillYours, answerPayload, bodyForDisplay, reconcileIfLoaded, cardState, openCards, composeAnswer, summarize, writeItems, groupLabel, hasDeadline, deadlineDate, QUICK,
  parseDoingLine,
} from './lib/questions.js';
import { journalStatus, mdLabel, WEEKDAYS, JOURNAL_QUESTIONS, readJournal, journalDays, pointStatus } from './lib/journal.js';
import {
  parseTasks, groupTasks, tlabel, tasksOfProject, tasksOfQuestion, parseRemindSettings, ctxPrefix, withCtx, parseCtx, escalateLine, wantsPromote, promoteDefaults, promoteLine, STATE_ICON,
} from './lib/tasks.js';
import { PROMOTE_CLEAR_STATES } from './lib/local.js';
import { KEYS, memStorage, loadSent, saveSent, loadTnum, saveTnum, loadAccepted, addAccepted, loadRecentP, pushRecentP, clearLocalState, projectOptions, loadPromoteReq, addPromoteReq, removePromoteReq, promoteStale } from './lib/local.js';
import { formatUpdated, isStale, STALE_MINUTES, updatedAgeMinutes, agentStatus, runningNow, remoteActive, syncStatus, latestPcPush, dayTime, readHealth, tabFromParam, chatReplyHint } from './lib/status.js';
import { projectSection } from './lib/projects.js';
import { quotaBest, sevOf, SEV_TEXT, DISPLAY_NAME, shortNote, quotaBBlock, parseQuotaBLive, quotaBFromLive, newerQuotaB } from './lib/quota.js';
import { AGENT_NAME, AGENT_ICON } from './lib/brand.js';
import { qtabOf, splitGroups } from './lib/qlist.js';
import { routineView, routinePrefixes, oneTimeReminders, remindTabSections, dueText, routinesStaleNote, isoOf, dueToday, overdueOnce, mustNotForget, mustLine, remindPageSections, MUST_MAX } from './lib/reminders.js';
import { buildReminders, statusLineView, nowStatusView } from './lib/home.js';
import { icon, stripIcons } from './lib/icons.js';
import { COPY } from './lib/copy.js';
import { convertCommits } from './lib/commits.js';
import { createVault, validPin, MAX_FAILS } from './lib/pin.js';
import { saveCache as saveCacheLib, loadCache as loadCacheLib, clearCache } from './lib/cache.js';
import { RECORD_FILES, RECORD_SCHEMA_FILE } from './lib/github.js';
import { remoteButtonState, remoteOpenPayload, CONFIRM_TEXT } from './lib/remoteopen.js';
import { remoteOffButtonState, remoteOffPayload, CONFIRM_OFF_TEXT } from './lib/remoteoff.js';
import { SIGNAL_PATH as FASTPATH_SIGNAL_PATH, parseFastpathSignal, makeConfig, configValid, pollReplies as fpPollReplies, doorbellForItem, createReplyLoop, addFastReplies, fastReplyForThread } from './lib/fastpath.js';
import { subscribe as pushSubscribe, subscriptionRecord, deviceLabel as deviceLabelOf, pushStatus, PUSH_STATUS_TEXT } from './lib/push.js';
import { PUSH_STATUS_PATH, PUSH_REPAIR_KEY, PUSH_BROKEN_TEXT, hashHex16, parsePushStatus, isDisabled, pushHealth, showPushBanner, pushOpsAfterResubscribe, resubscribe } from './lib/push.js';
import { mergeRecordOp, newRecordId, isoLocal } from './lib/records.js';
import { buildRecord } from './lib/records_schema.js';
import { createRecordsUI } from './lib/records_ui.js';
import { REPORT_INDEX, KINDS as REPORT_KINDS, parseReportIndex, reportPath, reportsSummary, reportRowLabel } from './lib/reports.js';
import { remindMeta, optShort, optNotes } from './lib/remindview.js';
import { TASK_TABS, resolveTaskTab, taskTabOfGroup, taskTabForOpen, ACTIVE_GROUPS, REC_TABS, resolveRecTab, tabBar } from './lib/tabs.js';
import { createDiagSender, lockInfo, versionFromCaches, errText as diagErrText, validPushAt, refreshTimings, loadRefreshTimings, REFRESH_TIMINGS_KEY } from './lib/diag.js';
import { SIGNAL_BRANCH } from './lib/github.js';
import { saidFor, jobSaid, deadlineLine, journalLine, homeLinks } from './lib/p72.js';
import { ASK_MAX, RUN_MAX, ORDER_MAX, REVIEW_MAX, homeLayout, replyContent, replyPrefix, localSends, askBoard, orderBoard, runGroups, groupSummary, waitedText, suggestedIndex, proofView, noteRows, noteOptions, noteOptionsOf, plainTitle, replyEchoes, ORDER_TEXT, STAGES, STALE_DELIVERED_DAYS, mergeLabels, problemText } from './lib/p72home.js';
import { readWorkStatus, usable, cardView, detailView, askText, chatRunLine, clockText, anyPulse, dotClass, waitList, waitDetail, runDetail, doneDetail, jobTarget, SHOW_ITEMS, pcModeLine } from './lib/workstatus.js';
import { FIVE_TABS, badgeText, loadChips, saveChips, applyChip, CHIPS_KEY, CHIP_MAX, fiveHome, RUN_MAX_FIVE, todoOpenCount, workChatState, chatSendPlan, quotaLine, isWorkCtx, loadWorkMode, WORKMODE_KEY, quotedWork, markWorkQuotes, queuedPillText, workQueuedCount } from './lib/five.js';
import { buildBoard, quotaTable, boardLayout, canSendPlain, WORK_QUEUE_TEXT, agentPunctuation, isKnowledgeQuestion, KANBAN_COLUMN_MAX } from './lib/kanban.js';
import { buildNotices, parseSeen, markSeen, SEEN_KEY } from './lib/notices.js';
import { createSource, cloudFirstSource } from './lib/datasource.js';
import { loadHub, createMissingGate, isWorkThread, isHubMsgItem, optimisticVisible, hubFailures, quotaBFromView, parseView, parseHistory, pickThreads, mergeChatStatus, hubDiagInfo, fallbackText, normSource, effectiveSource, CHAT_SOURCE_KEY, isWorkItem } from './lib/hub.js';
import { SOURCE, CLOUD_RELAY_ORIGIN } from './lib/source_config.js';
import { createCloudConfig } from './lib/cloudcfg.js';
import { quickStatusText, addCloudReplies, mergeCloudThreads, cloudBannerText, cloudLaptopOnline, cloudUsageText, cachedCloudReplies, cacheCloudAnswers, cloudQueueText } from './lib/cloudchat.js';
import { syncCloudPush, CLOUD_PUSH_KEY } from './lib/push.js';

const CFG_KEY = 'agent.config';
const CACHE_KEY = 'agent.cache';
const params = new URLSearchParams(location.search);
const demo = params.get('demo') === '1'; // 示範模式：不讀 localStorage、不呼叫 API
const TITLES = { home: '首頁', record: '紀錄', chat: AGENT_NAME, tasks: '任務', projects: '專案', todo: '問題', more: '更多', feed: '動態', health: '健康狀態', settings: '設定', mine: '我寫過的', review: '驗收文件', reminders: '提醒事項', reports: '報表', notices: '通知' };
const MAIN_TABS = ['home', 'record', 'chat', 'todo', 'tasks']; // 底部導覽五格（中央是對話；v4.1 問題取代專案）
const MORE_PAGES = ['projects', 'more', 'feed', 'health', 'settings', 'mine', 'reminders', 'reports', 'review']; // 次要頁：底部沒有高亮，標題列左邊有「‹ 返回」
const WORK_HINT = '工作細節用泛稱'; // Q207 還沒答，先放中性提醒
// D3：首頁狀態列放第一（true，建議 A）；改成 false 就變成「提醒在最上、狀態列第二」（B）
const STATUS_FIRST = true;
const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const scrollBehavior = () => (reduceMotion() ? 'auto' : 'smooth');

const state = {
  tab: 'home', cfg: null, client: null, data: null, token: '', locked: false,
  offline: false, error: '', loading: false,
  // 草稿在 lib/drafts.js（存這台手機，agent.draft.*）；sent＝送出的答案紀錄（存這台手機 agent.sent，保留 14 天，重開 App 還在）
  sent: [], sel: {}, openQ: undefined, qtab: 'open', lastDrawDay: '', jsent: {},
  expanded: new Set(), restOpen: false, remoteCardOpen: false,
  lastMain: 'home', backTo: '', rtab: 'journal', ttab: null, jday: 'today', jbase: null,
  tf: { open: false, mode: 'auto', pid: '', deadline: '', type: 'agent' }, nf: { source: '', url: '' }, chatCtx: null,
  tnum: { next: 1, map: {} }, accepted: new Set(), keepQ: new Set(), recentP: [],
  p72: { typing: null, sets: new Set() }, // P72：首頁交辦與提問的暫存狀態（正在打字回答哪一題、展開了哪些「還有 N 件」「N 個工作」）
  stOpen: false, qOpen: false, workPill: false, pendingJob: '', wsExp: new Set(), wsSec: { run: false, done: false, wait: false }, remAll: false, promoteReq: {}, pf: null, rform: null, // rform：提醒的完成／回覆小表單 {key, mode}
  // 狀態列細節、提醒「還有 N 件」、升格請求（任務雜湊→時間）、升格表單
  pending: false, lastFetch: 0, gen: 0, wantTab: '', recDirty: false, // recDirty：剛寫過紀錄，下一次 refresh 重抓紀錄檔
  // v4 M3：寫入紀錄（outbox，存這台手機 agent.outbox）、是否正在送、最後一次送成功的時間（右上角小提示用）、我寫過的頁的篩選與展開
  ob: [], obRev: 0, flushing: false, lastSentAt: 0, noFlush: false, mfilter: 'all', mopen: null,
  quoteRef: null, msgMenu: null, newReply: false, chatReplyCount: undefined, // P62 M3b：聊天快速動作小卡 {key, kind}、「↓ 新回覆」、上次畫的回覆數
  push: { enabled: false, permission: 'unknown', hasSub: null, disabledByPc: null, health: 'ok', lastRepairAt: 0, lastRepairResult: null }, // P70 推播根治：通知健康度（syncPushOnStart 填）
  hubHist: { loading: false, loaded: false, threads: null, err: '' }, hubFallbacks: [], hubFbReason: '', hubDiagNow: null, hubRemote: null, hubRangeStart: null, hubDiagSent: {}, hubResent: new Set(), // P74：「載入更早的對話」、退回 Live.md 的紀錄、給診斷頁的一小包
  diag: { flush: {}, refresh: {} }, // P70 diag：送出迴圈與重新整理的最近一次時間與結果（lib/diag.js buildDiag 讀）
  obUnsaved: false, obDeleted: new Set(), // v4.3：寫入紀錄存不進手機（空間不足）；本分頁刪掉的編號（跟別的分頁合併時不要復活）
};
const UNSAVED_MSG = '⚠ 手機空間不足，這筆只在畫面上，先不要關 App，等它送出';

const $ = (id) => document.getElementById(id);
const vault = demo ? null : createVault(localStorage);
const ls = demo ? memStorage() : localStorage; // 示範模式的草稿與 T 編號都只放記憶體
// 工作膠囊的狀態（只存 1／0，不存內容）：重開 App 還亮著，直到使用者自己關；示範模式的 ls 是記憶體，不會真的寫
try { state.workPill = loadWorkMode(ls.getItem(WORKMODE_KEY)); } catch (e) { /* 讀不到就當關著 */ }
function setWorkMode(on) {
  state.workPill = !!on;
  try { ls.setItem(WORKMODE_KEY, on ? '1' : '0'); } catch (e) { /* 存不了就只在這次有效 */ }
}

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
  return linkDocsIn(d);
}
function inlineHtml(text, cls = '') {
  const d = h('div', { class: cls });
  d.innerHTML = inline(text); // inline 會把 ⏎ 標記轉成換行
  return linkDocsIn(d);
}

// P74 文件連結（11-07 m-9ruzn4tc）：已發佈到手機的檔名變連結、點了在 App 內讀；沒發佈的後面標「（電腦上）」。
// 索引 mobile/reviews/index.json 由電腦 share_doc.py 寫；還沒讀到索引時不動任何字（不會誤標「電腦上」）
const docs = { index: null, sig: '', at: 0, p: null, pending: '' };
function linkDocsIn(root) {
  if (!docs.index || !root || typeof document === 'undefined' || !document.createTreeWalker || !(root.textContent || '').includes('.md')) return root;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeValue.includes('.md') && !(n.parentElement && n.parentElement.closest('a, button'))) nodes.push(n);
  for (const n of nodes) {
    const parts = splitDocText(n.nodeValue, docs.index);
    if (parts.length === 1 && parts[0].text != null) continue;
    const frag = document.createDocumentFragment();
    for (const x of parts) {
      if (x.text != null) frag.append(x.text);
      else if (x.doc) frag.append(h('a', { class: 'doclink', href: docHash(x.doc), text: x.doc }));
      else frag.append(h('span', { class: 'docpc', text: '（電腦上）' }));
    }
    n.replaceWith(frag);
  }
  return root;
}
// 讀索引：5 分鐘內不重讀（force 例外）；同時只跑一個。回傳內容有沒有變
function loadDocIndex(force = false) {
  if (!state.client) return Promise.resolve(false);
  if (docs.p) return docs.p;
  if (!force && docs.index && Date.now() - docs.at < DOC_INDEX_TTL_MS) return Promise.resolve(false);
  docs.p = (async () => {
    try {
      const r = await state.client.getFile(DOC_INDEX_PATH);
      docs.index = parseDocIndex(r.text || '');
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) docs.index = new Map(); // 其他錯誤保留舊的；還沒讀過就維持 null
    }
    docs.at = Date.now();
    const sig = docs.index ? JSON.stringify([...docs.index]) : '';
    const changed = sig !== docs.sig;
    docs.sig = sig;
    return changed;
  })().finally(() => { docs.p = null; });
  return docs.p;
}
async function openDoc(name) {
  let e = docs.index && docs.index.get(name);
  if (!e) { await loadDocIndex(true); e = docs.index && docs.index.get(name); }
  if (!e) { toast('這份文件在電腦上，手機看不到（沒發佈，或是工作文件）'); return; }
  openReview(e.file, e.title, true);
}
function openPendingDoc() {
  if (!docs.pending || !state.client) return;
  const n = docs.pending; docs.pending = '';
  openDoc(n);
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
// 要所有手機丟掉舊暫存時改這個值（11-07 使用者：清舊資料）。留言排隊、草稿、設定不在快取裡，不受影響；資料下次從 GitHub 重抓
const CACHE_EPOCH = '2026-11-07';
const CACHE_EPOCH_KEY = 'agent.cacheEpoch';
async function loadCache() {
  if (demo) return null;
  if (ls.getItem(CACHE_EPOCH_KEY) !== CACHE_EPOCH) {
    localStorage.removeItem(CACHE_KEY); clearCache(localStorage);
    ls.setItem(CACHE_EPOCH_KEY, CACHE_EPOCH);
    return null;
  }
  return loadCacheLib(localStorage, { pin: !!(state.cfg && state.cfg.pin), key: vault ? vault.cacheKey() : null });
}
let cacheChain = Promise.resolve();
function saveCache() {
  if (demo || !state.data) return;
  // 開 PIN 時不留明文快取（10-26 查核：PIN 只鎖 token、快取卻是明文，同網域頁面讀得到）：lib/cache.js 開 PIN 時一律刪明文、只存加密版
  const pin = !!(state.cfg && state.cfg.pin);
  state.data = cacheCloudAnswers(state.data, cloud.quick, cloud.replies, state.ob);
  const snap = state.data, gen = state.gen;
  cacheChain = cacheChain.then(() => gen === state.gen ? saveCacheLib(localStorage, snap, { pin, key: vault ? vault.cacheKey() : null }) : false).catch(() => {});
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
    async getSignalFile(path) { return { text: demoStore[path] || '', sha: 'demo' }; }, // 只有 ?seed=chat 才有內容
    async putFile(path, text) { demoStore.__hubPuts = [...(demoStore.__hubPuts || []), { path, text }]; return {}; }, // P74 示範：json 模式送出的 in/ 檔只記在記憶體（window.__hub.puts）
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
    quota_b: { h5: 9, h5_reset: iso(now.getTime() + 2 * 3600000), d7: 20, d7_reset: iso(now.getTime() + 4 * 86400000), read_at: iso(now.getTime() - (params.get('qbold') === '1' ? 300 : 15) * 60000) }, // 示範：副帳號席位額度
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

// 示範用聊天頁（?seed=chat，P62 M3b 截圖用，全是假內容）：兩則長回覆（舊的收合、最新的展開）、
// 已送達／處理中／處理逾時各一則留言（&last=processing|delivered|stalled 決定最後一則）、一筆送出失敗；&remote=on 時遠端開著
function demoChatSeed(now, last) {
  const p2 = (n) => String(n).padStart(2, '0');
  const md = p2(now.getMonth() + 1) + '-' + p2(now.getDate());
  const t = now.getTime();
  const MIN = 60000;
  const iso = (ms) => new Date(ms).toISOString();
  const kids = (n, pre) => Array.from({ length: n }, (_, i) => '        - ' + pre + (i + 1) + ' 項：假的說明內容，用來撐出一個很長的回覆').join('\n');
  const you = (hm, id, text) => '- 💬 你（' + md + ' ' + hm + '，' + id + '）：' + text;
  const mid = ['delivered', 'stalled', last];
  const ids = ['m-chat0002', 'm-chat0004', 'm-chat0003'];
  // &datesep=1：前面多放前天、昨天各一串（日期分隔線截圖用，全是假內容）
  const mdOf = (back) => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back); return p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
  const older = params.get('datesep') === '1' ? [
    '- 💬 你（' + mdOf(2) + ' 21:05）：前天的假留言', '    - ↳ 21:06 嘿嘿：前天的假回覆', '',
    '- 💬 你（' + mdOf(2) + ' 21:30）：前天的第二則', '',
    '- 💬 你（' + mdOf(1) + ' 23:58）：昨天的假留言', '    - ↳ 23:59 嘿嘿：昨天的假回覆', '',
  ] : [];
  const lines = [
    ...older,
    you('12:10', 'm-chat0010', '假的問題一：這週的假進度怎麼樣'),
    '    - ↳ 12:12 嘿嘿：這是一則很長的假回覆（舊的，預設收合）：',
    kids(18, '進度第'),
    '',
    you('12:20', 'm-chat0011', '假的問題二：幫我整理假的待辦'),
    '    - ↳ 12:22 嘿嘿：這是最新的長回覆，預設展開：',
    kids(11, '待辦第'),
    '',
    ...mid.flatMap((_, i) => [you('12:' + (30 + i * 10), ids[i], '假的留言' + (i + 3) + '：請幫我看一下'), '']),
  ];
  const msgs = {
    'm-chat0010': { state: 'replied', delivered_at: iso(t - 90 * MIN), processing_at: iso(t - 89 * MIN), replied_at: iso(t - 88 * MIN) },
    'm-chat0011': { state: 'replied', delivered_at: iso(t - 80 * MIN), processing_at: iso(t - 79 * MIN), replied_at: iso(t - 78 * MIN) },
  };
  mid.forEach((s, i) => {
    const at = s === 'stalled' ? t - 10 * MIN : t - MIN;
    msgs[ids[i]] = s === 'processing' ? { state: 'processing', delivered_at: iso(at - 30000), processing_at: iso(at), replied_at: '' } : { state: 'delivered', delivered_at: iso(at), processing_at: '', replied_at: '' };
  });
  const status = { version: 1, updated_at: iso(t), remote: { on: params.get('remote') === 'on', until: '', since: '' }, msgs };
  const mk = (id, content, ago, patch = {}) => ({ ...createItem('chat', { content }, t - ago * MIN, id), state: 'sent', sentAt: t - ago * MIN + 1000, ...patch });
  const items = [
    mk('m-chat0010', '假的問題一', 91), mk('m-chat0011', '假的問題二', 81),
    ...mid.map((_, i) => mk(ids[i], '假的留言' + (i + 3), 5 - i)),
    { ...createItem('chat', { content: '這則假留言送出失敗了' }, t - 2 * MIN, 'm-chat0099'), state: 'failed', attempts: 1, err: '連不上網路，連上後可以按重試' },
  ];
  return { lines: lines.join('\n'), status: JSON.stringify(status), items };
}

// P62 M5b 示範（?seed=remote&ro=idle|queued|waiting|received|cooldown|noreply|on）：遠端關著時「叫電腦開遠端」按鈕的各種狀態
function demoRemoteSeed(now, mode) {
  const t = now.getTime();
  const MIN = 60000;
  const iso = (ms) => new Date(ms).toISOString();
  const mkItem = (ageMin, patch = {}) => ({ ...createItem('remoteopen', remoteOpenPayload('m-demo0001', t - ageMin * MIN), t - ageMin * MIN, 'm-demo0001'), state: 'sent', sentAt: t - ageMin * MIN + 2000, ...patch });
  const mkOff = (ageMin, patch = {}) => ({ ...createItem('remoteoff', remoteOffPayload('m-demooff1', t - ageMin * MIN), t - ageMin * MIN, 'm-demooff1'), state: 'sent', sentAt: t - ageMin * MIN + 2000, ...patch });
  let items = [];
  let opener = null;
  if (mode === 'queued') items = [mkItem(0, { state: 'queued', sentAt: 0 })];
  else if (mode === 'waiting') items = [mkItem(1)];
  else if (mode === 'received') { items = [mkItem(1)]; opener = { req_id: 'm-demo0001', result: 'launched', at: iso(t - 30000), reason: '電腦已開遠端視窗' }; }
  else if (mode === 'cooldown') { items = [mkItem(3)]; opener = { req_id: 'm-demo0001', result: 'cooldown', at: iso(t - 2.5 * MIN), reason: '太頻繁，冷卻時間過了再試' }; }
  else if (mode === 'noreply') items = [mkItem(6)];
  // P69 關遠端（ro=offqueued|offwait|offfail|offold|offdone|offnoreply）
  else if (mode === 'offqueued') items = [mkOff(0, { state: 'queued', sentAt: 0 })];
  else if (mode === 'offwait') items = [mkOff(1)];
  else if (mode === 'offfail') { items = [mkOff(2)]; opener = { req_id: 'm-demooff1', result: 'failed', at: iso(t - 60000), reason: '電腦沒關成遠端' }; }
  else if (mode === 'offold') { items = [mkOff(2)]; opener = { req_id: 'm-demooff1', result: 'rejected', at: iso(t - 60000), reason: '請求格式不對，沒有開' }; }
  else if (mode === 'offdone') { items = [mkOff(1)]; opener = { req_id: 'm-demooff1', result: 'off_done', at: iso(t - 30000), reason: '電腦已關遠端' }; }
  else if (mode === 'offnoreply') items = [mkOff(6)];
  const remote = { on: mode === 'on' || mode === 'stalled' || (mode.startsWith('off') && mode !== 'offdone'), until: '', since: '' };
  if (mode === 'stalled') remote.stalled_since = iso(t - 5 * MIN); // 監聽停了：遠端開著但電腦端看門狗回報停了
  const status = { version: 1, updated_at: iso(t), remote, msgs: {}, ...(opener ? { opener } : {}) };
  return { items, status: JSON.stringify(status) };
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
  // {{SLASH-N}}／{{SLASH+N}}＝N 天前／後的 MM/DD（提醒標題裡的日期，示範「過期提醒」與「近期提醒」）
  const sl = (t) => t.replace(/\{\{SLASH([+-])(\d+)\}\}/g, (_, sg, n) => md(new Date(now.getFullYear(), now.getMonth(), now.getDate() + (sg === '-' ? -1 : 1) * Number(n))));
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
  // 憑證跟既有 GitHub 請求並行，不能排在首屏所有讀取之前。
  const cloudReady = cloudSyncConfig();
  const source = { read: (name) => appSource(c).read(name) };
  const cloudMeta = cloudReady.then(() => cloudRefresh());
  cloudMeta.catch(() => {});
  // Live.md 先發出去（跟其他檔並行），但 json 模式不等它：對話與首屏靠 view.json，Live.md（「等你」、公司額度、現在區塊還在用）讀好再背景補上
  const seq = ++liveSeq;
  const livePromise = c.getFile(FILES.live);
  livePromise.catch(() => {});
  const [questions, task, project, health, stateF, cm, sig, wsr, hub] = await Promise.all([
    c.getFile(FILES.questions).catch(missingOk), c.getFile(FILES.task),
    c.getFile(FILES.project).catch(missingOk),
    // health.json 讀不到（沒有、沒權限）不影響其他頁：當成沒有
    c.getFile(HEALTH_FILE).catch(() => ({ text: '' })),
    // mobile/state.json（電腦端狀態投影檔，只讀）：404、沒權限都當成沒有，壞掉的 JSON 由 readState 當成沒有
    c.getFile(STATE_FILE).catch(() => ({ text: '' })),
    // commits 跟檔案並行抓（首屏一次往返）；失敗只影響動態頁
    c.listCommits(30).then((r) => ({ list: convertCommits(r) })).catch((e) => ({ err: errMsg(e) })),
    // P62：signal 分支的 chat_status.json（電腦端寫、手機只讀）；分支或檔案不存在、讀不到都當成沒有
    c.getSignalFile ? c.getSignalFile(SIGNAL_STATUS_FILE).catch(() => ({ text: '' })) : { text: '' },
    // P71：電腦寫的工作狀態檔，經可替換的資料來源（lib/datasource.js）讀；讀不到、沒有檔都當成沒有（首頁退回舊的 Live.md 做法）
    Promise.resolve().then(() => cloudSource() && navigator.onLine !== false ? source.read('work_status') : createSource(SOURCE, { client: c }).read('work_status')).catch(() => ({ text: '' })),
    // P74：對話資料來源。json 模式讀 signal/hub/view.json（讀不到、壞掉自動退回 Live.md）；本機或遠端設定要 live 就完全不讀 view
    loadHub({ source, local: hubLocal(), lastRemote: state.hubRemote, gate: hubGate }).catch((e) => ({ mode: 'live', requested: 'json', local: hubLocal(), remote: state.hubRemote, remoteKnown: false, view: null, viewText: '', viewSha: '', bad: 0, remoteBad: '', fallback: { reason: 'view_unreadable', detail: diagErrText(e) } })),
  ]);
  if (gen !== state.gen) return true; // 抓的途中使用者按了清除：不要把資料寫回
  // 憑證缺檔／慢速也不擋首屏；準備好後在背景補狀態。
  cloudMeta.then((changed) => { if (changed && gen === state.gen && !state.locked) render(); }).catch(() => {});
  const prev = state.data || {};
  // json 模式：不等 Live.md（先用上一份，沒有就空的），讀好再背景補上；Live.md 讀失敗也不擋 view。live（退回）模式照舊一定要讀到
  let live;
  if (hub.mode === 'json') { live = { text: prev.live != null ? prev.live : '' }; liveLater(livePromise, gen, seq); } else { live = await livePromise; if (seq > liveApplied) liveApplied = seq; }
  if (gen !== state.gen) return true;
  const commits = cm.list || null;
  const next = {
    live: live.text, questions: questions.text, task: task.text, project: project.text, healthText: (health && health.text) || '', stateText: (stateF && stateF.text) || '', chatStatusText: hub.mode === 'json' ? mergeChatStatus((sig && sig.text) || '', hub.view) : (sig && sig.text) || '', workStatusText: (wsr && wsr.text) || '',
    hubMode: hub.mode, hubText: hub.mode === 'json' ? hub.viewText : '',
    commits: commits || prev.commits || [], commitsErr: cm.err || '', fetchedAt: Date.now(),
    cloudReplies: prev.cloudReplies, // 完成的快答跟對話同保留期；更新 view、換憑證都保留
    records: prev.records, // 紀錄中心的資料另外抓（fetchRecords），這裡原樣帶過去
  };
  const firstSha = (l) => (l && l[0] && (l[0].sha || l[0].time || l[0].text)) || '';
  const changed = !state.data || ['live', 'questions', 'task', 'project', 'healthText', 'stateText', 'chatStatusText', 'workStatusText', 'hubMode', 'hubText'].some((k) => prev[k] !== next[k]) ||
    firstSha(prev.commits) !== firstSha(next.commits) || (prev.commitsErr || '') !== next.commitsErr;
  state.data = next;
  if (hub.remoteKnown) state.hubRemote = hub.remote;
  noteHub(hub);
  state.offline = false;
  state.error = '';
  state.lastFetch = Date.now();
  // 內容沒變（全是 304）就不要每分鐘把約 450KB 的快取重新 stringify＋同步寫 localStorage；最多 10 分鐘補寫一次讓 fetchedAt 不要太舊
  if (changed || Date.now() - lastCacheAt > 600000) { lastCacheAt = Date.now(); saveCache(); }
  return changed;
}

// ---------- P74 hub v2：對話改讀 signal/hub/view.json（lib/hub.js）----------
// 本機設定 agent.chatsource（預設 json）＋遠端 signal/hub/config.json 的 chat_source，任一邊是 live 就用 live；下次重新整理生效。
// json 模式：view 轉成跟 parseThreads() 同形狀的 threads（畫面元件不動）；view 讀不到、整份壞 → 自動退回 Live.md，診斷記一筆；單則壞 → 略過那則。
function hubLocal() {
  if (demo && params.get('chatsrc')) return normSource(params.get('chatsrc'));
  try { return normSource(ls.getItem(CHAT_SOURCE_KEY)); } catch (e) { return 'json'; }
}
function setHubLocal(v) {
  try { ls.setItem(CHAT_SOURCE_KEY, normSource(v)); } catch (e) { /* 存不了就這次有效 */ }
  if (demo) params.set('chatsrc', normSource(v));
}
const hubGate = createMissingGate(); // view／config／history 回 missing 後 5 分鐘內不再查（手動重新整理、切回前景、讀到檔案就恢復）
let lastCacheAt = 0; // 上次 fetchAll 寫快取的時間
let liveSeq = 0; // json 模式背景補 Live.md 的序號：舊的回應不能蓋新的
let liveApplied = 0;
const hubOn = () => !!state.data && state.data.hubMode === 'json'; // 目前實際用的是 json（不是「想用」）
let hubMemo = { text: null, view: null };
function hubView() {
  const d = state.data;
  if (!d || d.hubMode !== 'json' || !d.hubText) return null;
  if (hubMemo.text !== d.hubText) { const v = parseView(d.hubText); hubMemo = { text: d.hubText, view: v.ok ? v.view : null }; }
  return hubMemo.view;
}
// 對話串的唯一入口（對話頁、首頁「你說」、回覆計數、我寫過的都走這裡）；app.js 其他地方不再直接解析 Live.md 的對話區
let threadMemo = { live: null, hub: null, hist: null, day: '', val: [] };
function chatThreads(now = new Date()) {
  const d = state.data;
  if (!d) return [];
  const view = hubView();
  const live = view ? null : d.live;
  const hist = view ? state.hubHist.threads : null;
  const day = dayKey();
  if (threadMemo.live !== live || threadMemo.hub !== view || threadMemo.hist !== hist || threadMemo.day !== day) {
    threadMemo = { live, hub: view, hist, day, val: pickThreads({ hub: view ? { mode: 'json', view } : null, history: hist, liveText: d.live, now, parseLive: parseThreads }) };
  }
  const replies = cachedCloudReplies(d);
  for (const [id, reply] of cloud.replies) replies.set(id, { ...replies.get(id), ...reply });
  return mergeCloudThreads(threadMemo.val, cloud.quick, replies, state.ob, now);
}
// json 模式不等 Live.md：讀好之後背景補上（有變才換、才重畫；失敗就算了，下次重新整理再試）
function liveLater(p, gen, seq) {
  p.then((r) => {
    if (seq < liveApplied) return; // 比較新的那一輪已經套用過了：舊的回應不能蓋新的
    liveApplied = seq;
    if (gen !== state.gen || !state.data || state.data.live === r.text) return;
    state.data = { ...state.data, live: r.text };
    saveCache();
    render();
  }).catch(() => {});
}
// 診斷：換了來源或原因才記一筆（不是每次重新整理都記）；記了就順便請診斷送出器寫出去（有節流）
function noteHub(h) {
  try {
    const reason = h.fallback ? h.fallback.reason : '';
    if (reason && reason !== state.hubFbReason) {
      state.hubFallbacks = [...state.hubFallbacks, { at: new Date().toISOString(), reason, detail: h.fallback.detail || '' }].slice(-10);
      // 同一個原因一小時內只寫一次診斷檔（網路時好時壞時原因會來回跳，不要每次都多一個 signal commit）
      if (!demo && Date.now() - (state.hubDiagSent[reason] || 0) > 3600000) {
        state.hubDiagSent[reason] = Date.now();
        try { sendDiag('hub').catch(() => {}); } catch (e) { /* 診斷不能影響本業 */ }
      }
    }
    if (reason || state.hubFbReason) state.hubFbReason = reason;
    if (h.view) state.hubRangeStart = h.view.threads.length ? Date.parse(h.view.threads[0].at) : Date.parse(h.view.at);
    state.hubDiagNow = hubDiagInfo(h, state.hubFallbacks);
    // 載入過較早的對話後，view 又擠了幾則進 history：自動再讀一次（不然那幾則既不在 view、也不在舊的 history 裡）
    if (h.view && state.hubHist.loaded && state.hubHist.sig !== histSig(h.view.history)) loadHubHistory(true);
  } catch (e) { /* 診斷不能影響本業 */ }
}
// 「載入更早的對話」：按了才讀 signal/hub/history.json，接在 view 前面
const histSig = (h) => (h ? h.count + '|' + h.from : '');
async function loadHubHistory(silent = false) {
  if (state.hubHist.loading || !state.client) return;
  state.hubHist = { ...state.hubHist, loading: true, err: '' };
  if (!silent) render();
  try {
    if (hubGate.skip('hub_history')) throw new Error('電腦還沒有發佈較早的對話');
    const r = await createSource(SOURCE, { client: state.client }).read('hub_history');
    hubGate.note('hub_history', !!(r.missing || !r.text));
    if (r.missing || !r.text) throw new Error('電腦還沒有發佈較早的對話');
    const p = parseHistory(r.text);
    if (!p.ok) throw new Error('較早的對話檔壞掉了（' + p.reason + '）');
    state.hubHist = { loading: false, loaded: true, threads: p.threads, err: '', sig: histSig(hubView() && hubView().history) };
    if (!silent) state.chatReplyCount = undefined; // 載入的是舊回覆，不是「新回覆」（不要跳出 ↓ 新回覆）
    if (p.bad && state.hubDiagNow) state.hubDiagNow = { ...state.hubDiagNow, bad: state.hubDiagNow.bad + p.bad };
    if (!silent) toast('已載入 ' + p.threads.length + ' 則較早的對話');
  } catch (e) {
    state.hubHist = { ...state.hubHist, loading: false, err: errMsg(e) };
    if (!silent) toast(errMsg(e), true);
  }
  render();
}
// 按過「重送」的失敗留言（編號）：按一次就變「已重送」不能再按；存在這台手機（只有編號），重新整理後不會又出現按鈕
// 重送要帶原本那則的 needs（標了工作的重送還是只走加密留言）；原本沒標，但現在膠囊亮著，也帶
const resendNeeds = (id) => ((state.ob.find((x) => x.id === id)?.payload?.needs === 'local_login') || workChatState({ five: fiveOn(), pill: state.workPill, ctx: state.chatCtx }).on ? { needs: 'local_login' } : {});
const RESENT_KEY = 'agent.hubresent';
function markResent(id) {
  state.hubResent.add(id);
  try { ls.setItem(RESENT_KEY, JSON.stringify([...state.hubResent].slice(-100))); } catch (e) { /* 存不了就這次有效 */ }
}
try { for (const x of JSON.parse(ls.getItem(RESENT_KEY)) || []) if (typeof x === 'string') state.hubResent.add(x); } catch (e) { /* 沒有就空的 */ }
// 這一筆寫入走 json 嗎：寫入當下實際在用 json 才標（讀不到 view 退回 live 時，留言照舊寫 Live.md）
// hub：排隊當下是 json 模式（樂觀顯示用）。實際走哪條路在送出當下才決定（hubRouteNow），hubReply／hubOpt 一律留著，兩條路都用得到
const hubPayload = (p) => (hubOn() ? { ...p, hub: true } : p);
const hubRouteNow = () => hubLocal() !== 'live' && hubOn();

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
// ---------- P74 Phase 2：憑證與串流只放記憶體；完成的快答併入既有對話快取 ----------
const cloudConfig = createCloudConfig({ now: nowMs });
const cloud = { snapshot: null, updated: {}, quick: new Map(), replies: new Map(), after: 0, reading: null, source: null, fallbacks: [], mode: 'thinking', askCtl: null, pollStarted: false, refreshNeeded: false };
const cloudSource = () => !demo && state.client && !state.locked ? cloudConfig.get() : null;
function cloudFallback(name, reason) {
  const last = cloud.fallbacks[cloud.fallbacks.length - 1];
  if (!last || last.name !== name || Date.now() - last.at > 60000) {
    cloud.fallbacks.push({ name, reason, at: Date.now() });
    cloud.fallbacks = cloud.fallbacks.slice(-10);
  }
}
function cloudClear() {
  cloudConfig.clear(state.client);
  cloud.refreshNeeded = false;
  cloud.askCtl?.abort();
  cloud.snapshot = null; cloud.updated = {}; cloud.quick.clear(); cloud.replies.clear();
  cloud.after = 0; cloud.source = null; cloud.reading = null; cloud.mode = 'thinking';
}
async function cloudSyncConfig() {
  if (demo || !state.client || state.locked) return null;
  if (navigator.onLine === false) return null;
  const client = state.client, gen = state.gen;
  const c = await cloudConfig.sync(client);
  if (gen !== state.gen || client !== state.client || state.locked) return null;
  if (cloud.source !== c) {
    saveCache(); // 換來源前保留完成的答案，清掉的只是傳輸狀態。
    cloud.after = 0; cloud.replies.clear(); cloud.snapshot = null; cloud.updated = {}; hubGate.reset();
    cloud.source = c;
    if (c) {
      if (state.loading) cloud.refreshNeeded = true;
      else refresh(true, true);
    }
  }
  if ((c || workQueuedCount(state.ob) > 0) && !cloud.pollStarted) {
    cloud.pollStarted = true;
    // 有憑證或工作留言等待通道就啟動；沿用同一個 30 秒輪詢，沒有待送工作且無憑證時不多讀。
    if (!demo) setInterval(() => cloudTick().catch(() => {}), 30000);
  }
  return c;
}
function appSource(client) {
  return cloudFirstSource(navigator.onLine === false ? null : cloudSource(), createSource(SOURCE, { client }), {
    onFallback: cloudFallback,
    onRead: (name, at) => { if (at) cloud.updated[name] = at; },
    laptopOnline: () => cloud.snapshot?.laptop_online,
  });
}
async function cloudRefresh() {
  const c = cloudSource();
  if (!c || navigator.onLine === false) { const changed = !!cloud.snapshot; cloud.snapshot = null; return changed; }
  if (cloud.reading) return cloud.reading;
  const gen = state.gen;
  const before = JSON.stringify([cloud.snapshot, [...cloud.replies]]);
  const pending = (async () => {
    const [st, rs] = await Promise.allSettled([c.state(), c.replies(cloud.after)]);
    if (gen !== state.gen || cloudSource() !== c) return false;
    if (st.status === 'fulfilled') cloud.snapshot = st.value;
    else { cloud.snapshot = null; cloudFallback('state', 'cloud_unavailable'); }
    let batch = rs;
    for (;;) {
      if (gen !== state.gen || cloudSource() !== c) return false;
      if (batch.status !== 'fulfilled') { cloudFallback('replies', 'cloud_unavailable'); break; }
      const rows = batch.value.replies || [];
      addCloudReplies(cloud.replies, rows);
      if (rows.length) saveCache(); // 空批次不寫：有憑證時每 30 秒輪詢一次，不能每次同步寫 localStorage
      // lastSeq 是伺服器的全域尾端，每批最多 20 則；只能前進到這批實際讀過的序號。
      // tail 含被濾掉的列（別支手機、驗不過）：整批都被濾掉時游標才不會卡住，後面的回覆才讀得到。
      const tail = Number.isSafeInteger(batch.value.tail) ? batch.value.tail : cloud.after;
      const next = rows.reduce((n, r) => Number.isSafeInteger(r.seq) ? Math.max(n, r.seq) : n, Math.max(cloud.after, tail));
      if (next <= cloud.after) break; // 空批次或重複批次不再重讀，避免無限循環。
      cloud.after = next;
      if (navigator.onLine === false) break;
      batch = await c.replies(cloud.after).then((value) => ({ status: 'fulfilled', value }), () => ({ status: 'rejected' }));
    }
    cloudSyncPush().catch(() => {});
    return before !== JSON.stringify([cloud.snapshot, [...cloud.replies]]);
  })();
  cloud.reading = pending;
  try { return await pending; } finally { if (cloud.reading === pending) cloud.reading = null; }
}
async function cloudTick(force = false) {
  if (demo || document.visibilityState !== 'visible' || state.locked || !state.client) return;
  const waitingWork = workQueuedCount(state.ob) > 0;
  if (!cloud.source && !cloudSource() && !waitingWork) return;
  const before = cloud.source;
  // 先重讀憑證才重送：啟動時雲端沒開，也能在原本的輪詢中接到後來開啟的通道。
  if (navigator.onLine !== false && (waitingWork || force || state.tab === 'chat')) await cloudSyncConfig();
  if (cloudSource() && workQueuedCount(state.ob) > 0) flushOutbox().catch(() => {});
  if ((!force && state.tab !== 'chat') || navigator.onLine === false) return;
  const changed = await cloudRefresh();
  if (changed || before !== cloudSource()) render(); // 憑證過期時也要隱藏模式切換
}
async function cloudSyncPush(sub = null) {
  const c = cloudSource();
  if (!c || navigator.onLine === false) return;
  const gen = state.gen;
  const current = sub || await currentPushSub();
  if (gen !== state.gen || cloudSource() !== c) return;
  await syncCloudPush(c, current, deviceLabel(), ls, CLOUD_RELAY_ORIGIN);
}
function cloudBanner() {
  const updated = cloud.updated[state.tab === 'chat' ? 'hub_view' : 'work_status'] ||
    cloud.snapshot?.files?.[state.tab === 'chat' ? 'chat_view_at' : 'work_status_at'];
  const text = cloudSource() ? cloudBannerText(cloud.snapshot, updated) : '';
  return text ? h('div', { class: 'banner warn cloud-banner', role: 'status', text }) : null;
}
function cloudUsage() {
  const text = cloudSource() ? cloudUsageText(cloud.snapshot, '雲端備援') : '';
  return text ? h('div', { class: 'hint cloud-usage', text }) : null;
}
function cloudWaiting(item, replies = []) {
  if (item?.state !== 'sent' || item.result?.via !== 'cloud') return '';
  const offline = cloud.snapshot ? cloudLaptopOnline(cloud.snapshot) === false : item.result.laptopOnline === false;
  return cloudQueueText(item, offline ? cloud.snapshot : { laptop_online: true }, replies);
}
// ---------- P69 快路徑（lib/fastpath.js）：金鑰與設定只放記憶體 ----------
// 遠端開著、在聊天分頁、前景時，讀一次 signal/fastpath.json（getSignalFile，帶 ETag；之後最多每 30 秒、或門鈴／長輪詢失敗時再讀）。
// 不加進每 1～2 秒的輪詢（pollTick）。有有效設定：送聊天時順便按門鈴；同時跑一條 GET /reply 長輪詢收電腦提早放的回覆。
// 遠端關了、讀到 off、過期、離開聊天頁、切到背景：清掉記憶體裡的金鑰、停長輪詢。signal 檔的內容不存進任何儲存空間。
const FP_SIGNAL_EVERY_MS = 30000;
const FP_FORCE_MIN_MS = 5000;
const fp = { cfg: null, lastRead: 0, reading: false, replies: new Map(), bell: null, poll: null, loop: null, sigKey: '' };
const fpCfg = () => (fp.cfg && configValid(fp.cfg, nowMs()) ? fp.cfg : null);
function isRemoteOnNow() {
  const d = state.data;
  if (!d) return false;
  return remoteOnFrom(readChatStatus(d.chatStatusText), remoteActive(derive().p, new Date()));
}
function fpWanted() {
  return !demo && !!state.client && !state.locked && state.tab === 'chat' && document.visibilityState === 'visible' && isRemoteOnNow();
}
function fpClear() {
  fp.cfg = null;
  fp.sigKey = '';
  fp.lastRead = 0; // 回到前景可以馬上重讀
  if (fp.loop) fp.loop.stop();
  try { if (state.client && typeof state.client.forget === 'function') state.client.forget(FASTPATH_SIGNAL_PATH, SIGNAL_BRANCH); } catch (e) { /* 只是清記憶體快取 */ }
}
function fpDiagInfo() {
  const c = fpCfg();
  return { configured: !!c, urlOk: !!c, expiresAt: c ? c.expiresAt : null, polling: !!(fp.loop && fp.loop.running()), bell: fp.bell, poll: fp.poll, replies: fp.replies.size };
}
function fpEnsureLoop() {
  if (!fp.loop) {
    fp.loop = createReplyLoop({
      getCfg: () => (fpWanted() ? fpCfg() : null),
      poll: (cfg, after, signal) => fpPollReplies(cfg, after, signal),
      onReplies: (rs) => {
        fp.poll = { ok: true, why: '', at: Date.now() };
        if (addFastReplies(fp.replies, rs)) { if (state.tab === 'chat') render(); refresh(true, true); } // 收到就先畫出來，再提早抓一次 Live.md（有正式回覆會換成 Live.md 的）
      },
      onFail: (why) => { if (!fp.poll || fp.poll.ok || fp.poll.why !== why) fp.poll = { ok: false, why, at: Date.now() }; fpSyncSignal(true); },
    });
  }
  fp.loop.start();
}
async function fpSyncSignal(force = false) {
  try {
    if (!fpWanted()) { if (fp.cfg || (fp.loop && fp.loop.running())) fpClear(); return; }
    const now = Date.now();
    if (fp.reading || now - fp.lastRead < (force ? FP_FORCE_MIN_MS : FP_SIGNAL_EVERY_MS)) { if (fpCfg() && !(fp.loop && fp.loop.running())) fpEnsureLoop(); return; }
    fp.reading = true;
    fp.lastRead = now;
    const gen = state.gen;
    let text = '';
    try { text = (await state.client.getSignalFile(FASTPATH_SIGNAL_PATH)).text || ''; } catch (e) { if (!fpCfg()) fpClear(); return; } // 讀不到：還沒過期就沿用，否則清掉
    if (gen !== state.gen || !fpWanted()) { fpClear(); return; }
    const sig = parseFastpathSignal(text, nowMs());
    if (!sig) { fpClear(); return; } // off、過期、格式不對
    const key = sig.url + '|' + sig.kid + '|' + sig.expiresAt;
    if (key !== fp.sigKey || !fpCfg()) {
      const cfg = await makeConfig(sig);
      if (!cfg) { fpClear(); return; }
      fp.cfg = cfg;
      fp.sigKey = key;
    }
    fpEnsureLoop();
  } catch (e) { /* 快路徑壞了不能影響本業：沒有設定就是走 GitHub */ } finally { fp.reading = false; }
}
function fpUpdate() { fpSyncSignal(false); }

// ---------- 輪詢（P62）：間隔由 lib/chatpoll.js 的 nextDelay 決定；聊天分頁只查兩個 ETag 網址（commits sha、signal 狀態檔），有變才 refresh ----------
let pollTimer = 0;
let pollKey = '';
let polling = false; // P70 N2 QC：同一時間只跑一個 pollTick（送出、切前景會重排，1 秒間隔下容易疊兩條）
// P74 刷新：只在五欄開關內使用。訊息身分只在記憶體，量測只存白名單欄位。
let burstUntil = 0, burstTimer = null, pushRefreshPending = false;
let burstReplies = new Set(), foregroundAt = document.hidden ? null : Date.now();
const activePushes = new Set();
const refreshSamples = loadRefreshTimings(ls);
const sampleReplies = new Map();
const replyIdentity = (t, r, ri) => 'r:' + (r.id || replyKey(t, ri));
const replyIdentities = () => new Set(chatThreads().flatMap((t) => (t.replies || []).map((r, i) => replyIdentity(t, r, i))));
// P74 回覆看不到（11-07 m-ola0f1nt）：記住哪些回覆真的出現在畫面上過。沒看過的：嘿嘿分頁有數字、長回覆自動展開、
// 掛在舊留言底下的在聊天最底加一行「嘿嘿 HH:MM 在『…』底下補了回覆」，點了跳過去。只存這支手機（最多 400 筆）
const CHAT_SEEN_KEY = 'agent.chatseen', CHAT_SEEN_MAX = 400;
const chatSeen = { set: null, fresh: false, saveT: 0, obs: null };
function chatSeenSet() {
  if (chatSeen.set) return chatSeen.set;
  let arr = null;
  try { arr = JSON.parse(lsGet(CHAT_SEEN_KEY) || 'null'); } catch (e) { arr = null; }
  chatSeen.set = new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []);
  chatSeen.fresh = !Array.isArray(arr); // 第一次用：現有回覆都當看過，不會一更新就冒出一堆
  return chatSeen.set;
}
function saveSeen() {
  clearTimeout(chatSeen.saveT);
  chatSeen.saveT = setTimeout(() => { try { ls.setItem(CHAT_SEEN_KEY, JSON.stringify([...chatSeenSet()].slice(-CHAT_SEEN_MAX))); } catch (e) { /* 存不了只影響下次的數字 */ } }, 400);
}
function markRepliesSeen(ids, paint = true) {
  const s = chatSeenSet();
  let n = 0;
  for (const id of ids) if (!s.has(id)) { s.delete(id); s.add(id); n++; }
  if (!n) return;
  saveSeen();
  if (paint) { try { paintFiveTabs(fiveOn()); } catch (e) { /* 數字畫不出來不影響聊天 */ } }
}
// 最近 3 天的串裡還沒看過的回覆（舊到新）：{ t, r, ri, id }
function unseenReplies(now = new Date()) {
  if (!state.data || state.locked) return [];
  const s = chatSeenSet();
  const out = [];
  for (const t of splitRecentThreads(chatThreads(now), now).recent) (t.replies || []).forEach((r, ri) => { const id = replyIdentity(t, r, ri); if (!s.has(id)) out.push({ t, r, ri, id }); });
  if (chatSeen.fresh) { chatSeen.fresh = false; markRepliesSeen(out.map((x) => x.id), false); return []; }
  return out;
}
// 聊天頁畫完：沒看過的回覆一出現在畫面上（至少一半）就記成看過
function observeSeen() {
  if (chatSeen.obs) chatSeen.obs.disconnect();
  if (!('IntersectionObserver' in self)) return;
  const s = chatSeenSet();
  const nodes = [...$('view').querySelectorAll('[data-rid]')].filter((n) => !s.has(n.getAttribute('data-rid')));
  if (!nodes.length) return;
  chatSeen.obs = new IntersectionObserver((ents) => {
    const ids = ents.filter((e) => e.isIntersecting && !document.hidden).map((e) => e.target.getAttribute('data-rid'));
    for (const e of ents) if (e.isIntersecting) chatSeen.obs.unobserve(e.target);
    if (ids.length) markRepliesSeen(ids);
  }, { threshold: 0.5 });
  for (const n of nodes) chatSeen.obs.observe(n);
}
// 跳到某則回覆：在收起來的段落裡就先展開，再捲過去、閃一下
function jumpToReply(x) {
  const all = chatThreads();
  const { recent } = splitRecentThreads(all, new Date());
  const ti = recent.findIndex((t) => (t.replies || []).some((r, ri) => replyIdentity(t, r, ri) === x.id));
  if (ti >= 0 && !chatShowAll()) { const need = recent.length - ti; if (need > (state.chatShow || CHAT_PAGE)) state.chatShow = need; }
  const key = replyKey(x.t, x.ri);
  state.expanded.add(key); state.expanded.delete('!' + key);
  state.newReply = false;
  render();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = [...$('view').querySelectorAll('[data-rid]')].find((n) => n.getAttribute('data-rid') === x.id);
    if (!el) { scrollBottom(); return; }
    el.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
    el.classList.add('kb-flash'); setTimeout(() => el.classList.remove('kb-flash'), 1400);
    markRepliesSeen([x.id]);
  }));
}
// 聊天最底的提示：沒看過、而且不在最後一串的回覆（掛在舊留言底下，新回覆會出現在畫面中間）
const threadKey = (t) => (t ? t.id || t.rid || replyKey(t, -1) : '');
function unseenHintRows(lastThread) {
  const lk = threadKey(lastThread);
  const list = unseenReplies().filter((x) => threadKey(x.t) !== lk);
  if (!list.length) return null;
  const snip = (t) => { const s = [...String((t.orphan ? '' : t.text) || '').replace(/^↩\S*｜/, '').replace(/\s+/g, ' ').trim()].slice(0, 14).join(''); return s ? '「' + s + (s.length >= 14 ? '…' : '') + '」底下' : '前面'; };
  const rows = list.slice(-3).reverse().map((x) => h('button', { class: 'unseenhint', type: 'button', onclick: () => jumpToReply(x) },
    h('span', { text: AGENT_NAME + ' ' + (x.r.label || x.r.time || '') + ' 在' + snip(x.t) + '補了回覆' }), h('span', { class: 'chev', 'aria-hidden': 'true', text: '›' })));
  return h('div', { class: 'unseenhints', role: 'status' }, list.length > 3 ? h('div', { class: 'hint', text: '還有 ' + (list.length - 3) + ' 則沒看過的回覆在更前面' }) : null, ...rows);
}
const burstOn = () => fiveOn() && burstUntil > Date.now();
function saveRefreshSamples() {
  try { ls.setItem(REFRESH_TIMINGS_KEY, JSON.stringify(refreshTimings(refreshSamples))); } catch { /* 診斷不擋聊天 */ }
}
function endReplyBurst() {
  burstUntil = 0;
  activePushes.clear();
  clearTimeout(burstTimer);
}
function receiveReplyPush(value) {
  if (!fiveOn()) return;
  const pushAt = validPushAt(value);
  // REFRESH 與 GOTO 是同一個通知，不重開已完成的連查。
  const existing = pushAt ? refreshSamples.find((s) => s.pushAt === pushAt) : null;
  if (existing && (existing.dataAt || burstOn())) return;
  if (pushAt && !existing) {
    refreshSamples.push({ pushAt, foregroundAt: document.hidden ? null : foregroundAt, dataAt: null, domAt: null, visible: !document.hidden, tab: state.tab });
    refreshSamples.splice(0, Math.max(0, refreshSamples.length - 20));
    for (const key of sampleReplies.keys()) if (!refreshSamples.some((s) => s.pushAt === key)) sampleReplies.delete(key);
    saveRefreshSamples();
  }
  if (existing && !document.hidden) { existing.foregroundAt = foregroundAt; saveRefreshSamples(); }
  if (!burstOn()) activePushes.clear();
  if (pushAt) activePushes.add(pushAt);
  burstReplies = state.data ? replyIdentities() : null; // 冷啟動無快取：第一輪只能建立基準，不能把舊回覆量成新回覆
  burstUntil = Date.now() + BURST_WINDOW_MS;
  clearTimeout(burstTimer);
  burstTimer = setTimeout(() => { endReplyBurst(); if (!document.hidden) render(); if (!demo) schedulePoll(); }, BURST_WINDOW_MS);
  if (!document.hidden) render();
  if (!demo) schedulePoll();
}
function observeReplyData() {
  if (!burstOn()) return;
  if (burstReplies === null) { burstReplies = replyIdentities(); return; }
  const added = new Set([...replyIdentities()].filter((k) => !burstReplies.has(k)));
  if (!added.size) return;
  const now = Date.now();
  for (const s of refreshSamples) if (activePushes.has(s.pushAt) && !s.dataAt && s.pushAt <= now) {
    s.dataAt = now; s.visible = !document.hidden; s.tab = state.tab;
    sampleReplies.set(s.pushAt, added);
  }
  saveRefreshSamples();
  endReplyBurst();
  if (!demo) schedulePoll();
}
async function pollTick(light = false) {
  const c = state.client;
  if (!c || state.locked || (state.tab === 'settings' && !burstOn() && !light) || document.visibilityState !== 'visible') return;
  if (polling) return;
  polling = true;
  try {
    if ((!light && !burstOn() && state.tab !== 'chat') || !c.headSha) { await refresh(true); return; }
    try {
      // P74：json 模式（本機沒選 live）另外看 view.json 與遠端 config 的 ETag（沒變回 304，不扣 rate limit）；view 只發佈在 signal 分支，main 的 commit 不會動
      const hubSrc = hubLocal() !== 'live' ? appSource(c) : null;
      const peek = (name) => (hubGate.skip(name) ? 'missing' : hubSrc.read(name).then((r) => { hubGate.note(name, !!(r.missing || !r.text)); return r.sha || r.updatedAt || (r.missing ? 'missing' : r.text || ''); }, () => 'err')); // missing 的檔 5 分鐘內不再查
      const [h, sg, hv, hc] = await Promise.all([c.headSha(), c.getSignalFile(SIGNAL_STATUS_FILE), hubSrc ? peek('hub_view') : '', hubSrc ? peek('hub_config') : '']);
      const key = h.sha + '|' + (sg.sha || '') + '|' + hv + '|' + hc;
      // P70 N2 QC：別的 refresh 正在跑時 refresh 會直接跳過，這時不能先記 pollKey，不然這次的變化（例如第二段回覆）要等下一個 commit 才看得到
      if (key !== pollKey && !state.loading) { pollKey = key; await refresh(true); }
    } catch (e) { await refresh(true); }
  } finally { polling = false; }
}
// P70 N2 保底：串裡的回覆數變多就記下「剛收到回覆」（只放記憶體）；live 沒變不重算
let replySeen = { live: null, n: -1 };
function trackReplies() {
  const d = state.data;
  const rk = d ? (d.hubMode === 'json' ? 'h' + d.hubText : d.live) : null;
  if (!d || replySeen.live === rk) return;
  const n = replyCount(mineRows(), chatThreads(), Date.now());
  if (replySeen.n >= 0 && n > replySeen.n) state.lastReplySeenAt = Date.now();
  replySeen = { live: rk, n };
}
function schedulePoll() {
  clearTimeout(pollTimer);
  const d = state.data;
  try { trackReplies(); } catch (e) { /* 保底而已，不能影響輪詢 */ }
  const cs = d ? readChatStatus(d.chatStatusText) : null;
  const rows = mineRows();
  const rAt = latestReplyAt(rows, cs, Date.now()); // replied_at 是電腦時鐘；換回手機時鐘再跟 Date.now() 比（P70 N2 QC）
  const delay = nextDelay({
    tab: state.tab, visible: document.visibilityState === 'visible', lastSendAt: state.lastChatSendAt || 0,
    burstUntil: fiveOn() ? burstUntil : 0,
    pending: latestPendingChatAt(rows),
    lastReplyAt: Math.max(rAt ? rAt - clockSkewMs() : 0, state.lastReplySeenAt || 0),
    remoteOn: remoteOnFrom(cs, d ? remoteActive(derive().p, new Date()) : false),
    rateRemaining: state.client && state.client.rateRemaining ? state.client.rateRemaining() : null, now: Date.now(),
  });
  pollTimer = setTimeout(async () => { await pollTick(); schedulePoll(); }, delay == null ? 60000 : delay);
}

const wantRecords = () => !!state.data && (!state.data.records || state.recDirty || state.tab === 'record' || state.tab === 'mine');

async function refresh(silent = false, force = false, source = '') {
  if (state.client && !state.locked) flushOutbox(); // 手動重新整理、60 秒輪詢、切回前景、online、啟動、解鎖後都會經過這裡：順便把排隊中的寫入再送一次
  if (state.loading || !state.client || state.locked) {
    if (fiveOn() && state.loading && source === 'push') pushRefreshPending = true;
    return;
  }
  if (!silent || force) hubGate.reset(); // 使用者按重新整理、切回前景：馬上重查 view／config（不等 5 分鐘）
  state.loading = true;
  const btn = $('btn-refresh');
  btn.disabled = true;
  btn.classList.add('spin');
  if (!state.data && !isTyping()) render(); // 第一次載入：先顯示「正在讀資料」，不要停在「請按重新整理」（那時按鈕是灰的）
  const hadProblem = !!(state.error || state.offline);
  let changed = true;
  try {
    changed = await fetchAll();
    loadDocIndex().then((c) => { openPendingDoc(); if (c && !isTyping()) render(); }).catch(() => {}); // 文件連結索引：不擋重新整理
    if (fiveOn()) observeReplyData();
    diagNote('refresh', { lastOk: Date.now(), lastErr: '' });
    if (wantRecords()) { try { if (await fetchRecords()) changed = true; } catch (e) { /* 紀錄檔抓不到不影響其他頁 */ } }
    purgeHandled(); // 已處理超過 30 天的寫入紀錄自動移除
  } catch (e) {
    diagNote('refresh', { lastErr: diagErrText(e) });
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
    if (burstOn() && !demo) schedulePoll(); // 本輪若讀到低額度，立刻用新餘額重排退避
    if (fiveOn() && pushRefreshPending && !document.hidden) {
      pushRefreshPending = false;
      queueMicrotask(() => { if (document.hidden) pushRefreshPending = true; else refresh(true, true, 'push-followup'); });
    }
    if (!silent) { try { sendDiag('refresh').catch(() => {}); } catch (e) { /* 診斷不能影響重新整理 */ } }
  }
  // 自動輪詢且資料沒變、前後都沒有錯誤：只更新標題列與徽章，不重建整頁（首頁有「N 分鐘前」、健康頁有額度時間，照舊重畫）
  // 日期換了、或從背景切回來（force）一律整頁重畫：跨日的「今天／N 天後」不能留著舊畫面
  if (cloud.refreshNeeded) { cloud.refreshNeeded = false; refresh(true, true); }
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
  if (!demo && (state.locked || !state.client) && cloud.source) cloudClear();
  renderChrome();
  if (state.tab !== 'settings' && !state.locked && isTyping()) {
    state.pending = true;
    if (fiveOn() && state.tab === 'chat' && document.activeElement === document.querySelector('#chatbar .chatrow textarea') && state.data) renderChatMessages();
    return;
  }
  state.pending = false;
  const view = $('view');
  // A7：重畫前記下「是否在底部附近」與上一次的回覆數，重畫後有新回覆才決定要捲到底還是出「↓ 新回覆」
  const wasNear = state.tab === 'chat' && nearBottom();
  const prevReplies = state.chatReplyCount;
  let node;
  if (state.locked) node = viewLock();
  else if (state.tab === 'settings') node = viewSettings();
  else if (!state.data) node = emptyNoData();
  else {
    try {
      const live = derive().p;
      node = { home: viewHome, record: viewRecord, chat: viewChat, tasks: viewTasks, projects: viewProjects, todo: fiveOn() ? viewTodoV75 : viewTodo, notices: viewNotices, more: viewMore, feed: viewFeed, health: viewHealth, mine: viewMine, review: viewReview, reminders: viewRemindTab, reports: viewReports }[state.tab](live);
    } catch (e) {
      // 任何一頁的資料格式出問題，只影響那一頁，不能讓整個 App 空白
      node = h('div', { class: 'empty', text: '這一頁讀不出來（資料格式可能被改了）：' + (e && e.message ? e.message : e) });
    }
  }
  view.replaceChildren(node);
  if (fiveOn() && state.tab === 'chat') finishChatMessages();
  try { updateRemoteChip(); } catch (e) { /* 膠囊壞了不影響頁面 */ }
  state.lastDrawDay = dayKey();
  if (state.tab === 'chat') {
    if (!state.locked && state.data && prevReplies != null && state.chatReplyCount > prevReplies) {
      if (wasNear) { state.newReply = false; scrollBottom(); } else state.newReply = true;
    }
    const bar = $('chatbar');
    if (bar && state.newReply && !bar.querySelector('.newpill')) bar.prepend(newPill());
    fitChatBar();
    observeSeen();
  }
  if (!demo) fpUpdate(); // P69：進聊天頁、遠端狀態改變時順便檢查快路徑（內部有 30 秒節流、不在聊天頁會停掉）
}

const nearBottom = () => innerHeight + scrollY >= document.body.scrollHeight - 120;
const paintedBubbles = new Set();
let bubblesInitialized = false;
function finishChatMessages() {
  const nodes = [...$('view').querySelectorAll('[data-bubble-key]')];
  const visibleKeys = new Set();
  for (const node of nodes) {
    const key = node.getAttribute('data-bubble-key');
    if (bubblesInitialized && !paintedBubbles.has(key) && !reduceMotion()) {
      node.classList.add('reply-enter');
      node.addEventListener('animationend', () => node.classList.remove('reply-enter'), { once: true });
    }
    paintedBubbles.add(key);
    if (!node.closest('details:not([open])')) visibleKeys.add(key);
  }
  if (nodes.length) bubblesInitialized = true;
  if (document.hidden) return;
  let measured = false;
  for (const s of refreshSamples) {
    const keys = sampleReplies.get(s.pushAt);
    if (s.dataAt && !s.domAt && keys && [...keys].some((k) => visibleKeys.has(k))) {
      s.domAt = Date.now(); s.visible = true; s.tab = state.tab; measured = true;
      sampleReplies.delete(s.pushAt);
    }
  }
  if (measured) { saveRefreshSamples(); try { sendDiag('chat-refresh').catch(() => {}); } catch { /* 診斷不擋訊息 */ } }
}
function renderChatMessages() {
  const page = document.querySelector('#view .chatpage'), bar = $('chatbar');
  if (!page || !bar) return;
  const wasNear = nearBottom(), prev = state.chatReplyCount;
  // 傳入現有輸入列供訊息動作使用；不可把 bar 移到離線 DOM，否則會中斷組字與焦點。
  const next = viewChat(derive().p, { bar, ta: bar.querySelector('textarea') });
  for (const child of [...page.children]) if (child !== bar) child.remove();
  for (const child of [...next.children]) page.insertBefore(child, bar);
  if (prev != null && state.chatReplyCount > prev) {
    if (wasNear) { state.newReply = false; scrollBottom(); } else state.newReply = true;
  }
  if (state.newReply && !bar.querySelector('.newpill')) bar.prepend(newPill());
  if (!state.newReply) bar.querySelector('.newpill')?.remove();
  finishChatMessages();
  fitChatBar();
  observeSeen();
}
function newPill() {
  return h('button', { class: 'newpill', type: 'button', text: '↓ 新回覆', onclick: () => {
    const all = chatThreads(); const last = all[all.length - 1];
    const away = unseenReplies().filter((x) => threadKey(x.t) !== threadKey(last)); // m-ola0f1nt：新回覆掛在舊留言底下時跳到那則，不是捲到最底
    if (away.length) { jumpToReply(away[0]); return; }
    state.newReply = false; scrollBottom(); render();
  } });
}

function renderChrome() {
  $('title').textContent = state.locked ? '已鎖定' : state.tab === 'todo' && fiveOn() ? '問答' : state.tab === 'review' && review.path === CONSENSUS_PATH ? '當前共識' : TITLES[state.tab];
  // 次要頁（待我／動態／健康／設定／更多）：底部導覽沒有高亮，標題列左邊出現「‹ 返回」
  const secondary = (MORE_PAGES.includes(state.tab) && !mainTabs().includes(state.tab)) || (state.tab === 'tasks' && fiveOn()); // 五欄版：任務頁不在底欄，當次要頁（有返回鍵、底欄不高亮）
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
  const tbtn = tabLastBtn(); // 最右邊那顆（關著＝任務；五欄版換成通知，paintFiveTabs 負責）
  const tb = tbtn.querySelector('.lbl');
  for (const old of tb.querySelectorAll('.count')) old.remove();
  tbtn.setAttribute('aria-label', '任務');
  if (state.data && !state.locked) {
    const live = derive().p;
    text = formatUpdated(live.updated); // MM-DD HH:MM
    stale = isStale(live.updated, new Date()) && remoteActive(live, new Date()); // 只有 ⚡ 即時模式（📡 開著而且沒過期）下 Live.md 超過 45 分鐘沒更新才算異常
    updatedText = text;
    const n = taskAttention(); // 等我的任務＋待驗收的任務（任務頁分頁籤上的數字）
    if (n && !fiveOn()) { tb.append(h('span', { class: 'count', text: String(n) })); tbtn.setAttribute('aria-label', '任務，' + n + ' 件需要你'); }
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
    bn.hidden = false; bn.className = 'banner'; bn.textContent = '離線，資料時間 ' + dayTime(state.data.fetchedAt, new Date()) + (stale ? '｜' + staleMsg : '');
  } else if (stale && state.tab !== 'home') { // 首頁的狀態列已經在講，不重複
    bn.hidden = false; bn.className = 'banner stale'; bn.textContent = staleMsg;
  } else bn.hidden = true;
  document.body.classList.toggle('five', fiveOn());
  document.body.classList.toggle('kanban', kanbanOn());
  document.body.classList.toggle('kanban-home-on', kanbanOn() && state.tab === 'home' && !state.locked);
  paintFiveTabs(fiveOn()); // 關著時只做「要是換過就換回來」，不動任何東西
  updatePill();
}

// 額度卡：數字旁標「HH:MM 的數字」；超過 60 分鐘醒目提示；重置時間已過就標「已重置」，舊數字變淡（lib/quota.js）
function quotaRow(r, stale, dateText = '', atMs = null) {
  const pct = r.pct;
  const cls = r.reset ? 'old' : sevOf(pct);
  const fill = h('div', { class: 'fill' });
  fill.style.width = Math.max(0, Math.min(100, pct || 0)) + '%';
  return h('div', { class: 'qrow ' + cls + (stale ? ' stale' : '') },
    h('div', { class: 'qhead' }, h('span', { class: 'qname', text: DISPLAY_NAME[r.name] || r.name }), h('span', { class: 'qpct', text: pct == null ? '—' : pct + '%' }),
      !r.reset && sevOf(pct) ? h('span', { class: 'qsev', text: (sevOf(pct) === 'bad' ? '⛔ ' : '⚠ ') + SEV_TEXT[sevOf(pct)] }) : null),
    h('div', { class: 'bar' }, fill),
    h('div', { class: 'qnote' + (dateText ? ' muted' : ''), text: (dateText && r.note ? dateText + ' ' : '') + (shortNote(r.name, r.note, new Date(), atMs ? new Date(atMs) : null) || (pct == null ? '讀不到這項數字' : '')) }),
    r.reset ? h('div', { class: 'qreset', text: '⟳ 已重置（數字是重置前的）' }) : null);
}

// v4.2：Live.md 額度與電腦狀態檔（mobile/state.json）的額度取較新的；超過 3 小時改次要文字色並提示
const quotaOf = (p) => { const pc = pcState(); return quotaBest(p.quota, new Date(), p.updated, pc ? pc.quota : null); };
// 兩塊額度固定都出現（2026-11-04 晚）：公司（Live.md／電腦額度）＋個人（電腦 state.json 的 quotaB）。
// 個人那塊讀不到、窗口已重置或超過 3 小時沒更新時不消失：改顯示「最後更新 HH:MM（約 N 小時前）」並淡化（lib/quota.js quotaBBlock）。
// 兩個來源取讀取時間較新的：state.json 的 quota_b（只有答題時才更新）、Live.md 額度區的個人那一行（每次遠端回覆都更新）
const quotaBOf = (p) => {
  const pc = pcState();
  const now = new Date();
  const lv = p ? quotaBFromLive(parseQuotaBLive(state.data ? state.data.live : ''), now, p.updated, p.quota) : null;
  // P74：json 模式 view.quota 有可用的值就用它（電腦每次發佈 view 都更新），沒有才退回 state.json／Live.md
  const vq = hubView() ? quotaBFromView(hubView().quota) : null;
  return quotaBBlock(vq || newerQuotaB(pc ? pc.quotaB : null, lv), now, '個人');
};
const quotaAName = () => { const pc = pcState(); return (pc && pc.quotaLabel) || '公司'; };
// 五欄版頂端的額度要「原始數字＋讀取時間」（過時、已重置自己判斷）。形狀 {h5,h5ResetMs,d7,d7ResetMs,readMs}
const quotaBRaw = (p) => {
  const pc = pcState();
  const lv = p ? quotaBFromLive(parseQuotaBLive(state.data ? state.data.live : ''), new Date(), p.updated, p.quota) : null;
  const vq = hubView() ? quotaBFromView(hubView().quota) : null;
  return vq || newerQuotaB(pc ? pc.quotaB : null, lv);
};
const fiveQuotaA = (p) => {
  const v = quotaOf(p);
  const pc = pcState();
  if (v.source === 'pc' && pc && pc.quota) return pc.quota;
  const [five, weekly] = v.rows; // Live.md 來源：只有「已重置」旗標，沒有重置時刻（0＝已過）
  return v.atMs == null ? null : { h5: five.pct, h5ResetMs: five.reset ? 0 : null, d7: weekly.pct, d7ResetMs: weekly.reset ? 0 : null, readMs: v.atMs };
};
function quotaBRows(rv) { // 健康頁的完整版；首頁的一行數字在 quotaCompact（P66 拿掉原本的首頁精簡長條）
  const out = [h('div', { class: 'qwho', text: rv.label })];
  if (!rv.fresh) { out.push(h('div', { class: 'qnote muted qidle', text: rv.idleText })); return out; }
  for (const r of rv.rows) {
    const sev = sevOf(r.pct);
    const fill = h('div', { class: 'fill' });
    fill.style.width = Math.max(0, Math.min(100, r.pct || 0)) + '%';
    out.push(h('div', { class: 'qrow ' + sev },
      h('div', { class: 'qhead' }, h('span', { class: 'qname', text: r.name }), h('span', { class: 'qpct', text: r.pct + '%' }),
        sev ? h('span', { class: 'qsev', text: (sev === 'bad' ? '⛔ ' : '⚠ ') + SEV_TEXT[sev] }) : null),
      h('div', { class: 'bar' }, fill), h('div', { class: 'qnote', text: r.note })));
  }
  out.push(h('div', { class: 'qnote', text: '電腦讀到的數字（' + rv.ageText + '）' }));
  return out;
}
const quotaNext = (v) => (v.old ? h('div', { class: 'qnext', text: '電腦下次推送時更新' }) : null);

function quotaCard(p, title) {
  const v = quotaOf(p);
  const card = h('section', { class: 'card quota' + (v.stale ? ' stale' : '') + (v.old ? ' qold' : '') },
    h('h2', { text: title + (v.label ? '｜' + v.label + (v.ageText ? '（' + v.ageText + '）' : '') : '') }));
  if (v.stale) card.append(h('div', { class: 'qstale', text: v.liveFresh ? '⚠ 額度數字還沒更新（Live.md 其他內容是新的）' : '⚠ 數字可能已過時（電腦沒在更新）' }));
  if (!v.readAt) card.append(h('div', { class: 'hint', text: '讀不到「數字讀取時間」，無法判斷新舊' }));
  for (const r of v.rows) card.append(quotaRow(r, v.stale, v.dateText, v.atMs));
  if (v.old) card.append(quotaNext(v));
  card.insertBefore(h('div', { class: 'qwho', text: quotaAName() }), card.children[1] || null);
  card.append(h('div', { class: 'qsep' }), ...quotaBRows(quotaBOf(p)));
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
  return taskInfo().tasks.filter((t) => t.tag !== 'remind' && (t.state === 'waiting' || t.state === 'review')).length;
}

const blurActive = () => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); };

// ---------- 寫入紀錄（outbox，v4 M3）：每一筆寫入先存手機、再送；規則在 lib/outbox.js ----------
const FILE_KEY = { questions: 'questions', task: 'task', live: 'live' };
const isOffline = () => state.offline || (typeof navigator !== 'undefined' && navigator.onLine === false);
// 存檔前先跟 storage 合併；容量不足可清可重抓的快取，但有完成快答時保留，避免答案消失。
const freeCacheSpace = () => { if (!demo && !cachedCloudReplies(state.data).size) { localStorage.removeItem(CACHE_KEY); clearCache(localStorage); } };
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
function pcState(at = nowMs()) { // 電腦投影檔的時間是伺服器時間：用校正後的現在比
  const t = state.data ? state.data.stateText || '' : '';
  if (pcsMemo.text !== t) pcsMemo = { text: t, val: readState(t) };
  return usableState(pcsMemo.val, at);
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
    text = queuedPillText({ queued: c.queued, work: workQueuedCount(state.ob), offline: isOffline(), offlineWord: COPY.offlineQueued }); // 有工作留言時「等加密通道 N 件」和「等送出 N 件」分開寫
    if (isOffline()) cls = 'warn';
  } else if (state.lastSentAt && Date.now() - state.lastSentAt < 3000) {
    text = '✅ 已送出 ' + hhmm(state.lastSentAt); cls = 'ok';
    clearTimeout(pillTimer);
    pillTimer = setTimeout(updatePill, 3200);
  }
  // 首頁（狀態列與「你寫的 N 件」已經在講）、我寫過的（整頁就是狀態）不重複顯示，也不會蓋到狀態列
  // 空間不足的警告任何頁都要看得到
  el.hidden = !text || state.locked || (!state.obUnsaved && (state.tab === 'home' || state.tab === 'mine'));
  if (text) { el.textContent = text; el.className = 'sendpill ' + cls; }
  document.body.classList.toggle('has-pill', !el.hidden); // 對話頁要多留一條高度給它（style.css body.tab-chat.has-pill）
}

// 一筆寫入：先建紀錄（有編號、狀態 queued）、立刻存手機、震一下，畫面馬上看得到，再背景送
function enqueue(kind, payload, id) {
  // 引用的是工作內容（目標 work:true、或編號是工作的 m-／a-／o-）一定是工作留言：不靠畫面狀態，建立時就補上 needs（新舊版面都一樣）
  if (kind === 'chat' && payload && payload.needs !== 'local_login' && quotedWork(payload.content, isWorkTargetId)) payload = { ...payload, needs: 'local_login' };
  const item = createItem(kind, payload, Date.now(), id);
  if (kind === 'chat') { state.lastChatSendAt = item.createdAt; if (!demo) schedulePoll(); } // 送出聊天訊息後 60 秒內快查
  state.ob.push(item);
  obChanged();
  buzz();
  updatePill();
  flushOutbox();
  // P69 快路徑：聊天留言順便按一下電腦的門鈴（同一個 m-編號、同樣內容）。GitHub 正本照常寫（上面的 outbox）；
  // 門鈴不等待、不改畫面、不提示、不重試，失敗只記一筆診斷並重讀 signal（lib/fastpath.js doorbellForItem 永遠不丟例外）
  if (kind === 'chat' && payload.mode !== 'auto' && !demo && !isWorkItem(item)) { // 工作留言不按門鈴（門鈴會把內容送到快路徑，工作內容只走加密通道）； 不看 isOffline：可能是誤判，門鈴失敗也不影響留言
    doorbellForItem(item, { getCfg: fpCfg, onResult: (r) => { fp.bell = { ok: r.ok, why: r.why, at: Date.now() }; if (!r.ok) fpSyncSignal(true); } }).catch(() => {});
  }
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
  lastCacheAt = 0; // 寫入成功改了畫面資料：下一次 fetchAll 不受節流限制，一定要存快取，斷網重開才看得到
  if (cloud.snapshot && r?.via === 'cloud' && typeof r.laptopOnline === 'boolean') {
    cloud.snapshot = { ...cloud.snapshot, laptop_online: r.laptopOnline,
      host: { ...cloud.snapshot.host, laptop: { ...cloud.snapshot.host?.laptop, online: r.laptopOnline } } };
  }
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

// ---------- P70 diag：手機自我診斷回報（lib/diag.js）----------
// 記錄函式一律 try/catch，不能改變原本送出、重新整理的行為。寫出不走 outbox（outbox 卡住時診斷也會卡）
// P74 介面改進 C（11-07）：沒有快取又讀不到時，頁中間放一顆大的「再試一次」，有成功過就寫上次成功的時間
function emptyNoData() {
  if (state.loading) return h('div', { class: 'empty', text: COPY.loading });
  if (!state.error && !state.offline) return h('div', { class: 'empty', text: '還沒有資料，請按「重新整理」' });
  const last = state.diag && state.diag.refresh && state.diag.refresh.lastOk;
  return h('div', { class: 'empty retrybox' },
    h('div', { text: state.offline ? '現在連不上網路，還沒拿到資料。' : '這次沒讀到資料。' }),
    h('button', { class: 'btn wide', type: 'button', text: '再試一次', onclick: () => refresh(false, true) }),
    h('div', { class: 'hint', text: last ? '上次成功：' + hhmm(last) : '這支手機還沒成功讀過資料；' + (state.offline ? '連上網路後 App 也會自動再試。' : 'App 也會自動再試。') }));
}

function diagNote(group, patch) {
  try { state.diag[group] = { ...state.diag[group], ...patch }; } catch (e) { /* 診斷不能影響本業 */ }
}
const diagFlushMark = () => { const f = state.diag.flush || {}; return (f.lastStart || 0) + ':' + (f.lockMissAt || 0); };
let diagVersion = '';
async function diagCtx() {
  if (!diagVersion) { try { diagVersion = 'caches' in self ? versionFromCaches(await caches.keys()) : 'unknown'; } catch (e) { diagVersion = 'unknown'; } }
  let rows = [];
  try { rows = mineRows(); } catch (e) { /* 取不到就空的 */ }
  return {
    version: diagVersion, ua: navigator.userAgent, standalone: !!((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone),
    onLine: navigator.onLine, locked: state.locked, hasClient: !!state.client, client: state.client,
    rateRemaining: state.client && state.client.rateRemaining ? state.client.rateRemaining() : null,
    ob: state.ob, diag: state.diag, flushing: state.flushing, noFlush: state.noFlush,
    lock: await lockInfo(navigator.locks), loading: state.loading, mine: rows, push: state.push, fastpath: fpDiagInfo(), hub: state.hubDiagNow,
    ...(fiveOn() ? { refreshTimings: refreshSamples } : {}),
  };
}
const sendDiag = demo ? async () => ({ skipped: 'demo' }) : createDiagSender({ getCtx: diagCtx, storage: ls, signalBranch: SIGNAL_BRANCH });

// 依建立順序一筆一筆送（同時間只送一筆）。網路錯誤留在排隊；其他錯誤標失敗、繼續下一筆
// v4.3：同時開兩個分頁時，用瀏覽器的鎖讓同一時間只有一個分頁在送；拿不到鎖（別的分頁在送）就直接返回，不顯示錯誤
async function flushOutbox() {
  if (state.flushing || state.noFlush || !state.client || state.locked) return;
  if (!state.ob.some((x) => x.state === 'queued')) { updatePill(); return; }
  if (!demo && typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
    const mark0 = diagFlushMark();
    let ran = false;
    try {
      await navigator.locks.request('agent-outbox', { ifAvailable: true }, async (lock) => {
        if (!lock) return;
        ran = true;
        await doFlush();
      });
      if (!ran) diagNote('flush', { lockMissAt: Date.now() }); // 別的分頁或舊版拿著鎖：記下來，診斷看得到
    } finally {
      if (diagFlushMark() !== mark0) { try { sendDiag('flush').catch(() => {}); } catch (e) { /* 診斷不能影響送出 */ } }
    }
    return;
  }
  const mark1 = diagFlushMark();
  try { await doFlush(); } finally {
    if (diagFlushMark() !== mark1) { try { sendDiag('flush').catch(() => {}); } catch (e) { /* 診斷不能影響送出 */ } }
  }
}

async function doFlush() {
  if (state.flushing || state.noFlush || !state.client || state.locked) return;
  // 開始送之前先跟 storage 合併：別的分頁剛送完的就不再送
  if (!demo) { mergeFromStorage(); state.obRev++; }
  if (markWorkQuotes(state.ob, isWorkTargetId)) obChanged(); // 送出前再判斷一次：引用的是工作內容卻沒標工作的排隊留言，補上標記（只走加密通道）
  if (!state.ob.some((x) => x.state === 'queued')) { updatePill(); return; }
  state.flushing = true;
  diagNote('flush', { lastStart: Date.now(), lastError: '' });
  const client = state.client;
  let res = null;
  try {
    const cfgReady = cloudSyncConfig().catch(() => null);
    // 重開後憑證只在記憶體：排隊快答必須等讀取完成，不能搶先寫成 GitHub 明文。
    if (state.ob.some((x) => x.state === 'queued' && (x.payload?.mode === 'auto' || isWorkItem(x)))) {
      let timer;
      try { await Promise.race([cfgReady, new Promise((resolve) => { timer = setTimeout(resolve, 3000); })]); }
      finally { clearTimeout(timer); }
    } // 讀憑證最多等 3 秒；沒有憑證的工作／快答仍由 skip 留隊，一般留言照送。
    res = await processOutbox(() => state.ob, async (item) => {
      const c = navigator.onLine === false && !isWorkItem(item) ? null : cloudSource(); // 工作留言不看 navigator.onLine（誤判離線也不會退成明文；真的斷線 fetch 會失敗，照樣排隊）
      // skip 到 execute 之間會更新狀態與重畫，憑證也可能剛好過期；仍須保留快答的路徑。
      if (!demo && item.payload?.mode === 'auto' && !c) throw new TypeError('network cloud credentials unavailable');
      const gen = state.gen, ctl = new AbortController();
      if (item.payload?.mode === 'auto' && c) cloud.askCtl = ctl;
      let r;
      try {
        r = c ? await executeItem(client, item, { useHub: hubRouteNow, cloud: c, cloudSnapshot: cloud.snapshot,
          signal: ctl.signal, onCloudFallback: cloudFallback,
          onQuickChange(row) {
            if (gen !== state.gen || state.locked || ctl.signal.aborted) return;
            cloud.quick.set(item.id, row);
            if (row.status === 'done' && row.answer) saveCache();
            render(); scrollBottom();
          },
          onQuickFallback(id) { cloud.quick.delete(id); },
        }) : await executeItem(client, item, { useHub: hubRouteNow });
      } finally { if (cloud.askCtl === ctl) cloud.askCtl = null; }
      applyResult(item, r);
      return r;
    }, {
      onChange: (it) => { if (it.state === 'sent') state.lastSentAt = Date.now(); obChanged(); updatePill(); render(); },
      shouldStop: () => state.client !== client || state.locked,
      // GitHub 沿用實際嘗試送出；離線或憑證未就緒的快答繼續排隊，不能退成明文。
      // 工作留言：沒有憑證就留在排隊（等加密通道），不嘗試任何寫入
      skip: (it) => it.id === state.mopen || (isWorkItem(it) && !cloudSource()) || (!demo && it.payload?.mode === 'auto' && (navigator.onLine === false || !cloudSource())),
    });
    diagNote('flush', { lastEnd: Date.now(), lastResult: { sent: res.sent, failed: res.failed, offline: res.offline, tried: res.tried } });
  } catch (e) {
    diagNote('flush', { lastEnd: Date.now(), lastError: diagErrText(e) });
    throw e; // 原本的行為：例外照樣往外丟
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

const obChip = (it) => (it.kind === 'chat' && isWorkItem(it) && it.state === 'queued' ? '🔒 等加密通道' : cloudWaiting(it, chatThreads().find((t) => t.id === it.id)?.replies) || (it.state === 'sending' ? '⏳ 送出中…' : it.state === 'failed' ? '❌ 沒送出' : it.state === 'sent' ? '✅ 已送出 ' + hhmm(it.sentAt || it.createdAt) : '⏳ 排隊中，' + savedWord()));

// 工作留言的「再試一次」：雲端沒開時要說一聲（不能完全沒反應）；有憑證就照常再送一次
function retryWorkNow() {
  if (!cloudSource()) toast('雲端還沒開，標工作的留言要等雲端打開才送得出', true);
  state.mopen = null; render(); flushOutbox();
}
function obActions(it) {
  const row = h('div', { class: 'quick obacts' });
  const waitWork = fiveOn() && !cloudSource() && it.kind === 'chat' && isWorkItem(it);
  if (it.state === 'failed') {
    if (!waitWork) row.append(h('button', { class: 'btn small', type: 'button', text: '重試', onclick: () => doRetry(it.id) }));
    if ((it.kind === 'journal' || it.kind === 'record') && it.code === 'conflict') row.append(h('button', { class: 'btn small ghost', type: 'button', text: '用我的版本覆蓋', onclick: () => doRetry(it.id, { force: true }) }));
  }
  if (it.state === 'queued' && it.kind === 'chat' && isWorkItem(it) && !waitWork) row.append(h('button', { class: 'btn small', type: 'button', text: '再試一次', onclick: retryWorkNow }));
  if (canSendPlain(it, { modern: fiveOn(), cloudOn: !!cloudSource(), isWorkId: isWorkTargetId })) row.append(h('button', { class: 'btn small ghost', type: 'button', text: '改成一般留言送出', onclick: () => sendPlainWork(it.id) }));
  if (it.state !== 'sending' && it.state !== 'sent') row.append(h('button', { class: 'btn small ghost', type: 'button', text: '刪除', onclick: () => doDelete(it.id) }));
  return row;
}

function sendPlainWork(id) {
  const current = () => state.ob.find((x) => x.id === id);
  const allowed = (it) => canSendPlain(it, { modern: fiveOn(), cloudOn: !!cloudSource(), isWorkId: isWorkTargetId });
  if (!allowed(current())) return;
  if (!confirm('這則會走一般通道，內容會進 GitHub。確定要取消工作標記，改成一般留言送出嗎？')) return;
  // 確認後再合併與檢查一次，避免另一分頁已開始送出同一筆。
  if (!demo) { mergeFromStorage(); state.obRev++; }
  const it = current();
  if (!allowed(it)) { toast('這則狀態已改變，請重新查看。', true); render(); return; }
  editPayload(it, { needs: undefined, mode: 'thinking' });
  obChanged(); updatePill(); render(); flushOutbox();
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
  // P74：json 模式送出的留言要等電腦收件、發佈 view 才看得到（比 Live.md 慢）。這類留言（optimisticVisible）：目前的對話串（不論 json 或退回的 Live.md）
  // 找得到編號才收，不設時限；回答／交辦操作（hubReply）不會變成對話串，送出後就不顯示；其他種類與舊路徑照舊
  const hubChat = kind === 'chat';
  const hubTh = hubChat ? chatThreads() : null;
  const hubCtx = hubChat ? { threads: hubTh, status: readChatStatus(state.data && state.data.chatStatusText), rangeStartMs: state.hubRangeStart != null ? state.hubRangeStart : Date.now() - 3 * 86400000, now: Date.now() } : null;
  const seen = (it) => (ti ? (kind === 'task' ? ti.tasks : ti.notes).some((x) => x.mid === it.id) : true);
  const shown = (it) => {
    if (it.state !== 'sent') return true;
    if (hubChat && (isHubMsgItem(it) || it.result?.reason === 'cloud_answered')) return optimisticVisible(it, hubCtx);
    return Date.now() - it.sentAt < 120000 && !seen(it);
  };
  return state.ob.filter((it) => it.kind === kind && shown(it)).sort((a, b) => b.createdAt - a.createdAt);
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

// 已送出的驗收回覆或手打回答：只存在這支手機的送出紀錄，顯示成你的一則留言
function echoBubble(e) {
  const ws = workStatus();
  const order = e.kind === 'order' && ws ? (ws.orders || []).find((o) => o.id === e.target) : null;
  const head = e.kind === 'order' ? '驗收回覆' + (order ? '：' + plainTitle(order.title) : '') : '回答提問';
  const b = h('div', { class: 'bubble you echo', 'data-echo': e.id });
  b.append(h('span', { class: 'meta', text: head + '｜已送出｜' + hhmm(e.at) }));
  b.append(h('div', { text: e.text }));
  return b;
}

function pendingBubble(it) {
  const b = h('div', { class: 'bubble you pending' + (it.state === 'failed' ? ' failed' : '') });
  b.append(h('span', { class: 'meta', text: obChip(it) + '｜' + hhmm(it.createdAt) }));
  b.append(...msgBody(String((it.payload || {}).content || ''), chatAllThreads));
  if (it.state === 'failed') b.append(h('div', { class: 'bstatus bad', text: it.err }));
  if (it.state === 'queued' && it.kind === 'chat' && isWorkItem(it)) b.append(h('div', { class: 'bstatus muted waitcloud', role: 'status', text: cloudSource() ? '標了工作，只走加密留言；通道不通，會自動再送' : fiveOn() ? WORK_QUEUE_TEXT : '雲端還沒開，標工作的留言要等雲端打開才送得出' }));
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
  const sig = [state.obRev, d.task, d.questions, d.live, d.hubText, state.hubHist.threads ? state.hubHist.threads.length : 0, d.stateText, d.chatStatusText, d.workStatusText, d.fetchedAt, d.records ? d.records.fetchedAt : 0, Math.floor(Date.now() / 60000)].join('|');
  if (mrMemo.sig === sig) return mrMemo.val;
  const ti = taskInfo();
  const ctx = buildMineCtx({ tasks: ti.tasks, notes: ti.notes, taskText: d.task || '', questionsText: d.questions || '', liveText: d.live || '', state: pcState(), chatStatus: readChatStatus(d.chatStatusText), workStatus: usableWs(), threads: hubView() ? chatThreads() : null, now: Date.now(), fetchedAt: d.fetchedAt || 0, records: d.records ? d.records.texts : null, recFetchedAt: d.records ? d.records.fetchedAt || 0 : 0 });
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
    // P70 M3b（Q334＝A）：動手題改在問題頁當一般題目，不再跳任務頁
    state.qtab = qtabFor(j.id); state.openQ = j.id; setTab('todo'); scrollToCard(j.id);
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

// 跳到任務頁並展開那一張（看板版的提醒留在提醒頁）
function openTask(key) {
  const rt = kanbanOn() ? taskInfo().tasks.find((x) => x.key === key && x.tag === 'remind') : null;
  if (rt) { state.expanded.add('task:' + key); setTab('reminders'); scrollToId('t-' + key); return; }
  if (kanbanOn()) { // m-vebeix39：看板版沒有任務頁；交辦跳到首頁看板那張卡所在的欄
    const hit = (x) => x.key === 'task:' + key || x.taskKey === key;
    const col = kanbanModel().columns.find((c) => c.cards.some(hit));
    if (!col) { toast('這件已經不在看板上（可能已經結束）'); return; } // P74 體驗檢查：找不到就留在原頁，不要丟回首頁迷路
    const card = col.cards.find(hit);
    setTab('home'); // setTab 進首頁會清掉 kanbanColumn，所以之後再設、再畫一次
    kanbanColumn = col.key;
    render();
    const el = card && [...document.querySelectorAll('[data-card]')].find((e) => e.getAttribute('data-card') === card.key);
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('kb-flash'); setTimeout(() => el.classList.remove('kb-flash'), 1200); }
    return;
  }
  const g = groupTasks(taskInfo().tasks, new Date()).find((x) => x.items.some((t) => t.key === key));
  if (g && COLLAPSED_TASK_GROUPS.includes(g.key)) state.expanded.add('tg:' + g.key);
  state.expanded.add('task:' + key);
  state.ttab = taskTabForOpen(groupTasks(taskInfo().tasks, new Date()), key); // 任務在哪個分頁就切過去（提醒在「提醒」，其餘或找不到在「交辦 Agent」）
  setTab('tasks');
  scrollToId('t-' + key);
}

function openProject(pr) {
  state.expanded.add(pkey(pr));
  if (!isActive(pr)) state.restOpen = true; // 在收合區（暫停、構想、已結案）就自動展開
  setTab('projects');
  scrollToId('p-' + pkey(pr));
}

// 開新增任務表單（可預填內容與專案）
function openTaskForm({ content = '', pid = '', type = 'agent' } = {}) {
  if (kanbanOn()) { // m-vebeix39：看板版沒有任務頁，新交辦在聊天室打（帶［專案］前綴）
    const pre = (pid ? '［' + pid + '］' : '') + content;
    if (pre && !getDraft('chat').trim()) setDraft('chat', pre);
    setTab('chat');
    return;
  }
  if (content) appendDraft('taskv3', content);
  state.tf = { open: true, mode: pid ? 'pick' : 'auto', pid, deadline: '', type };
  state.ttab = 'agent'; // 新增表單在「交辦 Agent」分頁
  setTab('tasks');
}

// 開對話頁並帶 context
function startChat(ctx, prefill = '') {
  state.chatCtx = ctx;
  if (fiveOn() && isWorkCtx(ctx)) setWorkMode(true); // 工作專案追問：膠囊狀態也寫進手機，之後清掉討論對象、重開都還亮著
  if (prefill) appendDraft('chat', prefill);
  setTab('chat');
}

const ctxText = (c) => (c.kind === 'project' ? c.id + ' · ' + (c.name || c.label || '') : c.id + ' · ' + [...String(c.label || '')].slice(0, 20).join(''));

// 現在要送的這則是不是引用工作內容：引用列自己帶 work，或內容的引用編號查得到是工作
const quoteIsWork = (ref, text) => !!ref && (ref.work === true || quotedWork((ref.prefix || '') + String(text || ''), isWorkTargetId));
function sendQuick(key, area, okMsg) {
  const v = area.ta.value.trim();
  if (!v) { if (Date.now() - (state.lastSentAt || 0) > 1500) toast('請先寫點內容', true); return; } // 剛送出時連點第二下：不報錯
  // P74 五欄版：工作膠囊開著（或工作專案追問）＝強制深思、needs=local_login；關著時 plan 跟原本一樣
  const qWork = quoteIsWork(state.quoteRef, v);
  const plan = chatSendPlan({ five: fiveOn(), workOn: workChatState({ five: fiveOn(), pill: state.workPill, ctx: state.chatCtx, quote: qWork }).on, cloudOn: !!cloudSource(), hubRoute: hubRouteNow(), mode: cloud.mode, quoteWork: qWork });
  const mode = plan.mode;
  if (mode === 'auto' && [...v].length > 4000) { toast('這則超過 4,000 字，請分成兩則送', true); return; }
  cloud.mode = 'thinking'; // 只影響下一則；不存 localStorage
  if (state.quoteRef && state.quoteRef.kind === 'order') { enqueue('chat', hubPayload({ content: state.quoteRef.prefix + problemText(v), hubReply: true, ...(plan.needs || state.quoteRef.work ? { needs: 'local_login' } : {}) })); dropProblemRef(); } // P72：對交辦說「還有問題」，內容一定以 ↩o-編號｜還有問題 開頭
  else if (mode === 'auto') enqueue('chat', hubPayload({ content: v, mode }));
  else if (plan.needs) enqueue('chat', hubPayload({ content: withCtx(state.chatCtx, withQuote(state.quoteRef, v)), needs: plan.needs })); // 工作膠囊：這則只給電腦（雲端不領）
  else enqueue('chat', hubPayload({ content: withCtx(state.chatCtx, withQuote(state.quoteRef, v)) })); // 先存手機、立刻出現在對話裡（排隊中），送成功才是真的寫進 Live.md「對話」區
  state.quoteRef = null;
  state.lastSentAt = Date.now();
  clearDraft(key);
  const keepKb = typeof document !== 'undefined' && document.activeElement === area.ta; // P74 體驗檢查：送出後不收鍵盤，方便連發
  // 11-07 修錯（m-1cl2qf1m）：輸入框還有焦點時 render() 不重建輸入列，舊字會留在框裡，再打字又被存回草稿；送出成功就直接清空這個框、拿掉已用掉的引用列
  area.ta.value = '';
  if (keepKb) {
    const qb = area.ta.closest && area.ta.closest('#chatbar') && document.querySelector('#chatbar .quotebar'); if (qb) qb.remove();
    if (!fiveOn()) area.ta.blur(); // 舊版面打字時不會局部重畫訊息，先放掉焦點讓整頁重畫，下面再把焦點放回新的輸入框
  }
  toast('✅ 已存手機 ' + hhmm(Date.now()) + '｜' + (plan.needs ? (plan.wait ? '等加密通道（雲端還沒開）' : isOffline() ? '沒網路，連上會自動送（只走加密留言）' : '送出中（加密留言）') : isOffline() ? '沒網路，連上會自動送' : '送出中'));
  state.pending = false;
  render();
  if (keepKb) { const t = document.querySelector('.chatbar textarea'); if (t) t.focus(); }
  if (state.tab === 'chat') scrollBottom();
}

// 首頁額度（P66）：一行數字（公司 5 小時／每週，下面一行副帳號），超過 80% 才上色；完整長條與重置時間在健康狀態頁（quotaCard）。
// 過時的數字照舊要講：加一行小字「⚠ HH:MM 的數字，N 小時前」。整張是一顆按鈕，點了到健康狀態。
function quotaCompact(p) {
  const v = quotaOf(p);
  const rv = quotaBOf(p); // 公司那份讀不到時個人那塊照樣顯示
  const card = h('button', { class: 'card qline' + (v.stale ? ' stale' : '') + (v.old ? ' qold' : ''), type: 'button', 'aria-label': '額度，點開看健康狀態', onclick: () => setTab('health') });
  const val = (name, r, dim) => {
    const sev = r.reset ? '' : sevOf(r.pct);
    return h('span', { class: 'qlv' + (sev ? ' ' + sev : '') + (r.reset ? ' old' : '') + (dim ? ' dim' : '') },
      h('span', { class: 'qlk', text: name }), h('b', { text: r.pct == null ? '—' : r.pct + '%' }), sev ? h('span', { class: 'qlsev', text: SEV_TEXT[sev] }) : null);
  };
  const body = h('div', { class: 'qlbody' });
  if (v.rows.every((r) => r.pct == null)) body.append(h('div', { class: 'qlrow' }, h('span', { class: 'hint', text: '讀不到額度（Live.md 沒有額度區）' })));
  else body.append(h('div', { class: 'qlrow' }, h('span', { class: 'qlwho', text: quotaAName() }), ...v.rows.map((r) => val(DISPLAY_NAME[r.name] || r.name, r))));
  if (v.stale) body.append(h('div', { class: 'qmwarn', text: '⚠ ' + (v.source === 'pc' ? v.label.replace(/ 的數字$/, '') : v.readAt.replace(/^(\d):/, '0$1:')) + ' 的數字，' + v.ageText }));
  if (v.old) body.append(quotaNext(v)); // 已重置的舊數字：照舊講「電腦下次推送時更新」
  if (rv.fresh) body.append(h('div', { class: 'qlrow rt' }, h('span', { class: 'qlwho', text: rv.label }), ...rv.rows.map((r) => val(r.name, r, false))));
  else body.append(h('div', { class: 'qlrow rt qidle', text: rv.idleText })); // 太舊：整行淡化，不消失
  card.append(h('span', { class: 'qltitle', text: '額度' }), body, h('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }));
  return card;
}

// 重要提醒列點下去要做的事（lib/home.js 只給 target，不碰 DOM）
function goReminder(t) {
  if (t.type === 'q') { state.qtab = 'open'; state.openQ = t.id; setTab('todo'); scrollToCard(t.id); }
  else if (t.type === 'todo-today') { state.qtab = 'open'; state.openQ = t.id; setTab('todo'); scrollToCard(t.id); }
  else if (t.type === 'task') openTask(t.id);
  else if (t.type === 'journal') { state.rtab = 'journal'; state.jday = t.id; setTab('record'); }
  else if (t.type === 'tasks-review') { state.ttab = 'agent'; setTab('tasks'); scrollToId('tg-review'); }
  else if (t.type === 'reminders') setTab('reminders');
}

// 電腦同步狀態（lib/status.js syncStatus）：離線＝瀏覽器說沒網路，或最近一次抓取因為網路失敗
function currentSync(p, now = new Date()) {
  const off = state.offline || (typeof navigator !== 'undefined' && navigator.onLine === false);
  return syncStatus({ commits: state.data.commits || [], live: p, now, offline: off, fetchedAt: state.data.fetchedAt, state: pcState(now.getTime()), queued: queuedCount(state.ob) });
}

// 狀態列文字（P66）：第一段是同步狀態，「｜」後面（在跑什麼、Live 多久沒更新）放第二行；🏃 換成文字「在跑：」，其餘 emoji 拿掉
function slText(text) {
  const parts = stripIcons(String(text || '').replace(/🏃\s*執行中：/g, '在跑：').replace(/🏃\s*/g, '在跑：')).split('｜');
  return h('span', { class: 'sl-text' }, h('span', { class: 'sl-main', text: parts[0] }), parts.length > 1 ? h('span', { class: 'sl-sub', text: parts.slice(1).join('｜') }) : null);
}

function statusLineCard(p, st) {
  const now = new Date();
  const sy = currentSync(p, now);
  const v = statusLineView(st, {
    ageMin: updatedAgeMinutes(p.updated, now), offline: state.offline, error: state.error,
    fetchedAt: state.data.fetchedAt ? dayTime(state.data.fetchedAt, now) : '', sync: sy,
  });
  const box = h('div', { class: 'statuswrap' });
  // P66：狀態文字的 emoji 拿掉（stripIcons），異常改用文字顏色表示（style.css .statusline.st-error 等）
  const bar = h('button', {
    class: 'statusline st-' + st.key + ' sy-' + sy.key, type: 'button', 'aria-expanded': state.stOpen ? 'true' : 'false',
    onclick: () => { if (v.action === 'settings') setTab('settings'); else { state.stOpen = !state.stOpen; render(); } },
  }, slText(v.text), h('span', { class: 'sl-right', text: v.right }), h('span', { class: 'chev', 'aria-hidden': 'true', text: v.action === 'settings' || !state.stOpen ? '›' : '⌄' }));
  box.append(bar);
  if (state.stOpen && v.action !== 'settings') {
    box.append(h('div', { class: 'stopen' },
      h('div', { class: 'stdetail', text: st.detail }),
      nowStatusLine(p),
      h('div', { class: 'hint', text: '電腦最後推送 ' + (sy.pc ? sy.pc.time : '—') + '｜Agent 最後更新 ' + (formatUpdated(p.updated) || '—') + '｜手機同步 ' + (state.data.fetchedAt ? dayTime(state.data.fetchedAt, now) : '—') }),
      h('button', { class: 'btn ghost small', type: 'button', text: '健康狀態 ›', onclick: () => setTab('health') })));
  }
  return box;
}

// Live.md「現在」區的狀態行；Live.md 最後更新不是今天，前面標 MM-DD 並用次要文字色（判斷在 lib/home.js nowStatusView）
function nowStatusLine(p) {
  const v = nowStatusView(p, new Date());
  if (!v) return null;
  // P71：舊路徑的細節多顯示現在區的「剛完成」「下一步」
  const n = p && p.now ? p.now : {};
  return h('div', { class: 'nowblock' },
    h('div', { class: 'hint nowstatus' + (v.old ? ' muted' : ''), text: v.text }),
    n.justDone ? h('div', { class: 'hint nowstatus', text: '剛完成：' + n.justDone }) : null,
    n.next ? h('div', { class: 'hint nowstatus', text: '下一步：' + n.next }) : null);
}

// ---------- P71：工作狀態卡（首頁）與進行中列（聊天頁）。資料來源 lib/datasource.js，推導全在 lib/workstatus.js ----------
let wsMemo = { text: null, val: null };
function workStatus() {
  const t = state.data && state.data.workStatusText;
  if (!t) return null;
  if (wsMemo.text !== t) { wsMemo = { text: t, val: readWorkStatus(t) }; if (wsMemo.val) rememberLabels(wsMemo.val); }
  return wsMemo.val;
}
// 引用目標是不是工作內容（引用工作內容的留言一定是工作留言，新舊版面都一樣）。m-＝對話串（work:true、被遮成工作、或自己排隊中的工作留言）、o-＝交辦、a-＝提問。查不到＝不是
function isWorkTargetId(id) {
  const s = String(id || '');
  if (!s) return false;
  const w = workStatus();
  if (/^o-/.test(s)) return !!(w && (w.orders || []).some((o) => o.id === s && o.work));
  if (/^a-/.test(s)) return !!(w && (w.asks || []).some((a) => a.id === s && a.work));
  const mine = state.ob.find((x) => x.id === s);
  if (mine && isWorkItem(mine)) return true;
  const t = chatThreads().find((x) => x.id === s);
  return !!t && isWorkThread(t);
}
// 檔案可用（讀得到、不超過 12 小時）才回傳；否則 null＝退回舊的 Live.md 狀態列
function usableWs() {
  const w = workStatus();
  return w && usable(w, nowMs()) ? w : null;
}

// 捲到那一串對話（from 已被 readWorkStatus 驗過是 m-編號格式，不會是奇怪的選擇器）
function scrollToThread(from) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = document.querySelector('[data-mid="' + from + '"]');
    if (el) el.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
  }));
}
// 點「等你」「超時」「沒回報」的項目：切到聊天頁，輸入框預填一句（不自動送出），有 from 的捲到那一串
function askAbout(it, kind) {
  askPrefill(askText(it, kind), it && it.from);
}
// 切到聊天頁，輸入框預填一句（不自動送出；已經在草稿裡就不重複加），有 from 的捲到那一串
function askPrefill(text, from) {
  if (!getDraft('chat').includes(text)) appendDraft('chat', text);
  setTab('chat');
  if (from) scrollToThread(from);
}
function seeThread(from) {
  setTab('chat');
  scrollToThread(from);
}
// 跳到問題頁那一題（沒有這題的卡片就只是切到問題頁）
function goQuestion(qid) {
  const tab = qtabFor(qid); // 已答的題落在「已答」
  state.qtab = tab;
  state.openQ = qid;
  setTab('todo');
  scrollToCard(qid);
}

// ---------- 狀態卡的展開：每一列、每個統計都是 button＋aria-expanded，展開狀態存在 state（render 整頁重畫也不會收起來） ----------
function wsToggle(key) {
  if (state.wsExp.has(key)) state.wsExp.delete(key);
  else state.wsExp.add(key);
  render();
}
function wsSecToggle(name) {
  state.wsSec[name] = !state.wsSec[name];
  render();
}
const wsDomId = (key) => 'wsd-' + String(key).replace(/[^A-Za-z0-9_-]/g, '_');

// 展開後的詳情：一列一列「標籤：內容」，下面按鈕（到聊天問、題目類去回答、有對話的看對話）
function wsDetailPanel(key, d, opts = {}) {
  const dl = h('dl', { class: 'wi-dl' });
  for (const r of d.rows) dl.append(h('dt', { text: r.label }), h('dd', { text: r.value }));
  const acts = h('div', { class: 'wi-actions' }, h('button', { class: 'btn small', type: 'button', text: '到' + AGENT_NAME + '聊天問', onclick: () => askPrefill(d.ask, opts.from) }));
  if (opts.qid) acts.append(h('button', { class: 'btn ghost small', type: 'button', text: '去回答', onclick: () => goQuestion(opts.qid) }));
  if (opts.from) acts.append(h('button', { class: 'btn ghost small', type: 'button', text: '看對話 ›', onclick: () => seeThread(opts.from) }));
  return h('div', { class: 'wi-detail', id: wsDomId(key) }, dl, acts);
}

// 一列可展開的項目：按鈕本身（aria-expanded）＋展開後的詳情
function wsRow(key, cls, kids, detailFn, said = null) {
  const open = state.wsExp.has(key);
  const btn = h('button', { class: 'wi expandable' + (cls ? ' ' + cls : ''), type: 'button', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': open ? wsDomId(key) : null, onclick: () => wsToggle(key) },
    ...kids, h('span', { class: 'chev', 'aria-hidden': 'true', text: open ? '⌄' : '›' }));
  return h('div', { class: 'wi-wrap' }, btn, saidRow(said), open ? detailFn() : null);
}

// P72 F3：「你說：<原話前 30 字>（HH:MM）›」，點了到聊天頁那一串。找不到原話、工作類 → 不畫（saidFor 回 null）
function homeThreads() {
  return state.data ? chatThreads() : [];
}
function itemSaid(item, seen) {
  const w = usableWs();
  return jobSaid(item, { threads: homeThreads(), orders: w && w.orders ? w.orders : [], seen });
}
function saidRow(s) {
  if (!s) return null;
  const txt = '你說：' + s.text + (s.time ? '（' + s.time + '）' : '');
  if (!s.from) return h('div', { class: 'wi-said static', text: txt });
  return h('button', { class: 'wi-said', type: 'button', 'aria-label': txt + '，看這串對話', onclick: () => seeThread(s.from) },
    h('span', { class: 'wi-said-text', text: txt }), h('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }));
}

// 一個進行中項目：左邊活動點（只有真的有消息才脈動）、中間名稱／小字／進度／進度條、右邊狀態文字（不只靠顏色）；點了展開詳情
function wsItemRow(entry, opts) {
  const { item, view: v } = entry;
  const noSaid = !!(opts && opts.noSaid === true);
  const seen = opts && opts.seen instanceof Set ? opts.seen : null; // P72：掛在交辦底下的工作，原話顯示在交辦上，不重複
  const note = v.note || (v.activity === 'pulse' ? '進行中' : '暫無新消息');
  let bar = null;
  if (v.hasBar) {
    const fill = h('i');
    fill.style.width = v.pct + '%';
    bar = h('span', { class: 'wi-bar', 'aria-hidden': 'true' }, fill); // 文字已經有「第 n／m 步」，進度條只是視覺
  }
  const kids = [
    h('span', { class: 'wi-dot ' + v.activity, 'aria-hidden': 'true' }),
    h('span', { class: 'wi-main' }, h('span', { class: 'wi-name', text: v.name }), v.sub ? h('span', { class: 'wi-sub', text: v.sub }) : null, h('span', { class: 'wi-prog', text: v.progressText }), bar),
    h('span', { class: 'wi-note ' + v.activity, text: note }),
  ];
  const key = 'r:' + (item.id || item.name);
  return wsRow(key, v.clickable ? 'clickable' : '', kids, () => wsDetailPanel(key, runDetail(item, v, nowMs()), { from: item.from }), noSaid ? null : itemSaid(item, seen));
}

// 等你清單的一列：題目、專案、背景工作
function wsWaitRow(e) {
  const kids = [
    h('span', { class: 'wi-dot wait', 'aria-hidden': 'true' }),
    h('span', { class: 'wi-main' }, h('span', { class: 'wi-name', text: e.title }), h('span', { class: 'wi-sub', text: e.sub }), h('span', { class: 'wi-prog', text: e.reason })),
    h('span', { class: 'wi-note wait', text: '等你' }),
  ];
  return wsRow(e.key, '', kids, () => {
    const d = waitDetail(e, nowMs());
    return wsDetailPanel(e.key, d, { qid: d.qid });
  });
}

// 今天做完（或沒做完）的一列
function wsDoneRow(d, opts) {
  const kids = [
    h('span', { class: 'wi-dot ' + (d.ok ? 'done' : 'fail'), 'aria-hidden': 'true' }),
    h('span', { class: 'wi-main' }, h('span', { class: 'wi-name', text: d.name }), h('span', { class: 'wi-sub', text: [clockText(d.endedMs), d.code].filter(Boolean).join('・') }), d.result ? h('span', { class: 'wi-prog', text: d.result }) : null),
    h('span', { class: 'wi-note ' + (d.ok ? 'done' : 'fail'), text: d.ok ? '做完了' : '沒做完' }),
  ];
  const key = 'd:' + (d.id || d.name);
  return wsRow(key, d.ok ? '' : 'clickable', kids, () => wsDetailPanel(key, doneDetail(d, nowMs()), { from: d.from }), itemSaid(d, opts && opts.seen instanceof Set ? opts.seen : null));
}

// 三個統計：背景在跑、今天做完、等你。有東西可看才是按鈕（aria-expanded），0 件只是文字
function wsChip(sec, label, n, canOpen) {
  if (!canOpen) return h('span', { class: 'wc-chip static', text: label });
  const open = !!state.wsSec[sec];
  return h('button', { class: 'wc-chip' + (open ? ' on' : ''), type: 'button', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': 'ws-sec-' + sec, onclick: () => wsSecToggle(sec) },
    h('span', { text: label }), h('span', { class: 'chev', 'aria-hidden': 'true', text: open ? '⌄' : '›' }));
}

// 點推播帶來的工作編號：找得到就打開那一區、展開那一列、捲過去；找不到（狀態檔還沒更新）先留著，下次畫卡再試
function applyPendingJob(w) {
  const t = jobTarget(w, state.pendingJob);
  if (!t) return;
  state.pendingJob = '';
  const jo = w.running.find((i) => i.id === t.key.slice(2));
  if (jo && jo.order) state.p72.sets.add('g:' + jo.order); // v72：工作掛在交辦底下時，那一組要先展開
  state.wsSec[t.sec] = true;
  state.wsExp.add(t.key);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = document.getElementById(wsDomId(t.key));
    if (el) el.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
  }));
}

// 狀態卡「點開」的細節（狀態不明、下一步、各種時間、健康狀態）；v71 卡與 v72 的電腦狀態一行共用
function wsOpenPanel(p, w, dv) {
  const sy = currentSync(p, new Date());
  const more = h('div', { class: 'wc-open' });
  if (dv.unknown.length) {
    more.append(h('div', { class: 'wc-sec', text: '狀態不明（太久沒結束）' }), ...dv.unknown.map((u) => h('div', { class: 'wc-done' }, h('span', { class: 'wc-dname', text: u.name }), u.sub ? h('span', { class: 'wi-sub', text: u.sub }) : null)));
  }
  if (dv.next) more.append(h('div', { class: 'wc-sec', text: '下一步' }), h('div', { class: 'wc-line3', text: dv.next }));
  more.append(h('div', { class: 'hint', text: '電腦最後推送 ' + (sy.pc ? sy.pc.time : '—') + '｜狀態檔 ' + clockText(w.generatedMs) + '｜手機同步 ' + (state.data.fetchedAt ? dayTime(state.data.fetchedAt, new Date()) : '—') }),
    h('button', { class: 'btn ghost small', type: 'button', text: '健康狀態 ›', onclick: () => setTab('health') }));
  return more;
}

function workCard(p, w) {
  if (state.pendingJob) applyPendingJob(w);
  const now = nowMs();
  const wl = waitList(w, { now, sources: ['job'] }); // P72 F2：首頁「等你」只留真的卡住工作的（題庫題、專案「等你」欄改成 ④ 一行入口）
  const cv = cardView(w, { now, waitTotal: wl.length });
  const dv = detailView(w, { now });
  const open = state.stOpen;
  const runItems = dv.items.filter((x) => !x.item.waiting); // 掛「等你」的工作在「等你」清單裡
  const seenRun = new Set(); // 同一則留言派出的好幾個工作，原話只顯示一次
  const seenDone = new Set();
  const showAll = state.wsSec.run || open;
  const shown = showAll ? runItems : runItems.slice(0, SHOW_ITEMS);
  const box = h('section', { class: 'wcard lamp-' + cv.lamp, 'aria-label': 'Agent 現在在做什麼' });
  box.append(h('button', { class: 'wc-head', type: 'button', 'aria-expanded': open ? 'true' : 'false', onclick: () => { state.stOpen = !state.stOpen; render(); } },
    h('span', { class: 'wc-lamp ' + cv.lamp + (cv.lamp === 'blue' && anyPulse(w, now) ? ' pulse' : ''), 'aria-hidden': 'true' }),
    h('span', { class: 'wc-title' }, h('span', { class: 'wc-headline', text: cv.headline }), h('span', { class: 'wc-age', text: cv.ageLabel })),
    h('span', { class: 'chev', 'aria-hidden': 'true', text: open ? '⌄' : '›' })));
  if (cv.banner) {
    box.append(h('div', { class: 'wc-banner ' + cv.banner.tone, role: 'status' }, h('span', { text: cv.banner.text }),
      cv.banner.ask ? h('button', { class: 'btn ghost small', type: 'button', text: '問' + AGENT_NAME, onclick: () => askAbout(null, 'ask') }) : null));
  }
  box.append(h('div', { class: 'wc-chips', role: 'group', 'aria-label': '工作統計，點了看清單' },
    wsChip('run', '背景 ' + cv.counts.run + ' 件在跑', cv.counts.run, runItems.length > SHOW_ITEMS),
    wsChip('done', '今天做完 ' + cv.counts.done + ' 件', cv.counts.done, w.done.length > 0),
    wsChip('wait', '等你 ' + cv.counts.you + ' 件', cv.counts.you, wl.length > 0)));
  if (cv.line3) box.append(h('div', { class: 'wc-line3', text: cv.line3 }));
  if (state.wsSec.wait && wl.length) box.append(h('div', { class: 'wc-items', id: 'ws-sec-wait' }, h('div', { class: 'wc-sec', text: '等你的事（點一下看原因）' }), ...wl.map(wsWaitRow)));
  if (state.wsSec.done && w.done.length) box.append(h('div', { class: 'wc-items', id: 'ws-sec-done' }, h('div', { class: 'wc-sec', text: '今天的結果（點一下看詳情）' }), ...w.done.map((d) => wsDoneRow(d, { seen: seenDone }))));
  if (shown.length) box.append(h('div', { class: 'wc-items', id: 'ws-sec-run' }, ...shown.map((e) => wsItemRow(e, { seen: seenRun }))));
  if (!showAll && runItems.length > SHOW_ITEMS) {
    box.append(h('button', { class: 'wc-more', type: 'button', text: '還有 ' + (runItems.length - SHOW_ITEMS) + ' 項 ›', onclick: () => wsSecToggle('run') }));
  }
  if (open) box.append(wsOpenPanel(p, w, dv));
  return box;
}

// 聊天頁：膠囊下面一條細列「N 件在跑・最快 HH:MM 做完 ›」，點開同一份進行中清單；沒工作在跑不顯示
function chatRunRow() {
  const w = usableWs();
  const line = w ? chatRunLine(w, nowMs()) : null;
  if (!line) return null;
  const now = nowMs();
  const open = state.runOpen;
  const box = [];
  box.push(h('div', { class: 'runbar' }, h('button', { class: 'runline', type: 'button', 'aria-expanded': open ? 'true' : 'false', onclick: () => { state.runOpen = !state.runOpen; render(); } },
    h('span', { class: 'wi-dot ' + dotClass(w, now), 'aria-hidden': 'true' }), h('span', { class: 'runtext', text: open ? line.replace(/ ›$/, ' ⌄') : line }))));
  if (open) box.push(h('div', { class: 'wc-items runlist' }, ...detailView(w, { now }).items.filter((x) => !x.item.waiting).map(wsItemRow)));
  return box;
}

// ---------- P72：首頁交辦與提問（版面 v72）。純函式在 lib/p72.js、lib/p72home.js；這裡只畫畫面與送出 ----------
const HOME_LAYOUT_KEY = 'agent.homelayout';
function curLayout() {
  if (demo && params.get('home')) return boardLayout(params.get('home')) || homeLayout(params.get('home'));
  let raw = '';
  try { raw = ls.getItem(HOME_LAYOUT_KEY) || ''; } catch (e) { /* 讀不到就用預設 */ }
  return boardLayout(raw) || homeLayout(raw);
}
function setLayout(v) {
  try { ls.setItem(HOME_LAYOUT_KEY, boardLayout(v) || homeLayout(v)); } catch (e) { /* 存不了就這次有效 */ }
  if (demo) params.set('home', boardLayout(v) || homeLayout(v));
  state.lastMain = 'home'; // 切換底欄後，返回鍵不能指到另一種版面才有的分頁（任務／通知）
  render();
}

// 提問、交辦的標籤快取（聊天泡泡「回答：…」「交辦：…」用；電腦端結案後就沒有了，所以記在手機）
const LABEL_KEY = 'agent.p72labels';
let p72LabelMap = null;
// 只存編號→前 20 字（lib/p72home.js LABEL_MAX）。開了 PIN 就不寫進 localStorage（其他敏感快取開 PIN 都是加密或不存），只放記憶體；
// 「清除這台手機的資料」會刪掉（lib/local.js KEYS.p72labels）並把記憶體設回 null
const labelsPersist = () => !(state.cfg && state.cfg.pin);
function p72Labels() {
  if (p72LabelMap) return p72LabelMap;
  p72LabelMap = {};
  if (labelsPersist()) { try { p72LabelMap = JSON.parse(ls.getItem(LABEL_KEY)) || {}; } catch (e) { p72LabelMap = {}; } }
  return p72LabelMap;
}
function rememberLabels(w) {
  const next = mergeLabels(p72Labels(), w);
  if (JSON.stringify(next) === JSON.stringify(p72LabelMap)) return;
  p72LabelMap = next;
  try { if (labelsPersist()) ls.setItem(LABEL_KEY, JSON.stringify(next)); else ls.removeItem(LABEL_KEY); } catch (e) { /* 存不了就只在這次有效 */ }
}

// 本機送出紀錄 → 每個編號送過什麼（outbox 變了才重算）
let lsMemo = { rev: -1, val: new Map() };
function p72Sends() {
  if (lsMemo.rev !== state.obRev) lsMemo = { rev: state.obRev, val: localSends(state.ob) };
  return lsMemo.val;
}

// 送一則回送：走聊天送出管道（outbox chat，重送不重複），內容前綴 ↩a-／↩o-
// P74 json 模式：hubReply 讓它變成 answer／order_op 檔（不再寫 ↩…｜ 行）；hubOpt＝選項按鈕的序號（1 起算，手打答案沒有）
// 首頁驗收按通過：立刻回饋，卡片移到剛完成。名稱存進送出紀錄，電腦結案、清單沒有這件之後還顯示得出來
const UNDO_TEXT = '還原：按錯了，請放回待驗收';
function acceptOrder(o) {
  enqueue('chat', hubPayload({ content: replyContent(o.id, ORDER_TEXT.ok), hubReply: true, orderTitle: plainTitle(o.title) }));
  toast('✅ 已結案，放到「剛完成」；按錯可以按還原' + (isOffline() ? '｜沒網路，連上會自動送' : ''));
  render();
}
function sendReply(id, text, okMsg, hubOpt) {
  const work = workChatState({ five: fiveOn(), pill: state.workPill, ctx: state.chatCtx }).on;
  enqueue('chat', hubPayload({ content: replyContent(id, text), hubReply: true, ...(Number.isInteger(hubOpt) ? { hubOpt } : {}), ...(work ? { needs: 'local_login' } : {}) }));
  toast('✅ ' + (okMsg || '已送出') + ' ' + hhmm(Date.now()) + '｜' + (isOffline() ? '沒網路，連上會自動送' : '送出中'));
  render();
}

const p72Toggle = (key) => { if (state.p72.sets.has(key)) state.p72.sets.delete(key); else state.p72.sets.add(key); render(); };

// ① 提問卡一張
function askCardEl(c, now) {
  const a = c.ask;
  const phase = c.phase;
  const card = h('section', { class: 'pcard ask ' + c.type + (phase.tone ? ' tone-' + phase.tone : ''), 'aria-label': '等你一句話' });
  if (c.type === 'job') {
    const e = c.job;
    card.append(h('div', { class: 'pc-who', text: '背景工作' + (e.sinceMs != null ? '・' + waitedText(e.sinceMs, now) : '') }),
      h('div', { class: 'pc-q', text: e.title }), h('div', { class: 'pc-note', text: clip20(e.reason, 60) }), // 標題一行、原因小字（原因常常很長，還夾檔案路徑）
      h('div', { class: 'pc-actions' }, h('button', { class: 'btn small', type: 'button', text: '到' + AGENT_NAME + '聊天問', onclick: () => askPrefill(e.ask, null) })));
    return card;
  }
  // 掛在交辦底下的提問：寫出是關於哪件交辦（工作類交辦不顯示名稱）
  const about = c.type === 'ask' && c.order && !c.order.work ? '・關於「' + clip20(c.order.title, 14) + '」' : '';
  const who = a.toText + (c.type === 'ask' ? ' 問' + about + (a.sinceMs != null ? '・' + waitedText(a.sinceMs, now) : '') : '');
  card.append(h('div', { class: 'pc-who', text: who }));
  if (c.type === 'pc') {
    card.append(h('div', { class: 'pc-q', text: a.toText + ' 要到電腦按（手機答不了這種）' }));
    return card;
  }
  if (c.type === 'work') {
    card.append(h('div', { class: 'pc-q', text: a.q }), h('div', { class: 'pc-note', text: '這是工作的事，請到電腦處理' }));
    return card;
  }
  card.append(h('div', { class: 'pc-q', text: a.q }));
  const said = c.order ? saidFor({ said: c.order.said, saidMs: c.order.saidMs, from: c.order.from, work: c.order.work }, homeThreads()) : null;
  if (said) card.append(saidRow(said));
  if (phase.key === 'open') {
    const sug = suggestedIndex(a);
    if (a.opts.length) {
      card.append(h('div', { class: 'pc-opts', role: 'group', 'aria-label': '選項' }, ...a.opts.map((o, i) => h('button', { class: 'btn pc-opt' + (i === sug ? '' : ' ghost'), type: 'button', onclick: () => sendReply(a.id, o, '答案已送出', i + 1) },
        h('span', { text: o }), i === sug ? h('span', { class: 'pc-tag', text: '建議' }) : null))));
    }
    const typing = state.p72.typing === a.id;
    if (!typing) card.append(h('button', { class: 'pc-link', type: 'button', text: '打字回答…', onclick: () => { state.p72.typing = a.id; render(); } }));
    else {
      const area = draftArea('ask-' + a.id, '寫你的答案', 2);
      card.append(area, h('div', { class: 'pc-actions' },
        h('button', { class: 'btn small', type: 'button', text: '送出', onclick: () => {
          const v = area.ta.value.trim();
          if (!v) { toast('請先寫點內容', true); return; }
          clearDraft('ask-' + a.id);
          state.p72.typing = null;
          sendReply(a.id, v, '答案已送出');
        } }),
        h('button', { class: 'btn ghost small', type: 'button', text: '先不寫', onclick: () => { state.p72.typing = null; render(); } })));
    }
    if (a.ifNo) card.append(h('div', { class: 'pc-ifno', text: a.ifNo }));
    return card;
  }
  // 送出之後：你的答案＋階段（文字，不只靠顏色）
  if (phase.answer) card.append(h('div', { class: 'pc-answer', text: '你的回答：' + clip20(phase.answer) }));
  card.append(h('div', { class: 'pc-phase ' + (phase.tone || ''), role: 'status', text: phase.text }));
  if (phase.askHey) card.append(h('div', { class: 'pc-actions' }, h('button', { class: 'btn small', type: 'button', text: '問' + AGENT_NAME, onclick: () => askPrefill('我回答了「' + clip20(a.q) + '」，但對方好像還沒收到，幫我看一下', null) })));
  if (phase.key === 'failed' || phase.outboxHint) card.append(h('div', { class: 'pc-actions' }, h('button', { class: 'btn ghost small', type: 'button', text: '到送出紀錄 ›', onclick: () => { state.mfilter = 'failed'; setTab('mine'); } })));
  return card;
}
const clip20 = (s, n = 20) => { const a = [...String(s || '')]; return a.length > n ? a.slice(0, n).join('') + '…' : a.join(''); };

function asksSection(w, now) {
  const wl = waitList(w, { now, sources: ['job'] });
  const board = askBoard(w, { now, sends: p72Sends(), jobWaits: wl, more: state.p72.sets.has('askMore') });
  if (!board.cards.length) return null;
  const sec = h('section', { class: 'p72sec', 'aria-label': '等你一句話' });
  sec.append(h('div', { class: 'sechead' }, h('h2', { text: '等你一句話' + (board.openN ? '（' + board.openN + '）' : '') })));
  sec.append(...board.shown.map((c) => askCardEl(c, now)));
  if (board.hidden) sec.append(h('button', { class: 'wc-more', type: 'button', text: '還有 ' + board.hidden + ' 件 ›', onclick: () => p72Toggle('askMore') }));
  else if (state.p72.sets.has('askMore') && board.cards.length > ASK_MAX) sec.append(collapseBtn('askMore'));
  return sec;
}

// ② 正在跑：依交辦分組
function runSection(w, now) {
  const dv = detailView(w, { now });
  const entries = dv.items.filter((x) => !x.item.waiting);
  if (!entries.length) return null;
  const g = runGroups(entries, w.orders || [], { threads: homeThreads(), more: state.p72.sets.has('runMore') });
  const sec = h('section', { class: 'p72sec', 'aria-label': '正在跑' });
  sec.append(h('div', { class: 'sechead' }, h('h2', { text: '正在跑（' + entries.length + '）' })));
  const list = h('div', { class: 'wc-items', id: 'ws-sec-run' });
  const loose = g.shown.filter((r) => r.type === 'loose');
  const seenLoose = new Set();
  for (const r of g.shown.filter((x) => x.type === 'group')) {
    const gkey = 'g:' + r.order.id;
    const sum = groupSummary(r);
    const many = r.jobs.length > 1;
    const open = !many || state.p72.sets.has(gkey);
    const head = many
      ? h('button', { class: 'pg-head', type: 'button', 'aria-expanded': open ? 'true' : 'false', onclick: () => p72Toggle(gkey) },
        h('span', { class: 'wi-main' }, h('span', { class: 'wi-name', text: r.order.title }), h('span', { class: 'wi-sub', text: sum })), h('span', { class: 'chev', 'aria-hidden': 'true', text: open ? '⌄' : '›' }))
      : h('div', { class: 'pg-head static' }, h('span', { class: 'wi-main' }, h('span', { class: 'wi-name', text: r.order.title })));
    list.append(h('div', { class: 'pgroup' }, head, saidRow(r.said), open ? h('div', { class: 'pg-jobs' }, ...r.jobs.map((e) => wsItemRow(e, { noSaid: true }))) : null));
  }
  if (loose.length) {
    const hasGroups = g.shown.some((x) => x.type === 'group');
    list.append(...(hasGroups ? [h('div', { class: 'pg-loose-title', text: '沒掛在交辦底下的' })] : []), ...loose.map((r) => h('div', { class: 'pg-loose' }, wsItemRow(r.entry, { seen: seenLoose }))));
  }
  sec.append(list);
  if (g.hidden) sec.append(h('button', { class: 'wc-more', type: 'button', text: '還有 ' + g.hidden + ' 項 ›', onclick: () => p72Toggle('runMore') }));
  else if (state.p72.sets.has('runMore') && g.rows.length > RUN_MAX) sec.append(collapseBtn('runMore'));
  return sec;
}

// ③ 交辦卡一張
function orderCardEl(c, now, { compact = false } = {}) {
  const o = c.order;
  const card = h('section', { class: 'pcard order st-' + c.state + (c.stage.flag ? ' flag-' + c.stage.flag : ''), 'aria-label': '交辦：' + o.title });
  const stateText = c.state === 'received' && c.overlay && c.overlay.intent === 'yes' ? '收到' : o.stateText;
  card.append(h('div', { class: 'oc-head' }, h('h3', { class: 'oc-title', text: compact ? plainTitle(o.title) : o.title }), h('span', { class: 'oc-state' + (c.stage.flag ? ' flag' : ''), text: stateText })));
  if (c.stage.idx >= 0 && compact) { /* 首頁看板：欄位已經說明狀態，不再畫狀態條 */ }
  else if (c.stage.idx >= 0) {
    card.append(h('ol', { class: 'stbar', 'aria-label': '進度：' + STAGES.map((s, i) => (i === c.stage.idx ? '目前' : '') + s).join('、') },
      ...STAGES.map((s, i) => h('li', { class: i < c.stage.idx ? 'done' : i === c.stage.idx ? 'cur' : 'todo' }, h('span', { class: 'sb-mark', 'aria-hidden': 'true', text: i < c.stage.idx ? '✓' : i === c.stage.idx ? '●' : '○' }), h('span', { text: s })))));
    if (c.stage.flag) card.append(h('div', { class: 'oc-flag', text: c.stage.flag === 'user' ? '⚑ 等你' : '⚑ 等別人或時間' }));
  } else card.append(h('div', { class: 'oc-guess', text: '我猜這是你交辦的事？' }));
  const rows = compact ? noteRows(o.note) : null; // 首頁驗收（11-07 m-yzw2s8kx）：你要的／結果／怎麼驗／效益
  if (c.said && !rows) card.append(saidRow(c.said)); // append(null) 會印出「null」
  const optRow = rows ? rows.find((r) => r.label === '選項') : null; // 決定型：選項變按鈕，不當一行字
  const opts = noteOptionsOf(o.note); // 審查 #5：任何版面都畫選項按鈕，不會只剩「OK，結案」
  if (rows) {
    const lines = (c.said && c.said.text ? [{ label: '你要的', text: c.said.text }] : []).concat(rows.filter((r) => r !== optRow));
    card.append(linkDocsIn(h('div', { class: 'oc-note oc-lines' }, ...lines.map((r) => h('div', { class: 'oc-line' }, h('b', { text: r.label + '：' }), h('span', { text: r.text }))))));
  } else if (o.note) card.append(linkDocsIn(h('div', { class: 'oc-note', text: o.note })));
  const pv = proofView(o.proof);
  if (pv && compact && c.buttons === 'delivered') {
    // 驗收看功能和效益，不看技術文件：成品收進「給 Agent 的細節」，預設收起
    const det = h('details', { class: 'oc-agent' }, h('summary', { text: '給 Agent 的細節' }));
    if (pv.kind === 'review') det.append(h('button', { class: 'btn ghost small', type: 'button', text: '打開文件', onclick: () => openReview(pv.path, plainTitle(o.title)) }));
    else if (pv.kind === 'link') det.append(h('a', { href: pv.href, target: '_blank', rel: 'noopener noreferrer', text: pv.text }));
    else det.append(h('span', { class: 'hint', title: pv.full, text: '電腦上的檔案：' + pv.text }));
    card.append(det);
  } else if (pv && pv.kind === 'review') card.append(h('div', { class: 'oc-proof' }, h('button', { class: 'btn small', type: 'button', text: pv.text, onclick: () => openReview(pv.path, plainTitle(o.title)) })));
  else if (pv && compact && pv.kind === 'text') card.append(h('div', { class: 'oc-proof path' }, h('span', { class: 'hint', text: rows ? '結論都寫在這張卡上，手機就能決定；完整文件在電腦。' : '成品在電腦上，手機打不開，要回電腦看。' })));
  else if (pv) {
    card.append(pv.kind === 'link'
      ? h('div', { class: 'oc-proof' }, h('span', { text: '成品：' }), h('a', { href: pv.href, target: '_blank', rel: 'noopener noreferrer', text: pv.text }))
      : h('div', { class: 'oc-proof path' }, h('span', { text: '成品檔案：' }), h('span', { class: 'oc-path', title: pv.full, text: pv.text })));
  }
  if (c.overlay) {
    card.append(h('div', { class: 'pc-phase ' + (c.overlay.tone || ''), role: 'status', text: c.overlay.text }));
    if (c.overlay.askHey) card.append(h('div', { class: 'pc-actions' }, h('button', { class: 'btn small', type: 'button', text: '問' + AGENT_NAME, onclick: () => askPrefill('我對「' + o.title + '」按了回覆，但對方好像還沒收到，幫我看一下', null) })));
    if (c.overlay.intent === 'pick' && c.overlay.key !== 'failed') card.append(h('div', { class: 'pc-actions' }, h('button', { class: 'btn ghost small', type: 'button', text: '選錯了，還有問題…', onclick: () => startProblem(o) }))); // 審查 #2：選錯可以更正
    if (c.overlay.key === 'failed' || c.overlay.outboxHint) card.append(h('div', { class: 'pc-actions' }, h('button', { class: 'btn ghost small', type: 'button', text: '到送出紀錄 ›', onclick: () => { state.mfilter = 'failed'; setTab('mine'); } })));
  }
  if (c.buttons === 'delivered' && opts.length) {
    // 決定型驗收（11-07 m-njtajtm2）：點一個選項就送出「↩o-xxxxxx｜選A …」，電腦照選項處理；不同意都不是就按還有問題
    card.append(h('div', { class: 'oc-opts', role: 'group', 'aria-label': '選一個' }, ...opts.map((x) => h('button', { class: 'btn oc-opt', type: 'button', text: x, onclick: () => sendReply(o.id, '選' + x, '已送出：你選了「' + x + '」') }))));
    card.append(h('div', { class: 'pc-actions' }, h('button', { class: 'btn ghost', type: 'button', text: '都不是，還有問題…', onclick: () => startProblem(o) })));
  } else if (c.buttons === 'delivered') {
    card.append(h('div', { class: 'pc-actions' },
      h('button', { class: 'btn', type: 'button', text: compact ? '通過，結案' : 'OK，結案', onclick: () => (compact ? acceptOrder(o) : sendReply(o.id, ORDER_TEXT.ok, '已送出 OK')) }),
      h('button', { class: 'btn ghost', type: 'button', text: '還有問題…', onclick: () => startProblem(o) })));
  } else if (c.buttons === 'candidate') {
    card.append(h('div', { class: 'pc-actions' },
      h('button', { class: 'btn', type: 'button', text: '是', onclick: () => sendReply(o.id, ORDER_TEXT.yes, '已送出：這是交辦') }),
      h('button', { class: 'btn ghost', type: 'button', text: '不是', onclick: () => sendReply(o.id, ORDER_TEXT.no, '已送出：這不是交辦') })));
  } else if (c.buttons === 'work') card.append(h('div', { class: 'pc-note', text: '這是工作的事，請到電腦處理' }));
  return card;
}

// 驗收文件：點了才抓，內容只放記憶體、不寫進手機（跟報表頁一樣）
const review = { path: '', title: '', texts: {}, errs: {}, from: 'home' };
function openReview(path, title, doc = false) {
  delete review.texts[path]; delete review.errs[path]; // 審查 #7：電腦重發同一檔名時要讀到新版，每次打開都重抓
  review.path = path; review.title = title; review.from = state.tab === 'review' ? review.from : state.tab; review.doc = doc; // 文件裡點另一份文件：回去仍回原本那頁
  setTab('review');
  window.scrollTo(0, 0);
}
async function loadReview(path) {
  if (!state.client || review.texts[path] != null || review.errs[path] === '…') return;
  review.errs[path] = '…';
  try {
    const r = await state.client.getFile(path);
    review.texts[path] = r.text || '';
    delete review.errs[path];
  } catch (e) {
    review.errs[path] = e instanceof GitHubError && e.status === 404 ? '手機這邊還讀不到這份，可能還沒傳完，等一下再試' : errMsg(e);
  }
  if (state.tab === 'review') render();
}
// 當前共識（11-07 o-u2kgwy）：每次打開都重抓，電腦重發後不用重開 App
function openConsensus() {
  delete review.texts[CONSENSUS_PATH]; delete review.errs[CONSENSUS_PATH];
  openReview(CONSENSUS_PATH, CONSENSUS_TITLE);
}
// 共識排版：頂端「最後更新」，每個 ## 節包成一塊，已定綠邊、待確認橘邊；內文 **待做** 這類粗體標成待辦色
function consensusBlock(text) {
  const { updated, body } = consensusParts(text);
  const box = h('div', { class: 'cs' });
  box.append(h('div', { class: 'cs-updated', text: updated ? '最後更新：' + updated : '最後更新：電腦沒寫時間' }));
  box.append(h('div', { class: 'cs-legend' }, h('span', { class: 'cs-chip done', text: '已定' }), h('span', { class: 'cs-chip pending', text: '待確認／還沒做' })));
  const md = mdBlock(body, 'md reportmd');
  let sec = null;
  for (const el of [...md.children]) {
    if (el.tagName === 'H2') {
      const kind = sectionKind(el.textContent);
      sec = h('section', { class: 'cs-sec' + (kind ? ' ' + kind : '') });
      if (kind) el.append(h('span', { class: 'cs-chip ' + kind, text: kind === 'done' ? '已定' : '待確認' }));
      md.insertBefore(sec, el);
    }
    if (sec) sec.append(el);
  }
  for (const b of md.querySelectorAll('strong')) if (/待確認|待做|待使用者|待你|尚未|還沒|未套用|未定|未查核|草稿/.test(b.textContent)) b.classList.add('cs-flag'); // 審查 #12：用完整詞，不誤標「期待」「未來」
  box.append(md);
  return box;
}
function viewReview() {
  const wrap = h('div');
  const path = review.path;
  const isCs = path === CONSENSUS_PATH;
  wrap.append(h('button', { class: 'btn ghost wide', type: 'button', text: isCs && !review.doc ? '‹ 回更多' : review.doc ? '‹ 回去' : '‹ 回去驗收', onclick: () => setTab(review.from || 'home') }));
  if (!path) { wrap.append(h('div', { class: 'empty', text: '沒有開啟的文件' })); return wrap; }
  if (!isCs) wrap.append(h('h3', { class: 'oc-title', text: review.title }));
  const t = review.texts[path], err = review.errs[path];
  if (t != null) wrap.append(isCs ? consensusBlock(t) : mdBlock(t, 'md reportmd'));
  else if (err && err !== '…') {
    wrap.append(h('div', { class: 'jstatus warn', text: '讀不到這份文件：' + err }));
    wrap.append(h('button', { class: 'btn wide', type: 'button', text: '再試一次', onclick: () => { delete review.errs[path]; loadReview(path); render(); } }));
  } else { loadReview(path); wrap.append(h('div', { class: 'empty', text: '讀取中…' })); }
  return wrap;
}

// 「還有問題…」：到聊天頁，輸入框預填「還有問題：」，送出時自動加 ↩o-編號｜ 前綴（引用列顯示「交辦：名稱」）
const PROBLEM_KEY = 'agent.p72problem';
// 防呆：o.work 為真的交辦目前畫面沒有「還有問題」入口（p72home.js buttons='work' 只顯示請到電腦處理），這裡帶 work/needs 是以後入口出現時的保險，不要刪
function startProblem(o) {
  state.quoteRef = { prefix: replyPrefix(o.id), label: '交辦：' + o.title, time: '', who: 'you', kind: 'order', work: !!o.work }; // 工作類交辦底下的「還有問題」自動帶 needs
  try { ls.setItem(PROBLEM_KEY, JSON.stringify({ prefix: state.quoteRef.prefix, label: state.quoteRef.label, work: state.quoteRef.work })); } catch (e) { /* 存不了就只在這次有效 */ }
  const pre = ORDER_TEXT.problem;
  const cur = getDraft('chat').trim();
  if (!cur) setDraft('chat', pre);
  else if (!cur.startsWith('還有問題')) setDraft('chat', pre + cur); // 草稿原本有字：放在「還有問題：」後面，不重複加
  setTab('chat');
}
// 重新整理或被系統回收後：草稿還在、前綴也要還原，不然送出去變成一般留言，電腦端不會當成「還有問題」
function restoreProblemRef() {
  let v = null;
  try { v = JSON.parse(ls.getItem(PROBLEM_KEY)); } catch (e) { v = null; }
  if (!v || !/^↩[ao]-[a-z0-9]{6}｜$/.test(String(v.prefix)) || typeof v.label !== 'string' || !getDraft('chat').trim()) { try { ls.removeItem(PROBLEM_KEY); } catch (e) { /* ignore */ } return; }
  state.quoteRef = { prefix: v.prefix, label: String(v.label).slice(0, 60), time: '', who: 'you', kind: 'order', work: v.work === true };
}
const dropProblemRef = () => { try { ls.removeItem(PROBLEM_KEY); } catch (e) { /* ignore */ } };

// 展開後的「收起」鈕：一次展開太長時，使用者要能收回去
const collapseBtn = (key, text) => h('button', { class: 'wc-more', type: 'button', 'aria-expanded': 'true', text: text || '收起 ‹', onclick: () => p72Toggle(key) });

function ordersSection(w, now) {
  const b = orderBoard(w.orders || [], { now, sends: p72Sends(), threads: homeThreads(), more: state.p72.sets.has('ordMore'), reviewMore: state.p72.sets.has('reviewMore') });
  if (!b.cards.length && !b.reviewN && !b.staleN) return null;
  const sec = h('section', { class: 'p72sec', 'aria-label': '你交辦、還沒真正完成' });
  const total = b.cards.length + b.reviewN;
  sec.append(h('div', { class: 'sechead' }, h('h2', { text: '你交辦、還沒真正完成' + (total ? '（' + total + '）' : '') })));
  sec.append(...b.shown.map((c) => orderCardEl(c, now)));
  if (b.hidden) sec.append(h('button', { class: 'wc-more', type: 'button', text: '還有 ' + b.hidden + ' 件 ›', onclick: () => p72Toggle('ordMore') }));
  else if (state.p72.sets.has('ordMore') && b.cards.length > ORDER_MAX) sec.append(collapseBtn('ordMore'));
  // 做完待你驗收：收成一行，點開才逐件列出（每件照舊有「OK，結案」「還有問題…」）
  if (b.reviewN) {
    const open = state.p72.sets.has('review');
    sec.append(h('button', { class: 'wc-more review', type: 'button', 'aria-expanded': open ? 'true' : 'false', text: '做完待你驗收 ' + b.reviewN + ' 件 ' + (open ? '⌄' : '›'), onclick: () => p72Toggle('review') }));
    if (open) {
      sec.append(...b.reviewShown.map((c) => orderCardEl(c, now)));
      if (b.reviewHidden) sec.append(h('button', { class: 'wc-more', type: 'button', text: '還有 ' + b.reviewHidden + ' 件 ›', onclick: () => p72Toggle('reviewMore') }));
      else if (state.p72.sets.has('reviewMore') && b.reviewN > REVIEW_MAX) sec.append(collapseBtn('reviewMore'));
    }
  }
  if (b.staleN) {
    const open = state.p72.sets.has('stale');
    sec.append(h('button', { class: 'wc-more stale', type: 'button', 'aria-expanded': open ? 'true' : 'false', text: STALE_DELIVERED_DAYS + ' 天以上沒驗收 ' + b.staleN + ' 件 ' + (open ? '⌄' : '›'), onclick: () => p72Toggle('stale') }));
    if (open) sec.append(...b.stale.map((c) => orderCardEl(c, now)));
  }
  return sec;
}

// 電腦狀態一行：燈＋一句＋N 分鐘前，點開才是 P71 的細節
function computerLine(p, w, now) {
  const cv = cardView(w, { now });
  const open = state.stOpen;
  const dv = detailView(w, { now });
  const bad = cv.lamp === 'orange' || !cv.remoteOn;
  const age = cv.level === 'fresh' ? cv.ageLabel + '更新' : cv.ageLabel;
  const text = bad ? cv.headline + '・' + cv.ageLabel : (cv.remoteOn ? '遠端開著' : '沒開遠端') + '・' + age + '・在跑 ' + cv.counts.run + ' 件';
  const box = h('section', { class: 'wcard wline lamp-' + cv.lamp, 'aria-label': '電腦現在的狀態' });
  box.append(h('button', { class: 'wc-head', type: 'button', 'aria-expanded': open ? 'true' : 'false', onclick: () => { state.stOpen = !state.stOpen; render(); } },
    h('span', { class: 'wc-lamp ' + cv.lamp + (cv.lamp === 'blue' && anyPulse(w, now) ? ' pulse' : ''), 'aria-hidden': 'true' }),
    h('span', { class: 'wc-title' }, h('span', { class: 'wc-age strong', text: text })),
    h('span', { class: 'chev', 'aria-hidden': 'true', text: open ? '⌄' : '›' })));
  if (cv.banner) box.append(h('div', { class: 'wc-banner ' + cv.banner.tone, role: 'status' }, h('span', { text: cv.banner.text }), cv.banner.ask ? h('button', { class: 'btn ghost small', type: 'button', text: '問' + AGENT_NAME, onclick: () => askAbout(null, 'ask') }) : null));
  if (open) box.append(wsOpenPanel(p, w, dv, cv));
  return box;
}

// 今天做完的清單（④ 的「今天做完 N 件」展開）
function doneSection(w) {
  if (!state.wsSec.done || !w.done.length) return null;
  const seenDone = new Set();
  return h('div', { class: 'wc-items p72sec', id: 'ws-sec-done' }, h('div', { class: 'wc-sec', text: '今天的結果（點一下看詳情）' }), ...w.done.map((d) => wsDoneRow(d, { seen: seenDone })));
}

function viewHomeV72(p, ws, rem) {
  const now = nowMs();
  if (state.pendingJob) applyPendingJob(ws);
  const wrap = h('div', { class: 'homepage v72' });
  const cb = cloudBanner(); if (cb) wrap.append(cb);
  const pb = pushBanner();
  if (pb) wrap.append(pb);
  wrap.append(computerLine(p, ws, now));
  const usage = cloudUsage(); if (usage) wrap.append(usage);
  const mineEl = mineLine();
  if (mineEl) wrap.append(mineEl);
  for (const sec of [asksSection(ws, now), runSection(ws, now), ordersSection(ws, now)]) if (sec) wrap.append(sec);
  const links = homeLinksRow(rem, ws);
  if (links) wrap.append(links);
  const done = doneSection(ws);
  if (done) wrap.append(done);
  wrap.append(quotaCompact(p));
  return wrap;
}

// ---------- 首頁（P72 快修）：狀態卡 →（你寫的 N 件電腦還沒收）→ ④ 一行入口 → 額度一行 ----------
// P66 的「現在先做這件」焦點卡與「接下來」清單拿掉（題目、任務各有主場，首頁只講工作現在怎麼了）；期限不能錯過，所以 ④ 留一行「有期限：…」。
function homeLinksRow(rem, w) {
  const qOpen = state.data ? derive().open.length : null;
  const links = homeLinks({ qCount: qOpen != null ? qOpen : (w && w.home ? w.home.qCount : null), doneCount: w ? w.done.filter((d) => d.ok).length : 0, deadline: deadlineLine(rem.rows), journal: journalLine(rem.rows) });
  if (!links.length) return null;
  const go = {
    q: () => { state.qtab = 'open'; setTab('todo'); },
    done: () => { state.wsSec.done = !state.wsSec.done; render(); if (state.wsSec.done) scrollToId('ws-sec-done'); },
    deadline: (l) => goReminder(l.target),
    journal: (l) => goReminder(l.target), // 日記入口：紀錄頁的日記
  };
  return h('div', { class: 'homelinks', role: 'group', 'aria-label': '其他入口' }, ...links.map((l) => {
    const isDone = l.key === 'done';
    const open = isDone && !!state.wsSec.done;
    return h('button', { class: 'hl-btn' + (l.key === 'deadline' ? ' warn' : ''), type: 'button', text: open ? l.text.replace(/ ›$/, ' ⌄') : l.text, 'aria-expanded': isDone ? (open ? 'true' : 'false') : null, onclick: () => go[l.key](l) });
  }));
}

// ---------- P74 R1～R3：五欄版（預設關；設定頁「首頁版面」選「五欄新版（試用）」，或網址 ?layout=five 臨時開）----------
// 純函式在 lib/five.js、lib/notices.js；這裡只畫畫面。關著時這一段完全不會被呼叫到（fiveOn() 為 false）。
const fiveOn = () => ['five', 'kanban'].includes(params.get('layout')) || ['five', 'kanban'].includes(curLayout());
const kanbanOn = () => params.get('layout') === 'kanban' || (params.get('layout') !== 'five' && curLayout() === 'kanban');
const KANBAN_TABS = ['home', 'record', 'chat', 'todo', 'reminders']; // 看板版：最右邊是提醒（使用者 11-07 m-6mh0wgnz：通知改成提醒，只放提醒事項）
const mainTabs = () => (kanbanOn() ? KANBAN_TABS : fiveOn() ? FIVE_TABS : MAIN_TABS);
const lsGet = (k) => { try { return ls.getItem(k); } catch (e) { return null; } };

// 五欄版的 push 跳轉：原本「工作做完／卡住」帶工作編號去首頁；五欄版改去通知頁。通知頁在開關關著時不存在，改回嘿嘿
function routePushTab(tab, job) {
  if (tab === 'notices' && kanbanOn()) return 'home'; // 看板版沒有通知頁，工作進度都在首頁
  if (tab === 'home' && job && fiveOn() && !kanbanOn()) return 'notices';
  if (tab === 'notices' && !fiveOn()) return 'chat';
  return tab;
}

// 看過紀錄（agent.noticeSeen，只留 7 天）
let seenMap = null;
function noticeSeen() {
  if (!seenMap) seenMap = parseSeen(lsGet(SEEN_KEY), nowMs());
  return seenMap;
}
function markNoticeSeen(id) {
  seenMap = markSeen(noticeSeen(), id, nowMs());
  try { ls.setItem(SEEN_KEY, JSON.stringify(seenMap)); } catch (e) { /* 存不了就只在這次有效 */ }
}

// 今天到期的提醒（定期＋一次性）
function dueRows() {
  if (!state.data) return [];
  try { const rd = reminderData(new Date(nowMs())); return dueToday(rd.routines, rd.reminds, rd.todayIso, { doneRoutines: doneRoutinesToday(rd.todayIso) }); } catch (e) { return []; }
}
function overdueRows() {
  if (!state.data) return [];
  try { return overdueOnce(reminderData(new Date(nowMs())).reminds); } catch (e) { return []; }
}
// 今天在手機打勾完成的定期提醒（名稱）：打勾後 Task.md 那筆已打勾、定期的下次日期還是今天，不記下來會一直列「今天到期」。只存記憶體，隔天自動作廢
const routineDone = { day: '', names: new Set() };
function doneRoutinesToday(todayIso) {
  if (routineDone.day !== todayIso) { routineDone.day = todayIso; routineDone.names = new Set(); }
  return routineDone.names;
}
function markRoutineDone(t) {
  try {
    const rd = reminderData(new Date(nowMs()));
    const hit = rd.routines ? [...rd.routines.you, ...rd.routines.auto].find((r) => r.pend.some((x) => x.key === t.key)) : null;
    if (hit) doneRoutinesToday(rd.todayIso).add(hit.name);
  } catch (e) { /* 記不起來就維持原樣 */ }
}
function noticeModel() {
  return buildNotices({ ws: usableWs(), reminders: [...dueRows(), ...overdueRows()], seen: noticeSeen(), now: nowMs() });
}

// 首頁與問答共用的「要你」資料；wantMore＝全部列出
function fiveModel(w, extra = {}) {
  const now = nowMs();
  const projects = state.data ? splitProjects(allProjects(state.data.project || '')) : { work: [], personal: [] };
  return fiveHome(w, { now, sends: p72Sends(), threads: homeThreads(), jobWaits: waitList(w, { now, sources: ['job'] }), projectCount: projects.work.length + projects.personal.length, dueRows: dueRows(), runMore: state.p72.sets.has('run5More'), ...extra });
}

// 看板和聊天室共用同一份提問與本機回答狀態，不新增讀取或送出管道。
function kanbanModel(w = usableWs()) {
  return buildBoard({ ws: w, tasks: taskInfo().tasks, projects: allProjects(state.data.project || ''), sends: p72Sends(), now: nowMs() });
}
let kanbanColumn = null;
const kanbanOldOpen = new Set();
// 在跑卡上次畫的進度（m-acjp0g8a「我喜歡進度跳」）：輪詢到新進度時，條子從舊長度延伸到新長度、步數跳一下
const kanbanRunSeen = new Map();
function runBlock(c) {
  const r = c.run;
  const prev = kanbanRunSeen.get(c.key);
  const sig = [r.step, r.steps, r.text, r.mode].join('|');
  const moved = !!prev && prev.sig !== sig;
  kanbanRunSeen.set(c.key, { sig, pct: r.pct });
  const fill = h('i');
  const bar = h('div', { class: 'kb-bar ' + r.mode, role: 'progressbar', 'aria-label': '工作進度：' + r.label, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': r.pct == null ? null : String(r.pct) }, fill);
  if (r.pct != null) {
    const from = moved && prev.pct != null && !reduceMotion() ? prev.pct : r.pct;
    fill.style.width = from + '%';
    if (from !== r.pct) requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = r.pct + '%'; }));
  }
  const head = h('div', { class: 'kb-runhead' }, h('span', { class: 'kb-step' + (moved ? ' bump' : ''), text: r.label }), r.text ? h('span', { class: 'kb-steptext', text: r.text }) : null);
  const foot = [r.ago, r.late].filter(Boolean).join('｜');
  return h('div', { class: 'kb-run' + (moved ? ' moved' : '') }, head, bar, foot ? h('div', { class: 'kb-runfoot' + (r.late ? ' late' : ''), text: foot }) : null);
}
// P74：首頁最上面一行「不能忘 N 件，最近的還有 X 天 ›」，點了到提醒頁；沒有標 #重要 的就不顯示
function mustHomeLine() {
  if (!state.data) return null;
  const rd = reminderData(new Date());
  const text = mustLine(mustNotForget(rd.tasks, rd.todayIso, rd.routines, rd.settings));
  if (!text) return null;
  return h('button', { class: 'morelink mustline', type: 'button', onclick: () => setTab('reminders') }, h('span', { text }), h('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }));
}

function viewHomeKanban(p, ws) {
  const m = kanbanModel(ws);
  const wrap = h('div', { class: 'kanban-home' });
  const must = mustHomeLine(); if (must) wrap.append(must);
  const ob = ws ? orderBoard(ws.orders || [], { now: nowMs(), sends: p72Sends(), threads: homeThreads(), more: true, reviewMore: true }) : null;
  const orderCards = new Map(ob ? [...ob.cards, ...ob.review, ...ob.stale].map((c) => [c.order.id, c]) : []);
  if (!ws) wrap.append(h('div', { class: 'hint kb-status', text: '工作狀態暫時讀不到，先顯示任務與專案。' }));
  if (m.unknownCount) wrap.append(h('div', { class: 'hint kb-status', text: m.unknownCount + ' 個視窗狀態不明' }));
  const pcl = pcModeLine(workStatus(), nowMs()); // 審查 #11：狀態檔超過 12 小時也要顯示「電腦離線」，不用 usableWs 過濾 // o-8lx1rc：電腦遠端中／電腦前／待命／離線＋資料更新時間
  if (pcl) wrap.append(h('div', { class: 'hint kb-status kb-pc' + (pcl.tone ? ' ' + pcl.tone : ''), 'data-mode': pcl.key, text: pcl.text }));
  const queue = fiveQueueLine(); if (queue) wrap.append(queue);
  const tabs = h('div', { class: 'kb-tabs', role: 'tablist', 'aria-label': '看板欄位' });
  const board = h('div', { class: 'kb-board', 'aria-label': '左右滑動看板' });
  const cols = [];
  const btns = [];
  const mark = (i) => {
    kanbanColumn = m.columns[i].key;
    btns.forEach((b, n) => { b.classList.toggle('on', n === i); b.setAttribute('aria-selected', n === i ? 'true' : 'false'); b.setAttribute('tabindex', n === i ? '0' : '-1'); });
  };
  const go = (i) => {
    board.scrollLeft = cols[i].offsetLeft - 12;
    mark(i);
  };
  m.columns.forEach((col, i) => {
    const btn = h('button', { class: 'kb-tab' + (col.key === 'waiting' ? ' me' : ''), type: 'button', role: 'tab', id: 'kb-tab-' + col.key,
      'aria-controls': 'kb-col-' + col.key, 'aria-label': col.label + '，' + col.cards.length + ' 件', onclick: () => go(i),
      onkeydown: (e) => { const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (step) { e.preventDefault(); const next = (i + step + 5) % 5; go(next); btns[next].focus(); } } },
      h('b', { text: String(col.cards.length) }), h('span', { text: col.label }));
    btns.push(btn); tabs.append(btn);
    const panel = h('section', { class: 'kb-col', id: 'kb-col-' + col.key, role: 'tabpanel', 'aria-labelledby': 'kb-tab-' + col.key });
    if (!col.cards.length && !col.old.length) panel.append(h('div', { class: 'kb-empty', text: col.key === 'doing' ? '現在沒有工作在跑。' : col.key === 'todo' ? '現在沒有要你回電腦旁才能做的事。' : '這欄目前沒有項目。' }));
    const cardEl = (c) => {
      const oc = orderCards.get(c.key);
      if (oc && !c.accepted && (oc.state === 'delivered' || oc.state === 'candidate')) return h('article', { class: 'kb-card kb-order', 'data-card': c.key }, orderCardEl(oc, nowMs(), { compact: true }));
      const card = h('article', { class: 'kb-card', 'data-card': c.key });
      card.append(h('div', { class: 'kb-meta' }, h('span', { class: 'kb-kind', text: c.type === 'question' ? '要定' : '任務' }),
        c.pid ? h('button', { class: 'kb-pid', type: 'button', text: c.pid, 'aria-label': '看專案 ' + c.pid, onclick: () => openKanbanProject(c.pid) }) : null), h('div', { class: 'kb-title', text: c.title }));
      if (c.sub) card.append(h('div', { class: 'kb-sub' + (col.key === 'waiting' && c.type !== 'question' ? ' stop' : ''), text: c.sub }));
      // 等電腦卡固定三行（m-wgw1mhv9）：要你做什麼／為什麼要在電腦前／預估多久；電腦沒寫的那行顯示「—」
      if (c.pc) card.append(linkDocsIn(h('dl', { class: 'kb-pcneed' }, ...[['要你做', c.pc.what], ['為什麼要在電腦前', c.pc.why], ['預估', c.pc.eta]]
        .flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v || '—' })]))));
      if (c.run) card.append(runBlock(c));
      else if (c.progress != null) card.append(h('progress', { class: 'kb-progress', value: c.progress, max: 100, 'aria-label': '工作進度' }));
      for (const a of c.asks) card.append(askCardEl(a, nowMs()));
      if (c.type === 'question') card.append(h('button', { class: 'pc-link', type: 'button', text: '到問答頁 ›', onclick: () => { state.qShowOther = true; state.qtab = 'open'; state.openQ = c.key.slice('question:'.length); setTab('todo'); } }));
      if (c.undo) card.append(h('button', { class: 'btn ghost small', type: 'button', text: '還原', onclick: () => sendReply(c.key, ORDER_TEXT.problem + UNDO_TEXT, '已送出還原，電腦會放回待驗收') }));
      return card;
    };
    for (const c of col.cards.slice(0, KANBAN_COLUMN_MAX)) panel.append(cardEl(c));
    if (col.cards.length > KANBAN_COLUMN_MAX) panel.append(h('div', { class: 'kb-empty', text: '還有 ' + (col.cards.length - KANBAN_COLUMN_MAX) + ' 件沒列出，到「更多 → 專案」看。' }));
    if (col.old.length) {
      const old = h('details', { class: 'kb-old' }, h('summary', { text: col.key === 'done' ? '更早跑完的 ' + col.old.length + ' 件' : '很久沒有回報的 ' + col.old.length + ' 件' }), ...col.old.slice(0, KANBAN_COLUMN_MAX).map(cardEl));
      old.open = kanbanOldOpen.has(col.key);
      old.addEventListener('toggle', () => { if (old.open) kanbanOldOpen.add(col.key); else kanbanOldOpen.delete(col.key); });
      panel.append(old);
    }
    if (col.key === 'doing' && m.idle.length) {
      const d = h('details', { class: 'kb-old kb-idle' }, h('summary', { text: '擱著 ' + m.idle.length + ' 件（超過 2 小時沒有進度）' }), ...m.idle.slice(0, KANBAN_COLUMN_MAX).map(cardEl));
      d.open = kanbanOldOpen.has('idle');
      d.addEventListener('toggle', () => { if (d.open) kanbanOldOpen.add('idle'); else kanbanOldOpen.delete('idle'); });
      panel.append(d);
    }
    if (col.key === 'doing' && m.windows.length) {
      const d = h('details', { class: 'kb-old kb-wins' }, h('summary', { text: '另外 ' + m.windows.length + ' 個視窗在忙（沒有登記工作）' }), ...m.windows.slice(0, KANBAN_COLUMN_MAX).map(cardEl));
      d.open = kanbanOldOpen.has('windows');
      d.addEventListener('toggle', () => { if (d.open) kanbanOldOpen.add('windows'); else kanbanOldOpen.delete('windows'); });
      panel.append(d);
    }
    if (col.key === 'doing' && m.queue.length) {
      const q = h('details', { class: 'kb-old kb-queue' }, h('summary', { text: '排隊中 ' + m.queue.length + ' 件（還沒開工、要你確認是不是交辦、或在等別的事）' }), ...m.queue.slice(0, KANBAN_COLUMN_MAX).map(cardEl));
      q.open = kanbanOldOpen.has('queue');
      q.addEventListener('toggle', () => { if (q.open) kanbanOldOpen.add('queue'); else kanbanOldOpen.delete('queue'); });
      panel.append(q);
    }
    cols.push(panel); board.append(panel);
  });
  board.addEventListener('scroll', () => {
    let nearest = 0, distance = Infinity;
    cols.forEach((c, i) => { const d = Math.abs(c.offsetLeft - 12 - board.scrollLeft); if (d < distance) { distance = d; nearest = i; } });
    mark(nearest);
  }, { passive: true });
  wrap.append(tabs, board);
  const quota = h('section', { class: 'kb-quota', 'aria-label': '額度' },
    h('div', { class: 'kb-qrow kb-qhead' }, h('span', { text: '額度' }), h('span', { text: '5 小時' }), h('span', { text: '本週' }), h('span', { text: '更新' })));
  for (const r of quotaTable([{ name: 'AI Agent', q: fiveQuotaA(p) }, { name: ((quotaBRaw(p) && quotaBRaw(p).label) || (pcState() && pcState().quotaB && pcState().quotaB.label) || '個人').replace(/（.*）$/, ''), q: quotaBRaw(p) }], nowMs())) {
    quota.append(h('div', { class: 'kb-qrow' + (r.stale ? ' stale' : '') }, h('b', { text: r.name }),
      h('span', { class: r.h5.tone, text: r.h5.text }), h('span', { class: r.d7.tone, text: r.d7.text }), h('span', { class: 'kb-qat', text: r.at })));
  }
  wrap.append(quota);
  const selected = m.columns.findIndex((c) => c.key === (kanbanColumn || m.initialColumn));
  mark(selected);
  requestAnimationFrame(() => { if (board.isConnected) go(selected); });
  return wrap;
}
function openKanbanProject(pid) {
  const pr = allProjects(state.data.project || '').find((p) => p.pid === pid);
  if (pr) openProject(pr); else setTab('projects');
}
function kanbanChatAsks() {
  const asks = kanbanModel().chatAsks;
  return asks.length ? h('section', { class: 'kb-chat-asks', 'aria-label': '工作停住，等你回答' },
    h('div', { class: 'kb-sub stop', text: '工作停住，等你回答。' }), ...asks.map((a) => askCardEl(a, nowMs()))) : null;
}
// Questions.md 還沒答的題：今日必答、其他待答（問答頁與底欄數字共用，口徑只有這一個）
function todoOpenSplit() {
  if (!state.data) return { today: [], others: [] };
  const open = currentCards().filter((c) => qtabOf(cst(c), { kept: state.keepQ.has(c.qid) }) === 'open');
  const isToday = (c) => c.today && !c.backlog;
  return { today: open.filter(isToday), others: open.filter((c) => !isToday(c)) };
}
// 五欄與看板版面的問答頁只放知識確認；其他題收成一行，按了才展開，不會看不到。舊版面照舊全列
// 帶期限的非知識題（m-pp588fvx）：不進首頁看板「等我」，改放問答頁最上面「有期限」，一律顯示、不收起來
const isDueQuestion = (c) => !!c.deadline && hasDeadline(c.deadline) && !isKnowledgeQuestion(c);
function todoVisibleSplit() {
  const sp = todoOpenSplit();
  if (!fiveOn()) return { ...sp, due: [], hidden: 0 };
  const due = [...sp.today, ...sp.others].filter(isDueQuestion);
  const rest = (list) => list.filter((c) => !isDueQuestion(c));
  if (state.qShowOther) return { today: rest(sp.today), others: rest(sp.others), due, hidden: 0 };
  const all = sp.today.length + sp.others.length;
  const today = sp.today.filter(isKnowledgeQuestion), others = sp.others.filter(isKnowledgeQuestion);
  return { today, others, due, hidden: all - today.length - others.length - due.length };
}
// 要你決定的件數＝畫面上看得到的所有待答：擋著工作的提問＋待驗收＋候選交辦＋今日必答＋其他待答（底欄問答的藍色數字、嘿嘿的「有 N 件要你決定」）。7 天以上沒驗收的收合起來，不算
function decisionCount() {
  const w = usableWs();
  const sp = todoVisibleSplit();
  return todoOpenCount(w && !kanbanOn() ? fiveModel(w, { wantMore: true }).todo : null, sp.today.length + sp.due.length, sp.others.length);
}

// ---------- 底欄 ----------
const tabLastBtn = () => $('tabs').lastElementChild; // 最右邊那顆：關著＝任務、五欄版＝通知
const tabOrig = { ico: null, lbl: '', qlbl: '' };
function bdg(cls, n) {
  const t = badgeText(n);
  return t ? h('span', { class: 'bdg ' + cls, text: t, 'aria-hidden': 'true' }) : null;
}
function paintFiveTabs(five) {
  const last = tabLastBtn();
  const qbtn = document.querySelector('#tabs button[data-tab="todo"]');
  if (!last || !qbtn) return;
  const ico = last.querySelector('.ico');
  const lbl = last.querySelector('.lbl');
  const qlbl = qbtn.querySelector('.lbl');
  for (const old of document.querySelectorAll('#tabs .bdg')) old.remove();
  if (!five) {
    if (last.dataset.tab === 'notices' || last.dataset.tab === 'reminders') { // 關掉開關：換回任務
      last.dataset.tab = 'tasks';
      if (tabOrig.ico) ico.replaceChildren(tabOrig.ico.cloneNode(true));
      lbl.firstChild.textContent = tabOrig.lbl;
      last.setAttribute('aria-label', '任務');
      if (tabOrig.qlbl) qlbl.firstChild.textContent = tabOrig.qlbl;
    }
    return;
  }
  if (last.dataset.tab === 'tasks') {
    tabOrig.ico = ico.firstElementChild ? ico.firstElementChild.cloneNode(true) : null;
    tabOrig.lbl = lbl.firstChild.textContent; // 只取文字節點（旁邊可能有舊版的橘色數字）
    tabOrig.qlbl = qlbl.firstChild.textContent;
    const bell = icon(document, 'bell');
    if (bell) ico.replaceChildren(bell);
  }
  const kb = kanbanOn(); // 看板版最右邊是提醒，五欄舊版仍是通知
  const lastName = kb ? '提醒' : '通知';
  last.dataset.tab = kb ? 'reminders' : 'notices';
  lbl.firstChild.textContent = lastName;
  qlbl.firstChild.textContent = '問答';
  for (const old of qlbl.querySelectorAll('.count')) old.remove(); // 五欄版的數字在圖示上，不再是文字旁的橘色
  for (const old of lbl.querySelectorAll('.count')) old.remove();
  let nq = 0; let nn = 0;
  if (state.data && !state.locked) { try { nq = decisionCount(); if (kb) { const rd = reminderData(); nn = mustNotForget(rd.tasks, rd.todayIso, rd.routines, rd.settings).length; } else nn = noticeModel().unread; } catch (e) { /* 數字算不出來就不顯示 */ } }
  qbtn.setAttribute('aria-label', nq ? '問答，' + nq + ' 件要你決定' : '問答');
  last.setAttribute('aria-label', nn ? lastName + (kb ? '，不能忘 ' + nn + ' 件' : '，' + nn + ' 則未讀') : lastName);
  const bq = bdg('q', nq); if (bq) qbtn.querySelector('.ico').append(bq);
  const bn = bdg('n', nn); if (bn) ico.append(bn);
  // m-ola0f1nt：嘿嘿分頁顯示沒看過的回覆數（真的出現在畫面上才算看過，進聊天頁不會直接歸零）
  let nc = 0;
  try { nc = unseenReplies().length; } catch (e) { nc = 0; }
  const cbtn = document.querySelector('#tabs button.center');
  const bc = bdg('c', nc);
  if (cbtn && bc) cbtn.querySelector('.cico').append(bc);
  if (cbtn) cbtn.setAttribute('aria-label', '開啟' + AGENT_NAME + (nc ? '，' + nc + ' 則新回覆' : ''));
}

// ---------- 首頁 viewHomeV75 ----------
function fiveTopLine(p, w, now) {
  const cv = cardView(w, { now });
  const text = cv.frozen || cv.lamp === 'orange' ? cv.headline : (cv.remoteOn ? '在線' : '沒開遠端') + '・' + cv.ageLabel;
  const bad = cv.lamp === 'orange';
  // 雲端橫幅、推播橫幅、「N 件沒送出」不再各佔一行：有事才在右側出現一顆小點，點了展開
  const alerts = [cloudBanner(), pushBanner(), mineLine()].filter(Boolean);
  const open = state.stOpen;
  const ql = [quotaLine(fiveQuotaA(p), nowMs(), quotaAName()), quotaLine(quotaBRaw(p), nowMs(), (quotaBRaw(p) && quotaBRaw(p).label) || (pcState() && pcState().quotaB && pcState().quotaB.label) || '個人')].filter(Boolean);
  const row = h('div', { class: 'v75top' },
    h('button', { class: 'v75st' + (bad ? ' bad' : ''), type: 'button', 'aria-expanded': open ? 'true' : 'false', onclick: () => { state.stOpen = !state.stOpen; render(); } },
      h('span', { class: 'wc-lamp ' + cv.lamp, 'aria-hidden': 'true' }), h('span', { text })),
    alerts.length ? h('button', { class: 'v75alert', type: 'button', 'aria-label': '有 ' + alerts.length + ' 則提醒，點了展開', onclick: () => { state.stOpen = !state.stOpen; render(); } }, h('span', { 'aria-hidden': 'true', text: '●' })) : null,
    ql.length ? h('button', { class: 'v75q', type: 'button', 'aria-expanded': state.qOpen ? 'true' : 'false', 'aria-label': '額度，點開看讀取時間', onclick: () => { state.qOpen = !state.qOpen; render(); } },
      ...ql.flatMap((x, i) => [i ? h('span', { class: 'v75qsep', 'aria-hidden': 'true', text: '｜' }) : null, h('span', { class: 'v75qv' + (x.stale ? ' stale' : ''), text: x.text })].filter(Boolean))) : null);
  const box = h('div', { class: 'v75topwrap' }, row);
  if (state.qOpen && ql.length) {
    box.append(h('div', { class: 'v75panel v75qpanel' },
      ...ql.map((x) => h('div', { class: 'v75qrow' + (x.stale ? ' stale' : '') }, h('b', { text: x.label }), h('span', { text: x.parts.map((y) => y.text).join('　') }), h('span', { class: 'v75sub', text: (x.readText || '沒有讀取時間') + (x.stale ? '　過時' : '') }))),
      h('button', { class: 'btn ghost small', type: 'button', text: '健康狀態 ›', onclick: () => setTab('health') })));
  }
  if (open) box.append(h('div', { class: 'v75panel' }, ...alerts, wsOpenPanel(p, w, (() => { const dv = detailView(w, { now }); return { ...dv, unknown: dv.unknown.filter((u) => !u.compat) }; })(), cv)));
  return box;
}

function fiveSecHead(title, n, right) {
  return h('div', { class: 'v75head' }, h('h2', {}, h('span', { text: title }), n != null ? h('small', { text: ' ' + n }) : null), right || null);
}

function fiveRunRow(r, now) {
  if (r.auto) return h('div', { class: 'v75runwrap' }, h('div', { class: 'v75run static' }, h('span', { class: 'v75r1' }, h('b', { text: r.name })), h('span', { class: 'v75r2', text: r.nowText })));
  const key = 'r:' + (r.item.id || r.item.name);
  const open = state.wsExp.has(key);
  const sub = [r.who, r.elapsed, r.etaText].filter(Boolean).join('・');
  const btn = h('button', { class: 'v75run' + (r.orange ? ' orange' : ''), type: 'button', 'aria-expanded': open ? 'true' : 'false', onclick: () => wsToggle(key) },
    h('span', { class: 'v75r1' }, h('b', { text: r.name }), h('span', { class: 'v75sub', text: sub + (open ? ' ⌄' : ' ›') })),
    r.nowText ? h('span', { class: 'v75r2', text: r.nowText }) : null);
  return h('div', { class: 'v75runwrap' }, btn, open ? wsDetailPanel(key, runDetail(r.item, r.view, now), { from: r.item.from }) : null);
}
function fiveListRow(it, sub) {
  return h('div', { class: 'v75li' }, h('b', { text: it.name || it.title }), sub ? h('span', { class: 'v75sub', text: sub }) : null);
}

// 五欄首頁的「你寫的」一行：失敗、等加密通道、等送出分開算；點了到對話頁（排隊、失敗的留言在那裡可以再試或刪除）
function fiveQueueLine() {
  const c = outboxCounts(state.ob);
  const work = workQueuedCount(state.ob);
  const plain = c.queued - work;
  const bits = [];
  if (c.failed) bits.push('⚠ ' + c.failed + ' 件沒送出');
  if (work) bits.push('🔒 等加密通道 ' + work + ' 件');
  if (plain > 0) bits.push('⏳ 等送出 ' + plain + ' 件');
  if (!bits.length) return null;
  const hasChat = state.ob.some((x) => x.kind === 'chat' && (x.state === 'queued' || x.state === 'failed'));
  return h('button', { class: 'mineline v75queue' + (c.failed ? ' bad' : ''), type: 'button', onclick: () => { if (c.failed && !hasChat) state.mfilter = 'failed'; setTab(hasChat ? 'chat' : 'mine'); } },
    h('span', { text: bits.join('　') }), h('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }));
}

function viewHomeV75(p, ws, rem) {
  void rem;
  const now = nowMs();
  const m = fiveModel(ws);
  const wrap = h('div', { class: 'homepage v75' });
  wrap.append(fiveTopLine(p, ws, now));
  const ql = fiveQueueLine(); if (ql) wrap.append(ql); // 排隊、失敗的件數（五欄首頁把底部膠囊藏起來了，這裡補上）
  // 要你：沒有就整格收掉
  if (m.wants.total) {
    const sec = h('section', { class: 'v75sec', 'aria-label': '要你' }, fiveSecHead('要你', m.wants.total));
    sec.append(...m.wants.shown.map((x) => (x.type === 'ask' ? askCardEl(x.card, now) : orderCardEl(x.card, now))));
    if (m.wants.hidden) sec.append(h('button', { class: 'wc-more', type: 'button', text: '還有 ' + m.wants.hidden + ' 件要你 ›', onclick: () => { state.qtab = 'open'; setTab('todo'); } }));
    wrap.append(sec);
  }
  // 在跑
  const run = h('section', { class: 'v75sec', 'aria-label': '在跑' }, fiveSecHead('在跑', m.run.total || null));
  if (!m.run.total) run.append(h('div', { class: 'v75empty', text: '沒有在跑的工作' }));
  else {
    run.append(...m.run.rows.map((r) => fiveRunRow(r, now)));
    if (m.run.hidden) run.append(h('button', { class: 'wc-more', type: 'button', text: '還有 ' + m.run.hidden + ' 件在跑 ›', onclick: () => p72Toggle('run5More') }));
    else if (state.p72.sets.has('run5More') && m.run.total > RUN_MAX_FIVE) run.append(collapseBtn('run5More'));
  }
  wrap.append(run);
  // 剛做完
  const dopen = !!state.wsSec.done;
  const done = h('section', { class: 'v75sec', 'aria-label': '剛做完' }, fiveSecHead('剛做完', null,
    m.done.total ? h('button', { class: 'v75more', type: 'button', 'aria-expanded': dopen ? 'true' : 'false', text: '今天 ' + m.done.total + (dopen ? ' ⌄' : ' ›'), onclick: () => { state.wsSec.done = !state.wsSec.done; render(); } }) : null));
  if (!m.done.total) done.append(h('div', { class: 'v75empty', text: '今天還沒做完任何事' }));
  else if (!dopen) { // 展開「今天 N」後，下面有完整清單（同一份詳情面板），上面這幾列就不重複畫，免得同一個 DOM id 出現兩次
    for (const r of m.done.rows) {
      const key = 'd:' + (r.d.id || r.d.name);
      const open = state.wsExp.has(key);
      done.append(h('div', { class: 'v75runwrap' },
        h('button', { class: 'v75done', type: 'button', 'aria-expanded': open ? 'true' : 'false', onclick: () => wsToggle(key) },
          h('span', { text: (r.ok ? '✓ ' : '✗ ') + r.time + ' ' + r.d.name }), h('span', { class: 'v75sub', 'aria-hidden': 'true', text: open ? '⌄' : '›' })),
        open ? wsDetailPanel(key, doneDetail(r.d, now), { from: r.d.from }) : null));
    }
  }
  wrap.append(done);
  const dsec = doneSection(ws);
  if (dsec) wrap.append(dsec);
  // 入口列
  if (m.links.length) {
    const lists = { parked: m.parked, schedules: m.schedules, unstarted: m.unstarted.map((x) => ({ name: x.order.title, said: x.said })), mine: m.mine };
    const sub = { parked: (it) => [it.who, it.parkReason, it.reason].filter(Boolean).join('・'), schedules: (it) => [it.who, it.etaMs != null ? '預計 ' + clockText(it.etaMs) : ''].filter(Boolean).join('・'), unstarted: (u) => (u.said ? '你說：' + u.said.text : ''), mine: (it) => [it.who, it.etaMs != null ? '預計 ' + clockText(it.etaMs) : ''].filter(Boolean).join('・') };
    const go = { projects: () => setTab('projects'), due: () => setTab('reminders') };
    const bar = h('div', { class: 'v75links', role: 'group', 'aria-label': '其他入口' }, ...m.links.map((l) => {
      const exp = !go[l.key];
      const open = exp && state.p72.sets.has('f:' + l.key);
      return h('button', { class: 'v75lnk' + (l.strong ? ' key' : ''), type: 'button', 'aria-expanded': exp ? (open ? 'true' : 'false') : null, text: open ? l.text.replace(/ ›$/, ' ⌄') : l.text, onclick: () => (exp ? p72Toggle('f:' + l.key) : go[l.key]()) });
    }));
    wrap.append(bar);
    for (const k of ['mine', 'parked', 'schedules', 'unstarted']) {
      if (!state.p72.sets.has('f:' + k) || !lists[k].length) continue;
      wrap.append(h('div', { class: 'v75list' }, ...lists[k].map((it) => fiveListRow(it, sub[k](it)))));
    }
    if (state.p72.sets.has('f:pending') && m.pending.total) wrap.append(h('div', { class: 'v75pend' }, ...m.pending.cards.map((c) => orderCardEl(c, now))));
  }
  return wrap;
}

// ---------- 問答 viewTodoV75：擋著工作 → 待驗收 → 今日必答（其他待答排在最後，才不會有題目找不到入口） ----------
function viewTodoV75(p) {
  const cards = currentCards(p);
  const tabOf = (c) => qtabOf(cst(c), { kept: state.keepQ.has(c.qid) });
  const w = usableWs();
  // 看板版：驗收、候選、擋工作的提問都在首頁看板，問答頁只放題目（使用者 11-07 m-c2og1cdu）
  const m = w && !kanbanOn() ? fiveModel(w, { wantMore: true }) : null;
  const askItems = m ? m.wants.shown.filter((x) => x.type === 'ask') : [];
  const orderItems = m ? m.wants.shown.filter((x) => x.type === 'order') : [];
  const candItems = m ? m.pending.cards.filter((c) => c.order.state === 'candidate') : []; // 我猜這是你交辦的事？（是／不是）
  const staleItems = m ? m.stale : [];
  const sp = todoVisibleSplit();
  const today = sp.today;
  const others = sp.others;
  const due = sp.due;
  // 「待答 N」＝畫面上看得到的所有待答（跟底欄藍色數字同一個函式）
  const nOpen = todoOpenCount(m ? m.todo : null, today.length + due.length, others.length);
  const nDone = cards.filter((c) => tabOf(c) === 'done').length;
  const wrap = h('div', { class: 'todopage v75todo' });
  qlinks = { proj: projectsByQid(allProjects(state.data.project || ''), cards), tasks: taskInfo().tasks };
  if (state.openQ === undefined) { const first = state.qtab === 'open' ? today.find((c) => cst(c) === 'open') : null; state.openQ = first ? first.qid : null; }
  const tabs = h('div', { class: 'chips qtabs', role: 'group', 'aria-label': '待答或已答' });
  for (const [k, label] of [['open', '待答 ' + nOpen], ['done', '已答 ' + nDone]]) {
    tabs.append(h('button', { class: 'chip' + (state.qtab === k ? ' active' : ''), type: 'button', text: label, 'aria-pressed': state.qtab === k ? 'true' : 'false', onclick: () => { state.qtab = k; state.keepQ.clear(); render(); } }));
  }
  wrap.append(h('div', { class: 'chipwrap' }, tabs));
  const now = nowMs();
  if (state.qtab === 'done') {
    const list = cards.filter(inTodoTab);
    if (!list.length) wrap.append(h('div', { class: 'empty', text: '還沒有已答的題目' }));
    for (const g of splitGroups(list)) {
      wrap.append(h('div', { class: 'group-title', text: g.label }));
      for (const c of g.cards) wrap.append(questionCard(c, cst(c)));
    }
    return wrap;
  }
  if (askItems.length) { wrap.append(h('div', { class: 'group-title', text: '擋著工作' })); for (const x of askItems) wrap.append(askCardEl(x.card, now)); }
  if (orderItems.length) { wrap.append(h('div', { class: 'group-title', text: '待驗收' })); for (const x of orderItems) wrap.append(orderCardEl(x.card, now)); }
  if (candItems.length) { wrap.append(h('div', { class: 'group-title', text: '待確認' })); for (const c of candItems) wrap.append(orderCardEl(c, now)); }
  if (due.length) { wrap.append(h('div', { class: 'group-title', text: '有期限，要你決定' })); for (const c of due) wrap.append(questionCard(c, cst(c))); }
  if (today.length) { wrap.append(h('div', { class: 'group-title', text: '今日必答' })); for (const c of today) wrap.append(questionCard(c, cst(c))); }
  if (others.length) {
    wrap.append(h('div', { class: 'group-title', text: '其他待答（' + others.length + '）' }));
    for (const g of splitGroups(others)) for (const c of g.cards) wrap.append(questionCard(c, cst(c)));
  }
  if (sp.hidden > 0) wrap.append(h('button', { class: 'pc-link', type: 'button', text: '另有 ' + sp.hidden + ' 件其他題目 ›', onclick: () => { state.qShowOther = true; render(); } }));
  if (staleItems.length) { // 7 天以上沒驗收：不算待答、不佔首頁名額，收在最下面
    const open = state.p72.sets.has('stale5');
    wrap.append(h('button', { class: 'wc-more stale', type: 'button', 'aria-expanded': open ? 'true' : 'false', text: '7 天以上沒驗收 ' + staleItems.length + ' 件 ' + (open ? '⌄' : '›'), onclick: () => p72Toggle('stale5') }));
    if (open) for (const c of staleItems) wrap.append(orderCardEl(c, now));
  }
  if (!askItems.length && !orderItems.length && !candItems.length && !due.length && !today.length && !others.length && !staleItems.length) wrap.append(h('div', { class: 'empty', text: COPY.qAllDone }));
  return wrap;
}

// ---------- 通知 viewNotices ----------
const NOTICE_KIND = { stuck: ['卡住', 'k-bad'], stale: ['過時', 'k-bad'], done: ['完成', 'k-ok'], remind: ['提醒', 'k-rem'] }; // 要跟 lib/notices.js 產生的 kind 一一對上（test/p74five3.test.js 鎖住）
function openNotice(n) {
  markNoticeSeen(n.id);
  const t = n.target || {};
  if (t.type === 'todo') { state.qtab = 'open'; setTab('todo'); return; }
  if (t.type === 'job') {
    const w = usableWs();
    const jt = w ? jobTarget(w, t.id) : null; // 找不到（問題已解決、檔案換了）就只回首頁
    if (jt) {
      state.wsExp.add(jt.key);
      if (jt.sec === 'done') state.wsSec.done = true;
      if (jt.sec === 'run') state.p72.sets.add('run5More');
      requestAnimationFrame(() => requestAnimationFrame(() => { const el = document.getElementById(wsDomId(jt.key)); if (el) el.scrollIntoView({ block: 'center', behavior: scrollBehavior() }); }));
    }
    setTab('home');
    return;
  }
  render();
}
function viewNotices() {
  const wrap = h('div', { class: 'noticepage' });
  wrap.append(h('div', { class: 'v75nhead' }, h('b', { text: '通知' }), h('button', { class: 'v75go', type: 'button', text: '所有提醒 ›', onclick: () => setTab('reminders') })));
  const nm = noticeModel();
  if (!nm.items.length) { wrap.append(h('div', { class: 'empty', text: '目前沒有新通知' })); return wrap; }
  const todayIso = isoOf(new Date(nowMs()));
  const groups = [['今天', nm.items.filter((x) => isoOf(new Date(x.at)) === todayIso)], ['更早', nm.items.filter((x) => isoOf(new Date(x.at)) !== todayIso)]];
  for (const [label, list] of groups) {
    if (!list.length) continue;
    wrap.append(h('div', { class: 'sec v75nsec', text: label }));
    for (const n of list) {
      const [kindText, kindCls] = NOTICE_KIND[n.kind];
      const time = n.kind === 'remind' ? '' : '　' + clockText(n.at);
      const body = h('div', { class: 'bd' }, h('span', { class: 'bdt', text: n.title + time }));
      const mark = h('i', { class: n.unread ? 'unread' : 'read', 'aria-label': n.unread ? '未讀' : null });
      const tag = h('span', { class: 'kind ' + kindCls, text: kindText });
      if (n.kind === 'remind') {
        const t = n.target.taskKey ? taskInfo().tasks.find((x) => x.key === n.target.taskKey) : null;
        const acts = h('div', { class: 'v75nacts' });
        if (t) acts.append(h('button', { class: 'go', type: 'button', text: '打勾完成', onclick: () => { markNoticeSeen(n.id); sendRemindDone(t, ''); } }));
        acts.append(h('button', { class: 'go', type: 'button', text: t ? '晚點 ›' : '看提醒 ›', onclick: () => { markNoticeSeen(n.id); setTab('reminders'); } }));
        body.append(acts);
        wrap.append(h('div', { class: 'n' + (n.unread ? ' unreadrow' : '') }, mark, tag, body));
      } else {
        body.append(h('span', { class: 'go', text: n.kind === 'stuck' || n.kind === 'stale' ? '看這件工作 ›' : n.target.type === 'todo' ? '去驗收 ›' : '看結果 ›' }));
        wrap.append(h('button', { class: 'n nbtn' + (n.unread ? ' unreadrow' : ''), type: 'button', onclick: () => openNotice(n) }, mark, tag, body));
      }
    }
  }
  return wrap;
}

// ---------- 嘿嘿：快捷鍵與「有 N 件要你決定」 ----------
function quickChipRow(ta, wk) {
  const chips = loadChips(lsGet(CHIPS_KEY));
  // 工作膠囊：開著＝這一則走加密留言；送出後維持開著（使用者自己關）；工作專案追問時自動開、關不掉
  const pill = h('button', { class: 'chip qchip workpill' + (wk && wk.on ? ' on' : ''), type: 'button', text: wk && wk.locked ? '工作（鎖定）' : '工作', 'aria-pressed': wk && wk.on ? 'true' : 'false', disabled: wk && wk.locked ? true : null,
    'aria-label': wk && wk.locked ? '工作，工作專案追問時固定開著' : '工作：只走加密留言',
    onclick: () => { setWorkMode(!state.workPill); if (state.workPill) { cloud.mode = 'thinking'; if (!cloudSource()) toast('雲端還沒開，標工作的留言要等雲端打開才送得出（可以先寫、先排隊）', true); } render(); scrollBottom(); } });
  return h('div', { class: 'quickchips', role: 'group', 'aria-label': '快捷鍵' }, pill, ...chips.map((t) => h('button', {
    class: 'chip qchip', type: 'button', text: t,
    onclick: () => { const v = applyChip(ta.value, t); ta.value = v; setDraft('chat', v); ta.focus(); }, // 只填進輸入框，不直接送
  })));
}
function workButton(wk) {
  return h('button', { class: 'work-toggle' + (wk.on ? ' on' : ''), type: 'button', text: '工',
    'aria-label': wk.locked ? '工作標記已鎖定。' : '標記工作，只走加密留言。', 'aria-pressed': wk.on ? 'true' : 'false', disabled: wk.locked ? true : null,
    onclick: () => { setWorkMode(!state.workPill); if (state.workPill) cloud.mode = 'thinking'; render(); } });
}
function decideBar() {
  let n = 0;
  try { n = state.data ? decisionCount() : 0; } catch (e) { n = 0; }
  if (!n) return null;
  return h('button', { class: 'decidebar', type: 'button', text: '有 ' + n + ' 件要你決定 ›', onclick: () => { state.qtab = 'open'; setTab('todo'); } });
}

// ---------- 設定：嘿嘿快捷鍵（只有五欄版開著才出現） ----------
function quickChipsCard() {
  const cur = loadChips(lsGet(CHIPS_KEY));
  const inputs = [0, 1, 2].map((i) => h('input', { type: 'text', value: cur[i] || '', maxlength: String(CHIP_MAX), autocomplete: 'off', 'aria-label': '快捷鍵 ' + (i + 1) }));
  return h('section', { class: 'card' }, h('h2', { text: '嘿嘿快捷鍵' }),
    h('div', { class: 'hint', text: '輸入框上方最多三顆，每顆最多 ' + CHIP_MAX + ' 字。點了只會填進輸入框，不會直接送出。留空的不顯示；全部清空會回到預設。' }),
    ...inputs,
    h('div', { class: 'actions' },
      h('button', { class: 'btn small', type: 'button', text: '儲存', onclick: () => {
        const v = saveChips(inputs.map((x) => x.value));
        try { if (v == null) ls.removeItem(CHIPS_KEY); else ls.setItem(CHIPS_KEY, v); } catch (e) { toast('存不了', true); return; }
        toast('已儲存');
        render();
      } }),
      h('button', { class: 'btn ghost small', type: 'button', text: '回到預設', onclick: () => { try { ls.removeItem(CHIPS_KEY); } catch (e) { /* ignore */ } render(); } })));
}

function viewHome(p) {
  const st = curStatus(p);
  const rem = getReminders();
  const ws = usableWs(); // P71：狀態檔可用就用新卡，不然照舊（Live.md 做法）
  if (kanbanOn()) return viewHomeKanban(p, ws);
  if (fiveOn() && ws) return viewHomeV75(p, ws, rem); // P74：五欄版（預設關）
  // P72：檔案有交辦／提問欄位、而且版面設定是 v72（預設）→ 新首頁；舊檔或切回 v71 → 照舊畫狀態卡
  if (ws && (ws.orders || ws.asks) && curLayout() === 'v72') return viewHomeV72(p, ws, rem);
  const wrap = h('div', { class: 'homepage' });
  const cb = cloudBanner(); if (cb) wrap.append(cb);
  const must = mustHomeLine(); if (must) wrap.append(must);
  const statusEl = ws ? workCard(p, ws) : statusLineCard(p, st);
  const mineEl = mineLine(); // 你寫的 N 件電腦還沒收 ›（0 件不顯示）
  // mineEl 可能是 null（0 件不顯示）；DOM 的 append(null) 會印出「null」字樣，要先濾掉
  const parts = STATUS_FIRST ? [statusEl, mineEl] : [mineEl, statusEl];
  const pb = pushBanner();
  if (pb) wrap.append(pb);
  wrap.append(...parts.filter(Boolean));
  const usage = cloudUsage(); if (usage) wrap.append(usage);
  const links = homeLinksRow(rem, ws);
  if (links) wrap.append(links);
  wrap.append(quotaCompact(p));
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
const opn = (cards) => openCards(cards, state.sent, pendMap());
function derive() {
  const d = state.data;
  if (dMemo.val && dMemo.live === d.live && dMemo.questions === d.questions && dMemo.sentKey === sentKeyOf() && dMemo.pcText === (d.stateText || '')) return dMemo.val;
  const p = parseLive(d.live);
  const pcs = pcState();
  const cards = applyStillYours(buildCards(d.questions || '', p.waiting), pcs ? pcs.questions : []);
  const before = state.sent.filter((r) => r.received).length;
  reconcileIfLoaded(state.sent, cards, d.questions, d.live); // Questions.md 讀不到時不標成「已收到」
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
  const val = buildReminders({ openCards: dv.open, tasks: rd.tasks, journal, now, routines: rd.routines, reminds: rd.reminds });
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
      }, h('span', { class: 'okey', text: o.key }), h('span', { class: 'olabel', text: optShort(o.label) + (o.rec && !/建議/.test(optShort(o.label)) ? '（建議）' : '') }));
      b.title = o.label; b.setAttribute('aria-label', o.key + '：' + o.label); // P70 M3b：按鈕只顯示｜之前的短標籤，完整文字在 title／aria-label
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

// 題目的作答區：說明、選項按鈕、自由輸入、送出（問題頁的展開卡與動手卡的選項共用）。opts.quick：要不要放「照建議」
function answerForm(c, st, opts = {}) {
  const out = [];
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
  out.push(area, h('div', { class: 'actions' }, h('button', { class: 'btn wide', type: 'button', text: st === 'open' ? '送出答案' : '送出補充', onclick: submit })));
  if (opts.quick !== false) {
    // 快速按鈕：只剩「照建議」（P70 D3＝Q342 B：「不確定」兩週 0 次，拿掉）。「延後」「需要討論」「不確定」不再畫按鈕（QUICK 常數保留給舊的寫入紀錄）
    if (c.suggest) {
      const quick = h('div', { class: 'quick', role: 'group', 'aria-label': '快速回答' });
      quick.append(h('button', { class: 'btn ghost', type: 'button', text: '照建議' + (c.suggestKey ? '（' + c.suggestKey + '）' : ''), onclick: () => sendAnswer(c, QUICK.suggest) }));
      out.push(quick);
    }
  }
  // P70 M3b（Q334＝A）：背景（題目內文＋選項說明）預設收起，放在最後；開或關記在 state.expanded（qbg:<題號>），重畫後保持
  // P70 UX：相關專案／任務晶片、「卡住」、「Live.md 等你」也收進背景（放在背景內文前面），展開的題目只剩題目＋選項＋送出
  const shown = opts.body !== false ? bodyForDisplay(c.body, c.options) : [];
  const notes = optNotes(c.options);
  const extra = (opts.extra || []).filter(Boolean);
  if (shown.length || notes.length || extra.length) {
    const k = 'qbg:' + c.qid;
    const det = h('details', { class: 'qbg' }, h('summary', { text: '背景' }));
    if (state.expanded.has(k)) det.open = true;
    det.addEventListener('toggle', () => { if (det.open) state.expanded.add(k); else state.expanded.delete(k); });
    if (extra.length) det.append(...extra);
    if (shown.length) det.append(mdBlock(shown.join('\n'), 'more md'));
    if (notes.length) det.append(h('div', { class: 'optnotes' }, h('div', { class: 'hint', text: '選項說明' }), ...notes.map((n) => h('div', { class: 'optnote' }, h('span', { class: 'okey', text: n.key + '：' }), h('span', { text: n.desc })))));
    out.push(det);
  }
  return out;
}

function questionCard(c, st) {
  const open = state.openQ === c.qid;
  const rec = [...state.sent].reverse().find((r) => r.qid === c.qid);
  const dated = !!deadlineDate(c.deadline);
  const box = h('div', { class: 'q qcard' + (dated || c.liveKind === 'deadline' ? ' deadline' : '') + (st !== 'open' ? ' done' : '') + (st === 'ghost' ? ' ghost' : ''), id: 'q-' + c.qid });
  // 能展開的卡：標題區是一顆 button（跟任務卡一樣點了展開／收合）；button 裡不能再放 button，所以專案／任務 chip 在 button 外面
  if (!open && state.keepQ.has(c.qid) && (st === 'queued' || st === 'sent') && state.qtab === 'open') {
    // P70 UX：剛送出的題精簡成一行「Qxxx 已送出：<答案摘要> ｜ 點一下補充」；點了就展開成一般卡
    const ob = pendMap().get(c.qid);
    const sm = rec ? rec.summary : ob && ob.payload ? ob.payload.summary || summarize(ob.payload.answer) : summarize(c.answer);
    // 還在排隊（queued）展開也沒有表單，只顯示一行、不能點；keepQ 不在這裡刪，否則重畫時分頁篩選會把展開的卡濾掉（QC M1）
    if (st === 'queued') return h('div', { class: 'qcard qkept', id: 'q-' + c.qid }, h('span', { class: 'qid', text: c.qid }), h('span', { text: ' 排隊送出：' + sm }));
    return h('button', { class: 'qcard qkept', type: 'button', id: 'q-' + c.qid, onclick: () => { state.openQ = c.qid; render(); } }, h('span', { class: 'qid', text: c.qid }), h('span', { text: ' 已送出：' + sm + ' ｜ 點一下補充' }));
  }
  const expandable = st !== 'queued' && st !== 'failed' && st !== 'ghost' && c.source !== 'dup';
  const meta = h('div', { class: 'qmeta' },
    h('span', { class: 'qid', text: c.qid }),
    hasDeadline(c.deadline) ? h('span', { class: 'tag warn', text: deadlineChip(c.deadline) }) : (c.liveKind === 'deadline' ? h('span', { class: 'tag warn', text: '有期限' }) : null),
    c.today ? h('span', { class: 'tag today', text: '今日' }) : null,
    c.backlog ? h('span', { class: 'tag', text: '擱置' }) : null,
    // 已答分頁的小狀態字（排隊中／已送出／已收到）
    st === 'queued' ? h('span', { class: 'tag', text: '排隊中' }) : st === 'sent' ? h('span', { class: 'tag', text: '已送出' }) : st === 'received' || st === 'pc' ? h('span', { class: 'tag', text: '已收到' }) : null);
  const title = inlineHtml(c.title, open ? 'qtitle' : 'qtitle clamp2'); // P70 M3b：收合時標題最多 2 行
  if (expandable) {
    const hint = st === 'open' ? (c.options.length ? '點一下選擇或作答' : '點一下作答') : st === 'sent' ? '已送出｜點一下補充或修改' : '電腦已收到｜點一下補充';
    box.append(h('button', {
      class: 'qhead', type: 'button', 'aria-expanded': open ? 'true' : 'false',
      onclick: () => { state.openQ = open ? null : c.qid; render(); },
    }, meta, title, open ? null : h('div', { class: 'qtap', text: hint })));
  } else box.append(h('div', { class: 'qhead static' }, meta, title));
  // P70 UX：相關專案／任務晶片、「卡住」、「Live.md 等你」不再擺在選項上方，改放進作答區的「背景」details（只在展開時算）
  const rp = open ? qlinks.proj.get(c.qid) || [] : [];
  const rt = open ? tasksOfQuestion(qlinks.tasks, c.qid) : [];
  const bgExtra = [];
  if (rp.length || rt.length) {
    bgExtra.push(h('div', { class: 'relchips' },
      ...rp.map((pr) => h('button', { class: 'tag chiplink', type: 'button', text: pr.pid + ' · ' + pr.name, onclick: () => openProject(pr) })),
      ...rt.map((t) => h('button', { class: 'tag chiplink', type: 'button', text: tlabel(t.tnum) + ' · ' + t.title, onclick: () => openTask(t.key) }))));
  }
  if (open && c.blocker) bgExtra.push(h('div', { class: 'qblock', text: '卡住：' + c.blocker }));
  if (open && c.live.length && c.source === 'questions') bgExtra.push(h('div', { class: 'hint', text: 'Live.md 等你：' + c.live.map((l) => l.label).join('、') }));
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
  if (!open) return box;
  box.append(...answerForm(c, st, { extra: bgExtra }));
  return box;
}

// 問題頁：這張卡在目前的分頁（待答／已答）嗎；viewTodo 與送出後找下一題共用，順序才會跟畫面一致
const inTodoTab = (c) => qtabOf(cst(c), { kept: state.keepQ.has(c.qid) }) === state.qtab;
// 手機其他頁跳到問題頁時，題目已答落「已答」、沒答落「待答」
function qtabFor(qid) {
  const c = currentCards().find((x) => x.qid === qid);
  return c && qtabOf(cst(c)) === 'done' ? 'done' : 'open';
}

function viewTodo(p) {
  const cards = currentCards(p); // P70 M3b：動手題當一般題目顯示
  const tabOf = (c) => qtabOf(cst(c), { kept: state.keepQ.has(c.qid) });
  const nOpen = cards.filter((c) => tabOf(c) === 'open').length;
  const nDone = cards.filter((c) => tabOf(c) === 'done').length;
  const list = cards.filter(inTodoTab);
  const groups = splitGroups(list);
  if (state.openQ === undefined) { const first = state.qtab === 'open' ? groups.flatMap((g) => g.cards).find((c) => !c.backlog && cst(c) === 'open') : null; state.openQ = first ? first.qid : null; }
  const wrap = h('div');
  qlinks = { proj: projectsByQid(allProjects(state.data.project || ''), cards), tasks: taskInfo().tasks };
  const tabs = h('div', { class: 'chips qtabs', role: 'group', 'aria-label': '待答或已答' });
  for (const [k, label] of [['open', '待答 ' + nOpen], ['done', '已答 ' + nDone]]) {
    tabs.append(h('button', {
      class: 'chip' + (state.qtab === k ? ' active' : ''), type: 'button', text: label, 'aria-pressed': state.qtab === k ? 'true' : 'false',
      onclick: () => { state.qtab = k; state.keepQ.clear(); render(); }, // P70 UX：切換分頁就不再保留剛送出的精簡卡
    }));
  }
  wrap.append(h('div', { class: 'chipwrap' }, tabs));
  if (!list.length) wrap.append(h('div', { class: 'empty', text: state.qtab === 'open' ? COPY.qAllDone : '還沒有已答的題目' }));
  for (const g of groups) {
    wrap.append(h('div', { class: 'group-title', text: g.label }));
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
  state.keepQ.add(c.qid); // P70 UX：剛送出的題在「待答」多留一張精簡卡，直到切換分頁或電腦已收到
  clearDraft('ans:' + c.qid);
  state.sel[c.qid] = new Set();
  blurActive();
  const p = parseLive(state.data.live);
  const cards = currentCards(p);
  // 下一題：照目前分頁＋分組排序後畫面上的順序往下找（剛答的這題先留在清單裡當起點）；「還有 N 題」也用目前分頁的數量
  qlinks = { proj: projectsByQid(allProjects(state.data.project || ''), cards), tasks: taskInfo().tasks };
  const flat = splitGroups(cards.filter((x) => x.qid === c.qid || inTodoTab(x))).flatMap((g) => g.cards);
  const pool = flat.filter((x) => !x.backlog && cst(x) === 'open' && inTodoTab(x));
  const idx = flat.findIndex((x) => x.qid === c.qid);
  const next = flat.slice(idx + 1).find((x) => pool.includes(x)) || pool[0] || null;
  state.openQ = next ? next.qid : null;
  toast('✅ 已存手機 ' + hhmm(now.getTime()) + '｜' + (pool.length ? '還有 ' + pool.length + ' 題待答' : COPY.allAnswered) + (isOffline() ? '（沒網路，連上會自動送）' : ''));
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
  return h('span', { class: 'tag tstate ' + cls, text: t.stateLabel }); // P66：狀態用文字顏色表示，不再在前面加 emoji（STATE_ICON 留給專案頁的一行摘要）
}

// tags：給了就取代狀態標籤（提醒分頁用日期標籤，每張都寫「提醒：你要做」沒有資訊量）
function taskCard(t, pmap, cards, tags = null, shortTitle = '') {
  const open = state.expanded.has('task:' + t.key);
  const box = h('div', { class: 'q taskcard st-' + t.state, id: 't-' + t.key });
  const head = h('button', {
    class: 'thead', type: 'button', 'aria-expanded': open ? 'true' : 'false',
    onclick: () => { if (open) state.expanded.delete('task:' + t.key); else state.expanded.add('task:' + t.key); render(); },
  }, h('div', { class: 'ttitle' }, h('span', { class: 'qid', text: tlabel(t.tnum) }), h('span', { class: open ? 'tname' : shortTitle ? 'tname clamp1l' : 'tname clamp2', text: open || !shortTitle ? t.title : shortTitle })));
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
    d.append(h('button', { class: 'btn ghost wide relq', type: 'button', onclick: () => { state.qtab = qtabFor(q); state.openQ = q; setTab('todo'); scrollToCard(q); } }, h('span', { class: 'qid', text: q }), h('span', { class: 'clamp1', text: (cards.find((c) => c.qid === q) || {}).title })));
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
  const rn = replyNote(t, state.ob); // P70 UX：回覆送出後卡上留一行回饋（已回覆 HH:MM，等 Agent／Agent 已回：…）
  if (rn && !pr) wrap.append(h('div', { class: 'qstate replynote' + (rn.kind === 'agent' ? ' received' : ''), text: rn.kind === 'agent' ? 'Agent 已回：' + rn.text : '已回覆 ' + hhmm(rn.at) + '，等 Agent' }));
  const mode = state.rform && state.rform.key === t.key ? state.rform.mode : '';
  const cancel = h('button', { class: 'btn ghost', type: 'button', text: '取消', onclick: () => { state.rform = null; render(); } });
  if (mode === 'done') {
    // P70 D1（Q340 A）：完成只有一個表單，附「想跟 Agent 說的話（選填）」；有寫字＝同時當成回覆（Task.md 多一行「手機回覆」），電腦會處理
    const area = draftArea('rd:' + t.key, '想跟 Agent 說的話（選填）：例如「已辦好，下次 2027/11」「答案是…」', 2);
    wrap.append(area, h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', text: '確認完成', onclick: () => sendRemindDone(t, area.ta.value) }), cancel));
  } else if (mode === 'reply') {
    const area = draftArea('rr:' + t.key, '還沒完成，想跟 Agent 說什麼？例如「延到 11/10」「這個不用了」', 3);
    wrap.append(area, h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', text: '送出回覆', onclick: () => sendRemindReply(t, area.ta.value) }), cancel));
  } else if (!pd || pd.state === 'failed') {
    // 一張卡一個主行動：「完成」；只想講話、還沒做完的收成小字連結
    wrap.append(h('div', { class: 'quick' },
      h('button', { class: 'btn small', type: 'button', text: '完成', onclick: () => { state.rform = { key: t.key, mode: 'done' }; render(); } }),
      h('button', { class: 'btn link', type: 'button', text: '還沒完成，只是想說', onclick: () => { state.rform = { key: t.key, mode: 'reply' }; render(); } })));
  }
  return wrap;
}

function sendRemindDone(t, say) {
  const s = String(say || '').trim();
  markRoutineDone(t);
  // P70 D1：完成表單那一欄改存 say（寫成「手機回覆」子行＋打勾）；note 留空，舊版排隊中的 note 照舊寫進結果子行
  enqueue('done', { title: t.title, key: t.key, tnum: t.tnum, note: '', say: s, summary: s ? '完成＋留話' : '完成' });
  clearDraft('rd:' + t.key);
  state.rform = null;
  blurActive();
  toast('✅ 已存手機：完成「' + [...t.title].slice(0, 14).join('') + '」' + COPY.taskDone + (isOffline() ? '（沒網路，連上會自動送）' : ''));
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

// 任務頁：頂端兩個分頁（交辦 Agent／提醒），一次只顯示一個分頁的內容（P70 M3b：拿掉「我要動手」）。
// 使用者沒選過就走預設（提醒分頁有定期提醒或近期提醒就停在「提醒」，沒有停在「交辦 Agent」）；選過就記在 state.ttab（這次開著 App 期間）。
function viewTasks(p) {
  const { tasks } = taskInfo();
  const cards = currentCards(p); // 任務卡的「相關題目」按鈕連到問題頁
  const pmap = new Map(allProjects(state.data.project || '').filter((x) => x.pid && !x.closed).map((x) => [x.pid, x]));
  const pendTasks = pendingOf('task'); // 剛寫的（排隊中、送出中、失敗，或剛送出）：馬上出現，不用等重抓
  const groups = groupTasks(tasks, new Date()).filter((g) => g.items.length);
  const nAgent = groups.filter((g) => ACTIVE_GROUPS.includes(g.key)).reduce((n, g) => n + g.items.length, 0) + pendTasks.length;
  const rd = reminderData();
  const rsec = remindTabSections(rd.tasks, rd.todayIso, rd.routines, routinePrefixes(rd.raw, rd.settings));
  const nRemind = rsec.count;
  const nRemindNow = rsec.periodic.filter((x) => x.who !== 'auto').length + rsec.soon.length; // 這期要做的定期提醒＋近期提醒
  const cur = resolveTaskTab(state.ttab, nRemindNow);
  const counts = { agent: nAgent, remind: nRemind };
  const wrap = h('div');
  wrap.append(tabBar(h, {
    items: TASK_TABS.map(([k, label]) => [k, label + (counts[k] ? ' ' + counts[k] : '')]),
    current: cur, label: '任務分頁',
    onPick: (k) => { blurActive(); state.ttab = k; render(); window.scrollTo(0, 0); }, // 先 blur：iOS 點按鈕不會讓輸入框失焦，render 會被當成輸入中而延後
  }));
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
    remindListInto(wrap, rd, rsec, pmap, cards);
    return wrap;
  }
  wrap.append(taskFormCard());
  if (pendTasks.length) {
    wrap.append(h('div', { class: 'group-title', id: 'tg-pending', text: '剛寫的 ' + pendTasks.length }));
    for (const it of pendTasks) wrap.append(pendingCard(it));
  }
  if (!tasks.length && !pendTasks.length) wrap.append(h('div', { class: 'empty', text: COPY.tasksEmpty }));
  for (const g of groups.filter((x) => taskTabOfGroup(x.key) === 'agent')) renderGroup(g, COLLAPSED_TASK_GROUPS.includes(g.key));
  return wrap;
}

// 提醒清單：任務頁「提醒」分頁與看板版底部「提醒」共用，卡片上就能完成或留話（使用者 11-07 x-ivecykod：沿用這份，不繞任務頁）
function remindListInto(wrap, rd, rsec, pmap, cards, skip = new Set()) {
  const keep = (list) => list.filter((x) => !skip.has(x.t.key));
  // 2026-10-30：跟首頁、「提醒事項」頁、電腦版看板同一套判斷（lib/reminders.js remindTabSections）。
  // 已打勾、今日必答不列；定期提醒照電腦算的期別；一次性的 14 天內＋過期 7 天內直接展開，其餘收起來
  const md = (iso) => Number(iso.slice(5, 7)) + '/' + Number(iso.slice(8, 10));
  const dateTag = (x) => (x.date ? h('span', { class: 'tag' + (x.days < 0 ? ' bad' : x.days === 0 ? ' review' : ''), text: md(x.date) + '｜' + dueText(x.days) }) : null);
  // P70 M3b（Q334＝A）：提醒卡收合時只顯示一句話（拿掉「地點：X」「無期限」字樣），標籤依序是日期、地點、無期限；只在呈現層做，lib/reminders.js 的排序與判斷不動
  const card = (t, tags) => {
    const m = remindMeta(t.title, t.bodyMd);
    const extra = [m.place ? h('span', { class: 'tag', text: '地點：' + m.place }) : null, m.noDue ? h('span', { class: 'tag', text: '無期限' }) : null].filter(Boolean);
    return taskCard(t, pmap, cards, [...(tags || []), ...extra], m.text);
  };
  const isNoDue = (x) => remindMeta(x.t.title, x.t.bodyMd).noDue;
  const title = (id, text) => wrap.append(h('div', { class: 'group-title', id, text }));
  const you = keep(rsec.periodic).filter((x) => x.who !== 'auto');
  const auto = keep(rsec.periodic).filter((x) => x.who === 'auto');
  const routineTag = (x) => [h('span', { class: 'tag bad', text: '● 這期還沒做' }), h('span', { class: 'tag', text: x.routine })];
  if (you.length) { title('rt-you', '這期要做的定期提醒 ' + you.length); for (const x of you) wrap.append(card(x.t, routineTag(x))); }
  if (auto.length) { title('rt-auto', '電腦產出給你看 ' + auto.length); for (const x of auto) wrap.append(card(x.t, [h('span', { class: 'tag review', text: '● 等你看' })])); }
  const soon = keep(rsec.soon);
  title('rt-soon', '近期提醒 ' + soon.length);
  if (!soon.length) wrap.append(h('div', { class: 'empty', text: COPY.remindEmpty }));
  for (const x of soon) wrap.append(card(x.t, [dateTag(x)]));
  const noDue = keep(rsec.undated).filter(isNoDue); // 沒寫日期、但標了「無期限」的：直接展開，放在近期提醒後面
  if (noDue.length) { title('rt-nodue', '無期限 ' + noDue.length); for (const x of noDue) wrap.append(card(x.t, [])); }
  const fold = (key, label, list, tagOf) => {
    if (!list.length) return;
    const det = h('details', { class: 'card tgroup' }, h('summary', { text: label + ' ' + list.length + '（預設收起）' }));
    // 從首頁或別頁點某個提醒進來（openTask 會把它標成展開）：它所在的那組也打開
    if (state.expanded.has(key) || list.some((x) => state.expanded.has('task:' + x.t.key))) det.open = true;
    det.addEventListener('toggle', () => { if (det.open) state.expanded.add(key); else state.expanded.delete(key); });
    for (const x of list) det.append(card(x.t, tagOf(x)));
    wrap.append(det);
  };
  fold('tr:later', '14 天後', keep(rsec.later), (x) => [dateTag(x)]);
  fold('tr:undated', '沒寫日期', keep(rsec.undated).filter((x) => !isNoDue(x)), () => [h('span', { class: 'tag', text: '沒寫日期' })]);
  fold('tr:expired', '過期超過 7 天', keep(rsec.expiredItems), (x) => [dateTag(x)]);
  fold('tr:deferred', '還沒到起算日', keep(rsec.deferredItems), (x) => [h('span', { class: 'tag', text: (x.date ? md(x.date) : '') + ' 起才處理' })]);
  const notes = [rsec.done ? '已打勾 ' + rsec.done + ' 件（電腦整理時會移到已完成紀錄）' : '', rsec.daily ? '今日必答在「問題」頁' : ''].filter(Boolean);
  if (notes.length) wrap.append(h('div', { class: 'hint', text: '不列：' + notes.join('；') + '。' }));
  if (rd.staleNote) wrap.append(h('div', { class: 'jstatus warn', text: '⚠ ' + rd.staleNote }));
  wrap.append(h('button', { class: 'morelink', type: 'button', onclick: () => { if (kanbanOn()) { state.remindSched = true; render(); window.scrollTo(0, 0); } else setTab('reminders'); } }, h('span', { text: '定期提醒的下次日期' }), h('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }))); // P66：提醒事項頁只從這裡進（更多頁不再重複列）
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
  // P74 介面改進 A（11-07）：改成步驟條，走過的打勾、目前這格亮、後面灰，下面一句話講現在在哪一步
  const names = ['草稿', '已提交', '等收錄', '已收進'];
  const nf = Number(r.filled) || 0;
  const now = [dirty ? '還沒送出，改完記得按送出' : nf < 3 ? '草稿，還差 ' + (3 - nf) + ' 題' : '草稿', '已提交，三題填了 ' + nf + ' 題', '已提交，等 Agent 收進知識庫', '已收進知識庫'][at];
  return h('div', { class: 'jstepwrap' },
    h('ol', { class: 'jsteps', 'aria-label': '日記進度' }, ...names.map((n, i) => h('li', { class: 'jstep' + (i === at ? ' on' : i < at ? ' past' : ''), 'aria-current': i === at ? 'step' : null },
      h('span', { class: 'jdot', 'aria-hidden': 'true', text: i < at ? '✓' : String(i + 1) }), h('span', { class: 'jname', text: n })))),
    h('div', { class: 'jnow', text: '現在：' + now }));
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
            : ''; // P74 介面改進第 10 項：沒填就不寫「未填」，空框本身就看得出來
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
  if (!notes.length && !pendNotes.length) lc.append(h('div', { class: 'empty', text: COPY.notesEmpty }));
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
const LP_HINT_KEY = 'agent.lphint';
let chatAllThreads = []; // 引用氣泡用編號查原文（見 lib/quote.js）
// P74 介面改進 B：聊天頁分批畫
const CHAT_PAGE = 30;
const chatShowAll = () => { try { return localStorage.getItem('agent.chatall') === '1'; } catch (e) { return false; } };
function threadMsOf(t, tdates) {
  const d = tdates.get(t), m = /(\d{1,2}):(\d{2})/.exec(String(t.time || ''));
  return d && m ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(m[1]), Number(m[2])).getTime() + 59999 : null;
}
let chatMoreObs = null;
// 只有使用者自己往上捲時才自動載入（剛打開頁面、程式捲到底都不算）：記最近一次往上捲的時間
let chatLastY = 0, chatUpAt = 0;
addEventListener('scroll', () => { if (state.tab === 'chat' && scrollY < chatLastY - 2) chatUpAt = Date.now(); chatLastY = scrollY; }, { passive: true });
function chatLoadMore() {
  const before = document.documentElement.scrollHeight, y = scrollY;
  state.chatShow = (state.chatShow || CHAT_PAGE) + CHAT_PAGE;
  render();
  window.scrollTo(0, y + (document.documentElement.scrollHeight - before)); // 停在原本在看的那則，不跳到最上面
}
function chatMoreButton(hiddenN) {
  const btn = h('button', { class: 'btn ghost small chatmore', type: 'button', text: '再往前看 ' + Math.min(CHAT_PAGE, hiddenN) + ' 串（還有 ' + hiddenN + ' 串）', onclick: chatLoadMore });
  // 往上捲到按鈕出現在畫面裡就自動載入（只在使用者自己往上捲時；剛打開頁面、程式捲到底都不會觸發）
  if (chatMoreObs) chatMoreObs.disconnect();
  if ('IntersectionObserver' in self) {
    chatMoreObs = new IntersectionObserver((ents) => {
      if (ents.some((e) => e.isIntersecting) && state.tab === 'chat' && Date.now() - chatUpAt < 1500) { chatMoreObs.disconnect(); chatLoadMore(); }
    });
    requestAnimationFrame(() => { if (btn.isConnected) chatMoreObs.observe(btn); });
  }
  return h('div', { class: 'histload' }, btn);
}

function viewChat(p, preservedArea = null) {
  const wrap = h('div', { class: 'chatpage' });
  const cb = cloudBanner(); if (cb) wrap.append(cb);
  const list = h('div', { class: 'chatlist' });
  const now = new Date();
  const all = chatThreads(now);
  chatAllThreads = all;
  unseenReplies(now); // 第一次用先建基準（現有回覆當看過），再畫泡泡
  // 只顯示最近 3 天的串（以每串第一行的 MM-DD 判斷，沒日期的算舊的），其餘收進「更早的對話（N）」
  const { recent: threads, older } = splitRecentThreads(all, new Date());
  // P62 M3b：泡泡下方的狀態小字、處理中指示、遠端狀態列都靠這三個（狀態檔、遠端開關、outbox 對應）
  const cs = readChatStatus(state.data.chatStatusText);
  const remoteOn = remoteOnFrom(cs, remoteActive(p, now));
  const pairs = pairThreads(state.ob.filter((x) => x.kind === 'chat'), all);
  const failed = hubView() ? hubFailures(hubView(), state.data.chatStatusText) : null; // P74 S6：電腦標 failed 的留言
  const cctx = { pairs, cs, remoteOn, threads: all, now: now.getTime(), failed };
  const tdates = threadDates(all, now); // 日期分隔線：每串的日期（沒寫日期的沿用前一串）
  if (!threads.length && !older.length) list.append(h('div', { class: 'empty', text: COPY.chatEmpty }));
  // P74：view 放不下的較早對話（view.history 不是 null）：最上面一顆按鈕，按了才讀 signal/hub/history.json
  const hv = hubView();
  if (hv && hv.history && !state.hubHist.loaded) {
    list.append(h('div', { class: 'histload' },
      h('button', { class: 'btn ghost small', type: 'button', disabled: state.hubHist.loading, text: state.hubHist.loading ? '載入中…' : '載入更早的對話（' + hv.history.count + ' 則）', onclick: () => loadHubHistory(false) }), // 不能直接傳函式：點擊事件會被當成 silent
      state.hubHist.err ? h('div', { class: 'hint bad', text: state.hubHist.err }) : null));
  }
  if (older.length) {
    const det = h('details', { class: 'card tgroup olderchat' }, h('summary', { text: '更早的對話（' + older.length + '）' }));
    if (state.expanded.has('chat:older')) det.open = true;
    // P74 介面改進 B：收起時不畫裡面的泡泡（打開才畫），聊天頁少一大截元件
    det.addEventListener('toggle', () => { const was = state.expanded.has('chat:older'); if (det.open) state.expanded.add('chat:older'); else state.expanded.delete('chat:older'); if (det.open !== was) render(); });
    if (det.open) {
      const olabels = separatorPlan(older.map((t) => tdates.get(t)), now);
      older.forEach((t, i) => { if (olabels[i]) det.append(h('div', { class: 'datesep', text: olabels[i] })); for (const node of chatBubbles(t, false, null)) det.append(node); });
    }
    list.append(det);
  }
  // 只在最新一串（有 Agent 回覆的）最後一則回覆後面加一列小按鈕（Q213＝A）；不會自動建立任何東西
  const recent = new Set(threads.filter((t) => t.replies.length).slice(-1));
  const area = preservedArea || chatArea(p, remoteOn);
  const rows = [];
  const slabels = separatorPlan(threads.map((t) => tdates.get(t)), now);
  // P74 介面改進 B（11-07）：最近的串先畫最後 CHAT_PAGE 串，往上捲到頂或按按鈕再多畫 CHAT_PAGE 串；
  // 回退：手機 localStorage agent.chatall=1 就整串照舊全畫（不用重新部署）
  const shownN = chatShowAll() ? threads.length : Math.min(threads.length, state.chatShow || CHAT_PAGE);
  const hiddenN = threads.length - shownN;
  if (hiddenN > 0) list.append(chatMoreButton(hiddenN));
  // 驗收回覆、手打的回答不會變成對話串，照時間插回去，不然送出後就看不到自己打的字（11-07 m-nsw4e238）
  const echoSince = state.hubRangeStart != null ? state.hubRangeStart : now.getTime() - 86400000; // 比對話視窗舊的不補，不然會堆在最上面
  const echoes = replyEchoes(state.ob, { now: now.getTime(), shownIds: new Set([...pairs.values()].map((x) => x.id)) }).filter((e) => e.at >= echoSince);
  const firstShownMs = hiddenN > 0 ? threadMsOf(threads[hiddenN], tdates) : null; // 收起來那段的回覆不要堆到最上面
  if (firstShownMs != null) for (let i = echoes.length - 1; i >= 0; i--) if (echoes[i].at < firstShownMs - 60000) echoes.splice(i, 1);
  const threadMs = (t) => threadMsOf(t, tdates);
  const flushEchoes = (before) => { while (echoes.length && (before == null || echoes[0].at <= before)) list.append(echoBubble(echoes.shift())); };
  threads.forEach((t, ti) => {
    if (ti < hiddenN) return;
    const tms = threadMs(t);
    if (tms != null) flushEchoes(tms - 60000);
    if (slabels[ti]) list.append(h('div', { class: 'datesep', text: slabels[ti] }));
    for (const node of chatBubbles(t, recent.has(t), area, cctx)) list.append(node);
    const it = pairs.get(t);
    rows.push({ thread: t, phase: fastReplyForThread(fp.replies, t) ? 'replied' : it ? msgPhase(it, cs, all, remoteOn, cctx.now).phase : null });
  });
  flushEchoes(null);
  const ty = typingState(rows); // A2：只畫一顆處理中指示（最新一則你的留言還沒回覆時）
  if (ty) {
    const stalled = ty.phase === 'stalled';
    list.append(h('div', { class: 'bubble agent typing' + (stalled ? ' stalled' : ''), 'aria-live': 'polite' },
      stalled ? null : h('span', { class: 'tdots', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')),
      h('span', { text: ty.label })));
  }
  for (const it of pendingOf('chat').reverse()) list.append(pendingBubble(it)); // 還沒送成功的話：先顯示在最後，帶「排隊中」
  if (burstOn()) list.append(h('div', { class: 'reply-loading hint', role: 'status', text: '有新回覆，載入中…' }));
  if (kanbanOn()) {
    const asks = kanbanChatAsks(); if (asks) list.append(asks);
  }
  const hints = unseenHintRows(threads[threads.length - 1] || null); if (hints) list.append(hints);
  const runRow = chatRunRow();
  if (runRow) wrap.append(...runRow);
  wrap.append(list);
  if (!preservedArea) wrap.append(area.bar);
  state.chatReplyCount = countReplies(all) + threads.filter((t) => fastReplyForThread(fp.replies, t)).length; // A7（快路徑回覆也算一則）：render() 用來偵測有沒有新回覆
  return wrap;
}

// 一串對話變成泡泡。升格請求、維持任務這類系統訊息摺成一行小字，不打斷聊天
// ctx（A1）：{pairs, cs, remoteOn, threads, now}；舊對話傳 null＝不加狀態小字
function chatBubbles(t, withActions, area, ctx = null) {
  const out = [];
  if (!t.orphan) {
    const sys = systemLine(t.text);
    if (sys) out.push(h('div', { class: 'sysline', text: [t.time, sys].filter(Boolean).join('｜') }));
    else {
      const b = h('div', Object.assign({ class: 'bubble you' }, t.id ? { 'data-mid': t.id } : {}));
      if (fiveOn()) b.setAttribute('data-bubble-key', 'u:' + (t.id || replyKey(t, -1)));
      b.append(...msgBody(t.text, chatAllThreads));
      if (t.extra.length) b.append(mdBlock(t.extra.join('\n'), 'md'));
      msgPress(b, t, -1);
      out.push(b);
      // LINE 式：狀態與時間併成氣泡外側下方一行（靠右）
      const bs = ctx ? bubbleStatus(ctx.pairs.get(t), ctx.cs, ctx.threads, ctx.remoteOn, ctx.now) : null;
      const mt = youMetaText({ time: t.time, note: t.note, status: t.cloudQuickStatus ? '' : cloudWaiting(ctx?.pairs.get(t), t.replies) || (bs ? bs.label : '') });
      if (mt) out.push(h('div', { class: 'bstatus bmeta you ' + (bs ? bs.cls : 'muted'), text: mt }));
      // P74：電腦那邊處理這則失敗了：寫出原因，給一顆「重送」（用同樣的內容另送一則，不改原本那則）
      if (ctx && ctx.failed && t.id && ctx.failed.has(t.id)) {
        const work = isWorkThread(t); // 工作類不顯示原因、不給重送
        const done = state.hubResent.has(t.id);
        const why = work ? '' : ctx.failed.get(t.id);
        out.push(h('div', { class: 'bstatus bad failrow' }, h('span', { text: '⚠ 電腦處理這則失敗了' + (why ? '：' + [...why].slice(0, 60).join('') : '') }),
          work ? null : h('button', { class: 'btn ghost small', type: 'button', disabled: done, text: done ? '已重送' : '重送', onclick: () => { if (state.hubResent.has(t.id)) return; markResent(t.id); enqueue('chat', hubPayload({ content: [t.text, ...(t.extra || [])].join(String.fromCharCode(10)), ...resendNeeds(t.id) })); toast('已重新送出'); render(); } })));
      }
    }
  }
  const qs = quickStatusText(t.cloudQuickStatus);
  if (qs) out.push(h('div', { class: 'bstatus', role: 'status', 'aria-live': 'polite', text: qs }));
  // P69 快路徑回覆：Live.md 還沒有這則留言的嘿嘿回覆時先顯示（⚡）；Live.md 一有回覆就只顯示 Live.md 的（同一個 m-編號不會有兩份）
  const fr = fastReplyForThread(fp.replies, t);
  if (fr) {
    const fb = h('div', { class: 'bubble agent fastreply' });
    if (fiveOn()) fb.setAttribute('data-bubble-key', 'f:' + (t.id || replyKey(t, -1)));
    fb.append(h('div', { class: 'bbody' }, ...msgBody(agentPunctuation(fr.text, fiveOn()), chatAllThreads)));
    out.push(fb);
    out.push(h('div', { class: 'bmeta agent', text: agentMetaText({ time: clockOf(fr.at), fast: true }) }));
  }
  const rlabels = replyLabels(t, new Date()); // 跨過午夜的回覆時間前面補 MM-DD
  t.replies.forEach((r, ri) => {
    const latest = withActions && ri === t.replies.length - 1; // 最新一串的最後一則：長回覆預設展開
    const a = h('div', { class: 'bubble agent', ...(r.source === 'cloud' ? { 'aria-live': 'polite' } : {}) });
    if (fiveOn()) a.setAttribute('data-bubble-key', replyIdentity(t, r, ri));
    a.setAttribute('data-rid', replyIdentity(t, r, ri)); // 記「看過了沒」用
    // A4：長回覆收合。最新的預設展開（'!key'＝使用者手動收合），較舊的預設收合（'key'＝使用者展開）
    const long = isLongReply(r);
    const key = replyKey(t, ri);
    // m-ola0f1nt：還沒看過、或是要你回答的長回覆，第一次畫就展開（記進 expanded，看過之後重畫也不會突然收起來）
    if (long && !latest && ctx && !state.expanded.has('c:' + key) && (asksUser(r) || !chatSeenSet().has(replyIdentity(t, r, ri)))) { state.expanded.add(key); state.expanded.add('c:' + key); }
    const open = !long || (latest ? !state.expanded.has('!' + key) : state.expanded.has(key));
    const display = agentPunctuation([r.text, ...r.children].join('\n'), fiveOn()).split('\n');
    const headLines = r.text.split('\n').length;
    const body = h('div', { class: 'bbody' }, ...msgBody(display.slice(0, headLines).join('\n'), chatAllThreads), r.children.length ? mdBlock(display.slice(headLines).join('\n'), 'md') : null);
    a.append(body);
    if (long) {
      if (!open) a.classList.add('clipped');
      const flip = latest ? '!' + key : key;
      a.append(h('button', {
        class: 'btn ghost small more', type: 'button', 'aria-expanded': open ? 'true' : 'false', text: open ? '收合' : '展開全文（' + shownLines(r) + ' 行）',
        onclick: () => { if (state.expanded.has(flip)) state.expanded.delete(flip); else state.expanded.add(flip); render(); },
      }));
    }
    msgPress(a, t, ri);
    out.push(a);
    const am = agentMetaText({ time: rlabels[ri], by: r.by });
    if (am) out.push(h('div', { class: 'bmeta agent', text: am }));
  });
  return out;
}

// 長按（或桌面右鍵）任何一則留言開選單（openMsgMenu）：回覆（引用）／複製。
// （回覆後面不再放按鈕；動作都由長按／右鍵選單進來）

// 留言內容：引用前綴 ↩…｜ 畫成引用氣泡，主要內容在下面（不把前綴原樣露出）
function msgBody(text, threads) {
  const v = quoteView(text, threads, p72Labels());
  const out = [];
  if (v.quote) out.push(h('div', { class: 'qquote' + (v.quote.found ? '' : ' nf'), text: v.quote.text }));
  out.push(inlineHtml(v.head + v.rest));
  return out;
}

// 複製：navigator.clipboard 失敗時退回隱藏 textarea＋execCommand
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch (e) { /* 退路 */ }
  try {
    const ta = h('textarea', { class: 'cliptmp', 'aria-hidden': 'true', readonly: true, tabindex: '-1' });
    ta.value = text;
    document.body.append(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch (e) { return false; }
}
async function copyMessage(t, ri) {
  const ok = await copyToClipboard(messageText(t, ri));
  toast(ok ? '已複製' : '複製失敗，請手動選取', !ok);
}
function startQuote(t, ri) {
  state.quoteRef = { ...quoteTarget(t, ri), work: isWorkThread(t) || isWorkTargetId(t.id) }; // 引用工作內容＝這則一定是工作留言（新舊版面都生效）
  blurActive();
  render();
  const ta = document.querySelector('#chatbar textarea');
  if (ta) ta.focus();
}

// 長按（手機約 450 ms）或右鍵（桌面）開選單。長按期間不選字（CSS .msgb），放開時擋掉誤觸的 click
function msgPress(el, t, ri) {
  el.classList.add('msgb');
  let timer = 0; let sx = 0; let sy = 0; let fired = false;
  const clear = () => { clearTimeout(timer); timer = 0; };
  el.addEventListener('touchstart', (e) => {
    clear();
    fired = false;
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    timer = setTimeout(() => {
      timer = 0; fired = true;
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch (er) { /* 不支援就算了 */ } }
      openMsgMenu(t, ri);
    }, 450);
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (timer && e.touches[0] && Math.hypot(e.touches[0].clientX - sx, e.touches[0].clientY - sy) > 10) clear();
  }, { passive: true });
  const end = (e) => { clear(); if (fired && e.cancelable) e.preventDefault(); };
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', clear);
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); clear(); openMsgMenu(t, ri); });
}

function closeMsgMenu() {
  const m = document.getElementById('msgmenu');
  if (m) m.remove();
  state.msgMenu = null;
}
function openMsgMenu(t, ri) {
  if (state.msgMenu) return;
  blurActive();
  const q = quoteTarget(t, ri);
  const item = (text, fn) => h('button', { class: 'btn ghost wide msgitem', type: 'button', text, onclick: () => { closeMsgMenu(); fn(); } });
  const openedAt = Date.now();
  const sheet = h('div', { class: 'msgsheet', role: 'dialog', 'aria-label': '訊息選單' },
    h('div', { class: 'msgpreview', text: (q.who === 'agent' ? AGENT_NAME : '你') + (q.time ? ' ' + q.time : '') + '：' + q.label }),
    item('回覆（引用）', () => startQuote(t, ri)),
    item('複製', () => copyMessage(t, ri)),
    h('button', { class: 'btn wide msgitem msgcancel', type: 'button', text: '取消', onclick: closeMsgMenu }));
  const back = h('div', { class: 'msgback', onclick: () => { if (Date.now() - openedAt > 400) closeMsgMenu(); } });
  document.body.append(h('div', { id: 'msgmenu', class: 'msgmenu' }, back, sheet));
  state.msgMenu = true;
}

// P62 M5b：「叫電腦開遠端」按鈕。只在遠端關著時有內容；按下前確認；等待中／冷卻期間停用並顯示原因（狀態推導見 lib/remoteopen.js）
// P69：遠端開著時改顯示「關遠端」（lib/remoteoff.js，契約 docs 手機關遠端契約）；監聽停了（stalled）時兩顆並存：可以重開、也可以關
function remoteSlot(remoteOn, stalled = false) {
  const slot = h('span', { class: 'remote-slot', id: 'remote-slot' });
  const status = readChatStatus(state.data && state.data.chatStatusText);
  const bs = remoteButtonState({ items: state.ob, status, remoteOn: remoteOn && !stalled, now: Date.now() });
  if (bs) {
    const btn = h('button', { class: 'btn small ghost', type: 'button', id: 'remote-open', text: bs.label, disabled: bs.disabled });
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      if (!confirm(CONFIRM_TEXT)) return;
      const id = newId();
      enqueue('remoteopen', remoteOpenPayload(id, Date.now()), id);
      toast('已送出，等電腦開遠端');
    });
    slot.append(btn);
    if (bs.note) slot.append(h('span', { class: 'remnote', id: 'remote-note', text: bs.note }));
  }
  const off = remoteOffButtonState({ items: state.ob, status, remoteOn, now: Date.now() });
  if (off) {
    const ob = h('button', { class: 'btn small ghost', type: 'button', id: 'remote-off', text: off.label, disabled: off.disabled });
    ob.addEventListener('click', () => {
      if (ob.disabled) return;
      if (!confirm(CONFIRM_OFF_TEXT)) return;
      const id = newId();
      enqueue('remoteoff', remoteOffPayload(id, Date.now()), id);
      toast('已送出，等電腦關遠端');
      render(); // 馬上換成「等待中…」（離線時 flush 不會重畫）
    });
    slot.append(ob);
    if (off.note) slot.append(h('span', { class: 'remnote', id: 'remote-off-note', text: off.note }));
  }
  return slot;
}

// A6 遠端狀態列（在 #chatbar 裡）：文字依遠端開關／離線／電腦沉默；#remote-slot 是留給 M5b「叫電腦開遠端」按鈕的空位
function remoteLine(p, remoteOn) {
  const sy = currentSync(p);
  const stalled = remoteOn && listenerStalled(readChatStatus(state.data && state.data.chatStatusText));
  const text = remoteText({ on: remoteOn, offline: !!sy && sy.key === 'offline', pcQuiet: !!sy && !!sy.pcQuiet, stalled });
  const intakeWarn = intakeAlertText(readChatStatus(state.data && state.data.chatStatusText)); // P70-M4
  return h('div', { class: 'remoteline ' + (remoteOn ? 'on' : 'off') },
    h('span', { class: 'rtext', text }),
    intakeWarn ? h('span', { class: 'remnote intake-alert', id: 'intake-alert', text: intakeWarn }) : null,
    remoteSlot(remoteOn, stalled),
    h('span', { class: 'workhint', text: WORK_HINT }));
}

// 標題列「嘿嘿」旁的遠端膠囊＋往下展開的小卡（remoteLine 的內容搬到小卡裡）；只有聊天頁顯示
function closeRemoteCard() {
  if (!state.remoteCardOpen) return;
  state.remoteCardOpen = false;
  syncRemoteCard();
}
function syncRemoteCard() {
  const chip = $('remote-chip');
  const card = $('remote-card');
  if (!chip || !card) return;
  chip.setAttribute('aria-expanded', state.remoteCardOpen ? 'true' : 'false');
  card.hidden = !state.remoteCardOpen || chip.hidden;
}
function updateRemoteChip() {
  const chip = $('remote-chip');
  const card = $('remote-card');
  if (!chip || !card) return;
  const show = state.tab === 'chat' && !state.locked && !!state.data;
  chip.hidden = !show;
  if (!show) { state.remoteCardOpen = false; card.hidden = true; card.replaceChildren(); return; }
  const p = derive().p;
  const cs = readChatStatus(state.data.chatStatusText);
  const remoteOn = remoteOnFrom(cs, remoteActive(p, new Date()));
  const sy = currentSync(p);
  const stalled = remoteOn && listenerStalled(cs);
  const b = remoteBadge({ on: remoteOn, offline: !!sy && sy.key === 'offline', pcQuiet: !!sy && !!sy.pcQuiet, stalled, intakeWarn: intakeAlertText(cs) });
  chip.className = 'remotechip ' + b.key;
  chip.textContent = b.text;
  chip.setAttribute('aria-label', b.label + '，點一下看詳細說明');
  card.replaceChildren(remoteLine(p, remoteOn));
  syncRemoteCard();
}
function initRemoteChip() {
  const chip = $('remote-chip');
  if (!chip) return;
  chip.addEventListener('click', (e) => { e.stopPropagation(); state.remoteCardOpen = !state.remoteCardOpen; syncRemoteCard(); });
  document.addEventListener('click', (e) => {
    if (!state.remoteCardOpen) return;
    const card = $('remote-card');
    if (card && e.composedPath().includes(card)) return; // 卡裡的按鈕按下後會重畫，用 composedPath 才不會誤判成點外面
    closeRemoteCard();
  });
}

// 固定在底部導覽上方的輸入列＋context chip
const workWarn = () => h('div', { class: 'hint work-warn', role: 'status', text: fiveOn() ? WORK_QUEUE_TEXT : '雲端還沒開，標工作的留言要等雲端打開才送得出（會先排隊）' });
function chatArea(p, remoteOn) {
  const bar = h('div', { class: 'chatbar', id: 'chatbar' });
  if (state.newReply) bar.append(newPill());
  const wk = workChatState({ five: fiveOn(), pill: state.workPill, ctx: state.chatCtx, quote: !!state.quoteRef && state.quoteRef.work === true });
  if (wk.on) cloud.mode = 'thinking';
  if (state.chatCtx) {
    bar.append(h('div', { class: 'ctxchip' },
      h('span', { class: 'ctxtext', text: '正在討論：' + ctxText(state.chatCtx) }),
      h('button', { class: 'ctxx', type: 'button', 'aria-label': '清除討論對象', text: '✕', onclick: () => { state.chatCtx = null; render(); } })));
  }
  if (state.quoteRef) {
    const qr = state.quoteRef;
    bar.append(h('div', { class: 'quotebar' },
      h('span', { class: 'qbtext' }, h('b', { text: qr.kind ? '回覆：' : '回覆 ' + (qr.who === 'agent' ? AGENT_NAME : '你') + (qr.time ? ' ' + qr.time : '') + '：' }), h('span', { text: qr.label })),
      h('button', { class: 'ctxx', type: 'button', 'aria-label': '取消引用', text: '✕', onclick: () => { state.quoteRef = null; dropProblemRef(); render(); } })));
  }
  if (!ls.getItem(LP_HINT_KEY)) {
    bar.append(h('div', { class: 'lphint' },
      h('span', { class: 'qbtext', text: '長按訊息可回覆、複製' }),
      h('button', { class: 'ctxx', type: 'button', 'aria-label': '關閉提示', text: '✕', onclick: () => { try { ls.setItem(LP_HINT_KEY, '1'); } catch (e) { /* 存不了就下次再顯示 */ } render(); } })));
  }
  const ta = h('textarea', { placeholder: state.chatCtx ? '關於這件事想說什麼？' : '跟' + AGENT_NAME + COPY.chatHint, rows: 2, 'aria-label': '訊息' });
  ta.value = getDraft('chat');
  ta.addEventListener('input', () => setDraft('chat', ta.value));
  // P74 體驗檢查：按送出不搶走輸入框的焦點（鍵盤不收），方便連發
  const send = h('button', { class: 'btn', type: 'button', text: '送出', onpointerdown: (e) => { if (document.activeElement === ta) e.preventDefault(); }, onclick: () => sendQuick('chat', { ta }, '已送出') });
  if (fiveOn()) { // P74 五欄版：有要你決定的事、工作標記。
    const db = decideBar(); if (db) bar.append(db);
    if (wk.on && !cloudSource()) bar.append(workWarn());
  } else if (wk.on && !cloudSource()) bar.append(workWarn()); // 舊版面：只有引用工作內容會走到這裡
  bar.append(h('div', { class: 'chatrow' }, ...(fiveOn() ? [workButton(wk)] : []), ta, send));
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
  if (!all.length) {
    wrap.append(h('div', { class: 'empty', text: '讀不到專案清單（Project.md 的「總覽」表可能被改了格式），可以到「更多」從 GitHub 看原始檔。' }));
    return wrap;
  }
  const sp = splitProjects(all);
  if (!sp.work.length && !sp.personal.length) wrap.append(h('div', { class: 'empty', text: '目前沒有進行中的專案' }));
  for (const [label, list] of [['工作', sp.work], ['個人', sp.personal]]) {
    if (!list.length) continue;
    wrap.append(h('div', { class: 'group-title', text: label + '（' + list.length + '）' }));
    for (const pr of list) wrap.append(projectCard(pr, text, cards));
  }
  if (sp.rest.length) {
    wrap.append(h('button', {
      class: 'btn ghost wide restbtn', type: 'button', id: 'proj-rest', 'aria-expanded': state.restOpen ? 'true' : 'false',
      text: (state.restOpen ? '▾ ' : '▸ ') + '暫停／構想／已結案（' + sp.rest.length + '）',
      onclick: () => { state.restOpen = !state.restOpen; render(); },
    }));
    if (state.restOpen) for (const pr of sp.rest) wrap.append(projectCard(pr, text, cards));
  }
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
    h('button', { class: 'btn ghost', type: 'button', text: '跟' + AGENT_NAME + '討論這個專案', onclick: () => startChat({ kind: 'project', id: pr.pid, label, name: pr.name, work: pr.group === 'work' }) })));
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
    h('span', { class: 'tag' + (pr.status === '🟡' ? ' warn' : ''), text: pr.status === '🟡' ? '等你' : (STATUS_TEXT[pr.status] || '狀態—') }), // P66：狀態圓點 emoji 拿掉，等我用橘字
    isWaiting(pr) && pr.status !== '🟡' ? h('span', { class: 'tag warn', text: '等你' }) : null,
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
  const card = h('div', { class: 'proj', id: 'p-' + key }, head);
  if (fiveOn() && pr.pid && !pr.closed) card.append(h('div', { class: 'v75ask' }, h('button', { class: 'btn ghost small', type: 'button', text: '追問', onclick: () => startChat({ kind: 'project', id: pr.pid, label: pr.group === 'work' ? '' : pr.name, name: pr.name, work: pr.group === 'work' }) }))); // P74 五欄版：帶專案編號跳到嘿嘿（工作專案不帶內容，跟「討論這個專案」同一做法）
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
          d.append(h('button', { class: 'btn ghost wide relq', type: 'button', onclick: () => { state.qtab = qtabFor(c.qid); state.openQ = c.qid; setTab('todo'); scrollToCard(c.qid); } },
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
  if (!items.length && !olderItems.length) wrap.append(h('div', { class: 'empty', text: COPY.feedEmpty }));
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
  // P66：一張卡、內部分列；圖示換成 index.html 裡的線條圖示（lib/icons.js），不再用 emoji。
  // 「提醒事項」不再列在這裡：提醒的主場是任務頁「提醒」分頁，定期提醒的下次日期從那個分頁最下面進。
  const wrap = h('div');
  const list = h('div', { class: 'morelist' });
  const item = (ico, label, sub, onclick) => h('button', { class: 'moreitem', type: 'button', onclick },
    h('span', { class: 'ico' }, icon(document, ico)), h('span', {}, h('div', { class: 'moretitle', text: label }), h('div', { class: 'hint', text: sub })),
    h('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }));
  list.append(
    item('folder', '專案', (() => { const n = allProjects(state.data.project || '').filter(isActive).length; return n ? '進行中專案（' + n + ' 個）' : '進行中專案'; })(), () => setTab('projects')),
    item('chart', '報表', reportsSummary(rep.gen === state.gen ? rep.idx : null), () => { rep.open = ''; setTab('reports'); }),
    item('pen', '我寫過的', (() => { const n = notReceivedCount(mineRows()); return (n ? n + ' 件電腦還沒收｜' : '都收到了｜') + '共 ' + state.ob.length + ' 筆'; })(), () => setTab('mine')),
    item('pulse', '動態', '最近完成的事', () => setTab('feed')),
    item('doc', '當前共識', '已定的事和還在等你確認的事，以這份為準', openConsensus),
    item('heart', '健康狀態', '系統分數、電腦最後回報、額度', () => setTab('health')),
    item('gear', '設定', '連線、PIN、清除資料', () => setTab('settings')));
  wrap.append(list);
  // 版本號：sw.js 的快取名稱是 'agent-app-<commit>'（CI 部署時換成 dashboard/app 最後一個 commit），用來跟電腦端對版本
  const ver = h('div', { class: 'hint appver', text: '版本：讀取中…' });
  ver.style.textAlign = 'center';
  ver.style.margin = '16px 0 8px';
  wrap.append(ver);
  appVersion().then((v) => { ver.textContent = '版本：' + v; });
  return wrap;
}

async function appVersion() {
  try {
    if (!('caches' in self)) return '不明';
    const keys = (await caches.keys()).filter((k) => k.startsWith('agent-app-'));
    if (!keys.length) return '不明（沒有離線快取）';
    return keys.map((k) => k.slice('agent-app-'.length)).join('、');
  } catch (e) { return '不明'; }
}

// ---------- 提醒事項（2026-10-30 重做，跟電腦版看板同一套來源與判斷）----------
// 定期：電腦端 state.json 的 routines（看板規則算好的下次日期，停用的列不會出現）；
// 一次性：Task.md 未打勾的 [remind]，14 天內與過期 7 天內（更久的過期、已打勾、今日必答、屬於定期的、「X 起才處理」還沒到日的都不列）
// 看板版底部「提醒」：不能忘放最上面，下面是原本的提醒清單，不經過任務頁
function viewRemindTab(p) {
  if (!kanbanOn()) return viewReminders();
  if (state.remindSched) {
    const w = h('div');
    w.append(h('button', { class: 'btn ghost wide', type: 'button', text: '‹ 回提醒', onclick: () => { state.remindSched = false; render(); window.scrollTo(0, 0); } }));
    w.append(viewReminders());
    return w;
  }
  const wrap = h('div', { class: 'remtab' });
  const rd = reminderData();
  const rsec = remindTabSections(rd.tasks, rd.todayIso, rd.routines, routinePrefixes(rd.raw, rd.settings));
  const pmap = new Map(allProjects(state.data.project || '').filter((x) => x.pid && !x.closed).map((x) => [x.pid, x]));
  const cards = currentCards(p);
  const must = mustNotForget(rd.tasks, rd.todayIso, rd.routines, rd.settings);
  const sec = remindPageSections(rd.reminds, must);
  const md = (iso) => Number(iso.slice(5, 7)) + '/' + Number(iso.slice(8, 10));
  const tag = (text, cls) => h('span', { class: 'tag' + (cls ? ' ' + cls : ''), text });
  const mustCard = (x) => {
    const m = remindMeta(x.t.title, x.t.bodyMd);
    const tags = x.routine ? [tag('定期'), tag(x.routine.status, 'bad')] : [x.date ? tag(md(x.date) + '｜' + dueText(x.days), x.days < 0 ? 'bad' : '') : null, m.noDue ? tag('無期限') : null].filter(Boolean);
    return taskCard(x.t, pmap, cards, tags, x.routine ? x.routine.name : m.text);
  };
  wrap.append(h('div', { class: 'group-title', id: 'rg-must', text: '不能忘 ' + must.length }));
  if (!must.length) wrap.append(h('div', { class: 'hint', text: '目前沒有標「#重要」的提醒。' }));
  for (const x of sec.must) wrap.append(mustCard(x));
  if (sec.mustMore.length) {
    const det = h('details', { class: 'card tgroup' }, h('summary', { text: '其餘不能忘 ' + sec.mustMore.length + ' 件；太多會被淹沒，跟 Agent 說哪幾件可以降級' }));
    if (sec.mustMore.some((x) => state.expanded.has('task:' + x.t.key))) det.open = true;
    for (const x of sec.mustMore) det.append(mustCard(x));
    wrap.append(det);
  }
  remindListInto(wrap, rd, rsec, pmap, cards, new Set(must.map((x) => x.t.key)));
  return wrap;
}

function viewReminders() {
  const wrap = h('div');
  const now = new Date();
  const rd = reminderData(now);
  const md = (iso) => Number(iso.slice(5, 7)) + '/' + Number(iso.slice(8, 10));
  const tagEl = (text, cls) => h('span', { class: 'tag' + (cls ? ' ' + cls : ''), text });
  // P70 M3b QC 必修 1：跟任務頁「提醒」分頁同一套呈現（一句話＋日期、地點、無期限標籤）
  const taskRow = (x) => {
    const m = remindMeta(x.t.title, x.t.bodyMd);
    return h('div', { class: 'q taskcard remitem' + (x.days != null && x.days < 0 ? ' overdue' : '') },
      h('button', { class: 'thead', type: 'button', onclick: () => openTask(x.t.key) },
        h('div', { class: 'ttitle' }, h('span', { class: 'tname clamp1l', text: m.text })),
        h('div', { class: 'tstatebox' }, x.date ? tagEl(md(x.date) + '｜' + dueText(x.days), x.days < 0 ? 'bad' : '') : null,
          m.place ? tagEl('地點：' + m.place) : null, m.noDue ? tagEl('無期限') : null)));
  };
  const isNoDue = (x) => remindMeta(x.t.title, x.t.bodyMd).noDue;
  // P74（11-07 使用者第 1、2 題選 A）：不能忘 → 近期 → 定期 → 不定期
  const must = mustNotForget(rd.tasks, rd.todayIso, rd.routines, rd.settings);
  const sec = remindPageSections(rd.reminds, must);
  const mustRow = (x) => {
    if (!x.routine) return taskRow(x);
    const r = x.routine;
    return h('div', { class: 'q taskcard remitem overdue' },
      h('button', { class: 'thead', type: 'button', onclick: () => openTask(x.t.key) },
        h('div', { class: 'ttitle' }, h('span', { class: 'tname clamp1l', text: r.name })),
        h('div', { class: 'tstatebox' }, tagEl('定期'), tagEl(r.status, 'bad'))));
  };

  // 一、不能忘（標 #重要；不受 14 天限制，過期也留到打勾）
  wrap.append(h('div', { class: 'group-title', id: 'rg-must', text: '不能忘 ' + must.length }));
  if (!must.length) wrap.append(h('div', { class: 'empty', text: '目前沒有標「#重要」的提醒。' }));
  for (const x of sec.must) wrap.append(mustRow(x));
  if (sec.mustMore.length) {
    wrap.append(h('div', { class: 'jstatus warn', text: '不能忘超過 ' + MUST_MAX + ' 件，太多會被淹沒；跟 Agent 說哪幾件可以降級。' }));
    const det = h('details', { class: 'card tgroup' }, h('summary', { text: '其餘 ' + sec.mustMore.length + ' 件' }));
    if (state.expanded.has('rem:mustmore')) det.open = true;
    det.addEventListener('toggle', () => { if (det.open) state.expanded.add('rem:mustmore'); else state.expanded.delete('rem:mustmore'); });
    for (const x of sec.mustMore) det.append(mustRow(x));
    wrap.append(det);
  }

  // 二、近期（其他 14 天內與過期 7 天內）
  wrap.append(h('div', { class: 'group-title', id: 'rg-open', text: '近期 ' + sec.soon.length }));
  if (!sec.soon.length) wrap.append(h('div', { class: 'empty', text: COPY.remindEmpty }));
  for (const x of sec.soon) wrap.append(taskRow(x));

  // 三、定期
  wrap.append(h('div', { class: 'group-title', id: 'rg-routine', text: '定期' + (rd.routines ? ' ' + rd.routines.you.length : '') }));
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
        set ? h('div', { class: opened ? 'remcontent' : 'remcontent clamp2', text: set.content.replace(/#重要/g, '').trim() }) : null);
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

  // 四、不定期（沒寫日期、無期限，14 天以後的收起來）
  const ot = rd.reminds;
  wrap.append(h('div', { class: 'group-title', id: 'rg-later', text: '不定期 ' + (sec.undated.length + sec.later.length) }));
  if (!sec.undated.length && !sec.later.length) wrap.append(h('div', { class: 'empty', text: '沒有不定期的提醒。' }));
  const fold = (key, title, list) => {
    if (!list.length) return;
    const det = h('details', { class: 'card tgroup' }, h('summary', { text: title + ' ' + list.length + '（預設收起）' }));
    if (state.expanded.has(key)) det.open = true;
    det.addEventListener('toggle', () => { if (det.open) state.expanded.add(key); else state.expanded.delete(key); });
    for (const x of list) det.append(taskRow(x));
    wrap.append(det);
  };
  for (const x of sec.undated.filter(isNoDue)) wrap.append(taskRow(x)); // 標了「無期限」的直接展開
  fold('rem:undated', '沒寫日期', sec.undated.filter((x) => !isNoDue(x)));
  fold('rem:later', '14 天後', sec.later);
  const expiredLeft = ot.expiredItems.filter((x) => !must.some((y) => y.t === x.t)).length; // 標 #重要 的已列在不能忘
  const hiddenNote = [expiredLeft ? '已過期很久 ' + expiredLeft + ' 件' : '', ot.deferred ? '還沒到起算日 ' + ot.deferred + ' 件' : ''].filter(Boolean).join('、');
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
    h('span', {}, h('div', { class: 'moretitle', text: reportRowLabel(x).big }), (reportRowLabel(x).small || Date.parse(x.updated)) ? h('div', { class: 'hint', text: [reportRowLabel(x).small, Date.parse(x.updated) ? '更新 ' + mmddhhmm(Date.parse(x.updated)) : ''].filter(Boolean).join('｜') }) : null));
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
  wrap.append(hubCard());
  wrap.append(quotaCard(p, 'Agent 額度'));
  return wrap;
}

// P74：診斷頁的「對話資料來源」：現在用哪一種、有沒有退回舊版與原因、略過了幾則壞資料、電腦端記到的壞檔
function hubCard() {
  const d = state.hubDiagNow;
  const card = h('section', { class: 'card' }, h('h2', { text: '對話資料來源' }));
  if (!d) { card.append(h('p', { class: 'hint', text: '還沒讀過（按一次重新整理）。' })); return card; }
  if (cloud.fallbacks.length) card.append(h('div', { class: 'hint', text: '雲端讀寫失敗已退回 GitHub（最近 ' + cloud.fallbacks.length + ' 筆）' }),
    ...cloud.fallbacks.map((f) => h('div', { class: 'hint', text: hhmm(f.at) + '｜' + f.name + '｜' + f.reason })));
  const eff = effectiveSource(d.local, d.remote);
  card.append(h('div', { class: 'jstatus' + (d.fallback ? ' warn' : ''), text: d.source === 'json' ? '✅ 現在用新版（結構化資料）' : d.fallback ? '⚠ 想用新版，但退回舊版（Live.md）' : '現在用舊版（Live.md）' }));
  if (d.fallback) card.append(h('div', { class: 'hint', text: '原因：' + fallbackText(d.fallback) + (d.fallbackDetail ? '（' + d.fallbackDetail + '）' : '') + '。留言照舊寫進 Live.md，電腦那邊的資料恢復後會自動換回來。' }));
  if (eff === 'live' && !d.fallback) card.append(h('div', { class: 'hint', text: d.remote === 'live' ? '電腦那邊要求用舊版。' : '這支手機的設定選了舊版。' }));
  if (d.remoteBad) card.append(h('div', { class: 'hint', text: '電腦的切換設定檔壞了，已忽略：' + d.remoteBad }));
  card.append(h('div', { class: 'hint', text: d.source === 'json' ? '電腦最後發佈 ' + (d.viewAt ? mmddhhmm(Date.parse(d.viewAt)) : '—') + (d.history ? '｜較早的對話還有 ' + d.history + ' 則' : '') : '本機設定：' + (d.local === 'live' ? '舊版' : '新版') }));
  if (d.bad) card.append(h('div', { class: 'jstatus warn', text: '⚠ 略過了 ' + d.bad + ' 則格式壞掉的資料（其他照常顯示）' }));
  if (d.viewErrors && d.viewErrors.length) {
    card.append(h('div', { class: 'qstate', text: '電腦端記到 ' + d.viewErrors.length + ' 筆壞檔' }));
    for (const e of d.viewErrors) card.append(h('div', { class: 'hint', text: e.id + '｜' + e.reason }));
  }
  if (d.fallbacks && d.fallbacks.length) card.append(h('div', { class: 'hint', text: '這次開 App 以來退回過 ' + d.fallbacks.length + ' 次（最近：' + fallbackText(d.fallbacks[d.fallbacks.length - 1].reason) + '）' }));
  return card;
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
      if (state.tab === 'chat') scrollBottom(); // 點通知開 App＋PIN：解鎖後直接停在最新
      refresh(true).then(() => { if (state.tab === 'chat') scrollBottom(); }).catch(() => {});
      syncPushOnStart().catch(() => {}); // P70：解鎖後才有 client，這時才讀得到 push_status
      try { sendDiag('open').catch(() => {}); } catch (e) { /* 診斷不能影響解鎖 */ } // 解鎖成功後才有 client，這時才寫得出去
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
// ---------- 通知（P62 M4b）：設定頁開關。按了才問權限、subscribe，再用 outbox 的 pushsub 把訂閱寫進 signal/push_sub.json ----------
const PUSH_EP_KEY = 'agent.pushEp'; // 最近一次登記過的 endpoint；App 啟動時若瀏覽器的訂閱換了，自動補登記
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const deviceLabel = () => deviceLabelOf(navigator.userAgent, new Date());
async function currentPushSub() {
  if (!pushSupported()) return null;
  try { const reg = await navigator.serviceWorker.ready; return await reg.pushManager.getSubscription(); } catch (e) { return null; }
}
function enqueuePushAdd(sub) {
  try {
    const rec = subscriptionRecord(sub, deviceLabel(), Date.now());
    enqueue('pushsub', { action: 'add', sub: rec });
    cloudSyncPush(sub).catch(() => {});
    try { ls.setItem(PUSH_EP_KEY, rec.endpoint); } catch (e) { /* 存不了就下次再補 */ }
  } catch (e) { toast('通知訂閱資料不完整：' + e.message, true); }
}
// P72：首頁版面（新＝交辦與提問；舊＝P71 狀態卡）。電腦端資料沒有交辦欄位時不論怎麼選都畫舊版
function layoutCard() {
  const cur = kanbanOn() ? 'kanban' : fiveOn() ? 'five' : curLayout();
  const opt = (v, label) => h('button', { class: 'btn small' + (cur === v ? '' : ' ghost'), type: 'button', 'aria-pressed': cur === v ? 'true' : 'false', text: label, onclick: () => setLayout(v) });
  return h('section', { class: 'card' }, h('h2', { text: '首頁版面' }),
    h('div', { class: 'actions lay' }, opt('v72', '新版（交辦與提問）'), opt('v71', '舊版（狀態卡）'), opt('five', '五欄新版（試用）'), opt('kanban', '看板（試用）')),
    h('div', { class: 'hint', text: '新版把你交辦的事、在等你回答的問題放在首頁；覺得不順手可以切回舊版。' }));
}
// P74：對話資料來源。新版＝電腦整理好的對話檔（結構化 JSON）；舊版＝Live.md。遠端 config 或這裡任一邊選舊版就用舊版，下次重新整理生效
function chatSourceCard() {
  const cur = hubLocal();
  const opt = (v, label) => h('button', { class: 'btn small' + (cur === v ? '' : ' ghost'), type: 'button', 'aria-pressed': cur === v ? 'true' : 'false', text: label, onclick: () => { setHubLocal(v); toast('已設定，下次重新整理生效'); render(); } });
  return h('section', { class: 'card' }, h('h2', { text: '對話資料來源' }),
    h('div', { class: 'actions' }, opt('json', '新版（結構化資料）'), opt('live', '舊版（Live.md）')),
    h('div', { class: 'hint', text: '新版讀取電腦整理好的對話檔，比較快也比較穩；讀不到會自動退回舊版。電腦那邊要求退回舊版時，這裡選新版也會用舊版。改完按「重新整理」生效。' }));
}
function notifyCard() {
  const cb = h('input', { type: 'checkbox', id: 'push-on' });
  const hint = h('div', { class: 'hint' });
  const show = (st) => { cb.checked = st === 'on'; cb.disabled = st === 'unsupported' || (st === 'denied'); hint.textContent = PUSH_STATUS_TEXT[st]; };
  const supported = pushSupported();
  show(demo ? (params.get('push') === 'on' ? 'on' : 'off') : pushStatus({ supported, permission: 'default', subscribed: false }));
  if (!demo && supported) {
    currentPushSub().then((sub) => show(pushStatus({ supported, permission: Notification.permission, subscribed: !!sub })));
  }
  cb.addEventListener('change', async () => {
    if (demo) { toast('示範模式不會訂閱通知'); show('off'); return; }
    if (!supported) { show('unsupported'); return; }
    if (cb.checked) {
      let perm;
      try { perm = await Notification.requestPermission(); } catch (e) { perm = 'denied'; }
      if (perm !== 'granted') { show(perm === 'denied' ? 'denied' : 'off'); return; }
      try {
        const reg = await navigator.serviceWorker.ready;
        await resubscribeAndEnqueue(reg); // P70：先 unsubscribe 舊的再重新訂閱，舊的請電腦拿掉
        state.push = { ...state.push, enabled: true, permission: 'granted', hasSub: true, disabledByPc: false, health: 'ok' };
        show('on');
      } catch (e) {
        show('off');
        const m = e && e.message ? e.message : String(e);
        // delta QC 建議 1：舊訂閱取消不掉時，再按一次也一樣，給白話的下一步
        toast(m === 'resubscribe_same' ? '舊的通知訂閱取消不掉：請到 Chrome 這個網站的設定把「通知」重設後再開一次' : '訂閱通知失敗：' + m, true);
      }
    } else {
      const sub = await currentPushSub();
      if (sub) {
        const ep = sub.endpoint;
        try { await sub.unsubscribe(); } catch (e) { /* 取消不了也照樣請電腦拿掉這筆 */ }
        enqueue('pushsub', { action: 'remove', endpoint: ep });
        try { await cloudSource()?.pushUnsubscribe(ep); ls.removeItem(CLOUD_PUSH_KEY); } catch { /* 不影響既有取消 */ }
        try { ls.removeItem(PUSH_EP_KEY); } catch (e) { /* ignore */ }
      }
      state.push = { ...state.push, enabled: false, health: 'ok' };
      show('off');
    }
  });
  return h('section', { class: 'card' },
    h('h2', { text: '通知' }),
    h('div', { class: 'togglerow' }, cb, h('label', { for: 'push-on', text: '嘿嘿有事時推播到這支手機' })),
    hint,
    h('div', { class: 'hint', text: '通知內容是固定的短句，不含對話內容。Android 13 以上，系統的 Chrome 通知權限也要開。' }));
}

// P70：先 unsubscribe（有的話）再 subscribe，然後把新的加進、舊的移出 signal/push_sub.json（outbox 的 pushsub，重送不重複）
async function resubscribeAndEnqueue(reg) {
  let last = '';
  try { last = ls.getItem(PUSH_EP_KEY) || ''; } catch (e) { /* ignore */ }
  const { sub, oldEp } = await resubscribe(reg, last); // 拿回同一筆死掉的訂閱會丟錯（QC 建議 2）
  const rec = subscriptionRecord(sub, deviceLabel(), Date.now());
  for (const op of pushOpsAfterResubscribe(oldEp, rec)) enqueue('pushsub', op);
  cloudSyncPush(sub).catch(() => {});
  try { ls.setItem(PUSH_EP_KEY, rec.endpoint); } catch (e) { /* 存不了就下次再補 */ }
  return sub;
}

// P70 通知失效時首頁那一行：點了跳設定頁
function pushBanner() {
  if (demo ? params.get('pushbroken') !== '1' : !showPushBanner({ health: state.push.health, repairResult: state.push.lastRepairResult })) return null;
  return h('button', { class: 'banner warn', id: 'push-broken', type: 'button', text: PUSH_BROKEN_TEXT, onclick: () => setTab('settings') });
}

// App 開啟、解鎖後：通知設定開著（agent.pushEp 有值＝這支手機登記過）時檢查一次。
// 失效＝沒有訂閱、權限不是 granted、或電腦把這筆（endpoint＋auth 的 hash）標成停用 → 權限在就自動重新訂閱（每次開 App 最多一次、失敗不重試），權限沒了就在首頁顯示一行
// 沒有改 sw.js 的 pushsubscriptionchange：SW 拿不到 token、寫不了 GitHub，只能留旗標再由頁面處理；頁面每次開啟本來就比對 getSubscription，等價且少一個 SW 改動
let pushChecked = false;
async function syncPushOnStart() {
  if (demo || pushChecked || !pushSupported()) return;
  pushChecked = true;
  let last = '';
  try { last = ls.getItem(PUSH_EP_KEY) || ''; } catch (e) { /* ignore */ }
  const perm = Notification.permission;
  const sub = await currentPushSub();
  const enabled = !!last || (perm === 'granted' && !!sub);
  if (!enabled) { state.push = { ...state.push, enabled: false, permission: perm, hasSub: !!sub, health: 'ok' }; return; }
  let disabledByPc = false;
  try {
    if (sub && state.client && state.client.getSignalFile) {
      const st = parsePushStatus((await state.client.getSignalFile(PUSH_STATUS_PATH)).text);
      const j = sub.toJSON ? sub.toJSON() : {};
      const [eh, ah] = [await hashHex16(sub.endpoint), await hashHex16((j.keys || {}).auth)];
      disabledByPc = isDisabled(st, eh, ah);
    }
  } catch (e) { /* 讀不到狀態檔就當作沒被停用 */ }
  let rep = { at: 0, result: null };
  try { rep = JSON.parse(ls.getItem(PUSH_REPAIR_KEY)) || rep; } catch (e) { /* ignore */ }
  const health = pushHealth({ enabled, supported: true, permission: perm, hasSub: !!sub, disabledByPc });
  state.push = { enabled, permission: perm, hasSub: !!sub, disabledByPc, health, lastRepairAt: rep.at || 0, lastRepairResult: rep.result || null };
  if (health === 'ok') {
    if (sub && last !== sub.endpoint) enqueuePushAdd(sub); // 舊行為：訂閱 endpoint 換過（例如被系統換掉）就補登記
    render();
    return;
  }
  if (health === 'repair') {
    let result = 'ok';
    try { await resubscribeAndEnqueue(await navigator.serviceWorker.ready); } catch (e) { result = 'failed'; }
    const at = Date.now();
    try { ls.setItem(PUSH_REPAIR_KEY, JSON.stringify({ at, result })); } catch (e) { /* ignore */ }
    const sub2 = result === 'ok' ? await currentPushSub() : sub;
    state.push = { ...state.push, hasSub: !!sub2, disabledByPc: result === 'ok' ? false : disabledByPc, lastRepairAt: at, lastRepairResult: result, health: result === 'ok' ? 'ok' : 'repair' };
    if (result === 'ok') toast('通知失效了，已自動重新訂閱');
  }
  render();
  try { sendDiag('push').catch(() => {}); } catch (e) { /* 診斷不能影響本業 */ }
}

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
          cloudClear(); // 換連線設定時不沿用上一個 client 的雲端憑證
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
          cloudClear(); ls.removeItem(CLOUD_PUSH_KEY); ls.removeItem(SEEN_KEY); ls.removeItem(CHAT_SEEN_KEY); chatSeen.set = null; ls.removeItem(CHIPS_KEY); seenMap = null;
          state.gen++; state.cfg = null; state.client = null; state.data = null; state.token = '';
          clearAllDrafts(); clearLocalState(ls); // 草稿（agent.draft.*）、T 編號、已接受、最近專案都一起清
          dropOb(state.ob.map((x) => x.id)); state.obUnsaved = false;
          state.ob = []; state.obRev++; state.mopen = null; state.mfilter = 'all'; // 寫入紀錄（agent.outbox）已由 clearLocalState 清掉
          p72LabelMap = null; state.p72 = { typing: null, sets: new Set() }; state.sent = []; state.sel = {}; state.jsent = {}; state.tnum = { next: 1, map: {} }; state.accepted = new Set(); state.keepQ = new Set(); state.recentP = []; state.promoteReq = {}; state.pf = null; state.chatCtx = null; state.quoteRef = null; state.tf = { ...TF_RESET };
          taskMemo = { sig: '', val: null };
          render();
        },
      })),
    status));
  wrap.append(layoutCard());
  wrap.append(chatSourceCard());
  wrap.append(notifyCard());
  wrap.append(h('section', { class: 'card steps' },
    h('h2', { text: '怎麼建立 token（fine-grained）' }),
    h('ol', {},
      h('li', { text: '在電腦或手機瀏覽器登入 GitHub，到 Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。' }),
      h('li', { text: 'Repository access 選「Only select repositories」，只勾這一個 repo。' }),
      h('li', { text: 'Permissions → Repository permissions，只開 Contents: Read and write（Metadata 會自動是唯讀）。其他都不要開。' }),
      h('li', { text: '設定到期日（建議 90 天內），按 Generate token，複製以 github_pat_ 開頭的字串貼到上面。' }),
      h('li', { text: 'token 存在這台手機的瀏覽器裡（localStorage）；打開 PIN 時存的是加密後的內容，解開的 token 只放在記憶體。同一個 github.io 網域底下的其他網頁，理論上讀得到儲存的內容，所以 token 只授權這一個 repo、只開 Contents、到期日自己設定（建議 90 天）；手機遺失時，到 GitHub 撤銷這個 token。' }))));
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
    // 新版首頁不下拉（使用者 11-07 m-1y99p2d1：左右滑看板很容易誤觸）；⟳、推播、回前景照舊更新
    const skip = (fiveOn() && state.tab === 'home') || (t.closest && t.closest('textarea, input, select, .chips'));
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
  state.remindSched = false;
  if (tab === 'home' && state.tab !== 'home') kanbanColumn = null;
  if (tab === 'chat' && state.tab !== 'chat') state.chatShow = 0; // P74 介面改進 B：每次進聊天頁都從最近 30 串開始
  if (!Object.prototype.hasOwnProperty.call(TITLES, tab)) tab = 'home'; // 不認得的分頁不能白屏
  if (tab === 'notices' && !fiveOn()) tab = 'chat'; // 通知頁只在五欄版存在
  if (tab === 'tasks' && kanbanOn()) tab = state.ttab === 'remind' ? 'reminders' : 'home'; // m-vebeix39：看板版沒有任務頁，所有入口（深層連結、我寫過的、通知、舊書籤）改去提醒或首頁
  if (!demo) setTimeout(schedulePoll, 0); // 換分頁：輪詢間隔跟著變（聊天頁快、其他頁 60 秒）
  if (mainTabs().includes(tab)) state.lastMain = tab;
  // 從「更多」進去的次要頁，返回回到更多；其他來源照舊回到最後一個主要頁
  if (mainTabs().includes(tab) || tab === 'more') state.backTo = '';
  else if (state.tab === 'more' && MORE_PAGES.includes(tab)) state.backTo = 'more';
  if (tab === 'record' && state.tab === 'record' && mainTabs().includes(tab)) rui.backToList(state.rtab); // 在紀錄頁再點一次底部「紀錄」＝目前分頁回到清單
  if (tab !== 'todo') state.qShowOther = false; // 離開問答頁就收回「其他題目」
  if (tab !== 'home') state.remAll = false; // 離開首頁就收回「還有 N 件」，下次回來從預設 4 列開始
  if (tab !== 'chat') state.newReply = false; // A7：離開對話頁就清掉「↓ 新回覆」；回來時 setTab 會直接捲到底
  if (tab === 'chat' && state.tab !== 'chat') state.chatReplyCount = undefined;
  state.tab = tab;
  render();
  window.scrollTo(0, tab === 'chat' ? document.body.scrollHeight : 0);
  if (tab === 'chat') { scrollBottom(); if (!demo) cloudTick().catch(() => {}); }
}

async function init() {
  for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => setTab(b.dataset.tab));
  $('btn-refresh').addEventListener('click', () => { refresh(false); checkAppUpdate(); });
  $('btn-more').addEventListener('click', () => setTab('more'));
  initRemoteChip();
  $('btn-back').addEventListener('click', () => setTab(state.backTo || state.lastMain || 'home'));
  useStorage(ls); // 草稿存這台手機（示範模式只放記憶體）
  state.tnum = loadTnum(ls); state.accepted = loadAccepted(ls); state.recentP = loadRecentP(ls); state.promoteReq = loadPromoteReq(ls);
  state.sent = loadSent(ls);
  state.ob = loadOutbox(ls); // 上次沒送完的寫入（送到一半被關掉的回到排隊）；有 client 之後的 refresh 會自動重送
  // 中央按鈕的名稱與圖示只在 lib/brand.js 設定（用 textContent，CSP 不受影響）
  const cbtn = document.querySelector('#tabs button.center');
  cbtn.querySelector('.cico').textContent = AGENT_ICON;
  cbtn.querySelector('.lbl').textContent = AGENT_NAME;
  cbtn.setAttribute('aria-label', '開啟' + AGENT_NAME);
  initPullToRefresh();
  // A7：使用者自己捲到底就收掉「↓ 新回覆」（被動監聽，只在對話頁才動作）
  window.addEventListener('scroll', () => {
    if (state.tab !== 'chat' || !state.newReply || !nearBottom()) return;
    state.newReply = false;
    const pill = document.querySelector('.newpill');
    if (pill) pill.remove();
    fitChatBar();
  }, { passive: true });

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
      // ?due=1：多一件「今天到期」的假提醒（五欄版截圖用：通知頁的提醒、首頁「今天到期」入口）
      'Task.md': demoDates(demoTask((params.get('many') === '1' ? d.task.replace('## 任務\n\n', '## 任務\n\n' + d.manyTask) : d.task).replace(params.get('due') === '1' ? '## 任務\n\n' : '\u0000', '## 任務\n\n- [ ] [remind] {{TODAY}} 假提醒：繳假信用卡費\n'), t0), t0), 'Project.md': d.project, commits: demoCommits(d.commits, t0),
      [HEALTH_FILE]: JSON.stringify({ agent: 90, db: 88, kb: 99, heartbeat_at: today, scores_at: today, critical_red: [] }),
      [STATE_FILE]: JSON.stringify(demoState(t0)),
      ...(params.get('noreports') === '1' ? {} : demoReports(t0)),
      ...(params.get('norecords') === '1' ? {} : demoRecords(d.records || {}, t0, params.get('recmode') === 'preview' ? 'preview' : 'live')),
    };
    // P71：?ws=fresh|stale|overdue|none|off|many，模擬電腦寫的 signal/work_status.json（預設沒有檔＝舊路徑）
    try {
      const wsMod = await import('./demo/work_status.js');
      const wsText = wsMod.demoWorkStatus(t0, params.get('ws') || 'none');
      if (wsText) demoStore[SOURCE.paths.work_status] = wsText;
      // P72：交辦情境的假留言（m- 編號對得上），讓「你說：…」找得到原話
      if (/^p72/.test(params.get('ws') || '')) demoStore['Live.md'] = demoStore['Live.md'].replace('\n## 📜', '\n' + wsMod.demoP72Live(t0) + '\n## 📜');
    } catch (e) { /* 沒有示範檔就當沒有 */ }
    if (/^p72/.test(params.get('ws') || '')) {
      // P72 驗收用：模擬電腦端換了一份 work_status（回答被收到、交辦結案…），並讀取本機送出紀錄
      window.__p72 = {
        setWs(obj) { demoStore[SOURCE.paths.work_status] = JSON.stringify(obj); return refresh(); },
        getWs() { return JSON.parse(demoStore[SOURCE.paths.work_status]); },
        ob() { return JSON.parse(JSON.stringify(state.ob)); },
      };
    }
    if (params.get('seed') === 'chat') {
      const last = ['delivered', 'stalled'].includes(params.get('last')) ? params.get('last') : 'processing';
      const cs = demoChatSeed(t0, last);
      demoStore['Live.md'] = demoStore['Live.md'].replace('\n## 📜', '\n' + cs.lines + '\n\n## 📜');
      demoStore[SIGNAL_STATUS_FILE] = cs.status;
      state.ob = cs.items; state.noFlush = true;
      // 截圖腳本用：模擬電腦那邊多寫了一則回覆（只在這個示範情境存在）
      // P69 截圖／測試用：模擬快路徑收到回覆（只在這個示範情境存在）
      window.__p69 = { fast(id, text, at = '') { addFastReplies(fp.replies, [{ seq: fp.replies.size + 1, id, text, at }]); render(); } };
      window.__p62 = { addReply() { state.data = { ...state.data, live: state.data.live.replace('\n## 📜', '\n- ↳ 12:59 嘿嘿：新的假回覆（模擬）\n\n## 📜') }; render(); } };
    }
    // P74：?hub=json|bad|one|missing|livecfg 模擬電腦寫的 signal/hub/*.json（預設沒有檔＝退回 Live.md）。window.__hub 給截圖與驗收腳本看送出的 in/ 檔
    if (params.get('hub')) {
      try {
        const dh = (await import('./demo/hub.js')).demoHub(t0, params.get('hub'));
        if (dh) Object.assign(demoStore, dh.files);
      } catch (e) { /* 沒有示範檔就當沒有 */ }
    }
    window.__hub = { puts: () => JSON.parse(JSON.stringify(demoStore.__hubPuts || [])), ob: () => JSON.parse(JSON.stringify(state.ob)), diag: () => JSON.parse(JSON.stringify(state.hubDiagNow)), mode: () => state.data && state.data.hubMode, setFile(path, text) { demoStore[path] = text; }, refresh: () => refresh(true, true) }; // 截圖與驗收腳本模擬「電腦換了檔」
    if (params.get('seed') === 'remote') {
      const rs = demoRemoteSeed(t0, params.get('ro') || 'idle');
      demoStore[SIGNAL_STATUS_FILE] = rs.status;
      state.ob = rs.items; state.noFlush = true;
    }
    if (params.get('seed') === 'workq' && Array.isArray(window.__p74SeedOb)) { state.ob = window.__p74SeedOb; state.noFlush = true; } // 截圖用（P74 五欄版修正）：由測試腳本在載入前放進一份真的 processOutbox 跑完的佇列；不送出
    if (params.get('seed') === 'outbox') { state.ob = demoOutbox(t0).filter((x) => params.get('nofail') !== '1' || x.state !== 'failed'); state.noFlush = true; } // 截圖用：各種狀態的寫入紀錄，而且不送出
  }
  state.cfg = loadCfg();
  restoreProblemRef();
  // 網址 ?tab=：只收白名單的值，讀完立刻用 replaceState 拿掉（重新整理才不會一直跳回去）
  let wantTab = tabFromParam(params.get('tab'));
  if (wantTab === 'home' && /^j-[a-z0-9]{6}$/.test(params.get('job') || '')) state.pendingJob = params.get('job'); // 點推播開的：首頁卡展開那一項
  wantTab = routePushTab(wantTab, state.pendingJob); // P74：五欄版的工作通知去通知頁；關著時通知頁改回嘿嘿
  if (wantTab === 'notices') state.pendingJob = '';
  if (wantTab === 'tasks' && kanbanOn()) wantTab = 'home'; // m-vebeix39：舊書籤、深層連結 ?tab=tasks 在看板版改去首頁
  const notificationPushAt = fiveOn() ? validPushAt(params.get('pushAt')) : null;
  const hashDoc = docFromHash(location.hash); // 文件連結 #doc=：記下來，讀到索引後打開；網址片段立刻清掉
  if (hashDoc) { docs.pending = hashDoc; history.replaceState(null, '', location.pathname + location.search); }
  if (params.has('tab') || params.has('job') || (fiveOn() && params.has('pushAt'))) {
    const u = new URL(location.href);
    u.searchParams.delete('tab');
    u.searchParams.delete('job');
    if (fiveOn()) u.searchParams.delete('pushAt');
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
  if (notificationPushAt) receiveReplyPush(notificationPushAt);
  render();
  if (state.tab === 'chat') scrollBottom(); // 點通知冷開 App：先停在最新（P74 體驗檢查第 1 項，原本只有示範模式會捲）
  if (state.client) { await refresh(true); if (state.tab === 'chat') scrollBottom(); }
  try { sendDiag('open').catch(() => {}); } catch (e) { /* 診斷不能影響啟動 */ } // App 開啟（沒有 client／鎖著時只存本機，解鎖後見下面）

  if (!demo) schedulePoll();
  // P71：首頁狀態卡的「N 分鐘前」每分鐘刷新一次（只在首頁、有可用狀態檔、不在打字時；不抓資料）
  setInterval(() => { if (state.tab === 'home' && !state.locked && state.data && !document.hidden && usableWs()) render(); }, 60000);
  if (!demo) setInterval(fpUpdate, FP_SIGNAL_EVERY_MS); // P69：每 30 秒看一次要不要讀 signal／停長輪詢（不是每 1～2 秒的輪詢）
  if (state.client) syncPushOnStart().catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (!demo) { schedulePoll(); fpUpdate(); } // P69：切到背景就停快路徑長輪詢、清金鑰；切回前景再讀 signal
    if (document.visibilityState === 'visible' && fiveOn()) {
      foregroundAt = Date.now();
      for (const s of refreshSamples) if (!s.domAt) s.foregroundAt = foregroundAt;
      saveRefreshSamples();
      if (!burstOn() && document.querySelector('.reply-loading')) render();
    }
    if (document.visibilityState === 'visible' && state.client && !demo) {
      if (fiveOn() && pushRefreshPending && !state.loading) { pushRefreshPending = false; refresh(true, true, 'push-followup'); }
      else if (Date.now() - state.lastFetch > 60000) refresh(true, true);
      else if (fiveOn()) pollTick(true);
    }
    if (document.visibilityState === 'visible' && !demo) cloudTick(true).catch(() => {});
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
// 文件連結：App 內任何指向「本 App 網址＋#doc=」的連結（聊天 Markdown 連結、自動變的檔名）都攔下來在 App 內開，不開新分頁
document.addEventListener('click', (e) => {
  const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
  const name = a ? docFromHref(a.getAttribute('href'), location.href) : null;
  if (!name) return;
  e.preventDefault();
  openDoc(name);
});
window.addEventListener('hashchange', () => {
  const name = docFromHash(location.hash);
  if (!name) return;
  history.replaceState(null, '', location.pathname + location.search);
  openDoc(name);
});
// SW 傳給頁面的訊息（示範模式也接，截圖與驗收才測得到）
function initSwMessages() {
  if (!('serviceWorker' in navigator)) return;
  // P62 M4b：SW 收到推播時通知開著的頁面（REFRESH＝立刻抓最新，聊天馬上看到回覆）；點通知時切到對應分頁（GOTO）
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data || {};
    if (fiveOn() && d.kind === 'reply' && (d.type === 'REFRESH' || d.type === 'GOTO')) receiveReplyPush(d.pushAt);
    if (d.type === 'REFRESH') { if (state.client && !state.locked && (!fiveOn() || !document.hidden)) refresh(true, true, 'push'); }
    else if (d.type === 'GOTO' && d.tab === 'notices' && !state.locked) {
      const t = routePushTab('notices', ''); // 開關關著＝嘿嘿
      if (state.tab !== t) setTab(t);
    } else if (d.type === 'GOTO' && ['chat', 'todo', 'home'].includes(d.tab) && !state.locked) {
      if (d.tab === 'home' && typeof d.job === 'string' && /^j-[a-z0-9]{6}$/.test(d.job) && fiveOn() && !kanbanOn()) { if (state.tab !== 'notices') setTab('notices'); return; } // P74 五欄版：工作做完／卡住去通知頁
      if (d.tab === 'home' && typeof d.job === 'string' && /^j-[a-z0-9]{6}$/.test(d.job)) state.pendingJob = d.job;
      if (state.tab !== d.tab) setTab(d.tab);
      else if (state.pendingJob) render();
    }
  });
}
function initUpdatePrompt() {
  initSwMessages();
  if (!('serviceWorker' in navigator) || demo) { if (demo && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {}); return; }
  const btn = $('update');
  navigator.serviceWorker.register('sw.js').then((reg) => {
    swReg = reg;
    const offer = () => {
      if (!reg.waiting || !navigator.serviceWorker.controller) return;
      btn.hidden = false;
      btn.onclick = () => applyUpdate();
    };
    // P74 性能檢查（11-07）：以前新版一律等使用者按提示或 ⟳，手機常常好幾個版本沒換。
    // 改成在「安全時機」自動換：App 切到背景時、或回到前景時不在打字也不在送出（草稿存手機，重載不會掉）。
    let hiddenAt = 0;
    const safeToSwap = () => !state.busy && !isTyping();
    const autoSwap = () => { if (reg.waiting && navigator.serviceWorker.controller && safeToSwap()) applyUpdate(); };
    offer();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') { offer(); if (document.hidden) autoSwap(); } });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); autoSwap(); return; }
      if (hiddenAt && Date.now() - hiddenAt > 30000) autoSwap(); // 離開超過 30 秒才換，避免剛切出去又回來就閃一下
      reg.update().catch(() => {});
    });
    setInterval(() => { if (!document.hidden) reg.update().catch(() => {}); }, 30 * 60000); // 一直開著也每 30 分鐘問一次有沒有新版
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (swWanted) location.reload(); });
}

if (window.top !== window.self) {
  // 防被別的網頁用 iframe 嵌入
  document.body.replaceChildren(h('p', { class: 'empty', text: '這個頁面不能被嵌入其他網頁，請直接開啟網址。' }));
} else {
  init();
}
