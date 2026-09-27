# GraspPortable：資料流程與替換邊界

本文件描述 desktop app 驗收準備版的現行邊界。核心 authority 仍是 docs/Project_Seed/ 的 Requirements 與 Development Method；本次 build、測試、人工操作及 package smoke 的狀態見驗證文件，不由架構圖推定完成。私密工作副本與報告位於 repository 外的 Scratch。

~~~text
Browser app commands / recoverable SQLite draft
  ├─ EditorAdapter + navigation / knowledge / records / files panels
  └─ loopback HTTP API
       ├─ ExchangeService / RenameService: reviewed revision-bound plans
       └─ WorkspaceStore: SQLite transaction → source + identities + caches + receipt
            ├─ RuntimeClient → Worker → knowledge parser → ValueGraph
            │    └─ revision-tagged RuntimeResult → editor / inspectors / query views
            └─ ProjectionWorkspaceFiles: strategy → scoped plan → shared renderer
                 ├─ single readable Markdown/ + .grasp-export/ full metadata
                 └─ .grasp/recovery/ independent generations + publication journal

External projection edit → identity/baseline review → explicit DB transaction
New external Markdown → inbox → review → explicit DB transaction
Validated manifest + payloads → explicit NEW database rebuild → new workspace ID
~~~

SQLite 是唯一 runtime authority。Schema 5 保存 notes、folders、records、settings、attachment BLOB、semantic identities／results／caches、draft journals／operation receipts、projection strategy／planning packages 與復原資料。HTTP snapshot 只攜帶附件 metadata。Workspace/.grasp/workspace.grasp.db 對應唯一的 Workspace/Markdown/ 可讀投影；完整樹內 .grasp-export 是可攜重建 metadata，內部 generations 與 journal 位於 .grasp/。外部檔案不自動更改 DB；host-state.json 只記住開啟路徑。

| 責任 | 實作入口 | 替換時保留的契約 |
| --- | --- | --- |
| 自有資料與位置 | src/domain/model.ts, files.ts | Plain snapshot、stable entity IDs、revision、UTF-16 source locations；不傳 vendor objects |
| Markdown / Live Preview | src/editor/editor.ts, raw-source.ts | EditorAdapter 的原始文字文件、document key、UTF-16 raw range navigation、runtime／asset updates 與 callbacks；CodeMirror state 與換行位置轉換留在 adapter |
| Value Language | src/domain/binding-language.ts, reference-language.ts, note-language.ts, knowledge.ts | Raw literal／ordered parts、兩式 references、versioned context adapter、精確 UTF-16 spans；legacy adapter 留在邊界 |
| Shared semantics | src/domain/shared.ts, server/semantic.ts | Stable Identifier／Binding／Occurrence、owner/source proof、原子共享命令、結果快取、operation receipt 與 guarded undo |
| Draft rebase | src/domain/edit-rebase.ts | 原始 source edit journal 與 cache-only patches 的位置重映射；重疊時保留草稿供明確比較，不猜 composition |
| Value Sync / calculation | src/domain/graph.ts | ValueGraph.update(parsed, revision)、status／diagnostics／affected results；不依賴 Node、DOM、DB 或 editor |
| Background runtime | src/runtime/client.ts, value.worker.ts | Committed snapshots → revision-tagged results；取消過時工作、timeout、metadata-only reuse |
| 大量筆記導航 | src/app/navigation.ts | Stable note/folder IDs、paths、搜尋位置、command callbacks；bounded DOM 與全結果分頁不改資料模型 |
| 筆記／附件連結 | src/domain/links.ts, src/app/links-panel.ts | Wiki/Markdown links、heading/block locations、resolved/missing/ambiguous 狀態；與值 identifiers 分離 |
| Knowledge / records UI | src/app/knowledge-panel.ts, records-panel.ts; src/editor/query.ts | Plain runtime/records、搜尋／分頁／精確 query 與 navigation callbacks；inline query 可開啟全部結果 |
| Semantic rename | src/domain/rename.ts, server/rename.ts | 純語意計畫與 impact；host 保存 reviewed payload、30 分鐘單次 token、workspace/revision 驗證、原子套用 |
| Persistence | server/store.ts | Snapshot、交易式 CRUD／import／restore、optimistic revisions、attachment hash/bytes；可換 SQLite adapter 或 mobile storage |
| Controlled exchange | server/exchange.ts | Versioned Markdown、IDs/hierarchy、嚴格 metadata/邊界、before/after preview、server-held apply token |
| Projection planning | src/domain/projection.ts | Stable semantic units、selector normalization、scope／path／coverage validation、reviewed strategy；不由檔案位置決定 owner |
| Markdown rendering | src/domain/projection-renderer.ts | 相同 scoped plan 共用 full／partial exporter，普通 Markdown、stable定位、受保護區塊與受控 source edits；不讀 DB |
| Publication / fallback | server/projection.ts, projection-generation.ts | 唯一 publisher、10 分鐘 coalescing、DB-trusted review baseline、staged directory cutover／journal／hash validation／retention；讀檔經 server/files.ts SafeTree |
| File and strategy UI | src/app/files-panel.ts, projection-panel.ts | Absolute path／Explorer、分組 preview/apply、部分匯出／完整 checkpoint；host 執行所有 authority checks |
| Migration | server/migration.ts, scripts/migrate-vault.ts | planVault／applyVault／writeVaultReport；唯讀來源、原文／路徑／hash 對照、套用前重新驗證、獨立新 DB、私密報告；不藏在一般 autosave 中 |
| Platform host | server/main.ts, api.ts, scripts/launch.mjs | Loopback/same-origin transport、啟動／關閉、path pointer、開啟資料夾與 unavailable-DB recovery；移植 WebView 時保留 domain 契約 |

