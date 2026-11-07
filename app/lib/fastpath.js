// P69 第 4 步：快路徑用戶端（純函式為主，隨機數、時間、fetch、crypto 都可以注入，方便測試）。
// 協定與電腦端：D:\Personal\Projects\工具\mobile-fastpath（README.md、docs\手機端簽章與金鑰分發.md、fastpath\protocol.py）。
// 兩件事：
//   1. 門鈴 ringDoorbell：每次送出聊天留言時，背景把「同一則」加密後 POST 到電腦的 /msg，讓電腦提早知道。GitHub 正本照常寫。
//   2. 長輪詢 pollReplies：GET /reply，拿電腦端提早放進回覆佇列的回覆，先驗簽、再解密、再顯示。
// 安全底線：
//   · 金鑰 K 與子金鑰只放記憶體（CryptoKey 一律 extractable:false）；不進 localStorage／IndexedDB／快取／診斷／錯誤訊息／console。
//   · 網址一定要是「https:// 加單一子網域加 .trycloudflare.com」，不收路徑、埠、其他網域。
//   · 先驗回應簽章（含請求 nonce），再解密，再解析；任何一步不過＝失敗，不顯示任何東西。
//   · 門鈴與長輪詢永遠不丟例外，錯誤只回固定代碼（why），不帶網址、金鑰、內文。
import { nowMs } from './tz.js';

export const URL_RE = /^https:\/\/[a-z0-9-]{1,63}\.trycloudflare\.com$/;
export const KID_RE = /^[0-9a-f]{8}$/;
export const KEY_RE = /^[A-Za-z0-9_-]{43}$/; // 32 位元組的 base64url（無補位）
export const ID_RE = /^m-[a-z0-9]{8}$/;
export const SIG_RE = /^v1=([0-9a-f]{64})$/;
export const NONCE_RE = /^[A-Za-z0-9_-]{22,64}$/;
export const SIGNAL_PATH = 'signal/fastpath.json';
export const DOORBELL_TIMEOUT_MS = 1500;
export const POLL_TIMEOUT_MS = 35000; // 電腦端最多等 25 秒再回空清單
export const MAX_TEXT_CHARS = 4000; // 跟電腦端 max_text_chars 一致
export const MAX_REPLIES = 20;
export const REPLY_TEXT_MAX = 4000;
export const BACKOFF_MS = [2000, 5000, 15000, 30000];

const SIGNAL_KEYS = ['v', 'url', 'kid', 'key', 'expires_at'];
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

// ---------- base64url / hex ----------
export function b64urlEncode(bytes) {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64urlDecode(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error('b64');
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const toHex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (h) => { const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16); return o; };
const concat = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a, 0); o.set(b, a.length); return o; };

// ---------- signal/fastpath.json ----------
// 只收 {"v":1,"url","kid","key","expires_at"}（expires_at＝秒）。off:true、壞 JSON、多餘或缺欄位、過期、格式不對一律 null。
// now＝校正後的現在（毫秒）。回傳 {url, kid, key, expiresAt}；key 是 base64url 字串，呼叫端導出子金鑰後就丟掉
export function parseFastpathSignal(text, now = nowMs()) {
  let j;
  try { j = JSON.parse(String(text == null ? '' : text)); } catch (e) { return null; }
  if (!isObj(j)) return null;
  const keys = Object.keys(j);
  if (keys.length !== SIGNAL_KEYS.length || !SIGNAL_KEYS.every((k) => Object.prototype.hasOwnProperty.call(j, k))) return null;
  if (j.v !== 1) return null;
  if (typeof j.url !== 'string' || !URL_RE.test(j.url)) return null;
  if (typeof j.kid !== 'string' || !KID_RE.test(j.kid)) return null;
  if (typeof j.key !== 'string' || !KEY_RE.test(j.key)) return null;
  try { if (b64urlDecode(j.key).length !== 32) return null; } catch (e) { return null; }
  if (!Number.isInteger(j.expires_at) || j.expires_at <= 0) return null;
  if (j.expires_at * 1000 <= now) return null;
  return { url: j.url, kid: j.kid, key: j.key, expiresAt: j.expires_at };
}

// ---------- 金鑰導出 ----------
// HKDF（SHA-256、salt 32 個 0）導出 K_mac（HMAC sign）與 K_enc（AES-GCM 256），extractable:false。
// 回傳 cfg：{url, kid, expiresAt, kMac, kEnc}（沒有原始金鑰字串）；失敗回 null
export async function makeConfig(sig, deps = {}) {
  try {
    const subtle = deps.subtle || globalThis.crypto.subtle;
    if (!sig || !URL_RE.test(sig.url) || !KID_RE.test(sig.kid) || !KEY_RE.test(sig.key)) return null;
    const raw = b64urlDecode(sig.key);
    if (raw.length !== 32) return null;
    const base = await subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
    const salt = new Uint8Array(32);
    const kMac = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('mobile-fastpath v1 mac') }, base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']);
    const kEnc = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('mobile-fastpath v1 enc') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    raw.fill(0);
    return { url: sig.url, kid: sig.kid, expiresAt: sig.expiresAt, kMac, kEnc };
  } catch (e) { return null; }
}

