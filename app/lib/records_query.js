// 紀錄中心的查詢、篩選、摘要（純函式）。items 都是「含樂觀疊加」的紀錄陣列（lib/records.js effectiveItems）。
import { ENUMS, labelOf, labelsOf, normName, ymd, statusInferred } from './records_schema.js';

export const live = (items) => items.filter((r) => !r.archived);
// 狀態是推算的（遷移器猜的）、還沒被使用者確認的筆數
export const inferredCount = (items) => live(items).filter(statusInferred).length;
export const archivedOf = (items) => items.filter((r) => r.archived);
const ts = (r) => Date.parse(r.updatedAt || '') || 0;
export const lastUpdated = (items) => items.reduce((m, r) => Math.max(m, ts(r)), 0);
const pad = (n) => String(n).padStart(2, '0');
export const mmddhhmm = (iso) => { const t = Date.parse(iso || ''); if (!t) return ''; const d = new Date(t); return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };

// ---------- 搜尋 ----------
export function searchHit(r, q) {
  const k = normName(q);
  if (!k) return true;
  const hay = [r.title, r.originalTitle, r.name, r.note, r.text, r.bodyPart, r.dropNote, ...(Array.isArray(r.aliases) ? r.aliases : []), ...(Array.isArray(r.exercises) ? r.exercises.map((e) => e && e.name) : [])].map(normName).join('|');
  return hay.includes(k);
}
const RECENT_DAYS = 30;
const recentOnly = (items, now) => items.filter((r) => now - ts(r) <= RECENT_DAYS * 86400000);

// ---------- 電影 ----------
export const movieIsWatched = (r) => r.status === 'watched' || r.status === 'rewatch';
export function movieSummary(items) {
  const a = live(items);
  const watched = a.filter(movieIsWatched);
  const lastWatched = [...watched].sort((x, y) => String(y.watchedDate || '').localeCompare(String(x.watchedDate || '')) || ts(y) - ts(x))[0] || null;
  return { total: a.length, want: a.filter((r) => r.status === 'want').length, watched: watched.length, unknown: a.filter((r) => r.status === 'unknown').length, last: lastWatched, updated: lastUpdated(a) };
}
// opts：{q, status('all'|enum), genres:[], quick:''|'recent'|'want', scope:'all'|'recent', sort:'updated'|'rating'|'date'|'title', archived:false}
export function filterMovies(items, o = {}, now = Date.now()) {
  let a = o.archived ? archivedOf(items) : live(items);
  if (o.q) a = a.filter((r) => searchHit(r, o.q));
  if (o.status && o.status !== 'all') a = a.filter((r) => r.status === o.status);
  if (o.genres && o.genres.length) a = a.filter((r) => o.genres.some((g) => (r.genres || []).includes(g)));
  if (o.inferred) a = a.filter(statusInferred);
  if (o.quick === 'want') a = a.filter((r) => r.status === 'want');
  if (o.quick === 'recent') a = a.filter(movieIsWatched).filter((r) => r.watchedDate).sort((x, y) => String(y.watchedDate).localeCompare(String(x.watchedDate))).slice(0, 20);
  if (o.scope === 'recent') a = recentOnly(a, now);
  return sortMovies(a, o.quick === 'recent' ? 'date' : o.sort || 'updated');
}
function sortMovies(a, sort) {
  const out = [...a];
  if (sort === 'rating') out.sort((x, y) => (y.rating == null ? -1 : y.rating) - (x.rating == null ? -1 : x.rating) || String(x.title).localeCompare(String(y.title), 'zh-Hant'));
  else if (sort === 'date') out.sort((x, y) => String(y.watchedDate || '').localeCompare(String(x.watchedDate || '')) || ts(y) - ts(x));
  else if (sort === 'title') out.sort((x, y) => String(x.title).localeCompare(String(y.title), 'zh-Hant'));
  else out.sort((x, y) => ts(y) - ts(x) || String(x.id).localeCompare(String(y.id)));
  return out;
}

