// Project.md：總覽兩張表的解析、`### PXX` 段落擷取（純函式，不碰 DOM）
import { findSection } from './parse.js';

const toLines = (t) => String(t).replace(/\r/g, '').split('\n');
export const STATUS_EMOJI = ['🟢', '🟡', '⏸', '💡', '✅'];

function splitRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

// 回傳每個專案 {pid, name, group('work'|'personal'|''), status(emoji), pct(數字或 null), progress(原文), next, waiting}
export function parseProjectOverview(text) {
  const lines = toLines(text);
  const s = findSection(lines, '總覽');
  if (!s) return [];
  let group = '';
  const res = [];
  for (let i = s.start + 1; i < s.end; i++) {
    const l = lines[i];
    const h = /^###\s+(.*)$/.exec(l);
    if (h) { group = h[1].includes('工作') ? 'work' : h[1].includes('個人') ? 'personal' : ''; continue; }
    if (!l.trim().startsWith('|')) continue;
    const c = splitRow(l);
    if (c.length < 6 || !/^P\d+$/.test(c[0])) continue; // 表頭、分隔線、其他表格都略過
    const pm = /(\d+(?:\.\d+)?)\s*%/.exec(c[3]);
    res.push({
      pid: c[0], name: c[1], group,
      status: STATUS_EMOJI.find((e) => c[2].includes(e)) || '',
      pct: pm ? Math.min(100, Number(pm[1])) : null,
      progress: c[3], next: c[4], waiting: c[5],
    });
  }
  return res;
}

// `### P33 …` 到下一個 # / ## / ### 之前的全文（不含標題行）；找不到回傳 null
export function projectSection(text, pid) {
  if (!/^P\d+$/.test(pid)) throw new Error('專案編號格式不對：' + pid);
  const lines = toLines(text);
  const re = new RegExp('^###\\s+' + pid + '(?!\\d)');
  const i = lines.findIndex((l) => re.test(l));
  if (i < 0) return null;
  let end = lines.length;
  for (let j = i + 1; j < lines.length; j++) if (/^#{1,3}\s/.test(lines[j])) { end = j; break; }
  return lines.slice(i + 1, end).join('\n').trim();
}

export const STATUS_FILTERS = ['全部', '🟢', '🟡', '⏸', '💡'];
export function filterProjects(list, f) {
  return f === '全部' || !f ? list : list.filter((p) => p.status === f);
}
