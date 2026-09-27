# GraspPortable 驗證紀錄

v0.2 已通過 production build、179 tests 與 20 production E2E（2026-09-27，Asia/Taipei），並完成 bounded private migration 的 programmatic rehearsal、真實副本人工作業與 host restart、原始 snapshot 未變檢查，以及獨立的 v0.2 package smoke。以下分別記錄各種證據與其適用範圍。

Production E2E 使用真正 browser bundle、Edge、local HTTP host 與磁碟 SQLite DB。Test workspaces 位於隔離的 .cache/ 或暫存目錄，沒有改寫使用者既有 workspace。各 milestone 的人工操作與測試證據見 [PHASE2-VERIFICATION.md](PHASE2-VERIFICATION.md)。

| Core Requirements §13 | 已有實際證據 |
| --- | --- |
| 1. 啟動、建立／開啟 workspace | Production UI 建立／切換／重啟；schema v1/v2 獨立 fixtures 驗證備份與升級。Corrupt default DB 仍能開啟 recovery UI，原檔 bytes 不變；可另開 DB 或從 manifest 重建 |
| 2. Markdown 與同區 Live Preview | 中文、heading/emphasis、selection、真實 clipboard、undo/redo、composition events；per-note undo、asset widgets 不污染 source/history。CRLF migration E2E 驗證 title-only save、heading replacement/undo、image preview 與 restart 的 raw source fidelity。實體中文 IME 選字仍未驗證 |
| 3–5. 字串、formatted/nested、affected updates | Production UI 修改值後 nested greeting/query 更新；無關值不重算；200 次 randomized differential comparison。Metadata-only 更新重用已算內容 |
| 6. Cycle / missing 不拖垮 App | Production UI 建立錯誤再修復；20k deep graph、cycle、150k references、輸出上限 tests。Rename impact 另驗證 12k iterative chain/cycle |
| 7. Definition / references 可操作 | Source/range navigation、stale offset regression、全部結果搜尋／分頁、duplicate definition locations、dependencies/dependents、reviewed identifier/namespace rename |
| 8. Restart 一致 | 真正停止／啟動 host，notes/records/settings/hierarchy/attachments 保持；fresh-DB rebuild 保留 entity IDs 與 timestamps，換 workspace ID 隔離舊分頁 |
| 9. Database authority | Worker 只接受 committed snapshot。Raw inbox、外部 mirror edits 不改 DB；files failure 不撤銷成功 DB save。Stale revision/workspace/token 拒絕；注入中途 SQL failure 驗證完整 rollback |
| 10–11. Markdown export / controlled import | 實體 outbox + browser download、AI-return inbox、before/after review、明確套用、reactive update、recovery。Malformed metadata/邊界外文字不默默丟棄。AI folder/verified manifest 支援新 DB rebuild |
| 12. Correctness / performance | Core/API/browser-adapter tests、production E2E、graph baseline、3,000-note navigation、10,000-record management 與 2,820-note projection evidence；見 PERFORMANCE |
| 13. 主要 implementation 可替換 | [ARCHITECTURE.md](../ARCHITECTURE.md) 的 plain contracts、EditorAdapter、parser/graph/worker、navigation/links、WorkspaceStore、exchange/rename/files 與 host 接面 |
| 14. 限制清楚 | [LIMITATIONS.md](LIMITATIONS.md) 明列 platform/IME、語言/query/rename、未支援 Markdown/links、全量成本、mirror/history retention、exchange/rebuild 邊界 |

## Phase 2 增量驗證

- **M2**：94 tests、14 E2E。3,000 notes／2,275 siblings／六層 folder、bounded navigation、搜尋／move／link／restart；保留 stable IDs；same-DB multi-tab clean refresh、dirty stale-base draft retention、過期搜尋 range 拒絕。
- **M3**：129 tests、16 E2E。全結果 knowledge/record management、late-record editing、query row → record、200-row inline query → 完整列表、語意 spans/ownership、collision/cycle/missing、expired/replayed plans、projected storage limit、atomic rename/recovery。
- **M4**：159 tests、19 E2E。DB attachment dedup/hash/path validation、recoverable delete、schema 3 backup upgrade；raw upload/PNG rendering、安全下載、files paging、inbox review/apply、AI folder、外部 mirror edit 保留、checksum/traversal/symlink rejection、corrupt-DB startup、新 DB rebuild/restart。In-flight export／mirror drains before DB close 的 race regression 通過。
- **M5 / v0.2 source**：179 tests、20 E2E。Read-only migration／source-change recheck／exclusive new DB、BOM/CRLF／mixed-EOL source mapping與 undo、超過 10 MiB UTF-8 且仍符合 DB 字元限制的 mirror rebuild，以及 production migration UI/restart/unchanged-file import regression 通過。

