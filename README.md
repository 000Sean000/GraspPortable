---
title: GraspPortable — .NET Rewrite Branch
version: 1.9.1
updated: 2026-10-03
scope: rewrite-branch-entry
---

## 從產品需求重新實作

`rewrite/dotnet` 已建立 Windows 試用版本。從根目錄執行 [Start-GraspPortable.cmd](Start-GraspPortable.cmd)，預設開啟獨立 FirstUI 測試 workspace；[操作說明](docs/Engineering/FirstUI-Quickstart.md)列出可體驗流程與資料位置。

Core／SQLite／HTTP 與 editor 回歸已通過，App／Host Release 發行成功並已在本機啟動。**Windows GUI／中文 IME／端到端流暢度尚未驗收，因此 S1 尚未全部通過**；詳見[驗證紀錄](docs/Engineering/S1-Validation.md)。目前停在使用者試用與必要修正，不自動開始 S2。

1. [本輪授權與工作狀態](docs/EXECUTION-STATE.md)：目前進度、證據、未完成與下一步。
2. [Project Seed](docs/Project_Seed/README.md)：產品 WHAT／WHY 與完整方向。
3. [Windows S1 計畫 rc.6](docs/Engineering/Implementation-Plan-v1.0.0-rc.6.md)：目標、四 Projects、接面、分期、可體驗驗收與有界測試。
4. [產品架構 rc.3](docs/Engineering/GraspPortable-Architecture-v1.0.0-rc.3.md)／[架構圖解 v1.1.0](docs/Engineering/GraspPortable-Architecture-Diagrams-v1.1.0.md)：依賴、程序、資料與交易。
5. [Engineering](docs/Engineering/README.md)：整體方法、目錄原則、主動 subagent 協作與技術決策。
6. [開發環境](docs/Engineering/Development-Environment.md)：Workspace／repository 邊界與本機觀測。

已接受語法基準見 [Syntax Review rc.4](docs/Engineering/Binding-Syntax-Review-v1.0.0-rc.4.md)，沿用使用者整體接受的 rc.3 profile：ASCII case-sensitive identifier、@ 只在定義左側、@code 區域、單層起始／marker 疊層、局部邊界 escape 及可設定 parsing allowlist。

舊 Prototype 固定來源為 [5ca1373](https://github.com/000Sean000/GraspPortable/tree/5ca1373dca91e16d9e161de498bf8fcaebac1031/)；[Reference](docs/Reference/README.md)僅按問題查考，[Originals](docs/Reference/Originals/README.md)保存來源，不作現行工作授權。Legacy1 不納入日常搜尋。