高頻輸入、selection、composition 與 Ctrl+Z 留在 CodeMirror。350 ms debounce 保存 DB draft；語法完整才提交 shared command，語法未完成仍可恢復。共享操作另有 guarded undo。已提交快取以 exact-source／revision patches 套入 editor，保留 selection/history；同時輸入以 source journal 重映射，衝突保留原稿。DB draft 不參與已提交值的計算。

Graph 用 reverse dependencies、dirty closure、cache 與迭代走訪，只重新計算 affected values。內容變更仍重新解析全部 knowledge；folder/title/settings/attachment 等 metadata-only 更新可重用已算內容，或保留正在計算的相同內容並發布最新 revision。Link parser 可重用未修改筆記的解析結果；路徑解析仍依目前 catalog 重建。

已知舊 schema 先唯讀檢查，再建立並驗證獨立 SQLite 備份，最後以 transaction 升級。刪除、匯入、rename、restore 有 recovery；回復保留 entity IDs 並提高 revision，避免舊分頁覆蓋重新出現的資料。附件刪除只移除 active metadata，歷史需要的 immutable blobs 保留。

投影依 DB 已保存策略安排 semantic units，保留原 source owner／binding slots；新增未分配資料有確定性位置。Typing 只標記輕量 pending stamp，不整理整樹。完整 generation 的 payload/hash/coverage 驗證後才 staged cutover；Windows 兩次 rename 間可能短暫 unavailable，不逐檔混代。Dirty 外部內容保留，DB 繼續可編輯。多個外部修改經同一預覽、exact hash 與 DB-trusted baseline 檢查後原子套用。Full fallback 以普通獨立檔案重建新 DB；attachments 逐個讀取，保留 source／identities／strategy／provenance／recoverable drafts，新的 workspace ID 隔離舊分頁。不承諾複製完整操作歷史。

既有 M4／M5 報告中 .db.files/、獨立 AI folder 與 immutable 對外修訂路徑描述的是當時成果；不代表本次驗收版的主要檔案配置。

Programming Runtime 仍未實作。Value Language 只做字串組合，沒有任意程式執行、網路或檔案 side effects。未來若加入程式執行，應使用獨立 execution boundary，以 validated commands 提交資料，不取得 editor/DB vendor handle。

實際接面摘要見 [IMPLEMENTATION-CONTRACT.md](docs/IMPLEMENTATION-CONTRACT.md)；驗證與已知成本見 [VERIFICATION.md](docs/VERIFICATION.md)、[PERFORMANCE.md](docs/PERFORMANCE.md)、[LIMITATIONS.md](docs/LIMITATIONS.md)。
