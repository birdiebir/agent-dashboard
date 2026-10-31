// 只快取 app 本身的檔案（cache-first）。不碰任何跨網域（GitHub API）的回應。
// 改了任何 app 檔案就把版本號加一，舊快取會在 activate 時清掉。
// 部署時 workflow 會用 commit sha 取代 67c0232；本機沒被取代時照常運作
const VERSION = '67c0232';
const CACHE = 'agent-app-' + VERSION;
const FILES = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'lib/b64.js', 'lib/md.js', 'lib/parse.js', 'lib/edit.js', 'lib/github.js', 'lib/actions.js',
  'lib/projects.js', 'lib/commits.js', 'lib/pin.js',
  'lib/drafts.js', 'lib/questions.js', 'lib/journal.js', 'lib/status.js',
  'lib/chat.js', 'lib/activity.js', 'lib/projectview.js', 'lib/quota.js', 'lib/tasks.js', 'lib/local.js', 'lib/home.js', 'lib/brand.js', 'lib/qlist.js',
  'lib/outbox.js', 'lib/outbox_exec.js', 'lib/taskedit.js', 'lib/mine.js', 'lib/pcstate.js', 'lib/reminders.js', 'lib/reports.js', 'lib/errmsg.js',
  'lib/records.js', 'lib/records_schema.js', 'lib/records_query.js', 'lib/records_ui.js', 'lib/cache.js', 'lib/tabs.js',
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
