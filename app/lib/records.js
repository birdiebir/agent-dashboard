// 紀錄中心的讀寫核心（v5 M3）：純函式。執行端（outbox_exec）和畫面的樂觀疊加用同一個 applyRecordOp，送出前後顯示才會一致。
//
// outbox 的 kind 是 'record'，payload：
//   {file:'records/movies.json', op:'create'|'update'|'archive'|'restore', id, rtype, title,
//    record?(create 用的完整紀錄), patch?(update：{欄位:新值}), base?(update：{欄位:編輯當時的值}), force?}
// 規則：
//   - 紀錄 id 手機新增＝<前綴>-<outbox 編號>（例如 mv-m-k3j9x2ab），重送得到同一個 id，天然去重
//   - lastOpId＝outbox 編號；version 每次修改 +1；updatedAt 用 outbox 的 createdAt（重送內容一樣）
//   - update 逐欄用 base 比對：現值＝新值→略過；現值＝base→套用；其他→衝突（整筆不寫，使用者可選「用我的版本覆蓋」）
//   - 未知欄位、未知的頂層鍵（例如 plans 的 exercises）原樣保留；壞 JSON、超過 900KB、id 重複一律不寫
//   - 序列化固定 JSON.stringify(obj, null, 2) + '\n'（電腦端 indent=2、ensure_ascii=False、結尾換行）
import { RECORD_FILES } from './github.js';
import { TYPE_INFO, typeOfFile, SCHEMA_VERSION, sameJSON, normName } from './records_schema.js';

export const MAX_BYTES = 900 * 1024;
export const PROTECTED = ['id', 'type', 'createdAt', 'version', 'lastOpId'];
export const OPS = ['create', 'update', 'archive', 'restore'];

export const serialize = (obj) => JSON.stringify(obj, null, 2) + '\n';
export const byteLength = (s) => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : unescapeLen(s));
function unescapeLen(s) { let n = 0; for (const ch of s) { const c = ch.codePointAt(0); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; } return n; }

const pad = (n) => String(n).padStart(2, '0');
// ISO-8601 加本地時區（例如 2026-10-29T15:00:00+08:00）
export function isoLocal(ms) {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const sg = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + sg + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
}

// 紀錄中心現在能不能改：schema-version.json 的 mode 是 "live" 才能；其他（preview、沒有這個檔、壞掉）一律唯讀
export function recordsMode(schemaText) {
  if (schemaText == null || String(schemaText).trim() === '') return 'preview';
  try { const j = JSON.parse(schemaText); return j && typeof j === 'object' && j.mode === 'live' ? 'live' : 'preview'; } catch (e) { return 'preview'; }
}

export const newRecordId = (rtype, opId) => TYPE_INFO[rtype].prefix + '-' + opId;

const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const eqv = (a, b) => sameJSON(a, b);

export function emptyDoc(file, nowIso) {
  return { schema: (TYPE_INFO[typeOfFile(file)] || {}).schema || 'records.unknown', schemaVersion: SCHEMA_VERSION, updatedAt: nowIso, items: [] };
}

// 解析一份資料檔文字。回傳 {ok, doc, items} 或 {ok:false, code, message}。text 為 null／空＝檔案還不存在（ok:true, missing:true, 空文件）
export function parseRecords(text) {
  if (text == null || String(text).trim() === '') return { ok: true, missing: true, doc: null, items: [] };
  let doc;
  try { doc = JSON.parse(text); } catch (e) { return fail('parse', '資料檔的格式壞了（不是正確的 JSON），為了安全沒有寫入'); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !Array.isArray(doc.items)) return fail('parse', '資料檔的內容不是預期的格式（缺少 items），為了安全沒有寫入');
  return { ok: true, missing: false, doc, items: doc.items.filter((x) => x && typeof x === 'object') };
}

// 依 id 排序插入（items 照 id 排序，跟電腦端遷移器一致，diff 才乾淨）
function insertSorted(items, rec) {
  let i = items.length;
  while (i > 0 && typeof items[i - 1].id === 'string' && items[i - 1].id > rec.id) i--;
  items.splice(i, 0, rec);
}

