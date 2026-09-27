# GraspPortable：資料流程與替換邊界

本文件描述 v0.2 desktop app 的現行 source。核心 authority 仍是 docs/Project_Seed/ 的 Requirements 與 Development Method。Production build、179 tests 與 20 production E2E 已通過；bounded migration rehearsal 另有資料 fidelity 證據。私密 workspace 人工操作與最終 package smoke 的狀態見驗證文件，不由架構圖推定完成。

~~~text
Browser app commands / local unsaved draft
  ├─ EditorAdapter + navigation / knowledge / records / files panels
  └─ loopback HTTP API
       ├─ ExchangeService / RenameService: reviewed revision-bound plans
       └─ WorkspaceStore: SQLite transaction → committed WorkspaceSnapshot
            ├─ RuntimeClient → Worker → knowledge parser → ValueGraph
            │    └─ revision-tagged RuntimeResult → editor / inspectors / query views
            └─ WorkspaceFiles: queued immutable payloads → manifest + readable index

External Markdown → inbox → review → explicit DB transaction
Validated manifest + payloads → explicit NEW database rebuild → new workspace ID
~~~

SQLite 是唯一即時 authority。Schema 3 保存 notes、folders、records、settings、attachment metadata／BLOB 與 recovery history；HTTP snapshot 只攜帶附件 metadata。.db.files/ 是可讀 projection、exchange 與重建材料，外部檔案修改不會直接更改計算結果或 DB。workspaces/host-state.json 只有上次開啟的路徑，不是第二份筆記資料。

| 責任 | 實作入口 | 替換時保留的契約 |
| --- | --- | --- |
| 自有資料與位置 | src/domain/model.ts, files.ts | Plain snapshot、stable entity IDs、revision、UTF-16 source locations；不傳 vendor objects |
| Markdown / Live Preview | src/editor/editor.ts, raw-source.ts | EditorAdapter 的原始文字文件、document key、UTF-16 raw range navigation、runtime／asset updates 與 callbacks；CodeMirror state 與換行位置轉換留在 adapter |
| Value Language | src/domain/knowledge.ts, template.ts | ParseResult、definitions／dependencies／references、精確 name spans 與 note/record ownership；可換 parser，保留語意與位置 |
| Value Sync / calculation | src/domain/graph.ts | ValueGraph.update(parsed, revision)、status／diagnostics／affected results；不依賴 Node、DOM、DB 或 editor |
| Background runtime | src/runtime/client.ts, value.worker.ts | Committed snapshots → revision-tagged results；取消過時工作、timeout、metadata-only reuse |
| 大量筆記導航 | src/app/navigation.ts | Stable note/folder IDs、paths、搜尋位置、command callbacks；bounded DOM 與全結果分頁不改資料模型 |
| 筆記／附件連結 | src/domain/links.ts, src/app/links-panel.ts | Wiki/Markdown links、heading/block locations、resolved/missing/ambiguous 狀態；與值 identifiers 分離 |
| Knowledge / records UI | src/app/knowledge-panel.ts, records-panel.ts; src/editor/query.ts | Plain runtime/records、搜尋／分頁／精確 query 與 navigation callbacks；inline query 可開啟全部結果 |
| Semantic rename | src/domain/rename.ts, server/rename.ts | 純語意計畫與 impact；host 保存 reviewed payload、30 分鐘單次 token、workspace/revision 驗證、原子套用 |
| Persistence | server/store.ts | Snapshot、交易式 CRUD／import／restore、optimistic revisions、attachment hash/bytes；可換 SQLite adapter 或 mobile storage |
| Controlled exchange | server/exchange.ts | Versioned Markdown、IDs/hierarchy、嚴格 metadata/邊界、before/after preview、server-held apply token |
| Managed files / fallback | server/files.ts, src/app/files-panel.ts | WorkspaceFiles 的 schedule/status/flush/close、relative-path operations、verified rebuild data；檔案 adapter 不寫 runtime authority |
| Migration | server/migration.ts, scripts/migrate-vault.ts | planVault／applyVault／writeVaultReport；唯讀來源、原文／路徑／hash 對照、套用前重新驗證、獨立新 DB、私密報告；不藏在一般 autosave 中 |
| Platform host | server/main.ts, api.ts, scripts/launch.mjs | Loopback/same-origin transport、啟動／關閉、path pointer、開啟資料夾與 unavailable-DB recovery；移植 WebView 時保留 domain 契約 |

高頻輸入、selection、composition 與 undo 留在 CodeMirror。350 ms debounce 後經序列化 app command 提交 DB，runtime 只看已提交 snapshot。最新 20 份文件的 undo/selection 可在本次頁面期間保留；外部替換不沿用不相容 history。草稿不是第二份持久化 authority。

Graph 用 reverse dependencies、dirty closure、cache 與迭代走訪，只重新計算 affected values。內容變更仍重新解析全部 knowledge；folder/title/settings/attachment 等 metadata-only 更新可重用已算內容，或保留正在計算的相同內容並發布最新 revision。Link parser 可重用未修改筆記的解析結果；路徑解析仍依目前 catalog 重建。

已知 v1/v2 DB 先唯讀檢查，再建立、驗證一致的獨立 SQLite 備份，最後以 transaction 升級 schema 3。刪除、匯入、rename、restore 有 recovery；回復保留 entity IDs 並提高 revision，避免舊分頁覆蓋重新出現的資料。附件刪除只移除 active metadata，歷史需要的 immutable blobs 保留。

Mirror 非同步合併待處理 snapshots，只寫改變的 immutable note/asset payload，再發布完整 manifest/index；失敗顯示 stale/error，但不撤銷已提交 DB。外部修改保留並回報，不偷偷覆寫或匯入。重建先驗證 metadata、路徑、hash 與每份 payload，拒絕既有目標；新的 workspace ID 隔離舊分頁，note/folder/record/asset IDs 與來源 timestamps 保留。切換／關閉 host 會等待進行中的檔案操作與 mirror，再關閉 DB。

Programming Runtime 仍未實作。Value Language 只做字串組合，沒有任意程式執行、網路或檔案 side effects。未來若加入程式執行，應使用獨立 execution boundary，以 validated commands 提交資料，不取得 editor/DB vendor handle。

實際接面摘要見 [IMPLEMENTATION-CONTRACT.md](docs/IMPLEMENTATION-CONTRACT.md)；驗證與已知成本見 [VERIFICATION.md](docs/VERIFICATION.md)、[PERFORMANCE.md](docs/PERFORMANCE.md)、[LIMITATIONS.md](docs/LIMITATIONS.md)。
