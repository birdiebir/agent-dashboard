// 畫面資料的離線快取（含紀錄中心的資料）。純函式＋傳進來的 storage 與金鑰。
//   PIN 關著：明文存 agent.cache（照舊）
//   PIN 開著：用 vault 解鎖後的金鑰 AES-GCM 加密，存 agent.cache.enc；沒解鎖（沒有金鑰）就讀不到、也不存；明文那份一律刪掉
// 換 PIN／忘記 PIN／錯 5 次清除時 clearCache 兩份都清。
import { encryptJson, decryptJson } from './pin.js';

export const CACHE_KEY = 'agent.cache';
export const CACHE_ENC_KEY = 'agent.cache.enc';

export function clearCache(storage) {
  try { storage.removeItem(CACHE_KEY); } catch (e) { /* 忽略 */ }
  try { storage.removeItem(CACHE_ENC_KEY); } catch (e) { /* 忽略 */ }
}

// 回傳 true＝存成功（或不需要存）。pin：設定裡有沒有開 PIN；key：vault.cacheKey()
export async function saveCache(storage, data, { pin = false, key = null } = {}) {
  if (!data) return true;
  try {
    if (pin) {
      storage.removeItem(CACHE_KEY); // 開 PIN 時絕不留明文
      if (!key) return false; // 還沒解鎖：不存（舊的加密快取留著）
      storage.setItem(CACHE_ENC_KEY, JSON.stringify(await encryptJson(key, data)));
      return true;
    }
    storage.removeItem(CACHE_ENC_KEY);
    storage.setItem(CACHE_KEY, JSON.stringify(data));
    return true;
  } catch (e) { return false; /* 空間不足或加密失敗：快取只是方便，不影響資料 */ }
}

// 讀快取。PIN 開著而沒有金鑰、或金鑰不對（換過 PIN）→ null
export async function loadCache(storage, { pin = false, key = null } = {}) {
  try {
    if (pin) {
      if (!key) return null;
      const raw = storage.getItem(CACHE_ENC_KEY);
      return raw ? await decryptJson(key, JSON.parse(raw)) : null;
    }
    return JSON.parse(storage.getItem(CACHE_KEY)) || null;
  } catch (e) { return null; }
}
