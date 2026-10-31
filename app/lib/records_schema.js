// 紀錄中心（v5 M3）的資料型別、enum、表單欄位定義。純資料＋純函式，不碰 DOM、不碰儲存空間。
// 內部 enum 只用英文小寫加底線；中文顯示名稱放這裡（跟電腦端 records_migrate.py 的 enum 對得起來，test/v5m3.test.js 有檢查）。
// 這個檔不含任何私人資料。
export const SCHEMA_VERSION = 1;

export const TYPES = ['movie', 'anime', 'fitness-session', 'fitness-plan', 'fitness-note'];
export const TYPE_INFO = {
  movie: { file: 'records/movies.json', prefix: 'mv', label: '電影', schema: 'records.movies' },
  anime: { file: 'records/anime.json', prefix: 'an', label: '動漫', schema: 'records.anime' },
  'fitness-session': { file: 'records/fitness-sessions.json', prefix: 'fs', label: '健身訓練', schema: 'records.fitness-sessions' },
  'fitness-plan': { file: 'records/fitness-plans.json', prefix: 'fp', label: '健身計畫', schema: 'records.fitness-plans' },
  'fitness-note': { file: 'records/fitness-notes.json', prefix: 'fn', label: '健身雜記', schema: 'records.fitness-notes' },
};
export const typeOfFile = (file) => TYPES.find((t) => TYPE_INFO[t].file === file) || null;
export const DATA_FILES = TYPES.map((t) => TYPE_INFO[t].file);

const E = (pairs) => pairs.map(([value, label]) => ({ value, label }));
export const ENUMS = {
  movieStatus: E([['want', '想看'], ['watched', '已看'], ['watching', '看到一半'], ['dropped', '棄看'], ['rewatch', '重看'], ['unknown', '未確認']]),
  movieGenres: E([['action', '動作'], ['mind_bending', '燒腦'], ['gore_thriller', '血腥驚悚'], ['scifi', '科幻'], ['suspense_thriller', '懸疑驚悚'], ['horror', '恐怖'], ['comedy', '喜劇'], ['animation', '動畫'], ['superhero', '超級英雄'], ['other', '其他']]),
  platform: E([['netflix', 'Netflix'], ['cinema', '電影院'], ['bilibili', 'Bilibili'], ['disney', 'Disney+'], ['other', '其他']]),
  animeStatus: E([['want', '想看'], ['watching', '追番中'], ['completed', '已看完'], ['dropped', '棄追'], ['waiting_sequel', '等待續作'], ['unknown', '未確認']]),
  dropKind: E([['disliked', '看過，不合胃口'], ['sampled', '只看了幾集']]),
  tier: E([['hang', '夯'], ['top', '頂級'], ['elite', '人上人'], ['npc', 'NPC'], ['bottom', '拉完了'], ['unrated', '未評分']]),
  animeGenres: E([['grotesque', '獵奇'], ['hot_blooded', '熱血'], ['school', '校園'], ['romance', '戀愛'], ['other', '其他']]),
  mediaType: E([['anime', '動畫'], ['manga', '漫畫']]),
  trainingType: E([['rest', '休息'], ['badminton', '羽球'], ['chest_shoulder', '胸肩'], ['chest', '胸'], ['back', '背'], ['legs', '腿'], ['arms', '手臂'], ['core', '核心'], ['cardio', '有氧'], ['other', '其他']]),
  sessionStatus: E([['planned', '計畫中'], ['in_progress', '進行中'], ['done', '已完成']]),
  setKind: E([['warmup', '熱身'], ['working', '正式'], ['top', '極限'], ['drop', '退階'], ['target', '目標']]),
  noteType: E([['weight', '體重'], ['inbody', 'InBody'], ['pain', '疼痛／傷勢'], ['gear', '裝備'], ['reflection', '訓練心得'], ['other', '其他']]),
  planKind: E([['weekly', '每週固定'], ['once', '單次'], ['template', '彈性範本'], ['addon', '附加（如核心）']]),
  weekday: E([['1', '週一'], ['2', '週二'], ['3', '週三'], ['4', '週四'], ['5', '週五'], ['6', '週六'], ['7', '週日']]),
  recommend: E([['', '未標'], ['yes', '推薦'], ['no', '不推薦']]),
};
// 組別的「模式」：畫面上四個鍵（熱身／正式／退階／力竭），存成 kind＋failure
export const SET_MODES = E([['working', '正式'], ['warmup', '熱身'], ['drop', '退階'], ['failure', '力竭']]);
export function setMode(set) {
  if (!set) return 'working';
  if (set.failure) return 'failure';
  return set.kind === 'warmup' || set.kind === 'drop' ? set.kind : 'working';
}
export function applyMode(set, mode) {
  const s = { ...set };
  if (mode === 'failure') { s.kind = 'working'; s.failure = true; } else { s.kind = mode; s.failure = false; }
  return s;
}

