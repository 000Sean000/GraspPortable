---
title: GraspPortable — Rewrite Preparation State
version: 1.3.0
updated: 2026-10-03
scope: rewrite-decisions-and-current-authorization
---

## 目前成果

`rewrite/dotnet` 是文件準備分支，已選取現行 Seed 與有用的 Prototype 參考文件。新版架構初版已完成文件規劃，程式尚未開始。GitHub default branch 已確認為 rewrite/dotnet。

本次使用者授權：將 Explicit Architecture 調整成適合產品的方案；若無阻擋性的使用者決策則直接完成。本次涵蓋模型取捨、產品架構及文件同步，尚未授權開始程式實作。

Preflight 結果：現有需求足以決定此輪架構基準；沒有必須先由使用者補充的阻擋項。量化效能尺度及未定產品語義保持待決，具體清單見產品架構。

## 已接受決策

- 新版在新 branch 從零設計與撰寫。沿用資產是文件與有效 insight；舊程式留在原分支供參考。
- 本次已選技術與其適用範圍獨立記錄於 [Technology Selection](Engineering/Decisions/Technology-Selection-v1.1.0.md)；整體方法策略由 [Engineering](Engineering/README.md) 路由。
- 目前交付 Windows PC 可用版本，盡量保持其他裝置相容與可攜性。Windows 交付範圍不構成產品只能使用 Windows 的限制；其他平台完成度依實際驗證記錄。
- 技術選擇依產品需求、效能餘裕、安全與長期適配判斷；沿用舊成果不計為選型加分。
- UI 流暢與資料安全是交付條件。功能／測試通過與實際 UX 達標分別判定。
- [Project Seed](Project_Seed/README.md) 保存所有產品需求與願望；完成／未完成、階段與 release 範圍屬工作文件。
- P0 僅提供能幫助選型與架構的既有發現；本次沒有重跑 benchmark。
- 已依本輪授權選用 [產品適配的 Explicit Architecture](Engineering/Decisions/Architecture-Model-v1.0.0.md)：功能模組、Ports／Adapters、受控公開契約依賴、單一共享提交與可恢復通知。
- UI／UX 原型用於校準需求與技術，安排在架構之後；目前仍是文件階段。

## 歷史文件的使用

[參考索引](Reference/README.md) 收錄語法、共享、projection 契約以及 M1–M4／P0 紀錄。來源固定為 `5ca1373dca91e16d9e161de498bf8fcaebac1031`。

舊契約中「已接受」「候選」「工程建議」與觀測結果維持原有區別。與目前使用者決策及現行 Seed 衝突時，以現行決策為準。歷史測試 HOW、next step、舊 source map 或執行命令屬原版本背景；新版的實作順序與驗證範圍由新計畫建立。

P0 報告部分段落早於最後停工紀錄：舊 EXECUTION-STATE 頂部記載 Trial-1R measurement 為 complete-with-measured-failures，matched recovery passed；P0 整體仍 partial，沒有完整三輪 baseline／最終 aggregate。Private raw evidence 只保留其既有 locator，本分支沒有取得或複製那些私人資料。

## 文件歸屬與來源

[Project Seed](Project_Seed/README.md) 保留 WHAT／WHY；[Engineering](Engineering/README.md) 承載 HOW。[原始來源索引](Reference/Originals/README.md) 保留 repo 最早可查的两份 rc.1 原文與 Git 來源；原始文字未修改。Core Requirements rc.6 明確保留三項效能要求並整理需求／方法邊界；工程方法移除舊 runtime 指名及程式沿用預設，前次移入的工作規則已整合到對應章節。既有技術方向由獨立決策文件維護；[產品架構 rc.1](Engineering/GraspPortable-Architecture-v1.0.0-rc.1.md) 已補上模組、執行與一致性設計。

## 本次結果與驗證

模型與技術選擇分開保存，通用方法保持獨立。產品架構涵蓋整體功能地圖、Windows UI／本機後端程序、資料 owner、共享修改 transaction、增量工作與排程、匯出恢復、跨平台接面及 solution／project 配置。

本次檢查文件路由、需求覆蓋、版本、資料一致性流程與文件間狀態；沒有建立程式或執行產品測試。架構文件的性能與復原安排仍待實作驗證。

## 下一步

依使用者後續實作授權，將這份架構落實為 Windows 可操作的 UI／UX 驗證流程。先用既有資料與 insight 提出代表性 workload 與產品尺度，處理該流程真正涉及的未定語義，再實作必要模組；以操作回饋更新需求、技術決策與受影響的架構。
