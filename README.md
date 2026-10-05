---
title: GraspPortable — .NET Rewrite Branch
version: 1.25.0
updated: 2026-10-05
scope: rewrite-branch-entry
---

## Windows S4 候選版

目前Windows PC的P0–S4候選版已完成實作、必要有界工程／原生驗證，可開始使用者體驗。含Markdown筆記、實際檔案樹／右鍵、Obsidian共同編輯、衝突草稿、合併／拆分、備份還原，以及長文屬性／九型別／關聯／views／凍結資料表。Wiki及兩式Grasp參照在筆記與資料表保留可讀高亮和直接導航。

[**S4 交付與啟動清單**](docs/Engineering/S4-Candidate-Delivery.md)提供完整啟動指令、驗收workspace、操作、效能及限制；[操作說明](docs/Engineering/FirstUI-Quickstart.md)提供各功能細節。使用者接受尚待體驗，不宣稱完整Notion／Obsidian、任意日用規模或乾淨電腦Portable。

完整edit→visible兩組n5／n4最大617.7／664.2ms；暖機Records六次最大198.6ms。30次功能操作、獨立連續前台觀察、真實微軟注音、角色長文、三篇合併→Obsidian修改→拆分與durable draft restore已有證據，樣本範圍見交付文件。Markdown為已保存原文權威；SQLite保存索引、版本與草稿，journal保留可恢復提交。

最後文件／Git核對及Goal狀態以[執行狀態](docs/EXECUTION-STATE.md)與runtime為準。完成本次交付後停止等待體驗，不自行展開下一產品段。歷史驗證文件保留當時失敗與修正，新判定不追認未測範圍。

1. [本輪授權與工作狀態](docs/EXECUTION-STATE.md)：Goal、實作／驗證／接受、證據與 exact next step。
2. [Project Seed](docs/Project_Seed/README.md)：產品 WHAT／WHY、資料權威、長文欄位及共同編輯。
3. [現行實作計畫](docs/Engineering/README.md)：P0–S4 完成條件、接面、操作驗收與有界測試。
4. [產品架構 rc.6](docs/Engineering/GraspPortable-Architecture-v1.0.0-rc.6.md)／[圖解 v1.2.1](docs/Engineering/GraspPortable-Architecture-Diagrams-v1.2.1.md)：四 Projects、程序、來源／journal、Records 投影。
5. [Engineering](docs/Engineering/README.md)：方法、目錄原則、主動 subagent、技術結果。
6. [開發環境](docs/Engineering/Development-Environment.md)：Workspace／repository 與本機觀測。

[Syntax Review rc.6](docs/Engineering/Binding-Syntax-Review-v1.0.0-rc.6.md) 延續接受的 rc.3 profile：ASCII case-sensitive identifier、@ 僅左側、@code、單層起始／marker 疊層、局部邊界 escape、可設定 parsing allowlist。Records 使用同一語意引擎，不另造求值語言。

舊 Prototype 固定來源為 [5ca1373](https://github.com/000Sean000/GraspPortable/tree/5ca1373dca91e16d9e161de498bf8fcaebac1031/)；[Reference](docs/Reference/README.md)僅按問題查考，[Originals](docs/Reference/Originals/README.md)保存來源。Legacy1 不納入日常搜尋或工作指示。
