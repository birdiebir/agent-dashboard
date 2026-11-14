// P62 M4b：Web Push 手機端（純函式，不碰 DOM；subscribe 的瀏覽器物件由呼叫端注入，測試用假的）。
// 寫進 signal/push_sub.json 的格式固定為 {"subs":[...]}，以 endpoint 為鍵去重（電腦端 push_notify.normalize_subs 讀得懂）。
import { TWDate as Date } from './tz.js';
import { VAPID_PUBLIC_KEY } from './push_config.js';

// base64url → Uint8Array（applicationServerKey 要的格式）
export function urlBase64ToUint8Array(s) {
  const b64 = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// 瀏覽器的 PushSubscription（或 toJSON() 的結果）→ 要寫進檔案的一筆。不合格丟錯。created_at 由呼叫端給（outbox 的 createdAt，重送才會一模一樣）
export function subscriptionRecord(sub, deviceLabel, now) {
  const j = sub && typeof sub.toJSON === 'function' ? sub.toJSON() : sub || {};
  const keys = j.keys || {};
  if (typeof j.endpoint !== 'string' || !j.endpoint.startsWith('https://') || !keys.p256dh || !keys.auth) throw new Error('推播訂閱資料不完整');
  return {
    endpoint: j.endpoint,
    keys: { p256dh: String(keys.p256dh), auth: String(keys.auth) },
    label: String(deviceLabel || '').slice(0, 40),
    created_at: new Date(now).toISOString(),
  };
}

// 裝置標籤「Android 2026-11-04」：日期用手機本地日期（toISOString 是 UTC，台灣凌晨 0～8 點會差一天）
export function deviceLabel(userAgent, now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (/Android/i.test(userAgent || '') ? 'Android' : 'Phone') + ' ' + now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate());
}

// 讀檔案文字 → 訂閱清單。沒檔案（null／空字串）＝[]；壞 JSON 回 null（不要在壞檔上改寫）。接受單筆、清單、{subs:[]}
export function parseSubs(text) {
  if (text == null || String(text).trim() === '') return [];
  let raw;
  try { raw = JSON.parse(text); } catch (e) { return null; }
  if (raw && !Array.isArray(raw) && Array.isArray(raw.subs)) raw = raw.subs;
  else if (raw && !Array.isArray(raw) && typeof raw === 'object') raw = [raw];
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    if (!r || typeof r.endpoint !== 'string' || !r.endpoint.startsWith('https://') || seen.has(r.endpoint)) continue;
    seen.add(r.endpoint);
    out.push(r);
  }
  return out;
}

const serialize = (subs) => JSON.stringify({ subs }, null, 2) + '\n';

// 加入或更新一筆（endpoint 相同就取代；金鑰沒變就原樣留著，檔案不變＝noop）。壞檔丟錯（呼叫端轉成 blocked）
export function mergeSub(text, rec) {
  const subs = parseSubs(text);
  if (subs === null) throw new Error('signal/push_sub.json 格式壞了，沒有覆蓋');
  const i = subs.findIndex((s) => s.endpoint === rec.endpoint);
  if (i >= 0) {
    const old = subs[i];
    if (old.keys && old.keys.p256dh === rec.keys.p256dh && old.keys.auth === rec.keys.auth) {
      return text; // 已登記、金鑰沒變：檔案原樣不動（noop）
    }
    subs[i] = rec;
  } else subs.push(rec);
  return serialize(subs);
}

// 拿掉一筆（自己那筆）。不在清單裡＝原樣回傳（noop）
export function removeSub(text, endpoint) {
  const subs = parseSubs(text);
  if (subs === null) throw new Error('signal/push_sub.json 格式壞了，沒有覆蓋');
  const next = subs.filter((s) => s.endpoint !== endpoint);
  if (next.length === subs.length) return text == null ? serialize(subs) : text;
  return serialize(next);
}

// outbox pushsub 的 mutate：payload {action:'add'|'remove', sub:{endpoint,keys,label,created_at}} 或 {action:'remove', endpoint}
export function applyPushOp(text, payload) {
  if (payload && payload.action === 'remove') return removeSub(text, payload.endpoint || (payload.sub && payload.sub.endpoint) || '');
  if (payload && payload.action === 'add' && payload.sub) return mergeSub(text, payload.sub);
  throw new Error('通知訂閱的內容不對');
}