export const labelOf = (enumName, value) => {
  const hit = (ENUMS[enumName] || []).find((o) => o.value === value);
  return hit ? hit.label : value == null || value === '' ? '' : String(value);
};
export const labelsOf = (enumName, values) => (Array.isArray(values) ? values : []).map((v) => labelOf(enumName, v)).filter(Boolean);

// ---------- 表單欄位 ----------
// 動漫的續作欄位：等待續作時顯示；其他狀態下只在已經有內容時顯示（不然表單太長）
function hasSequelFields(v) { return v.status === 'waiting_sequel' || !!(String(v.sequelSeason || '') + String(v.sequelExpected || '') + String(v.sequelNote || '')).trim(); }

// kind：text｜textarea｜number｜date｜chips（單選，一排鍵）｜select｜multi（複選鍵）｜bool｜exercises（健身專用編輯器）｜seasons（動漫各季評分編輯器，值是 JSON 文字）
// when(values)：回傳 false 就不顯示這個欄位
export const FIELDS = {
  movie: [
    { key: 'title', label: '片名', kind: 'text', required: true, placeholder: '例如：範例電影' },
    { key: 'originalTitle', label: '原文片名', kind: 'text', placeholder: '選填' },
    { key: 'status', label: '觀看狀態', kind: 'chips', enum: 'movieStatus', default: 'want', required: true, affects: true },
    { key: 'genres', label: '類型（可複選）', kind: 'multi', enum: 'movieGenres' },
    { key: 'rating', label: '評分（0～10，可 .5）', kind: 'number', min: 0, max: 10, step: 0.5, placeholder: '看完再填也可以' },
    { key: 'watchedDate', label: '觀看日期', kind: 'date' },
    { key: 'platform', label: '觀看平台', kind: 'select', enum: 'platform', blank: '（不填）' },
    { key: 'recommend', label: '是否推薦', kind: 'select', enum: 'recommend' },
    { key: 'note', label: '備註', kind: 'textarea' },
  ],
  anime: [
    { key: 'title', label: '作品名稱', kind: 'text', required: true, placeholder: '例如：範例動畫' },
    { key: 'mediaType', label: '作品類型', kind: 'chips', enum: 'mediaType', default: 'anime', required: true },
    { key: 'status', label: '觀看狀態', kind: 'chips', enum: 'animeStatus', default: 'want', required: true, affects: true },
    { key: 'dropKind', label: '棄追的原因', kind: 'chips', enum: 'dropKind', when: (v) => v.status === 'dropped' },
    { key: 'dropNote', label: '棄追備註（看到第幾集、原因）', kind: 'text', when: (v) => v.status === 'dropped' },
    { key: 'genres', label: '類別（可複選）', kind: 'multi', enum: 'animeGenres' },
    { key: 'season', label: (v) => (v.status === 'waiting_sequel' ? '目前看完的季度' : '目前季數'), kind: 'number', min: 0, step: 1, integer: true, placeholder: '選填', when: (v) => v.mediaType !== 'manga' },
    { key: 'episode', label: (v) => (v.mediaType === 'manga' ? '目前話數' : '目前集數'), kind: 'number', min: 0, step: 1, integer: true, placeholder: '選填' },
    { key: 'sequelSeason', label: '等待的續作：第幾季', kind: 'number', min: 1, step: 1, integer: true, placeholder: '例如 3', when: hasSequelFields },
    { key: 'sequelExpected', label: '續作預計時間', kind: 'text', placeholder: '例如 2027-04', when: hasSequelFields },
    { key: 'sequelNote', label: '續作備註', kind: 'text', when: hasSequelFields },
    { key: 'tier', label: '個人梯度', kind: 'chips', enum: 'tier', default: 'unrated' },
    { key: 'score', label: '數字評分（0～10，跟梯度分開）', kind: 'number', min: 0, max: 10, step: 0.5, placeholder: '選填' },
    { key: 'seasons', label: '各季評分', kind: 'seasons', when: (v) => v.mediaType !== 'manga' },
    { key: 'startDate', label: '開始日期', kind: 'date' },
    { key: 'finishedDate', label: '完成日期', kind: 'date' },
    { key: 'note', label: '備註', kind: 'textarea' },
  ],
  'fitness-note': [
    { key: 'noteType', label: '雜記類型', kind: 'chips', enum: 'noteType', default: 'reflection', required: true, affects: true },
    { key: 'date', label: '日期', kind: 'date', required: true, default: '@today' },
    { key: 'weightKg', label: '體重（kg）', kind: 'number', min: 0, step: 0.1, when: (v) => v.noteType === 'weight' || v.noteType === 'inbody' },
    { key: 'skeletalMuscleKg', label: '骨骼肌（kg）', kind: 'number', min: 0, step: 0.1, when: (v) => v.noteType === 'inbody' },
    { key: 'bodyFatPct', label: '體脂率（%）', kind: 'number', min: 0, max: 100, step: 0.1, when: (v) => v.noteType === 'inbody' },
    { key: 'bodyFatKg', label: '體脂肪（kg）', kind: 'number', min: 0, step: 0.1, when: (v) => v.noteType === 'inbody' },
    { key: 'visceralLevel', label: '內臟脂肪等級', kind: 'number', min: 0, step: 1, when: (v) => v.noteType === 'inbody' },
    { key: 'bmrKcal', label: '基礎代謝（kcal）', kind: 'number', min: 0, step: 1, when: (v) => v.noteType === 'inbody' },
    { key: 'bodyPart', label: '部位', kind: 'text', placeholder: '例如：左膝', required: true, when: (v) => v.noteType === 'pain' },
    { key: 'severity', label: '程度（1～10）', kind: 'number', min: 1, max: 10, step: 1, integer: true, when: (v) => v.noteType === 'pain' },
    { key: 'caution', label: '訓練時要特別注意', kind: 'bool', when: (v) => v.noteType === 'pain' },
    { key: 'text', label: '內容', kind: 'textarea' },
  ],
  'fitness-plan': [
    { key: 'name', label: '計畫名稱', kind: 'text', required: true, placeholder: '例如：週三上肢' },
    { key: 'kind', label: '計畫種類', kind: 'chips', enum: 'planKind', default: 'weekly', required: true, affects: true },
    { key: 'weekday', label: '星期', kind: 'chips', enum: 'weekday', default: '1', when: (v) => v.kind === 'weekly' },
    { key: 'date', label: '指定日期', kind: 'date', required: true, default: '@today', when: (v) => v.kind === 'once' },
    { key: 'trainingType', label: '訓練類型', kind: 'select', enum: 'trainingType', default: 'chest' },
    { key: 'exercises', label: '動作清單', kind: 'exercises', plan: true },
    { key: 'active', label: '啟用中（關掉等於暫停，歷史紀錄不受影響）', kind: 'bool', default: '1' },
    { key: 'note', label: '備註', kind: 'textarea' },
  ],
  'fitness-session': [
    { key: 'date', label: '日期', kind: 'date', required: true, default: '@today' },
    { key: 'trainingTypes', label: '訓練類型（可複選）', kind: 'multi', enum: 'trainingType' },
    { key: 'exercises', label: '動作', kind: 'exercises' },
    { key: 'durationMin', label: '總時長（分鐘）', kind: 'number', min: 0, step: 1, integer: true },
    { key: 'note', label: '備註', kind: 'textarea' },
  ],
};

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const fieldLabel = (f, values) => (typeof f.label === 'function' ? f.label(values) : f.label);
export const visibleFields = (type, values) => FIELDS[type].filter((f) => !f.when || f.when(values));

