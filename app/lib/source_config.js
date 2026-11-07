// 資料來源設定（P71）：畫面要讀的「邏輯名稱」對到哪個來源、哪個路徑。
// 換傳輸（例如之後改 Supabase 或自架後端）：在 datasource.js 的 SOURCES 加一個 kind，再改這裡的 kind 與 paths，畫面不用動。
// P74 hub v2：hub_view／hub_history／hub_config 是電腦寫的（手機只讀）；手機寫的 in/ 檔走 outbox 的 putFile（lib/hub.js），不經這裡
export const SOURCE = { kind: 'github', paths: { work_status: 'signal/work_status.json', hub_view: 'signal/hub/view.json', hub_history: 'signal/hub/history.json', hub_config: 'signal/hub/config.json' } };
export const CLOUD_RELAY_ORIGIN = 'https://cloud-relay.heihei-relay-7vf1.workers.dev';
