// 按錯復原（11-08 a-dh553q）：按選項、通過這類按鈕後，先在手機等幾秒才真的送出，期間可以「復原」。
// 使用者原話：「A 可以 1-2 秒後送，參考現行 app 的機制（如 email）」→ 像 Gmail 的「已傳送／復原」提示條，不擋操作。
//
//   - 等待中的那一筆不進寫入紀錄（outbox）：沒存手機、沒送電腦、沒叫醒 Agent。復原＝直接丟掉。
//   - 時間到、離開 App（切走、鎖螢幕）、又按了別張卡的按鈕 → 馬上送（commit）。
//   - 同一張卡再按另一個選項 → 換成新的、重新計時。
//   - 手指按住提示條時暫停計時，放開再繼續（免得手指正要按「復原」時剛好送出）。
//   - 秒數存在手機設定（agent.undoHoldS），0＝關（跟以前一樣按了就送）。
// 純函式＋注入計時器，Node 可測（test/p74undohold.test.js）。
export const UNDO_HOLD_KEY = 'agent.undoHoldS';
export const UNDO_HOLD_DEFAULT = 2;
export const UNDO_HOLD_CHOICES = [0, 1, 2, 3];

export function readHoldS(storage) {
  let raw = null;
  try { raw = storage ? storage.getItem(UNDO_HOLD_KEY) : null; } catch (e) { raw = null; }
  if (raw === null || raw === undefined || raw === '') return UNDO_HOLD_DEFAULT;
  const n = Number(raw);
  return UNDO_HOLD_CHOICES.includes(n) ? n : UNDO_HOLD_DEFAULT;
}

export function writeHoldS(storage, s) {
  const n = UNDO_HOLD_CHOICES.includes(Number(s)) ? Number(s) : UNDO_HOLD_DEFAULT;
  try { storage.setItem(UNDO_HOLD_KEY, String(n)); } catch (e) { /* 存不了就這次有效 */ }
  return n;
}

// 提示條上的字：「已選：○○」，太長截掉
export function holdLabel(text, max = 18) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  const cps = [...s];
  return cps.length > max ? cps.slice(0, max).join('') + '…' : s;
}

// opts：{ setTimer(fn, ms)→id, clearTimer(id), now()→ms, onChange(pending|null) }
// hold({ key, label, ms, item, commit }) 回傳 'held'｜'sent'
export function createHold({ setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id), now = () => Date.now(), onChange = () => {} } = {}) {
  let cur = null; // { key, label, item, commit, ms, left, startAt, timer, paused }
  const stop = () => { if (cur && cur.timer != null) { clearTimer(cur.timer); cur.timer = null; } };
  const arm = () => { cur.startAt = now(); cur.timer = setTimer(fire, Math.max(0, cur.left)); };
  function fire() {
    if (!cur) return;
    const c = cur;
    cur = null;
    c.timer = null;
    c.commit();
    onChange(null);
  }
  const api = {
    pending: () => cur,
    hold({ key, label = '', ms, item = null, commit }) {
      if (typeof commit !== 'function') throw new Error('hold 需要 commit');
      if (!(ms > 0)) { if (cur) api.flush(); commit(); return 'sent'; }
      if (cur && cur.key !== key) api.flush(); // 別張卡：前一筆先送
      else if (cur) stop(); // 同一張卡改選：丟掉前一筆，重新計時
      cur = { key, label, item, commit, ms, left: ms, startAt: 0, timer: null, paused: false };
      arm();
      onChange(cur);
      return 'held';
    },
    undo() {
      if (!cur) return false;
      stop();
      const c = cur;
      cur = null;
      onChange(null);
      return c;
    },
    flush() {
      if (!cur) return false;
      stop();
      fire();
      return true;
    },
    pause() {
      if (!cur || cur.paused) return false;
      stop();
      cur.left = Math.max(0, cur.left - (now() - cur.startAt));
      cur.paused = true;
      onChange(cur);
      return true;
    },
    resume() {
      if (!cur || !cur.paused) return false;
      cur.paused = false;
      arm();
      onChange(cur);
      return true;
    },
  };
  return api;
}
