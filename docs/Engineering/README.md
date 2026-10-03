---
title: GraspPortable — Engineering Entry
version: 1.7.0
updated: 2026-10-03
scope: strategy-architecture-and-decision-routing
---

## 整體方法、產品架構與實際決策

依 [Project Seed](../Project_Seed/README.md) 的 WHAT／WHY 規劃實作。方法描述如何思考與開發；模型決策記錄採用的模板與強度；產品架構配置實際責任；技術選擇記錄具體 stack。

| 類別 | 文件 | 責任 |
| --- | --- | --- |
| 整體開發方法 | [Core Development Method rc.9](GraspPortable-Core-Development-Method-v1.0.0-rc.9.md) | 選型標準、流程、決策邊界及驗證方法 |
| 整體架構規劃方法 | [Architecture Planning Guide rc.7](graspportable-architecture-planning-guide-v1.0.0-rc.7.md) | 模組、資料歸屬、依賴與接續方法 |
| 架構模型決策 | [Architecture Model v1.0.1](Decisions/Architecture-Model-v1.0.1.md) | Explicit Architecture 的產品適配與取捨 |
| 產品架構 | [GraspPortable Architecture rc.2](GraspPortable-Architecture-v1.0.0-rc.2.md) | 模組、Windows 執行、資料一致性、效能與 project 配置 |
| 專案架構圖解 | [Architecture Diagrams v1.0.0](GraspPortable-Architecture-Diagrams-v1.0.0.md) | 程式碼依賴、Windows 執行配置與提交時序 |
| 實際技術選擇結果 | [Technology Selection v1.1.1](Decisions/Technology-Selection-v1.1.1.md) | 本次 stack、執行配置及待驗證事項 |
| 實作規劃（語法待確認） | [Implementation Plan rc.5](Implementation-Plan-v1.0.0-rc.5.md) | Projects／接面、第一個 UI、分期、Portable 評估、已接受暫定效能與決策狀態 |
| 語法修正版（待確認） | [Binding Syntax Review rc.3](Binding-Syntax-Review-v1.0.0-rc.3.md) | ASCII／@ 定義、單層起始／marker 疊層／局部邊界 escape、code fence allowlist、可替換 parser 與錯誤復原 |
| 本機開發環境 | [Development Environment](Development-Environment.md) | Workspace／repository 邊界、Git 基底、工具鏈實況及未驗證項 |
| 動態工作狀態 | [工作狀態](../EXECUTION-STATE.md) | 目前授權、進度與下一步 |

表內文件各自維護：改變 stack 不必重写通用方法；產品語義改變則回到 Seed 處理。架構目前為文件基準，所有模組尚待實作。

目前只授權環境初始化與規劃文件；使用者已接受部分產品決策及效能暫定門檻，見 Seed 和 Plan。Syntax Review 的補充方案仍待確認，不能把語法討論當成程式實作授權。
