---
title: GraspPortable — .NET Rewrite Branch
version: 1.13.0
updated: 2026-10-04
scope: rewrite-branch-entry
---

## Windows 筆記與資料表

`rewrite/dotnet` 已有 Windows Markdown workspace 試用版，含實際檔案樹與右鍵檔案操作。[操作說明](docs/Engineering/FirstUI-Quickstart.md)提供目前已驗的 `S2-Review-1004` 啟動指令、資料位置及現有 FirstUI 的遷移行為。

2026-10-04 已授權以 Goal 持續完成 **S1 → S2 Markdown 共同編輯／實際檔案樹 → S3 整理／恢復 → S4 長文屬性與凍結資料表**，並自行 commit／push。Markdown adapter／coordinator 已接入實際 Host：Markdown 承載已保存原文，SQLite 保存索引、計算、草稿與恢復日誌；舊 schema 1 DB 遷到新的相鄰資料夾並保留原資料。

S1 已有工程、Reading／補完及基本原生中文 IME 證據；IME／dirty 競態、剩餘 GUI 與端到端流暢度尚未完整驗收。已保留新增筆記、範例命名、引用導航、來源草稿及 Live Preview 修正；詳見 [S1 驗證紀錄](docs/Engineering/S1-Validation.md)。當前進度以執行狀態為準，不在 S1 自動停工。

[S2 驗證紀錄](docs/Engineering/S2-Validation.md)保存檔案樹建立／改名／搬移、外部檔案更新及重開的有限原生操作證據；尚未完成 Obsidian GUI 交替、附件呈現／導航及量化效能。最新版 link codec 已有工程測試，尚待重新發布與 GUI；S1／S2 仍部分驗證，S3 進行中、S4 待實作，Goal 尚未完成。

1. [本輪授權與工作狀態](docs/EXECUTION-STATE.md)：Goal、實作／驗證／接受、證據與 exact next step。
2. [Project Seed](docs/Project_Seed/README.md)：產品 WHAT／WHY、資料權威、長文欄位及共同編輯。
3. [實作計畫 rc.8](docs/Engineering/Implementation-Plan-v1.0.0-rc.8.md)：P0–S4 完成條件、接面、操作驗收與有界測試。
4. [產品架構 rc.5](docs/Engineering/GraspPortable-Architecture-v1.0.0-rc.5.md)／[圖解 v1.2.0](docs/Engineering/GraspPortable-Architecture-Diagrams-v1.2.0.md)：四 Projects、程序、來源／journal、Records 投影。
5. [Engineering](docs/Engineering/README.md)：方法、目錄原則、主動 subagent、技術結果。
6. [開發環境](docs/Engineering/Development-Environment.md)：Workspace／repository 與本機觀測。

[Syntax Review rc.5](docs/Engineering/Binding-Syntax-Review-v1.0.0-rc.5.md) 延續接受的 rc.3 profile：ASCII case-sensitive identifier、@ 僅左側、@code、單層起始／marker 疊層、局部邊界 escape、可設定 parsing allowlist。Records 使用同一語意引擎，不另造求值語言。

舊 Prototype 固定來源為 [5ca1373](https://github.com/000Sean000/GraspPortable/tree/5ca1373dca91e16d9e161de498bf8fcaebac1031/)；[Reference](docs/Reference/README.md)僅按問題查考，[Originals](docs/Reference/Originals/README.md)保存來源。Legacy1 不納入日常搜尋或工作指示。
