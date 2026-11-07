import { needsFor } from './needs.js';
// P74 Phase 1 S3：對話、提問回答、交辦操作改讀寫結構化 JSON（hub v2）。純函式＋可注入的 source／client，Node 可測。
// 介面約定：Agent\docs\專案紀錄\P74_Phase1_hub_v2_介面.md（§2、§3、§6、§7、§9）。schema 內嵌在 hub_schema.js（來源 schema/hub-v2）。
//
//   手機寫：signal/hub/in/<id>.json（msg｜answer｜order_op，只新建）　電腦寫：signal/hub/view.json、history.json、config.json
//   讀不到、壞掉、設定要退回 → 整個對話流程退回舊的 Live.md（lib/chat.js）。畫面元件不動：這裡把 view 轉成跟 parseThreads() 同形狀的 threads。
import { TWDate as Date } from './tz.js';
import { SCHEMAS } from './hub_schema.js';
import { parseReply, orderIntent } from './p72home.js';
import { isWorkText } from './p72.js';
import { parseQuote } from './quote.js';
import { readChatStatus, STATE_ORDER } from './chatstatus.js';
import { GitHubError, HUB_IN_PREFIX, SIGNAL_BRANCH } from './github.js';

// ---------- 驗證器：只支援 schema 用到的關鍵字（見 schema/hub-v2/README.md）----------
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const cpLen = (s) => [...s].length; // 數 Unicode 字元（code point），不是 UTF-16 單位
const isType = (t, v) => {
  switch (t) {
    case 'string': return typeof v === 'string';
    case 'integer': return typeof v === 'number' && Number.isInteger(v); // 布林在 JS 不是 number，不用另外排除
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'boolean': return typeof v === 'boolean';
    case 'null': return v === null;
    case 'object': return isObj(v);
    case 'array': return Array.isArray(v);
    default: return false;
  }
};
const same = (a, b) => typeof a === typeof b && a === b; // true 不等於 1

function walk(s, v, p, errs) {
  if (!isObj(s)) return;
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => isType(t, v))) { errs.push(p + '：型別應為 ' + types.join('／')); return; }
  }
  if (Object.prototype.hasOwnProperty.call(s, 'const') && !same(s.const, v)) errs.push(p + '：應該是 ' + JSON.stringify(s.const));
  if (Array.isArray(s.enum) && !s.enum.some((e) => same(e, v))) errs.push(p + '：不在允許的值裡');
  if (typeof v === 'string') {
    if (s.minLength !== undefined && cpLen(v) < s.minLength) errs.push(p + '：太短');
    if (s.maxLength !== undefined && cpLen(v) > s.maxLength) errs.push(p + '：超過 ' + s.maxLength + ' 字');
    if (s.pattern !== undefined && !new RegExp(s.pattern).test(v)) errs.push(p + '：格式不符');
  }
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) errs.push(p + '：小於 ' + s.minimum);
    if (s.maximum !== undefined && v > s.maximum) errs.push(p + '：大於 ' + s.maximum);
  }
  if (isObj(v)) {
    for (const k of s.required || []) if (!Object.prototype.hasOwnProperty.call(v, k)) errs.push(p + '：缺 ' + k);
    for (const [k, sub] of Object.entries(s.properties || {})) if (Object.prototype.hasOwnProperty.call(v, k)) walk(sub, v[k], p + '.' + k, errs);
  }
  if (Array.isArray(v) && s.items) v.forEach((x, i) => walk(s.items, x, p + '[' + i + ']', errs));
}

// 回傳錯誤文字陣列；空陣列＝通過
export function validate(schema, value) {
  const errs = [];
  walk(schema, value, '$', errs);
  return errs;
}

const OUT_KINDS = ['msg', 'answer', 'order_op'];
// 整份文件檢查：msg／answer／order_op 先過外殼再過自己的 schema＋語意規則；view／history／config 只過自己的 schema。回傳 {ok, kind, errors}
export function checkDoc(doc) {
  if (!isObj(doc)) return { ok: false, kind: '', errors: ['不是 JSON 物件'] };
  const kind = typeof doc.kind === 'string' ? doc.kind : '';
  if (!Object.prototype.hasOwnProperty.call(SCHEMAS, kind) || kind === 'envelope') return { ok: false, kind, errors: ['不認得的 kind：' + String(doc.kind)] };
  const errors = [];
  if (OUT_KINDS.includes(kind)) errors.push(...validate(SCHEMAS.envelope, doc));
  errors.push(...validate(SCHEMAS[kind], doc));
  // JSON Schema 子集表達不了的語意規則（README「驗證器管不到的規則」）
  if (!errors.length) {
    if (kind === 'order_op' && doc.op === 'judge' && typeof doc.yes !== 'boolean') errors.push('judge 時 yes 必須是布林');
    if (kind === 'msg' && doc.role !== 'user') errors.push('手機寫的 msg，role 必須是 user');
  }
  return { ok: errors.length === 0, kind, errors };
}
// 給交叉一致性測試：字串 → {ok}（JSON 壞＝不通過）
export function checkText(text) {
  let j;
  try { j = JSON.parse(String(text)); } catch (e) { return { ok: false, kind: '', errors: ['不是合法的 JSON'] }; }
  return checkDoc(j);
}