// ---------- 值 ←→ 草稿字串 ----------
// 表單的值一律是字串（草稿也是字串）：multi 用「,」接起來、bool 用 '1'／'0'、exercises 用 JSON 文字
export const splitMulti = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

function numStr(v) { return v == null || v === '' ? '' : String(v); }

// 從紀錄取出表單初始值（編輯用）
export function toForm(type, rec) {
  const r = rec || {};
  const v = {};
  const m = r.metrics || {};
  const prog = r.progress || {};
  const sq = r.sequel && typeof r.sequel === 'object' ? r.sequel : {};
  switch (type) {
    case 'movie':
      Object.assign(v, { title: r.title || '', originalTitle: r.originalTitle || '', status: r.status || 'want', genres: (r.genres || []).join(','), rating: numStr(r.rating), watchedDate: r.watchedDate || '', platform: r.platform || '', recommend: r.recommend === true ? 'yes' : r.recommend === false ? 'no' : '', note: r.note || '' });
      break;
    case 'anime':
      Object.assign(v, { title: r.title || '', mediaType: r.mediaType || 'anime', status: r.status || 'want', dropKind: r.dropKind || '', dropNote: r.dropNote || '', genres: (r.genres || []).join(','), season: numStr(prog.season), episode: numStr(prog.episode),
        sequelSeason: numStr(sq.season), sequelExpected: sq.expected == null ? '' : String(sq.expected), sequelNote: sq.note == null ? '' : String(sq.note), seasons: JSON.stringify(Array.isArray(r.seasons) ? r.seasons : []), tier: r.tier || 'unrated', score: numStr(r.score), startDate: r.startDate || '', finishedDate: r.finishedDate || '', note: r.note || '' });
      break;
    case 'fitness-note':
      Object.assign(v, { noteType: r.noteType || 'reflection', date: r.date || '', weightKg: numStr(m.weightKg), skeletalMuscleKg: numStr(m.skeletalMuscleKg), bodyFatPct: numStr(m.bodyFatPct), bodyFatKg: numStr(m.bodyFatKg), visceralLevel: numStr(m.visceralLevel), bmrKcal: numStr(m.bmrKcal), bodyPart: r.bodyPart || '', severity: numStr(r.severity), caution: r.caution ? '1' : '0', text: r.text || '' });
      break;
    case 'fitness-plan':
      Object.assign(v, { name: r.name || '', kind: r.kind || 'weekly', weekday: r.weekday ? String(r.weekday) : '1', date: r.date || '', trainingType: r.trainingType || 'other', exercises: JSON.stringify(Array.isArray(r.exercises) ? r.exercises : []), active: r.active === false ? '0' : '1', note: r.note || '' });
      break;
    case 'fitness-session':
      Object.assign(v, { date: r.date || '', trainingTypes: (r.trainingTypes || []).join(','), exercises: JSON.stringify(Array.isArray(r.exercises) ? r.exercises : []), durationMin: numStr(r.durationMin), note: r.note || '' });
      break;
    default: break;
  }
  return v;
}