// ---------- 動漫 ----------
const TIER_ORDER = ['hang', 'top', 'elite', 'npc', 'bottom', 'unrated'];
export const tierRank = (t) => { const i = TIER_ORDER.indexOf(t || 'unrated'); return i < 0 ? 5 : i; };
export function animeSummary(items) {
  const a = live(items);
  const last = [...a].sort((x, y) => ts(y) - ts(x))[0] || null;
  return { total: a.length, want: a.filter((r) => r.status === 'want').length, watching: a.filter((r) => r.status === 'watching').length, completed: a.filter((r) => r.status === 'completed').length, last, updated: lastUpdated(a) };
}
// opts：{q, status, genre, tier, mediaType('all'|enum), scope, sort:'updated'|'tier'|'score'|'title', archived}
export function filterAnime(items, o = {}, now = Date.now()) {
  let a = o.archived ? archivedOf(items) : live(items);
  if (o.q) a = a.filter((r) => searchHit(r, o.q));
  if (o.status && o.status !== 'all') a = a.filter((r) => r.status === o.status);
  if (o.genre && o.genre !== 'all') a = a.filter((r) => (r.genres || []).includes(o.genre));
  if (o.tier && o.tier !== 'all') a = a.filter((r) => (r.tier || 'unrated') === o.tier);
  if (o.mediaType && o.mediaType !== 'all') a = a.filter((r) => (r.mediaType || 'anime') === o.mediaType);
  if (o.inferred) a = a.filter(statusInferred);
  if (o.scope === 'recent') a = recentOnly(a, now);
  const out = [...a];
  const sort = o.sort || 'updated';
  if (sort === 'tier') out.sort((x, y) => tierRank(x.tier) - tierRank(y.tier) || String(x.title).localeCompare(String(y.title), 'zh-Hant'));
  else if (sort === 'score') out.sort((x, y) => (y.score == null ? -1 : y.score) - (x.score == null ? -1 : x.score));
  else if (sort === 'title') out.sort((x, y) => String(x.title).localeCompare(String(y.title), 'zh-Hant'));
  else out.sort((x, y) => ts(y) - ts(x) || String(x.id).localeCompare(String(y.id)));
  return out;
}
export function progressText(r) {
  const p = r.progress || {};
  const parts = [];
  if (p.season != null) parts.push('第' + p.season + '季');
  if (p.episode != null) parts.push((r.mediaType === 'manga' ? '第' : '第') + p.episode + (r.mediaType === 'manga' ? '話' : '集'));
  return parts.join(' ');
}
// 追番「+1 集」要送出的 patch／base（只動 progress.episode，不新增作品）
export function plusOneEpisode(r) {
  const prog = r.progress && typeof r.progress === 'object' ? r.progress : {};
  const next = { ...prog, episode: (Number.isFinite(prog.episode) ? prog.episode : 0) + 1 };
  const patch = { progress: next };
  if (r.status === 'want') patch.status = 'watching';
  const base = { progress: r.progress === undefined ? null : r.progress };
  if (patch.status) base.status = r.status;
  return { patch, base };
}

