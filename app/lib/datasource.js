import { parseView } from './hub.js';
import { readWorkStatus } from './workstatus.js';
import { createCloudSource, withFallback } from './cloudsource.js';
import { readState } from './pcstate.js';
// 可替換的資料來源（P71，規格 E）。每個來源是 { kind, read(name) → Promise<{text, missing}> }。
// name 是邏輯名稱（例如 work_status），路徑對應寫在 source_config.js，呼叫端不寫死。
// 讀不到（網路、權限）就丟錯，由呼叫端決定當成沒有；檔案不存在回 {text:'', missing:true}。
// 目前只實作 github（走已經有的 client.getSignalFile，唯讀、不加金鑰）；換 Supabase 或自架後端＝在 SOURCES 加一個 kind。
export const SOURCES = {
  cloud: (deps, cfg) => createCloudSource(cfg.credentials, deps),
  github: (deps, cfg) => ({
    kind: 'github',
    async read(name) {
      const path = cfg.paths && cfg.paths[name];
      if (!path) throw new Error('沒有這個名稱的資料來源：' + name);
      const r = await deps.client.getSignalFile(path);
      return { text: r && typeof r.text === 'string' ? r.text : '', missing: !!(r && r.missing), ...(r && r.sha ? { sha: r.sha } : {}) }; // sha：呼叫端要比對「有沒有變」時用（輪詢）
    },
  }),
};

export function createSource(cfg, deps) {
  if (!cfg || typeof cfg !== 'object') throw new Error('資料來源設定不能是空的');
  const make = Object.prototype.hasOwnProperty.call(SOURCES, cfg.kind) ? SOURCES[cfg.kind] : null;
  if (!make) throw new Error('不認得的資料來源：' + cfg.kind);
  if (cfg.kind === 'github' && !(deps && deps.client && typeof deps.client.getSignalFile === 'function')) throw new Error('github 資料來源需要 client');
  return make(deps || {}, cfg);
}

// hub_config／history 永遠 GitHub。雲端檔名與 App 邏輯名稱的映射只在這裡。
// onFallback 只帶名稱與固定代碼，不把 relay 的錯誤訊息（可能含私密內容）放進診斷。
// 電腦在線，雲端這份卻超過 CLOUD_STALE_MS 沒更新（雲端寫入失敗、免費額度用完）→ 這次改讀 GitHub。
// 電腦每 8 分鐘會重發一次，所以平常不會走到；電腦不在線或狀態不明時照讀雲端（GitHub 也不會比較新）。
export const CLOUD_STALE_MS = 20 * 60 * 1000;
export function cloudFirstSource(cloud, github, { onFallback, onRead, laptopOnline, now = Date.now } = {}) {
  if (!cloud) return github;
  const names = { work_status: 'work_status', hub_view: 'chat_view', mobile_state: 'mobile_state' };
  const mapped = {
    kind: 'cloud',
    async read(name) {
      const r = await cloud.read(names[name]);
      if (!r || r.missing || !r.text) throw new Error('cloud_missing');
      // JSON 壞掉也要能退 GitHub。
      const j = JSON.parse(r.text);
      const okShape = name === 'hub_view' ? parseView(r.text).ok : name === 'mobile_state' ? !!readState(r.text) : !!readWorkStatus(r.text);
      if (!j || typeof j !== 'object' || !okShape) throw new Error('cloud_bad');
      if (laptopOnline?.() === true && now() - Date.parse(r.updatedAt) > CLOUD_STALE_MS) throw new Error('cloud_stale');
      onRead?.(name, r.updatedAt);
      return r;
    },
  };
  const fallback = withFallback([mapped, {
    kind: 'github',
    read(name) { try { onFallback?.(name, 'cloud_unavailable'); } catch { /* 診斷不能擋退回 */ } return github.read(name); },
  }]);
  return { kind: 'fallback', read: (name) => names[name] ? fallback.read(name) : github.read(name) };
}

// P74 M5：mobile/state.json 雲端與 GitHub 各讀一份，generated_at 較新的用；雲端讀不到、壞掉、比較舊都用 GitHub。
// cloudRead／githubRead 回 {text}（可丟錯）；兩邊都沒有可用的就回 {text:''}
export async function pickNewerState(cloudRead, githubRead) {
  const get = async (fn) => { try { const r = fn ? await fn() : null; return r && typeof r.text === 'string' ? r.text : ''; } catch { return ''; } };
  const [cText, gText] = await Promise.all([get(cloudRead), get(githubRead)]);
  const c = cText ? readState(cText) : null;
  const g = gText ? readState(gText) : null;
  if (c && (!g || (c.generatedMs != null && (g.generatedMs == null || c.generatedMs > g.generatedMs)))) return { text: cText, from: 'cloud' };
  return { text: g ? gText : '', from: g ? 'github' : 'none' };
}