// ---------- 時間與編號 ----------
const pad2 = (n) => String(n).padStart(2, '0');
// 毫秒 → 台北時間 ISO 8601（帶 +08:00），重送同一筆時內容不變
export function isoTaipei(ms) {
  const d = new globalThis.Date(ms + 8 * 3600 * 1000);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) + 'T' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds()) + '+08:00';
}
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
function randomId(prefix, rand) {
  let r = rand;
  if (!r) {
    r = (n) => {
      const c = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : null;
      return c ? c.getRandomValues(new Uint32Array(1))[0] % n : Math.floor(Math.random() * n);
    };
  }
  let s = prefix;
  for (let i = 0; i < 8; i++) s += ALPHABET[r(ALPHABET.length)];
  return s;
}
export const newMsgId = (rand) => randomId('m-', rand); // 留言：m- 加 8 碼小寫英數（跟手機既有編號同一格式）
export const newXId = (rand) => randomId('x-', rand); // 回答、交辦操作：x- 加 8 碼小寫英數
// 同一筆寫入紀錄永遠對到同一個 x- 編號（重送去重）：m- 後面剛好 8 碼小寫英數就沿用，否則用雜湊
export function xIdFor(itemId) {
  const suf = String(itemId || '').replace(/^m-/, '').toLowerCase();
  if (/^[a-z0-9]{8}$/.test(suf)) return 'x-' + suf;
  let h = 2166136261;
  for (const ch of String(itemId)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return 'x-' + h.toString(36).padStart(8, '0').slice(-8);
}
export const inPath = (id) => HUB_IN_PREFIX + id + '.json';

// ---------- 手機寫入：outbox 的 chat 項目 → in/ 檔 ----------
function blocked(message, code) {
  const e = new Error(message);
  e.blocked = true; e.code = code;
  return e;
}
// 標了工作（needs=local_login）的留言：只走加密留言（Q394④）。任何情況都不寫 GitHub（signal/hub/in、Live.md），也不進快答。
// 加密通道不通（沒憑證、relay 失敗、離線）就丟 waitCloud 錯誤，outbox 把它放回排隊等（classifyError：code=waitcloud）
export const isWorkItem = (item) => !!item && !!item.payload && item.payload.needs === 'local_login';
export function waitCloudError(why = '') {
  const e = new Error('等加密通道，通道恢復後會自動送' + (why ? '（' + why + '）' : ''));
  e.waitCloud = true;
  return e;
}
const clipCp = (s, n) => [...String(s)].slice(0, n).join('');
const TEXT_MAX = 4000;
const NOTE_MAX = 400;

// item：{id, payload:{content, hubReply?, hubOpt?}, createdAt}。
//   payload.hubReply＝按選項、OK、是／不是、還有問題這幾個按鈕送的（內容是 ↩a-／↩o- 前綴）→ answer／order_op 檔，不再寫 ↩…｜ 行；
//   其他（含手打的 ↩…｜ 留言）一律是 msg；引用 ↩m-xxxx｜ 拆成 reply_to。回傳 {kind, id, path, doc, text}；內容不合格丟 blocked 錯誤
export function buildHubFile(item, { dev = 'pwa' } = {}) {
  const p = (item && item.payload) || {};
  const content = String(p.content == null ? '' : p.content);
  const at = isoTaipei(item.createdAt);
  let doc = null;
  const rep = p.hubReply ? parseReply(content) : null;
  if (rep && rep.kind === 'ask') {
    if (!rep.text) throw blocked('答案是空的，沒有送出', 'empty');
    doc = { v: 2, id: xIdFor(item.id), kind: 'answer', at, via: 'phone', work: isWorkItem(item), ask: rep.id, opt: Number.isInteger(p.hubOpt) && p.hubOpt >= 1 ? p.hubOpt : null, text: rep.text };
  } else if (rep && rep.kind === 'order') {
    const it = orderIntent(rep.text);
    const op = it === 'ok' ? { op: 'accept', yes: null, note: '' }
      : it === 'yes' ? { op: 'judge', yes: true, note: '' }
        : it === 'no' ? { op: 'judge', yes: false, note: '' }
          : it === 'problem' ? { op: 'reopen', yes: null, note: clipCp(rep.text.replace(/^還有問題\s*[：:]?\s*/, ''), NOTE_MAX) }
            : null;
    if (op) doc = { v: 2, id: xIdFor(item.id), kind: 'order_op', at, via: 'phone', work: isWorkItem(item), order: rep.id, ...op };
  }
  if (!doc) {
    const q = parseQuote(content);
    let text = content;
    let replyTo = null;
    if (q.quote && q.quote.id && /^m-[a-z0-9]{8}$/.test(q.quote.id)) { replyTo = q.quote.id; text = q.head + q.rest; } // schema：reply_to 只收 m- 8 碼小寫；舊格式的編號留在內文 // ↩m-…｜ 拆成 reply_to；↩a-／↩o- 手打的照原樣留在內文，電腦照舊解析
    text = text.trim();
    if (!text) throw blocked('留言是空的，沒有送出', 'empty');
    if (cpLen(text) > TEXT_MAX) throw blocked('這則超過 4,000 字，請分成兩則送', 'toolong');
    doc = { v: 2, id: item.id, kind: 'msg', at, via: 'phone', work: isWorkItem(item), role: 'user', text, thread: null, reply_to: replyTo, by: '你', client_ts: Number.isFinite(item.createdAt) && item.createdAt >= 0 ? Math.floor(item.createdAt) : null, dev };
  }
  const chk = checkDoc(doc);
  if (!chk.ok) throw blocked('寫入內容不符合格式（' + chk.errors[0] + '），沒有送出', 'schema');
  return { kind: doc.kind, id: doc.id, path: inPath(doc.id), doc, text: JSON.stringify(doc) };
}

// 真的寫進 signal/hub/in/：只新建（不帶 sha）。422（已存在，重送）當成功；409 重試（最多 3 次，跟 updateFile 一樣）；其他錯誤往外丟（outbox 分類）
export async function executeHubChat(client, item, { sleep, maxTries = 3, cloud = null, onCloudFallback } = {}) {
  const f = buildHubFile(item);
  if (isWorkItem(item)) { // 工作留言：只有加密通道一條路；失敗就排隊等，絕不退回 GitHub 明文
    if (!cloud) throw waitCloudError('雲端還沒開');
    let result;
    try { result = await cloud.send(String(item.payload?.content || ''), f.id, { hub: f.doc, needs: 'local_login' }); } catch { result = null; }
    if (!result || result.ok !== true) {
      try { onCloudFallback?.('send', 'cloud_unavailable'); } catch { /* 診斷不能擋排隊 */ }
      throw waitCloudError('雲端送不出去');
    }
    return { file: 'hub', path: f.path, text: f.text, changed: true, action: 'created', hubKind: f.kind, via: 'cloud', laptopOnline: result.laptop_online };
  }
  if (cloud) {
    try {
      const result = await cloud.send(String(item.payload?.content || ''), f.id, { hub: f.doc, needs: item.payload?.needs === 'local_login' ? 'local_login' : needsFor(f.doc.text || '', f.kind) }); // 工作膠囊開著：呼叫端明確要求只給電腦
      if (!result || result.ok !== true) throw new Error('cloud_failed');
      return { file: 'hub', path: f.path, text: f.text, changed: true, action: 'created', hubKind: f.kind, via: 'cloud', laptopOnline: result.laptop_online };
    } catch {
      try { onCloudFallback?.('send', 'cloud_unavailable'); } catch { /* 診斷不能擋 GitHub 備援 */ }
    }
  }
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let last = null;
  for (let n = 0; n < maxTries; n++) {
    if (n > 0) await wait(600);
    try {
      await client.putFile(f.path, f.text, undefined, 'phone ' + f.kind + ' (手機 ' + item.id + ')', SIGNAL_BRANCH);
      return { file: 'hub', path: f.path, text: f.text, changed: true, action: 'created', hubKind: f.kind };
    } catch (e) {
      if (e instanceof GitHubError) {
        // 只有「檔案已存在」才算成功（重送）：GitHub 對沒帶 sha 的覆寫回 422 "sha wasn't supplied"。其他 422（Validation Failed、路徑不合格…）是真的寫失敗，照錯誤處理，不能吞掉
        if (isAlreadyExists(e)) return { file: 'hub', path: f.path, text: f.text, changed: false, action: 'noop', hubKind: f.kind };
        if (e.status === 409) { last = e; continue; }
      }
      throw e;
    }
  }
  if (last) last.retryLater = true; // 409（signal 分支同時有別的 commit）重試用完：放回排隊自動再送，不要變成要人按的失敗（outbox.classifyError）
  throw last || new Error('寫入失敗');
}

// 「這個 in/ 檔已經存在」：422 且訊息是缺 sha（檔案存在而我們沒帶 sha），或明講 already exists（422／409）
export function isAlreadyExists(e) {
  if (!(e instanceof GitHubError)) return false;
  const m = String(e.message || '');
  if (e.status === 422) return /["']?sha["']?\s+wasn'?t supplied|already exists/i.test(m);
  return e.status === 409 && /already exists/i.test(m);
}

// ---------- 讀：view.json／history.json／config.json ----------
const CORE_THREAD = (() => {
  const s = SCHEMAS.view.properties.threads.items;
  const props = { ...s.properties };
  for (const k of ['delivery', 'replies', 'via']) delete props[k]; // 這三個是選填、不認得的值照樣放行，下面各自處理
  return { ...s, properties: props };
})();
const REPLY_SCHEMA = SCHEMAS.view.properties.threads.items.properties.replies.items;
const DELIVERY_SCHEMA = SCHEMAS.view.properties.threads.items.properties.delivery;
// 整份的外殼：只檢查必填的 v／kind／at／mode／threads（threads 逐則另外檢查）。選填區塊（host、quota…）不在這裡擋，
// 不認得的值（例如 Phase 2 的 host.active:"vm"）不能讓整份被當成壞掉
const shellOf = (kind) => {
  const s = SCHEMAS[kind];
  const props = { threads: { type: 'array' } };
  for (const k of s.required) if (k !== 'threads') props[k] = s.properties[k];
  return { type: 'object', required: s.required, properties: props };
};
const str = (x) => (typeof x === 'string' ? x : '');
const strOrNull = (x) => (typeof x === 'string' ? x : null);
const timeOk = (s) => Number.isFinite(Date.parse(s));

// 一則 thread 清乾淨：核心欄位不合格 → null（略過那則，bad 計 1）；壞的回覆只丟那一則；delivery 不合格就當沒有
function cleanThread(raw) {
  if (!isObj(raw)) return { t: null, bad: 1 };
  if (validate(CORE_THREAD, raw).length || !timeOk(raw.at)) return { t: null, bad: 1 };
  let bad = 0;
  const replies = [];
  if (Array.isArray(raw.replies)) {
    for (const r of raw.replies) {
      if (!isObj(r) || validate(REPLY_SCHEMA, r).length || !timeOk(r.at)) { bad++; continue; }
      replies.push({ id: r.id, parent: r.parent, role: r.role, text: r.text, at: r.at, by: strOrNull(r.by) });
    }
  }
  const d = isObj(raw.delivery) && !validate(DELIVERY_SCHEMA, raw.delivery).length ? raw.delivery : null;
  return {
    bad,
    t: {
      id: raw.id, role: raw.role, text: raw.text, at: raw.at, by: strOrNull(raw.by), via: str(raw.via), work: raw.work === true, reply_to: strOrNull(raw.reply_to),
      delivery: d ? { state: d.state, delivered_at: strOrNull(d.delivered_at), processing_at: strOrNull(d.processing_at), replied_at: strOrNull(d.replied_at), error: strOrNull(d.error) } : null,
      replies,
    },
  };
}
function cleanThreads(list) {
  const out = [];
  const seen = new Set();
  let bad = 0;
  for (const raw of list) {
    const c = cleanThread(raw);
    bad += c.bad;
    if (!c.t) continue;
    if (seen.has(c.t.id)) { bad++; continue; }
    seen.add(c.t.id);
    out.push(c.t);
  }
  out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)); // 穩定排序：同一時間保持原順序
  return { threads: out, bad };
}

