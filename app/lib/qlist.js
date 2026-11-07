// 問題頁的分頁與分組（純函式，不碰 DOM、不碰儲存空間）。
// 分頁只有兩個：待答／已答。每個分頁底下只分「工作」「個人」兩組；組內排序沿用 sortCards（有日期的期限、⏰、今日必答、題庫原順序），擱置題放該組最後。
import { sortCards } from './questions.js';

export const WORK_GROUP = '工作';
export const PERSONAL_GROUP = '個人';

// 區段標題「工作（6 題，有空再答）」→「工作」
export const sectionCategory = (section) => String(section || '').replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim();

// 題目的分類：`分類：` 欄優先，沒有就用所在 `## ` 區的分類名
export function categoryOf(c) {
  if (c.category) return c.category;
  const s = sectionCategory(c.section);
  if (!s || s === 'Live.md 等你') return '其他';
  return s;
}

// 分類含「工作」或兩個公司名（公開檔不放公司字樣，用跳脫碼）算工作，其他全部算個人
export const isWorkCard = (c) => /工作|\u91d1\u79d1|\u9060\u9280/.test(categoryOf(c));

// 這張卡在哪個分頁。st＝cardState（open／failed／queued／sent／received／pc／ghost…）。
// 待答＝還沒答的（含送出失敗）；剛送出（queued／sent）的題在畫面上再多留在待答，直到切換分頁（kept 由畫面記）；其餘（已存手機、已送出、電腦已收到、題目檔已沒有）都在已答
export function qtabOf(st, { kept = false } = {}) {
  if (st === 'open' || st === 'failed') return 'open';
  if (kept && (st === 'queued' || st === 'sent')) return 'open';
  return 'done';
}

// 回傳 [{key:'工作'|'個人', label:'工作（3）', cards}]，沒有題目的組不出現；擱置題在組內最後
export function splitGroups(cards) {
  const sorted = sortCards(cards);
  const out = [];
  for (const [key, pick] of [[WORK_GROUP, true], [PERSONAL_GROUP, false]]) {
    const mine = sorted.filter((c) => isWorkCard(c) === pick);
    const list = [...mine.filter((c) => !c.backlog), ...mine.filter((c) => c.backlog)];
    if (list.length) out.push({ key, cards: list, label: key + '（' + list.length + '）' });
  }
  return out;
}
