// 報表（週回顧、個人月報）的純函式，不碰 DOM、不碰儲存空間。
// 2026-10-30（使用者：手機上也要能讀週報、月報；金額照放；入口放「更多」）：
//   電腦端 Agent\.claude\scripts\mobile_reports.py 在 routine 收尾時把 給我看\週回顧\*.md、給我看\月回顧\YYYY-MM\月報_YYYY-MM.md
//   抄到私人 repo 的 mobile/reports/，加一份 index.json。手機只讀（不在寫入白名單），內容只放記憶體、不寫進手機儲存。

export const REPORT_DIR = 'mobile/reports/';
export const REPORT_INDEX = REPORT_DIR + 'index.json';
export const KINDS = [['weekly', '週回顧'], ['monthly', '個人月報']];
const FILE_RE = /^(?:weekly|monthly)-[0-9A-Za-z-]{4,20}\.md$/; // 只收電腦端產生的固定檔名，擋掉 ../ 這類路徑

// index.json → {weekly: [...], monthly: [...], generatedAt}；每筆 {kind, id, title, file, updated}，新的在前。
// 壞掉的 JSON 回 null（畫面顯示「讀不到目錄」）；格式不對的列直接略過
export function parseReportIndex(text) {
  let d;
  try { d = JSON.parse(String(text || '')); } catch (e) { return null; }
  if (!d || !Array.isArray(d.items)) return null;
  const out = { weekly: [], monthly: [], generatedAt: typeof d.generated_at === 'string' ? d.generated_at : '' };
  for (const it of d.items) {
    if (!it || !out[it.kind] || typeof it.file !== 'string' || !FILE_RE.test(it.file)) continue;
    out[it.kind].push({
      kind: it.kind, id: String(it.id || ''), file: it.file,
      title: typeof it.title === 'string' && it.title.trim() ? it.title.trim() : String(it.id || it.file),
      updated: typeof it.updated === 'string' ? it.updated : '',
    });
  }
  for (const k of ['weekly', 'monthly']) out[k].sort((a, b) => b.id.localeCompare(a.id));
  return out;
}

export const reportPath = (file) => (FILE_RE.test(String(file || '')) ? REPORT_DIR + file : '');

// 「更多」頁那一行的小字
export function reportsSummary(idx) {
  if (!idx) return '週回顧、個人月報';
  const latest = (l) => (l[0] ? l[0].id : '');
  const parts = [];
  if (idx.weekly.length) parts.push('週回顧 ' + idx.weekly.length + ' 份（最新 ' + latest(idx.weekly) + '）');
  if (idx.monthly.length) parts.push('月報 ' + idx.monthly.length + ' 份（最新 ' + latest(idx.monthly) + '）');
  return parts.length ? parts.join('｜') : '電腦還沒推送報表';
}