// 套用一筆 record 操作。text＝目前檔案內容（null＝檔案不存在）；item＝outbox 項目。
// 回傳 {ok:true, text, changed, action:'created'|'updated'|'archived'|'restored'|'noop', id} 或 {ok:false, code, message, fields?}
// code：file（不在白名單）｜op｜parse｜nofile｜missing｜conflict｜size｜dup｜record｜type｜field
export function applyRecordOp(text, item) {
  const p = (item && item.payload) || {};
  const opId = item && item.id;
  if (!RECORD_FILES.includes(p.file)) return fail('file', '不允許寫入這個檔案：' + p.file);
  if (!OPS.includes(p.op)) return fail('op', '不認得的紀錄操作：' + p.op);
  const nowIso = isoLocal(item.createdAt);
  const parsed = parseRecords(text);
  if (!parsed.ok) return parsed;
  const id = p.id || (p.record && p.record.id);
  if (typeof id !== 'string' || !id) return fail('record', '缺少紀錄編號');
  let doc = parsed.doc;
  if (parsed.missing) {
    if (p.op !== 'create') return fail('nofile', '找不到這個資料檔，沒有可以修改的紀錄');
    doc = emptyDoc(p.file, nowIso);
  }
  const items = doc.items;
  const hits = items.filter((x) => x && x.id === id);
  if (hits.length > 1) return fail('dup', '資料檔裡有兩筆相同編號的紀錄（' + id + '），為了安全沒有寫入，請到電腦確認');
  const cur = hits[0] || null;
  let action = 'noop';

  if (p.op === 'create') {
    if (cur) return { ok: true, text: text == null ? null : text, changed: false, action: 'noop', id }; // 重送：早就建好了
    const rec = p.record;
    if (!rec || typeof rec !== 'object') return fail('record', '缺少要新增的紀錄內容');
    if (rec.type !== typeOfFile(p.file)) return fail('type', '紀錄種類跟資料檔對不上');
    const nr = { ...rec, id, createdAt: rec.createdAt || nowIso, updatedAt: nowIso, lastOpId: opId, version: Number.isInteger(rec.version) && rec.version > 0 ? rec.version : 1, archived: !!rec.archived };
    insertSorted(items, nr);
    action = 'created';
  } else {
    if (!cur) return fail('missing', '找不到這筆紀錄（可能已被改掉），沒有寫入');
    if (cur.lastOpId && cur.lastOpId === opId) return { ok: true, text, changed: false, action: 'noop', id }; // 重送：這筆操作早就套用過了
    let patch;
    let base = null;
    if (p.op === 'update') {
      patch = p.patch && typeof p.patch === 'object' ? p.patch : null;
      if (!patch || !Object.keys(patch).length) return { ok: true, text, changed: false, action: 'noop', id };
      for (const k of Object.keys(patch)) if (PROTECTED.includes(k)) return fail('field', '不能修改欄位：' + k);
      base = p.base && typeof p.base === 'object' ? p.base : {};
    } else if (p.op === 'archive') {
      if (cur.archived === true) return { ok: true, text, changed: false, action: 'noop', id };
      patch = { archived: true, archivedAt: nowIso };
    } else {
      if (cur.archived !== true) return { ok: true, text, changed: false, action: 'noop', id };
      patch = { archived: false, archivedAt: null };
    }
    const todo = [];
    const conflicts = [];
    for (const k of Object.keys(patch)) {
      const now = cur[k];
      if (eqv(now, patch[k])) continue; // 現值已經是新值
      if (p.op === 'update' && !p.force && Object.prototype.hasOwnProperty.call(base, k) && !eqv(now, base[k])) { conflicts.push(k); continue; }
      todo.push(k);
    }
    if (conflicts.length) return fail('conflict', '電腦或別的裝置也改過這筆紀錄的「' + conflicts.join('、') + '」，沒有覆蓋', { fields: conflicts });
    if (!todo.length) return { ok: true, text, changed: false, action: 'noop', id };
    for (const k of todo) cur[k] = patch[k];
    cur.updatedAt = nowIso;
    cur.version = (Number.isInteger(cur.version) ? cur.version : 1) + 1;
    cur.lastOpId = opId;
    action = p.op === 'archive' ? 'archived' : p.op === 'restore' ? 'restored' : 'updated';
  }
  doc.updatedAt = nowIso;
  const out = serialize(doc);
  if (byteLength(out) > MAX_BYTES) return fail('size', '資料檔快到 GitHub 的大小上限了，沒有寫入，請到電腦處理（拆檔）');
  try { JSON.parse(out); } catch (e) { return fail('parse', '寫入前檢查失敗，沒有寫入'); }
  return { ok: true, text: out, changed: out !== text, action, id };
}

// 把 applyRecordOp 的失敗轉成 outbox 認得的 blocked 錯誤（classifyError 看 e.blocked／e.code）
export function blockedFrom(r) {
  const e = new Error(r.message);
  e.blocked = true; e.code = r.code === 'conflict' ? 'conflict' : r.code || 'blocked';
  if (r.fields) e.fields = r.fields;
  return e;
}

