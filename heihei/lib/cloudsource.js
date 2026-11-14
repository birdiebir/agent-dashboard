// 來源：cloud-relay/pwa-adapter/cloudSource.js，2026-11-06；介面變更時兩份必須同步。
// P73 雲端小站：手機 App（agent-mobile-pwa）端的資料來源轉接。
//
// 實作 lib/datasource.js 的介面 { kind, read(name) → Promise<{text, missing}> }，另外多給畫面用的
//   state() 狀態快照、send() 交辦（排隊給電腦）、ask() 快答（SSE 串流）、replies() 取回覆、pushSubscribe() 推播訂閱。
//
// 接進 App 的方法見 README「App 端怎麼接」；與 agent-mobile-pwa/lib/cloudsource.js 同步。
//
// 安全底線（跟 lib/fastpath.js 同一套）：
//   · 金鑰（主金鑰 K）只放記憶體，導出的子金鑰一律 extractable:false；不進 localStorage／IndexedDB／快取／診斷／錯誤訊息
//   · K_auth 簽每個請求（雲端驗證用）；K_e2e 簽「交辦」並驗「電腦回覆」；K_enc（AES-256-GCM）加密交辦、解電腦回覆。
//     雲端拿不到 K_e2e、K_enc：交辦與電腦回覆在雲端只是密文（QC 2026-11-06 M1）
//   · 電腦的回覆解不開或簽章對不上就丟掉，不顯示（雲端被入侵也塞不進假回覆）；雲端自己的快答標 source:'cloud'，畫面要標明
//   · 快答（ask）一定要給雲端明文才回答得了：預設只走 Workers AI，allowGoogle:true（App 的開關，預設關）才可能送 Gemini
//   · 錯誤只帶固定代碼，不帶網址、金鑰、內文
//
// 全部相依都可注入（fetch、crypto、現在時間、隨機數），方便測試。

const enc = new TextEncoder();
const INFO_AUTH = 'cloud-relay v1 auth';
const INFO_E2E = 'cloud-relay v1 e2e';
const INFO_ENC = 'cloud-relay v1 enc';

export const ID_RE = /^(m-|x-)[a-z0-9]{8}$/;
export const KID_RE = /^[0-9a-f]{8}$/;
export const KEY_RE = /^[A-Za-z0-9_-]{43}$/; // 32 位元組的 base64url（無補位）
export const URL_RE = /^(https:\/\/[a-z0-9.-]+|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)$/;
export const MAX_TEXT_CHARS = 4000;

export class RelayError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// ---------- 編碼 ----------
export function b64urlEncode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
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

// ---------- 文字清理（跟 Worker 的 cleanLine 一致；簽章簽的是清理後的文字，所以兩邊要完全一樣） ----------
export function cleanLine(raw) {
  let s = String(raw == null ? '' : raw).normalize('NFC');
  s = s.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, ' ');
  return s.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

// ---------- 金鑰與簽章 ----------
export async function deriveKeys(masterB64, subtle = globalThis.crypto.subtle) {
  if (!KEY_RE.test(String(masterB64))) throw new RelayError('bad_key');
  const raw = b64urlDecode(masterB64);
  const base = await subtle.importKey('raw', raw, 'HKDF', false, ['deriveBits']);
  const sub = async (info, usages) => {
    const bits = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(info) }, base, 256);
    return subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, usages);
  };
  const encBits = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(INFO_ENC) }, base, 256);
  const encKey = await subtle.importKey('raw', encBits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return { authKey: await sub(INFO_AUTH, ['sign']), e2eKey: await sub(INFO_E2E, ['sign', 'verify']), encKey };
}

