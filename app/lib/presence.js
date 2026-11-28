// P74：處理者三態與留言小字；只改顯示，不改遠端開關與路由。
import { cloudLaptopOnline } from './cloudchat.js';
import { workerEligible } from './cloudsource.js';
import { needsFor } from './needs.js';
import { TWDate as Date } from './tz.js';

// P74 M5：一句「誰在回＋能做什麼」（雲端是現況 brain 的說明；主機自報 agent 時改用 presenceLine）
export const PRESENCE_TEXT = {
  remote: '電腦在回：幾乎都能做（永久刪除、付款、改規則要你在電腦前）',
  cloud: '雲端主機值班：能回答、雲端硬碟一般檔直接改，程式與規則類放待套用；上網、跑程式、工作留言等電腦；寄信、訂位、付款、登入網站要電腦做，雲端會交給電腦',
  offline: '只能留言：電腦和雲端都不在，留言排隊，回來就做',
};
export const MESSAGE_TEXT = {
  sending: '⏳ 送出中', offline: '📵 沒網路，連上後自動送',
  processing: '💬 嘿嘿處理中', work: '🖥️ 已交給電腦', waiting: '🖥️ 等電腦：回來就做',
  // P62 提案1：雲端主機判斷要電腦做、已交給電腦（雲端快照 queue.items[].w_declined）
  handed: '🖥️ 已交給電腦，電腦回來處理',
};
const warning = (code, text, hint) => ({ code, text: text.replace(/^(?:(?:⚠️?|📵)\s*)+/u, ''), hint });

export function presence({ snapshot = null, remote = null, workerPack = null, online = true, sync = {}, cloudReachable = true, now = Date.now() } = {}) {
  const on = remote?.on === true;
  const stalled = on && !!remote.stalled_since;
  const expires = workerPack?.expiresAt ?? Date.parse(workerPack?.expires_at || '');
  const valid = !!workerPack && Number.isFinite(expires) && expires > now;
  const state = cloudLaptopOnline(snapshot) === true || (on && !stalled) ? 'remote'
    : snapshot?.host?.cloud_worker?.online === true && valid ? 'cloud' : 'offline';
  let warn = null;
  if (!online) warn = warning('phone_offline', '手機沒網路。', '連上後會自動送出，也可以按重新整理。');
  else if (cloudReachable === false || sync.cloudFallback) warn = warning('cloud_unavailable', '雲端連不上，暫時改從 GitHub 同步。', '先留言即可；恢復連線後會自動重試，也可以按重新整理。');
  else if (stalled) warn = warning('listener_stalled', '電腦收留言的程式停了，留言先存著。', '按「📡 叫電腦開遠端」重開監聽，或回電腦查看。');
  else if (workerPack && !valid) warn = warning('worker_key_expired', '雲端值班金鑰已過期，這支手機暫時不能交辦給雲端。', '回電腦重新產生雲端值班金鑰 QR，再用這支手機掃一次。');
  else if (on && sync.pcQuiet) warn = warning('pc_quiet', '電腦好一陣子沒推送了，可能沒在跑。', '按重新整理；仍沒更新時，回電腦查看遠端程式。');
  else if (sync.intakeWarn) warn = warning('intake_alert', sync.intakeWarn.replace(/[：:]回電腦.*$/, ''), '回電腦查看排程收件狀態，再重新啟動收件。');
  else if (sync.error || sync.key === 'offline') warn = warning('sync_failed', '手機同步失敗，顯示的是上次讀到的狀態。', '確認連線後按重新整理，留言會保留在手機。');
  const host = snapshot?.host?.cloud_worker;
  const lastSeen = typeof snapshot?.host?.last_seen === 'string' ? Date.parse(snapshot.host.last_seen) : NaN;
  let detail = '';
  // P62 QC B3：雲端 API 額度用完時值班程式會自己放掉租約，不能說成「主機沒回應」（值班程式預設留 US$4 安全邊際＝預算 96%）
  const usage = snapshot?.host_usage;
  const creditOut = !!usage && usage.budget_usd > 0 && usage.spent_usd >= usage.budget_usd * 0.96;
  if (state === 'cloud' && hostCaps(snapshot).includes('capped')) detail = '雲端今天的花費上限到了，留言會等電腦';
  else if (state === 'offline' && host?.online === false && creditOut) detail = '雲端 API 額度用完了，留言等電腦';
  else if (state === 'offline' && host?.online === false && Number.isFinite(lastSeen) && lastSeen <= now && now - lastSeen <= 24 * 3600000) {
    const at = new Date(lastSeen);
    const hhmm = String(at.getHours()).padStart(2, '0') + ':' + String(at.getMinutes()).padStart(2, '0');
    detail = '雲端主機沒回應（最後在線 ' + hhmm + '），留言等電腦';
  }
  const label = detail.startsWith('雲端主機沒回應') ? '雲端主機沒回應' : detail.startsWith('雲端 API 額度用完') ? '雲端額度用完'
    : { remote: '遠端', cloud: '雲端', offline: '離線' }[state];
  return { state, label, warn, ...(detail ? { detail } : {}) };
}