// 向瀏覽器訂閱。reg＝ServiceWorkerRegistration；已有訂閱就直接用（金鑰沒變）
export async function subscribe(reg, key = VAPID_PUBLIC_KEY) {
  const cur = await reg.pushManager.getSubscription();
  if (cur) return cur;
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
}

// 這支手機現在的通知狀態：'unsupported' | 'denied' | 'on' | 'off'
export function pushStatus({ supported, permission, subscribed }) {
  if (!supported) return 'unsupported';
  if (permission === 'denied') return 'denied';
  return permission === 'granted' && subscribed ? 'on' : 'off';
}

export const PUSH_STATUS_TEXT = {
  unsupported: '這個瀏覽器不支援通知（Android Chrome 才有）',
  denied: '通知被擋住了：到 Android 設定 → 應用程式 → Chrome → 通知，或網站設定打開後再回來',
  on: '已開啟：嘿嘿回覆、遠端開關、有事等你決定時會推播（只在電腦開著遠端時）',
  off: '關閉中。打開時會問你要不要允許通知',
};

// 通知點擊／推播帶來的 kind → 要開哪一頁（只認固定清單，其他一律去對話）
// P74 R3：工作做完、工作卡住 → 通知頁（五欄版）；開關關著時 App 會把 notices 改回 chat（app.js）
export function tabForKind(kind) { return kind === 'decision' ? 'todo' : kind === 'job_done' || kind === 'job_stuck' ? 'notices' : 'chat'; }

// ---------- P70 推播根治（2026-11-05）：通知失效偵測與自動重新訂閱 ----------
// 電腦端遇 404／410 把停用清單（只放 sha256 前 16 碼）寫到 signal/push_status.json；手機自己算 hash 比對。手機只讀這個檔（不在寫入白名單）
export const PUSH_STATUS_PATH = 'signal/push_status.json';
export const PUSH_REPAIR_KEY = 'agent.pushRepair'; // {at, result:'ok'|'failed'}，診斷與首頁提示用
export const PUSH_BROKEN_TEXT = '通知已失效，請到設定頁重開';

// SHA-256 前 16 碼 hex（跟電腦端 hashlib.sha256(s.encode()).hexdigest()[:16] 同值）。WebCrypto 只在安全環境（https、localhost）有；沒有就回 null
export async function hashHex16(str) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) return null;
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(String(str == null ? '' : str)));
  let hex = '';
  for (const b of new Uint8Array(buf)) hex += b.toString(16).padStart(2, '0');
  return hex.slice(0, 16);
}

// 讀 push_status.json 文字 → {updated_at, disabled:[{endpoint_hash,auth_hash,at,code}]}；沒檔案／壞掉／格式不對回 null（不當成失效）
export function parsePushStatus(text) {
  if (text == null || String(text).trim() === '') return null;
  let j;
  try { j = JSON.parse(text); } catch (e) { return null; }
  if (!j || typeof j !== 'object' || !Array.isArray(j.disabled)) return null;
  const disabled = j.disabled
    .filter((e) => e && typeof e.endpoint_hash === 'string' && typeof e.auth_hash === 'string')
    .map((e) => ({ endpoint_hash: e.endpoint_hash, auth_hash: e.auth_hash, at: typeof e.at === 'string' ? e.at : '', code: Number.isFinite(e.code) ? e.code : null }));
  return { updated_at: typeof j.updated_at === 'string' ? j.updated_at : '', disabled };
}

// 目前這筆訂閱（endpoint＋auth 都算 hash）有沒有被電腦標成停用。endpoint 跟 auth 都要對上（重新訂閱後 auth 會變，就不再算停用）
export function isDisabled(status, endpointHash, authHash) {
  if (!status || !Array.isArray(status.disabled) || !endpointHash || !authHash) return false;
  return status.disabled.some((e) => e.endpoint_hash === endpointHash && e.auth_hash === authHash);
}

