# 已知限制與下一個改進

- 本版交付 Windows 本機瀏覽器 host，尚無獨立 native 視窗、iOS/iPadOS 安裝包或 App Store 發布。核心 TypeScript App Runtime 不含 Node／Windows API；mobile 仍需要實作本機 SQLite／檔案 host adapter 並實機驗證。
- 中文文字、composition event、selection、copy/paste 與 undo/redo 有瀏覽器測試；尚未以實體 Windows 中文 IME 逐鍵選字，不能把合成事件當成完整硬體驗證。
- 字串 identifier 名稱目前使用英數／底線／點／連字號，第一字元英文字母或底線。沒有一般程式語言、class、loops、網路 side effects 或任意 dynamic reference。
- Source／Live Preview 都是同一 CodeMirror；一般 Markdown table 採對齊等寬樣式，尚非完整 rich table editor。`grasp-query` 才是 structured table widget。外部圖片需要網路且由瀏覽器載入；沒有 attachment 管理。
- Record query 僅 collection 與單欄位 exact equals；view 最多 200 筆，側欄／reference 結果有明確顯示上限。所有 records 保留在資料庫，尚未做完整資料表瀏覽器／分頁。
- 值最多 65,536 characters，cache 最多 16,777,216 characters。超限有診斷；不會展開無界字串。每次更新只重算 affected values，但 parser、索引與 HTTP snapshot 仍是全量處理；極大 workspace 會需要差量 transport／parser。
- 一個 host 同時開啟一個 workspace。多分頁可讀，但無即時協同；舊 workspace／revision 會拒絕寫入，草稿留在原分頁供另存。伺服器崩潰前尚未確認提交的瀏覽器草稿沒有自動持久化，關閉頁面前請確認保存狀態。
- Exchange 是自有 version 1 Markdown format。完整匯出只能回到原 workspace，plain Markdown 可新增筆記；不自動解讀 MainVault 的舊語法或進行 migration。record metadata 可讀但尚無專門給 AI 的單筆 projection。
- Recovery 快照存在同一 DB，能回復操作失誤但不等於離機備份；歷史不自動清除。關閉服務後備份 `.grasp.db`。

**建議下一個最小改進**：先依使用者實際寫作時的選字、游標移動與 reference 呈現感受改善 `EditorAdapter`，保留資料格式與 calculation。若真實大型 workspace 輸入延遲明顯，再用現有 evidence 定位差量 parsing／transport 的優先性。
