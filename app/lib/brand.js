// Agent 的名稱與圖示：整個 App 唯一的修改點（中央導覽鈕、對話頁標題都讀這裡）。
// 使用者決定名稱與圖示後只改這兩行；若選自繪 SVG，也只要改中央鈕的繪製處。
export const AGENT_NAME = '嘿嘿'; // 2026-10-27 使用者定案（使用者本人的名字不能拿來當 Agent 名）
export const AGENT_ICON = '😁'; // 圖片載不到時的備用（Q214 原本用 emoji）
// 11-09 m-gq9lijj9 使用者：「底下聊天按鈕的頭像也可以換成嘿嘿嗎？目前是表情包」→ 中央鈕改用 App 圖示（已在 sw.js 快取清單，離線也有）
export const AGENT_ICON_IMG = 'icons/icon-192.png';