// ---------- 健身 ----------
export const sessionsDone = (items) => live(items).filter((s) => s.status === 'done' || s.status == null);
// 本週（週一～週日）完成的訓練次數；today＝Date
export function weekStart(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x; }
export function fitnessSummary(sessions, plans, today = new Date()) {
  const done = sessionsDone(sessions);
  const ws = ymd(weekStart(today));
  const we = ymd(new Date(weekStart(today).getTime() + 6 * 86400000 + 3600000));
  const week = done.filter((s) => s.date >= ws && s.date <= we).length;
  const last = [...done].sort((a, b) => String(b.date).localeCompare(String(a.date)) || ts(b) - ts(a))[0] || null;
  return { total: done.length, week, last, next: nextPlan(plans, today), inProgress: live(sessions).filter((s) => s.status === 'in_progress').length, updated: Math.max(lastUpdated(sessions)) };
}
// 下一個計畫：啟用中、每週固定的，從今天往後找最近的星期；單次計畫看日期。回傳 {plan, daysAhead} 或 null
export function nextPlan(plans, today = new Date()) {
  const act = live(plans).filter((p) => p.active !== false && (p.kind === 'weekly' || p.kind === 'once'));
  const wd = ((today.getDay() + 6) % 7) + 1;
  const t0 = ymd(today);
  let best = null;
  for (const p of act) {
    let ahead = null;
    if (p.kind === 'weekly' && p.weekday >= 1 && p.weekday <= 7) ahead = (p.weekday - wd + 7) % 7;
    else if (p.kind === 'once' && p.date && p.date >= t0) ahead = Math.round((Date.parse(p.date + 'T00:00:00Z') - Date.parse(t0 + 'T00:00:00Z')) / 86400000);
    if (ahead == null) continue;
    if (!best || ahead < best.daysAhead) best = { plan: p, daysAhead: ahead };
  }
  return best;
}
export function plansForToday(plans, today = new Date()) {
  const wd = ((today.getDay() + 6) % 7) + 1;
  const t0 = ymd(today);
  return live(plans).filter((p) => p.active !== false && ((p.kind === 'weekly' && p.weekday === wd) || (p.kind === 'once' && p.date === t0)));
}
const exName = (e) => normName(e && (e.name || e.rawName));
export function allExerciseNames(sessions, plans, catalog) {
  const seen = new Map();
  const add = (n) => { const k = normName(n); if (k && !seen.has(k)) seen.set(k, String(n).trim()); };
  for (const c of Array.isArray(catalog) ? catalog : []) if (c) add(c.name);
  for (const p of live(plans)) for (const e of p.exercises || []) add(e && e.name);
  for (const s of live(sessions)) for (const e of s.exercises || []) add(e && e.name);
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}
// opts：{q, exercise, from, to, archived, status}
export function filterSessions(items, o = {}) {
  let a = o.archived ? archivedOf(items) : live(items);
  if (o.exercise && o.exercise !== 'all') { const k = normName(o.exercise); a = a.filter((s) => (s.exercises || []).some((e) => exName(e) === k)); }
  if (o.from) a = a.filter((s) => s.date >= o.from);
  if (o.to) a = a.filter((s) => s.date <= o.to);
  if (o.q) a = a.filter((s) => searchHit(s, o.q));
  if (o.status && o.status !== 'all') a = a.filter((s) => s.status === o.status);
  return [...a].sort((x, y) => String(y.date).localeCompare(String(x.date)) || ts(y) - ts(x));
}
export function filterNotes(items, o = {}) {
  let a = o.archived ? archivedOf(items) : live(items);
  if (o.noteType && o.noteType !== 'all') a = a.filter((n) => n.noteType === o.noteType);
  if (o.q) a = a.filter((n) => searchHit(n, o.q));
  return [...a].sort((x, y) => String(y.date).localeCompare(String(x.date)) || ts(y) - ts(x));
}
export function filterPlans(items, o = {}) {
  let a = o.archived ? archivedOf(items) : live(items);
  if (o.q) a = a.filter((p) => searchHit(p, o.q));
  return [...a].sort((x, y) => (y.active === false ? 0 : 1) - (x.active === false ? 0 : 1) || (x.weekday || 9) - (y.weekday || 9) || String(x.name).localeCompare(String(y.name), 'zh-Hant'));
}

