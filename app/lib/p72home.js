// P72 第二段：首頁的提問區（①）、正在跑依交辦分組（②）、交辦區（③）、回送前綴與送出狀態推導、版面切換。純函式，不碰 DOM、不碰網路。
// 規格：P72_首頁交辦與卡點_規格.md §7；資料欄位在 lib/workstatus.js（orders、asks）。
import { saidFor } from './p72.js';

const pad = (n) => String(n).padStart(2, '0');
const clip = (v, n) => [...String(v == null ? '' : v)].slice(0, n).join('');
const clock = (t) => {
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + 8 * 3600000); // 台北時間，純函式不用本機時區
  return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
};
const MIN = 60000;

export const STUCK_MIN = 15; // 答案或 OK 送出後超過這麼久電腦還沒收＝橘色、問嘿嘿
export const ASK_MAX = 3; // ① 最多幾張
export const RUN_MAX = 5; // ② 最多幾列
export const ORDER_MAX = 5; // ③ 最多幾件
export const REVIEW_MAX = 5; // 展開「做完待你驗收」後先列幾件，其餘「還有 N 件」
export const STALE_DELIVERED_DAYS = 7;
export const GOT_KEEP_MIN = 10; // 已送到的提問留 10 分鐘（電腦端也是 10 分鐘）

// ---------- 版面切換 ----------
export const HOME_LAYOUT_DEFAULT = 'v72';
// 'five'＝P74 五欄版（試用，預設關；沒有設定、或設定壞掉一律 v72）
export const homeLayout = (raw) => (raw === 'v71' || raw === 'v72' || raw === 'five' ? raw : HOME_LAYOUT_DEFAULT);

// ---------- 回送前綴：↩a-編號｜答案、↩o-編號｜OK ----------
// 跟電腦端 order_intake 的 PREFIX_RE 一致：只認開頭的 ↩（前面不能有［討論對象］前綴），｜也可以是半形 |，可帶 @HH:MM
const REPLY_RE = /^↩\s*([ao]-[a-z0-9]{6})(?:@\d{1,2}:\d{2})?\s*[｜|]\s*([\s\S]*)$/;
export const replyPrefix = (id) => '↩' + id + '｜';
export const replyContent = (id, text) => replyPrefix(id) + String(text == null ? '' : text).trim();
// 內容 → {id, kind:'ask'|'order', text}；不是回送前綴回 null
export function parseReply(content) {
  const m = REPLY_RE.exec(String(content == null ? '' : content));
  if (!m) return null;
  return { id: m[1], kind: m[1][0] === 'a' ? 'ask' : 'order', text: m[2].trim() };
}
export const ORDER_TEXT = { ok: 'OK', yes: '是交辦', no: '不是交辦', problem: '還有問題：' };
// 交辦回送的意思：ok／yes／no／problem；認不得回 null
export function orderIntent(text) {
  const t = String(text == null ? '' : text).trim();
  if (/^(?:ok|驗收|結案)$/i.test(t)) return 'ok';
  if (t === '是交辦') return 'yes';
  if (t === '不是交辦') return 'no';
  if (/^還有問題/.test(t)) return 'problem';
  if (/^選./.test(t)) return 'pick'; // P74（11-07 m-njtajtm2）：決定型驗收卡的選項（↩o-xxxxxx｜選A 現在做）
  return null;
}
// 「還有問題」送出時內容一定要以「還有問題」開頭（電腦端靠它認），使用者把預填字刪掉也補回去
export const problemText = (text) => {
  const t = String(text == null ? '' : text).trim();
  return /^還有問題/.test(t) ? t : '還有問題：' + t;
};

// ---------- 本機送出紀錄（outbox）→ 每個編號送過什麼 ----------
// ob：state.ob。回傳 Map<編號, [{id, kind, text, intent, createdAt, sentAt, obState, err, mid}]>（舊到新）
export function localSends(ob) {
  const m = new Map();
  for (const it of Array.isArray(ob) ? ob : []) {
    if (!it || it.kind !== 'chat') continue;
    const r = parseReply(it.payload && it.payload.content);
    if (!r) continue;
    const e = { id: r.id, kind: r.kind, title: (it.payload && it.payload.orderTitle) || '', text: r.text, intent: r.kind === 'order' ? orderIntent(r.text) : null, createdAt: it.createdAt || 0, sentAt: it.sentAt || 0, obState: it.state, err: it.err || '', mid: it.id };
    if (!m.has(r.id)) m.set(r.id, []);
    m.get(r.id).push(e);
  }
  for (const l of m.values()) l.sort((a, b) => a.createdAt - b.createdAt);
  return m;
}

