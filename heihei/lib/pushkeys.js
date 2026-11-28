// P74 推播預覽：把解回覆用的金鑰（extractable:false 的 CryptoKey，拿不出位元組）存進 IndexedDB，
// 讓 Service Worker 在 App 沒開時也能解開推播裡的回覆密文、顯示前段文字。sw.js 用同一組名稱讀（PUSH_DB／PUSH_STORE）。
//   · 只存 K_enc、K_e2e（手機那把＋雲端值班那把），沒有主金鑰、沒有 K_auth：拿到也打不了雲端 API
//   · 解除配對、移除值班金鑰時一起刪；記錄依 kid 存，一筆 {kid, src, encKey, e2eKey}
export const PUSH_DB = 'heihei-push';
export const PUSH_STORE = 'keys';
export const PREVIEW_CHARS = 60;

function openDb(idb) {
  return new Promise((resolve, reject) => {
    const req = idb.open(PUSH_DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(PUSH_STORE)) req.result.createObjectStore(PUSH_STORE, { keyPath: 'kid' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(PUSH_STORE, mode);
    fn(t.objectStore(PUSH_STORE));
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// keys：cloudsource pushKeys() 的結果 {phone:{kid,encKey,e2eKey}, worker:{…}|null}。整批取代（舊 kid 刪掉）
export async function savePushKeys(keys, idb = globalThis.indexedDB) {
  if (!idb || !keys) return false;
  const rows = [['laptop', keys.phone], ['worker', keys.worker]].filter(([, k]) => k && /^[0-9a-f]{8}$/.test(String(k.kid)) && k.encKey && k.e2eKey)
    .map(([src, k]) => ({ kid: k.kid, src, encKey: k.encKey, e2eKey: k.e2eKey }));
  try {
    const db = await openDb(idb);
    try { await tx(db, 'readwrite', (s) => { s.clear(); rows.forEach((r) => s.put(r)); }); } finally { db.close(); }
    return true;
  } catch { return false; }
}
export async function clearPushKeys(idb = globalThis.indexedDB) {
  if (!idb) return false;
  try {
    const db = await openDb(idb);
    try { await tx(db, 'readwrite', (s) => s.clear()); } finally { db.close(); }
    return true;
  } catch { return false; }
}

// 移除雲端值班時保留手機金鑰，不必等下一次雲端同步。
export async function clearWorkerPushKeys(idb = globalThis.indexedDB) {
  if (!idb) return false;
  try {
    const db = await openDb(idb);
    try {
      await tx(db, 'readwrite', (s) => {
        const req = s.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          if (cursor.value.src === 'worker') cursor.delete();
          cursor.continue();
        };
      });
    } finally { db.close(); }
    return true;
  } catch { return false; }
}

// 推播通知內文：回覆前段，壓成一行、截到 PREVIEW_CHARS 字（超過加…）
export function previewText(text, n = PREVIEW_CHARS) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  const a = [...flat];
  return a.length > n ? a.slice(0, n).join('') + '…' : flat;
}
