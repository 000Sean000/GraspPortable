# MainVault migration：目前流程與歷史證據

## M4：已實作的串流匯入流程

`server/migration.ts` 與 `scripts/migrate-vault.ts` 已改為附件逐一串流雜湊、私有 staging、建立新 SQLite DB 及可續跑 checkpoint。這裡記錄實作與合成驗證；**全 MainVault 副本的本輪往返驗收尚待完成**，不能拿下方歷史 160 篇 rehearsal 代替。最新整體進度以 [EXECUTION-STATE.md](EXECUTION-STATE.md) 為準。

資料位置遵守 Sandbox 的分工：`Acceptance/MainVault-Source` 與原 MainVault 保持唯讀；在 repo 外 `Scratch` 建立獨立 `Source-copy` 才進行實驗。先比對原 snapshot 與副本的 file count、relative paths、sizes、SHA-256；驗收結束再次比對原 snapshot。私人 Markdown、附件、路徑清單、報告、DB、checkpoint 都不得進 Git。新 DB 是 runtime authority；匯入不更動來源，也不自動重分類、抽取 records 或轉換 legacy 語法。

從 repository root 執行以下 PowerShell 命令。`Source-copy` 是事先完成 hash 比對的獨立副本；範例路徑在 repo 的同層 `Scratch`，不是 repo 內的 `.cache`：

```powershell
node --import tsx scripts/migrate-vault.ts --source="..\Scratch\Migration-01\Source-copy" --output="..\Scratch\Migration-01\Private-reports"
node --import tsx scripts/migrate-vault.ts --source="..\Scratch\Migration-01\Source-copy" --output="..\Scratch\Migration-01\Private-reports" --apply="..\Scratch\Migration-01\Imported\.grasp\workspace.grasp.db"
```

第一個命令只產生 preview 與私人報告。第二個命令建立新的 DB；在 copy 前、copy 後及發布前重新核對 included path/hash/size/mtime manifest。原始 Markdown 的 UTF-8、BOM、LF／CRLF、frontmatter、logical hierarchy 與附件位元組保留，note 明示為 `legacy-v0.2`。Note／folder／attachment IDs 由種類及相對路徑確定性產生；DB instance ID 是新值。匯入來源 fingerprint、檔案 manifest 與目錄資訊作為 provenance 寫入 DB，完整 fallback 可攜帶它們；不依賴原機絕對路徑才能還原。

### 中斷與續跑

私有 checkpoint 在 `<new-database-path>.migration/`，包含不可變 `manifest.json`、依 SHA-256 命名的 `objects/`、完整 candidate DB 與驗證收據。再次執行**相同 apply 命令**會重新核對來源、plan、target 及已完成 objects 的 hash，接續未完成的附件；完整 candidate 可再驗證後發布。不同來源／plan、遭外部修改的 checkpoint 或既有無關 DB 會拒絕套用，保留現場，不覆寫或猜測。

發布只建立不存在的目標，完成後重新 hash、開啟 DB 並驗證資料，再記錄成功。若中斷發生於最終 DB copy，可能留下未完整目標；工具不會將它報成成功或自動覆寫。完整 candidate 仍保留，應先檢查與保全現場，再選擇新的輸出位置。已成功發布且符合收據的相同命令可安全重跑，返回同一 workspace。checkpoint 不自動清理；確認新 DB 與完整 fallback 可用後，才由 Human 決定保留或移除私人 staging。

### 資源邊界

| 項目 | 目前行為 |
| --- | --- |
| included filesystem entries | 最多 20,000 |
| 單篇 Markdown | 最多 10 MiB |
| aggregate Markdown source | 最多 128 MiB；這是 raw input 預算，不是整個 Node process 的 RSS 保證 |
| 單一附件 | 最多 64 MiB |
| aggregate attachments | 不設舊 512 MiB 總額上限；由磁碟預檢及逐一處理控制 |
| 掃描／複製附件 | 每次 1 MiB buffer；preview 不保存附件 body |
| SQLite 寫入 | 每次讀一個 unique-SHA 附件，驗 size/hash 後 INSERT，不建立全部附件的 memory map |
| 可用磁碟預檢 | 至少 `4 × unique attachment bytes + 8 × Markdown bytes + 16 MiB`；來源副本本身空間另計，檢查後仍可能遇到外部磁碟耗用 |

Symlink、逃出 root 的 resolved path、非法 UTF-8、超限資料及 excluded directories 外的 executable input 會拒絕。`.obsidian`、`.git`、`.codex`、`.agents`、`node_modules` 等 plugin／tool directories 不進 DB；完整驗收 inventory 仍包含它們，才能證明原 snapshot 沒有被修改。

### 已取得證據與完整驗收入口

`npm test -- --run tests/migration.test.ts --maxWorkers=2`：**14 tests 通過**。包括 raw BOM／CRLF、跨 1 MiB chunk 的 UTF-8、deterministic mapping、DB reopen、來源與 plan 改變、路徑／symlink 拒絕、低磁碟預檢、staged object 損壞、附件中斷續跑、candidate 中斷續跑、已發布重試與持久化 provenance。這些是合成檔案／真實 SQLite 測試，沒有宣稱 Obsidian 或 Explorer 的桌面操作已驗證。

