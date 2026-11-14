// P74 掃碼配對（Q396①）：手機金鑰不經過 GitHub。電腦 tools/pair_phone.py 在螢幕顯示 QR，
// 內容是 <App 網址>#pair=<base64url(JSON)>；# 後面的片段瀏覽器不會送給任何伺服器。
// App 讀到後存這台手機（PIN 開著就用 vault 金鑰加密，跟離線快取同一層），立刻把網址片段清掉。
// 另外：signal/cloud_relay.json 是 {"cloud":"off"} 時，就算有配對金鑰也停用雲端（電腦端 tools/cloud_off.py 的關閉訊號）。
import { URL_RE, KID_RE, KEY_RE, b64urlDecode } from './cloudsource.js';
import { CLOUD_RELAY_ORIGIN } from './source_config.js';
import { encryptJson, decryptJson } from './pin.js';

export const PAIR_KEY = 'agent.cloudpair';
export const PAIR_ENC_KEY = 'agent.cloudpair.enc';
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

// 驗證配對內容；不合格一律 null（不丟例外、不留部分資料）。
// allowExpired：存在手機裡的配對金鑰不自己判到期——電腦每天自動向雲端續期（同一把 kid），手機不知道新的到期時間；
// 真的過期或被撤銷時雲端會回 401，App 自動退回 GitHub（6a 查核必修 1）。剛掃到的配對碼照樣要沒過期。
export function validPair(j, now = Date.now(), { allowExpired = false } = {}) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  if (j.v !== 2 || j.via !== 'qr') return null;
  if (typeof j.url !== 'string' || !URL_RE.test(j.url) || j.url !== CLOUD_RELAY_ORIGIN) return null;
  if (typeof j.kid !== 'string' || !KID_RE.test(j.kid) || typeof j.key !== 'string' || !KEY_RE.test(j.key)) return null;
  try { if (b64urlDecode(j.key).length !== 32) return null; } catch { return null; }
  if (typeof j.expires_at !== 'string' || !ISO_RE.test(j.expires_at)) return null;
  const expiresAt = Date.parse(j.expires_at);
  if (!Number.isFinite(expiresAt) || (!allowExpired && expiresAt <= now)) return null;
  return { url: j.url, kid: j.kid, key: j.key, expiresAt, expires_at: j.expires_at, via: 'qr' };
}

// location.hash → 配對內容（沒有 #pair= 或格式不對回 null）
export function parsePairFragment(hash, now = Date.now()) {
  const m = /^#pair=([A-Za-z0-9_-]{20,2000})$/.exec(String(hash || ''));
  if (!m) return null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(b64urlDecode(m[1]));
    return validPair(JSON.parse(text), now);
  } catch { return null; }
}

// 關閉訊號：{"v":1,"cloud":"off",...}
export function isCloudOff(text) {
  try { const j = JSON.parse(text); return !!j && typeof j === 'object' && j.cloud === 'off'; } catch { return false; }
}

const record = (cfg) => ({ v: 2, via: 'qr', url: cfg.url, kid: cfg.kid, key: cfg.key, expires_at: cfg.expires_at });

// 存：PIN 開著要有 vault 金鑰才存（存加密版、刪明文）；PIN 關著存明文（跟 GitHub token 同一層）
export async function savePair(storage, cfg, { pin = false, key = null } = {}) {
  if (!cfg) return false;
  try {
    if (pin) {
      if (!key) return false;
      storage.setItem(PAIR_ENC_KEY, JSON.stringify(await encryptJson(key, record(cfg))));
      storage.removeItem(PAIR_KEY);
    } else {
      storage.setItem(PAIR_KEY, JSON.stringify(record(cfg)));
      storage.removeItem(PAIR_ENC_KEY);
    }
    return true;
  } catch { return false; }
}

export async function loadPair(storage, { pin = false, key = null, now = Date.now() } = {}) {
  try {
    if (pin) {
      const blob = storage.getItem(PAIR_ENC_KEY);
      if (!blob || !key) return null;
      return validPair(await decryptJson(key, JSON.parse(blob)), now, { allowExpired: true });
    }
    const raw = storage.getItem(PAIR_KEY);
    return raw ? validPair(JSON.parse(raw), now, { allowExpired: true }) : null;
  } catch { return null; }
}

export function clearPair(storage) {
  try { storage.removeItem(PAIR_KEY); storage.removeItem(PAIR_ENC_KEY); } catch { /* 存不了也不影響 */ }
}
