// outbox 項目 → 真的寫進 GitHub（client 可替換成 mock）。每一種都要「重送不重複」：
//   回答：answerMany 的 dedupe（答案已在檔案裡就不重寫）
//   任務、筆記：Task.md 已有同「手機編號」就當成功（noop）
//   日記：base 比對（內容已經是這個答案＝noop）
//   對話：同一行（含時間戳）已在對話區就不再加；時間戳固定用 createdAt
//   升格請求、維持任務：同一子行已在那筆任務底下就不再加
// 所有寫入的「現在」都用 item.createdAt，重送時行內容（時間戳）才會一模一樣。
import { TWDate as Date } from './tz.js';
import { answerMany, answerSuggested, addTaskV3, addNote, submitJournalEdit, sendChatOnce, markTask, doneTask } from './actions.js';
import { promoteSubline, keepSubline, doneSubline, replySubline } from './taskedit.js';
import { applyRecordOp, blockedFrom } from './records.js';
import { RECORD_FILES, SIGNAL_BRANCH, GitHubError } from './github.js';
import { applyPushOp } from './push.js';
import { PUSH_SUB_PATH } from './push_config.js';
import { REMOTE_REQUEST_PATH, applyRemoteOpen } from './remoteopen.js';
import { applyRemoteOff } from './remoteoff.js';
import { executeHubChat, isWorkItem, waitCloudError } from './hub.js';
import { streamQuickAnswer, cloudLaptopOnline } from './cloudchat.js';

function blocked(message, code) {
  const e = new Error(message);
  e.blocked = true; e.code = code;
  return e;
}

