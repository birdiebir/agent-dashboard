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
// 11-26（o-hscpqs，使用者 m-i5tulz6t）：退回 GitHub 不能默默發生。原因只用固定代碼（不放 relay 錯誤訊息），
// App 畫面上方顯示「目前讀備援」，並寫進手機診斷（signal/phone_diag.json 的 source），電腦查得到為什麼退回。
export const FALLBACK_REASONS = {
  cloud_missing: '雲端還沒有這份資料',
  cloud_bad: '雲端資料格式不對',
  cloud_bad_json: '雲端資料壞掉',
  cloud_stale: '雲端資料超過 20 分鐘沒更新',
  cloud_network: '連不到雲端',
  cloud_auth: '雲端金鑰過期或沒配對好',
  no_cloud: '這支手機還沒配對雲端',
  cloud_off: '電腦端關掉了雲端',
  cloud_unavailable: '雲端讀不到',
};
// 11-27：沒有雲端來源時，依雲端設定狀態（lib/cloudcfg.js status()）給原因；還沒同步完回 null＝先不報（冷啟動不閃錯的說明）
export function noCloudReason(status) {
  if (status === 'unsynced') return null;
  if (status === 'off') return 'cloud_off';
  if (status === 'none') return 'no_cloud';
  return 'cloud_unavailable';
}
// 11-27 第二批複查必修 4：這個原因算不算「雲端壞了」（設 cloud.unavailable、送 fallback 診斷）。沒配對、電腦端刻意關掉都不算。
export function cloudBroken(reason) {
  return reason !== 'no_cloud' && reason !== 'cloud_off';
}
const CLOUD_DATA = ['work_status', 'hub_view'];
export function fallbackReason(e) {
  const m = e && typeof e.message === 'string' ? e.message : '';
  if (Object.prototype.hasOwnProperty.call(FALLBACK_REASONS, m)) return m;
  if (e instanceof SyntaxError) return 'cloud_bad_json';
  const code = String((e && e.code) || '');
  if (/auth|key|token|pair|unauthor|forbid/i.test(code) || e?.status === 401 || e?.status === 403) return 'cloud_auth';
  if (e instanceof TypeError || e?.name === 'AbortError' || e?.name === 'TimeoutError' || /network|timeout|abort|offline|fetch/i.test(code)) return 'cloud_network';
  return 'cloud_unavailable';
}
// 這麼久沒再讀的那份不算（例如對話改走別的來源、之後沒再讀 hub_view），避免雲端恢復後提示一直留著
export const VIA_FRESH_MS = 5 * 60 * 1000;
// via：{ 名稱: { src: 'cloud'|'github', reason, at } }。看板或對話（work_status／hub_view）最近 5 分鐘內有一份是讀 GitHub 就回提示文字，否則 ''。
export function fallbackBannerText(via, now = Date.now()) {
  const hit = CLOUD_DATA.map((n) => via && via[n]).filter((v) => v && v.src === 'github' && Number.isFinite(v.at) && now - v.at <= VIA_FRESH_MS);
  if (!hit.length) return '';
  const last = hit.reduce((a, b) => ((b.at || 0) > (a.at || 0) ? b : a));
  return '目前讀備援（GitHub）：' + (FALLBACK_REASONS[last.reason] || FALLBACK_REASONS.cloud_unavailable) + '，內容可能比較舊';
}

export function cloudFirstSource(cloud, github, { onFallback, onRead, laptopOnline, now = Date.now, reportNoCloud = false } = {}) {
  const names = { work_status: 'work_status', hub_view: 'chat_view', mobile_state: 'mobile_state' };
  const report = (name, reason) => { try { onFallback?.(name, reason); } catch { /* 診斷不能擋退回 */ } };
  if (!cloud) {
    if (!reportNoCloud) return github;
    // reportNoCloud：true＝一律報 no_cloud（舊行為）；函式＝讀當下原因，回 null 不報（11-27）
    const why = () => (typeof reportNoCloud === 'function' ? reportNoCloud() : 'no_cloud');
    return { kind: github.kind, read: (name) => { const r = names[name] ? why() : null; if (r) report(name, r); return github.read(name); } };
  }
  const lastReason = {};
  const mapped = {
    kind: 'cloud',
    async read(name) {
      try {
        const r = await cloud.read(names[name]);
        if (!r || r.missing || !r.text) throw new Error('cloud_missing');
        // JSON 壞掉也要能退 GitHub。
        const j = JSON.parse(r.text);
        const okShape = name === 'hub_view' ? parseView(r.text).ok : name === 'mobile_state' ? !!readState(r.text) : !!readWorkStatus(r.text);
        if (!j || typeof j !== 'object' || !okShape) throw new Error('cloud_bad');
        if (laptopOnline?.() === true && now() - Date.parse(r.updatedAt) > CLOUD_STALE_MS) throw new Error('cloud_stale');
        onRead?.(name, r.updatedAt);
        return r;
      } catch (e) {
        lastReason[name] = fallbackReason(e);
        throw e;
      }
    },
  };
  const fallback = withFallback([mapped, {
    kind: 'github',
    read(name) { report(name, lastReason[name] || 'cloud_unavailable'); return github.read(name); },
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
