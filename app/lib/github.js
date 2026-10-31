import { decodeBase64Utf8, encodeBase64Utf8 } from './b64.js';

export class GitHubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const WRITABLE_FILES = ['Live.md', 'Questions.md', 'Task.md'];
// 紀錄中心（v5 M3）：固定檔名白名單，逐檔列出，不用前綴或萬用字元比對。schema-version.json 只讀（不在可寫清單）
export const RECORD_FILES = ['records/fitness-plans.json', 'records/fitness-sessions.json', 'records/fitness-notes.json', 'records/movies.json', 'records/anime.json'];
export const RECORD_SCHEMA_FILE = 'records/schema-version.json';
// 資料檔不存在（404）時要不要建新檔：先讀這幾個一定存在的檔，確認有 repo 權限、路徑前綴對，不然 404 當成錯誤（不建檔）
const PROBE_FILES = ['Task.md', 'Questions.md', 'Live.md'];

const encPath =(p) => p.split('/').map(encodeURIComponent).join('/');

// 設定頁容錯（10-26 使用者真機設定失敗）：貼完整網址、結尾 .git、多餘斜線都接受，轉成 owner/repo；不合格回 ''
export function normalizeRepo(s) {
  let r = String(s || '').trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/^github\.com\//i, '');
  r = r.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  const m = r.match(/^([\w.-]+)\/([\w.-]+)(\/.*)?$/);
  return m ? m[1] + '/' + m[2] : '';
}

// 路徑前綴：拿掉頭尾斜線；含 . 或 .. 或空段就不合格（回 null），避免打到 contents 以外的 API
export function normalizePrefix(s) {
  const p = String(s || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!p) return '';
  return p.split('/').every((seg) => seg && seg !== '.' && seg !== '..') ? p : null;
}

