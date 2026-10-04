---
title: GraspPortable — .NET Rewrite Branch
version: 1.15.0
updated: 2026-10-04
scope: rewrite-branch-entry
---

## Windows 筆記與資料表

`rewrite/dotnet` 已有 Windows Markdown workspace 試用版，含檔案樹、右鍵合併／拆分、長文屬性資料表與 Markdown table 轉換。最新 App／Host 已完成本機 publish；S4 已取得 15×8／81×5 表格轉換、分頁、view 保存、凍結與排序編輯的有限原生證據，完整 S3／S4 GUI 驗收仍進行中。[操作說明](docs/Engineering/FirstUI-Quickstart.md)提供啟動指令、操作入口、資料位置及既有 FirstUI 的遷移行為。

2026-10-04 已授權以 Goal 持續完成 **S1 → S2 Markdown 共同編輯／實際檔案樹 → S3 整理／恢復 → S4 長文屬性與凍結資料表**，並自行 commit／push。Markdown adapter／coordinator 已接入實際 Host：Markdown 承載已保存原文，SQLite 保存索引、計算、草稿與恢復日誌；舊 schema 1 DB 遷到新的相鄰資料夾並保留原資料。

S1 已有工程、Reading／補完及基本原生中文 IME 證據；IME／dirty 競態、剩餘 GUI 與端到端流暢度尚未完整驗收。已保留新增筆記、範例命名、引用導航、來源草稿及 Live Preview 修正；詳見 [S1 驗證紀錄](docs/Engineering/S1-Validation.md)。當前進度以執行狀態為準，不在 S1 自動停工。

[S2 驗證紀錄](docs/Engineering/S2-Validation.md)保存檔案樹建立／改名／搬移、外部更新、圖片／wiki 導航及重開的有限原生證據。[S3／S4 驗證紀錄](docs/Engineering/S3-S4-Validation.md)保存分組、Records／轉換的工程與有限原生結果，以及來源層效能；30 次完整 Markdown 提交 p95 334.1 ms 不包含 GUI 顯示時間。S1／S2 仍 PARTIAL，S3／S4 已接產品且原生驗收進行中，尚未宣告完成或使用者接受。需要原生量測時可明確傳入 launcher `-MeasurePerformance`，預設不開探針。

1. [本輪授權與工作狀態](docs/EXECUTION-STATE.md)：Goal、實作／驗證／接受、證據與 exact next step。
2. [Project Seed](docs/Project_Seed/README.md)：產品 WHAT／WHY、資料權威、長文欄位及共同編輯。
3. [實作計畫 rc.8](docs/Engineering/Implementation-Plan-v1.0.0-rc.8.md)：P0–S4 完成條件、接面、操作驗收與有界測試。
4. [產品架構 rc.5](docs/Engineering/GraspPortable-Architecture-v1.0.0-rc.5.md)／[圖解 v1.2.0](docs/Engineering/GraspPortable-Architecture-Diagrams-v1.2.0.md)：四 Projects、程序、來源／journal、Records 投影。
5. [Engineering](docs/Engineering/README.md)：方法、目錄原則、主動 subagent、技術結果。
6. [開發環境](docs/Engineering/Development-Environment.md)：Workspace／repository 與本機觀測。

[Syntax Review rc.5](docs/Engineering/Binding-Syntax-Review-v1.0.0-rc.5.md) 延續接受的 rc.3 profile：ASCII case-sensitive identifier、@ 僅左側、@code、單層起始／marker 疊層、局部邊界 escape、可設定 parsing allowlist。Records 使用同一語意引擎，不另造求值語言。

舊 Prototype 固定來源為 [5ca1373](https://github.com/000Sean000/GraspPortable/tree/5ca1373dca91e16d9e161de498bf8fcaebac1031/)；[Reference](docs/Reference/README.md)僅按問題查考，[Originals](docs/Reference/Originals/README.md)保存來源。Legacy1 不納入日常搜尋或工作指示。
