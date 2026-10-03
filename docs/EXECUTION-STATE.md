---
title: GraspPortable — Rewrite Preparation State
version: 1.2.0
updated: 2026-10-03
scope: rewrite-decisions-and-current-authorization
---

## 目前成果

`rewrite/dotnet` 是文件準備分支，已選取現行 Seed 與有用的 Prototype 參考文件。新版架構尚未完成，程式尚未開始。

本次使用者授權：建立新 branch、複製仍適用的文件；先別寫程式。後續補充授權：Project Seed 只放產品需求與 WHY；HOW 移至 Seed 外，核對並保留最早文件。最新補充：Seed 明確保留 Excel 類型的高互動依賴關係、真實資料下 UI 流暢及未來成長的效能餘裕；整體方法策略與實際技術選擇結果分開。本次仍為文件整理。

## 已接受決策

- 新版在新 branch 從零設計與撰寫。沿用資產是文件與有效 insight；舊程式留在原分支供參考。
- 本次已選技術與其適用範圍獨立記錄於 [Technology Selection](Engineering/Decisions/Technology-Selection-v1.0.0.md)；整體方法策略由 [Engineering](Engineering/README.md) 路由。
- 目前交付 Windows PC 可用版本，盡量保持其他裝置相容與可攜性。Windows 交付範圍不構成產品只能使用 Windows 的限制；其他平台完成度依實際驗證記錄。
- 技術選擇依產品需求、效能餘裕、安全與長期適配判斷；沿用舊成果不計為選型加分。
- UI 流暢與資料安全是交付條件。功能／測試通過與實際 UX 達標分別判定。
- [Project Seed](Project_Seed/README.md) 保存所有產品需求與願望；完成／未完成、階段與 release 範圍屬工作文件。
- P0 僅提供能幫助選型與架構的既有發現。架構規劃與新版開發依下一次授權開始。

## 歷史文件的使用

[參考索引](Reference/README.md) 收錄語法、共享、projection 契約以及 M1–M4／P0 紀錄。來源固定為 `5ca1373dca91e16d9e161de498bf8fcaebac1031`。

舊契約中「已接受」「候選」「工程建議」與觀測結果維持原有區別。與目前使用者決策及現行 Seed 衝突時，以現行決策為準。歷史測試 HOW、next step、舊 source map 或執行命令屬原版本背景；新版的實作順序與驗證範圍由新計畫建立。

P0 報告部分段落早於最後停工紀錄：舊 EXECUTION-STATE 頂部記載 Trial-1R measurement 為 complete-with-measured-failures，matched recovery passed；P0 整體仍 partial，沒有完整三輪 baseline／最終 aggregate。Private raw evidence 只保留其既有 locator，本分支沒有取得或複製那些私人資料。

## 文件歸屬與來源

[Project Seed](Project_Seed/README.md) 保留 WHAT／WHY；[Engineering](Engineering/README.md) 承載 HOW。[原始來源索引](Reference/Originals/README.md) 保留 repo 最早可查的两份 rc.1 原文與 Git 來源；原始文字未修改。Core Requirements rc.6 明確保留三項效能要求並整理需求／方法邊界；工程方法移除舊 runtime 指名及程式沿用預設，前次移入的工作規則已整合到對應章節。既有技術方向移到獨立決策文件，尚未完成具體架構。

## 下一步

在下一次架構規劃授權下，依 Seed、已接受技術方向及相關 insight，定義模組責任、資料歸屬、執行／通訊、排程與 UI 響應、保存／故障復原及平台邊界。接著形成實作計畫。