// ---------- P74 M5 模式說清楚：現在誰在回、能做什麼 ----------
// 主機在租約自報（雲端大門 /v1/state 的 host.cloud_worker.mode／caps）：brain＝現在的單則大腦（預設）；agent＝A+ 完整 Claude Code。
// 「雲端完整能力上線後生效」的說明只在 agent 才顯示，主機沒換版之前一律顯示現況。
export const hostMode = (snapshot) => (snapshot?.host?.cloud_worker?.mode === 'agent' ? 'agent' : 'brain');
// caps：ctx＝讀得懂對話脈絡；web＝P74 第三輪，值班程式開了看網頁（主機 worker.json 的 browse.enabled，租約自報）。
// 網頁能力的說法只看 web：主機沒開就不說能看網頁（說法跟開關一致）。
export const HOST_CAP_NAMES = ['ctx', 'web', 'capped'];
export const hostCaps = (snapshot) => {
  const c = snapshot?.host?.cloud_worker?.caps;
  return Array.isArray(c) ? c.filter((x) => HOST_CAP_NAMES.includes(x)) : [];
};
export const WEB_CAN = '給網址可代看公開網頁（不登入，旅遊電商大站多半被擋）';
export const WHO_TEXT = { remote: '電腦在回', cloud: '雲端主機值班', offline: '只能留言' };
export const CAN_TEXT = {
  remote: '幾乎都能做（永久刪除、付款、改規則要你在電腦前）',
  brain: '能回答、雲端硬碟一般檔直接改，程式與規則類放待套用；上網、跑程式、工作留言等電腦；寄信、訂位、付款、登入網站要電腦做，雲端會交給電腦',
  agent: '接著前面聊、跑指令、改程式（電腦回來合併）、可直接改雲端硬碟一般檔；還不能上網查；寄信、訂位、付款、登入網站要電腦做，雲端會交給電腦',
  offline: '電腦和雲端都不在，留言排隊，回來就做',
};
// 主機報了 web 時的雲端說法
export const CAN_TEXT_WEB = {
  brain: '能回答、雲端硬碟一般檔直接改，程式與規則類放待套用、給網址代看公開網頁；跑程式、工作留言等電腦；寄信、訂位、付款、登入網站要電腦做，雲端會交給電腦',
  agent: '接著前面聊、跑指令、改程式（電腦回來合併）、可直接改雲端硬碟一般檔；給網址可代看公開網頁；寄信、訂位、付款、登入網站要電腦做，雲端會交給電腦',
};
export const canText = (state, mode = 'brain', caps = []) => {
  if (state !== 'cloud') return CAN_TEXT[state] || CAN_TEXT.offline;
  if (Array.isArray(caps) && caps.includes('capped')) return '雲端今天的花費上限到了，留言會等電腦';
  const m = mode === 'agent' ? 'agent' : 'brain';
  return (Array.isArray(caps) && caps.includes('web') ? CAN_TEXT_WEB : CAN_TEXT)[m];
};
export const presenceLine = (state, mode = 'brain', caps = []) => (WHO_TEXT[state] || WHO_TEXT.offline) + '：' + canText(state, mode, caps);
// 「看全部」的完整對照：[{key, title, items}]
export function capabilityRows(mode = 'brain', caps = []) {
  const agent = mode === 'agent';
  const web = Array.isArray(caps) && caps.includes('web');
  const cloudCan = agent
    ? ['接著前面的對話聊，講過的都記得', '跑指令與測試、改程式（改動走分支，電腦回來審過再合併）', '可直接改雲端硬碟一般檔，程式與規則類放待套用', ...(web ? [WEB_CAN] : []), '讀 Agent 資料與知識庫（寫回一樣走分支）']
    : [web ? '回答問題' : '回答問題（現在還不能上網查）', ...(web ? [WEB_CAN] : []), '讀、搜尋雲端硬碟的個人檔；雲端硬碟一般檔直接改，程式與規則類放待套用',
      caps.includes('ctx') ? '看得到同一串最近幾則，接得上前面的話' : '每則單獨回答，看不到前面講過的'];
  const cloudCant = [
    ...(agent ? [] : ['跑程式、改程式：等電腦']),
    ...(web ? [] : ['上網查資料、看網頁：等電腦']),
    'Windows 專屬：PowerShell、排程、登入過的瀏覽器、LINE、Excel 巨集、照片、硬碟備份',
    '寄信、訂位、付款、登入網站要電腦做，雲端會交給電腦',
    '永久刪除、部署：等電腦',
    '按 🖥️ 交給電腦的留言（含公司工作留言）：只給電腦，不送雲端',
  ];
  return [
    { key: 'pc', title: '🖥️ 電腦（遠端）能做', items: ['幾乎都能做：跑程式、改檔、Windows 工具、登入過的瀏覽器、LINE、Excel', '永久刪除、付款、改規則要你在電腦前', '按 🖥️ 交給電腦的留言（含工作）只給電腦'] },
    { key: 'cloud', title: '☁️ 雲端能做', items: cloudCan },
    { key: 'cant', title: '⛔ 雲端做不到', items: cloudCant },
    ...(agent ? [] : [{ key: 'soon', title: '⏳ 雲端完整能力上線後', items: ['接著聊、跑指令、改程式；上線後這裡會自動換成新說明'] }]),
  ];
}