// 選填區塊：不認得的值（例如 Phase 2 的 host.active:"vm"）照樣放行，不能因此壞掉
function readHost(h) {
  if (!isObj(h)) return null;
  return { active: str(h.active) || 'none', laptop_seen_at: strOrNull(h.laptop_seen_at), remote_on: typeof h.remote_on === 'boolean' ? h.remote_on : null };
}
function readQuota(q) {
  if (!isObj(q)) return null;
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const wk = Object.keys(q).find((k) => /(^|_)week_pct$/.test(k)); // 週額度百分比欄位（名稱帶帳號前綴，不寫死）
  return { week_pct: wk ? num(q[wk]) : null, h5_pct: num(q.h5_pct), week_reset: strOrNull(q.week_reset), h5_reset: strOrNull(q.h5_reset), seen_at: strOrNull(q.seen_at) };
}
const readErrors = (e) => (Array.isArray(e) ? e.filter((x) => isObj(x) && typeof x.id === 'string' && typeof x.reason === 'string').slice(0, 20).map((x) => ({ id: x.id, reason: x.reason })) : []);
const readHistoryInfo = (h) => (isObj(h) && Number.isInteger(h.count) && h.count > 0 ? { count: h.count, from: strOrNull(h.from) } : null);

// 回傳 {ok:false, reason} 或 {ok:true, view:{…}, bad}。整份壞（JSON、外殼）→ ok:false；單則壞 → 略過，bad 計數
export function parseView(text) {
  let j;
  try { j = JSON.parse(String(text == null ? '' : text)); } catch (e) { return { ok: false, reason: 'JSON 壞掉' }; }
  const errs = isObj(j) ? validate(shellOf('view'), j) : ['不是 JSON 物件'];
  if (errs.length || j.kind !== 'view') return { ok: false, reason: errs[0] || 'kind 不是 view' };
  const c = cleanThreads(j.threads);
  return {
    ok: true,
    bad: c.bad,
    view: {
      at: j.at, mode: j.mode, source_rev: strOrNull(j.source_rev), threads: c.threads, errors: readErrors(j.errors), history: readHistoryInfo(j.history),
      quota: readQuota(j.quota), host: readHost(j.host), truncated: j.truncated === true,
      inbox: Array.isArray(j.inbox) ? j.inbox.filter((x) => isObj(x) && typeof x.id === 'string') : [],
    },
  };
}