// 通知健康度：'ok'（沒事或沒開通知）｜'repair'（權限在、可以自動重新訂閱）｜'broken'（權限沒了，只能請使用者去設定頁）
export function pushHealth({ enabled, supported = true, permission, hasSub, disabledByPc }) {
  if (!enabled || !supported) return 'ok';
  if (permission !== 'granted') return 'broken';
  if (!hasSub || disabledByPc) return 'repair';
  return 'ok';
}

// 首頁要不要顯示「通知已失效」那一行：broken 一律顯示；repair 要等自動修復失敗才顯示（修復中、修成功都不吵人）
export function showPushBanner({ health, repairResult }) {
  return health === 'broken' || (health === 'repair' && repairResult === 'failed');
}

// 重新訂閱後要排進 outbox 的操作：先加新的、再移除舊的（舊 endpoint 可能來自剛取消的訂閱，或訂閱已消失時記在 localStorage 的那筆）
export function pushOpsAfterResubscribe(oldEp, newRec) {
  const ops = [{ action: 'add', sub: newRec }];
  if (oldEp && oldEp !== newRec.endpoint) ops.push({ action: 'remove', endpoint: oldEp });
  return ops;
}

// 取消目前的訂閱（有的話），回舊的 endpoint（沒有訂閱就回 localStorage 記的那筆）。unsubscribe 失敗照樣回、不丟錯
export async function unsubscribeCurrent(reg, lastEp = '') {
  const cur = await reg.pushManager.getSubscription();
  const oldEp = (cur && cur.endpoint) || lastEp || '';
  if (cur) { try { await cur.unsubscribe(); } catch (e) { /* 取消不了也繼續 */ } }
  return oldEp;
}

function subAuth(sub) {
  try { const j = sub && typeof sub.toJSON === 'function' ? sub.toJSON() : sub; return (j && j.keys && j.keys.auth) || ''; } catch (e) { return ''; }
}

// 先 unsubscribe（有的話）再直接 subscribe（不走 subscribe()：那支會先拿現有訂閱）。回 {sub, oldEp}。reg＝ServiceWorkerRegistration（測試用假的）
// P70 QC 建議 2：unsubscribe 失敗時瀏覽器會把同一筆死掉的訂閱還回來；endpoint 和 auth 都沒變就丟錯，讓呼叫端記成失敗、不跳「已自動重新訂閱」
export async function resubscribe(reg, lastEp = '', key = VAPID_PUBLIC_KEY) {
  const cur = await reg.pushManager.getSubscription();
  const oldAuth = subAuth(cur);
  const oldEp = await unsubscribeCurrent(reg, lastEp);
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
  if (cur && sub && sub.endpoint === cur.endpoint && subAuth(sub) === oldAuth) throw new Error('resubscribe_same');
  return { sub, oldEp };
}

// 雲端訂閱旗標只存訂閱指紋，不存憑證或 endpoint。失敗不設旗標，下次 refresh 再試。
// keyScope 是固定 relay origin（換 kid 不必重送）；in-flight 防並行重複。
const cloudPushPending = new Map();
const cloudPushSent = new WeakMap();
export const CLOUD_PUSH_KEY = 'agent.cloudPush';
export async function syncCloudPush(cloud, sub, label, storage, keyScope = '') {
  if (!cloud || !sub) return false;
  try {
    const j = typeof sub.toJSON === 'function' ? sub.toJSON() : sub;
    const fp = await hashHex16(JSON.stringify([keyScope, j.endpoint, j.keys?.p256dh, j.keys?.auth]));
    if (!fp) return false;
    if (storage.getItem(CLOUD_PUSH_KEY) === fp || cloudPushSent.get(storage) === fp) return true;
    if (cloudPushPending.has(fp)) return cloudPushPending.get(fp);
    const pending = (async () => {
      try {
        const r = await cloud.pushSubscribe(sub, label);
        if (!r || r.ok !== true) return false;
        cloudPushSent.set(storage, fp);
        try { storage.setItem(CLOUD_PUSH_KEY, fp); } catch { /* 同次開啟仍不重送 */ }
        return true;
      } catch { return false; }
    })();
    cloudPushPending.set(fp, pending);
    try { return await pending; } finally { cloudPushPending.delete(fp); }
  } catch { return false; }
}