// ---------- 端到端加密（跟 cloud_relay_client.py 一致；做法沿用 mobile-fastpath：AES-256-GCM、每則隨機 12 位元組 IV） ----------
// 明文 {"text","ts",hub?}（hub 只用於交辦）；AAD "<標籤>|<m-編號>|<手機金鑰編號>"（RLM1＝交辦、RLR1＝電腦回覆）
const aad = (label, id, kid) => enc.encode(label + '|' + id + '|' + kid);
export async function seal(encKey, label, id, kid, text, ts, ivBytes, subtle = globalThis.crypto.subtle, hub = undefined) {
  const iv = ivBytes || globalThis.crypto.getRandomValues(new Uint8Array(12));
  const pt = enc.encode(JSON.stringify({ text, ts: Math.floor(ts), ...(hub === undefined ? {} : { hub }) }));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(label, id, kid) }, encKey, pt));
  return { iv: b64urlEncode(iv), ct: b64urlEncode(ct) };
}
export async function openSealed(encKey, label, id, kid, iv, ct, subtle = globalThis.crypto.subtle) {
  try {
    if (typeof iv !== 'string' || !/^[A-Za-z0-9_-]{16}$/.test(iv) || typeof ct !== 'string' || !/^[A-Za-z0-9_-]{23,24000}$/.test(ct)) throw new Error('fmt');
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: b64urlDecode(iv), additionalData: aad(label, id, kid) }, encKey, b64urlDecode(ct));
    const d = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(pt));
    if (!d || typeof d.text !== 'string' || !Number.isInteger(d.ts) || Object.keys(d).length !== 2) throw new Error('schema');
    return { text: d.text, ts: d.ts };
  } catch (e) {
    throw new RelayError('bad_sealed');
  }
}

const encURI = (s) => encodeURIComponent(String(s));
export function canonicalPathQuery(path, query) {
  const pairs = Object.entries(query || {}).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
  const q = pairs.map(([k, v]) => encURI(k) + '=' + encURI(v)).join('&');
  return path + (q ? '?' + q : '');
}

async function sha256Hex(bytes, subtle) {
  return toHex(new Uint8Array(await subtle.digest('SHA-256', bytes)));
}
async function hmacHex(key, text, subtle) {
  return toHex(new Uint8Array(await subtle.sign('HMAC', key, enc.encode(text))));
}

// epoch 放最後，保留舊版 subtle 參數的位置；沒帶 epoch 維持原簽章。
export async function signRequest(authKey, method, pathQuery, kid, ts, nonce, bodyBytes, subtle = globalThis.crypto.subtle, epoch = undefined) {
  const canon = ['RL1', method.toUpperCase(), pathQuery, kid, String(ts), nonce, await sha256Hex(bodyBytes, subtle)].join('\n');
  return 'v1=' + (await hmacHex(authKey, canon + (epoch === undefined ? '' : '\nepoch:' + epoch), subtle));
}

export async function e2eSign(e2eKey, label, id, text, subtle = globalThis.crypto.subtle) {
  return hmacHex(e2eKey, [label, id, text].join('\n'), subtle);
}
export async function e2eVerify(e2eKey, label, id, text, sig, subtle = globalThis.crypto.subtle) {
  if (typeof sig !== 'string' || !/^[0-9a-f]{64}$/.test(sig)) return false;
  return subtle.verify('HMAC', e2eKey, fromHex(sig), enc.encode([label, id, text].join('\n')));
}

// ---------- 讀取 SSE（fetch 串流） ----------
export async function* readSse(body) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let m;
      while ((m = /\r?\n\r?\n/.exec(buf))) {
        const block = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        const ev = /^event: (.*)$/m.exec(block);
        const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
        if (data) {
          let parsed = null;
          try { parsed = JSON.parse(data); } catch (e) { parsed = null; }
          yield { event: ev ? ev[1] : 'message', data: parsed };
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch (e) { /* ignore */ }
  }
}

