// 紀錄中心的畫面（v5 M3）：健身／電影／動漫的清單、詳細頁、表單、訓練逐組、封存區。
// 這個檔只管畫面；資料規則在 lib/records.js、lib/records_query.js、lib/records_schema.js。
// app.js 把需要的函式（h、state、enqueueRecord…）用 env 傳進來，所以這裡不碰全域。
import { getDraft, setDraft, hasDraft, setEdit, clearDraft, unsentKeys } from './drafts.js';
import {
  TYPE_INFO, ENUMS, FIELDS, SET_MODES, setMode, applyMode, labelOf, labelsOf, toForm, defaults, validate, fromForm, diffForm, titleOf, visibleFields, fieldLabel, splitMulti, ymd, sameJSON, statusInferred, clearInferred, confirmStatusOp,
} from './records_schema.js';
import { effectiveItems, pendingIds, findDuplicate, parseRecords, recordsMode } from './records.js';
import * as Q from './records_query.js';

const MODS = {
  movie: { label: '電影', icon: '🎬', desc: '想看片單、已看紀錄、評分與備註', types: ['movie'] },
  anime: { label: '動漫', icon: '📺', desc: '追番進度、棄追、續作與個人梯度', types: ['anime'] },
  fitness: { label: '健身', icon: '💪', desc: '訓練計畫、逐組紀錄、身體與傷勢雜記', types: ['fitness-session', 'fitness-plan', 'fitness-note'] },
};
const PREVIEW_MSG = '預覽中：資料核對完成後才開放修改';
const PAGE = 60;
const draftKey = (type, id, k) => 'rec:' + type + ':' + (id || 'new') + ':' + k;
const todayStr = (now) => ymd(now);
const when = (iso) => Q.mmddhhmm(iso);

