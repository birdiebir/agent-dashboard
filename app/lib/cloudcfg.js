// P74 Phase 2：signal/cloud_relay.json 只讀入記憶體。getSignalFile 由 GitHub client 負責 ETag。
// 不交給 saveCache／localStorage／SW／診斷；對外只提供 source，不暴露憑證。
import { URL_RE, KID_RE, KEY_RE, b64urlDecode, createCloudSource } from './cloudsource.js';
import { CLOUD_RELAY_ORIGIN } from './source_config.js';
import { isCloudOff } from './cloudpair.js';

export const CLOUD_SIGNAL_PATH = 'signal/cloud_relay.json';
export const CLOUD_RECHECK_MS = 60000;
function expiryMs(value) {
  if (Number.isSafeInteger(value) && value > 0) {
    const ms = value < 1e12 ? value * 1000 : value;
    return Number.isSafeInteger(ms) && Number.isFinite(new Date(ms).getTime()) ? ms : NaN;
  }
  // 電腦端沿用 relay 的 ISO 時間；必須帶時區，不接受數字字串或本機日期格式。
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return NaN;
  const [hour, minute, second] = value.slice(11, 19).split(':').map(Number);
  if (hour > 23 || minute > 59 || second > 59) return NaN;
  return Date.parse(value);
}
export function parseCloudSignal(text, now = Date.now()) {
  let j;
  try { j = JSON.parse(text); } catch { return null; }
  const fields = ['v', 'url', 'kid', 'key', 'expires_at'];
  if (!j || typeof j !== 'object' || Array.isArray(j) || Object.keys(j).length !== fields.length || !fields.every((k) => Object.hasOwn(j, k))) return null;
  if (j.v !== 1 || typeof j.url !== 'string' || !URL_RE.test(j.url) || j.url !== CLOUD_RELAY_ORIGIN) return null;
  if (typeof j.kid !== 'string' || !KID_RE.test(j.kid) || typeof j.key !== 'string' || !KEY_RE.test(j.key)) return null;
  try { if (b64urlDecode(j.key).length !== 32) return null; } catch { return null; }
  const expiresAt = expiryMs(j.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  return { url: j.url, kid: j.kid, key: j.key, expiresAt };
}

// paired()：掃碼配對的金鑰（lib/cloudpair.js；沒有回 null）。有就優先用它，signal 只看是不是關閉訊號。
export function createCloudConfig({ now = () => Date.now(), makeSource = createCloudSource, deps = {}, paired = () => null } = {}) {
  let source = null, expiresAt = 0, lastRead = -Infinity, pending = null, epoch = 0, signature = '';
  const get = () => {
    if (now() >= expiresAt) { source = null; signature = ''; }
    return source;
  };
  return {
    get,
    async sync(client) {
      if (!client || typeof client.getSignalFile !== 'function') return null;
      if (pending) return pending;
      if (now() - lastRead < CLOUD_RECHECK_MS) return get();
      lastRead = now();
      const generation = epoch;
      pending = (async () => {
        try {
          let r = null, readFailed = false;
          try { r = await client.getSignalFile(CLOUD_SIGNAL_PATH); } catch { readFailed = true; }
          if (generation !== epoch) return null;
          // 關閉訊號：不管有沒有配對金鑰都停用雲端（電腦端 cloud_off.py）
          if (!readFailed && isCloudOff(r && r.text)) { source = null; signature = ''; return null; }
          const p = paired();
          // 配對金鑰不帶到期：電腦自動續期、手機不知道新期限，以雲端回應為準（過期或撤銷回 401 → 退回 GitHub）
          const pairedCfg = p ? { url: p.url, kid: p.kid, key: p.key } : null;
          if (readFailed && !pairedCfg) throw new Error('signal_unavailable');
          const cfg = pairedCfg || parseCloudSignal(r && r.text, now());
          if (!cfg) { source = null; signature = ''; return null; }
          // 比對包含 key，處理同 kid 換金鑰；只存在這個閉包。
          const sig = JSON.stringify(cfg);
          if (sig !== signature || !get()) { source = makeSource(cfg, { ...deps, now }); signature = sig; }
          expiresAt = cfg.expiresAt;
        } catch { /* 暫時讀不到：有效金鑰可沿用；過期 get() 立即清掉 */ }
        return get();
      })();
      try { return await pending; } finally { if (generation === epoch) pending = null; }
    },
    // 配對金鑰換了（剛掃碼、解鎖後載入、解除配對）：下次 sync 不等 60 秒
    invalidate() { lastRead = -Infinity; },
    clear(client) {
      epoch++; source = null; expiresAt = 0; lastRead = -Infinity; signature = ''; pending = null;
      try { client?.forget?.(CLOUD_SIGNAL_PATH, 'signal'); } catch { /* 只清記憶體 ETag */ }
    },
  };
}