export function parseHistory(text) {
  let j;
  try { j = JSON.parse(String(text == null ? '' : text)); } catch (e) { return { ok: false, reason: 'JSON 壞掉' }; }
  const errs = isObj(j) ? validate(shellOf('history'), j) : ['不是 JSON 物件'];
  if (errs.length || j.kind !== 'history') return { ok: false, reason: errs[0] || 'kind 不是 history' };
  const c = cleanThreads(j.threads);
  return { ok: true, bad: c.bad, threads: c.threads, truncated: j.truncated === true };
}

export function parseConfig(text) {
  let j;
  try { j = JSON.parse(String(text == null ? '' : text)); } catch (e) { return { ok: false, reason: 'JSON 壞掉' }; }
  const errs = validate(SCHEMAS.config, j);
  return errs.length ? { ok: false, reason: errs[0] } : { ok: true, chat_source: j.chat_source };
}

// ---------- chat.source：本機設定＋遠端 config，任一邊是 live 就用 live ----------
export const CHAT_SOURCE_KEY = 'agent.chatsource';
export const normSource = (v) => (v === 'live' ? 'live' : 'json'); // 預設 json
export const effectiveSource = (local, remote) => (normSource(local) === 'live' || remote === 'live' ? 'live' : 'json');

const FALLBACK_TEXT = {
  view_missing: '電腦還沒有發佈 view.json', view_unreadable: '讀不到 view.json', view_bad: 'view.json 壞掉（整份不能用）',
};
export const fallbackText = (reason) => FALLBACK_TEXT[reason] || String(reason || '');