// 新增用的預設值（today＝'YYYY-MM-DD'）
export function defaults(type, today) {
  const v = {};
  for (const f of FIELDS[type]) {
    let d = f.default;
    if (d === '@today') d = today || '';
    if (d == null) d = f.kind === 'exercises' || f.kind === 'seasons' ? '[]' : f.kind === 'bool' ? '0' : '';
    v[f.key] = d;
  }
  return v;
}

// ---------- 檢查 ----------
export const parseNum = (s) => {
  const t = String(s == null ? '' : s).trim();
  if (t === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return NaN;
  return Number(t);
};
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));

// 各季評分的檢查：回傳錯誤訊息，沒問題回傳 ''
function seasonsError(s) {
  let a;
  try { a = JSON.parse(s); } catch (e) { return '各季評分格式不對'; }
  if (!Array.isArray(a)) return '各季評分格式不對';
  for (const x of a) {
    if (!x || typeof x !== 'object') return '各季評分格式不對';
    if (x.season != null && !(Number.isInteger(x.season) && x.season >= 1)) return '季數請填 1 以上的整數';
    if (x.score != null && !(Number.isFinite(x.score) && x.score >= 0 && x.score <= 10 && Math.abs(x.score * 2 - Math.round(x.score * 2)) < 1e-9)) return '各季評分要在 0～10，以 0.5 為單位';
  }
  return '';
}

