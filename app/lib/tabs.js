// 頂端分頁列（任務頁、紀錄頁共用）：樣式與互動照問題頁頂端那排 chip，一次只顯示一個分頁的內容。
// 這裡只有純函式與一個吃 h() 的小元件，不碰 DOM 全域，測試用假 DOM 就能跑。

// ---------- 任務頁 ----------
export const TASK_TABS = [['doing', '我要動手'], ['agent', '交辦 Agent'], ['remind', '提醒']];
export const TASK_TAB_KEYS = TASK_TABS.map((t) => t[0]);

// 預設分頁：使用者還沒自己選過時，有未完成的動手題就停在「我要動手」，沒有就停在「交辦 Agent」
export const defaultTaskTab = (nDoingOpen) => (nDoingOpen > 0 ? 'doing' : 'agent');
// 目前該顯示哪個分頁：選過（而且是合法值）就用選的，沒選過走預設
export const resolveTaskTab = (pick, nDoingOpen) => (TASK_TAB_KEYS.includes(pick) ? pick : defaultTaskTab(nDoingOpen));
// 任務群組（lib/tasks.js GROUP_DEFS 的 key）放在哪個分頁：提醒與過期提醒一組，其餘都是交辦 Agent 的
export const taskTabOfGroup = (groupKey) => (groupKey === 'remind' || groupKey === 'overdue' ? 'remind' : 'agent');
// 從別處跳來開某個任務：它在哪個群組就切到那個分頁；找不到（還在排隊、剛寫的、或舊紀錄）一律「交辦 Agent」，剛寫的卡在那裡
export function taskTabForOpen(groups, key) {
  const g = groups.find((x) => x.items.some((t) => t.key === key));
  return g ? taskTabOfGroup(g.key) : 'agent';
}
// 在動手分頁做了操作（送出狀態、選項、備註）：使用者還沒自己選過分頁就先鎖在「我要動手」。
// 不鎖的話，最後一題按完「已完成」nDoing 變 0，預設規則會把畫面自動跳到「交辦 Agent」，使用者看不到「⏳ 已送出」。
export const lockDoingTab = (pick) => (TASK_TAB_KEYS.includes(pick) ? pick : 'doing');
// 這些群組算「Agent 手上的任務」，數字顯示在分頁上（最近完成、更早完成不算）
export const ACTIVE_GROUPS = ['waiting', 'review', 'doing', 'todo'];

// ---------- 紀錄頁 ----------
export const REC_TABS = [['journal', '日記'], ['note', '筆記'], ['fitness', '健身'], ['movie', '電影'], ['anime', '動漫']];
export const REC_TAB_KEYS = REC_TABS.map((t) => t[0]);
export const DEFAULT_REC_TAB = 'journal';
// state.rtab 的合法值才用；舊的 'home'（以前的五張卡首頁）或不認得的值一律回到日記
export const resolveRecTab = (rtab) => (REC_TAB_KEYS.includes(rtab) ? rtab : DEFAULT_REC_TAB);

// ---------- 分頁列 ----------
// 把目前選中的分頁捲到看得見的位置（窄螢幕放不下時分頁列可橫向滑動）。回傳新的 scrollLeft；放得下就不動。
export function revealOffset(rowLeft, rowWidth, scrollLeft, scrollWidth, itemLeft, itemWidth) {
  if (scrollWidth <= rowWidth + 1) return scrollLeft;
  const itemStart = itemLeft - rowLeft + scrollLeft; // 在可捲動內容裡的位置
  const want = itemStart - (rowWidth - itemWidth) / 2; // 盡量置中
  return Math.max(0, Math.min(scrollWidth - rowWidth, want));
}

// 分頁列已經捲到最右邊：右邊不會再有東西，「還能滑」的漸層就該拿掉（不然會蓋住最後一顆）
export const atScrollEnd = (scrollLeft, clientWidth, scrollWidth) => scrollLeft + clientWidth >= scrollWidth - 1;

// items：[[key, label], ...]；回傳 .chipwrap（跟問題頁同一個外框，右邊有漸層提示還能滑）
export function tabBar(h, { items, current, onPick, label }) {
  const row = h('div', { class: 'chips tabbar', role: 'group', 'aria-label': label });
  for (const [k, text] of items) {
    const on = current === k;
    row.append(h('button', { class: 'chip' + (on ? ' active' : ''), type: 'button', text, 'aria-pressed': on ? 'true' : 'false', 'data-tab': k, onclick: () => onPick(k) }));
  }
  const wrap = h('div', { class: 'chipwrap' }, row);
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      const fade = () => { if (wrap.classList && wrap.classList.toggle) wrap.classList.toggle('nofade', row.scrollWidth <= row.clientWidth + 1 || atScrollEnd(row.scrollLeft, row.clientWidth, row.scrollWidth)); }; // 放得下或已捲到底：不要右邊的「還能滑」漸層
      row.addEventListener('scroll', fade, { passive: true });
      fade();
      const a = row.querySelector && row.querySelector('.active');
      if (!a || !a.getBoundingClientRect) return;
      const r = row.getBoundingClientRect(); const b = a.getBoundingClientRect();
      row.scrollLeft = revealOffset(r.left, r.width, row.scrollLeft, row.scrollWidth, b.left, b.width);
      fade();
    });
  }
  return wrap;
}
