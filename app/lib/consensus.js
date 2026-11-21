// P74 當前共識（11-07 o-u2kgwy）：電腦用 publish_review.py --doc 共識 發佈到私人 repo，App「更多」點開在 App 內讀。
// 發佈時最上面會加一行「> 最後更新：YYYY-MM-DD HH:mm」，這裡拆出來放頂端；各節依標題分成已定／待確認，畫面用顏色區分。
export const CONSENSUS_PATH = 'mobile/reviews/doc-consensus.md';
export const CONSENSUS_TITLE = 'P74 當前共識';

export function consensusParts(text) {
  const lines = String(text == null ? '' : text).replace(/\r/g, '').split('\n');
  let updated = '';
  const i = lines.findIndex((l) => l.trim() !== '');
  if (i >= 0) {
    const m = lines[i].match(/^>\s*最後更新：\s*(.+?)\s*$/);
    if (m) { updated = m[1]; lines.splice(i, 1); }
  }
  return { updated, body: lines.join('\n').replace(/^\n+/, '') };
}

// 節標題 → 'pending'（待確認、還沒做、待做）｜'done'（已定、已上線）｜''（其他，例如維護規則）
export function sectionKind(title) {
  const t = String(title || '');
  if (/待.{0,6}確認|還沒做|待做|未定|要回電腦/.test(t)) return 'pending';
  if (/已定|已上線|定案|已確認/.test(t)) return 'done';
  return '';
}