// 回傳 {errors:{key:訊息}, warnings:[訊息]}。warnings 不擋儲存
export function validate(type, values) {
  const errors = {};
  const warnings = [];
  for (const f of visibleFields(type, values)) {
    const raw = values[f.key];
    const s = String(raw == null ? '' : raw).trim();
    if (f.required && s === '') { errors[f.key] = '這一格要填'; continue; }
    if (s === '') continue;
    if (f.kind === 'number') {
      const n = parseNum(s);
      if (Number.isNaN(n)) errors[f.key] = '請填數字';
      else if (f.integer && !Number.isInteger(n)) errors[f.key] = '請填整數';
      else if (f.min != null && n < f.min) errors[f.key] = '不能小於 ' + f.min;
      else if (f.max != null && n > f.max) errors[f.key] = '不能大於 ' + f.max;
      else if (f.step === 0.5 && Math.abs(n * 2 - Math.round(n * 2)) > 1e-9) errors[f.key] = '以 0.5 為單位';
    } else if (f.kind === 'date' && !isDate(s)) errors[f.key] = '日期格式不對';
    else if ((f.kind === 'chips' || f.kind === 'select') && f.enum && !ENUMS[f.enum].some((o) => o.value === s)) errors[f.key] = '請選一個選項';
    else if (f.kind === 'multi' && f.enum) {
      const bad = splitMulti(s).filter((x) => !ENUMS[f.enum].some((o) => o.value === x));
      if (bad.length) errors[f.key] = '有不認得的選項';
    } else if (f.kind === 'exercises') {
      try { const a = JSON.parse(s); if (!Array.isArray(a)) errors[f.key] = '動作清單格式不對'; } catch (e) { errors[f.key] = '動作清單格式不對'; }
    } else if (f.kind === 'seasons') {
      const msg = seasonsError(s);
      if (msg) errors[f.key] = msg;
    }
  }
  if (type === 'movie' && values.status === 'watched') {
    const miss = [];
    if (!String(values.watchedDate || '').trim()) miss.push('觀看日期');
    if (!String(values.rating || '').trim()) miss.push('評分');
    if (miss.length) warnings.push('已看：還沒填' + miss.join('、') + '（可以先不填）');
  }
  if (type === 'anime' && values.status === 'completed') {
    const miss = [];
    if (!String(values.score || '').trim() && (!values.tier || values.tier === 'unrated')) miss.push('評分或梯度');
    if (!String(values.finishedDate || '').trim()) miss.push('完成日期');
    if (miss.length) warnings.push('已看完：還沒填' + miss.join('、') + '（可以先不填）');
  }
  return { errors, warnings };
}

// ---------- 表單值 → 紀錄欄位 ----------
const strOrNull = (s) => { const t = String(s == null ? '' : s).trim(); return t === '' ? null : t; };
const numOrNull = (s) => { const n = parseNum(s); return n == null || Number.isNaN(n) ? null : n; };