export const configValid = (cfg, now = nowMs()) => !!cfg && URL_RE.test(cfg.url) && KID_RE.test(cfg.kid) && Number.isInteger(cfg.expiresAt) && cfg.expiresAt * 1000 > now && !!cfg.kMac && !!cfg.kEnc;

const depsOf = (d = {}) => ({
  subtle: d.subtle || globalThis.crypto.subtle,
  rand: d.rand || ((n) => globalThis.crypto.getRandomValues(new Uint8Array(n))),
  now: d.now || nowMs,
  fetch: d.fetch || ((...a) => globalThis.fetch(...a)),
  setTimeout: d.setTimeout || ((f, ms) => globalThis.setTimeout(f, ms)),
  clearTimeout: d.clearTimeout || ((t) => globalThis.clearTimeout(t)),
});

const FETCH_OPTS = { cache: 'no-store', credentials: 'omit', redirect: 'error' };

// 呼叫 fetch，帶逾時與外部中止；回 {res} 或 {why}
async function timedFetch(D, url, init, timeoutMs, outer) {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = D.setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs);
  const onAbort = () => ctl.abort();
  if (outer) { if (outer.aborted) { D.clearTimeout(timer); return { why: 'aborted' }; } outer.addEventListener('abort', onAbort, { once: true }); }
  try {
    const res = await D.fetch(url, { ...init, ...FETCH_OPTS, signal: ctl.signal });
    return { res, timer, outer, onAbort };
  } catch (e) {
    D.clearTimeout(timer);
    if (outer) outer.removeEventListener('abort', onAbort);
    return { why: timedOut ? 'timeout' : (outer && outer.aborted ? 'aborted' : 'net') };
  }
}
const finish = (D, f) => { D.clearTimeout(f.timer); if (f.outer) f.outer.removeEventListener('abort', f.onAbort); };

// ---------- 門鈴：POST /msg（一律加密模式）----------
// 簽章 HMAC-SHA256(K_mac, "FP1\nPOST\n/msg\n" + kid + "\n" + 本文位元組)，AAD＝"FP1|<id>|<ts>|<nonce>"
// 永遠不丟例外。回 {ok:true} 或 {ok:false, why}
export async function buildMsg(cfg, { id, text }, deps = {}) {
  const D = depsOf(deps);
  const ts = Math.round(D.now());
  const nonce = b64urlEncode(D.rand(18));
  const iv = D.rand(12);
  const inner = enc.encode(JSON.stringify({ text }));
  const ct = new Uint8Array(await D.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode('FP1|' + id + '|' + ts + '|' + nonce) }, cfg.kEnc, inner));
  const body = JSON.stringify({ v: 1, id, ts, nonce, iv: b64urlEncode(iv), ct: b64urlEncode(ct) });
  const input = concat(enc.encode('FP1\nPOST\n/msg\n' + cfg.kid + '\n'), enc.encode(body));
  const mac = new Uint8Array(await D.subtle.sign('HMAC', cfg.kMac, input));
  return { body, headers: { 'Content-Type': 'application/json', 'X-FP-Kid': cfg.kid, 'X-FP-Sig': 'v1=' + toHex(mac) } };
}

export async function ringDoorbell(cfg, { id, text } = {}, deps = {}) {
  try {
    const D = depsOf(deps);
    if (!configValid(cfg, D.now())) return { ok: false, why: 'no_config' };
    if (!ID_RE.test(String(id))) return { ok: false, why: 'bad_id' };
    if (typeof text !== 'string' || !text.trim()) return { ok: false, why: 'empty' };
    if ([...text].length > MAX_TEXT_CHARS) return { ok: false, why: 'too_long' };
    const m = await buildMsg(cfg, { id, text }, deps);
    const f = await timedFetch(D, cfg.url + '/msg', { method: 'POST', headers: m.headers, body: m.body }, deps.timeoutMs || DOORBELL_TIMEOUT_MS, null);
    if (!f.res) return { ok: false, why: f.why };
    finish(D, f);
    return f.res.ok ? { ok: true } : { ok: false, why: 'status_' + (Number(f.res.status) || 0) };
  } catch (e) { return { ok: false, why: 'error' }; }
}