// 檔案回 missing（電腦還沒發佈）之後，同一個檔最多 5 分鐘才再查一次，避免每輪輪詢都多打 404（404 不進 ETag 快取、算 rate limit）。
// 手動重新整理或切回前景呼叫 reset() 馬上恢復；讀到檔案（不是 missing）就解除。讀失敗（網路）不算 missing
export const MISSING_RECHECK_MS = 5 * 60 * 1000;
export function createMissingGate({ ms = MISSING_RECHECK_MS, now = () => Date.now() } = {}) {
  const at = new Map();
  return {
    skip(name) { const t = at.get(name); return t != null && now() - t < ms; },
    note(name, missing) { if (missing) at.set(name, now()); else at.delete(name); },
    reset() { at.clear(); },
  };
}

// 決定這一輪用哪條路並讀資料。source：datasource 的 createSource 結果（read(name)→{text, missing, sha?}）。
//   回傳 {mode:'json'|'live', requested, local, remote, view, viewText, viewSha, bad, fallback:{reason, detail}|null, remoteBad}
//   mode=live 時完全不讀 view（本機或遠端要求 live）；要求 json 但讀不到、壞掉 → 退回 live 並記一筆 fallback
// lastRemote：上一次成功讀到的遠端設定（讀失敗或檔案壞掉時沿用，不當成「沒有要求退回」）；remoteKnown＝這一輪有讀到可用的結果
export async function loadHub({ source, local, lastRemote = null, gate = null }) {
  const out = { mode: 'live', requested: 'json', local: normSource(local), remote: lastRemote, remoteKnown: false, view: null, viewText: '', viewSha: '', configSha: '', bad: 0, fallback: null, remoteBad: '' };
  try {
    if (gate && gate.skip('hub_config')) throw Object.assign(new Error('gated'), { gated: true });
    const r = await source.read('hub_config');
    if (gate) gate.note('hub_config', !!(r.missing || !r.text));
    out.configSha = r.sha || '';
    if (r.missing || !r.text) { out.remote = null; out.remoteKnown = true; } else {
      const c = parseConfig(r.text);
      if (c.ok) { out.remote = c.chat_source; out.remoteKnown = true; } else out.remoteBad = c.reason; // 壞掉的設定沿用上一次成功的值，診斷看得到
    }
  } catch (e) { if (e && e.gated) { out.remote = null; out.remoteKnown = true; } /* 5 分鐘內查過、是 missing：不再查，當作沒有要求；其他讀不到：沿用上一次成功的值（lastRemote），不要來回跳 */ }
  out.requested = effectiveSource(out.local, out.remote);
  if (out.requested === 'live') return out;
  if (gate && gate.skip('hub_view')) { out.fallback = { reason: 'view_missing', detail: '' }; return out; }
  let r;
  try { r = await source.read('hub_view'); } catch (e) {
    out.fallback = { reason: 'view_unreadable', detail: String((e && e.message) || e).slice(0, 120) };
    return out;
  }
  if (gate) gate.note('hub_view', !!(r.missing || !r.text));
  if (r.missing || !r.text) { out.fallback = { reason: 'view_missing', detail: '' }; return out; }
  const v = parseView(r.text);
  if (!v.ok) { out.fallback = { reason: 'view_bad', detail: v.reason }; return out; }
  return { ...out, mode: 'json', view: v.view, viewText: r.text, viewSha: r.sha || '', bad: v.bad };
}

