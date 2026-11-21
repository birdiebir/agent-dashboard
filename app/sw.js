// 只快取 app 本身的檔案（cache-first）。不碰任何跨網域（GitHub API）的回應。
// 改了任何 app 檔案就把版本號加一，舊快取會在 activate 時清掉。
// 部署時 workflow 會用 commit sha 取代 2fb101201；本機沒被取代時照常運作
const VERSION = '2fb101201';
const CACHE = 'agent-app-' + VERSION;
const FILES = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'lib/b64.js', 'lib/md.js', 'lib/parse.js', 'lib/edit.js', 'lib/github.js', 'lib/actions.js',
  'lib/projects.js', 'lib/commits.js', 'lib/pin.js',
  'lib/drafts.js', 'lib/questions.js', 'lib/journal.js', 'lib/status.js', 'lib/tz.js',
  'lib/chat.js', 'lib/activity.js', 'lib/projectview.js', 'lib/quota.js', 'lib/tasks.js', 'lib/local.js', 'lib/home.js', 'lib/brand.js', 'lib/qlist.js',
  'lib/outbox.js', 'lib/outbox_exec.js', 'lib/taskedit.js', 'lib/mine.js', 'lib/pcstate.js', 'lib/reminders.js', 'lib/reports.js', 'lib/errmsg.js', 'lib/consensus.js', 'lib/doclinks.js',
  'lib/push.js', 'lib/remoteopen.js', 'lib/remoteoff.js', 'lib/fastpath.js', 'lib/push_config.js', 'lib/chatstatus.js', 'lib/chatpoll.js', 'lib/chatview.js', 'lib/datesep.js','lib/records.js', 'lib/records_schema.js', 'lib/records_query.js', 'lib/records_ui.js', 'lib/cache.js', 'lib/tabs.js', 'lib/icons.js', 'lib/copy.js', 'lib/quote.js', 'lib/remindview.js', 'lib/diag.js', 'lib/workstatus.js', 'lib/p72.js', 'lib/p72home.js', 'lib/datasource.js', 'lib/source_config.js', 'lib/cloudsource.js', 'lib/cloudcfg.js', 'lib/cloudpair.js', 'lib/cloudchat.js', 'lib/needs.js', 'lib/desk.js', 'lib/hub.js', 'lib/hub_schema.js', 'lib/five.js', 'lib/notices.js',
  'lib/kanban.js', 'lib/attention.js', 'lib/undohold.js', 'lib/presence.js', 'lib/ctx.js', 'lib/pushkeys.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-192.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/badge-96.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
  // 不再自動 skipWaiting：新版先等著，app.js 偵測到會顯示「有新版本，點這裡更新」，使用者點了才換
  // （第一次安裝沒有舊版在跑，會直接啟用，不受影響）
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('agent-app-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // 跨網域一律放行、不快取
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && FILES.some((f) => url.pathname.endsWith(f.replace(/^\.\//, '')) && f !== './')) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })),
  );
});

// ---------- P62 M4b：Web Push ----------
// 通知內容只用電腦端送來的 title／body／tag／kind（固定樣板，不含私人內容）；全部當純文字、截長度、不當 HTML、不拿來組網址
const clip = (v, n, fb) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : fb);
const TAB_OF = { decision: 'todo', job_done: 'home', job_stuck: 'home' }; // 工作做完／卡住去首頁狀態卡；其他 kind 都去對話頁
const JOB_TAG = /^job-([a-z0-9]{6})$/; // 電腦端 job 推播的標籤 job-<編號>；只收這個格式，轉成 j-<編號>
const JOB_ID = /^j-[a-z0-9]{6}$/;
// 推播樣式（m-utqknz15：只改樣式、不改標題與內文）。tag 由電腦端給（同類用 kind、工作用 job-<編號>），同 tag 的新通知會取代舊的、不洗版。
// requireInteraction 只給「要你決定」；renotify＝取代舊通知時要不要再響一次；silent＝只進通知列不響不震。
const STYLE = {
  decision: { requireInteraction: true, renotify: true, silent: false },
  reply: { renotify: true, silent: false },
  job_stuck: { renotify: true, silent: false },
  listener_stalled: { renotify: true, silent: false },
  opener: { renotify: true, silent: false },
  job_done: { renotify: false, silent: false },
  remote_on: { renotify: false, silent: true },
  remote_off: { renotify: false, silent: true },
  remote_reopen: { renotify: false, silent: true },
};
const STYLE_DEFAULT = { renotify: true, silent: false };
// 「看」＝跟點通知一樣打開對應分頁；「稍後」＝只把通知收掉（App 裡的卡片還在）。iPhone 不顯示按鈕，點通知照舊打開。
const ACTIONS = [{ action: 'open', title: '看' }, { action: 'later', title: '稍後' }];

