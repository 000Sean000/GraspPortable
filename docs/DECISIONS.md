# 已採用的技術與產品決策

以下對應 v0.2 已實作及測試的 desktop app，不是下一輪的固定技術限制。核心 documents 定義需求；本文件解釋目前的產品與工程選擇。

| 決策 | 實際理由與代價 |
| --- | --- |
| TypeScript browser app + Node local host | Editor、domain、worker 使用同一套 plain contracts；目前 Windows 可直接啟動。未來 mobile/WebView 仍需 platform storage/files adapter 與實機驗證 |
| CodeMirror 6 adapter | 使用成熟的 selection、history、composition、viewport 能力，同區提供 source/Live Preview；不同 editor 可保留文字與 navigation 契約替換 |
| Raw source / editor position mapping | 真實 rehearsal 有 117／160 notes 使用 CRLF；adapter 保留原始 separators 與 BOM，集中轉換 raw UTF-16 offsets，並讓 undo 保存換行 metadata，避免 title-only edit 或跳轉改寫原文 |
| SQLite + Node 24 node:sqlite | Transaction、portable DB、optimistic revision 與 BLOB 共用單一 authority；Node SQLite API 僅在 store adapter，不讓 SQL/handle 進入 editor/domain |
| 穩定 note/folder/asset IDs | 邏輯資料夾與值 namespace 分離；移動筆記不換 ID。重複 note title 可保留並顯示連結歧義；同層 folder 名稱、附件路徑衝突則拒絕 |
| 窄字串 Value Language + dependency graph | 現有 string/formatted/nested requirements 可由無 side effects 的 grammar 完成。沒有因假想 arithmetic/runtime 建完整語言；語法仍為 provisional grasp-string-v1 |
| Web Worker + metadata-only reuse | 輸入留在 UI；worker 計算 committed content。Metadata-only 保存不重新解析 knowledge；真正 superseded 計算可終止並重建 worker，代價是失去該 worker cache |
| Bounded DOM + 全結果搜尋／分頁 | Navigation、identifiers/references/diagnostics、records/fields、files 都能查到全部結果；inline query 保留 200 列上限並提供全部結果入口，避免把整份 vault 一次掛進 DOM |
| Owner-aware semantic rename | 使用 parser 提供的精確 spans 和 record ownership，只改語意 token。Preview 顯示直接／下游影響與衝突；host 檢查投影後的儲存限制才發 token，apply 原子提交與 recovery |
| 獨立 note/asset link resolver | Wiki/Markdown paths、aliases、heading/block anchors 與 grasp-asset:ID 不映射成值 identifiers。歧義、缺失及未支援片段保留並報告，避免猜錯目標 |
| DB-owned immutable attachments | Metadata 進 snapshot、bytes 留在 SQLite，以 SHA256 去重並驗證。單檔 64 MiB；PNG/JPEG/GIF/WebP 可 inline，其餘下載，HTML/SVG 不作 active content 執行 |
| Immutable incremental mirror | 改一份筆記不重寫整個 vault 的 payload；完整 manifest/index 最後發布。外部編輯不被覆寫；仍需掃描檔案 metadata、寫完整 manifest，且目前不自動清除舊 revisions |
| Controlled file exchange / new-DB rebuild | Inbox 不自動匯入；review token 綁定 workspace/revision。已驗證 manifest/bytes 只能重建新 .db，保留 entities、換 workspace ID，原壞 DB 不覆寫 |
| Read-only bounded migration | 專用 CLI 先建立 private preview/report，再明確套用至新 DB；source paths/hashes/mtime 在套用前重查。保留 Markdown/frontmatter 與附件，不自動推導 records 或執行 plugins |
| Vite / Vitest / Playwright | Browser/worker 與 bundled Node host 分開產出；tests 包含 production Edge、磁碟 DB 與真正 host restart。Browser harness 使用各自的 Vite cache，避免並行測試互相污染 |

既有 DB 的 schema 升級先使用 VACUUM INTO 產生一致的獨立備份，驗證後在 write transaction 內再比對來源才改 schema。這是 SQLite 支援的 live backup 方式；不能用隨意複製正在寫入的 DB 取代。[SQLite 文件](https://www.sqlite.org/lang_vacuum.html)

Collection/filtered-field rename 若會破壞既有 grasp-query，目前以明確診斷阻止套用，保留 query source。跨越無法明確判斷的 dotted record ownership 也拒絕；不以 global regex 猜測改寫。這些限制列於 [LIMITATIONS.md](LIMITATIONS.md)。

Dependency versions 由 package-lock.json 鎖定，正常啟動不自動升級套件。產物保留第三方 notices。Editor 呈現、host、SQLite adapter 與 grammar 都可因實際使用回饋替換；穩定需求是 Note-first、DB authority、reference 語意、可回復的 controlled changes。

M5 已驗證 160-note private rehearsal 的 hashes、controlled exchange/recovery 與 mirror rebuild；production E2E 另驗證 CRLF 編輯、heading navigation、image preview、undo、restart 與 unchanged-file import。人工 private-workspace 操作及最終 package smoke 的交付狀態見 [VERIFICATION.md](VERIFICATION.md)。
