// P62 M4：Web Push 的 VAPID 公鑰（公開資訊，可以進公開 PWA）。私鑰只在電腦端 %LOCALAPPDATA%\ClaudeRemote\vapid\private.pem。
// 換金鑰（push_notify.py init --rotate）後要改這個字串，而且每支手機都要重新訂閱。
export const VAPID_PUBLIC_KEY = 'BAobqbpkJodQgpr96iIKTqN6j7b7ieGvwy4cEkZiZ68zBh6xqec4nH3InEO2vfM5iiKTY07neSxk-sfDlluXxYk';
// 訂閱清單寫進 signal 分支（不套 prefix），格式 {"subs":[{endpoint, keys:{p256dh, auth}, label, created_at}]}
export const PUSH_SUB_PATH = 'signal/push_sub.json';
