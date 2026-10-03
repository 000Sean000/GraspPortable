---
title: GraspPortable — Prototype Reference Index
version: 1.0.0
updated: 2026-10-03
scope: historical-knowledge-and-evidence
---

## 保留可用知識，辨識原始脈絡

此處供新版規劃查考既有語義、反例與實測結果。现行需求见 [Project Seed](../Project_Seed/README.md)，当前授權见 [重寫狀態](../EXECUTION-STATE.md)。

所有副本來自 [Prototype 固定來源](https://github.com/000Sean000/GraspPortable/tree/5ca1373dca91e16d9e161de498bf8fcaebac1031/)，保留原文內容並補上歷史定位；相對 Markdown 連結指回同一固定來源，方便查閱未搬入的舊背景。這些連結不導入新版工作授權。

| 文件 | 查考價值 |
| --- | --- |
| [BINDING-EDITING-CONTRACT.md](Prototype/BINDING-EDITING-CONTRACT.md) | 語法、raw literal、escaping、source mapping 與編輯邊界；含當時候選方案 |
| [SHARED-VALUE-CONTRACT.md](Prototype/SHARED-VALUE-CONTRACT.md) | 共享修改、草稿、receipt、undo 與交易一致性；含舊版工程建議 |
| [PROJECTION-CONTRACT.md](Prototype/PROJECTION-CONTRACT.md) | 分組匯出、外部 review、fallback 與重建語意 |
| [REFERENCE-HOST-GATE.md](Prototype/REFERENCE-HOST-GATE.md) | 多行 reference 的宿主呈現反例與已作取捨 |
| [M1-VERIFICATION.md](Prototype/M1-VERIFICATION.md) | 語法／表示的實際發現與證據限制 |
| [M2-VERIFICATION.md](Prototype/M2-VERIFICATION.md) | 共享更新、草稿、並行與延遲紀錄 |
| [M3-VERIFICATION.md](Prototype/M3-VERIFICATION.md) | projection 與重建的已驗證流程 |
| [M4-VERIFICATION.md](Prototype/M4-VERIFICATION.md) | 真實資料往返、UI／shared commit／checkpoint 成本與未達標項目 |
| [PERFORMANCE.md](Prototype/PERFORMANCE.md) | 較早的計算、解析及 UI 結果，按原 workload 解讀 |
| [FILES-PERFORMANCE.md](Prototype/FILES-PERFORMANCE.md) | 舊 publisher 的檔案掃描與 manifest 成本 |
| [PERFORMANCE-BASELINE-P0.md](Prototype/PERFORMANCE-BASELINE-P0.md) | P0 部分測量、無效樣本、有效診斷與原始證據定位 |
| [PERFORMANCE-INSTRUMENTATION.md](Prototype/PERFORMANCE-INSTRUMENTATION.md) | P0 指標定義與歸因限制，供解讀舊結果 |
| [EXECUTION-STATE.md](Prototype/EXECUTION-STATE.md) | Prototype 最後停止狀態及 Trial-1R 較晚的完成／限制紀錄 |

表內是來源用途，不代表其所有舊工程方法都適用於新版。

## 可直接供架構規劃使用的 insight

- P0 修正後 synthetic diagnostic：Extreme Source／Live rAF p95 為 209.5／246 ms，另有 53 次小 API timeout 與 1 次 navigation timeout。這是該 synthetic run 的結果，rAF 是 proxy；沒有證明語言或 browser 引擎是單一根因。
- P0 instrumentation：DB、projection、filesystem 的邏輯 lanes 不等於獨立執行緒。Process-wide CPU 與 filesystem await 不能直接當成特定 span 的 CPU 或純磁碟耗時。
- M4：30 次小改中只重算 4 個 graph nodes，但整體 prepare p95 約 504.60 ms，graph 子階段 p95 約 20.06 ms。只看 graph 計算速度會漏掉解析、identity、cache materialization 等成本。
- M4：Source／Live 的 100 ms p95 目標與無 ≥200 ms long task 的目標未完全達成，通過 500 ms regression gate 不能代替產品 UX 達標。
- M4：note locate 約 9.09 s；完整 checkpoint 約 93.18／190.05 s。這些是原 run 的階段時間，與 typing latency 分開解讀。
- M1–M3：raw source/EOL、multiline reference、identity、草稿與共享版本、外部 review／完整重建有可查考反例與流程證據。新版仍需驗證自己的實作。

以上為原報告的摘錄與解讀，保留各自 workload、版本及限制。P0 的最後狀態以舊 EXECUTION-STATE 頂部較晚紀錄補充 P0 報告；原報告的歷史內容未重新認證。

舊架構、進度計畫、P0–P5 操作順序、source／tests／scripts、工具鏈與機器報告可由固定原分支來源查考；本分支只帶入上述有用文件與 Seed。
