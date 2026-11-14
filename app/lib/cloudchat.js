// P74：串流留記憶體，完成的雲端快答跟對話一起快取，經 hubThreads 轉成畫面模型。
import { hubThreads } from './hub.js';
import { ID_RE } from './cloudsource.js';
import { isMaskedWork } from './p72.js';

export async function streamQuickAnswer(cloud, text, id, { onChange = () => {}, signal, throwOnError = false } = {}) {
  const row = { id, text, at: new Date().toISOString(), answer: '', status: 'streaming', source: 'cloud' };
  const changed = () => onChange({ ...row });
  changed();
  try {
    const r = await cloud.ask(text, id, { signal, onEvent(ev) {
      if (ev.event === 'delta' && typeof ev.data?.t === 'string') row.answer += ev.data.t;
      if (ev.event === 'queued') { row.status = 'queued'; row.answer = ''; }
      if (ev.event === 'error') row.status = 'error';
      changed();
    } });
    if (r.text && !r.queued) row.answer = r.text;
    if (r.queued) row.answer = '';
    row.status = r.queued ? 'queued' : r.error ? 'error' : r.laptopDone ? 'laptop' : 'done';
    if (r.error && throwOnError) throw new Error('cloud_quick_failed');
  } catch (e) { row.status = 'error'; if (throwOnError) throw e; }
  changed();
  return row;
}
export const quickStatusText = (s) => s === 'queued' ? '雲端答不了，已轉給電腦' : s === 'error' ? '快答中斷，請重試或交給嘿嘿' : s === 'streaming' ? '雲端快答中…' : s === 'laptop' ? '電腦已回覆，正在取得回覆' : '';

export function addCloudReplies(store, replies) {
  for (const r of replies || []) {
    if (!ID_RE.test(String(r.id)) || !['cloud', 'laptop'].includes(r.source) || typeof r.text !== 'string' || !Number.isFinite(Date.parse(r.at)) || !Number.isSafeInteger(r.seq)) continue;
    const prev = store.get(r.id);
    const parts = prev ? [...(prev.parts || [prev])] : [];
    if (parts.some((p) => p.seq === r.seq)) continue;
    parts.push({ ...r });
    parts.sort((a, b) => a.seq - b.seq);
    // Map 仍按留言編號索引；頂層保留最新欄位，parts 保存同留言的每段回覆。
    store.set(r.id, { ...parts[parts.length - 1], parts });
  }
}

// 只投影答案與對話資訊，不保存 relay 金鑰、來源物件或串流中的半段答案。
export function cachedCloudReplies(data) {
  const store = new Map();
  for (const r of Array.isArray(data?.cloudReplies) ? data.cloudReplies : []) {
    if (!r || !ID_RE.test(String(r.id)) || r.source !== 'cloud' || typeof r.text !== 'string' || !r.text || !Number.isFinite(Date.parse(r.at))) continue;
    store.set(r.id, { id: r.id, source: 'cloud', text: r.text, at: r.at,
      question: typeof r.question === 'string' ? r.question : '',
      askedAt: Number.isFinite(Date.parse(r.askedAt)) ? r.askedAt : r.at });
  }
  return store;
}

export function cacheCloudAnswers(data, quick, replies, outbox = []) {
  if (!data) return data;
  const store = cachedCloudReplies(data);
  for (const id of new Set([...quick.keys(), ...replies.keys()])) {
    const q = quick.get(id), r = replies.get(id);
    const answer = r?.source === 'cloud' && r.text ? r.text : q?.status === 'done' ? q.answer : '';
    const at = r?.source === 'cloud' && r.text ? r.at : q?.at;
    if (!ID_RE.test(String(id)) || typeof answer !== 'string' || !answer || !Number.isFinite(Date.parse(at))) continue;
    const item = outbox.find((it) => it.kind === 'chat' && it.id === id);
    const old = store.get(id);
    if (old && Date.parse(old.at) > Date.parse(at)) continue;
    store.set(id, { id, source: 'cloud', text: answer, at,
      question: q?.text || item?.payload?.content || old?.question || '',
      askedAt: item ? new Date(item.createdAt).toISOString() : q?.at || old?.askedAt || at });
  }
  const cloudReplies = [...store.values()];
  return JSON.stringify(data.cloudReplies || []) === JSON.stringify(cloudReplies) ? data : { ...data, cloudReplies };
}