// 一筆本機送出的階段。failed＝沒送出；queued＝還在手機排隊（超過 15 分鐘轉橘、給「到送出紀錄」）；sending＝送出中；
// sent＝寫進去了，等電腦收（超過 15 分鐘電腦還沒收＝stuck）。「送出了但對方還沒收」只用在真的送出去的，還沒送出去的不能這樣說
function sendStage(s, now) {
  if (s.obState === 'held') return { key: 'held', text: '馬上送出（按錯可按下方「復原」）', tone: 'info' }; // 按錯復原等待中（11-08 a-dh553q）
  if (s.obState === 'failed') return { key: 'failed', text: '沒送出去' + (s.err ? '：' + clip(s.err, 30) : ''), tone: 'warn' };
  if (s.obState === 'sent') {
    if (now - (s.sentAt || s.createdAt) > STUCK_MIN * MIN) return { key: 'stuck', text: '送出了但對方還沒收', tone: 'warn', askHey: true };
    return { key: 'sent', text: '已送出，等電腦收', tone: 'info' };
  }
  if (s.obState === 'sending') return { key: 'sending', text: '送出中…', tone: 'info' };
  const late = now - s.createdAt > STUCK_MIN * MIN;
  return { key: 'queued', text: '排隊中，連上網路就送', tone: late ? 'warn' : 'info', outboxHint: late };
}

// ---------- ① 提問卡：階段 ----------
// ask：readAsk 的結果；sends：這個編號的本機送出清單（可 undefined）。電腦端資料（answered／got）為準，本機只補「還沒回來」的空檔
export function askPhase(ask, sends, now) {
  const list = Array.isArray(sends) ? sends : [];
  const ok = list.filter((x) => x.obState !== 'failed');
  const last = ok[ok.length - 1] || list[list.length - 1] || null;
  if (ask.answered) {
    const at = ask.answeredMs != null ? ask.answeredMs : last ? last.createdAt : now;
    const answer = ask.answer || (last ? last.text : '');
    if (ask.gotMs != null) return { key: 'delivered', text: '已送到 ' + clock(ask.gotMs), tone: 'ok', answer };
    if (now - at > STUCK_MIN * MIN) return { key: 'stuck', text: '答案送出了但對方還沒收', tone: 'warn', askHey: true, answer };
    return { key: 'received', text: '電腦收到了，送往 ' + ask.toText, tone: 'info', answer };
  }
  if (last) return { ...sendStage(last, now), answer: last.text };
  return { key: 'open', text: '', tone: null, answer: '' };
}

// 選項要標「建議」的是哪一個：電腦端給了 default 就是它，沒有就第一個
export const suggestedIndex = (ask) => (ask.def != null ? ask.def : 0);

// 剛送出答案的卡留在原位（queued／sent／received 跟 open 同一級，照等的時間排）：按了選項，卡片不能跳到下面看不到
const ASK_RANK = { open: 0, job: 0, queued: 0, sending: 0, sent: 0, received: 0, failed: 1, stuck: 1, pc: 2, work: 2, delivered: 4 };

