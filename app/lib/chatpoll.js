// P62：輪詢間隔的決定（純函式，不碰 timer）。設計 docs/P62_第一段設計.md §3.1-5、審查 C5。
// GitHub 主要限制是每小時 5,000 次（同一個帳號，電腦跟手機合計），所以 2 秒輪詢要有條件，剩餘次數少就退到 30 秒。
import { TWDate as Date } from './tz.js';
import { findThread } from './chatstatus.js';
export const SEND_MS = 1000; // 聊天分頁、遠端開著、送出後 60 秒內（P70 N2）
export const FAST_MS = 2000; // 聊天分頁、遠端開著、有未回覆的留言，或剛收到回覆（接兩段式第二段）
export const CHAT_MS = 5000; // 聊天分頁其他時候
export const SLOW_MS = 30000; // rate limit 剩餘次數 < RATE_FLOOR
export const IDLE_MS = 60000; // 其他分頁（照舊 60 秒）
export const BURST_MS = 1500;
export const BURST_WINDOW_MS = 30000;
export const RATE_FLOOR = 500;
export const SEND_WINDOW_MS = 60 * 1000; // 送出後 60 秒內一律快查
export const FOLLOW_WINDOW_MS = 3 * 60 * 1000; // 最近一次收到回覆後 3 分鐘內維持 2 秒（電腦端兩段式回覆的第二段）
export const PENDING_WINDOW_MS = 10 * 60 * 1000; // 沒回覆的留言只有 10 分鐘內才讓 2 秒輪詢繼續

// 回傳毫秒；null＝不查（App 不在前景）
// tab：目前分頁；visible：是否在前景；lastSendAt：最近一次送出聊天訊息的時間（ms，沒有給 0／null）
// pending：最近一則「已送出、還沒回覆」的留言時間（ms，沒有給 0／null）；remoteOn：遠端是否開著；rateRemaining：最近一次回應的 x-ratelimit-remaining（不知道給 null）
export function nextDelay({ tab, visible, burstUntil = 0, lastSendAt = 0, pending = 0, lastReplyAt = 0, remoteOn = false, rateRemaining = null, now = Date.now() } = {}) {
  if (!visible) return null;
  if (typeof rateRemaining === 'number' && rateRemaining < RATE_FLOOR) return SLOW_MS;
  if (burstUntil > now) return BURST_MS;
  if (tab !== 'chat') return IDLE_MS;
  const recentSend = !!lastSendAt && now - lastSendAt < SEND_WINDOW_MS;
  const recentPending = !!pending && now - pending < PENDING_WINDOW_MS;
  const recentReply = !!lastReplyAt && now - lastReplyAt < FOLLOW_WINDOW_MS;
  if (remoteOn === true) {
    if (recentSend) return SEND_MS;
    if (recentPending || recentReply) return FAST_MS;
  }
  return CHAT_MS;
}

// 從 deriveMine 的列（或同形狀的物件）找最近一則「已送出、電腦還沒回覆」的聊天留言時間；沒有回 0
export function latestPendingChatAt(rows) {
  let best = 0;
  for (const r of rows || []) {
    if (!r || r.kind !== 'chat' || !r.item || r.item.state !== 'sent' || r.phase === 'handled') continue;
    best = Math.max(best, r.item.sentAt || r.item.createdAt || 0);
  }
  return best;
}

// 最近一次收到回覆的時間（ms）：10 分鐘內送出的聊天留言，取狀態檔 replied_at 最大值；沒有或解析不了回 0
export function latestReplyAt(rows, status, now = Date.now()) {
  let best = 0;
  const msgs = status && status.msgs ? status.msgs : null;
  if (!msgs) return 0;
  for (const r of rows || []) {
    if (!r || r.kind !== 'chat' || !r.item || r.item.state !== 'sent') continue;
    const sent = r.item.sentAt || r.item.createdAt || 0;
    if (!sent || now - sent >= PENDING_WINDOW_MS) continue;
    const m = msgs[r.item.id];
    const t = m && m.replied_at ? Date.parse(m.replied_at) : NaN;
    if (Number.isFinite(t)) best = Math.max(best, t);
  }
  return best;
}

// 保底：10 分鐘內送出的聊天留言，對應串裡的回覆總數（兩段式回覆新增第二段時數字會變大）
export function replyCount(rows, threads, now = Date.now()) {
  let n = 0;
  for (const r of rows || []) {
    if (!r || r.kind !== 'chat' || !r.item || r.item.state !== 'sent') continue;
    const sent = r.item.sentAt || r.item.createdAt || 0;
    if (!sent || now - sent >= PENDING_WINDOW_MS) continue;
    const th = findThread(r.item, threads);
    if (th && th.replies) n += th.replies.length;
  }
  return n;
}
