# GraspPortable：穩定語意與替換邊界

```text
Local browser / future mobile WebView
  app commands + unsaved drafts (src/app)
    ├─ EditorAdapter → CodeMirror (src/editor)
    └─ HTTP host → transaction → WorkspaceSnapshot (server)
          ├─ WorkspaceStore → SQLite (server/store.ts)
          └─ ExchangeService → validate/diff/token/import (server/exchange.ts)
Committed WorkspaceSnapshot
  → RuntimeClient → Worker → Knowledge parser → ValueGraph
  → RuntimeResult → editor/widgets/identifier inspector
```

`src/domain/model.ts` 定義 Grasp 自有 Note、Record、Identifier、Reference、Value、Diagnostic 與 revision。接面不傳 CodeMirror state、Lezer tree 或 SQLite handle。

| 責任 | 實作入口 | 替換時保留的契約 |
|---|---|---|
| Markdown / Live Preview | `src/editor/editor.ts` | `EditorAdapter` 的字串文件、range navigation、RuntimeResult；onChange 不回傳 editor objects |
| Knowledge / Value Language | `src/domain/knowledge.ts`, `template.ts` | `ParseResult` definitions/dependencies/references 與精確 source locations；Lezer 僅在 parser 內 |
| Calculation | `src/domain/graph.ts` | `ValueGraph.update(ParseResult, revision)`；可換原生／WASM engine，status、revision 與資料語意不變 |
| Background scheduling | `src/runtime/client.ts`, `value.worker.ts` | committed snapshots → revision-tagged results；superseded worker termination、timeout、舊結果拒絕 |
| Persistence | `server/store.ts` | Plain `WorkspaceSnapshot`、CRUD/import transactions、optimistic revisions；可換另一 SQLite adapter 或 mobile storage |
| Markdown exchange | `server/exchange.ts` | 保留 IDs 的 versioned projection、plan/diff、single-use token 與 workspace revision |
| Record query | `src/editor/query.ts` | 純 RecordQuery → QueryView，無 SQL／editor types，可獨立搬到下一個 renderer |
| Platform host | `server/main.ts`, `api.ts` | loopback transport、host path pointer、static assets；另做 Apple WebView + SQLite host 時重用 domain/worker/editor |

高頻輸入留在 CodeMirror。350 ms debounce 後由 DB transaction 提交；runtime 不計算未提交草稿。App commands 序列化，回應 revision 不允許倒退。一般 autosave 不鎖編輯區；切換／覆蓋文件時短暫鎖住舊文件。多分頁藉 workspace ID + entity revision 拒絕誤寫，不提供即時協同。

Graph 使用 reverse dependency、dirty closure、cache 與迭代 DFS；只有 affected values 重算。每次 committed snapshot 仍重新掃描文件與建立 graph/reference 索引，這是明確可優化處，並非完整 incremental parser。

Debug 起點：輸入問題看 editor browser tests；值錯誤看 domain tests／診斷；保存／匯入問題看 server console + store/exchange tests；順序問題看 concurrency E2E。性能 evidence 分開記錄 parse、graph、query 與真實 browser input，避免混用。

第一版沒有 Programming Runtime。Value Language 只處理字串組合，不執行任意程式、網路或檔案操作。未來程式執行應以獨立 process／host command 提交 validated changes，不能取得 editor 或 DB vendor objects。
