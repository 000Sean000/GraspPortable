---
title: GraspPortable — .NET Rewrite Branch
version: 1.11.0
updated: 2026-10-04
scope: rewrite-branch-entry
---

## Windows 筆記與資料表

`rewrite/dotnet` 已有 Windows FirstUI 試用版。執行 [Start-GraspPortable.cmd](Start-GraspPortable.cmd)，預設開啟獨立 FirstUI workspace；[操作說明](docs/Engineering/FirstUI-Quickstart.md)列出現有流程及資料位置。

2026-10-04 已授權以 Goal 持續完成 **S1 → S2 Markdown 共同編輯 → S3 整理／恢復 → S4 長文屬性與凍結資料表**，並自行 commit／push。目標採 Markdown 原文權威、SQLite 索引／計算／草稿／恢復日誌；目前既有 FirstUI 仍是 DB-based 實作，新增契約不可視為已完成。

S1 已有工程及部分真實 Windows UI 證據；原生中文 IME、剩餘 GUI 與端到端流暢度尚未完整驗收。已保留新增筆記、範例命名、引用導航、來源草稿及 Live Preview 修正；詳見 [S1 驗證紀錄](docs/Engineering/S1-Validation.md)。當前進度以執行狀態為準，不在 S1 自動停工。

1. [本輪授權與工作狀態](docs/EXECUTION-STATE.md)：Goal、實作／驗證／接受、證據與 exact next step。
2. [Project Seed](docs/Project_Seed/README.md)：產品 WHAT／WHY、資料權威、長文欄位及共同編輯。
3. [實作計畫 rc.7](docs/Engineering/Implementation-Plan-v1.0.0-rc.7.md)：P0–S4 完成條件、接面、操作驗收與有界測試。
4. [產品架構 rc.4](docs/Engineering/GraspPortable-Architecture-v1.0.0-rc.4.md)／[圖解 v1.2.0](docs/Engineering/GraspPortable-Architecture-Diagrams-v1.2.0.md)：四 Projects、程序、來源／journal、Records 投影。
5. [Engineering](docs/Engineering/README.md)：方法、目錄原則、主動 subagent、技術結果。
6. [開發環境](docs/Engineering/Development-Environment.md)：Workspace／repository 與本機觀測。

[Syntax Review rc.5](docs/Engineering/Binding-Syntax-Review-v1.0.0-rc.5.md) 延續接受的 rc.3 profile：ASCII case-sensitive identifier、@ 僅左側、@code、單層起始／marker 疊層、局部邊界 escape、可設定 parsing allowlist。Records 使用同一語意引擎，不另造求值語言。

舊 Prototype 固定來源為 [5ca1373](https://github.com/000Sean000/GraspPortable/tree/5ca1373dca91e16d9e161de498bf8fcaebac1031/)；[Reference](docs/Reference/README.md)僅按問題查考，[Originals](docs/Reference/Originals/README.md)保存來源。Legacy1 不納入日常搜尋或工作指示。
