// P74 o-7rpss6（11-10）：「我回電腦」開關。使用者回到電腦時按一下，待驗收、等我（決定卡、要判斷的候選、等你的工作）、
// 等電腦這三欄的卡片在手機上收起來，換成一行「N 件已移到電腦（我回電腦中）」；再按一次就恢復。
// 收起來不等於結案：只是畫面摺起來，不送任何通過／回答，交辦狀態不動。
// 狀態兩端都記：手機先存在本機（畫面馬上反應），送一筆 order_op（op=desk、yes＝開／關）給電腦；
// 電腦收到後寫進 work_status.json 的 desk 欄位（on、since、ops＝收過的 x- 編號），之後以電腦為準。
// 不 import hub.js（workstatus.js 會 import 這支，避免循環）；x- 編號由呼叫端用 hub.js xIdFor 算好傳進來

// 11-10 o-22h27r（m-zywx161a「交給電腦接手，這邊就會清空」）：改名「交給電腦」，意思從「我人在電腦前」改成「這些事由電腦接手」，
// 出門開遠端也不用關；收的範圍從三欄擴成首頁五欄全部，但只收「交給電腦那一刻以前就有的卡」（卡片 bornMs ≤ 開始時間），
// 之後你在手機新交辦的照常顯示。反向＝按「交回手機」，全部放回來。
export const DESK_KEY = 'agent.desk';
export const DESK_PENDING_MS = 24 * 3600000; // 本機按了超過這麼久電腦還沒收到，就不再蓋過電腦的狀態
export const DESK_COLUMNS = ['doing', 'waiting', 'review', 'done', 'todo']; // 首頁五欄全收（11-10 o-22h27r；原本只收等我、待驗收、等電腦）
export const DESK_TEXT = { on: '電腦接手中', off: '交給電腦' };

const X_RE = /^[xm]-[a-z0-9]{8}$/;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

// work_status.json 的 desk 欄位 → {on, sinceMs, by, ops, count}；沒有（舊電腦端）回 null
export function readDesk(j) {
  if (!isObj(j)) return null;
  const t = typeof j.since === 'string' ? Date.parse(j.since) : NaN;
  return {
    on: j.on === true,
    sinceMs: Number.isFinite(t) ? t : null,
    by: j.by === 'phone' || j.by === 'pc' ? j.by : '',
    ops: Array.isArray(j.ops) ? j.ops.filter((x) => typeof x === 'string' && X_RE.test(x)).slice(-20) : [],
    count: Number.isInteger(j.count) && j.count >= 0 ? j.count : 0,
    more: Number.isInteger(j.more) && j.more >= 0 ? j.more : 0, // 11-10 四類：看板上沒有的（專案等你＋題庫沒答＋工作類），舊電腦端沒有＝0
  };
}

// 本機記住的那一筆：{on, id（x- 編號）, at}；壞掉回 null
export function readLocalDesk(raw) {
  let j = raw;
  if (typeof raw === 'string') { try { j = JSON.parse(raw); } catch (e) { return null; } }
  if (!isObj(j) || typeof j.on !== 'boolean' || typeof j.id !== 'string' || !X_RE.test(j.id) || !Number.isFinite(j.at)) return null;
  return { on: j.on, id: j.id, at: j.at };
}

export function localDeskFor(on, xid, now) {
  return { on: !!on, id: xid, at: now };
}

// 現在畫面要用的狀態。本機按過、電腦還沒收到那一筆、電腦也沒有更新的切換 → 用本機的（pending）；其他一律以電腦為準
export function deskNow(server, local, now) {
  const srv = server ? !!server.on : false;
  if (local && now - local.at >= 0 && now - local.at < DESK_PENDING_MS) {
    const received = !!server && server.ops.includes(local.id);
    const newer = !!server && server.sinceMs != null && server.sinceMs > local.at;
    if (!received && !newer) return { on: local.on, pending: local.on !== srv || !server, source: 'local', sinceMs: local.at };
  }
  return { on: srv, pending: false, source: server ? 'pc' : 'none', sinceMs: server ? server.sinceMs : null };
}

// 本機那筆可以丟掉了嗎（電腦收到、或電腦後來又切過、或過期）
export function localDeskDone(server, local, now) {
  if (!local) return false;
  return deskNow(server, local, now).source !== 'local';
}

// 這張卡是「交給電腦以後」才出現的嗎（卡片 bornMs＝交辦建立／工作開始／提問出現的時間，lib/kanban.js 給）。
// 不知道開始時間、或卡片沒有時間 → 一律當舊卡收起來（寧可多收，交回手機就全部回來）
export const bornAfter = (card, sinceMs) => Number.isFinite(sinceMs) && !!card && Number.isFinite(card.bornMs) && card.bornMs > sinceMs;

// 看板（lib/kanban.js buildBoard 的結果）摺起來：五欄裡交給電腦以前就有的卡（含「很久沒回報」「N 天沒動」）全部拿掉，算件數；
// 交給電腦以後才出現的卡（你在手機新交辦的）照常留著。不改原物件。
// more＝電腦端 desk.more（專案等你、題庫沒答、工作類，看板上本來就沒有），只加進件數
export function deskFold(board, more = 0, sinceMs = null) {
  if (!board || !Array.isArray(board.columns)) return board;
  const keep = (x) => bornAfter(x, sinceMs);
  let moved = 0;
  const columns = board.columns.map((c) => {
    if (!DESK_COLUMNS.includes(c.key)) return c;
    const cards = c.cards.filter(keep);
    const old = c.old.filter(keep);
    const stale = Array.isArray(c.stale) ? c.stale.filter(keep) : c.stale;
    const n = c.cards.length - cards.length + c.old.length - old.length + (Array.isArray(c.stale) ? c.stale.length - stale.length : 0);
    moved += n;
    return { ...c, cards, old, stale, desk: n };
  });
  // 聊天頁的停住提問：只留還在看板上的卡掛的
  const keptAsks = new Set(columns.flatMap((c) => c.cards.flatMap((x) => (x.asks || []).map((a) => a && a.key))).filter(Boolean));
  const chatAsks = (board.chatAsks || []).filter((a) => a && keptAsks.has(a.key));
  const waitingLeft = (columns.find((c) => c.key === 'waiting') || { cards: [] }).cards.length;
  const m = Number.isInteger(more) && more > 0 ? more : 0;
  return { ...board, columns, chatAsks, initialColumn: waitingLeft ? 'waiting' : 'doing', desk: { moved: moved + m, board: moved, more: m } };
}

export function deskLine(moved, pending) {
  return (moved ? moved + ' 件交給電腦處理（不是結案），之後新交辦照常顯示' : '電腦接手中，之後新交辦照常顯示') + (pending ? '｜等電腦收到' : '');
}
