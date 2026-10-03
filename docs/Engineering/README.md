---
title: GraspPortable — Engineering Entry
version: 1.2.0
updated: 2026-10-03
scope: strategy-architecture-and-decision-routing
---

## 整體方法、產品架構與實際決策

依 [Project Seed](../Project_Seed/README.md) 的 WHAT／WHY 規劃實作。方法描述如何思考與開發；模型決策記錄採用的模板與強度；產品架構配置實際責任；技術選擇記錄具體 stack。

| 類別 | 文件 | 責任 |
| --- | --- | --- |
| 整體開發方法 | [Core Development Method rc.6](GraspPortable-Core-Development-Method-v1.0.0-rc.6.md) | 選型標準、流程、決策邊界及驗證方法 |
| 整體架構規劃方法 | [Architecture Planning Guide rc.7](graspportable-architecture-planning-guide-v1.0.0-rc.7.md) | 模組、資料歸屬、依賴與接續方法 |
| 架構模型決策 | [Architecture Model v1.0.0](Decisions/Architecture-Model-v1.0.0.md) | Explicit Architecture 的產品適配與取捨 |
| 產品架構 | [GraspPortable Architecture rc.1](GraspPortable-Architecture-v1.0.0-rc.1.md) | 模組、Windows 執行、資料一致性、效能與 project 配置 |
| 實際技術選擇結果 | [Technology Selection v1.1.0](Decisions/Technology-Selection-v1.1.0.md) | 本次 stack、執行配置及待驗證事項 |
| 動態工作狀態 | [工作狀態](../EXECUTION-STATE.md) | 目前授權、進度與下一步 |

表內文件各自維護：改變 stack 不必重写通用方法；產品語義改變則回到 Seed 處理。架構目前為文件基準，所有模組尚待實作。