// 單手重量（perHandKg）有填就顯示「單手 10kg」，不然顯示總重 weightKg；左右各（perSide）顯示「左右各 12 下」
export const isHand = (s) => !!s && Number.isFinite(s.perHandKg);
export const weightText = (s) => (isHand(s) ? '單手 ' + s.perHandKg + 'kg' : !s || s.weightKg == null ? '' : s.weightKg + 'kg');
export function setText(s) {
  if (!s) return '';
  const tag = s.failure ? '力竭' : s.kind === 'warmup' ? '熱' : s.kind === 'drop' ? '退' : s.kind === 'target' ? '目標' : '';
  const w = weightText(s);
  const reps = s.reps == null ? '?' : s.reps;
  return (w ? w + '×' : '') + (s.perSide ? '左右各 ' + reps + ' 下' : String(reps)) + (tag ? '（' + tag + '）' : '');
}
export const exerciseText = (e) => ((e.sets || []).length ? e.sets.map(setText).join('、') : e.raw ? e.raw : '（沒有組數）');

// 同一個動作上一次（excludeId 以外、日期較早或同一天更早建立）的紀錄：回傳 {date, text, sets} 或 null
export function lastExercise(sessions, name, excludeId, beforeDate) {
  const k = normName(name);
  if (!k) return null;
  const cand = live(sessions).filter((s) => s.id !== excludeId && s.status !== 'planned' && (!beforeDate || s.date <= beforeDate)).sort((a, b) => String(b.date).localeCompare(String(a.date)) || ts(b) - ts(a));
  for (const s of cand) {
    const e = (s.exercises || []).find((x) => exName(x) === k && ((x.sets || []).length || x.raw));
    if (e) return { date: s.date, text: exerciseText(e), sets: e.sets || [], sessionId: s.id };
  }
  return null;
}
export function exerciseHistory(sessions, name) {
  const k = normName(name);
  return sessionsDone(sessions).filter((s) => (s.exercises || []).some((e) => exName(e) === k)).sort((a, b) => String(b.date).localeCompare(String(a.date))).map((s) => {
    const e = s.exercises.find((x) => exName(x) === k);
    return { date: s.date, sessionId: s.id, text: exerciseText(e), volume: volumeOf(e), top: topWeight(e) };
  });
}
export function topSetOf(sets) { return (sets || []).filter((s) => s.kind !== 'target').reduce((m, s) => (Number.isFinite(s.weightKg) && (!m || s.weightKg > m.weightKg) ? s : m), null); }
// 一次訓練裡「左右各」「單手重量」的組數（摘要用；不放進 sessionSummary，免得它的回傳格式變動）
export function sessionSetNotes(session) {
  let perSide = 0; let perHand = 0;
  for (const e of Array.isArray(session && session.exercises) ? session.exercises : []) for (const s of e.sets || []) { if (s.kind === 'target') continue; if (s.perSide) perSide++; if (isHand(s)) perHand++; }
  return { perSide, perHand };
}
export function volumeOf(e) { return (e.sets || []).filter((s) => s.kind !== 'target' && s.kind !== 'warmup').reduce((m, s) => m + (Number.isFinite(s.weightKg) && Number.isFinite(s.reps) ? s.weightKg * s.reps : 0), 0); }
export function topWeight(e) { return (e.sets || []).filter((s) => s.kind !== 'target').reduce((m, s) => Math.max(m, Number.isFinite(s.weightKg) ? s.weightKg : 0), 0); }
// 完成摘要：動作數、組數、總量、時長，以及跟上次同動作的差異
export function sessionSummary(session, sessions) {
  const ex = Array.isArray(session.exercises) ? session.exercises : [];
  const sets = ex.reduce((m, e) => m + (e.sets || []).filter((s) => s.kind !== 'target').length, 0);
  const volume = ex.reduce((m, e) => m + volumeOf(e), 0);
  const diffs = [];
  for (const e of ex) {
    const last = lastExercise(sessions, e.name, session.id, session.date);
    if (!last || !(e.sets || []).length) continue;
    // 兩次最高那組都有單手重量時，用單手重量比（顯示「單手 Xkg」）；否則比總重
    const curTop = topSetOf(e.sets);
    const prevTop = topSetOf(last.sets);
    const hand = isHand(curTop) && isHand(prevTop);
    const cur = hand ? curTop.perHandKg : topWeight(e);
    const prev = hand ? prevTop.perHandKg : prevTop && Number.isFinite(prevTop.weightKg) ? prevTop.weightKg : 0;
    if (cur || prev) diffs.push({ name: e.name, last: last.date, now: cur, before: prev, delta: Math.round((cur - prev) * 100) / 100, hand });
  }
  return { exercises: ex.length, sets, volume: Math.round(volume), durationMin: session.durationMin == null ? null : session.durationMin, diffs };
}

