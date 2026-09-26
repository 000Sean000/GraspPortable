# 第一版驗證紀錄

驗證日期：2026-09-27（Asia/Taipei）。成品為 Windows 上的本機瀏覽器 App，Node 24.18 + SQLite；E2E 使用真正的 production bundle、Edge 與磁碟 DB。測試 workspace 均隔離於 `.cache/`，未替換使用者資料。

| Core Requirements §13 | 實際證據 |
|---|---|
| 1. 啟動、建立／開啟 workspace | Production E2E 建立新 DB；store/API 測試關閉後重開、記住路徑、拒絕其他 DB 格式且原檔不變 |
| 2. Markdown 與 inline Live Preview | 同一 CodeMirror 表面；中文、heading/emphasis、selection、真實 clipboard、undo/redo、composition events 的瀏覽器測試 |
| 3–5. 字串、formatted/nested、affected updates | Production UI 修改 first 後 full/greeting 更新，無關值不重算；200 次 randomized differential comparison 對照 fresh graph |
| 6. Cycle / missing 不拖垮 App | Production UI 插入 cycle/missing 再修復；20k deep graph、cycle、150k references、輸出上限與惡意模板 tests |
| 7. Definition / references 定位 | 點值、References、Go to Definition；持有舊引用按鈕後插入四行，保存回應延遲時仍選到新位置，並可立即輸入修改 |
| 8. 重啟一致 | E2E 真正停止／啟動 host，snapshot notes/records/settings 完全相等，重新呈現值與 table |
| 9. Database authority | Runtime 只接受 committed snapshot；export 外部改動不影響 DB；過期 workspace/revision/token 拒絕；注入 transaction 中途失敗後無部分寫入 |
| 10–11. Markdown export / controlled import | 真實 browser download、外部編輯、before/after diff、明確套用、reactive table 更新、復原；malformed exchange 禁止套用 |
| 12. Correctness / performance | Core tests、production E2E、Node graph/query/store benchmarks 與 browser input evidence，見下方 |
| 13. 可局部替換 | [ARCHITECTURE.md](../ARCHITECTURE.md) 的 EditorAdapter、plain domain contracts、ValueGraph、RuntimeClient、WorkspaceStore、ExchangeService、HTTP host |
| 14. 限制清楚 | [LIMITATIONS.md](LIMITATIONS.md)：實體 IME、mobile/native package、全量 parsing、query 範圍等明確揭露 |

其他資料安全 E2E：提交已完成但回應延遲時繼續輸入／建立／切換筆記；HTTP 503 保留草稿並阻止覆蓋、離開提示與恢復重試；另一分頁切換 workspace 後拒絕舊頁寫入，兩個 DB 的內容均檢查。

## 可重跑指令與結果

- `npm run build`：TypeScript + browser/worker + server production bundle 通過。Client JS 約 601 kB（gzip 約 208 kB），Vite 的 500 kB 建議警告保留；不是 build error。
- `npm test`：54 tests / 8 files 通過。
- `npm run test:e2e`：9/9 通過（18.0 秒），無 skipped/flaky；[完整紀錄](benchmarks/e2e-results.json)。
- `node --expose-gc --import tsx scripts/benchmark.ts --vault "<MainVault directory>"`：已跑完整 synthetic cases 及唯讀 corpus；[PERFORMANCE.md](PERFORMANCE.md) 與 timestamp JSON 保存數值。
- `npm run package` → `node scripts/smoke-package.mjs`：通過。套件複製到 repository 外的臨時目錄，以已安裝 Node 啟動；檢查靜態資源、實際 DB 寫入、匯出與重新啟動一致。[成功紀錄](benchmarks/package-smoke.json)。既有版本目錄會拒絕覆蓋，避免混入日後使用者的 workspace；拒絕路徑也已驗證不改動既有檔案。

以上重跑指令適用 source checkout；交付 package 僅含執行所需檔案、使用文件與驗證證據，不需要 npm install。

Browser workload 為 12,001 個額外宣告、1,000 個 inline references。Source 25 次、Live Preview 12 次、cascade 周邊 12 次輸入以 automation-to-browser completion 計時，包含驅動 overhead。`beforeinput` 另外記錄真正與背景計算重疊的輸入數；不能把整組 cascade 樣本都稱為重疊輸入。最新原始值見 [editor-responsiveness.json](benchmarks/editor-responsiveness.json)。

MainVault 2,810 份 Markdown 的前後 manifest SHA-256 相同，只存匿名統計。舊語法未轉換，該 corpus 沒有本版 grammar 的 value definitions，因此實際 value-sync 壓力證據來自 synthetic Excel-like graph；不宣稱 legacy 相容性。

這些結果不代替使用者的寫作手感評估，也不宣稱完成實體中文選字、iPhone/iPad 或 macOS 實機驗證。下一輪最值得先評估 Editor 的選字、游標與 reference 呈現。