// 續作：保留 sequel 裡表單沒有的鍵；全部清空且原本就是空的（null 或全空物件）→ 原樣不動，這樣「什麼都不改」不會產生 patch
const isEmptySeq = (x) => !x || (typeof x === 'object' && [x.season, x.expected, x.note].every((y) => y == null || y === ''));
function sequelFrom(v, b) {
  const bs = b.sequel && typeof b.sequel === 'object' ? b.sequel : null;
  const season = numOrNull(v.sequelSeason);
  const expected = strOrNull(v.sequelExpected);
  const note = String(v.sequelNote == null ? '' : v.sequelNote).trim();
  if (season == null && expected == null && note === '') return isEmptySeq(bs) ? (b.sequel === undefined ? null : b.sequel) : null;
  const keep = (nv, bv) => ((nv == null || nv === '') && (bv == null || bv === '') ? (bv === undefined ? nv : bv) : nv);
  return { ...(bs || {}), season, expected: keep(expected, bs ? bs.expected : undefined), note: keep(note, bs ? bs.note : undefined) };
}
function seasonsFrom(v, b) {
  try {
    const a = JSON.parse(v.seasons || '[]');
    if (!Array.isArray(a)) return b.seasons || [];
    return a.length === 0 && 'id' in b && b.seasons == null ? null : a; // 既有紀錄本來就沒有 seasons、表單也沒填 → 不產生差異
  } catch (e) { return b.seasons || []; }
}

// ---------- 狀態是推算的（遷移器從清單位置猜的狀態） ----------
export const statusInferred = (r) => !!(r && r.migration && typeof r.migration === 'object' && r.migration.statusInferred === true);
// 使用者改了狀態：同一個 op 把 migration.statusInferred 清成 false（patch 是整個 migration 物件，其他鍵原樣留著）。會就地改 patch／base 並回傳
export function clearInferred(type, rec, patch, base) {
  if ((type === 'movie' || type === 'anime') && statusInferred(rec) && patch && 'status' in patch && !('migration' in patch)) {
    patch.migration = { ...rec.migration, statusInferred: false };
    base.migration = rec.migration;
  }
  return { patch, base };
}
// 按「確認」：狀態不動，只把推算標記清掉
export function confirmStatusOp(rec) {
  return { patch: { migration: { ...(rec.migration || {}), statusInferred: false } }, base: { migration: rec.migration === undefined ? null : rec.migration } };
}

// 回傳「這個表單負責的頂層欄位」：{欄位: 值}。baseRec 用來保留巢狀物件裡表單沒有的欄位（progress、metrics 的未知鍵）
export function fromForm(type, values, baseRec) {
  const v = values;
  const b = baseRec || {};
  switch (type) {
    case 'movie':
      return {
        title: String(v.title || '').trim(), originalTitle: strOrNull(v.originalTitle), status: v.status || 'want', genres: splitMulti(v.genres),
        rating: numOrNull(v.rating), watchedDate: strOrNull(v.watchedDate), platform: strOrNull(v.platform),
        recommend: v.recommend === 'yes' ? true : v.recommend === 'no' ? false : null, note: String(v.note || '').trim(),
      };
    case 'anime': {
      const out = {
        title: String(v.title || '').trim(), mediaType: v.mediaType || 'anime', status: v.status || 'want', genres: splitMulti(v.genres),
        dropKind: v.status === 'dropped' ? strOrNull(v.dropKind) : null, dropNote: v.status === 'dropped' ? String(v.dropNote || '').trim() : '',
        progress: { ...(b.progress || {}), season: numOrNull(v.season), episode: numOrNull(v.episode) },
        sequel: sequelFrom(v, b), seasons: seasonsFrom(v, b),
        tier: v.tier || 'unrated', score: numOrNull(v.score), startDate: strOrNull(v.startDate), finishedDate: strOrNull(v.finishedDate), note: String(v.note || '').trim(),
      };
      if (v.mediaType === 'manga') out.progress.season = (b.progress && b.progress.season) || null;
      return out;
    }
    case 'fitness-note': {
      const t = v.noteType || 'reflection';
      const out = { noteType: t, date: String(v.date || '').trim(), text: String(v.text || '').trim() };
      if (t === 'weight' || t === 'inbody') {
        const m = { ...(b.metrics || {}) };
        const keys = t === 'weight' ? ['weightKg'] : ['weightKg', 'skeletalMuscleKg', 'bodyFatPct', 'bodyFatKg', 'visceralLevel', 'bmrKcal'];
        for (const k of keys) { const n = numOrNull(v[k]); if (n != null || k in m) m[k] = n; }
        out.metrics = m;
      }
      if (t === 'pain') { out.bodyPart = strOrNull(v.bodyPart); out.severity = numOrNull(v.severity); out.caution = v.caution === '1'; }
      return out;
    }
    case 'fitness-plan': {
      let ex = [];
      try { ex = JSON.parse(v.exercises || '[]'); } catch (e) { ex = b.exercises || []; }
      return {
        name: String(v.name || '').trim(), kind: v.kind || 'weekly', weekday: v.kind === 'weekly' ? Number(v.weekday) || 1 : null, date: v.kind === 'once' ? strOrNull(v.date) : null,
        trainingType: v.trainingType || 'other', exercises: ex, active: v.active !== '0', note: String(v.note || '').trim(),
      };
    }
    case 'fitness-session': {
      let ex = [];
      try { ex = JSON.parse(v.exercises || '[]'); } catch (e) { ex = b.exercises || []; }
      return { date: String(v.date || '').trim(), trainingTypes: splitMulti(v.trainingTypes), exercises: ex, durationMin: numOrNull(v.durationMin), note: String(v.note || '').trim() };
    }
    default: return {};
  }
}

