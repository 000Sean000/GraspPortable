---
title: GraspPortable — Engineering Entry
version: 1.8.1
updated: 2026-10-03
scope: strategy-architecture-and-decision-routing
---

## 整體方法、產品架構與實際決策

[Project Seed](../Project_Seed/README.md)維護 WHAT／WHY；Engineering 分開保存整體方法、技術結果、架構及實作計畫。使用者已明確授權 S0–S1 程式實作；實際完成狀態見 [EXECUTION-STATE](../EXECUTION-STATE.md)。

| 類別 | 文件 | 責任 |
| --- | --- | --- |
| 本機試用入口 | [First UI 操作說明](FirstUI-Quickstart.md) | 啟動、測試 workspace、可體驗步驟與限制 |
| 實際驗證 | [S1 Validation](S1-Validation.md) | 已執行工程檢查、效能覆蓋、Windows GUI 待驗項目 |
| 開發方法 | [Core Development Method rc.10](GraspPortable-Core-Development-Method-v1.0.0-rc.10.md) | 決策權、有界驗證、主動 subagent 協作、全局檢視、Git |
| 架構規劃方法 | [Architecture Planning Guide rc.8](graspportable-architecture-planning-guide-v1.0.0-rc.8.md) | 模組、資料歸屬、淺目錄搭建原則、四維及接續 |
| 模型決策 | [Architecture Model v1.0.2](Decisions/Architecture-Model-v1.0.2.md) | Explicit Architecture 適配 |
| 產品架構 | [Architecture rc.3](GraspPortable-Architecture-v1.0.0-rc.3.md) | 模組、四 Projects、程序、資料一致性與效能 |
| 架構圖解 | [Diagrams v1.1.0](GraspPortable-Architecture-Diagrams-v1.1.0.md) | 編譯依賴、模組接面、Windows 程序及共享提交 |
| 技術結果 | [Technology Selection v1.1.2](Decisions/Technology-Selection-v1.1.2.md) | .NET／MAUI／Razor／CodeMirror／Host／SQLite |
| 已接受實作計畫 | [Implementation Plan rc.6](Implementation-Plan-v1.0.0-rc.6.md) | S0／S1a／S1b／S1c、可體驗項、接面、暫定效能及停止位置 |
| 已接受語法基準 | [Binding Syntax Review rc.4](Binding-Syntax-Review-v1.0.0-rc.4.md) | rc.3 profile 接受狀態、reference codec、context／policy 與可替換 parser |
| 開發環境 | [Development Environment](Development-Environment.md) | Workspace／repository、本機工具觀測與限制 |
| 動態執行狀態 | [EXECUTION-STATE](../EXECUTION-STATE.md) | 授權、實作／驗證／接受狀態、未完成及 exact next step |

只保留一份現行路由；版本化文件以 supersedes 記錄前版，舊內容由 Git 追溯。改 stack 不重寫通用方法，改產品語意回 Seed；動態進度不塞入長期需求。
