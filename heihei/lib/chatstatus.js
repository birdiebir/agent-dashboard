// P62：聊天訊息的狀態（純函式）。資料來源有兩個：
//   · 電腦端寫在 signal 分支的 signal/chat_status.json（契約 version 1，見 docs/P62_第一段設計.md §3.4）：只有編號、狀態、時間，沒有留言內容
//   · Live.md 對話串裡有沒有嘿嘿的回覆（保底：狀態檔晚到或沒寫時，看得到回覆就算已回覆）
// 狀態只能往前走：delivered → processing → replied。兩個來源取較前面的，舊狀態不會蓋掉新狀態。
import { TWDate as Date } from './tz.js';
import { stamp, cleanText } from './edit.js';

export const STATE_ORDER = ['delivered', 'processing', 'replied'];
export const STALLED_MS = 3 * 60 * 1000; // 已送達超過 3 分鐘還沒處理＝電腦收到了、嘿嘿還沒醒

export const PHASE_LABELS = {
  sending: '送出中…',
  sent: '已送出，等電腦',
  offline_pc: '電腦沒開遠端',
  delivered: '已送達電腦',
  processing: '嘿嘿處理中',
  replied: '已回覆',
  stalled: '電腦收到了，嘿嘿還沒醒，可能在忙別的',
  pc_stalled: '電腦收留言的程式停了，留言先存著',
};

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const str = (x) => (typeof x === 'string' ? x : '');

// 壞 JSON、格式不對 → null。只留認得的欄位（不信任多出來的東西）
export function readChatStatus(text) {
  let j;
  try { j = JSON.parse(String(text == null ? '' : text)); } catch (e) { return null; }
  if (!isObj(j) || j.version !== 1) return null;
  if (j.msgs != null && !isObj(j.msgs)) return null;
  const msgs = {};
  for (const [id, v] of Object.entries(j.msgs || {})) {
    if (!/^m-[A-Za-z0-9]{4,32}$/.test(id) || !isObj(v) || !STATE_ORDER.includes(v.state)) continue;
    msgs[id] = { state: v.state, delivered_at: str(v.delivered_at), processing_at: str(v.processing_at), replied_at: str(v.replied_at) };
  }
  const r = isObj(j.remote) ? j.remote : null;
  const o = isObj(j.opener) ? j.opener : null;
  const ia = isObj(j.intake_alert) ? j.intake_alert : null; // P70-M4：電腦排程收件停手時寫的
  return {
    version: 1,
    updated_at: str(j.updated_at),
    remote: r ? { on: r.on === true, until: str(r.until), since: str(r.since), stalled_since: str(r.stalled_since) } : null,
    msgs,
    intake_alert: ia ? { since: str(ia.since), reason: str(ia.reason), fails: Number.isFinite(ia.fails) ? ia.fails : 0, kind: ia.kind === 'skip' ? 'skip' : 'fail' } : null,
    opener: o ? { req_id: str(o.req_id), result: str(o.result), at: str(o.at), reason: str(o.reason) } : null,
  };
}

const oneLine = (s) => cleanText(s).replace(/\s*\n+\s*/g, ' ').trim();

// 這筆 chat outbox 項目在對話串裡對應哪一串：先比手機編號，找不到再用內容＋時間（舊版 App 寫的行沒有編號）
export function findThread(item, threads) {
  const list = threads || [];
  const byId = list.find((x) => !x.orphan && x.id && x.id === item.id);
  if (byId) return byId;
  const want = oneLine((item.payload || {}).content);
  const when = stamp(new Date(item.createdAt));
  return list.find((x) => !x.orphan && !x.id && x.text === want && x.time === when) || list.find((x) => !x.orphan && !x.id && x.text === want && !x.time) || null;
}

const rank = (s) => STATE_ORDER.indexOf(s);

// 回傳 {phase, label}。phase：sending | sent | offline_pc | delivered | processing | replied | stalled
// item：outbox 的 chat 項目；status：readChatStatus 的結果或 null；remoteOn：true／false／null（不知道）
export function msgPhase(item, status, threads, remoteOn, now = Date.now()) {
  const R = (phase) => ({ phase, label: PHASE_LABELS[phase] });
  if (item.state === 'queued' || item.state === 'sending' || item.state === 'failed') return R('sending');
  const th = findThread(item, threads);
  const st = status && status.msgs ? status.msgs[item.id] : null;
  // 取兩個來源中最前面的：串裡有回覆＝replied
  let best = st ? st.state : null;
  if (th && th.replies && th.replies.length && (best == null || rank('replied') > rank(best))) best = 'replied';
  if (best === 'replied') return R('replied');
  if (best === 'processing') return R('processing');
  if (best === 'delivered') {
    const at = st && st.delivered_at ? Date.parse(st.delivered_at) : NaN;
    return Number.isFinite(at) && now - at > STALLED_MS ? R('stalled') : R('delivered');
  }
  const on = remoteOn != null ? remoteOn : (status && status.remote ? status.remote.on : null);
  if (on === false) return R('offline_pc');
  return listenerStalled(status) ? R('pc_stalled') : R('sent');
}

// 電腦端看門狗發現監聽停了：遠端開著且 stalled_since 非空
export function listenerStalled(status) {
  const r = status && status.remote;
  return !!(r && r.on === true && typeof r.stalled_since === 'string' && r.stalled_since);
}

// P70-M4：電腦排程收件（每 10 分鐘收手機答案）連續失敗停手了 → 提示文字；沒事回空字串
export function intakeAlertText(status) {
  const a = status && status.intake_alert;
  if (!a) return '';
  if (a.kind === 'skip') return '⚠️ 電腦排程收件一直被跳過（' + oneLine(a.reason).slice(0, 60) + '）：回電腦看 intake_sched.json';
  return '⚠️ 電腦排程收件停了（連續失敗 ' + a.fails + ' 次）：回電腦看 intake_sched.json';
}