// ---------- 基礎統計卡片（P1） ----------
export function movieStats(items, today = new Date()) {
  const a = live(items).filter(movieIsWatched);
  const rated = a.filter((r) => Number.isFinite(r.rating));
  const yr = String(today.getFullYear());
  return { watchedTotal: a.length, watchedThisYear: a.filter((r) => String(r.watchedDate || '').startsWith(yr)).length, avgRating: rated.length ? Math.round((rated.reduce((m, r) => m + r.rating, 0) / rated.length) * 10) / 10 : null, ratedCount: rated.length };
}
export function animeStats(items) {
  const a = live(items);
  const byTier = {};
  for (const r of a) { const t = r.tier || 'unrated'; byTier[t] = (byTier[t] || 0) + 1; }
  return { byTier, dropped: a.filter((r) => r.status === 'dropped').length, waiting: a.filter((r) => r.status === 'waiting_sequel').length };
}
export function fitnessStats(sessions, today = new Date()) {
  const done = sessionsDone(sessions);
  const m = ymd(today).slice(0, 7);
  const thisMonth = done.filter((s) => String(s.date).startsWith(m));
  return { month: thisMonth.length, volumeMonth: Math.round(thisMonth.reduce((t, s) => t + (s.exercises || []).reduce((x, e) => x + volumeOf(e), 0), 0)) };
}

// ---------- 顯示用 ----------
export function movieLine(r) {
  const bits = [labelOf('movieStatus', r.status)];
  if (Number.isFinite(r.rating)) bits.push('⭐ ' + r.rating);
  if (r.watchedDate) bits.push(r.watchedDate);
  const g = labelsOf('movieGenres', r.genres);
  if (g.length) bits.push(g.slice(0, 2).join('／'));
  return bits.join('｜');
}
export function animeLine(r) {
  const bits = [labelOf('animeStatus', r.status)];
  if (r.mediaType === 'manga') bits.push('漫畫');
  const pt = progressText(r);
  if (pt) bits.push(pt);
  if (r.status === 'waiting_sequel' && r.sequel && Number.isFinite(r.sequel.season)) bits.push('等第' + r.sequel.season + '季');
  if (r.tier && r.tier !== 'unrated') bits.push(labelOf('tier', r.tier));
  if (Number.isFinite(r.score)) bits.push('⭐ ' + r.score);
  return bits.join('｜');
}
// ---------- P50c：緊湊清單列用的短摘要（標題下面一行小字） ----------
// 電影：狀態、年份（沒有就用看完日）、評分、類型；動漫：狀態、季集進度、梯度（漫畫、等續作、評分有才加）
export function movieMeta(r) {
  const bits = [labelOf('movieStatus', r.status)];
  if (Number.isFinite(r.year)) bits.push(String(r.year));
  else if (r.watchedDate) bits.push(r.watchedDate);
  if (Number.isFinite(r.rating)) bits.push('⭐ ' + r.rating);
  const g = labelsOf('movieGenres', r.genres);
  if (g.length) bits.push(g.slice(0, 2).join('／'));
  return bits.join(' · ');
}
export function animeMeta(r) {
  const bits = [labelOf('animeStatus', r.status)];
  if (r.mediaType === 'manga') bits.push('漫畫');
  const pt = progressText(r);
  if (pt) bits.push(pt);
  if (r.status === 'waiting_sequel' && r.sequel && Number.isFinite(r.sequel.season)) bits.push('等第' + r.sequel.season + '季');
  if (r.tier && r.tier !== 'unrated') bits.push(labelOf('tier', r.tier));
  if (Number.isFinite(r.score)) bits.push('⭐ ' + r.score);
  return bits.join(' · ');
}
// 清單上方那一行小字（電影／動漫／訓練）
export function movieSummaryText(items, today = new Date()) {
  const s = movieStats(items, today);
  return '已看 ' + s.watchedTotal + ' · 今年 ' + s.watchedThisYear + ' · 平均 ' + (s.avgRating == null ? '—' : s.avgRating);
}
export function animeSummaryText(items) {
  const s = animeStats(items);
  return '夯＋頂級 ' + ((s.byTier.hang || 0) + (s.byTier.top || 0)) + ' · 等續作 ' + s.waiting + ' · 棄追 ' + s.dropped;
}

