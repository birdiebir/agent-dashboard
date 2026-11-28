import { decodeBase64Utf8, encodeBase64Utf8 } from './b64.js';
import { setServerDate } from './tz.js';

export class GitHubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const WRITABLE_FILES = ['Live.md', 'Questions.md', 'Task.md'];
// 紀錄中心（v5 M3）：固定檔名白名單，逐檔列出，不用前綴或萬用字元比對。schema-version.json 只讀（不在可寫清單）
export const RECORD_FILES = ['records/fitness-plans.json', 'records/fitness-sessions.json', 'records/fitness-notes.json', 'records/movies.json', 'records/anime.json'];
export const RECORD_SCHEMA_FILE = 'records/schema-version.json';
// 資料檔不存在（404）時要不要建新檔：先讀這幾個一定存在的檔，確認有 repo 權限、路徑前綴對，不然 404 當成錯誤（不建檔）
// P62：電腦端投影狀態用的孤兒分支 signal。路徑寫死在 repo 根目錄 signal/…，不套設定頁的 prefix；
// 只開放手機要寫的兩個檔（逐檔列出）。signal/chat_status.json 是電腦寫、手機只讀，不在可寫清單
export const SIGNAL_BRANCH = 'signal';
export const SIGNAL_STATUS_FILE = 'signal/chat_status.json';
// P70 diag（2026-11-05）：手機自我診斷回報 signal/phone_diag.json，只有計數與狀態、不含內文（lib/diag.js），逐檔列出
export const SIGNAL_WRITABLE = ['signal/remote_request.json', 'signal/push_sub.json', 'signal/phone_diag.json'];
// P74 hub v2：手機寫的 in/ 檔（msg／answer／order_op，一筆一檔）。不放進 SIGNAL_WRITABLE（那是逐檔白名單），另走嚴格規則：
// 只允許 signal/hub/in/ 底下、檔名符合編號格式、而且只能新建（不帶 sha）。其他路徑照舊拒絕
export const HUB_IN_PREFIX = 'signal/hub/in/';
export const HUB_IN_FILE_RE = /^(m-[A-Za-z0-9]{4,32}|x-[a-z0-9]{8})\.json$/;
export const isHubInPath = (path) => typeof path === 'string' && path.startsWith(HUB_IN_PREFIX) && HUB_IN_FILE_RE.test(path.slice(HUB_IN_PREFIX.length));
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
  let rate = null; // 最近一次回應（含 304）的 x-ratelimit-remaining，給輪詢排程用（P62 C5）
  // 逾時（預設 20 秒）：丟 AbortError，classifyError 當成網路錯誤（那一筆回到排隊）。用 race，連不理會 signal 的 fetch 也一樣會逾時
  const f = (u, o = {}) => {
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = 0;
    const to = new Promise((_, rej) => {
      timer = setTimeout(() => { if (ac) ac.abort(); const e = new Error('請求逾時'); e.name = 'AbortError'; rej(e); }, timeoutMs);
    });
    return Promise.race([rawF(u, ac ? { ...o, signal: ac.signal } : o), to]).then((res) => {
      try {
        const v = res && res.headers && typeof res.headers.get === 'function' ? res.headers.get('x-ratelimit-remaining') : null;
        if (v != null && v !== '' && Number.isFinite(Number(v))) rate = Number(v);
        const dh = res && res.headers && typeof res.headers.get === 'function' ? res.headers.get('date') : null;
        if (dh) setServerDate(dh); // 手機時鐘偏差超過 2 分鐘時，「多久之前」類判斷改用校正後的現在（lib/tz.js）
      } catch (e) { /* 讀不到就維持舊值 */ }
      return res;
    }).finally(() => clearTimeout(timer));
  };
  const pre = prefix ? prefix.replace(/^\/+|\/+$/g, '') + '/' : '';
  const isSignal = (ref) => ref === SIGNAL_BRANCH;
  const url = (path, ref) => 'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' +
    encodeURIComponent(repo) + '/contents/' + encPath((isSignal(ref) ? '' : pre) + path);
  const refOf = (ref) => ref || branch;
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

  async function getFile(path, ref) {
    const key = url(path, ref) + '?ref=' + encodeURIComponent(refOf(ref));
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

  // 路徑與分支都對才放行：signal 分支只能寫 SIGNAL_WRITABLE；其他分支（含任意 ref）一律不給寫
  // sha：這一筆要不要帶 sha（覆寫）。hub in/ 只能新建，帶 sha＝拒絕
  function allowWrite(path, ref, sha) {
    if (ref === undefined || ref === null || ref === '') return writable.has(pre + path);
    if (isSignal(ref)) return SIGNAL_WRITABLE.includes(path) || (isHubInPath(path) && !sha);
    return false;
  }

  async function putFile(path, text, sha, message, ref) {
    if (!allowWrite(path, ref, sha)) throw new Error('不允許寫入這個檔案：' + path);
    const br = refOf(ref);
    const res = await f(url(path, ref), {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(sha ? { message, content: encodeBase64Utf8(text), sha, branch: br } : { message, content: encodeBase64Utf8(text), branch: br }),
    });
    if (!res.ok) await fail(res);
    etags.delete(url(path, ref) + '?ref=' + encodeURIComponent(br)); // 剛寫過，舊 ETag 作廢
    return res.json();
  }

  // 先抓最新版、只改那一小段、再 PUT；sha 過期（409／422）就重抓重試，最多 maxTries 次
  // opts.create＝true：檔案不存在（404）時建新檔（mutate 會收到 null）。只限紀錄資料檔白名單，而且要先讀得到 Task.md 等其他檔
  // opts.ref：signal 分支的檔案。signal 檔不存在（含分支還沒建）時，只要路徑在可寫清單就建新檔，不用 probe 主分支
  async function updateFile(path, mutate, message, maxTries = 3, opts = {}) {
    let lastErr = null;
    const ref = opts.ref;
    if (ref && (!allowWrite(path, ref) || isHubInPath(path))) throw new Error('不允許寫入這個檔案：' + path); // hub in/ 只能用 putFile 新建，不能「讀了再改」
    const sigCreate = isSignal(ref) && opts.create;
    for (let n = 0; n < maxTries; n++) {
      if (n > 0) await wait(600);
      let cur;
      try { cur = await getFile(path, ref); } catch (e) {
        if (!(e instanceof GitHubError && e.status === 404 && opts.create && (sigCreate || (!ref && creatable.has(pre + path))))) throw e;
        if (!sigCreate) {
          let reachable = false;
          for (const pf of PROBE_FILES) { try { await getFile(pf); reachable = true; break; } catch (e2) { /* 試下一個 */ } }
          if (!reachable) throw e; // 其他檔也讀不到：多半是權限或路徑前綴不對，不建檔
        }
        cur = { text: null, sha: undefined };
      }
      const next = mutate(cur.text);
      if (typeof next !== 'string') throw new Error('內部錯誤：修改結果不是文字，已取消寫入');
      if (next === cur.text) return { text: cur.text, changed: false, tries: n + 1 };
      try {
        await putFile(path, next, cur.sha, message, ref);
        return { text: next, changed: true, tries: n + 1 };
      } catch (e) {
        if (e instanceof GitHubError && (e.status === 409 || e.status === 422)) {
          etags.delete(url(path, ref) + '?ref=' + encodeURIComponent(refOf(ref))); // sha 過期：重試前先作廢 ETag，一定拿到新內容（不會 304 回舊的）
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

  // signal 分支的檔案（只讀用）：分支或檔案不存在（404）當成「還沒啟用」，回 {text:'', sha:null, missing:true}，不報錯
  async function getSignalFile(path) {
    try { return { ...(await getFile(path, SIGNAL_BRANCH)), missing: false }; } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return { text: '', sha: null, missing: true };
      throw e;
    }
  }

  // 最新 commit 的 sha（GET commits/{branch}，Accept: application/vnd.github.sha，帶 ETag）：body 只有 40 字元，沒變回 304（不扣 rate limit）
  async function headSha() {
    const key = 'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/commits/' + encodeURIComponent(branch);
    const e = etags.get(key);
    const h = { ...headers, Accept: 'application/vnd.github.sha' };
    if (e && e.etag) h['If-None-Match'] = e.etag;
    const res = await f(key, { headers: h, cache: 'no-store' });
    if (res.status === 304 && e && e.sha) return { sha: e.sha, notModified: true };
    if (!res.ok) await fail(res);
    const sha = String(await res.text()).trim();
    const tag = etagOf(res);
    const prev = e && e.sha;
    if (tag) etags.set(key, { etag: tag, sha });
    return { sha, notModified: false, changed: prev !== sha };
  }

  // 把某個檔案的記憶體 ETag 快取（含原文）刪掉；下次讀取會重抓。給 signal 檔這種不想留在記憶體的內容用
  function forget(path, ref) { etags.delete(url(path, ref) + '?ref=' + encodeURIComponent(refOf(ref))); }
  return { getFile, putFile, updateFile, listCommits, getSignalFile, headSha, forget, rateRemaining: () => rate };
}
