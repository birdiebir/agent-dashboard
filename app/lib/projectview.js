// 專案頁的資料整理（純函式）。總覽表解析沿用 projects.js；這裡加：已結案表、段落摘要、排序、篩選、相關 Q 題。
// 原則：Project.md 沒寫的欄位一律顯示 MISSING，不自己編；格式異常時回傳空陣列／空摘要，不丟錯。
import { parseProjectOverview, projectSection } from './projects.js';
import { findSection } from './parse.js';

export const MISSING = '—（Project.md 沒寫）';
const toLines = (t) => String(t).replace(/\r/g, '').split('\n');

function splitRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

// 「## 已結案」表：| 結案日 | 專案 | 結果 | 紀錄位置 |
export function parseClosed(text) {
  const lines = toLines(text);
  const s = findSection(lines, '已結案');
  if (!s) return [];
  const res = [];
  for (let i = s.start + 1; i < s.end; i++) {
    if (!lines[i].trim().startsWith('|')) continue;
    const c = splitRow(lines[i]);
    if (c.length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(c[0])) continue; // 表頭與分隔線略過
    const m = /^(?:金科：)?(P\d+)/.exec(c[1]);
    res.push({
      pid: m ? m[1] : '', name: c[1], group: c[1].startsWith('金科：') ? 'work' : 'personal', status: '✅',
      pct: null, progress: '', next: '', waiting: '', closedAt: c[0], result: c[2] || '', closed: true,
    });
  }
  return res;
}

// 總覽表（進行中、暫停、構想）＋已結案。任何一段壞掉就是空陣列，不會整頁壞掉
export function allProjects(text) {
  let active = [];
  let closed = [];
  try { active = parseProjectOverview(text); } catch (e) { active = []; }
  try { closed = parseClosed(text); } catch (e) { closed = []; }
  return [...active.map((p) => ({ ...p, closed: false })), ...closed];
}

// 專案展開狀態的 key：結案表有 15 列沒有 P 編號，所以結案列加上結案日與名稱，才不會共用同一個 key
export const pkey = (pr) => 'proj:' + (pr.pid || '') + (pr.closed ? ':' + (pr.closedAt || '') + ':' + pr.name : '');

// 「等你」欄顯示文字：寫「—」或「無」＝沒有要等的，顯示「無」；整格空白才回 ''（呼叫端顯示「Project.md 沒寫」）
export const waitText = (val) => {
  const v = String(val == null ? '' : val).trim();
  return v && /^([—\-–]+|無|沒有)$/.test(v) ? '無' : v;
};

export const isEmptyCell = (s) => !s || /^[—\-–]+$/.test(String(s).trim()) || /^(無|沒有)$/.test(String(s).trim());
export const isWaiting = (p) => !p.closed && (p.status === '🟡' || !isEmptyCell(p.waiting));
export const hasDeadlineText = (p) => /期限|Due|截止|最晚|\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2}/.test([p.next, p.waiting].join(' '));
export const isActive = (p) => !p.closed && (p.status === '🟢' || p.status === '🟡');

// 排序：有期限且等我 → 有期限且進行中 → Agent 可做（🟢）→ 一般進行中／構想 → 暫停、已結案
export function rankOf(p) {
  if (p.closed || p.status === '⏸') return 4;
  const dl = hasDeadlineText(p);
  if (dl && isWaiting(p)) return 0;
  if (dl && isActive(p)) return 1;
  if (p.status === '🟢') return 2;
  return 3;
}
export function sortProjects(list) {
  return list.map((p, i) => ({ p, i })).sort((a, b) => rankOf(a.p) - rankOf(b.p) || a.i - b.i).map((x) => x.p);
}