export function createClient({ owner, repo, branch = 'main', token, prefix = '', fetchImpl, sleep, timeoutMs = 20000 }) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const rawF = fetchImpl || ((...a) => fetch(...a));
  // 逾時（預設 20 秒）：丟 AbortError，classifyError 當成網路錯誤（那一筆回到排隊）。用 race，連不理會 signal 的 fetch 也一樣會逾時
  const f = (u, o = {}) => {
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = 0;
    const to = new Promise((_, rej) => {
      timer = setTimeout(() => { if (ac) ac.abort(); const e = new Error('請求逾時'); e.name = 'AbortError'; rej(e); }, timeoutMs);
    });
    return Promise.race([rawF(u, ac ? { ...o, signal: ac.signal } : o), to]).finally(() => clearTimeout(timer));
  };
  const pre = prefix ? prefix.replace(/^\/+|\/+$/g, '') + '/' : '';
  const url = (path) => 'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' +
    encodeURIComponent(repo) + '/contents/' + encPath(pre + path);
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: 'Bearer ' + token,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  async function fail(res) {
    let msg = String(res.status);
    try { const j = await res.json(); if (j && j.message) msg += ' ' + j.message; } catch (e) { /* ignore */ }
    throw new GitHubError(res.status, msg);
  }

  // ETag 條件請求（只放記憶體）：同一個網址第二次起帶 If-None-Match，內容沒變 GitHub 回 304（不算 rate limit、幾乎沒有 body）。
  // 10-27 實測 api.github.com 的 CORS 預檢允許 If-None-Match，且 Access-Control-Expose-Headers 有 ETag。
  const etags = new Map(); // 網址 → {etag, text, sha}（檔案）或 {etag, json}（commits）
  const etagOf = (res) => (res && res.headers && typeof res.headers.get === 'function' ? res.headers.get('ETag') : null);
  const condHeaders = (key) => { const e = etags.get(key); return e && e.etag ? { ...headers, 'If-None-Match': e.etag } : headers; };

  async function getFile(path) {
    const key = url(path) + '?ref=' + encodeURIComponent(branch);
    const res = await f(key, { headers: condHeaders(key), cache: 'no-store' });
    if (res.status === 304) {
      const hit = etags.get(key);
      if (hit && hit.text != null) return { text: hit.text, sha: hit.sha, notModified: true };
      etags.delete(key); // 沒有舊值卻回 304（不應該發生）：不帶條件重抓一次
      const again = await f(key, { headers, cache: 'no-store' });
      return readFile(again, key, path);
    }
    return readFile(res, key, path);
  }

  async function readFile(res, key, path) {
    if (!res.ok) await fail(res);
    const j = await res.json();
    if (typeof j.content !== 'string' || j.encoding !== 'base64') throw new GitHubError(0, '無法讀取內容：' + path);
    const out = { text: decodeBase64Utf8(j.content), sha: j.sha };
    const tag = etagOf(res);
    if (tag) etags.set(key, { etag: tag, text: out.text, sha: out.sha });
    return out;
  }

  // 寫入白名單：只允許（前綴＋）這 3 個文字檔＋5 個紀錄資料檔，其他一律不送出
  const writable = new Set([...WRITABLE_FILES, ...RECORD_FILES].map((n) => pre + n));
  const creatable = new Set(RECORD_FILES.map((n) => pre + n));

  async function putFile(path, text, sha, message) {
    if (!writable.has(pre + path)) throw new Error('不允許寫入這個檔案：' + path);
    const res = await f(url(path), {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(sha ? { message, content: encodeBase64Utf8(text), sha, branch } : { message, content: encodeBase64Utf8(text), branch }),
    });
    if (!res.ok) await fail(res);
    etags.delete(url(path) + '?ref=' + encodeURIComponent(branch)); // 剛寫過，舊 ETag 作廢
    return res.json();
  }

  // 先抓最新版、只改那一小段、再 PUT；sha 過期（409／422）就重抓重試，最多 maxTries 次
  // opts.create＝true：檔案不存在（404）時建新檔（mutate 會收到 null）。只限紀錄資料檔白名單，而且要先讀得到 Task.md 等其他檔
  async function updateFile(path, mutate, message, maxTries = 3, opts = {}) {
    let lastErr = null;
    for (let n = 0; n < maxTries; n++) {
      if (n > 0) await wait(600);
      let cur;
      try { cur = await getFile(path); } catch (e) {
        if (!(e instanceof GitHubError && e.status === 404 && opts.create && creatable.has(pre + path))) throw e;
        let reachable = false;
        for (const pf of PROBE_FILES) { try { await getFile(pf); reachable = true; break; } catch (e2) { /* 試下一個 */ } }
        if (!reachable) throw e; // 其他檔也讀不到：多半是權限或路徑前綴不對，不建檔
        cur = { text: null, sha: undefined };
      }
      const next = mutate(cur.text);
      if (typeof next !== 'string') throw new Error('內部錯誤：修改結果不是文字，已取消寫入');
      if (next === cur.text) return { text: cur.text, changed: false, tries: n + 1 };
      try {
        await putFile(path, next, cur.sha, message);
        return { text: next, changed: true, tries: n + 1 };
      } catch (e) {
        if (e instanceof GitHubError && (e.status === 409 || e.status === 422)) {
          etags.delete(url(path) + '?ref=' + encodeURIComponent(branch)); // sha 過期：重試前先作廢 ETag，一定拿到新內容（不會 304 回舊的）
          lastErr = e; continue;
        }
        throw e;
      }
    }
    throw lastErr || new Error('寫入失敗');
  }

  async function listCommits(perPage = 20) {
    const key = 'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' +
      encodeURIComponent(repo) + '/commits?per_page=' + Number(perPage);
    const res = await f(key, { headers: condHeaders(key), cache: 'no-store' });
    if (res.status === 304 && etags.has(key) && etags.get(key).json) return etags.get(key).json;
    if (!res.ok) await fail(res);
    const json = await res.json();
    const tag = etagOf(res);
    if (tag) etags.set(key, { etag: tag, json });
    return json;
  }

  return { getFile, putFile, updateFile, listCommits };
}