// 診斷用的一小包（只有計數與原因，不放內文）
export function hubDiagInfo(h, fallbacks = []) {
  if (!h) return null;
  return {
    source: h.mode, requested: h.requested, local: h.local, remote: h.remote,
    fallback: h.fallback ? h.fallback.reason : null, fallbackDetail: h.fallback ? String(h.fallback.detail || '').slice(0, 120) : '',
    fallbacks: (fallbacks || []).slice(-10), bad: h.bad || 0, remoteBad: h.remoteBad || '',
    viewErrors: h.view ? h.view.errors.slice(0, 5).map((e) => ({ id: e.id.slice(0, 60), reason: e.reason.slice(0, 120) })) : [],
    viewAt: h.view ? h.view.at : null, history: h.view && h.view.history ? h.view.history.count : 0,
  };
}

// ---------- view → threads（跟 chat.js parseThreads 同形狀，畫面元件不動）----------
const clockOf = (f) => pad2(f.hh) + ':' + pad2(f.mm);
function fieldsOf(ms) {
  const d = new Date(ms);
  return { y: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hh: d.getHours(), mm: d.getMinutes() };
}
const sameDay = (a, b) => a.y === b.y && a.month === b.month && a.day === b.day;
const mdhm = (f) => pad2(f.month) + '-' + pad2(f.day) + ' ' + clockOf(f);

// 引用回覆：reply_to 放回內容最前面（討論對象前綴［…］之後），現有的引用氣泡就能畫。內容已經有引用前綴就不重複加
const CTX_HEAD = /^(［[^］]*］\s*)/;
export function withReplyPrefix(text, replyTo) {
  if (!replyTo || parseQuote(text).quote) return text;
  const m = CTX_HEAD.exec(text);
  const head = m ? m[1] : '';
  return head + '↩' + replyTo + '｜' + text.slice(head.length);
}

function splitFirst(text, keepBlank) {
  const lines = String(text).replace(/\r/g, '').replace(/^\s*\n/, '').split('\n');
  let rest = lines.slice(1);
  if (keepBlank) { while (rest.length && !rest[rest.length - 1].trim()) rest.pop(); while (rest.length && !rest[0].trim()) rest.shift(); } else rest = rest.map((l) => l.trim()).filter(Boolean);
  return { head: lines[0], rest };
}

