// P74 R3：通知頁的資料（純函式）。三種來源：工作卡住（work_status.json running[].stuck）、工作做完（done_today）、今天到期的提醒（lib/reminders.js dueToday）。
// 完全不看對話檔。看過紀錄存手機（agent.noticeSeen），只留 7 天內的。
import { TWDate as Date } from './tz.js';
import { isoOf } from './reminders.js';

export const SEEN_KEY = 'agent.noticeSeen';
export const SEEN_KEEP_DAYS = 7;
const MIN = 60000;
const DAY = 86400000;
const clip = (v, n) => [...String(v == null ? '' : v)].slice(0, n).join('');

// 存的文字 → {id: 看過的時間 ms}，超過 7 天的丟掉；壞掉回空
export function parseSeen(text, now) {
  let o;
  try { o = JSON.parse(text); } catch (e) { return {}; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
  const out = {};
  for (const [k, v] of Object.entries(o)) if (Number.isFinite(v) && now - v <= SEEN_KEEP_DAYS * DAY) out[k] = v;
  return out;
}
// 點開一則算看過：回傳新物件（原物件不動），順便丟掉過期的
export function markSeen(seen, id, now) {
  const out = {};
  for (const [k, v] of Object.entries(seen || {})) if (Number.isFinite(v) && now - v <= SEEN_KEEP_DAYS * DAY) out[k] = v;
  out[id] = now;
  return out;
}

const minText = (m) => (m >= 120 ? Math.floor(m / 60) + ' 小時' : m + ' 分鐘');
const KIND_RANK = { stuck: 0, stale: 1, remind: 2, done: 3 };
export const PC_STALE_MIN = 30; // 電腦超過 30 分鐘沒更新：卡住的判斷可能是舊的

// stale:pc 的 id 帶日期：同一天看過就不再亮，隔天（7 天內）第二次斷線會再亮紅點
// 回傳排序好的清單與未讀數。每筆 {id, kind:'stuck'|'done'|'remind', title, at, target, unread, sticky}
//   卡住：running[].stuck 有值（電腦自動登記的視窗 auto 不算）。sticky＝true：問題解決（不再卡住）才消失，看過也算未讀
//   id 穩定：卡住＝job id＋種類、完成＝job id、提醒＝提醒 key＋日期，重算不會多跳紅點
//   target：{type:'job', id, sec:'run'|'done'}｜{type:'todo'}｜{type:'remind', taskKey, key}
export function buildNotices({ ws, reminders, seen, now } = {}) {
  const items = [];
  const seenMap = seen && typeof seen === 'object' ? seen : {};
  if (ws) {
    // 電腦狀態檔太舊：卡住的資訊不可信，整批換成一則「電腦沒更新」（不算 sticky，看過就不再紅點）
    const fresh = [ws.heartbeatMs, ws.generatedMs].filter(Number.isFinite);
    const pcAge = fresh.length && Number.isFinite(now) ? Math.floor((now - Math.max(...fresh)) / MIN) : 0;
    const pcStale = pcAge > PC_STALE_MIN;
    const stuckOnes = (ws.running || []).filter((it) => it.stuck && !it.auto);
    if (pcStale && stuckOnes.length) items.push({ id: 'stale:pc:' + isoOf(new Date(now)), kind: 'stale', title: '電腦沒更新，狀態可能過時', at: Math.max(...fresh), target: { type: 'job', id: stuckOnes[0].id, sec: 'run' }, sticky: false });
    for (const it of pcStale ? [] : ws.running || []) {
      if (!it.stuck || it.auto) continue;
      const quiet = it.lastMs != null ? Math.max(0, Math.floor((now - it.lastMs) / MIN)) : null;
      let title;
      if (it.stuck === 'overdue') {
        const late = it.etaMs != null ? Math.max(0, Math.floor((now - it.etaMs) / MIN)) : null;
        title = it.name + (late != null ? ' 超過預計 ' + minText(late) : ' 超過預計時間');
      } else title = it.name + (quiet != null ? ' ' + minText(quiet) + '沒動靜' : ' 很久沒動靜');
      items.push({ id: 'stuck:' + it.id + ':' + it.stuck, kind: 'stuck', title, at: it.lastMs != null ? it.lastMs : ws.generatedMs, target: { type: 'job', id: it.id, sec: 'run' }, sticky: true });
    }
    const delivered = new Set((ws.orders || []).filter((o) => o.state === 'delivered').map((o) => o.id));
    for (const d of ws.done || []) {
      const toTodo = d.order && delivered.has(d.order);
      items.push({ id: 'done:' + d.id, kind: 'done', title: d.ok ? d.name : d.name + '（沒做完）', at: d.endedMs != null ? d.endedMs : ws.generatedMs, target: toTodo ? { type: 'todo' } : { type: 'job', id: d.id, sec: 'done' }, sticky: false });
    }
  }
  if (Number.isFinite(now)) {
    const day = isoOf(new Date(now));
    for (const r of reminders || []) {
      const late = Number.isFinite(r.overdue) && r.overdue > 0;
      items.push({ id: 'remind:' + r.key + ':' + day, kind: 'remind', title: (late ? '逾期 ' + r.overdue + ' 天：' : '今天到期：') + clip(r.title, 40), at: now, target: { type: 'remind', taskKey: r.taskKey || null, key: r.key }, sticky: false });
    }
  }
  for (const x of items) x.unread = x.sticky ? true : !seenMap[x.id];
  items.sort((a, b) => Number(b.unread) - Number(a.unread) || (a.unread ? KIND_RANK[a.kind] - KIND_RANK[b.kind] : 0) || b.at - a.at);
  return { items, unread: items.filter((x) => x.unread).length };
}
