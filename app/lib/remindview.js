import { reminderDate } from './reminders.js';

// P70 M3b（Q334＝A）：提醒一句話＋日期／地點／無期限，題目選項只顯示短標籤。
// 全部是純函式、只在呈現層用：lib/reminders.js 的排序與判斷規則（跟電腦看板共用）不動。

// 地點的字：不是空白、標點，也不是日期的開頭（11/20、11-20、11月、11月25日），遇到就停（QC 必修 2：「地點:郵局11/20繳費」不能把日期吃進地點）
const PLACE_CH = String.raw`(?!\d{1,2}(?:[\/\-]\d{1,2}|月))[^\s　，。、；：！？（）「」『』【】《》〈〉,.;:!?()[\]{}"'|｜]`;
const PLACE_RE = new RegExp(String.raw`地點[：:][ \t　]*((?:${PLACE_CH}){1,10})`);
const PLACE_CUT = new RegExp(PLACE_RE.source, 'g'); // 從標題整段拿掉（含「地點：」）
// 內文只認「整行就是 地點：X」（可帶清單符號），X 最多 6 字；避免「地點：家記得帶身分證」把後面整句吃進來
const BODY_PLACE_RE = /^[ \t]*(?:[-*][ \t]+)?地點[：:][ \t　]*([^\s　，。、；：！？,.;:!?]{1,6})[ \t　。]*$/m;
// 標題：「無期限」前面不是否定詞（「不是無期限」不算）；內文：行首就是「無期限」或「期限：無期限」（後面可接標點再說明）
const NO_DUE_TITLE = /(?<!不是|不算|並非|[不非沒])無期限/;
const NO_DUE_BODY = /^[ \t]*(?:[-*][ \t]+)?(?:期限[：:][ \t　]*)?無期限(?:[ \t　。，,；;：:].*)?$/m;

// 空括號（拿掉字樣後可能剩下的「（）」「【】」）與頭尾殘留的分隔符號
const IMPORTANT_CUT = /#重要/g;
const EMPTY_PAIRS =/（\s*）|\(\s*\)|【\s*】|\[\s*\]|「\s*」/g;
const EDGE_SEP = /^[\s｜|，,、；;：:·\-－—]+|[\s｜|，,、；;：:·\-－—]+$/g;

// 回傳 { text, place, noDue }
//  place：標題或內文的「地點：X」（半形或全形冒號）；X 最多 10 字，遇到空白或全形標點就停；沒有就是 ''
//  noDue：標題或內文出現「無期限」
//  text：標題拿掉「地點：X」「無期限」字樣、去掉多餘空白後的一句話（日期字樣不動）；拿光了就退回原標題
export function remindMeta(title, bodyMd) {
  const t = String(title == null ? '' : title);
  const b = String(bodyMd == null ? '' : bodyMd);
  const m = PLACE_RE.exec(t) || BODY_PLACE_RE.exec(b);
  const place = m ? m[1] : '';
  // P74：標題有日期就不算無期限（日期判斷跟提醒列表同一支 reminderDate；年份只影響日期值、不影響有沒有）
  const hasDate = !!reminderDate(t, '2000-01-01');
  const noDue = !hasDate && (NO_DUE_TITLE.test(t) || NO_DUE_BODY.test(b));
  const unTick = (x) => x.replace(/`([^`]*)`/g, '$1').replace(/^`+|`+$/g, ''); // P74：行內程式碼的反引號只留裡面的字
  let text = unTick(t).replace(PLACE_CUT, ' ').replace(IMPORTANT_CUT, ' '); // P74：「#重要」只是標記，畫面上改用「不能忘」區塊表示
  if ((noDue || hasDate) && NO_DUE_TITLE.test(text)) text = text.replace(new RegExp(NO_DUE_TITLE.source, 'g'), ' '); // 標題有日期又寫無期限（Task.md 自相矛盾）：日期為準，「無期限」字樣也拿掉，畫面不再同時出現
  text = text.replace(EMPTY_PAIRS, ' ');
  text = text.replace(/\s+/g, ' ').replace(EDGE_SEP, '').trim();
  return { text: text || unTick(t).replace(/\s+/g, ' ').trim(), place, noDue };
}

// 選項按鈕上的字：第一個「｜」之前；沒有「｜」整句顯示
export function optShort(label) {
  const s = String(label == null ? '' : label);
  const i = s.indexOf('｜');
  const short = (i < 0 ? s : s.slice(0, i)).trim();
  return short || s.replace(/^[\s｜]+/, '').trim(); // 「｜」開頭的標籤：按鈕不能只剩字母，退回整句（QC 建議）
}

// 選項說明：第一個「｜」之後的整段（多個「｜」都留著）；沒有就是 ''
export function optDesc(label) {
  const s = String(label == null ? '' : label);
  const i = s.indexOf('｜');
  return i < 0 ? '' : s.slice(i + 1).trim();
}

// 「背景」裡的選項說明清單：只列有說明的選項，一行 { key, desc }
export const optNotes = (options) => (options || []).map((o) => ({ key: o.key, desc: optDesc(o.label) })).filter((x) => x.desc);