最新完整 E2E JSON 記錄 20 expected、0 unexpected、0 skipped、0 flaky，31.59 秒（開始於 2026-09-27T01:44:21.713Z）：[e2e-results.json](benchmarks/e2e-results.json)。完整 unit run 曾受到並行 browser/benchmark 干擾；隔離 Vite caches 與正式測試負載後，原來 1,500 ms editor regression budget 通過，沒有放寬門檻。

人工使用另有記錄：M2 在隔離 synthetic 大型 workspace 建立／編輯／移動與找連結；M3 rename nested values、編輯 late record、review/recovery；M4 真正操作 Files inbox review/apply、AI folder export 並查看實體路徑。這些與 automated coverage 分開陳述，不能代替實體 IME 或 mobile 驗證。

## 可重跑與證據來源

~~~sh
npm run build
npm test
npm run test:e2e
node --expose-gc --import tsx scripts/benchmark.ts
node --import tsx scripts/benchmark-files.ts
npm run package
node scripts/smoke-package.mjs
~~~

性能結果及樣本定義見 [PERFORMANCE.md](PERFORMANCE.md)、[FILES-PERFORMANCE.md](FILES-PERFORMANCE.md)。Node calculation、browser input、filesystem projection 是不同量測，不能互相當成 latency 結論。

v0.2 [package-smoke.json](benchmarks/package-smoke.json) 於 2026-09-27T01:54:02Z 通過：在 repository 外複製 31 個成品檔案，沒有 node_modules，使用 Node 24.18.0 啟動 launcher，載入 production 靜態資產，驗證 DB write/export/restart、附件 bytes restart 與 mirror 發布。Package 不含私人檔案。Package destination 若已存在會拒絕重用；需要獨立 Node 24+ runtime。

## M5 最終交付紀錄

M5 的 programmatic rehearsal 已驗證 160 notes、44 folders、11 assets 的所有 source hashes、exchange 零變更 round-trip、單筆 controlled AI import 的 nested reactive update、recovery 還原全部原文，以及 mirror／新 DB rebuild／reopen。完整範圍與匿名統計見 [MIGRATION.md](MIGRATION.md)；詳細來源名稱、內容與報告留在 private cache。

其中 117／160 notes 使用 CRLF，實際資料揭露 editor 正規化換行及 source offset 邊界；現行 adapter 已修正 raw-source mapping，inbox import 另有 BOM/CRLF byte-fidelity regression。Production Edge 的獨立 copied-vault fixture 已驗證：圖片預覽、只改 title 不改 Markdown、依 heading 跳轉後正確 replacement/undo、host restart snapshot 相同，以及 unchanged exchange file import 顯示零筆變更；fixture source files 亦保持原文。

人工操作 real rehearsal workspace 已完成：深層搜尋與定位、title 修改及還原、原文連結定位、DB 圖片載入、實際 inbox/mirror 路徑。操作後 160 notes／11 assets hashes 全部相同，真實 host stop/start snapshot 完全相同。原 snapshot 最終全量 content/mtime/directory manifest 與 baseline 相同。v0.2 package smoke 亦已通過。預設 workspace 從 schema 1 升級到 3，先建立 validated backup；原 4 notes／2 records 逐項保留，兩個成品 UI 均重新載入可用。

Private corpus/report/workspace 留在 ignored 目錄，公開文件只保留匿名統計。歷史 v0.1 唯讀 corpus 是 2,810 Markdown，Phase 2 snapshot inventory 是 2,820 Markdown；兩次輸入不混算，legacy grammar 不自動當成本版 identifiers。
