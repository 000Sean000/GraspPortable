---
title: GraspPortable — Engineering Entry
version: 1.10.0
updated: 2026-10-04
scope: strategy-architecture-and-decision-routing
---

## 方法、架構與實際決策

[Project Seed](../Project_Seed/README.md)保存 WHAT／WHY；Engineering 分開保存方法、技術結果、架構及已接受計畫。2026-10-04 已授權同一 Goal 自主推進 P0–S4 及 commit／push；實際進度見 [EXECUTION-STATE](../EXECUTION-STATE.md)，文件接受不代表新增契約已實作。

| 類別 | 文件 | 責任 |
| --- | --- | --- |
| 現有試用入口 | [First UI／S2](FirstUI-Quickstart.md) | Markdown workspace 啟動、舊資料遷移、測試資料與限制 |
| S1 實際驗證 | [S1 Validation](S1-Validation.md) | 已執行工程／部分 Windows GUI 與未測範圍 |
| S2 實際驗證 | [S2 Validation](S2-Validation.md) | Markdown／檔案樹／右鍵工程及有限原生操作；區分已發行與後續 link codec |
| 開發方法 | [Method rc.11](GraspPortable-Core-Development-Method-v1.0.0-rc.11.md) | Goal、決策權、有界測試、subagent、全局檢視、Git／額度 |
| 架構規劃方法 | [Guide rc.9](graspportable-architecture-planning-guide-v1.0.0-rc.9.md) | Owner、ports、淺目錄、四維與接續 |
| 模型決策 | [Architecture Model v1.1.0](Decisions/Architecture-Model-v1.1.0.md) | Explicit Architecture 適配與跨檔邊界 |
| 產品架構 | [Architecture rc.5](GraspPortable-Architecture-v1.0.0-rc.5.md) | 四 Projects、Markdown authority、journal、Explorer／Records／Query |
| 圖解 | [Diagrams v1.2.0](GraspPortable-Architecture-Diagrams-v1.2.0.md) | 編譯／程序／可恢復提交／單一欄位來源 |
| 技術結果 | [Technology v1.2.0](Decisions/Technology-Selection-v1.2.0.md) | .NET／MAUI／Razor／CodeMirror／Host／SQLite 與檔案責任 |
| 已接受計畫 | [Implementation Plan rc.8](Implementation-Plan-v1.0.0-rc.8.md) | P0–S4、操作驗收、接面、效能、協作與停止位置 |
| 已接受語法 | [Syntax Review rc.5](Binding-Syntax-Review-v1.0.0-rc.5.md) | rc.3 profile、reference／context、Records 原文解析邊界 |
| 本機環境 | [Development Environment](Development-Environment.md) | Workspace／repository、工具及已觀測限制 |
| 動態工作狀態 | [EXECUTION-STATE](../EXECUTION-STATE.md) | Goal、進度、證據、阻礙及下一步 |

只保留一份現行路由；版本化文件的檔名與 frontmatter 同步，supersedes 記錄前版，舊內容由 Git 追溯，不建立平行「現行」副本。改 stack 不重寫通用方法，改產品語意回 Seed，動態進度只在工作狀態與驗證紀錄。
