# Performance evidence

執行時間：2026-09-26T19:46:56.679Z。環境：v24.18.0 / win32 x64 / 13th Gen Intel(R) Core(TM) i9-13980HX。

重跑：

```sh
npm run benchmark
node --expose-gc --import tsx scripts/benchmark.ts --vault "<MainVault directory>"
```

完整數值與可機讀樣本：[benchmarks/latest.json](benchmarks/latest.json)。這是本機單輪量測，不是跨機保證；benchmark 內有 correctness assertions。Parse 與每次 update 都使用成品模組。

| Workload | Identifiers | Parse ms | Graph build ms | Reference index ms | Root edit graph ms |
|---|---:|---:|---:|---:|---:|
| Deep chain | 20,000 | 59.88 | 56.96 | 3.93 | 51.45 |
| Wide fan-out | 20,001 | 54.43 | 59.07 | 0.98 | 31.34 |
| Shared mixed graph | 15,001 | 39.6 | 29.17 | 1.41 | 36.39 |
| Formatted cascade | 5,000 | 10.55 | 12.15 | 0.53 | 13.38 |

- **小幅反覆更新**：10,004 個 identifiers，100 次修改每次只重算 4 個。Parse + graph median 26.32 ms / p95 30.79 ms；graph median 5.46 ms。仍會掃描文件與重建索引，並非已實作全文件 incremental parsing。
- **查找**：deep-chain graph 100,000 次 definition + references indexed lookup 共 10.14 ms（每次各一次，結果有 checksum）。
- **Structured query**：10,000 records / 30,000 fields，100 次篩選 median 1.4 ms / p95 1.83 ms；符合 3,334 筆，view 上限 200 筆。
- **Database reopen**：1867776 bytes；fresh app load + parse + graph 231.89 ms，warm reopen 232.1 ms。兩者皆用新的 engine；沒有清除 OS disk cache，所以不宣稱硬碟冷快取量測。
- **Memory**：固定 2,000-node graph 反覆替換 100 次，每 10 次強制 GC 後取樣，heap delta 0.05 MiB。RSS/heap 全樣本在 JSON；有限測試不等於沒有 memory leak。
- **Editor responsiveness**：另由瀏覽器 E2E 量測；這份 Node benchmark 不把 worker 計算時間當成輸入延遲。

已讀取 MainVault **2810 份 Markdown / 6164228 bytes**，檔案讀取 89.62 ms、Markdown parsing/reference discovery 369.97 ms。前後完整檔案 manifest SHA-256 相同。只保存匿名統計；沒有複製內容。現有舊語法不自動轉換，這不是 legacy value sync 相容性宣稱。

安全限制：每個 rendered value 最多 65,536 characters，graph cache 最多 16,777,216 characters；超出會顯示 limit error 並讓 App 保持可操作。Cycle/missing/duplicate 不執行任意程式碼；stale revision 被拒絕。
