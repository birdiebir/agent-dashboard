// GitHub commits API 回應 → 畫面用的資料（純函式）。時間固定轉成台灣時間（UTC+8，無日光節約）
const pad = (n) => String(n).padStart(2, '0');

export function twTime(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t + 8 * 3600 * 1000);
  return pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
}

export function convertCommits(json) {
  if (!Array.isArray(json)) return [];
  return json.map((c) => {
    const cm = (c && c.commit) || {};
    const au = cm.author || {};
    // 推送時間用 committer 的時間：routine 在 rebase 之後 author 時間不變，會比實際推送早（QC 建議 4）；沒有 committer 才退回 author
    const when = (cm.committer && cm.committer.date) || au.date || '';
    return {
      sha: String((c && c.sha) || '').slice(0, 7),
      subject: String(cm.message || '').split('\n')[0].trim(),
      time: twTime(when),
      ts: Date.parse(when), // 毫秒（讀不到是 NaN）；判斷「電腦幾小時沒推送」用
      author: au.name || (c && c.author && c.author.login) || '',
    };
  });
}
