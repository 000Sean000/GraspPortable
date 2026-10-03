---
title: GraspPortable — Earliest Repository Sources
version: 1.0.1
updated: 2026-10-03
scope: original-document-provenance
---

## 先辨認原始來源

目前 Git 紀錄中最早可查的兩份核心文件，是以下 rc.1。兩份副本保持原始 blob 完全不變；原文中的「current-working-baseline」描述當時狀態。現行需求由 [Project Seed](../../Project_Seed/README.md) 指定。

| 原始文件 | 性質 | 原始 blob |
| --- | --- | --- |
| [GraspPortable-Core-Requirements-v1.0.0-rc.1.md](GraspPortable-Core-Requirements-v1.0.0-rc.1.md) | 產品需求與 WHY 的最早可查基底；亦含當時階段與方法敘述 | `bde8f13528742df4a5ec8ae1664e27c861556424` |
| [GraspPortable-Core-Development-Method-v1.0.0-rc.1.md](GraspPortable-Core-Development-Method-v1.0.0-rc.1.md) | 開發授權、協作與工程 HOW 的最早可查基底 | `886f42f4d01ddfbe5a7aaf42acf37c0740020bb6` |

首次納入 repo 的 commit：[ea62c60](https://github.com/000Sean000/GraspPortable/commit/ea62c607373263121426819eff9fd06e4ce929b9)。Git 時間為 2026-09-26 20:01:59 UTC（台北 2026-09-27 04:01:59）；兩份文件的 updated 均為 2026-09-27。該 commit 的 Project_Seed 僅有這兩份文件。

此證據只確認 repo 中最早可查的版本，不能證明它们是使用者在 repo 外最初撰寫的原稿，也不能由 commit 作者判定文字由誰撰寫。

## 原始產品意圖的查核重點

Core Requirements rc.1 已明確記載：

- 正常 Markdown 書寫與同區 Live Preview，降低使用及維護負擔。
- 高度巢狀與交互引用在實際 Vault 上不能卡死。
- Value Sync 必須能承受 Excel 類型的高互動 dependency graph。
- 大量結構化資料不必拆成大量實體 Markdown 檔案。
- DB 為 runtime authority，Markdown 供外部 AI／工具交換。
- iPhone／iPad 的 App Runtime 與 PC 的 Programming Runtime 分工。
- 實作技術服務產品，能力可以局部替換。

因此回顧後續文件時，先檢查上述目的有沒有被弱化或遺漏，再核對後續使用者明確修改的需求。原始語法範例與階段限制不自動覆蓋後續決策。

## 後續整理文件的定位

rc.4 是後續修訂基底；rc.5 整理 WHAT／WHY 與 HOW 歸屬；rc.6 明確保留效能要求並分開整體方法與實際技術決策。Architecture Planning Guide 不在上述最早 commit 的 Seed 中，應歸為後續工程指引。Prototype contracts、P0／M1–M4 是後續工程與驗證資料，詳見 [參考索引](../README.md)。