// 首頁 ① 的卡片。w：readWorkStatus 的結果；opts：{now, sends, jobWaits（waitList 來源 job 的項目）, more}
// 回傳 {cards, shown, hidden, openN（還需要你回答的張數）}；card：{type:'ask'|'pc'|'work'|'job', key, ask, phase, order, sinceMs}
export function askBoard(w, { now, sends = new Map(), jobWaits = [], more = false, max = ASK_MAX } = {}) {
  const orders = (w && w.orders) || [];
  const orderOf = (id) => orders.find((o) => o.id === id) || null;
  const cards = [];
  const covered = new Set();
  for (const a of (w && w.asks) || []) {
    if (a.gotMs != null && now - a.gotMs > GOT_KEEP_MIN * MIN) continue;
    if (/^j-/.test(a.to)) covered.add(a.to);
    const od = a.order ? orderOf(a.order) : (/^o-/.test(a.to) ? orderOf(a.to) : null);
    if (od) for (const j of od.jobs) covered.add(j);
    let type = 'ask';
    let phase;
    if (a.kind === 'pc') { type = 'pc'; phase = { key: 'pc', text: '', tone: null }; } else if (a.work) { type = 'work'; phase = a.opts && a.opts.length ? askPhase(a, sends.get(a.id), now) : { key: 'work', text: '', tone: null }; } else phase = askPhase(a, sends.get(a.id), now);
    cards.push({ type, key: a.id, ask: a, phase, order: od, sinceMs: a.sinceMs });
  }
  for (const e of jobWaits) {
    const id = String(e.key || '').replace(/^w:/, '');
    if (covered.has(id)) continue;
    cards.push({ type: 'job', key: e.key, ask: null, job: e, phase: { key: 'job', text: '', tone: null }, order: null, sinceMs: e.sinceMs });
  }
  const rank = (c) => ASK_RANK[c.phase.key] ?? 3;
  cards.sort((a, b) => rank(a) - rank(b) || (a.sinceMs ?? Infinity) - (b.sinceMs ?? Infinity));
  const openN = cards.filter((c) => c.phase.key === 'open' || c.phase.key === 'job').length;
  const shown = more ? cards : cards.slice(0, max);
  return { cards, shown, hidden: cards.length - shown.length, openN };
}

// 等了多久：「等了 12 分」「等了 2 小時」；沒有開始時間回空字串
export function waitedText(sinceMs, now) {
  if (!Number.isFinite(sinceMs)) return '';
  const m = Math.max(0, Math.floor((now - sinceMs) / MIN));
  if (m < 1) return '剛問';
  if (m < 60) return '等了 ' + m + ' 分';
  if (m < 1440) return '等了 ' + Math.floor(m / 60) + ' 小時';
  return '等了 ' + Math.floor(m / 1440) + ' 天';
}

// ---------- ③ 交辦卡 ----------
export const STAGES = ['收到', '進行中', '做完', '你說 OK'];
export const ORDER_RANK = { waiting_user: 0, doing: 1, received: 2, waiting_other: 3, candidate: 4, delivered: 9 }; // 做完待驗收固定最後（而且收成一行）
// 狀態 → 狀態條停在哪一格（idx）、旗標（等你／等別人：用旗標色加文字）
export function stageOf(state) {
  switch (state) {
    case 'received': return { idx: 0, flag: null };
    case 'doing': return { idx: 1, flag: null };
    case 'waiting_user': return { idx: 1, flag: 'user' };
    case 'waiting_other': return { idx: 1, flag: 'other' };
    case 'delivered': return { idx: 2, flag: null };
    default: return { idx: -1, flag: null }; // candidate：沒有狀態條
  }
}