// 一般串以正式 view／Live 回覆為準；工作串的遮蔽佔位由加密 laptop 回覆取代。
// 同留言的 relay 回覆依 seq 排序，串流快答不再額外畫一份。
// outbox 提供尚未出現在 view 的原文；重開 App 後，只有回覆沒有原文時畫獨立 Agent 泡泡。
export function mergeCloudThreads(base, quick, replies, outbox = [], now = new Date()) {
  const deferred = outbox.filter((it) => it.state === 'sent' && it.result?.reason === 'cloud_deferred');
  if (!quick.size && !replies.size && !deferred.length) return base;
  const out = [...base];
  const askedAt = (id) => {
    const item = outbox.find((it) => it.kind === 'chat' && it.id === id);
    return item ? item.createdAt : Date.parse(replies.get(id)?.askedAt || quick.get(id)?.at || replies.get(id)?.at || now.toISOString());
  };
  // hubThreads 的 key 只精確到分鐘；先按原始提問時間排，避免同分鐘的新留言插到快取答案前。
  const ids = [...new Set([...quick.keys(), ...replies.keys(), ...deferred.map((it) => it.id)])].sort((a, b) => askedAt(a) - askedAt(b));
  for (const id of ids) {
    const idx = out.findIndex((t) => t.id === id || t.rid === id);
    const existing = idx >= 0 ? out[idx] : null;
    const q = quick.get(id), r = replies.get(id);
    let parts = r ? r.parts || [r] : [];
    const work = existing && (existing.work === true || (existing.replies?.length > 0 && existing.replies.every((p) => isMaskedWork(p.text))));
    const formal = existing?.replies?.length && !existing.cloudOverlay;
    if (formal) {
      if (!work || !parts.some((p) => p.source === 'laptop')) continue;
      parts = parts.filter((p) => p.source === 'laptop');
    }
    const kept = formal ? existing.replies.filter((p) => !isMaskedWork(p.text)) : existing?.cloudFormalReplies || [];
    const item = outbox.find((it) => it.kind === 'chat' && it.id === id && !it.payload?.hubReply);
    const text = q?.text || item?.payload?.content || r?.question;
    const answer = r?.text || q?.answer || '';
    const at = r?.at || q?.at || now.toISOString();
    const source = r?.source || 'cloud';
    const status = r ? null : q?.status || (item?.result?.reason === 'cloud_deferred' ? 'queued' : null);
    const rows = parts.length ? parts : answer ? [{ text: answer, at, source }] : [];
    // 沒有提問原文時借同一投影建立回覆，最後仍顯示獨立 Agent 泡泡。
    const raw = { id, role: 'user', text: text || ' ', at: new Date(askedAt(id)).toISOString(), replies: rows.map((p) => ({
      id: 'cloud:' + id + ':' + (p.seq ?? 'quick'), parent: id, role: 'assistant', text: p.text, at: p.at,
      by: p.source === 'cloud' ? '雲端快答（Workers AI）' : '嘿嘿',
    })), via: 'cloud' };
    const t = hubThreads([raw], now).threads[0];
    // 單段獨立 Agent 泡泡沿用原本的日期標籤與編號。
    const projection = !text && rows.length === 1 ? hubThreads([{ ...raw, role: 'assistant', text: answer }], now).threads[0] : t;
    const projected = projection.replies.map((p, n) => ({ ...p, source: rows[n].source, by: rows[n].source === 'cloud' ? '雲端快答（Workers AI）' : p.by }));
    const joined = [...kept, ...projected.filter((p) => !kept.some((k) => k.text === p.text && (k.children || []).join('\n') === (p.children || []).join('\n')))];
    const next = { ...(existing || projection), replies: joined, cloudQuickStatus: status, cloudOverlay: true, cloudFormalReplies: kept };
    if (!existing && !text) { next.orphan = true; next.rid = id; delete next.id; next.text = ''; next.time = ''; }
    if (idx >= 0) out[idx] = next;
    else out.push(next);
  }
  return out.sort((a, b) => a.key - b.key);
}

export const cloudLaptopOnline = (snapshot) => typeof snapshot?.host?.laptop?.online === 'boolean' ? snapshot.host.laptop.online : snapshot?.laptop_online;
export function cloudUsageText(snapshot, label = '雲端大門') {
  const n = snapshot?.usage?.pct;
  return typeof n === 'number' && Number.isFinite(n) && n >= 50 ? label + '今天用了 ' + Math.round(n) + '%' : '';
}

export function cloudBannerText(snapshot, updatedAt) {
  if (!snapshot) return '';
  const parts = [];
  if (cloudLaptopOnline(snapshot) === false) {
    const ms = Date.parse(updatedAt || '');
    const clock = Number.isFinite(ms) ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms) : '—';
    parts.push(Number.isFinite(ms) ? '電腦離線，資料是 ' + clock : '電腦離線');
  }
  const n = snapshot.queue?.waiting_laptop;
  if (Number.isSafeInteger(n) && n > 0) parts.push(n + ' 件要等電腦');
  return parts.join('｜');
}

export function cloudQueueText(item, snapshot, replies = []) {
  if (item?.state !== 'sent' || item.result?.via !== 'cloud' || replies.length || item.result.reason === 'cloud_answered') return '';
  if (item.result.reason === 'cloud_deferred') return quickStatusText('queued');
  const offline = snapshot ? cloudLaptopOnline(snapshot) === false : item.result.laptopOnline === false;
  if (!offline) return '';
  const queued = snapshot?.queue?.items?.find((r) => r.id === item.id);
  return queued?.needs === 'local_login' ? '要等電腦' : '已排隊（電腦或雲端值班會接）';
}
