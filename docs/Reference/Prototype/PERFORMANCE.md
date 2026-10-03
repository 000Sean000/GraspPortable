> 歷史參考副本｜來源：[`master@5ca1373` 的 docs/PERFORMANCE.md](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/PERFORMANCE.md)。
> 本文的狀態、授權、next step、方法與測試結果屬舊 Prototype；新版工作範圍見 [重寫狀態](../../EXECUTION-STATE.md)。以下保留來源內容，僅將相對 Markdown 連結轉成固定來源連結。

# Performance evidence

數字來自本機獨立量測，不是跨機保證。以下把 v0.2 browser interaction、filesystem projection、migration rehearsal 與歷史 Node calculation baseline 分開；可機讀樣本保留 timestamp，不把不同階段的數字當成同一次測試。

## v0.2 browser 與檔案證據

| Workload | Evidence | 結果與範圍 |
| --- | --- | --- |
| 大量筆記導航 | [navigation-browser.json](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/benchmarks/navigation-browser.json) | 3,000 notes、2,275 同層、六層資料夾；最多掛載 80 筆；最新 E2E 搜尋輸入至結果可見的五個樣本 17.92–25.84 ms，含 automation overhead |
| 高 reference 寫作 | [editor-responsiveness.json](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/benchmarks/editor-responsiveness.json) | 2026-09-27T01:44:52Z，production Edge；12,001 個額外 declarations、1,000 inline references；Source 25 次輸入 p50 6.39 / p95 21.11 / max 47.95 ms |
| Live Preview 輸入 | 同上 | 12 個樣本 63.31–66.12 ms；cascade 周邊輸入 31.40–72.62 ms，其中 7 次 beforeinput 確實發生於背景計算尚未完成時；其餘樣本不能稱為重疊計算 |
| 大量 links | [PHASE2-VERIFICATION.md](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/PHASE2-VERIFICATION.md) M2 | 3,000 notes／9,000 links，Node cold index 68.56 ms、parser-cache reuse 17.36 ms；不是 DOM latency |
| Rename impact | 同文件 M3 | 12,000-node chain/cycle 的迭代結構分析 isolated run 143 ms；沒有為 impact 展開字串；full records browser 另有 10,000-record regression |
| Persistent mirror / AI folder | [files-latest.json](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/benchmarks/files-latest.json) | 2026-09-27T01:18:02Z，Node v24.19.0/win32；2,820 synthetic notes、6,318,510 Markdown bytes、100 records、一份 4 KiB attachment |

| File operation | Time | 實際寫入／重用 |
| --- | ---: | --- |
| Cold immutable mirror | 2,540.99 ms | 2,821 payload files written |
| Fresh conventional AI folder | 2,239.08 ms | 2,823 files，含 metadata/index |
| Warm one-note edit | 674.37 ms | 1 payload written、2,820 reused；manifest 1,254,355 bytes |
| Full verified rebuild read | 4,427.80 ms | 逐份讀取並驗證 bytes；沒有寫 DB |

Warm mirror 避免重寫其餘 2,819 notes 與附件，但仍掃描檔案 metadata 並發布完整 manifest/index。此成本在 DB commit 後非同步發生，不是 typing latency。Stat-signature cache 避免重複 hash 未變內容；rebuild 仍驗證所有 bytes。[完整檔案 benchmark 說明](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/FILES-PERFORMANCE.md)

Metadata-only title/folder/settings/attachment 更新可重用 knowledge result，browser/runtime regressions 驗證零重新計算。內容改變時，parser／reference index 仍全量重建，再由 graph 限縮 value recalculation；不可把它稱為完整 incremental parser。

## M5 bounded migration 樣本

[migration-rehearsal.json](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/benchmarks/migration-rehearsal.json) 記錄 2026-09-27T01:32:48Z 的單次 private rehearsal：160 notes、44 folders、11 assets，共 6,784,617 bytes；apply 128.55 ms、subset link index 74.16 ms、mirror 236.64 ms。這是一次已驗證資料 fidelity 的操作樣本，不是平均值或 typing latency。

[migration-links.json](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/benchmarks/migration-links.json) 是另一個唯讀完整 catalog audit：2,820 notes／506 assets 的 11,710 links 在 411.79 ms 完成解析，11,399 resolved、219 missing、1 unsupported、91 external。它沒有匯入完整 vault，也不表示所有 resolved formats 已有 renderer。

## v0.1 calculation baseline（保留歷史結果）

時間 2026-09-26T19:46:56.679Z；Node v24.18.0 / Windows x64 / Intel i9-13980HX。原始資料：[timestamp JSON](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/benchmarks/2026-09-26T19-46-56-679Z.json)、[latest graph baseline](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/benchmarks/latest.json)。這批數字並非 M4/M5 重新執行後的宣稱。

| Workload | Identifiers | Parse ms | Graph build ms | Reference index ms | Root edit graph ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Deep chain | 20,000 | 59.88 | 56.96 | 3.93 | 51.45 |
| Wide fan-out | 20,001 | 54.43 | 59.07 | 0.98 | 31.34 |
| Shared mixed graph | 15,001 | 39.60 | 29.17 | 1.41 | 36.39 |
| Formatted cascade | 5,000 | 10.55 | 12.15 | 0.53 | 13.38 |

- 10,004 identifiers 的 100 次小幅修改，每次只重新算 4 個：parse + graph median 26.32 / p95 30.79 ms；graph median 5.46 ms。
- Deep graph 的 100,000 次 definition + references indexed lookup 合計 10.14 ms，有 correctness checksum。
- 10,000 records／30,000 fields 的 100 次 query median 1.40 / p95 1.83 ms；符合 3,334 筆，inline view 上限 200，後續 M3 已新增完整分頁入口。
- 1,867,776-byte DB 的 fresh app load + parse + graph 231.89 ms，warm reopen 232.10 ms。皆重新建立 engine，沒有清 OS disk cache，不是硬碟冷快取測試。
- 固定 2,000-node graph 替換 100 次，每 10 次強制 GC 取樣，heap delta 0.05 MiB。有限樣本不等於沒有 memory leak。

歷史唯讀 corpus run 為 2,810 Markdown／6,164,228 bytes：read 89.62 ms，parse/reference discovery 369.97 ms，前後 manifest 相同。它與 Phase 2 提供的 2,820-note snapshot 是不同次輸入，不能混用數量。該 corpus 沒有本版 grammar 的 value definitions，不提供 legacy value-sync 相容性證明；reactive workload 使用 synthetic graphs。

## 重跑與解讀

~~~sh
npm run benchmark
node --expose-gc --import tsx scripts/benchmark.ts
node --import tsx scripts/benchmark-files.ts
npm run test:e2e
~~~

只有明確提供並授權唯讀 corpus 時才加 benchmark 的 --vault 參數。Private 路徑／內容不進公用結果。正式性能採樣避免同時執行其他 browser suite 或大型 benchmark；M4 的並行干擾曾造成 editor deadline failure，隔離後同一 1,500 ms regression budget 通過，沒有放寬門檻。

Value 最多 65,536 characters、cache 最多 16,777,216 characters；超限、cycle、missing 和 duplicate 會產生可檢查狀態。這些 limits 與 stale-revision protection 是正確性邊界，不是「任何規模都流暢」的承諾。
