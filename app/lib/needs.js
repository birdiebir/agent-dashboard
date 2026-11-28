// P74：交辦需要的主機能力（只作路由中繼資料，交辦文字仍加密）。
export function needsFor(text, kind = 'msg') {
  if (kind === 'answer' || kind === 'order_op' || kind === 'desk') return 'write_personal';
  return /訂位|訂房|訂票|登入|Gmail|信箱|券商|下單|網銀|驗證碼/i.test(String(text || '')) ? 'local_login' : 'write_personal';
}
