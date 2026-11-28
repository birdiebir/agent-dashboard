// 台北時間（Asia/Taipei，UTC+8，沒有日光節約）集中在這一個模組。2026-11-04（時間盤點 A）。
// 為什麼：Live.md、commit 轉出來的 MM-DD HH:MM 全是台北時間，電腦端也是。手機在別的時區（例如旅行）時，
// 用手機本地時間解析會整批差幾小時。做法：TWDate 是 Date 的子類別，「用年月日時分建立」和「取年月日時分」一律當台北時間，
// 其他地方在檔案開頭 `import { TWDate as Date } from './tz.js'` 取代全域 Date，其餘程式不用改。
//   new Date()            → 校正後的現在（手機時鐘偏差超過 2 分鐘才校正，見 setServerDate）
//   new Date(ms | ISO)    → 同一個瞬間，getHours() 等回傳台北時間
//   new Date(y, m, d, …)  → 台北時間的那一刻
// Date.now() 維持手機真實時鐘（寫入時間戳、逾時計算用）；要「校正後的現在」用 nowMs()。
const D = Date;
export const TW_OFFSET_MS = 8 * 3600 * 1000;
export const SKEW_THRESHOLD_MS = 2 * 60 * 1000;

let skew = 0;
// 用 GitHub API 回應的 Date 標頭估手機時鐘偏差（伺服器時間 − 手機時間）。偏差沒超過門檻就當 0。回傳目前採用的偏差
export function setServerDate(dateHeader, localMs = D.now()) {
  const t = D.parse(String(dateHeader || ''));
  if (!Number.isFinite(t)) return skew;
  const s = t - localMs;
  skew = Math.abs(s) > SKEW_THRESHOLD_MS ? s : 0;
  return skew;
}
export const clockSkewMs = () => skew;
export const resetSkew = () => { skew = 0; };
// 校正後的現在（毫秒）：「多久之前」「是否卡住」「是否過期」這類判斷用
export const nowMs = () => D.now() + skew;

const shifted = (d) => new D(D.prototype.getTime.call(d) + TW_OFFSET_MS); // 它的 getUTC* 就是台北時間

export class TWDate extends D {
  constructor(...a) {
    if (a.length === 0) super(nowMs());
    else if (a.length === 1) super(a[0]);
    else {
      const [y, mo, d = 1, h = 0, mi = 0, s = 0, ms = 0] = a;
      super(D.UTC(y, mo, d, h, mi, s, ms) - TW_OFFSET_MS);
    }
  }
  getFullYear() { return shifted(this).getUTCFullYear(); }
  getMonth() { return shifted(this).getUTCMonth(); }
  getDate() { return shifted(this).getUTCDate(); }
  getDay() { return shifted(this).getUTCDay(); }
  getHours() { return shifted(this).getUTCHours(); }
  getMinutes() { return shifted(this).getUTCMinutes(); }
  getSeconds() { return shifted(this).getUTCSeconds(); }
  getTimezoneOffset() { return -480; }
  setDate(n) {
    const s = shifted(this);
    return this.setTime(D.UTC(s.getUTCFullYear(), s.getUTCMonth(), n, s.getUTCHours(), s.getUTCMinutes(), s.getUTCSeconds(), s.getUTCMilliseconds()) - TW_OFFSET_MS);
  }
}
