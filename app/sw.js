// 只快取 app 本身的檔案（cache-first）。不碰任何跨網域（GitHub API）的回應。
// 改了任何 app 檔案就把版本號加一，舊快取會在 activate 時清掉。
// 部署時 workflow 會用 commit sha 取代 5c4d6d7c；本機沒被取代時照常運作
const VERSION = '5c4d6d7c';
const CACHE = 'agent-app-' + VERSION;
const FILES = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'lib/b64.js', 'lib/md.js', 'lib/parse.js', 'lib/edit.js', 'lib/github.js', 'lib/actions.js',
  'lib/projects.js', 'lib/commits.js', 'lib/pin.js',
  'lib/drafts.js', 'lib/questions.js', 'lib/journal.js', 'lib/status.js', 'lib/tz.js',
  'lib/chat.js', 'lib/activity.js', 'lib/projectview.js', 'lib/quota.js', 'lib/tasks.js', 'lib/local.js', 'lib/home.js', 'lib/brand.js', 'lib/qlist.js',
  'lib/outbox.js', 'lib/outbox_exec.js', 'lib/taskedit.js', 'lib/mine.js', 'lib/pcstate.js', 'lib/reminders.js', 'lib/reports.js', 'lib/errmsg.js', 'lib/consensus.js', 'lib/doclinks.js',
  'lib/push.js', 'lib/remoteopen.js', 'lib/remoteoff.js', 'lib/fastpath.js', 'lib/push_config.js', 'lib/chatstatus.js', 'lib/chatpoll.js', 'lib/chatview.js', 'lib/datesep.js','lib/records.js', 'lib/records_schema.js', 'lib/records_query.js', 'lib/records_ui.js', 'lib/cache.js', 'lib/tabs.js', 'lib/icons.js', 'lib/copy.js', 'lib/quote.js', 'lib/remindview.js', 'lib/diag.js', 'lib/workstatus.js', 'lib/p72.js', 'lib/p72home.js', 'lib/datasource.js', 'lib/source_config.js', 'lib/cloudsource.js', 'lib/cloudcfg.js', 'lib/cloudchat.js', 'lib/needs.js', 'lib/hub.js', 'lib/hub_schema.js', 'lib/five.js', 'lib/notices.js',
  'lib/kanban.js',
  'icons/icon-192.png', 'icons/icon-512.png',
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

self.addEventListener('push', (e) => {
  const pushAt = Date.now();
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  if (!d || typeof d !== 'object') d = {};
  const tab = TAB_OF[d.kind] || 'chat';
  const tm = tab === 'home' && typeof d.tag === 'string' ? JOB_TAG.exec(d.tag) : null;
  const title = clip(d.title, 60, '嘿嘿');
  const opts = {
    body: clip(d.body, 120, '打開 App 看看'),
    tag: clip(d.tag, 40, 'heihei'),
    renotify: true,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { ...(tm ? { tab, job: 'j-' + tm[1] } : { tab }), ...(d.kind === 'reply' ? { kind: 'reply', pushAt } : {}) },
  };
  e.waitUntil(Promise.all([
    self.registration.showNotification(title, opts),
    // 開著的頁面立刻刷新（聊天馬上看到回覆）
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => cs.forEach((c) => c.postMessage({ type: 'REFRESH', kind: d.kind === 'reply' ? 'reply' : '', pushAt }))),
  ]));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const nd = e.notification.data || {};
  const tab = ['todo', 'home', 'notices'].includes(nd.tab) ? nd.tab : 'chat';
  const job = tab === 'home' && typeof nd.job === 'string' && JOB_ID.test(nd.job) ? nd.job : null; // 合格式才帶，不拿來組奇怪的網址
  const pushAt = Number.isSafeInteger(nd.pushAt) && nd.pushAt >= Date.now() - 86400000 && nd.pushAt <= Date.now() + 60000 ? nd.pushAt : null;
  const timing = nd.kind === 'reply' && pushAt ? { kind: 'reply', pushAt } : {};
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => 'focus' in x);
    if (c) return c.focus().then(() => c.postMessage({ ...(job ? { type: 'GOTO', tab, job } : { type: 'GOTO', tab }), ...timing }));
    return self.clients.openWindow('./?tab=' + tab + (job ? '&job=' + job : '') + (timing.pushAt ? '&pushAt=' + timing.pushAt : ''));
  }));
});
