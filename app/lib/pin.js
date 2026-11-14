// 可選的 PIN 鎖：token 用 PBKDF2（SHA-256）導出金鑰，AES-GCM 加密後才存；解開的 token 只放記憶體。
// 錯 5 次就清除加密資料，要求重新設定。storage 可替換（測試用記憶體版）。
export const MIN_ITERATIONS = 150000;
export const DEFAULT_ITERATIONS = 210000;
export const MAX_FAILS = 5;

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const validPin = (pin) => /^\d{4,6}$/.test(String(pin));

async function deriveKey(pin, salt, iterations) {
  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// 用已經導出的金鑰加解密 JSON（畫面資料的離線快取用；每次用新的隨機 IV）。金鑰只放記憶體（不可匯出的 CryptoKey）
export async function encryptJson(key, value) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value)));
  return { v: 1, iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}
export async function decryptJson(key, blob) {
  if (!blob || blob.v !== 1) throw new Error('加密資料格式不對');
  const pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(blob.iv) }, key, fromB64(blob.ct));
  return JSON.parse(dec.decode(pt));
}
export async function keyFromBlob(blob, pin) {
  return deriveKey(pin, fromB64(blob.salt), blob.iter);
}

export async function encryptToken(token, pin, iterations = DEFAULT_ITERATIONS) {
  if (!validPin(pin)) throw new Error('PIN 要是 4～6 位數字');
  if (iterations < MIN_ITERATIONS) throw new Error('迭代次數太低');
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt, iterations);
  const ct = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(String(token)));
  return { v: 1, iter: iterations, salt: toB64(salt), iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

// PIN 錯或資料被改過都會丟錯
export async function decryptToken(blob, pin) {
  if (!blob || blob.v !== 1 || !(blob.iter >= MIN_ITERATIONS)) throw new Error('加密資料格式不對');
  if (!validPin(pin)) throw new Error('PIN 格式不對');
  const key = await deriveKey(pin, fromB64(blob.salt), blob.iter);
  const pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(blob.iv) }, key, fromB64(blob.ct));
  return dec.decode(pt);
}

export function createVault(storage, blobKey = 'agent.vault', failKey = 'agent.vaultfails') {
  const fails = () => Number(storage.getItem(failKey)) || 0;
  let cacheKey = null; // 解鎖（或剛設好 PIN）之後的金鑰，只放記憶體；鎖定、清除時丟掉
  const vault = {
    // 離線快取加密用：沒解鎖就是 null
    cacheKey: () => cacheKey,
    hasVault: () => !!storage.getItem(blobKey),
    failCount: fails,
    wipe() { cacheKey = null; storage.removeItem(blobKey); storage.removeItem(failKey); },
    async enable(token, pin) {
      const blob = await encryptToken(token, pin);
      storage.setItem(blobKey, JSON.stringify(blob));
      storage.setItem(failKey, '0');
      cacheKey = await keyFromBlob(blob, pin); // 新 PIN＝新金鑰，舊的加密快取自然解不開
    },
    // 回傳 {ok:true, token} 或 {ok:false, wiped, left, invalid?}
    async unlock(pin) {
      if (!vault.hasVault()) return { ok: false, wiped: true, left: 0 };
      if (!validPin(pin)) return { ok: false, wiped: false, left: MAX_FAILS - fails(), invalid: true };
      const n = fails() + 1; // 先記一次失敗再試，中途關掉頁面也不能無限試
      storage.setItem(failKey, String(n));
      try {
        const blob = JSON.parse(storage.getItem(blobKey));
        const token = await decryptToken(blob, pin);
        storage.setItem(failKey, '0');
        cacheKey = await keyFromBlob(blob, pin);
        return { ok: true, token };
      } catch (e) {
        if (n >= MAX_FAILS) { vault.wipe(); return { ok: false, wiped: true, left: 0 }; }
        return { ok: false, wiped: false, left: MAX_FAILS - n };
      }
    },
  };
  return vault;
}