// ---------- 長輪詢：GET /reply ----------
// 請求簽章字串（LF 連接）：FP1、GET、/reply、kid、正規化 query（after、kid、nonce、ts 依鍵名排序）、ts、nonce
// 回應：標頭 X-FP-Sig 簽的是 "FP1\nRESP\n/reply\n" + 請求 nonce + "\n" + 回應本文位元組；本文 {"v":1,"iv","ct"}，AAD＝"FP1|RESP|<請求 nonce>"
export async function buildReplyRequest(cfg, after, deps = {}) {
  const D = depsOf(deps);
  const ts = Math.round(D.now());
  const nonce = b64urlEncode(D.rand(18));
  const norm = 'after=' + after + '&kid=' + cfg.kid + '&nonce=' + nonce + '&ts=' + ts;
  const input = enc.encode(['FP1', 'GET', '/reply', cfg.kid, norm, String(ts), nonce].join('\n'));
  const mac = new Uint8Array(await D.subtle.sign('HMAC', cfg.kMac, input));
  return { path: '/reply?' + norm, nonce, sig: 'v1=' + toHex(mac) };
}

// 先驗簽、再解密、再解析。丟 Error（訊息只有固定代碼）
export async function openReplyBody(cfg, nonce, sigHeader, bodyBytes, deps = {}) {
  const D = depsOf(deps);
  const m = SIG_RE.exec(String(sigHeader || ''));
  if (!m) throw new Error('sig');
  const input = concat(enc.encode('FP1\nRESP\n/reply\n' + nonce + '\n'), bodyBytes);
  const ok = await D.subtle.verify('HMAC', cfg.kMac, fromHex(m[1]), input);
  if (!ok) throw new Error('sig');
  let obj;
  try { obj = JSON.parse(dec.decode(bodyBytes)); } catch (e) { throw new Error('schema'); }
  if (!isObj(obj) || Object.keys(obj).length !== 3 || obj.v !== 1 || typeof obj.iv !== 'string' || typeof obj.ct !== 'string') throw new Error('schema');
  let iv; let ct;
  try { iv = b64urlDecode(obj.iv); ct = b64urlDecode(obj.ct); } catch (e) { throw new Error('schema'); }
  if (iv.length !== 12 || ct.length < 17) throw new Error('schema');
  let pt;
  try { pt = new Uint8Array(await D.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode('FP1|RESP|' + nonce) }, cfg.kEnc, ct)); } catch (e) { throw new Error('decrypt'); }
  let inner;
  try { inner = JSON.parse(dec.decode(pt)); } catch (e) { throw new Error('schema'); }
  if (!isObj(inner) || Object.keys(inner).length !== 2 || inner.v !== 1 || !Array.isArray(inner.replies) || inner.replies.length > MAX_REPLIES) throw new Error('schema');
  const replies = [];
  for (const r of inner.replies) {
    if (!isObj(r) || !Number.isInteger(r.seq) || r.seq < 0 || !ID_RE.test(String(r.id)) || typeof r.text !== 'string' || !r.text || [...r.text].length > REPLY_TEXT_MAX || typeof r.at !== 'string') throw new Error('schema');
    replies.push({ seq: r.seq, id: r.id, text: r.text, at: r.at.slice(0, 40) });
  }
  return replies;
}

// 回 {ok:true, replies, last} 或 {ok:false, why}。signal：呼叫端的 AbortSignal（離開聊天頁、切背景、遠端關了就 abort）
export async function pollReplies(cfg, after, signal, deps = {}) {
  try {
    const D = depsOf(deps);
    if (!configValid(cfg, D.now())) return { ok: false, why: 'no_config' };
    if (!Number.isInteger(after) || after < 0 || after > 999999999999) return { ok: false, why: 'bad_after' };
    const rq = await buildReplyRequest(cfg, after, deps);
    const f = await timedFetch(D, cfg.url + rq.path, { method: 'GET', headers: { 'X-FP-Sig': rq.sig } }, deps.timeoutMs || POLL_TIMEOUT_MS, signal || null);
    if (!f.res) return { ok: false, why: f.why };
    let bytes;
    let sigHeader;
    try {
      if (!f.res.ok) return { ok: false, why: 'status_' + (Number(f.res.status) || 0) };
      sigHeader = f.res.headers && f.res.headers.get ? f.res.headers.get('X-FP-Sig') : null;
      bytes = new Uint8Array(await f.res.arrayBuffer());
    } catch (e) { return { ok: false, why: signal && signal.aborted ? 'aborted' : 'net' }; } finally { finish(D, f); }
    let replies;
    try { replies = await openReplyBody(cfg, rq.nonce, sigHeader, bytes, deps); } catch (e) { return { ok: false, why: ['sig', 'decrypt', 'schema'].includes(e && e.message) ? e.message : 'error' }; }
    const fresh = replies.filter((r) => r.seq > after);
    return { ok: true, replies: fresh, last: fresh.reduce((m, r) => Math.max(m, r.seq), after) };
  } catch (e) { return { ok: false, why: 'error' }; }
}

