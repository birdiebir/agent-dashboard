// P70：聊天頁 LINE 式日期分隔線（純函式）。
// 日期一律用 app 的台北時間 Date（lib/tz.js，跟 Live.md 的 MM-DD 同一個時區）；呼叫端傳進來的 Date／now 都要是 TWDate。
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();

// 今天「今天」、昨天「昨天」、今年其他天「11/04（三）」、跨年「2025/12/31（三）」。讀不出來回 ''
export function dayLabel(date, now) {
  if (!date || !Number.isFinite(date.getTime())) return '';
  const k = ymd(date);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (k === ymd(today)) return '今天';
  const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (k === ymd(yest)) return '昨天';
  const md = pad2(date.getMonth() + 1) + '/' + pad2(date.getDate()) + '（' + WD[date.getDay()] + '）';
  return date.getFullYear() === now.getFullYear() ? md : date.getFullYear() + '/' + md;
}

// dates：每則訊息（串）的日期（Date 或 null，null＝不知道是哪一天）。回傳同長度陣列：
// 該則上方要插的標籤，不用插（跟前一則同一天、或日期未知）是 ''。第一則有日期就一定有標籤。
export function separatorPlan(dates, now) {
  let prev = null;
  return (dates || []).map((d) => {
    if (!d || !Number.isFinite(d.getTime())) return '';
    const k = ymd(d);
    if (k === prev) return '';
    prev = k;
    return dayLabel(d, now);
  });
}