// ---------- 來源 ----------
// cfg: { url, kid, key, expiresAt(ms 或 undefined) }；deps: { fetch, now, random, subtle }
// P74 狀態檔端到端加密（電腦端 snapshot_seal.py）：信封 {"v":1,"enc":"RLF1","kid","seq","z":"gzip","iv","ct"}，
// 明文先 gzip 再 AES-256-GCM（K_enc），AAD="RLF1|<檔名>|<kid>|<seq>"。雲端換檔名、換手機、改 seq 都解不開。
export const FILE_LABEL = 'RLF1';
export const isSealedFile = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && v.v === 1 && v.enc === FILE_LABEL;
async function gunzipText(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new TextDecoder('utf-8', { fatal: true }).decode(await new Response(stream).arrayBuffer());
}
export async function openSealedFile(encKey, name, env, subtle = globalThis.crypto.subtle) {
  if (!isSealedFile(env) || env.z !== 'gzip' || !KID_RE.test(String(env.kid)) || !Number.isSafeInteger(env.seq) || env.seq < 0
      || typeof env.iv !== 'string' || typeof env.ct !== 'string') throw new RelayError('sealed_format');
  let pt;
  try {
    pt = await subtle.decrypt({ name: 'AES-GCM', iv: b64urlDecode(env.iv), additionalData: enc.encode(FILE_LABEL + '|' + name + '|' + env.kid + '|' + env.seq) }, encKey, b64urlDecode(env.ct));
  } catch { throw new RelayError('sealed_auth'); }
  return gunzipText(new Uint8Array(pt));
}

