// 草稿集中存取（P46 v3 第 3 階段 1-4：Q202＝C，草稿不加密、直接存這台手機）。
// 預設是記憶體版（測試與示範模式用）；app.js 啟動時呼叫 useStorage(儲存空間) 切到落地版，
// 所有 key 加上前綴 agent.draft.，重開 App 草稿還在，送出成功才清。API 跟第 1 階段一樣。
// 這個檔不直接碰任何全域儲存物件，儲存空間由呼叫端傳進來（test/v3.test.js 靜態檢查只准用 PREFIX）。
export const PREFIX = 'agent.draft.';
const store = new Map();
let backend = null;

function persist(key, value, keepEmpty = false) {
  if (!backend) return;
  try {
    if (value == null || (value === '' && !keepEmpty)) backend.removeItem(PREFIX + key);
    else backend.setItem(PREFIX + key, value);
  } catch (e) { /* 空間不足或被禁用：草稿仍在記憶體，不影響使用 */ }
}

// 切到落地版：把已存的 agent.draft.* 讀進來。傳 null 回到純記憶體
export function useStorage(storage) {
  backend = storage || null;
  store.clear();
  if (!backend) return;
  try {
    for (let i = 0; i < backend.length; i++) {
      const k = backend.key(i);
      if (k && k.startsWith(PREFIX)) {
        const v = backend.getItem(k);
        if (v !== null) store.set(k.slice(PREFIX.length), v); // 空字串＝使用者清空的草稿，也要留著
      }
    }
  } catch (e) { /* 讀不到就當沒有草稿 */ }
}

export function getDraft(key) {
  return store.get(key) || '';
}

export function setDraft(key, value) {
  const v = String(value == null ? '' : value);
  if (v === '') store.delete(key);
  else store.set(key, v);
  persist(key, v);
}

// 「沒有草稿」和「草稿是空字串（使用者清空了）」要分開：清空日記某題後，重畫、重開 App 都不能把舊答案填回來
export function hasDraft(key) {
  return store.has(key);
}

// 有編輯基準的輸入框用：空字串也存成草稿
export function setEdit(key, value) {
  const v = String(value == null ? '' : value);
  store.set(key, v);
  persist(key, v, true);
}

// 預填：框裡已經有還沒送出的草稿就接在後面（中間空一行），不覆蓋
export function appendDraft(key, text) {
  const cur = store.get(key) || '';
  setDraft(key, cur.trim() ? cur.replace(/\s+$/, '') + '\n\n' + text : text);
}

export function clearDraft(key) {
  store.delete(key);
  persist(key, '');
}

export function clearAllDrafts() {
  if (backend) {
    try {
      const ks = [];
      for (let i = 0; i < backend.length; i++) { const k = backend.key(i); if (k && k.startsWith(PREFIX)) ks.push(k); }
      for (const k of ks) backend.removeItem(k);
    } catch (e) { /* 忽略 */ }
  }
  store.clear();
}

// 有內容（去掉空白後不是空的）的草稿 key
export function unsentKeys() {
  return [...store].filter(([, v]) => v.trim() !== '').map(([k]) => k);
}

export function hasUnsent() {
  return unsentKeys().length > 0;
}