完整私人 corpus 驗證使用下列命令；每次 `--output` 必須是尚不存在的 repo 外目錄。它會先 hash 原 snapshot，再建立獨立副本，走匯入、分組、partial isolation、受控外部修改、完整 fallback、fresh DB rebuild、共享修改及 restart，最後重驗原 snapshot 與副本。執行狀態與有效結果須另行保存；本文件不預先宣稱這個命令已通過。

```powershell
node --import tsx scripts/verify-portable-roundtrip.ts --source="..\Acceptance\MainVault-Source" --output="..\Scratch\MainVault-M4-01"
```

`aggregate-results.json` 只供審查後發表彙總數據；`locations-private.json`、`source-before-private.json`、`Private-reports/`、資料及所有產物留在 repo 外。完整 fallback 與局部匯出的承諾不同，參見 [Projection contract](PROJECTION-CONTRACT.md)。

## 歷史 v0.2：160-note rehearsal

以下是先前版本的實際紀錄，保留供比較；舊 `.cache/phase2/rehearsal/` 與 `gitignored/main-vault-snapshot/` 是當時 locator，**不是目前建議的資料布局或啟動入口**。本輪沒有重新執行下列歷史 browser pass，也沒有把它升格成 M4 全量證據。

### Actual data and verified behavior

Forty feature-coverage seeds plus a bounded link closure selected **160 Markdown notes and 11 images**, totaling **6,784,617 bytes** in **44 folders**. They were copied before any migration experiment. Every copied file hash matches its original. The import retains note/folder identity, logical paths, raw frontmatter, Markdown, CRLF and attachments. No prose is automatically converted to records.

The private database is `.cache/phase2/rehearsal/MainVault-Verified.grasp.db`. It can be opened from the app's workspace dialog. Its sibling `.grasp.db.files` directory contains the persistent mirror and actual inbox/outbox. A separate `MainVault-Verified-Rebuilt.grasp.db` was created from the validated mirror with a new workspace UUID and the same note metadata and attachment hashes.

Programmatic rehearsal verified all 160 Markdown hashes and all 11 attachment hashes after import and reopen. Export/reparse yielded zero content changes. A controlled AI exchange changed one note, demonstrated nested reactive values (`Before` → `After`), then recovery restored **all original note hashes**. The final database reopened with the exact committed snapshot. Mirror verification and fresh-DB rebuild retained all note metadata and attachment bytes. Private detailed evidence: `verification-private.json`; public results: [migration-rehearsal.json](benchmarks/migration-rehearsal.json).

The subset has 730 link occurrences: 302 resolved, 9 external and 419 unresolved. Read-only resolution against the full 2,820-note / 506-asset source catalog explains **404 of those unresolved links as targets outside the selected subset**; 15 remain unresolved under the current Grasp resolver. Full-catalog parsing found 11,710 links: 11,399 resolved, 219 missing, 1 unsupported and 91 external, in 412 ms. These are current-parser results, not a claim of exact Obsidian compatibility; they differ from the earlier heuristic inventory. See [migration-links.json](benchmarks/migration-links.json).

The final manual browser pass used this real private database on port 43822: searched a deep note, located its folder breadcrumb, changed and restored its title, inspected resolved and missing links, selected the exact image source through the Links panel, verified the DB-backed image loaded, and viewed the real inbox/mirror paths and revision status. All 160 Markdown and 11 attachment hashes still matched the copied source afterward. A real host stop/start returned the exact post-UI snapshot; the browser reopened on the same note and folder. This is separate from the synthetic CRLF production E2E.

The final original-vault inventory still matched the baseline: **3,365 files, 254 directories, 557,533,195 bytes**, all content hashes and modification times unchanged, no symlinks followed. Manifest SHA-256: `816fffced7d391094e3101a745c404162e0bda14197c19cbc89c23cde749fe37`. The machine-readable manifest remains private.

### Preserved but not fully interpreted

- The subset contains two Excalidraw notes, two Mermaid notes and six math-pattern notes. Source is retained; those specialized renderers are not implemented. Pattern counts are a static inventory.
- Frontmatter remains Markdown source, not a typed metadata or record schema. Tags and repeated outlines remain readable/searchable text.
- `.obsidian` and tool/plugin directories are excluded. Plugin code and configurations are not executed or migrated.
- Missing/ambiguous links remain explicit; no target is guessed and no link text is silently rewritten after note moves/renames.
- Record candidates are repeated fields/section outlines, such as a named item's properties. Convert deliberately through the Records UI after deciding the desired fields; narrative, journal and long-form research stay notes. There is no automatic semantic extraction or class system.

舊 importer 的 512 MiB aggregate cap 與全 corpus `blobs[]` 保留方式，已由上方 M4 串流流程取代。歷史量測仍只描述它所對應的版本。
