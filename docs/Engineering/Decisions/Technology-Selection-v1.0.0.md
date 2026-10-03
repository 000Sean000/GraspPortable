---
title: GraspPortable — Technology Selection
version: 1.0.0
updated: 2026-10-03
status: accepted-direction-pending-implementation-validation
scope: dotnet-rewrite-technology-selection-result
---

## 本次技術選擇結果

本文件承接原 [工作狀態](../../EXECUTION-STATE.md) 記錄的已選技術方向，獨立保存本次選型結果。產品需求見 [Project Seed](../../Project_Seed/README.md)；整體選型與開發方法見 [Engineering](../README.md)。

| 責任 | 已記錄的選擇 |
| --- | --- |
| 主要語言與平台 | C#／.NET 10 |
| 桌面 App 宿主與工作區 UI | .NET MAUI Blazor Hybrid／Razor |
| 筆記編輯器方向 | CodeMirror 6／TypeScript |
| Windows 本機後端 | ASP.NET Core Host／API |
| 本機持久化 | SQLite |

表內為本次重寫的技術方向；尚未完成新版實作與效能驗證。

## 選型所回應的需求

本次選型沿用使用者已接受的 C#／Blazor Hybrid 方向，服務高互動依賴計算、記憶體安全、真實資料下的 UI 流暢與成長餘裕。使用者熟悉 C#、Blazor 與 ASP.NET Web API；此處不另行補造各候選的 benchmark 排名或已通過的性能證據。

## 適用範圍與待完成設計

目前先交付 Windows PC；盡量保持其他裝置相容。其他平台的宿主、後端執行方式與可共用範圍，仍需依平台設計及驗證。

新版在 `rewrite/dotnet` 從零撰寫，沿用文件與有效 insight；舊程式保留在原分支作參考。

App／Host／Core／Persistence 是待架構規劃細化的責任草案。Solution／project 劃分、程序邊界、通訊、排程及 UI 與背景工作隔離，尚未定案。

選定技術尚不構成效能達標證據。目標資料與成長規模、目標裝置、互動延遲及可接受資源使用，將作為具體架構與驗收的依據；現有 P0／M4 僅提供其已觀測的 insight，見 [參考索引](../../Reference/README.md)。
