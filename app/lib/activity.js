// 動態（Activity）：commit ＋ Live.md「今天的進度」併成一條時間軸（純函式）。
// 規則：
//  · 誰做的：commit 訊息結尾是「(手機)」＝你從手機 App 寫的（actions.js 的 MSG）；GitHub 網頁預設訊息「Update X.md」＝你；其他＝Agent。
//    （作者欄位在這個 repo 一律是同一個帳號，分不出人，所以看訊息。）
//  · 低訊號：額度、心跳、自動同步這類每天重複很多次的 commit。連續同類合併成一張，可以展開看。
//  · 「今天的進度」每條是「HH:MM 內容」。日期以 Live.md 頁首「最後更新 MM-DD」那天為準（opts.progressDate）；不是今天就標 old。
//    v4 M2 之前一律當成今天，Live.md 停在昨天時，昨天的進度會被當成今天顯示。
const pad = (n) => String(n).padStart(2, '0');

// 只比對「整句格式」：像「Live.md：回 20:13 額度沒刷新」這種回你話的 commit 提到額度，不能被併進額度群組
export const LOW = [
  ['額度', /^Live\.md：額度(（[^）]*）)?$/],
  ['心跳', /^(?:Live\.md：)?心跳(（[^）]*）)?$|^heartbeat$/i],
  ['自動同步', /^routine: (?:自動同步|補 commit 本機修改)(?: \d{4}-\d{2}-\d{2})?$/],
  ['看板更新', /^(?:看板|dashboard)(?:：|: )?更新(?: \d{4}-\d{2}-\d{2})?(（[^）]*）)?$/i],
];

export function actorOf(subject) {
  const s = String(subject || '');
  if (/\(手機\)\s*$/.test(s)) return '你（手機）';
  if (/^Update \S+\.md\s*$/.test(s)) return '你（GitHub 網頁）';
  return 'Agent';
}

export function lowKind(subject) {
  const s = String(subject || '');
  for (const [name, re] of LOW) if (re.test(s)) return name;
  return '';
}

// commit 時間 'MM-DD HH:MM'（台灣時間）→ 排序鍵
const keyOf = (mmdd, now) => {
  const m = /^(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(mmdd);
  if (!m) return 0;
  let year = now.getFullYear();
  if (new Date(year, Number(m[1]) - 1, Number(m[2])).getTime() - now.getTime() > 31 * 86400000) year -= 1;
  return new Date(year, Number(m[1]) - 1, Number(m[2]), Number(m[3]), Number(m[4])).getTime();
};

// commits：convertCommits 的結果 [{sha,subject,time,author}]；progress：Live.md 今天的進度（progressLines）
// 回傳由新到舊的卡片：{type:'event', time, actor, text, source} 或 {type:'group', kind, count, from, to, items:[…]}
// opts.progressDate：'MM-DD'（parseUpdated 的 date）；opts.hideOldProgress：進度不是今天的就不列（首頁／更多資訊用）
export function buildActivity(commits, progress, now = new Date(), opts = {}) {
  const items = [];
  for (const c of commits || []) {
    items.push({
      time: c.time, key: keyOf(c.time, now), actor: actorOf(c.subject), text: c.subject || '（沒有訊息）',
      source: 'commit', low: lowKind(c.subject),
    });
  }
  const today = pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  const dm = /^(\d{1,2})-(\d{1,2})$/.exec(opts.progressDate || '');
  const pday = dm ? pad(dm[1]) + '-' + pad(dm[2]) : today;
  const old = pday !== today;
  (progress || []).forEach((line, i) => {
    const m = /^(\d{1,2}):(\d{2})\s*(.*)$/.exec(String(line).trim());
    if (!m) return;
    if (old && opts.hideOldProgress) return;
    const time = pday + ' ' + pad(m[1]) + ':' + m[2];
    items.push({ time, key: keyOf(time, now) + (1000 - i) / 1000, actor: 'Agent', text: m[3], source: 'progress', low: '', old });
  });
  items.sort((a, b) => b.key - a.key);
  const out = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (it.low) {
      if (last && last.type === 'group' && last.kind === it.low) {
        last.items.push(it); last.count++; last.from = it.time;
      } else out.push({ type: 'group', kind: it.low, count: 1, from: it.time, to: it.time, items: [it] });
    } else out.push({ type: 'event', ...it });
  }
  return out;
}