// 新紀錄的完整骨架（共用欄位＋各型別預設）。typed＝fromForm 的結果
export function buildRecord(type, id, typed, nowIso) {
  const base = { id, type, createdAt: nowIso, updatedAt: nowIso, source: 'pwa', archived: false, archivedAt: null, version: 1, lastOpId: null, legacy: [], migration: null };
  const extra = {
    movie: { aliases: [], lists: [], ratingScale: 10, watchedDateRaw: null, watchedDateYearInferred: false, year: null },
    anime: { aliases: [], genres: [], sequel: null, seasons: [], watchedDates: [], relatedIds: [], hasAnimeAdaptation: null, scoreScale: 10 },
    'fitness-session': { status: 'done', startTime: null, fromPlanId: null, categoryRaw: null },
    'fitness-plan': { weekday: null, date: null, effectiveFrom: null, effectiveTo: null },
    'fitness-note': { dateTo: null, metrics: null, bodyPart: null, severity: null, caution: false },
  }[type] || {};
  return { ...base, ...extra, ...typed };
}

// 比對「表單值」跟既有紀錄，算出要送出的 patch／base（只含有差異的頂層欄位）
export function diffForm(type, values, rec) {
  const typed = fromForm(type, values, rec);
  const patch = {};
  const base = {};
  for (const k of Object.keys(typed)) {
    if (!sameJSON(typed[k], rec[k] === undefined ? null : rec[k])) { patch[k] = typed[k]; base[k] = rec[k] === undefined ? null : rec[k]; }
  }
  clearInferred(type, rec, patch, base);
  return { patch, base };
}
export function sameJSON(a, b) {
  const na = a === undefined ? null : a;
  const nb = b === undefined ? null : b;
  return JSON.stringify(sortKeys(na)) === JSON.stringify(sortKeys(nb));
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]); return o; }
  return v;
}

// 顯示用標題
export function titleOf(type, rec) {
  const r = rec || {};
  switch (type) {
    case 'movie': case 'anime': return r.title || '（沒有名稱）';
    case 'fitness-plan': return r.name || '（沒有名稱）';
    case 'fitness-session': return (r.date || '') + ' ' + (labelsOf('trainingType', r.trainingTypes).join('、') || '訓練');
    case 'fitness-note': return (r.date || '') + ' ' + labelOf('noteType', r.noteType);
    default: return r.id || '';
  }
}

// 正規化（比對重複用）：NFKC、小寫、去掉空白與標點
export const normName = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s　.,，。、:：;；!！?？'"“”‘’「」『』《》()（）\[\]【】\-_~～·・]+/g, '');
