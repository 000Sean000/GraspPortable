---
title: GraspPortable — Technology Selection
version: 1.1.1
updated: 2026-10-03
status: accepted-direction-pending-implementation-validation
scope: dotnet-rewrite-technology-selection-result
supersedes: Technology-Selection-v1.1.0.md
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

Windows 採 MAUI Blazor Hybrid App 與獨立 ASP.NET Core 本機後端程序；App Client 以 loopback HTTP 傳遞 commands／queries，版本通知有可替換 channel。UI 的即時編輯狀態留在 editor，本機後端處理知識變更、計算與保存。

Solution／project 配置、模組責任、一致性與工作排程見 [產品架構 rc.2](../GraspPortable-Architecture-v1.0.0-rc.2.md)。這些是本次授權下的設計決定；尚未建立程式，通知協定、封裝及具體平台整合仍待實作確認。

選定技術尚不構成效能達標證據。目標資料與成長規模、目標裝置、互動延遲及可接受資源使用，將作為具體架構與驗收的依據；現有 P0／M4 僅提供其已觀測的 insight，見 [參考索引](../../Reference/README.md)。