// 回傳 {file:'questions'|'task'|'live', text, changed, action, reason?}；丟錯誤的分類見 lib/outbox.js classifyError
// opts.sleep：測試用（409 重試的等待）；opts.useHub：送出「當下」才問要不要走 json（()=>boolean）。沒給就看 payload.hub（排隊時的狀態）。
// 走哪條路在這裡決定，不在排隊時定死：json 模式排隊、切到 live 之後才送的，照舊寫 Live.md；反過來也是（內容都是 ↩ 格式，兩邊電腦都收得到）
export async function executeItem(client, item, opts = {}) {
  const now = new Date(item.createdAt);
  const p = item.payload || {};
  switch (item.kind) {
    case 'answer': {
      let r;
      if (p.quick === 'suggest' && p.viaLive) {
        r = await answerSuggested(client, p.items || [], now, { dedupe: true }); // 送出前重抓 Live.md，已經不在「等你」的不送
        if (!r) throw blocked('這題已經不在 Live「等你」清單裡，沒有送出', 'gone');
      } else {
        r = await answerMany(client, p.items || [], p.answer || '', now, { dedupe: true });
      }
      return { file: 'questions', text: r.questions.text, changed: r.questions.changed, action: r.questions.changed ? 'created' : 'noop', supplement: r.supplement };
    }
    case 'journal': {
      const r = await submitJournalEdit(client, { now, day: p.day, answers: p.answers || ['', '', ''], base: p.force ? null : (p.base || null) });
      if (r.action === 'conflict') {
        const e = blocked('第 ' + (r.points || []).join('、') + ' 題電腦那邊也改過了，沒有覆蓋；要用你的版本蓋過去請按「用我的版本覆蓋」', 'conflict');
        e.text = r.text;
        throw e;
      }
      return { file: 'task', text: r.text, changed: r.changed, action: r.action };
    }
    case 'note': {
      const r = await addNote(client, { content: p.content, source: p.source, url: p.url, now, mid: item.id });
      return { file: 'task', text: r.text, changed: r.changed, action: r.action, reason: r.reason || '' };
    }
    case 'task': {
      const r = await addTaskV3(client, { tag: p.tag, content: p.content, project: p.project, deadline: p.deadline, now, where: p.where || '手機 App 任務頁', mid: item.id });
      return { file: 'task', text: r.text, changed: r.changed, action: r.action, reason: r.reason || '' };
    }
    case 'chat': {
      // 標了工作的留言：只走加密留言。不管 useHub、mode、payload.hub，都不寫 Live.md／signal/hub/in，也不進快答；沒有憑證就排隊等
      if (isWorkItem(item)) {
        if (!opts.cloud) throw waitCloudError('雲端還沒開');
        return executeHubChat(client, item, { sleep: opts.sleep, cloud: opts.cloud, onCloudFallback: opts.onCloudFallback });
      }
      // auto 也是 outbox 的一筆；queued 代表伺服器已轉交，不能再 POST msg。
      if (p.mode === 'auto' && !p.hubReply && opts.cloud) {
        try {
          const row = await streamQuickAnswer(opts.cloud, p.content || '', item.id, {
            signal: opts.signal, throwOnError: true, onChange: opts.onQuickChange,
          });
          return { file: 'hub', changed: true, action: 'created', via: 'cloud',
            reason: row.status === 'queued' ? 'cloud_deferred' : row.status === 'done' && row.answer ? 'cloud_answered' : '', laptopOnline: cloudLaptopOnline(opts.cloudSnapshot) };
        } catch {
          if (opts.signal?.aborted) throw new DOMException('network aborted', 'AbortError');
          opts.onQuickFallback?.(item.id);
          try { opts.onCloudFallback?.('ask', 'cloud_unavailable'); } catch { /* 診斷不能擋備援 */ }
          return executeHubChat(client, item, { sleep: opts.sleep }); // 同 id，直接 GitHub，沒有第二次 msg
        }
      }
      // P74：json 模式寫 signal/hub/in/<id>.json，不碰 Live.md；其餘照舊。item.payload.hub 記下「這筆實際走了哪條」（樂觀顯示用）
      const viaHub = typeof opts.useHub === 'function' ? !!opts.useHub() : !!p.hub;
      if (!!p.hub !== viaHub) item.payload = { ...p, hub: viaHub };
      if (viaHub && opts.cloud) return executeHubChat(client, item, { sleep: opts.sleep, cloud: opts.cloud, onCloudFallback: opts.onCloudFallback });
      if (viaHub) return executeHubChat(client, item, { sleep: opts.sleep });
      const r = await sendChatOnce(client, p.content || '', now, item.id);
      return { file: 'live', text: r.text, changed: r.changed, action: r.changed ? 'created' : 'noop' };
    }
    case 'desk': { // P74 o-7rpss6：我回電腦開關。不管對話走 json 或 Live.md，一律寫 hub 的 order_op（雲端優先、GitHub in/ 備援）；同一個 x- 編號重送電腦只記一次
      return executeHubChat(client, item, { sleep: opts.sleep, cloud: opts.cloud, onCloudFallback: opts.onCloudFallback });
    }
    case 'promote': {
      const r = await markTask(client, p.title || '', promoteSubline({ name: p.name, reason: p.reason, now }));
      return { file: 'task', text: r.text, changed: r.changed, action: r.action };
    }
    case 'keep': {
      const r = await markTask(client, p.title || '', keepSubline(now));
      return { file: 'task', text: r.text, changed: r.changed, action: r.action };
    }
    case 'done': {
      // 提醒打勾：已經是打勾的（電腦或 GitHub 上先勾了）＝noop；結果子行的時間用 createdAt，重送不會變兩行
      // P70 D1：p.say（想跟 Agent 說的話）有字 → 先寫「手機回覆」子行再打勾，電腦端 needs_agent 會把它當回覆處理；舊版的 p.note 照舊寫在結果子行
      const say = String(p.say || '').trim();
      const r = await doneTask(client, p.title || '', doneSubline({ note: p.note, now }), say ? replySubline({ text: say, now }) : '');
      return { file: 'task', text: r.text, changed: r.changed, action: r.action };
    }
    case 'reply': {
      const r = await markTask(client, p.title || '', replySubline({ text: p.content, now }));
      return { file: 'task', text: r.text, changed: r.changed, action: r.action };
    }
    case 'record': {
      // 紀錄中心：先抓最新版、只套這一筆操作、PUT 帶 sha；409／422 由 updateFile 重抓重套（不會拿手機舊快取整份覆蓋）。
      // 檔案還不存在（404）時只對白名單資料檔建檔，而且要先讀得到 Task.md 等其他檔（lib/github.js）
      if (!RECORD_FILES.includes(p.file)) throw blocked('不允許寫入這個檔案：' + p.file, 'file');
      let last = null;
      const res = await client.updateFile(p.file, (text) => {
        last = applyRecordOp(text, item);
        if (!last.ok) throw blockedFrom(last);
        return last.text;
      }, 'Update ' + p.file + ' (手機 ' + item.id + ')', 3, { create: true });
      return { file: 'records', path: p.file, text: res.text, changed: res.changed, action: last && last.changed ? last.action : 'noop' };
    }
    case 'pushsub': {
      // 通知訂閱：signal 分支 push_sub.json，以 endpoint 去重（加入＝取代同 endpoint；已登記＝noop；移除不存在＝noop）
      let last = '';
      const isAdd = p.action === 'add';
      try {
        const res = await client.updateFile(PUSH_SUB_PATH, (text) => {
          try { last = applyPushOp(text, p); } catch (e) { throw blocked(e.message, 'push'); }
          return last;
        }, 'Update push_sub (手機 ' + item.id + ')', 3, { ref: SIGNAL_BRANCH, create: isAdd });
        return { file: 'signal', path: PUSH_SUB_PATH, text: res.text, changed: res.changed, action: res.changed ? 'created' : 'noop' };
      } catch (e) {
        if (!isAdd && e instanceof GitHubError && e.status === 404) return { file: 'signal', path: PUSH_SUB_PATH, text: '', changed: false, action: 'noop' }; // 沒有檔案可移除
        throw e;
      }
    }
    case 'remoteopen': {
      // 叫電腦開遠端：signal 分支 remote_request.json，直接覆蓋成這一筆；檔案裡已是同一個 id＝noop（重送不重複）
      const res = await client.updateFile(REMOTE_REQUEST_PATH, (text) => {
        try { return applyRemoteOpen(text, p); } catch (e) { throw blocked(e.message, 'remoteopen'); }
      }, 'Remote open request (手機 ' + item.id + ')', 3, { ref: SIGNAL_BRANCH, create: true });
      return { file: 'signal', path: REMOTE_REQUEST_PATH, text: res.text, changed: res.changed, action: res.changed ? 'created' : 'noop' };
    }
    case 'remoteoff': {
      // 叫電腦關遠端（P69）：同一個 remote_request.json，action 是 off；檔案裡已是同一個 id＝noop（重送不重複）
      const res = await client.updateFile(REMOTE_REQUEST_PATH, (text) => {
        try { return applyRemoteOff(text, p); } catch (e) { throw blocked(e.message, 'remoteoff'); }
      }, 'Remote off request (手機 ' + item.id + ')', 3, { ref: SIGNAL_BRANCH, create: true });
      return { file: 'signal', path: REMOTE_REQUEST_PATH, text: res.text, changed: res.changed, action: res.changed ? 'created' : 'noop' };
    }
    default:
      throw blocked('不認得的寫入種類：' + item.kind, 'kind');
  }
}
