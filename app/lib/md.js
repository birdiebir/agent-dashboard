// 小型 markdown 轉換器：所有文字先 escape 再轉。
// 支援：標題、清單（含縮排）、粗體、行內 code、表格、段落、https 連結。
// 不支援原始 HTML；"<" 一律變成 &lt;。
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function inline(src) {
  let s = escapeHtml(String(src).replace(/\u0000/g, ''));
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => {
    codes.push(c);
    return '\u0000' + (codes.length - 1) + '\u0000';
  });
  // 連結只允許 https:；網址已經 escape 過，且不含 * 與空白
  s = s.replace(/\[([^\]]+)\]\((https:\/\/[^\s)*\u0000]+)\)/g,
    (m, t, u) => '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + '</a>');
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\u0000(\d+)\u0000/g, (m, n) => '<code>' + codes[Number(n)] + '</code>');
  return s;
}

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const HEAD_RE = /^(#{1,6})\s+(.*)$/;
const SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

function renderList(items) {
  let out = '';
  const stack = [];
  for (const it of items) {
    const tag = it.ordered ? 'ol' : 'ul';
    if (!stack.length) {
      out += '<' + tag + '><li>' + it.html;
      stack.push({ indent: it.indent, tag });
    } else if (it.indent > stack[stack.length - 1].indent) {
      out += '<' + tag + '><li>' + it.html;
      stack.push({ indent: it.indent, tag });
    } else {
      while (stack.length > 1 && it.indent < stack[stack.length - 1].indent) {
        out += '</li></' + stack[stack.length - 1].tag + '>';
        stack.pop();
      }
      out += '</li><li>' + it.html;
    }
  }
  while (stack.length) out += '</li></' + stack.pop().tag + '>';
  return out;
}

function isBlockStart(lines, i) {
  const l = lines[i];
  return HEAD_RE.test(l) || LIST_RE.test(l) || /^\s*>/.test(l) ||
    (l.trim().startsWith('|') && i + 1 < lines.length && SEP_RE.test(lines[i + 1]));
}

export function renderMarkdown(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const m = HEAD_RE.exec(line);
    if (m) {
      out.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>');
      i++; continue;
    }
    if (line.trim().startsWith('|') && i + 1 < lines.length && SEP_RE.test(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(splitRow(lines[i])); i++; }
      let h = '<div class="tablewrap"><table><thead><tr>' +
        head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>';
      for (const r of rows) h += '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>';
      out.push(h + '</tbody></table></div>');
      continue;
    }
    if (LIST_RE.test(line)) {
      const items = [];
      while (i < lines.length && LIST_RE.test(lines[i])) {
        const mm = LIST_RE.exec(lines[i]);
        items.push({ indent: mm[1].replace(/\t/g, '    ').length, ordered: /\d/.test(mm[2]), html: inline(mm[3]) });
        i++;
        // 清單項目後面緊接的縮排文字視為同一項的延續
        while (i < lines.length && lines[i].trim() && /^\s+/.test(lines[i]) && !LIST_RE.test(lines[i])) {
          items[items.length - 1].html += '<br>' + inline(lines[i].trim());
          i++;
        }
      }
      out.push(renderList(items));
      continue;
    }
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push('<blockquote>' + buf.map(inline).join('<br>') + '</blockquote>');
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !(buf.length && isBlockStart(lines, i))) { buf.push(lines[i].trim()); i++; }
    out.push('<p>' + buf.map(inline).join('<br>') + '</p>');
  }
  return out.join('\n');
}