export function createRecordsUI(env) {
  const { h, state, toast, render, enqueueRecord } = env;
  const S = {
    movie: { view: 'list', id: null, q: '', status: 'all', genres: [], quick: '', scope: 'all', sort: 'updated', archived: false, shown: PAGE, mark: null, inferred: false, panel: false },
    anime: { view: 'list', id: null, q: '', status: 'all', genre: 'all', tier: 'all', mediaType: 'all', scope: 'all', sort: 'updated', archived: false, shown: PAGE, inferred: false, panel: false },
    fitness: { sub: 'sessions', view: 'list', id: null, q: '', exercise: 'all', from: '', to: '', archived: false, noteType: 'all', shown: PAGE, type: null, panel: false },
    errors: {}, dupOk: false, confirm: null, tr: null,
  };

  // ---------- 資料存取 ----------
  const recs = () => env.getRecords();
  const loaded = () => !!recs();
  const mode = () => { const r = recs(); return recordsMode(r ? r.schema : null); };
  const editable = () => mode() === 'live';
  const memo = new Map();
  function itemsOf(type) {
    const r = recs();
    const file = TYPE_INFO[type].file;
    const text = r ? r.texts[file] : undefined;
    const ob = env.getOb();
    const sig = ob.filter((x) => x.kind === 'record' && x.payload && x.payload.file === file).map((x) => x.id + ':' + x.state + ':' + (x.rev || 0)).join(',') + '|' + Math.floor(Date.now() / 60000);
    const hit = memo.get(file);
    if (hit && hit.text === text && hit.sig === sig) return hit.val;
    const val = effectiveItems(text, ob, file, Date.now());
    memo.set(file, { text, sig, val });
    return val;
  }
  const listOf = (type) => itemsOf(type).items;
  const findRec = (type, id) => listOf(type).find((x) => x.id === id) || null;
  const pendOf = (type) => pendingIds(env.getOb(), TYPE_INFO[type].file);
  // 動作對照表（fitness-plans.json 頂層 exercises）：只讀，拿來當動作下拉選單
  function catalog() {
    const r = recs();
    const t = r ? r.texts[TYPE_INFO['fitness-plan'].file] : null;
    const p = parseRecords(t);
    return p.ok && p.doc && Array.isArray(p.doc.exercises) ? p.doc.exercises : [];
  }

  // ---------- 小零件 ----------
  const go = (mod, view, id = null) => { S[mod].view = view; S[mod].id = id; S.errors = {}; S.dupOk = false; S.confirm = null; render(); window.scrollTo(0, 0); };
  const backBtn = (text, fn) => h('button', { class: 'chip rback', type: 'button', text: '‹ ' + text, onclick: fn });
  const previewBanner = () => (editable() ? null : h('div', { class: 'banner rpreview', role: 'status', text: PREVIEW_MSG }));
  // pickKey：最後一次在面板裡點的那顆鍵（label|value）。面板重畫後用 data-fkey 找回同一顆，把焦點放回去（鍵盤、讀屏不會掉到頁面最上面）
  let pickKey = null;
  let activeClose = null; // 目前開著的篩選面板的關閉函式（Esc 用）；同一時間只會有一個面板
  const fkey = (label, value) => label + '|' + value;
  function chipRow(options, cur, onPick, label, wrap = true) {
    const row = h('div', { class: 'chips' + (wrap ? ' wrap' : ''), role: 'group', 'aria-label': label });
    for (const o of options) {
      const on = Array.isArray(cur) ? cur.includes(o.value) : cur === o.value;
      row.append(h('button', { class: 'chip' + (on ? ' active' : ''), type: 'button', text: o.label, 'aria-pressed': on ? 'true' : 'false', 'data-fkey': fkey(label, o.value), onclick: () => { pickKey = fkey(label, o.value); onPick(o.value); } }));
    }
    return row;
  }
  const focusEl = (el) => { if (el && typeof el.focus === 'function') el.focus(); };
  // Esc 關面板：整個 UI 只掛一次 keydown（測試環境沒有 document 就略過）
  if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') document.addEventListener('keydown', (e) => { if (e && e.key === 'Escape' && activeClose) activeClose(); });
  const allOpt = (enumName, text = '全部') => [{ value: 'all', label: text }, ...ENUMS[enumName].filter((o) => o.value !== 'unknown')];
  const emptyBox = (text, btn) => h('div', { class: 'empty rempty' }, h('div', { text }), btn || null);
  const stat = (n, label) => h('div', { class: 'rstat' }, h('div', { class: 'rnum', text: String(n) }), h('div', { class: 'hint', text: label }));
  const kv = (label, value) => (value == null || value === '' ? null : h('div', { class: 'rkv' }, h('span', { class: 'rk', text: label }), h('span', { class: 'rv', text: String(value) })));
  const pendBadge = (set, id) => (set.has(id) ? h('span', { class: 'tag warn rbadge', text: '⏳ 已存手機' }) : null);
  const newBtn = (text, fn) => (editable() ? h('button', { class: 'btn small', type: 'button', text, onclick: fn }) : null);
  const guardLive = () => { if (!editable()) { toast(PREVIEW_MSG, true); return false; } return true; };

  // 從「我寫過的」跳到那一筆
  function openRecord(rtype, id) {
    const mod = rtype === 'movie' ? 'movie' : rtype === 'anime' ? 'anime' : 'fitness';
    if (mod === 'fitness') S.fitness.sub = rtype === 'fitness-plan' ? 'plans' : rtype === 'fitness-note' ? 'notes' : 'sessions';
    S[mod].view = 'detail'; S[mod].id = id; S[mod].type = rtype;
    state.rtab = mod;
    env.setTab('record');
  }

  // ---------- 模組入口 ----------
  function viewModule(mod) {
    activeClose = null; // 重畫整頁：舊面板的關閉函式作廢，新畫面如果面板開著會自己再登記
    const wrap = h('div', { class: 'rmod rmod-' + mod });
    if (!editable()) wrap.append(previewBanner());
    if (recs() && recs().err) wrap.append(h('div', { class: 'hint rerr', text: '紀錄檔這次沒抓到：' + recs().err + '（先顯示上次的資料）' })); // 各模組清單頂端；以前在紀錄首頁
    if (!loaded()) { wrap.append(h('div', { class: 'empty', text: '紀錄資料讀取中…' })); return wrap; }
    const v = S[mod].view;
    if (mod === 'fitness') wrap.append(fitnessView(v));
    else if (v === 'form') wrap.append(formView(mod, S[mod].id));
    else if (v === 'detail') wrap.append(detailView(mod, S[mod].id));
    else wrap.append(simpleListView(mod));
    return wrap;
  }

  // 清單區塊共用：搜尋框（輸入時只重畫清單，不整頁重畫，鍵盤不會收起來）
  function searchBox(st, onChange, placeholder) {
    const inp = h('input', { type: 'search', class: 'rsearch', placeholder, 'aria-label': '搜尋', autocomplete: 'off', enterkeyhint: 'search' });
    inp.value = st.q || '';
    inp.addEventListener('input', () => { st.q = inp.value; st.shown = PAGE; onChange(); });
    return inp;
  }

  // P50c：清單上方壓到最矮。第一行＝搜尋框＋「篩選」＋「＋」；第二行＝一行小字統計（左）和筆數（右）；
  // 有套用篩選才多一行可以點掉的 chip；所有篩選與排序收進「篩選」打開的底部面板（單手拇指好按）。
  // cfg：{ type, st, placeholder, onNew（null＝不顯示＋）, newLabel, summary（字串）, sheetBody()（面板內容節點陣列）, paint()（重畫清單、回傳筆數）}
  function listChrome(cfg) {
    const { st, type } = cfg;
    let n = 0;
    const filtBtn = h('button', { class: 'btn ghost rfiltbtn', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => { st.panel = true; pickKey = null; paintSheet('open'); } });
    const countEl = h('div', { class: 'hint rcount', 'aria-live': 'polite' });
    const chipsHost = h('div', { class: 'rchips' });
    const sheetHost = h('div', { class: 'rsheethost' });
    const paintCount = () => { countEl.textContent = (st.archived ? '封存區 ' : '') + n + ' 筆'; };
    const tool = h('div', { class: 'rtool' }, searchBox(st, () => { n = cfg.paint(); paintCount(); }, cfg.placeholder), filtBtn,
      cfg.onNew && editable() ? h('button', { class: 'btn rnewbtn', type: 'button', text: '＋', 'aria-label': cfg.newLabel, onclick: cfg.onNew }) : null);
    const sum = h('div', { class: 'rsumline' }, h('div', { class: 'hint rsumtext', text: cfg.summary || '' }), countEl);
    const close = () => { st.panel = false; pickKey = null; paintSheet(); focusEl(filtBtn); }; // 關閉後焦點回到「篩選」鈕
    const paintTop = () => {
      const act = Q.activeFilters(type, st);
      filtBtn.replaceChildren(...['篩選', act.length ? h('span', { class: 'rfiltn', text: String(act.length) }) : null].filter(Boolean)); // 真的 DOM 的 replaceChildren(null) 會寫出 "null" 字樣
      filtBtn.setAttribute('aria-label', act.length ? '篩選與排序，已套用 ' + act.length + ' 項' : '篩選與排序');
      chipsHost.replaceChildren(...act.map((f) => h('button', { class: 'chip rfchip', type: 'button', text: f.label + ' ✕', 'aria-label': '取消篩選：' + f.label, onclick: () => { Q.clearFilter(st, f.key, f.value); refresh(); focusEl(filtBtn); } }))); // 被點掉的 chip 已經不在了，焦點放回「篩選」鈕
      chipsHost.hidden = !act.length; // 沒套用時整列不佔位置（也不出現在畫面上）
    };
    // mode：'open'＝剛打開（焦點移到 ✕）；其餘＝重畫（如果是點了面板裡的鍵，焦點放回那一顆）
    const paintSheet = (mode) => {
      const old = sheetHost.querySelector('.rsheetbody');
      const keep = old ? old.scrollTop : 0;
      filtBtn.setAttribute('aria-expanded', st.panel ? 'true' : 'false');
      if (!st.panel) { sheetHost.replaceChildren(); if (activeClose === close) activeClose = null; return; }
      activeClose = close;
      const act = Q.activeFilters(type, st);
      const sheet = h('div', { class: 'rsheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': '篩選與排序' },
        h('div', { class: 'rsheethead' }, h('div', { class: 'rsheettitle', text: '篩選與排序' }), h('button', { class: 'btn ghost rsheetclose', type: 'button', text: '✕', 'aria-label': '關閉', onclick: close })),
        h('div', { class: 'rsheetbody' }, ...cfg.sheetBody()),
        h('div', { class: 'rsheetfoot' },
          h('button', { class: 'btn ghost rsheetclear', type: 'button', text: '清除', disabled: act.length ? null : '', onclick: () => { Q.clearAllFilters(type, st); pickKey = DONE_KEY; refresh(); } }),
          h('button', { class: 'btn rsheetdone', type: 'button', text: '顯示 ' + n + ' 筆', onclick: close })));
      sheetHost.replaceChildren(h('div', { class: 'rsheetbg', 'aria-hidden': 'true', onclick: close }), sheet);
      const nb = sheetHost.querySelector('.rsheetbody');
      if (nb && keep) nb.scrollTop = keep; // 在面板裡連續點選，位置不會跳回最上面
      if (mode === 'open') focusEl(sheetHost.querySelector('.rsheetclose'));
      else if (pickKey) {
        const key = pickKey; pickKey = null;
        focusEl(key === DONE_KEY ? sheetHost.querySelector('.rsheetdone') : [...sheetHost.querySelectorAll('button')].find((b) => b.getAttribute('data-fkey') === key) || sheetHost.querySelector('.rsheetdone'));
      }
    };
    // 面板裡點了條件：清單、chip 列、面板自己都更新
    const refresh = () => { n = cfg.paint(); paintCount(); paintTop(); paintSheet(); };
    refresh();
    return { nodes: [tool, sum, chipsHost, sheetHost], refresh, count: () => n };
  }
  // 面板裡的一段：小標題＋一排 chip
  const DONE_KEY = '__done'; // 下拉、日期這種重畫後不適合再聚焦的欄位，焦點改放「顯示 N 筆」
  const sheetSec = (title, node) => h('div', { class: 'rsheetsec' }, h('div', { class: 'rsheetlabel', text: title }), node);

  // ---------- 電影／動漫清單 ----------
  function simpleListView(mod) {
    const type = mod; // 'movie' | 'anime'
    const st = S[mod];
    const wrap = h('div');
    const isMovie = mod === 'movie';
    const info = itemsOf(type);
    if (info.parseError) { wrap.append(h('div', { class: 'banner err', text: MODS[mod].label + '資料讀不出來：' + info.parseError })); return wrap; }
    const all = info.items;
    const live = Q.live(all);
    if (!all.length || (!live.length && !Q.archivedOf(all).length)) {
      wrap.append(emptyBox(info.missing ? '這個資料檔還沒有建立。' + (editable() ? '按下面開始記錄。' : '') : '還沒有任何' + MODS[mod].label + '紀錄。', newBtn('開始記錄', () => go(mod, 'form', null))));
      return wrap;
    }
    const listHost = h('div', { class: 'rlist' });
    const paint = () => {
      const opts = isMovie
        ? { q: st.q, status: st.status, genres: st.genres, quick: st.quick, scope: st.scope, sort: st.sort, archived: st.archived, inferred: st.inferred }
        : { q: st.q, status: st.status, genre: st.genre, tier: st.tier, mediaType: st.mediaType, scope: st.scope, sort: st.sort, archived: st.archived, inferred: st.inferred };
      const rows = isMovie ? Q.filterMovies(all, opts, Date.now()) : Q.filterAnime(all, opts, Date.now());
      const pend = pendOf(type);
      const frag = [];
      if (!rows.length) frag.push(emptyBox(st.archived ? '封存區是空的。' : '沒有符合的' + MODS[mod].label + '。換個關鍵字或篩選看看。', st.archived || !editable() ? null : newBtn('新增一筆', () => go(mod, 'form', null))));
      for (const r of rows.slice(0, st.shown)) frag.push(recordCard(type, r, pend, st.archived));
      if (rows.length > st.shown) frag.push(h('button', { class: 'btn ghost wide', type: 'button', text: '顯示更多（還有 ' + (rows.length - st.shown) + ' 筆）', onclick: () => { st.shown += PAGE; paint(); } }));
      listHost.replaceChildren(...frag);
      return rows.length;
    };
    // 面板內容：常用的在上面（狀態），其次梯度／類型，排序、範圍，最後是待確認與封存區
    const sheetBody = () => {
      const nInf = Q.inferredCount(all);
      const na = Q.archivedOf(all).length;
      const pick = (fn) => (v) => { fn(v); st.shown = PAGE; chrome.refresh(); };
      const statusOpts = allOpt(isMovie ? 'movieStatus' : 'animeStatus', '全部狀態').filter((o) => o.value !== 'unknown' || live.some((r) => r.status === 'unknown'));
      const body = [];
      if (isMovie) {
        body.push(sheetSec('快速篩選', chipRow([{ value: '', label: '全部' }, { value: 'recent', label: '最近看完' }, { value: 'want', label: '想看' }], st.quick, pick((v) => { st.quick = v; if (v === 'want') st.status = 'all'; }), '快速篩選', true)));
        body.push(sheetSec('觀看狀態', chipRow(statusOpts, st.status, pick((v) => { st.status = v; st.quick = ''; }), '觀看狀態', true)));
        body.push(sheetSec('類型（可複選）', chipRow(ENUMS.movieGenres, st.genres, pick((v) => { st.genres = st.genres.includes(v) ? st.genres.filter((x) => x !== v) : [...st.genres, v]; }), '類型')));
      } else {
        body.push(sheetSec('觀看狀態', chipRow(statusOpts, st.status, pick((v) => { st.status = v; }), '觀看狀態', true)));
        body.push(sheetSec('梯度', chipRow(allOpt('tier', '全部梯度'), st.tier, pick((v) => { st.tier = v; }), '梯度', true)));
        body.push(sheetSec('類別', chipRow(allOpt('animeGenres', '全部'), st.genre, pick((v) => { st.genre = v; }), '類別')));
        body.push(sheetSec('作品類型', chipRow([{ value: 'all', label: '動畫＋漫畫' }, ...ENUMS.mediaType], st.mediaType, pick((v) => { st.mediaType = v; }), '作品類型')));
      }
      body.push(sheetSec('排序', chipRow(Q.SORTS[type], st.sort, pick((v) => { st.sort = v; }), '排序')));
      body.push(sheetSec('範圍', chipRow([{ value: 'all', label: '全部資料' }, { value: 'recent', label: '最近更新（30 天）' }], st.scope, pick((v) => { st.scope = v; }), '範圍')));
      // 狀態是遷移時推算的、還沒確認的：有才出現這顆鍵
      const more = [];
      if (nInf || st.inferred) more.push(h('button', { class: 'chip' + (st.inferred ? ' active' : ''), type: 'button', text: '待確認狀態 ' + nInf, 'aria-pressed': st.inferred ? 'true' : 'false', 'data-fkey': fkey('其他', 'inferred'), onclick: () => { pickKey = fkey('其他', 'inferred'); st.inferred = !st.inferred; st.shown = PAGE; chrome.refresh(); } }));
      more.push(h('button', { class: 'chip' + (st.archived ? ' active' : ''), type: 'button', text: st.archived ? '‹ 回到清單' : '封存區 ' + na, 'aria-pressed': st.archived ? 'true' : 'false', 'data-fkey': fkey('其他', 'archived'), onclick: () => { pickKey = fkey('其他', 'archived'); st.archived = !st.archived; st.shown = PAGE; chrome.refresh(); } }));
      body.push(sheetSec('其他', h('div', { class: 'chips wrap' }, ...more)));
      return body;
    };
    const chrome = listChrome({ type, st, placeholder: '搜尋' + (isMovie ? '片名、備註' : '作品名、備註'), onNew: () => { S.errors = {}; go(mod, 'form', null); }, newLabel: '新增' + MODS[mod].label, summary: isMovie ? Q.movieSummaryText(all, env.now()) : Q.animeSummaryText(all), sheetBody, paint });
    wrap.append(...chrome.nodes, listHost);
    return wrap;
  }

  // 清單上的一列（緊湊）：左邊標題＋一行小字（點整列進詳細頁），右邊一顆快速動作鈕。
  // 標題區是 button，快速動作放在外面（不要 button 包 button）
  function recordCard(type, r, pend, inArchive) {
    const meta = type === 'movie' ? Q.movieMeta(r) : type === 'anime' ? Q.animeMeta(r) : type === 'fitness-session' ? Q.sessionLine(r) : type === 'fitness-plan' ? Q.planLine(r) : Q.noteLine(r);
    const mod = type === 'movie' ? 'movie' : type === 'anime' ? 'anime' : 'fitness';
    const box = h('div', { class: 'rcard rrow' + (inArchive ? ' archived' : '') });
    box.append(h('button', { class: 'rmain', type: 'button', onclick: () => { S[mod].type = type; go(mod, 'detail', r.id); } },
      h('div', { class: 'rname', text: titleOf(type, r) }),
      h('div', { class: 'rmeta' }, pendBadge(pend, r.id), statusInferred(r) && !inArchive ? h('span', { class: 'tag rbadge rinf', text: '狀態是推算的' }) : null, h('span', { class: 'hint rmetatext', text: meta }))));
    if (editable()) {
      const t = titleOf(type, r);
      const acts = h('div', { class: 'rquick' });
      if (statusInferred(r) && !inArchive) acts.append(h('button', { class: 'btn small ghost rquickbtn', type: 'button', text: '確認', 'aria-label': '確認《' + t + '》的狀態沒錯', onclick: () => confirmStatus(type, r) }));
      if (inArchive) acts.append(h('button', { class: 'btn small ghost rquickbtn', type: 'button', text: '復原', 'aria-label': '復原《' + t + '》', onclick: () => doRestore(type, r) }));
      else if (type === 'movie' && (r.status === 'want' || r.status === 'unknown' || r.status === 'watching')) acts.append(h('button', { class: 'btn small rquickbtn', type: 'button', text: '✓已看', 'aria-label': '標記《' + t + '》已看', onclick: () => quickWatched(r) }));
      else if (type === 'anime' && (r.status === 'watching' || r.status === 'want')) acts.append(h('button', { class: 'btn small rquickbtn', type: 'button', text: '＋1集', 'aria-label': '《' + t + '》集數 +1', onclick: () => plusEpisode(r) }));
      if (acts.children.length) box.append(acts);
    }
    return box;
  }

  // ---------- 快速操作 ----------
  function sendUpdate(type, rec, patch, okText) {
    const base = {};
    for (const k of Object.keys(patch)) base[k] = rec[k] === undefined ? null : rec[k];
    clearInferred(type, rec, patch, base); // 改了狀態＝使用者看過了，同一個 op 把「推算」標記清掉
    enqueueRecord({ file: TYPE_INFO[type].file, op: 'update', rtype: type, id: rec.id, title: titleOf(type, rec), patch, base });
    toast('✅ ' + okText + '｜' + (env.isOffline() ? '已存手機，連上網路會自動送' : env.savedWord() + '，送出中'));
    render();
  }
  // 「確認」：狀態不動，只把 migration.statusInferred 清成 false
  function confirmStatus(type, r) {
    if (!guardLive()) return;
    const { patch, base } = confirmStatusOp(r);
    enqueueRecord({ file: TYPE_INFO[type].file, op: 'update', rtype: type, id: r.id, title: titleOf(type, r), patch, base });
    toast('✅ 《' + titleOf(type, r) + '》的狀態已確認｜' + (env.isOffline() ? '已存手機，連上網路會自動送' : env.savedWord()));
    render();
  }
  function quickWatched(r) {
    if (!guardLive()) return;
    const patch = { status: 'watched', watchedDate: r.watchedDate || todayStr(env.now()) };
    sendUpdate('movie', r, patch, '《' + r.title + '》標記已看（' + patch.watchedDate + '），評分之後可到詳細頁補');
  }
  function plusEpisode(r) {
    if (!guardLive()) return;
    const { patch, base } = Q.plusOneEpisode(r);
    clearInferred('anime', r, patch, base);
    enqueueRecord({ file: TYPE_INFO.anime.file, op: 'update', rtype: 'anime', id: r.id, title: r.title, patch, base });
    toast('✅ 《' + r.title + '》' + Q.progressText({ ...r, progress: patch.progress }) + '｜' + (env.isOffline() ? '已存手機' : env.savedWord()));
    render();
  }
  function doArchive(type, r) {
    enqueueRecord({ file: TYPE_INFO[type].file, op: 'archive', rtype: type, id: r.id, title: titleOf(type, r) });
    S.confirm = null;
    toast('已封存《' + titleOf(type, r) + '》，可以到封存區復原');
    const mod = type === 'movie' ? 'movie' : type === 'anime' ? 'anime' : 'fitness';
    S[mod].view = 'list'; S[mod].id = null;
    render(); window.scrollTo(0, 0);
  }
  function doRestore(type, r) {
    enqueueRecord({ file: TYPE_INFO[type].file, op: 'restore', rtype: type, id: r.id, title: titleOf(type, r) });
    toast('已復原《' + titleOf(type, r) + '》');
    render();
  }

  // ---------- 詳細頁 ----------
  function detailRows(type, r) {
    return Q.detailPairs(type, r).map(([l, v]) => kv(l, v)).filter(Boolean);
  }
  // 推算狀態的提示列：小標＋一鍵確認
  function inferredBar(type, r) {
    if (!statusInferred(r) || r.archived) return null;
    return h('div', { class: 'rinfbar' }, h('span', { class: 'tag rbadge rinf', text: '狀態是推算的' }), h('span', { class: 'hint', text: '遷移時依清單位置猜的，不一定對。' }),
      editable() ? h('button', { class: 'btn small', type: 'button', text: '確認', 'aria-label': '確認狀態沒錯', onclick: () => confirmStatus(type, r) }) : null);
  }
  // 動畫↔漫畫等關聯：點了跳到那一筆
  function relatedBar(mod, type, r) {
    const rel = type === 'anime' ? Q.relatedOf(r, listOf('anime')) : [];
    if (!rel.length) return null;
    return h('div', { class: 'rrelated' }, h('div', { class: 'hint', text: '相關作品' }),
      ...rel.map((x) => (x.found ? h('button', { class: 'chip', type: 'button', text: (x.mediaType === 'manga' ? '漫畫：' : x.mediaType === 'anime' ? '動畫：' : '') + x.title, onclick: () => go(mod, 'detail', x.id) }) : h('div', { class: 'hint', text: '（找不到關聯的紀錄 ' + x.id + '）' }))));
  }
  function detailView(mod, id) {
    const type = mod === 'fitness' ? S.fitness.type || 'fitness-session' : mod;
    const wrap = h('div');
    const back = () => go(mod, 'list');
    const r = findRec(type, id);
    if (!r) { wrap.append(h('div', { class: 'rbar' }, backBtn('清單', back)), emptyBox('找不到這筆紀錄（可能還沒送到，或已經被改掉）。')); return wrap; }
    wrap.append(h('div', { class: 'rbar' }, backBtn(mod === 'fitness' ? '健身' : MODS[mod].label, back)));
    const card = h('section', { class: 'card rdetail' }, h('h2', { class: 'rname', text: titleOf(type, r) }), pendBadge(pendOf(type), r.id), inferredBar(type, r), ...detailRows(type, r), relatedBar(mod, type, r));
    card.append(h('div', { class: 'hint rupd', text: '最後更新 ' + (when(r.updatedAt) || '—') + (r.version > 1 ? '（修改過 ' + (r.version - 1) + ' 次）' : '') }));
    if (r.archived) card.append(h('div', { class: 'tag rbadge', text: '已封存' }));
    wrap.append(card);
    if (type === 'fitness-session') wrap.append(sessionDetailExtra(r));
    if (type === 'fitness-plan') wrap.append(planDetailExtra(r));
    if (S.movie.mark && type === 'movie' && S.movie.mark === r.id) wrap.append(markPanel(r));
    const confirming = S.confirm && S.confirm.id === r.id;
    if (editable()) {
      const acts = h('div', { class: 'rdetailacts' });
      if (r.archived) acts.append(h('button', { class: 'btn', type: 'button', text: '從封存區復原', onclick: () => doRestore(type, r) }));
      else {
        if (type === 'fitness-session') acts.append(h('button', { class: 'btn', type: 'button', text: r.status === 'in_progress' ? '繼續訓練' : '編輯這次訓練', onclick: () => { S.fitness.id = r.id; S.fitness.view = 'train'; S.tr = null; render(); window.scrollTo(0, 0); } }));
        else acts.append(h('button', { class: 'btn', type: 'button', text: '編輯', onclick: () => go(mod, 'form', r.id) }));
        if (type === 'movie' && r.status !== 'watched') acts.append(h('button', { class: 'btn ghost', type: 'button', text: '標記已看', onclick: () => { S.movie.mark = r.id; render(); } }));
        if (type === 'anime' && (r.status === 'watching' || r.status === 'want')) acts.append(h('button', { class: 'btn ghost', type: 'button', text: '集數 +1', onclick: () => plusEpisode(r) }));
        acts.append(h('button', { class: 'btn ghost', type: 'button', text: '封存', onclick: () => { S.confirm = { id: r.id }; render(); } }));
      }
      wrap.append(acts);
    }
    if (confirming) {
      wrap.append(h('section', { class: 'card rconfirm', role: 'alertdialog' },
        h('div', { class: 'rname', text: '要封存《' + titleOf(type, r) + '》嗎？' }),
        h('div', { class: 'hint', text: '封存後不會出現在清單裡，不會真的刪掉，可以到封存區復原。' }),
        h('div', { class: 'actions' }, h('button', { class: 'btn danger', type: 'button', text: '封存', onclick: () => doArchive(type, r) }), h('button', { class: 'btn ghost', type: 'button', text: '取消', onclick: () => { S.confirm = null; render(); } }))));
    }
    return wrap;
  }

  // 標記已看（US-M02）：日期預設今天、可改；評分與備註選填；ID 不變
  function markPanel(r) {
    const date = h('input', { type: 'date', 'aria-label': '觀看日期' });
    date.value = r.watchedDate || todayStr(env.now());
    const rating = h('input', { type: 'text', inputmode: 'decimal', placeholder: '評分 0～10（選填）', 'aria-label': '評分' });
    rating.value = Number.isFinite(r.rating) ? String(r.rating) : '';
    const note = h('textarea', { rows: 2, placeholder: '備註（選填）', 'aria-label': '備註' });
    note.value = r.note || '';
    const err = h('div', { class: 'rerr', hidden: true });
    return h('section', { class: 'card rmark' }, h('h2', { text: '標記為已看' }), h('label', { text: '觀看日期' }), date, h('label', { text: '評分' }), rating, h('label', { text: '備註' }), note, err,
      h('div', { class: 'actions' }, h('button', {
        class: 'btn', type: 'button', text: '儲存',
        onclick: () => {
          const v = { ...toForm('movie', r), status: 'watched', watchedDate: date.value, rating: rating.value.trim(), note: note.value };
          const { errors } = validate('movie', v);
          if (errors.rating || errors.watchedDate) { err.hidden = false; err.textContent = errors.rating || errors.watchedDate; return; }
          const { patch, base } = diffForm('movie', v, r);
          S.movie.mark = null;
          sendUpdate('movie', r, patch, '《' + r.title + '》標記已看');
        },
      }), h('button', { class: 'btn ghost', type: 'button', text: '取消', onclick: () => { S.movie.mark = null; render(); } })));
  }

  // ---------- 表單（schema 驅動，新增與編輯共用；草稿 key＝rec:<type>:<id|new>:<field>） ----------
  function formView(type, id, opts = {}) {
    const mod = type === 'movie' ? 'movie' : type === 'anime' ? 'anime' : 'fitness';
    const info = TYPE_INFO[type];
    if (mod === 'fitness') S.fitness.type = type;
    const rec = id ? findRec(type, id) : null;
    const wrap = h('div', { class: 'rform' });
    const back = () => { if (mod === 'fitness') go('fitness', rec ? 'detail' : 'list', rec ? id : null); else go(mod, rec ? 'detail' : 'list', rec ? id : null); };
    if (id && !rec) { wrap.append(h('div', { class: 'rbar' }, backBtn('清單', back)), emptyBox('找不到這筆紀錄。')); return wrap; }
    if (!editable()) { wrap.append(h('div', { class: 'rbar' }, backBtn('清單', back)), emptyBox(PREVIEW_MSG)); return wrap; }
    const initial = rec ? toForm(type, rec) : defaults(type, todayStr(env.now()));
    const dk = (k) => draftKey(type, id, k);
    const val = (k) => (hasDraft(dk(k)) ? getDraft(dk(k)) : initial[k] == null ? '' : initial[k]);
    const set = (k, v) => { setEdit(dk(k), v); if (S.errors[k]) { delete S.errors[k]; } };
    const values = () => Object.fromEntries(FIELDS[type].map((f) => [f.key, val(f.key)]));
    wrap.append(h('div', { class: 'rbar' }, backBtn('取消（草稿會保留）', () => { if (unsentKeys().some((k) => k.startsWith('rec:' + type + ':' + (id || 'new') + ':'))) toast('草稿已保留在這台手機'); back(); }),
      h('h2', { class: 'rtitle', text: (rec ? '編輯' : '新增') + (type === 'fitness-plan' ? '訓練計畫' : type === 'fitness-note' ? '健身雜記' : MODS[mod].label) })));
    const body = h('section', { class: 'card' });
    const msgs = h('div', { class: 'rwarn' });
    const dupBox = h('div', { class: 'rdup' });
    const paint = () => {
      const v = values();
      const nodes = [];
      const w = validate(type, v).warnings;
      msgs.replaceChildren(...w.map((x) => h('div', { class: 'hint warnline', text: '⚠ ' + x })));
      for (const f of visibleFields(type, v)) nodes.push(fieldNode(f, v));
      body.replaceChildren(h('div', { class: 'hint', text: '* 必填。草稿會自動存在這台手機，關掉再開還在。' }), ...nodes);
    };
    const fieldNode = (f, v) => {
      const key = f.key;
      const box = h('div', { class: 'rfield' + (S.errors[key] ? ' haserr' : ''), id: 'rf-' + key });
      const lab = fieldLabel(f, v) + (f.required ? ' *' : '');
      box.append(h('label', { text: lab, for: 'rin-' + key }));
      const cur = val(key);
      if (f.kind === 'text' || f.kind === 'number') {
        const inp = h('input', { id: 'rin-' + key, type: 'text', placeholder: f.placeholder || '', autocomplete: 'off', 'aria-required': f.required ? 'true' : null, 'aria-invalid': S.errors[key] ? 'true' : null });
        if (f.kind === 'number') { inp.setAttribute('inputmode', f.integer ? 'numeric' : 'decimal'); inp.setAttribute('enterkeyhint', 'done'); }
        inp.value = cur;
        inp.addEventListener('input', () => { set(key, inp.value); box.classList.remove('haserr'); const e = box.querySelector('.rerr'); if (e) e.remove(); if (f.affects) paint(); else msgs.replaceChildren(...validate(type, values()).warnings.map((x) => h('div', { class: 'hint warnline', text: '⚠ ' + x }))); });
        box.append(inp);
      } else if (f.kind === 'textarea') {
        const ta = h('textarea', { id: 'rin-' + key, rows: 3 });
        ta.value = cur;
        ta.addEventListener('input', () => set(key, ta.value));
        box.append(ta);
      } else if (f.kind === 'date') {
        const inp = h('input', { id: 'rin-' + key, type: 'date', 'aria-required': f.required ? 'true' : null });
        inp.value = cur;
        inp.addEventListener('input', () => { set(key, inp.value); msgs.replaceChildren(...validate(type, values()).warnings.map((x) => h('div', { class: 'hint warnline', text: '⚠ ' + x }))); });
        box.append(h('div', { class: 'rdaterow' }, inp, h('button', { class: 'chip', type: 'button', text: '今天', onclick: () => { set(key, todayStr(env.now())); inp.value = todayStr(env.now()); } })));
      } else if (f.kind === 'chips') {
        const opts2 = ENUMS[f.enum].filter((o) => o.value !== 'unknown' || cur === 'unknown');
        box.append(chipRow(opts2, cur, (x) => { set(key, x); paint(); }, fieldLabel(f, v)));
      } else if (f.kind === 'multi') {
        box.append(chipRow(ENUMS[f.enum], splitMulti(cur), (x) => { const a = splitMulti(val(key)); set(key, (a.includes(x) ? a.filter((y) => y !== x) : [...a, x]).join(',')); paint(); }, fieldLabel(f, v)));
      } else if (f.kind === 'select') {
        const sel = h('select', { id: 'rin-' + key });
        if (f.blank) sel.append(h('option', { value: '', text: f.blank }));
        for (const o of ENUMS[f.enum]) sel.append(h('option', { value: o.value, text: o.label }));
        sel.value = cur;
        sel.addEventListener('change', () => set(key, sel.value));
        box.append(sel);
      } else if (f.kind === 'bool') {
        const row = h('div', { class: 'togglerow' });
        const cb = h('input', { type: 'checkbox', id: 'rin-' + key });
        cb.checked = cur === '1';
        cb.addEventListener('change', () => set(key, cb.checked ? '1' : '0'));
        row.append(cb);
        box.replaceChildren(row);
        row.append(h('label', { text: lab, for: 'rin-' + key }));
      } else if (f.kind === 'exercises') {
        box.append(planExercisesEditor(val(key), (arr) => set(key, JSON.stringify(arr))));
      } else if (f.kind === 'seasons') {
        box.append(seasonsEditor(val(key), (arr) => { set(key, JSON.stringify(arr)); if (box.classList.contains('haserr')) { box.classList.remove('haserr'); const e = box.querySelector('.rerr'); if (e) e.remove(); } }));
      }
      if (S.errors[key]) box.append(h('div', { class: 'rerr', role: 'alert', text: S.errors[key] }));
      return box;
    };
    paint();
    wrap.append(msgs, body, dupBox);
    const clearDrafts = () => { for (const f of FIELDS[type]) clearDraft(dk(f.key)); };
    const save = (force = false) => {
      const v = values();
      const { errors } = validate(type, v);
      if (Object.keys(errors).length) {
        S.errors = errors; paint();
        toast('有 ' + Object.keys(errors).length + ' 個欄位要修正', true);
        const first = wrap.querySelector('.haserr');
        if (first && first.scrollIntoView) first.scrollIntoView({ block: 'center' });
        return;
      }
      S.errors = {};
      if (!rec) {
        if (!force && (type === 'movie' || type === 'anime')) {
          const dup = findDuplicate(listOf(type), type, v.title, type === 'movie' ? v.originalTitle : '', null);
          if (dup) { showDup(dup, v); return; }
        }
        const typed = fromForm(type, v);
        enqueueRecord({ file: info.file, op: 'create', rtype: type, title: titleOf(type, typed), typed });
        clearDrafts();
        toast('✅ ' + (type === 'fitness-plan' ? '計畫' : '紀錄') + '已存手機｜' + (env.isOffline() ? '沒網路，連上會自動送' : '送出中'));
        S[mod].view = 'list'; S[mod].id = null;
        if (mod === 'fitness') S.fitness.sub = type === 'fitness-plan' ? 'plans' : 'notes';
        render(); window.scrollTo(0, 0);
      } else {
        const { patch, base } = diffForm(type, v, rec);
        if (!Object.keys(patch).length) { toast('沒有修改，不會寫入'); return; }
        enqueueRecord({ file: info.file, op: 'update', rtype: type, id: rec.id, title: titleOf(type, rec), patch, base });
        clearDrafts();
        toast('✅ 修改已存手機｜' + (env.isOffline() ? '沒網路，連上會自動送' : '送出中'));
        go(mod, 'detail', rec.id);
      }
    };
    // 同名提醒：可以改成更新既有那一筆，或仍然新增
    const showDup = (dup, v) => {
      dupBox.replaceChildren(h('section', { class: 'card rconfirm', role: 'alertdialog' },
        h('div', { class: 'rname', text: '已經有《' + dup.title + '》了' }),
        h('div', { class: 'hint', text: (type === 'movie' ? Q.movieLine(dup) : Q.animeLine(dup)) + '。要把這次填的內容更新到那一筆，還是仍要另外新增一筆？' }),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', type: 'button', text: '更新既有那一筆', onclick: () => {
            const typed = fromForm(type, v, dup);
            const patch = {}; const base = {};
            for (const k of Object.keys(typed)) {
              if (k === 'title' || k === 'originalTitle') continue;
              const empty = typed[k] == null || typed[k] === '' || (Array.isArray(typed[k]) && !typed[k].length);
              if (empty || sameJSON(typed[k], dup[k])) continue;
              if (k === 'progress') { const t = typed.progress; if (t.season == null && t.episode == null) continue; }
              patch[k] = typed[k]; base[k] = dup[k] === undefined ? null : dup[k];
            }
            if (!Object.keys(patch).length) { toast('跟既有那一筆內容一樣，不用更新'); return; }
            clearInferred(type, dup, patch, base);
            enqueueRecord({ file: info.file, op: 'update', rtype: type, id: dup.id, title: dup.title, patch, base });
            clearDrafts();
            toast('✅ 已更新既有的《' + dup.title + '》');
            go(mod, 'detail', dup.id);
          } }),
          h('button', { class: 'btn ghost', type: 'button', text: '仍要新增', onclick: () => save(true) }))));
      dupBox.scrollIntoView && dupBox.scrollIntoView({ block: 'center' });
    };
    wrap.append(h('div', { class: 'actions rsave' }, h('button', { class: 'btn wide', type: 'button', text: rec ? '儲存修改' : '儲存', onclick: () => save(false) })));
    return wrap;
  }

  // 動漫各季評分編輯器：每列 季數、評分、觀看日（用「,」分隔）。只改畫面上有的欄位，每一列裡別的鍵（note 等）原樣留著
  function seasonsEditor(jsonText, onChange) {
    let arr = [];
    try { arr = JSON.parse(jsonText || '[]'); } catch (e) { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    const host = h('div', { class: 'rexed rseasons' });
    const commit = () => onChange(arr);
    const numIn = (label, get, setf, mode) => { const x = h('input', { type: 'text', inputmode: mode, placeholder: label, 'aria-label': label }); x.value = get() == null ? '' : String(get()); x.addEventListener('input', () => { const t = x.value.trim(); setf(t === '' ? null : Number.isNaN(Number(t)) ? t : Number(t)); commit(); }); return x; };
    const paint = () => {
      const rows = arr.map((e, i) => {
        const dates = h('input', { type: 'text', placeholder: '觀看日（2026-09-10，多個用逗號）', 'aria-label': '第 ' + (i + 1) + ' 列觀看日', autocomplete: 'off' });
        dates.value = Array.isArray(e.watchedDates) ? e.watchedDates.join(',') : '';
        dates.addEventListener('input', () => { e.watchedDates = dates.value.split(',').map((x) => x.trim()).filter(Boolean); commit(); });
        return h('div', { class: 'rexrow' },
          h('div', { class: 'rexnums' }, numIn('季數', () => e.season, (v) => { e.season = v; }, 'numeric'), numIn('評分 0～10', () => e.score, (v) => { e.score = v; }, 'decimal')), dates,
          h('button', { class: 'btn small ghost', type: 'button', text: '刪除這一季', onclick: () => { arr.splice(i, 1); commit(); paint(); } }));
      });
      host.replaceChildren(...rows, h('button', { class: 'btn small ghost', type: 'button', text: '＋ 新增一季評分', onclick: () => { const mx = arr.reduce((m, e) => Math.max(m, Number.isFinite(e.season) ? e.season : 0), 0); arr.push({ season: mx + 1, score: null, watchedDates: [], note: '' }); commit(); paint(); } }));
    };
    paint();
    return host;
  }

  // 計畫的動作清單編輯器：每列 動作、組數、次數範圍、重量
  function planExercisesEditor(jsonText, onChange) {
    let arr = [];
    try { arr = JSON.parse(jsonText || '[]'); } catch (e) { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    const host = h('div', { class: 'rexed' });
    const names = Q.allExerciseNames(listOf('fitness-session'), listOf('fitness-plan'), catalog());
    const dl = h('datalist', { id: 'ex-names' });
    for (const n of names) dl.append(h('option', { value: n }));
    const nextEid = () => 'e' + (arr.reduce((m, e) => Math.max(m, Number(String(e.eid || '').replace(/\D/g, '')) || 0), 0) + 1);
    const commit = () => onChange(arr);
    const paint = () => {
      const rows = arr.map((e, i) => {
        const name = h('input', { type: 'text', list: 'ex-names', placeholder: '動作名稱', 'aria-label': '動作名稱', autocomplete: 'off' });
        name.value = e.name || '';
        name.addEventListener('input', () => { e.name = name.value; commit(); });
        const num = (label, get, setf) => { const x = h('input', { type: 'text', inputmode: 'decimal', placeholder: label, 'aria-label': label }); x.value = get() == null ? '' : String(get()); x.addEventListener('input', () => { const t = x.value.trim(); setf(t === '' || Number.isNaN(Number(t)) ? null : Number(t)); commit(); }); return x; };
        const tr = e.targetReps || {};
        return h('div', { class: 'rexrow' }, name,
          h('div', { class: 'rexnums' }, num('組數', () => e.targetSets, (v) => { e.targetSets = v; }), num('次數下限', () => tr.min, (v) => { e.targetReps = { ...(e.targetReps || {}), min: v }; }), num('次數上限', () => tr.max, (v) => { e.targetReps = { ...(e.targetReps || {}), max: v }; }), num('重量 kg', () => e.targetWeightKg, (v) => { e.targetWeightKg = v; })),
          h('button', { class: 'btn small ghost', type: 'button', text: '刪除這個動作', onclick: () => { arr.splice(i, 1); commit(); paint(); } }));
      });
      host.replaceChildren(dl, ...rows, h('button', { class: 'btn small ghost', type: 'button', text: '＋ 新增動作', onclick: () => { arr.push({ eid: nextEid(), exerciseKey: null, name: '', targetSets: 3, targetReps: { min: 8, max: 12 }, targetWeightKg: null, restSec: null, note: '' }); commit(); paint(); } }));
    };
    paint();
    return host;
  }

  // 還原草稿（刪掉排隊中的 record 時，內容放回表單草稿）
  function restoreDraft(p) {
    const type = p.rtype;
    if (!TYPE_INFO[type] || type === 'fitness-session') return;
    if (p.op === 'create' && p.record) {
      for (const [k, v] of Object.entries(toForm(type, p.record))) setEdit(draftKey(type, null, k), v);
    } else if (p.op === 'update' && p.patch) {
      const after = toForm(type, { ...(p.base || {}), ...p.patch });
      const before = toForm(type, p.base || {});
      for (const k of Object.keys(after)) if (after[k] !== before[k]) setEdit(draftKey(type, p.id, k), after[k]);
    }
  }

  // ---------- 健身 ----------
  function fitnessView(v) {
    const F = S.fitness;
    if (v === 'train') return trainView(F.id);
    if (v === 'form') return formView(F.sub === 'plans' ? 'fitness-plan' : 'fitness-note', F.id);
    if (v === 'detail') return detailView('fitness', F.id);
    const wrap = h('div');
    wrap.append(chipRow([{ value: 'sessions', label: '訓練' }, { value: 'plans', label: '計畫' }, { value: 'notes', label: '雜記' }], F.sub, (x) => { F.sub = x; F.shown = PAGE; F.archived = false; F.panel = false; render(); }, '健身分頁', false));
    const type = F.sub === 'plans' ? 'fitness-plan' : F.sub === 'notes' ? 'fitness-note' : 'fitness-session';
    const info = itemsOf(type);
    if (info.parseError) { wrap.append(h('div', { class: 'banner err', text: '資料讀不出來：' + info.parseError })); return wrap; }
    const all = info.items;
    const host = h('div', { class: 'rlist' });
    const paint = () => {
      let rows;
      if (F.sub === 'sessions') rows = Q.filterSessions(all, { q: F.q, exercise: F.exercise, from: F.from, to: F.to, archived: F.archived });
      else if (F.sub === 'plans') rows = Q.filterPlans(all, { q: F.q, archived: F.archived });
      else rows = Q.filterNotes(all, { q: F.q, noteType: F.noteType, archived: F.archived });
      const pend = pendOf(type);
      const frag = [];
      if (F.sub === 'sessions' && F.exercise !== 'all') {
        const hist = Q.exerciseHistory(all, F.exercise).slice(0, 5);
        if (hist.length) frag.push(h('div', { class: 'card rhist' }, h('h2', { text: '「' + F.exercise + '」最近的表現' }), ...hist.map((x, i) => h('div', { class: 'rhistrow' }, h('span', { text: x.date }), h('span', { text: x.text }), i < hist.length - 1 && hist[i + 1].top ? h('span', { class: 'hint', text: x.top - hist[i + 1].top === 0 ? '重量持平' : (x.top - hist[i + 1].top > 0 ? '▲ ' : '▼ ') + Math.abs(Math.round((x.top - hist[i + 1].top) * 100) / 100) + 'kg' }) : null))));
      }
      if (!rows.length) {
        const mk = F.sub === 'plans' ? () => { F.type = 'fitness-plan'; go('fitness', 'form', null); } : F.sub === 'notes' ? () => { F.type = 'fitness-note'; go('fitness', 'form', null); } : () => { F.start = true; render(); };
        frag.push(emptyBox(F.archived ? '封存區是空的。' : all.length ? '沒有符合的紀錄。' : info.missing ? '這個資料檔還沒有建立。' : F.sub === 'plans' ? '還沒有訓練計畫。' : F.sub === 'notes' ? '還沒有健身雜記。' : '還沒有訓練紀錄。', F.archived || !editable() ? null : newBtn('開始記錄', mk)));
      }
      for (const r of rows.slice(0, F.shown)) frag.push(fitnessCard(type, r, pend, F.archived));
      if (rows.length > F.shown) frag.push(h('button', { class: 'btn ghost wide', type: 'button', text: '顯示更多（還有 ' + (rows.length - F.shown) + ' 筆）', onclick: () => { F.shown += PAGE; paint(); } }));
      host.replaceChildren(...frag);
      return rows.length;
    };
    // 面板內容：訓練＝動作、日期範圍；雜記＝類型；最後都有封存區
    const sheetBody = () => {
      const body = [];
      const na = Q.archivedOf(all).length;
      if (F.sub === 'sessions') {
        const names = Q.allExerciseNames(all, listOf('fitness-plan'), catalog());
        const sel = h('select', { 'aria-label': '依動作篩選', class: 'rsel' }, h('option', { value: 'all', text: '全部動作' }), ...names.map((n) => h('option', { value: n, text: n })));
        sel.value = F.exercise;
        sel.addEventListener('change', () => { pickKey = DONE_KEY; F.exercise = sel.value; F.shown = PAGE; chrome.refresh(); });
        const from = h('input', { type: 'date', 'aria-label': '從日期' }); from.value = F.from;
        const to = h('input', { type: 'date', 'aria-label': '到日期' }); to.value = F.to;
        from.addEventListener('change', () => { pickKey = DONE_KEY; F.from = from.value; F.shown = PAGE; chrome.refresh(); });
        to.addEventListener('change', () => { pickKey = DONE_KEY; F.to = to.value; F.shown = PAGE; chrome.refresh(); });
        body.push(sheetSec('動作', sel), sheetSec('日期', h('div', { class: 'rdaterange' }, from, h('span', { class: 'hint', text: '～' }), to)));
      }
      if (F.sub === 'notes') body.push(sheetSec('雜記類型', chipRow([{ value: 'all', label: '全部' }, ...ENUMS.noteType], F.noteType, (x) => { F.noteType = x; F.shown = PAGE; chrome.refresh(); }, '雜記類型')));
      body.push(sheetSec('其他', h('div', { class: 'chips wrap' }, h('button', { class: 'chip' + (F.archived ? ' active' : ''), type: 'button', text: F.archived ? '‹ 回到清單' : '封存區 ' + na, 'aria-pressed': F.archived ? 'true' : 'false', 'data-fkey': fkey('其他', 'archived'), onclick: () => { pickKey = fkey('其他', 'archived'); F.archived = !F.archived; F.shown = PAGE; chrome.refresh(); } }))));
      return body;
    };
    const plans = listOf('fitness-plan');
    let summary = '';
    if (F.sub === 'sessions') {
      const st = Q.fitnessStats(all, env.now());
      if (Q.live(all).length) summary = '本週 ' + Q.fitnessSummary(all, plans, env.now()).week + ' · 本月 ' + st.month + ' · 總量 ' + st.volumeMonth + ' kg';
    } else summary = F.sub === 'plans' ? '可暫停，不影響歷史紀錄' : '體重、InBody、疼痛、裝備、心得';
    const onNew = F.sub === 'plans' ? () => { F.type = 'fitness-plan'; go('fitness', 'form', null); } : F.sub === 'notes' ? () => { F.type = 'fitness-note'; go('fitness', 'form', null); } : null;
    if (F.sub === 'sessions') wrap.append(sessionsHead(F, all));
    const chrome = listChrome({ type, st: F, placeholder: F.sub === 'sessions' ? '搜尋動作、備註' : '搜尋', onNew, newLabel: F.sub === 'plans' ? '新增計畫' : '新增雜記', summary, sheetBody, paint });
    wrap.append(...chrome.nodes, host);
    return wrap;
  }
  function fitnessCard(type, r, pend, inArchive) {
    const box = recordCard(type, r, pend, inArchive);
    return box;
  }

  // 訓練頁最上面：開始訓練（一排緊湊的鍵）。統計已經併進清單上方那一行小字
  function sessionsHead(F, sessions) {
    const box = h('div');
    const plans = listOf('fitness-plan');
    const prog = Q.live(sessions).filter((s) => s.status === 'in_progress');
    if (editable()) {
      const card = h('section', { class: 'card rstart', 'aria-label': '開始訓練' });
      const hasDraft2 = hasDraft(draftKey('fitness-session', null, 'exercises')) && (getDraft(draftKey('fitness-session', null, 'exercises')) || '[]') !== '[]';
      if (prog.length) for (const s of prog) card.append(h('button', { class: 'btn wide', type: 'button', text: '繼續進行中的訓練（' + s.date + '）', onclick: () => { F.id = s.id; F.view = 'train'; S.tr = null; render(); window.scrollTo(0, 0); } }));
      if (hasDraft2) card.append(h('button', { class: 'btn wide', type: 'button', text: '繼續上次沒存的訓練草稿', onclick: () => { F.id = null; F.view = 'train'; S.tr = null; render(); window.scrollTo(0, 0); } }));
      const today = Q.plansForToday(plans, env.now());
      const act = Q.live(plans).filter((p) => p.active !== false && p.kind !== 'addon');
      const showAll = F.start || !today.length;
      const row = h('div', { class: 'rstartrow' });
      for (const p of (showAll ? [...today, ...act.filter((x) => !today.includes(x))] : today)) row.append(h('button', { class: 'btn ghost rplanbtn', type: 'button', text: '▶ ' + p.name + (today.includes(p) ? '（今天）' : ''), onclick: () => startTraining(p) }));
      row.append(h('button', { class: 'btn ghost', type: 'button', text: '自由開始', onclick: () => startTraining(null) }));
      card.append(h('div', { class: 'hint', text: today.length ? '開始訓練（今天的計畫）' : plans.length ? '開始訓練（今天沒有排計畫，可以選別的或自由開始）' : '開始訓練（還沒有計畫，可以自由開始，或到「計畫」分頁建立）' }), row);
      if (hasDraft2) card.append(h('div', { class: 'hint', text: '開始新的訓練會取代目前沒存的草稿。' }));
      box.append(card);
    }
    return box;
  }

  function startTraining(plan) {
    if (!guardLive()) return;
    const T = 'fitness-session';
    const ex = plan ? (plan.exercises || []).filter((e) => e && e.name).map((e, i) => ({
      eid: 'e' + (i + 1), exerciseKey: e.exerciseKey || null, name: e.name, sets: [], load: null, note: '', raw: null, parse: { status: 'user', rule: 'app' },
      target: { sets: e.targetSets == null ? null : e.targetSets, repsMin: e.targetReps ? e.targetReps.min : null, repsMax: e.targetReps ? e.targetReps.max : null, weightKg: e.targetWeightKg == null ? null : e.targetWeightKg },
    })) : [];
    setEdit(draftKey(T, null, 'date'), todayStr(env.now()));
    setEdit(draftKey(T, null, 'trainingTypes'), plan && plan.trainingType && plan.trainingType !== 'rest' ? plan.trainingType : '');
    setEdit(draftKey(T, null, 'exercises'), JSON.stringify(ex));
    setEdit(draftKey(T, null, 'durationMin'), '');
    setEdit(draftKey(T, null, 'note'), '');
    setEdit(draftKey(T, null, 'fromPlanId'), plan ? plan.id : '');
    setEdit(draftKey(T, null, 'startedAt'), String(Date.now()));
    S.tr = null; S.fitness.id = null; S.fitness.start = false;
    go('fitness', 'train', null);
  }

  // 訓練逐組記錄
  function trainView(sid) {
    const T = 'fitness-session';
    const F = S.fitness;
    const wrap = h('div', { class: 'rtrain' });
    const rec = sid ? findRec(T, sid) : null;
    if (!editable()) { wrap.append(h('div', { class: 'rbar' }, backBtn('訓練', () => go('fitness', 'list'))), emptyBox(PREVIEW_MSG)); return wrap; }
    if (sid && !rec) { wrap.append(h('div', { class: 'rbar' }, backBtn('訓練', () => go('fitness', 'list'))), emptyBox('找不到這次訓練。')); return wrap; }
    const dk = (k) => draftKey(T, sid, k);
    const base = rec ? toForm(T, rec) : { date: todayStr(env.now()), trainingTypes: '', exercises: '[]', durationMin: '', note: '' };
    const val = (k) => (hasDraft(dk(k)) ? getDraft(dk(k)) : base[k] == null ? '' : base[k]);
    // 編輯中的資料放在 S.tr（換頁回來從草稿還原）
    if (!S.tr || S.tr.sid !== sid) {
      let ex = [];
      try { ex = JSON.parse(val('exercises') || '[]'); } catch (e) { ex = []; }
      S.tr = { sid, ex: Array.isArray(ex) ? ex : [] };
    }
    const tr = S.tr;
    const commitEx = () => setEdit(dk('exercises'), JSON.stringify(tr.ex));
    const nextEid = () => 'e' + (tr.ex.reduce((m, e) => Math.max(m, Number(String(e.eid || '').replace(/\D/g, '')) || 0), 0) + 1);
    wrap.append(h('div', { class: 'rbar' }, backBtn('取消（草稿會保留）', () => { toast('訓練草稿已保留在這台手機'); go('fitness', rec ? 'detail' : 'list', rec ? sid : null); }), h('h2', { class: 'rtitle', text: rec ? '編輯訓練' : '訓練中' })));
    // 日期、類型
    const head = h('section', { class: 'card' });
    const date = h('input', { type: 'date', 'aria-label': '訓練日期' }); date.value = val('date');
    date.addEventListener('input', () => setEdit(dk('date'), date.value));
    head.append(h('label', { text: '日期 *' }), date, h('label', { text: '訓練類型（可複選）' }));
    const typeHost = h('div');
    const paintTypes = () => typeHost.replaceChildren(chipRow(ENUMS.trainingType, splitMulti(val('trainingTypes')), (x) => { const a = splitMulti(val('trainingTypes')); setEdit(dk('trainingTypes'), (a.includes(x) ? a.filter((y) => y !== x) : [...a, x]).join(',')); paintTypes(); }, '訓練類型'));
    paintTypes();
    head.append(typeHost);
    wrap.append(head);
    // 動作
    const exHost = h('div', { class: 'rexlist' });
    const sessions = listOf(T);
    const names = Q.allExerciseNames(sessions, listOf('fitness-plan'), catalog());
    const dl = h('datalist', { id: 'tr-names' });
    for (const n of names) dl.append(h('option', { value: n }));
    const paintEx = () => {
      const cards = tr.ex.map((e, ei) => exerciseCard(e, ei));
      exHost.replaceChildren(dl, ...cards, h('section', { class: 'card' }, h('h2', { text: '加一個動作' }), addExerciseRow()));
    };
    const addExerciseRow = () => {
      const name = h('input', { type: 'text', list: 'tr-names', placeholder: '動作名稱（可選建議或自己打）', 'aria-label': '新增動作名稱', autocomplete: 'off' });
      return h('div', { class: 'rexadd' }, name, h('button', { class: 'btn small', type: 'button', text: '加入', onclick: () => {
        const n = name.value.trim();
        if (!n) { toast('先填動作名稱', true); return; }
        tr.ex.push({ eid: nextEid(), exerciseKey: null, name: n, sets: [], load: null, note: '', raw: null, parse: { status: 'user', rule: 'app' } });
        commitEx(); paintEx();
      } }));
    };
    const exerciseCard = (e, ei) => {
      const last = Q.lastExercise(sessions, e.name, sid, val('date'));
      const box = h('section', { class: 'card rex' });
      box.append(h('div', { class: 'rexhead' }, h('h2', { class: 'rexname', text: e.name }), h('button', { class: 'btn small ghost', type: 'button', text: '移除', 'aria-label': '移除動作 ' + e.name, onclick: () => { tr.ex.splice(ei, 1); commitEx(); paintEx(); } })));
      if (e.target && (e.target.sets || e.target.repsMin || e.target.weightKg)) box.append(h('div', { class: 'hint', text: '目標：' + (e.target.sets ? e.target.sets + ' 組' : '') + (e.target.repsMin ? ' × ' + e.target.repsMin + (e.target.repsMax && e.target.repsMax !== e.target.repsMin ? '～' + e.target.repsMax : '') + ' 下' : '') + (e.target.weightKg ? ' @ ' + e.target.weightKg + 'kg' : '') }));
      box.append(h('div', { class: 'hint rlast', text: last ? '上次（' + last.date + '）：' + last.text : '還沒有這個動作的上一次紀錄' }));
      e.sets = Array.isArray(e.sets) ? e.sets : [];
      e.sets.forEach((s, si) => {
        // 勾「單手」時，這一格填的是單手重量（存 perHandKg），總重 weightKg 跟著算成 2 倍（總量、最高重量照舊用總重）；沒勾就只動 weightKg。兩個值不會各改各的
        const handOn = s.perHandKg !== undefined;
        const w = h('input', { type: 'text', inputmode: 'decimal', placeholder: handOn ? '單手 kg' : 'kg', 'aria-label': '第 ' + (si + 1) + ' 組' + (handOn ? '單手重量' : '重量'), class: 'rsetin' });
        w.value = handOn ? (s.perHandKg == null ? '' : String(s.perHandKg)) : s.weightKg == null ? '' : String(s.weightKg);
        w.addEventListener('input', () => {
          const t = w.value.trim(); const n = t === '' || Number.isNaN(Number(t)) ? null : Number(t);
          if (s.perHandKg !== undefined) { s.perHandKg = n; s.weightKg = n == null ? null : Math.round(n * 2 * 100) / 100; } else s.weightKg = n;
          commitEx();
        });
        const r = h('input', { type: 'text', inputmode: 'numeric', placeholder: '次數', 'aria-label': '第 ' + (si + 1) + ' 組次數', class: 'rsetin' });
        r.value = s.reps == null ? '' : String(s.reps);
        r.addEventListener('input', () => { const t = r.value.trim(); s.reps = t === '' || Number.isNaN(Number(t)) ? null : Math.round(Number(t) * 2) / 2; commitEx(); });
        const modeBtn = h('button', { class: 'chip rmode mode-' + setMode(s), type: 'button', text: labelOfMode(setMode(s)), 'aria-label': '第 ' + (si + 1) + ' 組類型：' + labelOfMode(setMode(s)) + '，點一下切換', onclick: () => {
          const order = SET_MODES.map((m) => m.value);
          const nx = order[(order.indexOf(setMode(s)) + 1) % order.length];
          e.sets[si] = applyMode(s, nx); commitEx(); paintEx();
        } });
        const sideBtn = h('button', { class: 'chip rflag' + (s.perSide ? ' active' : ''), type: 'button', text: '左右各', 'aria-pressed': s.perSide ? 'true' : 'false', 'aria-label': '第 ' + (si + 1) + ' 組：次數是左右各做幾下', onclick: () => { s.perSide = !s.perSide; commitEx(); paintEx(); } });
        const handBtn = h('button', { class: 'chip rflag' + (handOn ? ' active' : ''), type: 'button', text: '單手', 'aria-pressed': handOn ? 'true' : 'false', 'aria-label': '第 ' + (si + 1) + ' 組：重量是單手重量', onclick: () => {
          if (handOn) delete s.perHandKg; // 取消：總重 weightKg 留著，輸入格改回填總重
          else { s.perHandKg = Number.isFinite(s.weightKg) ? Math.round((s.weightKg / 2) * 100) / 100 : null; } // 打開：原本填的總重當成兩手合計，單手＝一半
          commitEx(); paintEx();
        } });
        box.append(h('div', { class: 'rset' }, h('span', { class: 'rsetn', text: String(si + 1) }), w, h('span', { class: 'hint', text: 'kg ×' }), r, modeBtn,
          h('button', { class: 'chip rdel', type: 'button', text: '✕', 'aria-label': '刪除第 ' + (si + 1) + ' 組', onclick: () => { e.sets.splice(si, 1); e.sets.forEach((x, i) => { x.n = i + 1; }); commitEx(); paintEx(); } })));
        box.append(h('div', { class: 'rsetflags' }, sideBtn, handBtn));
      });
      box.append(h('button', { class: 'btn small rsetadd', type: 'button', text: e.sets.length ? '＋ 新增一組（帶入上一組）' : '＋ 新增一組', onclick: () => {
        const prev = e.sets[e.sets.length - 1];
        const src = prev || (last && last.sets.length ? last.sets[0] : null);
        const seed = prev ? { weightKg: prev.weightKg, reps: prev.reps, kind: prev.kind === 'warmup' ? 'working' : prev.kind } : last && last.sets.length ? { weightKg: last.sets[0].weightKg, reps: last.sets[0].reps, kind: 'working' } : { weightKg: null, reps: null, kind: 'working' };
        const ns = { n: e.sets.length + 1, reps: seed.reps == null ? null : seed.reps, weightKg: seed.weightKg == null ? null : seed.weightKg, side: 'both', kind: seed.kind || 'working', failure: false, rpe: null };
        if (src && src.perSide) ns.perSide = true; // 帶入上一組時，「左右各」「單手」也跟著帶
        if (src && Number.isFinite(src.perHandKg)) ns.perHandKg = src.perHandKg;
        e.sets.push(ns);
        commitEx(); paintEx();
      } }));
      return box;
    };
    paintEx();
    wrap.append(exHost);
    // 時長、備註、儲存
    const foot = h('section', { class: 'card' });
    const dur = h('input', { type: 'text', inputmode: 'numeric', placeholder: '分鐘（選填）', 'aria-label': '總時長（分鐘）' }); dur.value = val('durationMin');
    dur.addEventListener('input', () => setEdit(dk('durationMin'), dur.value));
    const note = h('textarea', { rows: 2, placeholder: '備註（選填）', 'aria-label': '備註' }); note.value = val('note');
    note.addEventListener('input', () => setEdit(dk('note'), note.value));
    foot.append(h('label', { text: '總時長（分鐘）' }), dur, h('label', { text: '備註' }), note);
    wrap.append(foot);
    const finish = (status) => {
      if (!date.value) { toast('日期要填', true); return; }
      if (!tr.ex.length) { toast('至少要有一個動作', true); return; }
      let dmin = val('durationMin').trim();
      if (status === 'done' && dmin === '') {
        const t0 = Number(getDraft(dk('startedAt')) || getDraft(draftKey(T, null, 'startedAt')));
        const m = t0 ? Math.round((Date.now() - t0) / 60000) : 0;
        if (m >= 1 && m <= 600) dmin = String(m);
      }
      const v = { date: val('date'), trainingTypes: val('trainingTypes'), exercises: JSON.stringify(tr.ex), durationMin: dmin, note: val('note') };
      const { errors } = validate(T, v);
      if (Object.keys(errors).length) { toast(Object.values(errors)[0], true); return; }
      const typed = { ...fromForm(T, v, rec), status };
      const fromPlanId = getDraft(dk('fromPlanId')) || getDraft(draftKey(T, null, 'fromPlanId'));
      if (!rec) {
        if (fromPlanId) typed.fromPlanId = fromPlanId;
        const item = enqueueRecord({ file: TYPE_INFO[T].file, op: 'create', rtype: T, title: titleOf(T, typed), typed });
        for (const k of ['date', 'trainingTypes', 'exercises', 'durationMin', 'note', 'fromPlanId', 'startedAt']) clearDraft(draftKey(T, null, k));
        S.tr = null;
        toast(status === 'done' ? '✅ 訓練完成，已存手機' : '已中途儲存（進行中），可以隨時繼續');
        F.type = T;
        if (status === 'done') go('fitness', 'detail', item.payload.id); else { F.id = item.payload.id; F.view = 'train'; render(); }
      } else {
        const patch = {}; const baseV = {};
        for (const k of Object.keys(typed)) if (!sameJSON(typed[k], rec[k] === undefined ? null : rec[k])) { patch[k] = typed[k]; baseV[k] = rec[k] === undefined ? null : rec[k]; }
        if (Object.keys(patch).length) enqueueRecord({ file: TYPE_INFO[T].file, op: 'update', rtype: T, id: rec.id, title: titleOf(T, rec), patch, base: baseV });
        for (const k of ['date', 'trainingTypes', 'exercises', 'durationMin', 'note', 'fromPlanId']) clearDraft(dk(k));
        S.tr = null;
        toast(status === 'done' ? '✅ 訓練完成，已存手機' : '已中途儲存');
        F.type = T;
        if (status === 'done') go('fitness', 'detail', rec.id); else render();
      }
    };
    wrap.append(h('div', { class: 'actions rsave' }, h('button', { class: 'btn ghost', type: 'button', text: '中途儲存', onclick: () => finish('in_progress') }), h('button', { class: 'btn', type: 'button', text: '完成訓練', onclick: () => finish('done') })));
    return wrap;
  }
  const labelOfMode = (m) => (SET_MODES.find((x) => x.value === m) || {}).label || m;

  // 訓練詳細頁下面：各動作的組數、完成摘要
  function sessionDetailExtra(r) {
    const box = h('div');
    const sum = Q.sessionSummary(r, listOf('fitness-session'));
    const sc = h('section', { class: 'card rsummary' }, h('h2', { text: '訓練摘要' }),
      h('div', { class: 'rstats' }, stat(sum.exercises, '動作'), stat(sum.sets, '組數'), stat(sum.volume, '總量 kg')));
    for (const d of sum.diffs.slice(0, 8)) { const u = d.hand ? '單手 ' : ''; sc.append(h('div', { class: 'hint', text: d.name + '：最高 ' + u + d.now + 'kg（上次 ' + d.last + ' 是 ' + u + d.before + 'kg' + (d.delta ? '，' + (d.delta > 0 ? '+' : '') + d.delta : '，持平') + '）' })); }
    const sn = Q.sessionSetNotes(r);
    if (sn.perSide || sn.perHand) sc.append(h('div', { class: 'hint', text: '這次有' + [sn.perSide ? '左右各的 ' + sn.perSide + ' 組' : '', sn.perHand ? '單手重量的 ' + sn.perHand + ' 組' : ''].filter(Boolean).join('、') + '（總量照總重算）' }));
    box.append(sc);
    const exc = h('section', { class: 'card' }, h('h2', { text: '動作與組數' }));
    for (const e of Q.exerciseLines(r)) {
      exc.append(h('div', { class: 'rexshow' }, h('div', { class: 'rname', text: e.name }), h('div', { class: 'hint', text: e.text + (e.old ? '（舊資料，待確認）' : '') })));
    }
    if (!(r.exercises || []).length) exc.append(h('div', { class: 'hint', text: '沒有動作紀錄' }));
    box.append(exc);
    return box;
  }
  function planDetailExtra(r) {
    const exc = h('section', { class: 'card' }, h('h2', { text: '動作清單' }));
    for (const e of r.exercises || []) {
      const t = e.targetReps || {};
      exc.append(h('div', { class: 'rexshow' }, h('div', { class: 'rname', text: e.name || '（沒有名稱）' }), h('div', { class: 'hint', text: [e.targetSets ? e.targetSets + ' 組' : '', t.min ? t.min + (t.max && t.max !== t.min ? '～' + t.max : '') + ' 下' : '', e.targetWeightKg ? e.targetWeightKg + 'kg' : '', e.note || ''].filter(Boolean).join('｜') || '（沒有目標）' })));
    }
    if (!(r.exercises || []).length) exc.append(h('div', { class: 'hint', text: '還沒有動作' }));
    if (editable() && !r.archived && r.active !== false && r.kind !== 'addon') exc.append(h('button', { class: 'btn wide', type: 'button', text: '從這個計畫開始訓練', onclick: () => startTraining(r) }));
    return exc;
  }

  // 回到某個模組的清單（頂端分頁再點一次、底部「紀錄」再點一次用）；日記、筆記沒有詳情頁，不做事
  function backToList(mod) {
    if (!S[mod]) return;
    S[mod].view = 'list'; S[mod].id = null; S.errors = {}; S.dupOk = false; S.confirm = null;
  }

  return { viewModule, openRecord, backToList, restoreDraft, _state: S };
}