export const PFILTERS = ['全部', '進行中', '等我', 'Agent 可做', '工作', '個人', '暫停', '已結案'];
export function filterBy(list, f) {
  switch (f) {
    case '進行中': return list.filter(isActive);
    case '等我': return list.filter(isWaiting);
    case 'Agent 可做': return list.filter((p) => !p.closed && p.status === '🟢');
    case '工作': return list.filter((p) => p.group === 'work');
    case '個人': return list.filter((p) => p.group === 'personal');
    case '暫停': return list.filter((p) => !p.closed && p.status === '⏸');
    case '已結案': return list.filter((p) => p.closed);
    default: return list;
  }
}

export const STATUS_TEXT = { '🟢': 'Agent 可做', '🟡': '等你', '💡': '構想', '⏸': '暫停', '✅': '已結案' };

// ### PXX 段落摘要：標題行、**欄位**：內容
export function projectHeading(text, pid) {
  if (!/^P\d+$/.test(pid)) return '';
  const re = new RegExp('^###\\s+' + pid + '(?!\\d)(.*)$');
  for (const l of toLines(text)) { const m = re.exec(l); if (m) return m[1].trim(); }
  return '';
}

export function projectSummary(text, p) {
  const out = { goal: '', status: '', progress: '', done: '', next: '', waiting: '', updated: '', found: false };
  if (p.closed) {
    return { ...out, goal: p.name, status: '✅ 已結案（' + p.closedAt + '）', done: p.result, found: true };
  }
  let sec = null;
  try { sec = projectSection(text, p.pid); } catch (e) { sec = null; }
  const fields = [];
  if (sec) {
    for (const l of toLines(sec)) {
      const m = /^[-*]\s+\*\*(.+?)\*\*\s*[：:]\s*(.*)$/.exec(l);
      if (m) fields.push({ label: m[1], text: m[2] });
    }
  }
  const pick = (re) => (fields.find((f) => re.test(f.label)) || {}).text || '';
  const heading = projectHeading(text, p.pid);
  const hm = /[　\s]((?:🟢|🟡|💡|⏸|✅)[^]*)$/.exec(heading);
  out.found = !!sec;
  out.goal = pick(/^(說明|目標)/);
  out.status = hm ? hm[1].trim() : (STATUS_TEXT[p.status] || '');
  out.progress = p.progress || '';
  out.done = pick(/^(最近完成|已完成)/);
  out.next = pick(/^下一步/) || p.next || '';
  out.waiting = pick(/^等你/) || (isEmptyCell(p.waiting) ? '' : p.waiting);
  const um = /最後更新\s*[：:]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}-\d{1,2})/.exec(sec || '');
  out.updated = um ? um[1] : '';
  return out;
}

// 相關 Q 題：專案「等你」欄寫到的題號（含「Q201～Q207」範圍），加上 Questions.md 題目標題／內文提到這個 P 編號的題
export function relatedQids(p, cards) {
  const ids = new Set();
  const w = String(p.waiting || '');
  for (const m of w.matchAll(/Q(\d+)\s*[～~\-–]\s*Q?(\d+)/g)) {
    const a = Number(m[1]); const b = Number(m[2]);
    if (b >= a && b - a <= 30) for (let n = a; n <= b; n++) ids.add('Q' + n);
  }
  for (const m of w.matchAll(/\bQ\d+\b/g)) ids.add(m[0]);
  if (p.pid) {
    const re = new RegExp('\\b' + p.pid + '(?!\\d)');
    for (const c of cards || []) if (re.test([c.title, ...(c.body || [])].join('\n'))) ids.add(c.qid);
  }
  const known = new Map((cards || []).map((c) => [c.qid, c]));
  return [...ids].filter((id) => known.has(id)).map((id) => known.get(id));
}

// 題號 → 相關專案（relatedQids 的反向）。工作專案不列
export function projectsByQid(projects, cards) {
  const map = new Map();
  for (const pr of projects || []) {
    if (pr.closed || pr.group === 'work' || !pr.pid) continue;
    for (const c of relatedQids(pr, cards)) {
      if (!map.has(c.qid)) map.set(c.qid, []);
      map.get(c.qid).push(pr);
    }
  }
  return map;
}
