// 錯誤 → 白話訊息（app.js 的提示與 outbox 的失敗原因共用）
import { GitHubError } from './github.js';

export function errMsg(e) {
  if (e instanceof GitHubError) {
    // 錯誤訊息直接講要改哪一格（10-26 使用者真機設定失敗、看不出要改什麼）
    if (e.status === 401) return 'token 不對或已過期（401）：重新複製 github_pat_ 開頭的整串貼到 token 那格';
    if (e.status === 403) return 'token 沒有讀寫權限或超過流量限制（403）：建 token 時 Permissions 的 Contents 要選 Read and write';
    if (e.status === 404) return '找不到（404）：① Repo 要填「帳號/repo 名稱」② 路徑前綴留空 ③ 建 token 時 Repository access 要勾這個 repo';
    if (e.status === 0) return '無法讀取內容（檔案可能超過 1 MB）：' + e.message;
    if (e.status === 409 || e.status === 422) return '檔案剛被別人改過，重試 3 次仍失敗，請稍後再按一次';
    // P74（11-07 介面健檢）：5xx 是 GitHub 那邊暫時出問題，不是使用者設定錯；講清楚會自己再試
    if (e.status >= 500) return 'GitHub 暫時出問題（' + e.status + '），不是你的設定錯；App 會自動再試，也可以等一下按右上角重新整理';
    return 'GitHub 回應錯誤：' + e.message;
  }
  if (e instanceof TypeError) return '連不上網路；恢復連線後 App 會自動再試';
  if (e && e.name === 'AbortError') return '連線太慢，這次沒讀到；App 會自動再試'; // P74 性能檢查：逾時原本顯示英文 signal is aborted
  return e && e.message ? e.message : String(e);
}