// ---------- 送出聊天時順便按門鈴 ----------
// app.js 的 enqueue 在「outbox 項目建好、flushOutbox 啟動」之後才呼叫；門鈴只讀 item，不改 outbox、不影響畫面、不重試、不丟例外。
// 同一個 outbox 編號（m-xxxxxxxx）、同樣的內容（withCtx／withQuote 後的文字）。getCfg() 回 null＝沒有有效設定，什麼都不做。
// onResult({ok,why,at})：只給診斷記「上次門鈴結果」。回傳 promise，永遠 resolve
export async function doorbellForItem(item, { getCfg, ring = ringDoorbell, onResult, deps } = {}) {
  try {
    if (!item || item.kind !== 'chat' || !item.payload) return { skipped: true };
    const cfg = typeof getCfg === 'function' ? getCfg() : null;
    if (!cfg) return { skipped: true };
    let r;
    try { r = await ring(cfg, { id: item.id, text: String(item.payload.content == null ? '' : item.payload.content) }, deps); } catch (e) { r = { ok: false, why: 'error' }; }
    const out = r && typeof r === 'object' ? { ok: !!r.ok, why: r.ok ? '' : String(r.why || 'error').slice(0, 30) } : { ok: false, why: 'error' };
    if (typeof onResult === 'function') { try { onResult(out); } catch (e) { /* 診斷不能影響送出 */ } }
    return out;
  } catch (e) { return { ok: false, why: 'error' }; }
}

// ---------- 收到的快路徑回覆（只放記憶體）----------
// Map：m-編號 → Map(seq → {text, at})。顯示時同一個編號只畫一份（多段用空行接起來）。回傳這次是否有新增
export function addFastReplies(store, replies) {
  let added = false;
  for (const r of replies || []) {
    if (!ID_RE.test(String(r.id))) continue;
    if (!store.has(r.id)) store.set(r.id, new Map());
    const m = store.get(r.id);
    if (!m.has(r.seq)) { m.set(r.seq, { text: r.text, at: r.at }); added = true; }
  }
  return added;
}
export function fastReplyFor(store, id) {
  const m = store && store.get(id);
  if (!m || !m.size) return null;
  const parts = [...m.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  return { text: parts.map((p) => p.text).join('\n\n'), at: parts[0].at };
}
// 這一串該不該畫快路徑回覆：Live.md 已經有嘿嘿的回覆就一律用 Live.md 的（同一個編號不會出現兩份）；沒有編號、找不到對應留言一律不畫
export function fastReplyForThread(store, thread) {
  if (!thread || thread.orphan || !thread.id) return null;
  if (thread.replies && thread.replies.length) return null;
  return fastReplyFor(store, thread.id);
}

// ---------- 長輪詢迴圈（同時只有一條）----------
// deps：{getCfg(): cfg|null, poll(cfg, after, signal) → pollReplies 的結果, onReplies(replies), onFail(why), sleep(ms), backoff}
// start()：已經在跑就不重複開；stop()：abort 並結束。失敗退避 2s→5s→15s→30s（上限 30s）並呼叫 onFail（呼叫端重讀 signal）；成功就歸零
export function createReplyLoop(d) {
  let ctl = null;
  let after = 0; // 只放記憶體
  const backoff = d.backoff || BACKOFF_MS;
  const sleep = d.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  async function run(my) {
    let fails = 0;
    while (!my.signal.aborted) {
      const cfg = d.getCfg();
      if (!cfg) break;
      const r = await d.poll(cfg, after, my.signal);
      if (my.signal.aborted) break;
      if (r && r.ok) {
        fails = 0;
        after = Math.max(after, r.last || 0);
        if (r.replies && r.replies.length) { try { d.onReplies(r.replies); } catch (e) { /* 畫面錯誤不能讓迴圈停 */ } } else await sleep(d.minGapMs == null ? 200 : d.minGapMs);
      } else {
        const wait = backoff[Math.min(fails, backoff.length - 1)];
        fails++;
        try { d.onFail((r && r.why) || 'error'); } catch (e) { /* 同上 */ }
        await sleep(wait);
      }
    }
    if (ctl === my) ctl = null;
  }
  return {
    start() { if (ctl) return false; ctl = new AbortController(); run(ctl).catch(() => { ctl = null; }); return true; },
    stop() { if (ctl) { ctl.abort(); ctl = null; } },
    running: () => !!ctl,
    after: () => after,
  };
}