// ---------- P50c：套用中的篩選（清單上方的 chip 列、篩選鈕上的數字） ----------
export const SORTS = {
  movie: [{ value: 'updated', label: '最近更新' }, { value: 'rating', label: '評分高→低' }, { value: 'date', label: '觀看日' }, { value: 'title', label: '片名' }],
  anime: [{ value: 'updated', label: '最近更新' }, { value: 'tier', label: '梯度' }, { value: 'score', label: '評分' }, { value: 'title', label: '名稱' }],
};
const optLabel = (list, v) => (list.find((o) => o.value === v) || {}).label || v;
// 回傳 [{ key, value?, label }]：每一項對應一個「不是預設值」的篩選條件；沒套用任何條件就是空陣列
export function activeFilters(type, st) {
  const a = [];
  if (type === 'movie' || type === 'anime') {
    const isMovie = type === 'movie';
    if (st.status && st.status !== 'all') a.push({ key: 'status', label: '狀態：' + labelOf(isMovie ? 'movieStatus' : 'animeStatus', st.status) });
    if (isMovie && st.quick) a.push({ key: 'quick', label: st.quick === 'recent' ? '最近看完' : '想看' });
    if (isMovie) for (const g of st.genres || []) a.push({ key: 'genres', value: g, label: '類型：' + labelOf('movieGenres', g) });
    if (!isMovie && st.tier && st.tier !== 'all') a.push({ key: 'tier', label: '梯度：' + labelOf('tier', st.tier) });
    if (!isMovie && st.genre && st.genre !== 'all') a.push({ key: 'genre', label: '類別：' + labelOf('animeGenres', st.genre) });
    if (!isMovie && st.mediaType && st.mediaType !== 'all') a.push({ key: 'mediaType', label: labelOf('mediaType', st.mediaType) });
    if (st.scope === 'recent') a.push({ key: 'scope', label: '最近 30 天' });
    if (st.sort && st.sort !== 'updated') a.push({ key: 'sort', label: '排序：' + optLabel(SORTS[type], st.sort) });
    if (st.inferred) a.push({ key: 'inferred', label: '待確認狀態' });
    if (st.archived) a.push({ key: 'archived', label: '封存區' });
  } else {
    // 健身三個子分頁各自只有自己的條件（別的子分頁留下的動作、日期不算）
    if (type === 'fitness-session') {
      if (st.exercise && st.exercise !== 'all') a.push({ key: 'exercise', label: '動作：' + st.exercise });
      if (st.from) a.push({ key: 'from', label: '從 ' + st.from });
      if (st.to) a.push({ key: 'to', label: '到 ' + st.to });
    }
    if (type === 'fitness-note' && st.noteType && st.noteType !== 'all') a.push({ key: 'noteType', label: '類型：' + labelOf('noteType', st.noteType) });
    if (st.archived) a.push({ key: 'archived', label: '封存區' });
  }
  return a;
}
// 取消一個篩選（改 st；shown 回到第一頁）
export function clearFilter(st, key, value) {
  const dflt = { status: 'all', quick: '', tier: 'all', genre: 'all', mediaType: 'all', scope: 'all', sort: 'updated', inferred: false, archived: false, exercise: 'all', from: '', to: '', noteType: 'all' };
  if (key === 'genres') st.genres = (st.genres || []).filter((g) => g !== value);
  else if (key in dflt) st[key] = dflt[key];
  st.shown = 60;
  return st;
}
export function clearAllFilters(type, st) {
  for (const a of activeFilters(type, st)) clearFilter(st, a.key, a.value);
  return st;
}