// items：parseView／parseHistory 清過的 threads（舊到新）。now：判斷「今天」用（台北時間）
export function hubThreads(items, now = new Date()) {
  const today = fieldsOf(now.getTime());
  const out = [];
  (items || []).forEach((t, i) => {
    const f = fieldsOf(Date.parse(t.at));
    const when = { month: f.month, day: f.day, minutes: f.hh * 60 + f.mm, label: mdhm(f) };
    const key = Math.floor(new Date(f.y, f.month - 1, f.day).getTime() / 86400000) * 1440 + when.minutes;
    const mkReply = (r, rel) => {
      const rf = fieldsOf(Date.parse(r.at));
      const sp = splitFirst(r.text, true);
      return {
        id: r.id, role: r.role, by: r.by || '', time: clockOf(rf), text: sp.head, children: sp.rest, indent: 0,
        when: { month: rf.month, day: rf.day, minutes: rf.hh * 60 + rf.mm, label: mdhm(rf) },
        label: sameDay(rf, rel) ? clockOf(rf) : mdhm(rf), // 回覆跟留言同一天只顯示時間，跨日才補 MM-DD（沿用 replyLabels 的效果）
      };
    };
    if (t.role !== 'user') {
      // 沒有掛在留言底下的回覆（Live.md 頂層 ↳）：獨立的 Agent 泡泡。不給 id（引用會用內容片段），編號放 rid
      const rp = mkReply(t, today);
      out.push({ role: 'you', orphan: true, rid: t.id, time: '', note: '', text: '', extra: [], replies: [rp], when: rp.when, key, order: i, hub: true });
      return;
    }
    const sp = splitFirst(t.text, false);
    out.push({
      role: 'you', id: t.id, time: sameDay(f, today) ? clockOf(f) : when.label, note: '', text: withReplyPrefix(sp.head, t.reply_to), extra: sp.rest,
      replies: t.replies.map((r) => mkReply(r, f)), when, key, order: i, by: t.by || '', via: t.via || '', work: t.work === true, hub: true,
    });
  });
  return { threads: out, hidden: 0 };
}

// 「載入更早的對話」：history 接在 view 前面，同編號只留 view 的
export function joinHistory(viewThreads, historyThreads) {
  const have = new Set((viewThreads || []).map((t) => t.id));
  return [...(historyThreads || []).filter((t) => !have.has(t.id)), ...(viewThreads || [])];
}

// ---------- 送達狀態：view 的 delivery 轉成 chat_status.json 的形狀，舊的狀態檔當備援 ----------
// baseText：signal/chat_status.json 原文（可空）。回傳可以直接丟給 readChatStatus 的 JSON 文字。view 有 delivery 的以 view 為準
export function mergeChatStatus(baseText, view) {
  const base = readChatStatus(baseText);
  const msgs = { ...(base ? base.msgs : {}) };
  const rank = (s) => STATE_ORDER.indexOf(s);
  for (const t of (view && view.threads) || []) {
    const d = t.delivery;
    if (!d || !STATE_ORDER.includes(d.state)) continue; // queued／failed：手機端沒有對應的階段（failed 另走 hubFailures）
    const cur = msgs[t.id];
    // 兩邊取比較前面的狀態（queued < delivered < processing < replied）：狀態檔幾秒內就更新，view 要等發佈，舊的 view 不能讓狀態倒退
    const ahead = cur && rank(cur.state) > rank(d.state) ? cur.state : d.state;
    const pick = (k) => (cur && cur[k]) || d[k] || '';
    msgs[t.id] = { state: ahead, delivered_at: pick('delivered_at'), processing_at: pick('processing_at'), replied_at: pick('replied_at') };
  }
  const hostRemote = view && view.host && typeof view.host.remote_on === 'boolean' ? { on: view.host.remote_on, until: '', since: '', stalled_since: '' } : null;
  return JSON.stringify({
    version: 1, updated_at: base && base.updated_at ? base.updated_at : (view && view.at) || '',
    remote: base && base.remote ? base.remote : hostRemote, msgs, intake_alert: base ? base.intake_alert : null, opener: base ? base.opener : null,
  });
}

