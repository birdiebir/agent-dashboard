// P74 文件連結（11-07 m-9ruzn4tc）：「文件名稱手機上要看的，要變成連結我才能方便直接讀」。
// 電腦用 share_doc.py 把 md 發佈到 mobile/reviews/，同時更新索引 mobile/reviews/index.json（原始檔名 → 上傳檔）。
// App 讀索引，把卡片、聊天、共識頁、提醒裡出現的檔名變成連結，點了在 App 內讀；索引裡沒有的標「（電腦上）」。
// 連結格式：<App 網址>#doc=<檔名（URL 編碼）>，聊天回覆可以直接放 Markdown 連結。
export const DOC_INDEX_PATH = 'mobile/reviews/index.json';
export const DOC_INDEX_TTL_MS = 5 * 60000;
const FILE_RE = /^mobile\/reviews\/(?:doc|review)-[A-Za-z0-9-]{1,60}\.md$/;
const NAME_RE = /^[^\\/:*?"<>|\r\n]{1,120}\.md$/;
// 文字裡的檔名：路徑分隔、空白、引號、括號、中文標點都當邊界，所以 D:\…\X.md 只取 X.md
export const DOC_NAME_RE = /[^\s\\/`'"「」『』（）()<>[\]{}|，。、；：！？*・→①-⑳]+?\.md(?![A-Za-z0-9_])/g;

export const validDocName = (name) => typeof name === 'string' && NAME_RE.test(name);
// 系統檔不是給人讀的文件，不標「（電腦上）」（真實聊天 27 個標記裡大多是這些，太吵）
export const SYSTEM_MD = new Set(['CLAUDE.md', 'Live.md', 'Project.md', 'Task.md', 'Questions.md', 'README.md', 'MEMORY.md', 'INDEX.md', 'AGENTS.md', 'LOOPS.md', 'SKILL.md', 'Task語法說明.md', '待你回答.md', '每日摘要.md', '路由紀錄.md', '開發日誌.md', '已完成紀錄.md']);

// 索引文字 → Map(檔名 → { file, title })；格式不對的項目跳過，整份壞掉回空 Map
export function parseDocIndex(text) {
  const out = new Map();
  let j;
  try { j = JSON.parse(text); } catch { return out; }
  const docs = j && typeof j === 'object' && j.docs && typeof j.docs === 'object' && !Array.isArray(j.docs) ? j.docs : {};
  for (const [name, e] of Object.entries(docs)) {
    if (!validDocName(name) || !e || typeof e !== 'object' || typeof e.file !== 'string' || !FILE_RE.test(e.file)) continue;
    out.set(name, { file: e.file, title: typeof e.title === 'string' && e.title.trim() ? e.title.trim().slice(0, 80) : name.slice(0, -3) });
  }
  return out;
}

const decode = (s) => { try { return decodeURIComponent(s); } catch { return null; } };

// location.hash → 檔名（沒有 #doc= 或格式不對回 null）
export function docFromHash(hash) {
  const m = /^#doc=([^&#]{1,1200})$/.exec(String(hash || ''));
  const name = m ? decode(m[1]) : null;
  return validDocName(name) ? name : null;
}

// 連結網址 → 檔名：只認這個 App 自己的網址（同 origin、同路徑）加 #doc=；別的網站一律不攔
export function docFromHref(href, appHref) {
  let u, app;
  try { u = new URL(href, appHref); app = new URL(appHref); } catch { return null; }
  if (u.origin !== app.origin || u.pathname.replace(/index\.html$/, '') !== app.pathname.replace(/index\.html$/, '')) return null;
  return docFromHash(u.hash);
}

export const docHash = (name) => '#doc=' + encodeURIComponent(name);

// 沒發佈的檔名：用邊界規則找（中文前面可能黏著字，所以只在後面加「（電腦上）」，不改原文）
function splitUnpublished(s, out) {
  let last = 0;
  for (const m of s.matchAll(DOC_NAME_RE)) {
    if (!validDocName(m[0]) || SYSTEM_MD.has(m[0])) continue;
    const end = m.index + m[0].length;
    out.push({ text: s.slice(last, end) }, { pc: m[0] });
    last = end;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
}

// 一段文字切成 [{ text }｜{ doc: 檔名 }｜{ pc: 檔名 }]：
// 已發佈的照索引逐字找（長的先找，中文黏著前後文也找得到）；剩下的 .md 檔名標「電腦上」。index 是 null（還沒讀到）時整段原樣
export function splitDocText(text, index) {
  const s = String(text == null ? '' : text);
  if (!index || !s.includes('.md')) return [{ text: s }];
  const names = [...index.keys()].sort((a, b) => b.length - a.length);
  const out = [];
  let pos = 0;
  while (pos < s.length) {
    let hit = null;
    for (const n of names) {
      let i = s.indexOf(n, pos);
      while (i > 0 && /[A-Za-z0-9_.-]/.test(s[i - 1])) i = s.indexOf(n, i + 1); // xa.md 裡的 a.md 不算
      if (i >= 0 && (!hit || i < hit.i)) hit = { i, n };
    }
    if (!hit) { splitUnpublished(s.slice(pos), out); break; }
    if (hit.i > pos) splitUnpublished(s.slice(pos, hit.i), out);
    out.push({ doc: hit.n });
    pos = hit.i + hit.n.length;
  }
  const merged = [];
  for (const x of out) {
    if (x.text != null && merged.length && merged[merged.length - 1].text != null) merged[merged.length - 1].text += x.text;
    else if (x.text !== '') merged.push(x);
  }
  return merged.length ? merged : [{ text: s }];
}
