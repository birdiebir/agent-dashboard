// P66：線條圖示與「拿掉 emoji 圖示」的小工具。
// 圖示本體是 index.html 裡 <template id="icons"> 的 <svg data-i="名稱">，這裡只 cloneNode：
// 不用 innerHTML、不在程式裡寫 SVG 命名空間網址，CSP 與「沒有外部網址」的檢查都不受影響。
// 找不到 template（測試用的假 DOM、舊版 index.html）就回 null，畫面照樣能畫，只是少一個圖示。

export function icon(doc, name) {
  if (!doc || typeof doc.getElementById !== 'function') return null;
  const tpl = doc.getElementById('icons');
  const box = tpl && (tpl.content || tpl);
  if (!box || typeof box.querySelector !== 'function') return null;
  const src = box.querySelector('[data-i="' + name + '"]');
  return src ? src.cloneNode(true) : null;
}

// lib/home.js 等純函式產生的標籤文字開頭常帶一個 emoji（「⏰ 明天」「🙋 等你」「📝 日記」）。
// 文字本身照舊（測試與電腦端都靠它），只在畫面上拿掉開頭的 emoji，改用顏色表示語氣。
const LEAD = /^(?:[\p{Extended_Pictographic}☀-➿⬀-⯿⌀-⏿■-◿](?:️|‍[\p{Extended_Pictographic}])*\s*)+/u;
export function plain(text) {
  const s = String(text == null ? '' : text);
  const out = s.replace(LEAD, '');
  return out || s; // 整段都是 emoji（例如「🛠」）就原樣回傳，交給呼叫端決定
}

// 系統自己組的一行狀態（例如「🖥️ 電腦 13:41 同步過｜🏃 假甲工作」）：每一段開頭的 emoji 都拿掉。只用在系統文字，不用在使用者寫的內容
const ANY = /(^|[｜|\s])(?:[\p{Extended_Pictographic}☀-➿⌀-⏿](?:️|‍[\p{Extended_Pictographic}])*\s*)+/gu;
export function stripIcons(text) {
  const s = String(text == null ? '' : text);
  const out = s.replace(ANY, '$1').trim();
  return out || s;
}

// 提醒列的語氣：逾期／卡住＝bad、今天到明天或 N 天後＝warn、等你／今日必答＝accent、待驗收＝ok、其他＝muted
export function toneOf(row) {
  const chip = String((row && row.chip) || '');
  if (/逾期|卡住/.test(chip)) return 'bad';
  if (/今天|明天|天後|有期限|這期還沒做/.test(chip) && row.tier <= 2) return 'warn';
  if (row && (row.kind === 'waiting' || row.kind === 'today')) return 'accent';
  if (row && row.kind === 'review') return 'ok';
  return 'muted';
}

// 首頁焦點卡的主按鈕文字（依提醒列的目標類型）
const VERB = { q: '去回答', 'todo-today': '開始回答', task: '打開看看', journal: '寫日記', 'tasks-review': '去驗收', reminders: '看提醒' };
export const focusVerb = (row) => VERB[row && row.target && row.target.type] || '打開看看';

// 焦點卡上面那一行字：拿掉 emoji 的標籤；只有圖示沒有字的回空字串
export function focusLabel(row) {
  const p = plain(row && row.chip);
  return p && !/^\p{Extended_Pictographic}/u.test(p) ? p : '';
}