// ---------- P74 推播預覽與跳轉 ----------
// 推播目標編號：留言 m-（對話頁）或交辦 o-（首頁看板那張卡）；只收這兩種格式，不拿別的字組網址
const REF_RE = /^(m-[a-z0-9]{8}|o-[a-z0-9]{6})$/;
// 回覆密文（雲端大門原封不動轉來的 RLR1）：用 App 存在 IndexedDB 的 CryptoKey（lib/pushkeys.js，同名 DB／store）解開＋驗章，
// 回前 60 字；沒有金鑰、解不開、簽章不對、超時都回 ''（顯示原本的固定字樣）。不印、不存明文
const PUSH_DB = 'heihei-push', PUSH_STORE = 'keys', PREVIEW_CHARS = 60;
const b64d = (s) => { const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
function pushKey(kid) {
  return new Promise((resolve) => {
    try {
      const req = self.indexedDB.open(PUSH_DB, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(PUSH_STORE)) req.result.createObjectStore(PUSH_STORE, { keyPath: 'kid' }); };
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        try {
          const g = db.transaction(PUSH_STORE, 'readonly').objectStore(PUSH_STORE).get(kid);
          g.onsuccess = () => { db.close(); resolve(g.result || null); };
          g.onerror = () => { db.close(); resolve(null); };
        } catch (err) { db.close(); resolve(null); }
      };
    } catch (err) { resolve(null); }
  });
}
async function openPreview(ref, e) {
  try {
    if (!e || typeof e !== 'object' || !/^m-[a-z0-9]{8}$/.test(ref) || !/^[0-9a-f]{8}$/.test(String(e.kid))) return '';
    if (!/^[A-Za-z0-9_-]{16}$/.test(String(e.iv)) || !/^[A-Za-z0-9_-]{23,2400}$/.test(String(e.ct)) || !/^[0-9a-f]{64}$/.test(String(e.sig))) return '';
    const k = await pushKey(e.kid);
    if (!k || !k.encKey || !k.e2eKey || (e.src && k.src && e.src !== k.src)) return '';
    const te = new TextEncoder();
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(e.iv), additionalData: te.encode('RLR1|' + ref + '|' + e.kid) }, k.encKey, b64d(e.ct));
    const d = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(pt));
    if (!d || typeof d.text !== 'string') return '';
    const sig = Uint8Array.from(e.sig.match(/../g), (h) => parseInt(h, 16));
    if (!(await crypto.subtle.verify('HMAC', k.e2eKey, sig, te.encode(['RLR1', ref, d.text].join(String.fromCharCode(10)))))) return '';
    const flat = d.text.replace(/\s+/g, ' ').trim();
    const a = Array.from(flat);
    return a.length > PREVIEW_CHARS ? a.slice(0, PREVIEW_CHARS).join('') + '…' : flat;
  } catch (err) { return ''; }
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(''), ms))]);

self.addEventListener('push', (e) => {
  const pushAt = Date.now();
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  if (!d || typeof d !== 'object') d = {};
  const ref = typeof d.ref === 'string' && REF_RE.test(d.ref) ? d.ref : '';
  const tab = TAB_OF[d.kind] || 'chat';
  const tm = tab === 'home' && typeof d.tag === 'string' ? JOB_TAG.exec(d.tag) : null;
  const title = clip(d.title, 60, '嘿嘿');
  const st = Object.prototype.hasOwnProperty.call(STYLE, d.kind) ? STYLE[d.kind] : STYLE_DEFAULT;
  const opts = {
    body: clip(d.body, 120, '打開 App 看看'), // 推播預覽：下面解得開回覆密文就換成回覆前段
    tag: clip(d.tag, 40, 'heihei'),
    renotify: st.renotify,
    silent: st.silent,
    ...(st.requireInteraction ? { requireInteraction: true } : {}),
    actions: ACTIONS,
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png', // Android 狀態列只看透明度：用單色剪影，彩圖會變一塊方塊
    data: { ...(tm ? { tab, job: 'j-' + tm[1] } : { tab }), ...(d.kind === 'reply' ? { kind: 'reply', pushAt } : {}), ...(ref ? { ref } : {}) },
  };
  const preview = d.kind === 'reply' && ref && d.e ? withTimeout(openPreview(ref, d.e), 3000) : Promise.resolve('');
  e.waitUntil(Promise.all([
    preview.then((t) => self.registration.showNotification(title, t ? { ...opts, body: t } : opts)),
    // 開著的頁面立刻刷新（聊天馬上看到回覆）
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => cs.forEach((c) => c.postMessage({ type: 'REFRESH', kind: d.kind === 'reply' ? 'reply' : '', pushAt }))),
  ]));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  if (e.action === 'later') return; // 稍後：只收掉通知
  const nd = e.notification.data || {};
  const tab = ['todo', 'home', 'notices'].includes(nd.tab) ? nd.tab : 'chat';
  const job = tab === 'home' && typeof nd.job === 'string' && JOB_ID.test(nd.job) ? nd.job : null; // 合格式才帶，不拿來組奇怪的網址
  const pushAt = Number.isSafeInteger(nd.pushAt) && nd.pushAt >= Date.now() - 86400000 && nd.pushAt <= Date.now() + 60000 ? nd.pushAt : null;
  const timing = nd.kind === 'reply' && pushAt ? { kind: 'reply', pushAt } : {};
  const ref = typeof nd.ref === 'string' && REF_RE.test(nd.ref) ? nd.ref : '';
  const url = './?tab=' + tab + (job ? '&job=' + job : '') + (ref ? '&ref=' + ref : '') + (timing.pushAt ? '&pushAt=' + timing.pushAt : '');
  const open = () => self.clients.openWindow(url);
  // P74 修「點了沒反應」：同網域的其他頁（看板、另一個網址的 App）也會被 matchAll 列出來，只挑這個 SW 範圍內的視窗；
  // 聚焦失敗（Android 有時拒絕）就改開新視窗，冷啟動靠網址參數跳轉
  const scope = (self.registration && self.registration.scope) || '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => 'focus' in x && (!scope || typeof x.url !== 'string' || x.url.startsWith(scope)));
    if (!c) return open();
    return Promise.resolve().then(() => c.focus()).then(() => c.postMessage({ ...(job ? { type: 'GOTO', tab, job } : { type: 'GOTO', tab }), ...(ref ? { ref } : {}), ...timing }), () => open());
  }).catch(() => open()));
});
