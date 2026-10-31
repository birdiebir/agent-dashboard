// 待我頁的分組與排序（純函式，不碰 DOM、不碰儲存空間）。
// 分組：「今日必答」放最前、「擱置」放最後，中間依分類；分類用題目的 `分類：` 欄，沒有就用所在 `## ` 區的分類名。
// 排序：重要優先（預設）／期限近→遠／題號新→舊／題號舊→新。Questions.md 沒有加入日期，所以「新舊」用題號代替。
import { deadlineDate, sortCards } from './questions.js';

export const SORTS = [
  ['important', '重要優先'],
  ['deadline', '期限近→遠'],
  ['new', '題號新→舊'],
  ['old', '題號舊→新'],
];
export const DEFAULT_SORT = 'important';
export const TODAY_GROUP = '今日必答';
export const BACKLOG_GROUP = '擱置';

// 題號 → [前綴排名, 數字]；Q 排在 KB 前，各自比數字
export function qidKey(qid) {
  const m = /^(Q|KB)(\d+)/.exec(String(qid || ''));
  return m ? [m[1] === 'Q' ? 0 : 1, Number(m[2])] : [2, 0];
}
function cmpQid(a, b, desc) {
  const ka = qidKey(a.qid), kb = qidKey(b.qid);
  if (ka[0] !== kb[0]) return ka[0] - kb[0]; // 前綴順序固定：Q 在前
  return desc ? kb[1] - ka[1] : ka[1] - kb[1];
}

// 區段標題「工作（6 題，有空再答）」→「工作」
export const sectionCategory = (section) => String(section || '').replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim();

export function categoryOf(c) {
  if (c.category) return c.category;
  const s = sectionCategory(c.section);
  if (!s || s === 'Live.md 等你') return '其他';
  return s;
}

export function groupKeyOf(c) {
  if (c.backlog) return BACKLOG_GROUP;
  if (c.today) return TODAY_GROUP;
  return categoryOf(c);
}

// impSet：重要題號集合（lib/home.js 的 importantQids）
export function sortList(cards, mode = DEFAULT_SORT, impSet = new Set()) {
  const list = [...cards];
  const byOrder = (a, b) => a.order - b.order;
  if (mode === 'new') return list.sort((a, b) => cmpQid(a, b, true) || byOrder(a, b));
  if (mode === 'old') return list.sort((a, b) => cmpQid(a, b, false) || byOrder(a, b));
  if (mode === 'deadline') {
    return list.sort((a, b) => {
      const da = deadlineDate(a.deadline), db = deadlineDate(b.deadline);
      if (da && db) return da < db ? -1 : da > db ? 1 : byOrder(a, b);
      if (da) return -1;
      if (db) return 1;
      return byOrder(a, b);
    });
  }
  const sorted = sortCards(list); // 預設：有日期的期限、⏰、今日必答、題庫原順序
  return [...sorted.filter((c) => impSet.has(c.qid)), ...sorted.filter((c) => !impSet.has(c.qid))];
}

// 回傳 [{key, label, cards, kind:'today'|'cat'|'backlog'}]；label 例「工作（6）」
export function groupCards(cards, mode = DEFAULT_SORT, impSet = new Set()) {
  const sorted = sortList(cards, mode, impSet);
  const map = new Map();
  for (const c of sorted) {
    const k = groupKeyOf(c);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(c);
  }
  const groups = [...map].map(([key, list]) => ({
    key, cards: list, label: key + '（' + list.length + '）',
    kind: key === TODAY_GROUP ? 'today' : key === BACKLOG_GROUP ? 'backlog' : 'cat',
  }));
  const rank = (g) => (g.kind === 'today' ? 0 : g.kind === 'backlog' ? 2 : 1);
  return groups.map((g, i) => ({ g, i })).sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i).map((x) => x.g);
}

// 收合狀態：stored＝{c:[使用者收合的組], e:[使用者展開的組]}（沒存過是 null）。只存跟預設不同的選擇，所以換篩選時預設仍然生效。
// 預設：擱置收合；今日必答只有在「全部」瀏覽時收合（重要／待答要直接看到）。
export function defaultCollapsed(group, filter) {
  return group.kind === 'backlog' || (group.kind === 'today' && filter === 'all');
}
export function isCollapsed(group, stored, filter, forceOpen = false) {
  if (forceOpen) return false;
  const s = stored || {};
  if ((s.c || []).includes(group.key)) return true;
  if ((s.e || []).includes(group.key)) return false;
  return defaultCollapsed(group, filter);
}
// 使用者點了一組：nowCollapsed＝畫面目前的狀態（含強制展開）。回傳新的 stored，點完就是相反狀態。
// 有給 group／filter 時：點完的狀態如果剛好等於這個篩選的預設，就把這組從 c、e 都拿掉，不存成明確選擇
// （例如「全部」點開今日必答又收回，不能變成「明確收合」而把「重要」頁的今日必答也收起來）
export function toggledCollapsed(stored, key, nowCollapsed, group = null, filter = null) {
  const c = new Set((stored && stored.c) || []);
  const e = new Set((stored && stored.e) || []);
  c.delete(key); e.delete(key);
  const next = !nowCollapsed;
  if (!(group && next === defaultCollapsed(group, filter))) (next ? c : e).add(key);
  return { c: [...c], e: [...e] };
}