export function sessionLine(s) {
  const n = (s.exercises || []).length;
  const bits = [labelOf('sessionStatus', s.status || 'done')];
  bits.push(n + ' 個動作');
  if (s.durationMin != null) bits.push(s.durationMin + ' 分');
  return bits.join('｜');
}
export const planLine = (p) => [labelOf('planKind', p.kind), p.kind === 'weekly' && p.weekday ? labelOf('weekday', String(p.weekday)) : p.date || '', labelOf('trainingType', p.trainingType), p.active === false ? '已暫停' : '啟用中', (p.exercises || []).length + ' 個動作'].filter(Boolean).join('｜');
export const noteLine = (n) => [labelOf('noteType', n.noteType), n.noteType === 'pain' && n.bodyPart ? n.bodyPart : '', n.noteType === 'pain' && n.severity != null ? '程度 ' + n.severity : ''].filter(Boolean).join('｜');

export const ENUM_OPTIONS = (name) => ENUMS[name];

// ---------- 詳細頁的欄位（純函式，畫面和測試共用） ----------
export const sequelText = (r) => {
  const q = r && r.sequel && typeof r.sequel === 'object' ? r.sequel : null;
  if (!q) return '';
  return [Number.isFinite(q.season) ? '第 ' + q.season + ' 季' : '', q.expected ? '預計 ' + q.expected : '', q.note || ''].filter(Boolean).join('｜');
};
// 各季評分：[{label:'第 2 季', value:'8.5 / 10｜2026-09-10｜備註'}]，照季數排
export function seasonRows(r) {
  const a = Array.isArray(r && r.seasons) ? r.seasons.filter((x) => x && typeof x === 'object') : [];
  return [...a].sort((x, y) => (x.season == null ? 99 : x.season) - (y.season == null ? 99 : y.season)).map((x) => ({
    label: x.season == null ? '（季數沒填）' : '第 ' + x.season + ' 季',
    value: [Number.isFinite(x.score) ? x.score + ' / 10' : '未評分', Array.isArray(x.watchedDates) && x.watchedDates.length ? x.watchedDates.join('、') : '', x.note || ''].filter(Boolean).join('｜'),
  }));
}
const strList = (a) => (Array.isArray(a) ? a.filter((x) => x != null && x !== '').map(String).join('、') : '');
// 回傳 [[標籤, 值], ...]（空值的略過）
export function detailPairs(type, r) {
  const rows = [];
  const add = (l, v) => { if (v != null && v !== '') rows.push([l, String(v)]); };
  if (type === 'movie') {
    add('原文片名', r.originalTitle); add('別名', strList(r.aliases)); add('狀態', labelOf('movieStatus', r.status)); add('類型', labelsOf('movieGenres', r.genres).join('、'));
    add('評分', Number.isFinite(r.rating) ? r.rating + ' / 10' : ''); add('觀看日期', r.watchedDate); add('平台', labelOf('platform', r.platform));
    add('是否推薦', r.recommend === true ? '推薦' : r.recommend === false ? '不推薦' : ''); add('備註', r.note);
  } else if (type === 'anime') {
    add('別名', strList(r.aliases)); add('作品類型', labelOf('mediaType', r.mediaType)); add('狀態', labelOf('animeStatus', r.status));
    if (r.status === 'dropped') { add('棄追原因', labelOf('dropKind', r.dropKind)); add('棄追備註', r.dropNote); }
    add('類別', labelsOf('animeGenres', r.genres).join('、')); add('進度', progressText(r)); add('續作', sequelText(r)); add('個人梯度', labelOf('tier', r.tier || 'unrated'));
    add('數字評分', Number.isFinite(r.score) ? r.score + ' / 10' : '');
    for (const x of seasonRows(r)) add(x.label + '評分', x.value);
    add('觀看日', strList(r.watchedDates)); add('開始日期', r.startDate); add('完成日期', r.finishedDate); add('備註', r.note);
  } else if (type === 'fitness-plan') {
    add('種類', labelOf('planKind', r.kind)); add('星期', r.kind === 'weekly' ? labelOf('weekday', String(r.weekday)) : ''); add('日期', r.date); add('訓練類型', labelOf('trainingType', r.trainingType));
    add('狀態', r.active === false ? '已暫停' : '啟用中'); add('備註', r.note);
  } else if (type === 'fitness-note') {
    add('日期', r.date); add('類型', labelOf('noteType', r.noteType));
    if (r.noteType === 'pain') { add('部位', r.bodyPart); add('程度', r.severity); add('訓練時注意', r.caution ? '是' : ''); }
    const m = r.metrics || {};
    const lab = { weightKg: '體重 kg', skeletalMuscleKg: '骨骼肌 kg', bodyFatPct: '體脂率 %', bodyFatKg: '體脂肪 kg', visceralLevel: '內臟脂肪', bmrKcal: '基礎代謝', score: 'InBody 分數' };
    for (const k of Object.keys(lab)) add(lab[k], m[k]);
    add('內容', r.text);
  } else if (type === 'fitness-session') {
    add('日期', r.date); add('狀態', labelOf('sessionStatus', r.status || 'done')); add('類型', labelsOf('trainingType', r.trainingTypes).join('、')); add('時長', r.durationMin != null ? r.durationMin + ' 分鐘' : ''); add('備註', r.note);
  }
  return rows;
}
// 動畫↔漫畫等關聯：items 是同一個檔的紀錄，回傳 [{id, title, found}]
export function relatedOf(r, items) {
  return (Array.isArray(r && r.relatedIds) ? r.relatedIds : []).map((id) => { const o = (items || []).find((x) => x.id === id); return { id, title: o ? o.title || '（沒有名稱）' : '', mediaType: o ? o.mediaType : null, found: !!o }; });
}
// 訓練詳細頁每個動作的一行：[{name, text, old}]
export function exerciseLines(r) {
  return (Array.isArray(r && r.exercises) ? r.exercises : []).map((e) => ({ name: (e && e.name) || '（沒有名稱）', text: e ? exerciseText(e) : '', old: !!(e && e.parse && (e.parse.status === 'partial' || e.parse.status === 'unparsed')) }));
}
// 一筆紀錄「畫面上會有什麼」的描述：卡片行、欄位、推算標記、關聯、（訓練）動作。不碰 DOM，測試和真實副本載入檢查都用它
export function describeRecord(type, r, items) {
  const line = type === 'movie' ? movieLine(r) : type === 'anime' ? animeLine(r) : type === 'fitness-session' ? sessionLine(r) : type === 'fitness-plan' ? planLine(r) : noteLine(r);
  return { line, pairs: detailPairs(type, r), inferred: statusInferred(r), related: type === 'anime' ? relatedOf(r, items) : [], exercises: type === 'fitness-session' ? exerciseLines(r) : [], notes: type === 'fitness-session' ? sessionSetNotes(r) : null };
}
