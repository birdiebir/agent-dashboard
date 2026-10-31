// outbox 項目 → 真的寫進 GitHub（client 可替換成 mock）。每一種都要「重送不重複」：
//   回答：answerMany 的 dedupe（答案已在檔案裡就不重寫）
//   任務、筆記：Task.md 已有同「手機編號」就當成功（noop）
//   日記：base 比對（內容已經是這個答案＝noop）
//   對話：同一行（含時間戳）已在對話區就不再加；時間戳固定用 createdAt
//   升格請求、維持任務：同一子行已在那筆任務底下就不再加
// 所有寫入的「現在」都用 item.createdAt，重送時行內容（時間戳）才會一模一樣。
import { answerMany, answerSuggested, addTaskV3, addNote, submitJournalEdit, sendChatOnce, markTask, doneTask } from './actions.js';
import { promoteSubline, keepSubline, doneSubline, replySubline } from './taskedit.js';
import { applyRecordOp, blockedFrom } from './records.js';
import { RECORD_FILES } from './github.js';

function blocked(message, code) {
  const e = new Error(message);
  e.blocked = true; e.code = code;
  return e;
}

// 回傳 {file:'questions'|'task'|'live', text, changed, action, reason?}；丟錯誤的分類見 lib/outbox.js classifyError
export async function executeItem(client, item) {
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
      const r = await sendChatOnce(client, p.content || '', now);
      return { file: 'live', text: r.text, changed: r.changed, action: r.changed ? 'created' : 'noop' };
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
      const r = await doneTask(client, p.title || '', doneSubline({ note: p.note, now }));
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
    default:
      throw blocked('不認得的寫入種類：' + item.kind, 'kind');
  }
}
