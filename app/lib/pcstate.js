// 電腦端狀態投影檔 mobile/state.json（電腦寫、手機只讀；欄位見 D:\Personal\Agent\.claude\scripts\mobile_sync.py）。
//   version、generated_at、pc{last_seen,source}、remote{on,until}、
//   questions[{id,title,status:'已收到'|'已處理',answered:'MM-DD',answer}]、
//   tasks[{mid,title,state:'open'|'pending'|'done',result,progress,date}]、
//   journal[{date:'YYYY-MM-DD',status}]、truncated、
//   routines[{name,who,when,next,match,background}]（2026-10-30：定期提醒）、
//   quota{h5,h5_reset,d7,d7_reset,read_at}（v4.2：電腦讀到的額度，可能沒有）、questions[].still_yours（v4.2：已收到但還有你要做的）
// 404、壞 JSON、格式不對一律回 null（當成沒有這個檔，不報錯）。

export const STATE_FILE = 'mobile/state.json'; // 只讀；不在 lib/github.js 的寫入白名單裡

const ms = (s) => { const t = Date.parse(String(s || '')); return Number.isFinite(t) ? t : null; };
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) : []);
const str = (v) => (typeof v === 'string' ? v : '');

// v4.2：額度 {h5,d7,h5ResetMs,d7ResetMs,readMs}；缺欄位、不是數字、讀取時間解析不到都當成沒有
function readQuota(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const n = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const q = { h5: n(v.h5), d7: n(v.d7), h5ResetMs: ms(v.h5_reset), d7ResetMs: ms(v.d7_reset), readMs: ms(v.read_at) };
  return q.readMs != null && (q.h5 != null || q.d7 != null) ? q : null;
}

// 2026-10-30：routines[{name,who:'you'|'auto',when,next:'YYYY-MM-DD'|'',match:[開頭],background}]；欄位不對的列丟掉
function readRoutines(a) {
  return arr(a).filter((r) => str(r.name) && (r.who === 'you' || r.who === 'auto')).map((r) => ({
    name: r.name, who: r.who, when: str(r.when),
    next: /^\d{4}-\d{2}-\d{2}$/.test(str(r.next)) ? r.next : '',
    match: Array.isArray(r.match) ? r.match.filter((x) => typeof x === 'string' && x) : [],
    background: r.background === true,
  }));
}

export function readState(text) {
  let j;
  try { j = JSON.parse(String(text || '')); } catch (e) { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const remote = j.remote && typeof j.remote === 'object' ? j.remote : {};
  const pc = j.pc && typeof j.pc === 'object' ? j.pc : {};
  return {
    version: Number.isInteger(j.version) ? j.version : 0,
    generatedMs: ms(j.generated_at),
    pcMs: ms(pc.last_seen),
    pcSource: str(pc.source),
    remote: { on: remote.on === true, untilMs: ms(remote.until) },
    questions: arr(j.questions).filter((q) => /^(?:Q|KB)\d+$/.test(str(q.id))).map((q) => ({ id: q.id, title: str(q.title), status: str(q.status), answered: str(q.answered), answer: str(q.answer), stillYours: q.still_yours === true })),
    quota: readQuota(j.quota),
    tasks: arr(j.tasks).map((t) => ({ mid: /^m-[A-Za-z0-9]+$/.test(str(t.mid)) ? t.mid : '', title: str(t.title), state: ['open', 'pending', 'done'].includes(t.state) ? t.state : 'open', result: str(t.result), progress: str(t.progress), date: str(t.date) })),
    journal: arr(j.journal).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(str(x.date))).map((x) => ({ date: x.date, status: str(x.status) })),
    truncated: Number.isInteger(j.truncated) ? j.truncated : 0,
    routines: Array.isArray(j.routines) ? readRoutines(j.routines) : null, // 2026-10-30：定期提醒（電腦用看板規則算好的下次日期）；舊檔沒有這欄回 null
  };
}

// state.json 的「電腦最後推送」與「遠端開著」要有意義才用：generated_at 比現在晚超過 5 分鐘（時鐘不準）不採信
export function usableState(st, now = Date.now()) {
  if (!st) return null;
  if (st.generatedMs != null && st.generatedMs - now > 5 * 60000) return null;
  return st;
}