// ---------- 排隊中的同一筆操作合併 ----------
// 只併進 state 還是 'queued' 的那一筆（送出中的不能併）。回傳新的 payload，不能併回傳 null
export function mergeRecordOp(existing, payload) {
  if (!existing || existing.kind !== 'record' || existing.state !== 'queued') return null;
  const a = existing.payload || {};
  if (a.file !== payload.file || a.id !== payload.id || payload.op !== 'update') return null;
  if (a.op === 'create') {
    const rec = { ...a.record, ...payload.patch };
    return { ...a, record: rec, title: payload.title || a.title };
  }
  if (a.op === 'update') {
    return { ...a, patch: { ...a.patch, ...payload.patch }, base: { ...payload.base, ...a.base }, force: !!(a.force || payload.force), title: payload.title || a.title }; // base 留最早的值
  }
  return null;
}

// ---------- 樂觀疊加 ----------
// 把還沒進檔案的 record 操作（排隊中、送出中，以及剛送出 2 分鐘內的）疊在檔案內容上。失敗的不疊（在「我寫過的」處理）。
export const OVERLAY_SENT_MS = 120000;
export function overlayText(text, obItems, file, now = Date.now()) {
  const list = obItems
    .filter((x) => x.kind === 'record' && x.payload && x.payload.file === file && (x.state === 'queued' || x.state === 'sending' || (x.state === 'sent' && now - (x.sentAt || x.createdAt) < OVERLAY_SENT_MS)))
    .sort((a, b) => a.createdAt - b.createdAt);
  let cur = text;
  for (const it of list) {
    let r;
    try { r = applyRecordOp(cur, { ...it, payload: { ...it.payload, force: true } }); } catch (e) { continue; } // 疊加時不管衝突：畫面照使用者的操作顯示
    if (r.ok) cur = r.text;
  }
  return cur;
}
// 一個檔案目前要顯示的紀錄（含樂觀疊加）：{items, parseError, missing}
export function effectiveItems(text, obItems, file, now) {
  const base = parseRecords(text);
  if (!base.ok) return { items: [], parseError: base.message, missing: false };
  const t = overlayText(text, obItems, file, now);
  const p = parseRecords(t);
  return { items: p.ok ? p.items : base.items, parseError: '', missing: p.ok ? p.missing : base.missing, doc: p.ok ? p.doc : base.doc };
}
// 還在手機上、尚未寫進檔案的紀錄 id（畫面上標「已存手機」）
export function pendingIds(obItems, file) {
  const s = new Set();
  for (const x of obItems) if (x.kind === 'record' && x.payload && x.payload.file === file && (x.state === 'queued' || x.state === 'sending')) s.add(x.payload.id);
  return s;
}

// ---------- 預覽文字與狀態（我寫過的） ----------
const OP_WORD = { create: '新增', update: '修改', archive: '封存', restore: '復原' };
export function previewOfRecord(p) {
  const t = TYPE_INFO[p.rtype] ? TYPE_INFO[p.rtype].label : '紀錄';
  const name = p.title || (p.record && (p.record.title || p.record.name)) || '';
  return t + '：' + (OP_WORD[p.op] || '寫入') + (name ? '《' + name + '》' : '');
}
// 送出後的狀態：records＝{file: 文字}、fetchedAt＝最後一次抓紀錄檔的時間。回傳 {phase:'handled'|'sent', label}
export function recordPhase(item, texts, fetchedAt) {
  const p = item.payload || {};
  const t = texts ? texts[p.file] : undefined;
  const parsed = t === undefined ? null : parseRecords(t);
  const rec = parsed && parsed.ok ? parsed.items.find((x) => x.id === p.id) : null;
  if (rec && rec.lastOpId === item.id) return { phase: 'handled', label: '已存進紀錄' };
  if (parsed && fetchedAt && fetchedAt >= (item.sentAt || 0)) {
    if (rec) return { phase: 'handled', label: '已存進紀錄（之後這筆又更新過）' };
    return { phase: 'handled', label: '已送出（紀錄檔裡找不到這筆，可能在電腦端被改過）' };
  }
  return { phase: 'sent', label: '已送出' };
}

// ---------- 重複檢查 ----------
export function findDuplicate(items, type, title, originalTitle, excludeId) {
  const keys = [normName(title), normName(originalTitle)].filter(Boolean);
  if (!keys.length) return null;
  for (const r of items) {
    if (r.id === excludeId || r.archived) continue;
    const names = [r.title, r.originalTitle, ...(Array.isArray(r.aliases) ? r.aliases : [])].map(normName).filter(Boolean);
    if (keys.some((k) => names.includes(k))) return r;
  }
  return null;
}
