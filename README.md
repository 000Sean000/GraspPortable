---
title: GraspPortable — .NET Rewrite Branch
version: 1.5.0
updated: 2026-10-03
scope: rewrite-branch-entry
---

## 從產品需求重新實作

本分支 `rewrite/dotnet` 為新版建立乾淨的文件起點。新版程式從零撰寫；原 Prototype 保存在 [master](https://github.com/000Sean000/GraspPortable/tree/5ca1373dca91e16d9e161de498bf8fcaebac1031/) 對應的固定來源版本，供歷史查考。本分支目前交付物只有文件。

先看 [專案架構圖解](docs/Engineering/GraspPortable-Architecture-Diagrams-v1.0.0.md)：程式碼依賴、Windows 執行配置與共享修改時序。

讀取入口：

1. [本輪決策與工作狀態](docs/EXECUTION-STATE.md)：平台範圍、目前授權與下一步。
2. [現行 Project Seed](docs/Project_Seed/README.md)：完整產品需求與 WHY。
3. [產品架構](docs/Engineering/GraspPortable-Architecture-v1.0.0-rc.2.md)：模組、執行、資料一致性與效能安排。
4. [工程入口](docs/Engineering/README.md)：整體方法、架構模型與實際技術決策分開路由。
5. [最早可查的兩份原始文件](docs/Reference/Originals/README.md)：rc.1 原文與來源。
6. [舊文件與 insight 索引](docs/Reference/README.md)：按問題讀取歷史參考。

本機環境已按新版 Workspace／repository 邊界確認，見 [開發環境](docs/Engineering/Development-Environment.md)。下一步先審閱 [Windows 實作規劃 rc.1](docs/Engineering/Implementation-Plan-v1.0.0-rc.1.md)：第一個可操作 UI、分階段完成判準及四組待決選項。產品程式仍未開始，等待使用者確認及實作授權。

本輪已選擇重新實作；最新使用者明確決策優先。Seed 保存完整產品目標；架構、進度與當次交付範圍另外記錄。