export function workerOnlineText(snapshot) {
  const on = snapshot?.host?.cloud_worker?.online;
  return '現在：' + (on === true ? '在' : on === false ? '不在' : '不確定');
}

// 信封旗標只由實際送件結果保存，不能用現在有金鑰反推。
export function messageStatus(item, { current = { state: 'offline' }, snapshot = null, thread = null, phase = '', online = true } = {}) {
  if (thread?.replies?.length || phase === 'replied' || item?.result?.reason === 'cloud_answered') return '';
  if (item?.state === 'failed') return '⚠️ 沒送出' + (item.err ? '：' + item.err : '');
  if (thread?.cloudQuickStatus === 'error') return '⚠️ 回覆中斷，請重試或交給嘿嘿';
  if (item && item.state !== 'sent') return online ? MESSAGE_TEXT.sending : MESSAGE_TEXT.offline;
  const queued = snapshot?.queue?.items?.find((q) => q.id === (item?.id || thread?.id));
  const payload = item?.payload || {};
  const hub = typeof payload.hub === 'object' ? payload.hub : {};
  const work = thread?.work === true || hub.work === true;
  const needs = work ? 'local_login' : queued?.needs || payload.needs || needsFor(payload.content || thread?.text);
  if (!workerEligible(needs, { ...hub, work })) return MESSAGE_TEXT.work;
  if (['stalled', 'pc_stalled'].includes(phase)) return '⚠️ ' + (phase === 'stalled' ? '電腦收到了，嘿嘿還沒醒，可能在忙別的' : '電腦收留言的程式停了，留言先存著');
  // P62 提案1：主機交給電腦（雲端快照 w_declined）→「已交給電腦」，不再一直「處理中」；舊的轉交紀錄照舊「等電腦」
  if (queued?.w_declined || item?.result?.w_declined || thread?.w_declined) return MESSAGE_TEXT.handed;
  const deferred = thread?.cloudQuickStatus === 'queued' || item?.result?.reason === 'cloud_deferred';
  if (deferred || current.state === 'offline') return MESSAGE_TEXT.waiting;
  if (current.state === 'remote') return MESSAGE_TEXT.processing;
  if (current.state === 'cloud' && item?.result?.via === 'cloud' && item.result.workerEnvelope === true) {
    if (hostCaps(snapshot).includes('capped')) return MESSAGE_TEXT.waiting;
    return MESSAGE_TEXT.processing;
  }
  return MESSAGE_TEXT.waiting;
}