// 這件交辦有沒有「本機剛按、電腦資料還沒回來」的動作。看「電腦端的狀態有沒有變」，不只看時間：
//   OK／還有問題：電腦端這件還是「做完待驗收」才算還沒回來（OK 結案後整件不在清單、還有問題後變進行中）；是／不是：還是候選。
//   電腦端的 updated_at 會被這件底下工作的活動推新，所以送出後 15 分鐘內只看狀態；超過 15 分鐘才加看時間（updated_at 比送出還新＝電腦處理過了）。
//   這樣手機時鐘跟電腦差幾分鐘也不會讓本機狀態一直不消失，或太早消失讓按鈕又冒出來。
const OVERLAY_STATE = { ok: 'delivered', problem: 'delivered', pick: 'delivered', yes: 'candidate', no: 'candidate' };
// 11-09 m-p0dymauc：電腦端帶了 userOps（收過的手機操作編號）時，那筆送出已經被處理 → 不再蓋本機狀態。
//   例：按「還有問題」→ 電腦重新交卡，狀態又是 delivered，以前 15 分鐘內會被誤判成「還沒處理」、驗收按鈕消失。
// 同 lib/hub.js 的 xIdFor（hub.js 已經 import 本檔，這裡不能反過來 import，避免循環；測試鎖住兩邊一致）
export function opXId(itemId) {
  const suf = String(itemId || '').replace(/^m-/, '').toLowerCase();
  if (/^[a-z0-9]{8}$/.test(suf)) return 'x-' + suf;
  let h = 2166136261;
  for (const ch of String(itemId)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return 'x-' + h.toString(36).padStart(8, '0').slice(-8);
}
const handledBy = (order, s) => !!s.mid && Array.isArray(order.userOps) && (order.userOps.includes(s.mid) || order.userOps.includes(opXId(s.mid)));
export function orderOverlay(order, sends, now) {
  const list = (Array.isArray(sends) ? sends : []).filter((s) => s.intent && OVERLAY_STATE[s.intent] === order.state && !handledBy(order, s)
    && (now - s.createdAt <= STUCK_MIN * MIN || (order.updatedMs || 0) <= s.createdAt));
  const last = list[list.length - 1];
  if (!last) return null;
  const st = sendStage(last, now);
  const picked = last.intent === 'pick' ? '「' + String(last.text || '').replace(/^選\s*/, '') + '」' : '';
  const label = { ok: '你按了 OK', problem: '你說還有問題', pick: '你選了' + picked, yes: '你說這是交辦', no: '你說這不是交辦' }[last.intent];
  const sentText = { ok: '已送出你的 OK，等電腦記下結案', problem: '已送出：還有問題，等電腦接手', pick: '已送出：你選了' + picked + '，等電腦照這個做', yes: '已送出：這是交辦，等電腦登記', no: '已送出：這不是交辦' }[last.intent];
  const text = st.key === 'sent' ? sentText : label + '，' + st.text;
  return { intent: last.intent, key: st.key, text, tone: st.tone, askHey: !!st.askHey, outboxHint: !!st.outboxHint, hide: last.intent === 'no' && (st.key === 'sent' || st.key === 'queued' || st.key === 'sending') };
}

// 首頁 ③：orders（readOrder 的結果）→ 要畫的卡。工作類不給按鈕。
// 排序：等你 → 進行中 → 收到 → 等別人或時間 → 候選；最多 max 件。「做完待你驗收」收成一行（review，點開才逐件列），
// 超過 7 天沒驗收的再收一行（stale）。上限只算非驗收的。
// 展開待驗收後先列 reviewMax 件（reviewShown），其餘 reviewHidden 件「還有 N 件」。
// 回傳 {cards, shown, hidden, review, reviewShown, reviewHidden, reviewN, stale, staleN}；card：{order, state, stage, buttons:'delivered'|'candidate'|'work'|null, overlay, said}
export function orderBoard(orders, { now, sends = new Map(), threads = [], more = false, max = ORDER_MAX, reviewMore = false, reviewMax = REVIEW_MAX } = {}) {
  const all = [];
  for (const o of Array.isArray(orders) ? orders : []) {
    const overlay = orderOverlay(o, sends.get(o.id), now);
    if (overlay && overlay.hide) continue;
    let state = o.state;
    if (overlay && overlay.intent === 'yes' && state === 'candidate') state = 'received'; // 你說是交辦：先當正式交辦
    let buttons = null;
    if (o.work) buttons = 'work'; // 工作類交辦只顯示「請到電腦處理」，沒有「OK／還有問題」按鈕；app.js startProblem 裡 work 的 needs 是防呆，目前畫面走不到
    else if (!overlay && state === 'delivered') buttons = 'delivered';
    else if (!overlay && state === 'candidate') buttons = 'candidate';
    else if (overlay && overlay.intent === 'problem') state = 'doing';
    all.push({ order: o, state, stage: stageOf(state), buttons, overlay, said: saidFor({ said: o.said, saidMs: o.saidMs, from: o.from, work: o.work }, threads) });
  }
  const isReview = (c) => c.state === 'delivered';
  const isStale = (c) => isReview(c) && !c.overlay && c.order.updatedMs != null && now - c.order.updatedMs > STALE_DELIVERED_DAYS * 86400000;
  const rank = (c) => ORDER_RANK[c.state] ?? 9;
  const sorter = (a, b) => rank(a) - rank(b) || (b.order.updatedMs || 0) - (a.order.updatedMs || 0);
  const live = all.filter((c) => !isReview(c)).sort(sorter);
  const review = all.filter((c) => isReview(c) && !isStale(c)).sort(sorter);
  const stale = all.filter(isStale).sort(sorter);
  const shown = more ? live : live.slice(0, max);
  const reviewShown = reviewMore ? review : review.slice(0, reviewMax);
  return { cards: live, shown, hidden: live.length - shown.length, review, reviewShown, reviewHidden: review.length - reviewShown.length, reviewN: review.length, stale, staleN: stale.length };
}

// 私人 repo 的驗收文件（電腦端 publish_review.py 產生，只認固定檔名，擋掉 ../ 這類路徑）
const REVIEW_PROOF_RE = /^repo:(mobile\/reviews\/review-o-[a-z0-9]{6}\.md)$/;

// 待驗收卡的白話備註：「做了什麼：…你要看：…好處：…」拆成列。少於兩個標籤回 null，照一般備註顯示
// P74（11-07 m-yzw2s8kx）：驗收卡改成「你要的／結果／怎麼驗／效益」；舊寫法的「做了什麼／你要看／好處」照樣讀，換成新標籤顯示
const NOTE_LABELS = /(結果|實測|怎麼驗|怎麼試|效益|選項|做了什麼|你要看|好處)：/g;
const NOTE_RENAME = { 做了什麼: '結果', 你要看: '怎麼驗', 好處: '效益' };
export function noteRows(note) {
  const s = String(note == null ? '' : note);
  const ms = [...s.matchAll(NOTE_LABELS)];
  if (ms.length < 2 || s.slice(0, ms[0].index).trim()) return null;
  return ms.map((m, i) => ({ label: NOTE_RENAME[m[1]] || m[1], text: s.slice(m.index + m[0].length, i + 1 < ms.length ? ms[i + 1].index : s.length).trim() }));
}

// 決定型驗收卡的選項：備註「選項：A 現在做｜B 等回電腦旁」→ ['A 現在做', 'B 等回電腦旁']（最多 4 個，空的略過）
// 審查 #5：選項不綁版面、不要求備註至少兩個標籤；備註裡有「選項：」就取它到下一個標籤或結尾
export function noteOptionsOf(note) {
  const m = /選項：([^]*?)(?=(?:結果|怎麼驗|怎麼試|效益|做了什麼|你要看|好處)：|$)/.exec(String(note == null ? '' : note));
  return m ? noteOptions(m[1]) : [];
}
export function noteOptions(text) {
  return String(text == null ? '' : text).split(/[｜|]/).map((x) => x.replace(/[。．.]+$/, '').trim()).filter(Boolean).slice(0, 4);
}

// 交辦名稱拿掉開頭的專案代號（P74 首頁驗收 → 首頁驗收），給使用者看的卡片不放內部代號
export const plainTitle = (t) => String(t == null ? '' : t).replace(/^P\d+[\s：:-]*/, '') || String(t == null ? '' : t);

// 聊天頁要補顯示的回覆：「還有問題」和手打的回答走 answer／order_op，不會變成對話串，送出後要在這裡留一則（使用者 11-07 m-nsw4e238）。
// 按鈕（OK、是、不是、選項）不算，卡片上已有回饋。shownIds：已經對到對話串的留言編號（舊路徑寫成 ↩ 行的，不重複顯示）
export function replyEchoes(items, { now, keepMs = 3 * 86400000, shownIds = new Set() } = {}) {
  const out = [];
  for (const it of items || []) {
    if (it.kind !== 'chat' || it.state !== 'sent' || !(it.payload && it.payload.hubReply) || shownIds.has(it.id)) continue;
    if (now - it.createdAt > keepMs) continue;
    const r = parseReply(it.payload.content);
    if (!r) continue;
    if (r.kind === 'order' && orderIntent(r.text) !== 'problem') continue;
    if (r.kind === 'ask' && Number.isInteger(it.payload.hubOpt)) continue;
    out.push({ id: it.id, at: it.createdAt, kind: r.kind, target: r.id, text: r.text });
  }
  return out.sort((a, b) => a.at - b.at);
}

// 成品：https 網址才可點（照 md.js 的連結規則：只允許 https、不含空白與會破壞屬性的字元）；其他一律當文字顯示
export function proofView(proof) {
  const p = String(proof == null ? '' : proof).trim();
  if (!p) return null;
  const rm = REVIEW_PROOF_RE.exec(p);
  if (rm) return { kind: 'review', path: rm[1], text: '打開文件' };
  if (/^https:\/\/[^\s"'<>`*\u0000-\u001f]+$/.test(p) && p.length <= 300) {
    let shown = p.replace(/^https:\/\//, '');
    if ([...shown].length > 40) shown = [...shown].slice(0, 40).join('') + '…';
    return { kind: 'link', href: p, text: shown };
  }
  // 路徑只顯示檔名（完整路徑放 full，畫面放在 title）；沒有分隔符號的（例如「訂位確認信與取消信（Gmail）」）原樣顯示
  const base = p.split(/[\\/]/).filter(Boolean).pop() || p;
  return { kind: 'text', text: clip(base, 60), full: clip(p, 300) };
}

// ---------- ② 正在跑依交辦分組 ----------
// entries：detailView(w).items 去掉 waiting 的（{item, view}）；orders：readOrder 的結果。
// 一件交辦有一個以上的 job → 一組；掛不到交辦的放最後（loose）。回傳 {rows, shown, hidden}
// row：{type:'group', order, jobs:[entry], etaMs（最慢的預計完成）, said}｜{type:'loose', entry}
export function runGroups(entries, orders, { threads = [], more = false, max = RUN_MAX } = {}) {
  const byId = new Map((orders || []).map((o) => [o.id, o]));
  const groups = new Map();
  const loose = [];
  const rows = [];
  for (const e of entries || []) {
    const o = e.item.order ? byId.get(e.item.order) : null;
    if (!o) { loose.push(e); continue; }
    if (!groups.has(o.id)) {
      const g = { type: 'group', order: o, jobs: [], etaMs: null, said: saidFor({ said: o.said, saidMs: o.saidMs, from: o.from, work: o.work }, threads) };
      groups.set(o.id, g);
      rows.push(g);
    }
    const g = groups.get(o.id);
    g.jobs.push(e);
    if (e.item.etaMs != null && (g.etaMs == null || e.item.etaMs > g.etaMs)) g.etaMs = e.item.etaMs;
  }
  for (const e of loose) rows.push({ type: 'loose', entry: e });
  const shown = more ? rows : rows.slice(0, max);
  return { rows, shown, hidden: rows.length - shown.length };
}

// 一組的小字：「2 個工作・最慢 00:41」；只有一個工作時回空字串（直接列出來）
export function groupSummary(g) {
  if (g.jobs.length < 2) return '';
  return g.jobs.length + ' 個工作' + (g.etaMs != null ? '・最慢 ' + clock(g.etaMs) : '');
}

// ---------- 聊天泡泡用的標籤快取：提問與交辦結案後電腦端會拿掉，泡泡仍要寫得出「回答：…」「交辦：…」 ----------
// prev：{編號: 標籤}；w：readWorkStatus 的結果。工作類不記內容。超過 cap 筆丟最舊的
export const LABEL_MAX = 20; // 泡泡只顯示前 20 字，手機上也只存 20 字
export function mergeLabels(prev, w, cap = 120) {
  const out = { ...(prev && typeof prev === 'object' ? prev : {}) };
  for (const a of (w && w.asks) || []) {
    if (a.kind === 'pc') continue;
    const q = a.work ? '一件工作的問題' : a.q;
    delete out[a.id]; out[a.id] = clip(q, LABEL_MAX);
  }
  for (const o of (w && w.orders) || []) { delete out[o.id]; out[o.id] = clip(o.title, LABEL_MAX); }
  const keys = Object.keys(out);
  for (const k of keys.slice(0, Math.max(0, keys.length - cap))) delete out[k];
  return out;
}