// ---------- 電腦標 failed 的留言（S6）----------
// 回傳 Map<留言編號, 錯誤文字>。failed 的時間是 delivery 裡最晚的那個時間（沒有就用留言時間）；狀態檔對同一則有更晚的進度（又被收了、處理了），
// 以較新的為準，不算 failed。已經有回覆的也不算。
export function hubFailures(view, baseText) {
  const out = new Map();
  const base = readChatStatus(baseText);
  const ms = (s) => { const t = Date.parse(s); return Number.isFinite(t) ? t : -Infinity; };
  for (const t of (view && view.threads) || []) {
    const d = t.delivery;
    if (!d || d.state !== 'failed' || t.role !== 'user' || (t.replies && t.replies.length)) continue;
    const failAt = Math.max(ms(d.replied_at), ms(d.processing_at), ms(d.delivered_at), ms(t.at));
    const b = base && base.msgs ? base.msgs[t.id] : null;
    if (b && Math.max(ms(b.replied_at), ms(b.processing_at), ms(b.delivered_at)) > failAt) continue;
    out.set(t.id, d.error || '');
  }
  return out;
}

// 失敗的留言可不可以給「重送」：工作類（work:true、被遮成「一件工作…」、含工作字）不給，也不顯示原因文字
export const isWorkThread = (t) => !!t && (t.work === true || /^一件工作/.test(String(t.text || '').trim()) || isWorkText(t.text));

// ---------- 樂觀顯示（M1）----------
// json 模式送出的留言（payload.hub、不是按鈕回送），要等電腦收件、發佈 view 才看得到。判斷「還要不要在對話頁自己畫一個泡泡」：
//   還沒送成功 → 畫；已送出 → 目前的對話串（不論 json 或退回的 Live.md）找得到這個編號才收；找不到就一直畫，不設時限。
//   另一個結束條件：狀態檔（或 view 的 delivery）說電腦已經收到，而且這則留言比 view 範圍的起點還早（被擠進較早的對話了，view 裡不會有）。
// rangeStartMs：目前 view 最早一則的時間；不知道（還沒讀過 view）時呼叫端給「現在往前 3 天」。回傳 true＝要畫
export function optimisticVisible(item, { threads, status, rangeStartMs, now }) {
  if (!item || item.state !== 'sent') return true;
  // 留言比對話視窗還舊、又送出超過 1 小時：已捲出視窗，不是還沒收到。狀態檔只留最近 100 筆，查不到不代表沒處理；
  // 不收的話舊留言會全部冒回對話最後面（11-07 m-32xoxfge）。原始紀錄還在「我寫過的」
  if (Number.isFinite(now) && Number.isFinite(rangeStartMs) && item.createdAt < rangeStartMs && now - item.createdAt > 3600000) return false;
  if (item.payload?.mode === 'auto' && item.result?.via === 'cloud' && item.result.reason === 'cloud_answered') return false;
  if ((threads || []).some((t) => t.id === item.id)) return false;
  const st = status && status.msgs ? status.msgs[item.id] : null;
  if (st && STATE_ORDER.includes(st.state) && Number.isFinite(rangeStartMs) && item.createdAt < rangeStartMs) return false;
  return true;
}
// 這筆 outbox 項目是不是 json 模式送的留言（走 optimisticVisible）。按鈕回送（answer／order_op）不會變成對話串，不在內
export const isHubMsgItem = (item) => !!(item && item.kind === 'chat' && item.payload && item.payload.hub && !item.payload.hubReply);

// ---------- 額度（view.quota → 首頁「個人」那塊用的形狀，lib/quota.js quotaBBlock）----------
export function quotaBFromView(q) {
  if (!q) return null;
  const ms = (s) => { const t = Date.parse(s); return Number.isFinite(t) ? t : null; };
  const out = { label: '', h5: q.h5_pct, h5ResetMs: ms(q.h5_reset), d7: q.week_pct, d7ResetMs: ms(q.week_reset), readMs: ms(q.seen_at) };
  return out.readMs != null && out.h5 != null && out.h5ResetMs != null ? out : null;
}

// ---------- 這一輪對話用哪份資料 ----------
// hub：loadHub 的結果（或從快取重建的 {mode, view}）；json 模式完全不呼叫 parseLive（Live.md 解析），live 模式照舊。
// history：已載入的較早對話（清過的 threads）或 null。parseLive 由呼叫端傳進來（lib/chat.js parseThreads），好讓測試監看「有沒有被呼叫」
export function pickThreads({ hub, history = null, liveText = '', now = new Date(), parseLive }) {
  if (hub && hub.mode === 'json' && hub.view) return hubThreads(joinHistory(hub.view.threads, history), now).threads;
  return parseLive(liveText, now).threads;
}
