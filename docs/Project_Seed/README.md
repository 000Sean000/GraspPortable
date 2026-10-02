---
title: GraspPortable — Project Seed Entry
version: 1.3.0
updated: 2026-10-02
scope: seed-routing-and-source-precedence
---

## Interface｜Project Seed 入口

Project Seed 只保存長期有效的產品方向、開發方法與架構規劃原則。動態進度、當前 Goal、benchmark 計畫、quota、commit 與 stop point 不屬於 Seed；它們由實際 source、當次已接受的 Plan 與 `docs/EXECUTION-STATE.md` 承載。

讀取順序：

1. Core Requirements：WHY、產品行為與穩定需求。
2. Core Development Method：Plan／Goal 決策邊界與開發方法。
3. Architecture Planning Guide：模組責任、owner／ports／依賴與跨環境接續。
4. 只有當前任務需要時，再讀實際 source、當次 Plan、contracts 與工作狀態。

## File_Name_Config

| Config identifier | Actual filename | 文件角色 |
| --- | --- | --- |
| CoreRequirementsFile | [GraspPortable-Core-Requirements-v1.0.0-rc.4.md](GraspPortable-Core-Requirements-v1.0.0-rc.4.md) | WHY、產品行為與穩定需求 |
| CoreDevelopmentMethodFile | [GraspPortable-Core-Development-Method-v1.0.0-rc.4.md](GraspPortable-Core-Development-Method-v1.0.0-rc.4.md) | Plan／Goal 決策邊界、驗證成本與技術選擇 |
| ArchitecturePlanningGuideFile | [graspportable-architecture-planning-guide-v1.0.0-rc.4.md](graspportable-architecture-planning-guide-v1.0.0-rc.4.md) | 模組 owner／ports／依賴、四維分類與 Coding 接續 |

版本變動只在此入口更新路由；active Project_Seed 不並列舊版。

## 來源優先順序

使用者最新明確決策優先，其次是本入口所指向的現行 Seed。實際 source 說明目前 implementation；當次 Plan／工作狀態說明目前正在做什麼。歷史驗證文件只描述其原版本事實，不自動形成新需求。

`docs/Design-References/Legacy-Grasp-Syntax/` 只保存歷史／Review candidate，不是現行產品 authority；與現行 Seed 衝突時，以現行 Seed 及後續明確決策為準。

## Seed 邊界

Seed 定義成果與重要責任，不固定 task-specific HOW：

- 性能以使用者可感知 UX 與產品 workload 為需求；benchmark、profiling、instrumentation、synthetic workload 與重複 trial 不是自動前置條件。
- 測試與驗證只做到足以保護本次 contract、資料安全與驗收結果；不因工程慣例自行擴張成獨立測試專案。
- 技術／架構候選可依 workload、平台方向、維護與 migration 成本直接比較；不要求先完整證明現行 stack 的每個 hotspot。
- 已存在的 implementation 是可重用資產，不是必須優先保留的技術決策。
- 會改變資料含義、public syntax、資料權威或不可逆 migration 的選擇仍由 Human 裁定。

Project Seed 不記錄 P0／P1 等階段進度，也不把任何一次 performance plan 固化成長期開發順序。