export function createCloudSource(cfg, deps = {}) {
  if (!cfg || !URL_RE.test(String(cfg.url)) || !KID_RE.test(String(cfg.kid)) || !KEY_RE.test(String(cfg.key))) throw new RelayError('bad_config');
  const base = String(cfg.url).replace(/\/$/, '');
  const f = deps.fetch || ((...a) => globalThis.fetch(...a));
  const now = deps.now || (() => Date.now());
  const subtle = deps.subtle || globalThis.crypto.subtle;
  const random = deps.random || ((n) => globalThis.crypto.getRandomValues(new Uint8Array(n)));
  let keys = null;
  const etags = new Map(); // 路徑 → { etag, body }（只放狀態檔與快照，不放金鑰、不放留言）
  const fileSeq = new Map(); // 檔名 → 看過的最大 seq：雲端回放舊版就當沒有這個檔

  // 加密的狀態檔 → 明文文字；不是這支手機的金鑰、解不開、seq 倒退都回 null（呼叫端當成沒有，退回 GitHub）
  async function unsealFile(name, env) {
    if (env.kid !== cfg.kid) return null;
    try {
      const text = await openSealedFile((await getKeys()).encKey, name, env, subtle);
      if (env.seq < (fileSeq.get(name) || 0)) return null;
      fileSeq.set(name, env.seq);
      return text;
    } catch { return null; }
  }
  const sealedBody = (body) => { try { const j = JSON.parse(body); return isSealedFile(j) ? j : null; } catch { return null; } };

  async function getKeys() {
    if (cfg.expiresAt && now() >= cfg.expiresAt) throw new RelayError('key_expired');
    if (!keys) keys = await deriveKeys(cfg.key, subtle);
    return keys;
  }

  async function call(method, path, { query, body, headers, signal } = {}) {
    const { authKey } = await getKeys();
    const data = body === undefined ? new Uint8Array(0) : enc.encode(typeof body === 'string' ? body : JSON.stringify(body));
    const pq = canonicalPathQuery(path, query);
    const ts = Math.floor(now());
    const nonce = b64urlEncode(random(18));
    const h = {
      'X-RL-Kid': cfg.kid,
      'X-RL-Ts': String(ts),
      'X-RL-Nonce': nonce,
      'X-RL-Sig': await signRequest(authKey, method, pq, cfg.kid, ts, nonce, data, subtle),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(headers || {}),
    };
    let res;
    try {
      const deadline = AbortSignal.timeout(deps.timeoutMs || (path === '/v1/ask' ? 60000 : 8000));
      res = await f(base + pq, { method, headers: h, body: method === 'GET' ? undefined : data, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
    } catch (e) {
      throw new RelayError('network');
    }
    return res;
  }

  async function jsonOk(res) {
    let j = null;
    try { j = await res.json(); } catch (e) { j = null; }
    if (!res.ok || !j || j.ok === false) throw new RelayError((j && j.error) || 'http_' + res.status, res.status);
    return j;
  }

  // 清文字 → 加密（K_enc）＋簽章（K_e2e）。簽的是清過的明文，電腦解密後驗
  async function sealMsg(text, id, hub) {
    const clean = cleanLine(text);
    if (!ID_RE.test(String(id))) throw new RelayError('bad_id');
    if (!clean) throw new RelayError('text_empty');
    if (clean.length > MAX_TEXT_CHARS) throw new RelayError('text_long');
    const { e2eKey, encKey } = await getKeys();
    const sealed = await seal(encKey, 'RLM1', id, cfg.kid, clean, now(), random(12), subtle, hub);
    const sig = await e2eSign(e2eKey, 'RLM1', id, clean, subtle);
    return { clean, sealed, sig };
  }

  // 帶 ETag 的 GET；304 回快取
  async function cachedGet(path, key) {
    const prev = etags.get(key);
    const res = await call('GET', path, prev ? { headers: { 'If-None-Match': prev.etag } } : {});
    if (res.status === 304 && prev) return { status: 200, body: prev.body, etag: prev.etag, updated: prev.updated, fromCache: true };
    if (res.status === 404) return { status: 404 };
    if (res.status !== 200) {
      let j = null;
      try { j = await res.json(); } catch (e) { j = null; }
      throw new RelayError((j && typeof j.error === 'string' && /^[a-z_]{1,40}$/.test(j.error) && j.error) || 'http_' + res.status, res.status);
    }
    const body = await res.text();
    const etag = res.headers.get('etag');
    const updated = res.headers.get('x-rl-updated');
    if (etag) etags.set(key, { etag, body, updated });
    return { status: 200, body, etag, updated, fromCache: false };
  }

  return {
    kind: 'cloud',

    // 介面：跟 github 來源一樣回 {text, missing}；多帶 updatedAt 讓畫面顯示「資料是幾點的」
    async read(name) {
      if (!/^[a-z_]{1,32}$/.test(String(name))) throw new RelayError('bad_name');
      const r = await cachedGet('/v1/file/' + name, 'file:' + name);
      if (r.status === 404) return { text: '', missing: true };
      const env = sealedBody(r.body);
      if (env) {
        const text = await unsealFile(name, env);
        if (text == null) return { text: '', missing: true };
        return { text, missing: false, updatedAt: r.updated || null, fromCache: r.fromCache };
      }
      return { text: r.body, missing: false, updatedAt: r.updated || null, fromCache: r.fromCache };
    },

    // 整份快照：電腦在不在線、佇列狀態、最新回覆序號、狀態檔（已解析）
    async state() {
      const r = await cachedGet('/v1/state', 'state');
      if (r.status !== 200) throw new RelayError('http_' + r.status, r.status);
      const j = JSON.parse(r.body);
      if (j && j.files && typeof j.files === 'object') {
        for (const name of Object.keys(j.files)) {
          if (!isSealedFile(j.files[name])) continue;
          const text = await unsealFile(name, j.files[name]);
          let parsed = null;
          try { parsed = text == null ? null : JSON.parse(text); } catch { parsed = null; }
          if (parsed == null) delete j.files[name]; else j.files[name] = parsed;
        }
      }
      return j;
    },

    // 交辦：排隊給電腦（電腦關機也收；開機後補做）。只送密文：雲端看不到內容；簽章讓電腦確認這則真的是你寫的
    async send(text, id, { hub, needs } = {}) {
      if (needs !== undefined && !['local_login', 'write_personal', 'read_only'].includes(needs)) throw new RelayError('bad_needs');
      const { sealed, sig } = await sealMsg(text, id, hub);
      return jsonOk(await call('POST', '/v1/msg', { body: { id, ...sealed, sig, ...(needs === undefined ? {} : { needs }) } }));
    },

    // 快答：SSE。onEvent({event, data}) 每個事件呼叫一次；回 {text, engine, queued, error, laptopDone}
    //   queued＝這題要等電腦（個資、公司字樣、要查檔案、額度用完…），已經把同一句的密文排進佇列
    //   allowGoogle：App 的「可以送 Google」開關，預設關；只有 true 才可能送 Gemini（個資、公司題雲端還是會擋）
    async ask(text, id, { onEvent, signal, allowGoogle } = {}) {
      if (!/^m-[a-z0-9]{8}$/.test(String(id))) throw new RelayError('bad_id');
      const { clean, sealed, sig } = await sealMsg(text, id);
      const res = await call('POST', '/v1/ask', { body: { id, text: clean, ...sealed, sig, allow_google: allowGoogle === true }, signal });
      if (res.status !== 200 || !res.body) {
        let j = null;
        try { j = await res.json(); } catch (e) { j = null; }
        throw new RelayError((j && j.error) || 'http_' + res.status, res.status);
      }
      const out = { text: '', engine: null, queued: null, error: null, laptopDone: false };
      for await (const ev of readSse(res.body)) {
        if (ev.event === 'done' && ev.data && ev.data.source === 'laptop') out.laptopDone = true; // 電腦已經答了，去 replies() 拿
        if (ev.event === 'meta' && ev.data) out.engine = ev.data.engine || out.engine;
        else if (ev.event === 'delta' && ev.data && typeof ev.data.t === 'string') out.text += ev.data.t;
        else if (ev.event === 'queued') out.queued = ev.data || {};
        else if (ev.event === 'error') out.error = (ev.data && ev.data.code) || 'error';
        if (onEvent) onEvent(ev);
      }
      return out;
    },

    // 取回覆。電腦的回覆（source:'laptop'）是密文：解得開、簽章對得上才收；給別支手機的略過（otherPhone 計數）。
    // 雲端快答（source:'cloud'）是明文、沒簽章，照實標示
    async replies(after = 0) {
      const { e2eKey, encKey } = await getKeys();
      const j = await jsonOk(await call('GET', '/v1/replies', { query: { after: String(after) } }));
      const out = [];
      let dropped = 0;
      let otherPhone = 0;
      let tail = 0; // 這批原始列的最大序號（含被濾掉的），呼叫端用它往下讀
      for (const r of j.replies || []) {
        if (Number.isSafeInteger(r.seq) && r.seq > tail) tail = r.seq;
        let text;
        if (r.source === 'laptop') {
          if (r.kid !== cfg.kid && KID_RE.test(String(r.kid))) { otherPhone++; continue; }
          try {
            ({ text } = await openSealed(encKey, 'RLR1', r.id, cfg.kid, r.iv, r.ct, subtle));
          } catch (e) { dropped++; continue; }
          if (!(await e2eVerify(e2eKey, 'RLR1', r.id, text, r.sig, subtle))) { dropped++; continue; }
        } else if (r.source === 'cloud' && typeof r.text === 'string') {
          text = r.text;
        } else { dropped++; continue; }
        out.push({ seq: r.seq, id: r.id, text, source: r.source, engine: r.engine || null, at: r.at });
      }
      return { replies: out, lastSeq: j.last_seq, tail, dropped, otherPhone };
    },

    async pushSubscribe(sub, label) {
      const j = sub && typeof sub.toJSON === 'function' ? sub.toJSON() : sub || {};
      return jsonOk(await call('POST', '/v1/push/subscribe', { body: { endpoint: j.endpoint, keys: j.keys, label } }));
    },
    async pushUnsubscribe(endpoint) {
      return jsonOk(await call('DELETE', '/v1/push/subscribe', { body: { endpoint } }));
    },
  };
}

// 依序試多個來源（例如 [雲端小站, GitHub]）：前一個丟錯或「沒有檔」就換下一個；全部都沒有才回 missing。
// 這樣雲端小站掛了、金鑰過期、或還沒開通，畫面照舊走 GitHub，不用改畫面。
export function withFallback(sources) {
  const list = (sources || []).filter(Boolean);
  if (!list.length) throw new RelayError('no_sources');
  return {
    kind: 'fallback',
    async read(name) {
      let lastErr = null;
      let sawMissing = false;
      for (const s of list) {
        try {
          const r = await s.read(name);
          if (r && !r.missing) return { ...r, via: s.kind };
          sawMissing = true;
        } catch (e) {
          lastErr = e;
        }
      }
      if (sawMissing) return { text: '', missing: true };
      throw lastErr || new RelayError('no_sources');
    },
  };
}
