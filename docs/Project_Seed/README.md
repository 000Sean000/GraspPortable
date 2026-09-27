---
title: GraspPortable — Project Seed Entry
version: 1.1.0
updated: 2026-09-27
scope: seed-routing-and-source-precedence
---

## Interface｜Project Seed 入口

目前產品方向與開發方法由 Core Requirements、Project Seed Addendum、Core Development Method 共同定義。

閱讀順序：

1. Core Requirements。
2. Project Seed Addendum。
3. Core Development Method。
4. 當次已接受的 Plan／工作狀態。

本次文件更新不是產品實作、語法 conformance 或 Goal 開工授權。正在 Plan 的工作仍等待使用者確認後才進 Goal。

## File_Name_Config

| Config identifier | Actual filename | 文件角色 |
| --- | --- | --- |
| CoreRequirementsFile | [GraspPortable-Core-Requirements-v1.0.0-rc.2.md](GraspPortable-Core-Requirements-v1.0.0-rc.2.md) | WHY、產品行為與驗收方向 |
| SeedAddendumFile | [GraspPortable-Project-Seed-Addendum-v1.0.0-rc.1.md](GraspPortable-Project-Seed-Addendum-v1.0.0-rc.1.md) | 對現行 Seed 的最新產品修正 |
| CoreDevelopmentMethodFile | [GraspPortable-Core-Development-Method-v1.0.0-rc.2.md](GraspPortable-Core-Development-Method-v1.0.0-rc.2.md) | Plan／Goal 決策邊界、工程方法與證據 |

本文的 Core Requirements、Project Seed Addendum、Core Development Method 分別指上述 mapping。版本變動在此集中更新路由。

## 來源優先順序

使用者最新明確決策優先。

Project Seed Addendum 對它明確列出的修正範圍，高於 rc.2 Core Requirements／Core Development Method；其餘未衝突內容繼續有效。當次 Plan 補充尚需討論的 contracts 與交付範圍。

實作文件及測試紀錄只說明其對應版本的事實，不因 Seed 修訂而自動變成新需求的完成證據。

目錄內兩份 rc.1 Core 文件保留原文作歷史交付，不再是新工作的有效 Seed。先前初始化 prompt 若仍直接指定它們，請改由本入口解析。

使用者提供的語法比對基底是 Definition rc.2、Reference Syntax rc.2、Config rc.1，皆為 Review candidate。本次來源是 2026-09-27 對話中的實際上傳及後續明確決策；不採用先前誤認的 rc.7。

這三份候選稿在使用者本機可能位於 `docs/Design-References/Legacy-Grasp-Syntax/`；本次遠端基底未包含該目錄，因此不建立指向不存在檔案的規範性連結，也不宣稱已替換本機版本。需要其完整語法細節時讀取實際提供的檔案；已被後續決策取代的規則，以現行 Seed 及 Addendum 為準。

## Goal 前仍要完成的語法校準

已定方向：

- 正文只保留兩種帶可讀值的 managed reference。
- Assignment 是 binding。
- Binding 沒有固定區域，可依使用者習慣放在 Note 中方便的位置。
- Binding 採 raw literal＋identifier 取值＋concatenation。
- Raw literal marker 需要 paired-delimiter autocomplete，降低輸入負擔。
- 真正 code 使用真實程式語言及 compiler／runtime；不與 Note binding 混為一層。

仍需校準的是 statement termination、多行 literal 邊界、空 literal／未賦值、首尾換行、delimiter 避碰、各 Markdown context 的解析與多行結果的正文呈現。

不存在必須先決定的固定 Binding outer container。Opening delimiter 是否與 `=` 同行屬排版選擇，不應成為資料語意。

不要把方向已接受寫成所有 parser／Obsidian 邊界已驗證。

跨來源定案／修改的詳細政策與一般 syntax parsing 分開處理。引用處讀到 cached value，不直接授予該 occurrence 共用值定案權。

## 文件使用與狀態

本目錄只存產品／方法及其入口。當次里程碑、待辦、完成比例、commit、quota 與 stop point 留在工作狀態文件；完整語法修訂、資料 migration 及程式更動仍需後續授權與驗證。
