---
title: GraspPortable — P0–S4 Goal Execution State
version: 1.22.0
updated: 2026-10-04
scope: rewrite-decisions-current-authorization-and-checkpoints
---

## 目前授權與 Goal

最新平台觀測（2026-10-04，使用者手動恢復後）：`get_goal` 已確認 Goal 為 **active**，未完成。中斷期間曾為 usageLimited；GoalSupport 於 04:53:17（Asia/Taipei）兌換一次 reset，04:56:18 確認 ordinary usage recovered，當時 usage API 為 usedPercent 0、ordinaryUsageAllowed true、重置券剩 1。額度恢復時 Goal 仍為 usageLimited；使用者手動 resume 才恢復 active。監測程式沒有 resume 功能，不能宣稱 reset 已完成無人介入續跑。

上一已發行工作段取得 15×8／81×5 table import、view 保存、雙向凍結與排序中編輯的有限原生證據；新增 Wiki／Grasp 共用呈現與直接導航已有 reader／table／record card／完整 field、dirty guard、返回 collection 與一般 Wiki Enter 的有限原生證據；S3／S4 完整驗收仍未完成。使用者回報多個 dotnet.exe 錯誤視窗；Windows Application log 查到多次本專案測試 executable 的 unhandled exception（檔案鎖、備份驗證、symlink 權限），但尚不能把每個 dotnet.exe 視窗精確對應到某筆事件。未據此宣稱 App／Host 無崩潰；測試失敗輸出與事件來源仍須核對。本段 App／Host 已正常退出，程序皆不存在，前台已釋放。

2026-10-04 使用者明確要求 IMPLEMENT 已接受的 [P0–S4 計畫 rc.9](Engineering/Implementation-Plan-v1.0.0-rc.9.md)：完成 Windows S4 候選版，涵蓋完整筆記、Markdown 共同編輯、分組／恢復、長文屬性／關聯及凍結表格。主代理已建立本對話 Goal，狀態 **active**；沒有指定 token budget。

這次授權取代「S1 後停下／不自動 S2」「未授權 commit／push」舊停點。自行完成 coherent segment 的必要驗證、commit／push 至 `origin/rewrite/dotnet` 並核對；不 force push，不提交私人資料／credentials／驗收 workspace。每階段續作，只有 S4 全部完成條件成立才能標 Goal complete；使用者接受仍另記。

同意前台測試期間不干擾，電腦保持開機、不休眠／不鎖定；測試前提醒、完成後告知釋放。正常額度正式確認耗盡才可用重置券，不購買額度、不自動降模型或切換 Reserve；監測與兌換的實際能力另據工具結果記錄，不宣稱已驗證耗盡後自動續跑。

## 最新工作段：Wiki／Grasp 共用呈現與直接導航

進入本段時已核對的遠端 checkpoint 為 `62780134a29ab49f8d7a25de973e2f9b0e0041c6`。以下工作已實作、本機 publish 並通過有限必要原生流程；提交主題為 `fix: preserve wiki and reference navigation across record views`，實際 commit／push 結果以 Git 與交付核對為準。全 Goal 維持 `IN_PROGRESS`，未宣稱全部階段完成。

使用者新決策已歸檔 [Seed rc.13](Project_Seed/GraspPortable-Core-Requirements-v1.0.0-rc.13.md)、[Plan rc.9](Engineering/Implementation-Plan-v1.0.0-rc.9.md)及[Architecture rc.6](Engineering/GraspPortable-Architecture-v1.0.0-rc.6.md)：Live Preview 非編輯區隱藏 Wiki／Grasp syntax，以醒目連結呈現；單擊／聚焦 Enter 直接跳 target，Grasp 開 definition 所屬 file 並定位 block，不僅開 inspector。Cell／完整 field／record card 保留同樣渲染與跳轉，不能 flatten 純字。

Active source editing 仍露原 syntax，IME／dirty draft 保護不變。Host 投影 field 原始 source 上的 local reference metadata／來源版本，UI 共用 renderer，不把 disabled Grasp fence 轉成 managed link，不在求值 cache 再解析 Grasp；不擴張公式或同步。

主代理擁有 Host／Contracts／Home 與整合，editor_fix 擁有 editor／共用 renderer，ui_review 擁有 Records UI，docs_sync 歸檔必要文件。Links fixture 經公開服務準備至 revision 15，既有九篇筆記／檔案／草稿不變；fixture 準備不是 GUI 證據。

前輪原生 reader／table／card：Wiki alias 隱 syntax／highlight 後開 Source；多段 pure ref 到 `@LiveLinks.Message` 第 10 行並選中 identifier；table 短 pure ref 到 `@LiveLinks.Short` 第 15 行、Wiki 標題到可見 target heading；card 兩式短／多段 refs 保留空行／粗體／highlight，managed wiki 到 Message 第 10 行。

最新 publish（Host 11:47:31／App 11:47:38）包含 missing-origin 與 return-collection 修正。11:48–11:55 原生完整 Longform 預覽兩式多段／粗體／空行正確；加入未保存「 草稿保護驗收」後點 reference，dirty guard 阻止導航並保留文字。Ctrl+Z 恢復原文後，managed wiki 導向 Source 的 Message 定義，selected_text 為 `LiveLinks.Message`；側欄返回資料表仍為同一連結驗收 collection。完整 Links 欄位 Tab 聚焦 Wiki 有 outline，Enter 成功開 Source Reading 的導航目標 heading。未提交 fixture，workspace 仍 revision 15；App／Host 正常關閉後皆不存在，前台已釋放。

Editor build／test、RecordsService render 6 assertions 通過（UTF-16／origin／disabled／cache 非遞迴／update）。Missing-origin 保護已測試並 publish，但原生缺失來源案例及 Grasp Enter 尚未專項驗證，不以一般 Wiki Enter 代替。两輪探針為 `ui-20261004-034024.json`／`ui-20261004-034807.json`，有少量 Records query／switch 與一般 UI 樣本，仍不足 30 次代表操作；父層雙 rAF 不保證子 JS full paint，不宣稱完整可見延遲達標。完整有界證據及數字見 [S3／S4 Validation](Engineering/S3-S4-Validation.md)。

## 先前工作段：S4 真實樣本與共享來源修正

下列工作以 f3eb9ea 為基底，後續凍結／carrier／import 初始選取及 Records performance hooks 已由 checkpoint `62780134a29ab49f8d7a25de973e2f9b0e0041c6` 保存並推送。當時 App／Host 正常退出、前台已釋放；新 Wiki 工作及目前前台狀態以上方最新工作段與主代理通知為準。

原生 App 使用 `workspaces/S4-Acceptance-1004`：從 Mentors 第 1 張 15×8 表格預覽並建立獨立縱向 collection（revision 2），原始筆記仍在檔案樹。建立「角色職責」view，Name 升序並額外凍結一列／一欄（revision 3），關閉重開後設定保留。發現凍結 Name 標題被捲動欄標題覆蓋，已修層級並重新 publish；最新原生雙向捲動確認 Name 標題、第一列及 record title 維持固定。

排序中編輯 `Imported1.Name` 加入 `AA` 前綴（revision 4）：Triensa 移至首列而 key 不變；重開同一 cell 確認已保存，再恢復原文（revision 5），排序隨之恢復。長路徑擠壓 toolbar 已修；Records 模式提供返回筆記，側欄直接點 Triensa 可回到真正筆記。這些是有限原生流程，不代表九型別／關聯／全部長文卡片或性能已完成。

本段必要工程修正：generated Markdown 欄位中的手寫 binding 改名不走 shared value 入口，改走 source／field 確認流程以保留 ID；外部 raw 保留；RecordsKnowledge 16 groups、Core 162 fixtures 通過。Host 修正 option／record name 的 raw、generated property 與 cache 同一 journal；外部搬移按 ID 識別並調整相對 link，dirty draft 保留，自己的 echo 為 no-op。RecordsService 針對性 11 assertions、Coordinator 針對性 1 fixture 通過；考量 Upsert 同時修改 key／label 亦受 carrier 影響，另一次 baseline 45 assertions 通過，未擴大重跑全 suite。這批 carrier 修正尚未完成原生驗收，不以工程通過替代。

Aura 第 1 張 81×5 表以 key prefix `Aura` 預覽並建立新 collection 成功（revision 6），原來源仍列出。手動下拉選新 collection，從第 1／2 頁切到第 2／2 頁，首列 `Aura51` 可見。發現 import 完成後仍先顯示舊 collection，已修 `InitialCollectionId` 並 publish，尚待原生重驗。

Records 性能 hooks 已加入並 publish，尚無新版 hooks 的有效代表量測；當次 ui-20261004-030650.json 約 556.9 秒，但 input／noteSwitchFirst 各只有 1 sample，仍不足 30 次代表操作。來源層既有 30 次提交 p95 334.1 ms 不含 GUI。下一步補 native carrier／九型別與關聯、其他 S1／S2 缺口及有界原生量測，詳見 [S3／S4 Validation](Engineering/S3-S4-Validation.md)。S1／S2 PARTIAL、S3／S4 IN_PROGRESS、Goal active，使用者接受另記。

### 既有檔案樹及已推送整合基準

側邊欄依已接受 Seed rc.12／Plan rc.8／Architecture rc.5 呈現實際檔案樹，提供新增、改名、搬移、複製路徑及開啟／reveal；檔案操作保留 IDs、versions、journal／恢復。檔案目錄與 Records view 群組不同，不取代內容合併／拆分。建立資料夾／筆記、改名／搬移／重開及相對／wiki 圖片、wiki 導航已有有限原生證據，完整範圍仍未驗完。

已推送 f3eb9ea 工作段完成 Solution build 0 warnings／errors、Host／App publish；卡片粗體／清單／段落、Escape 關閉及回到 record 按鈕的焦點已重開驗證。備份 generation 選取亦已重驗，還原收據與畫面選取版本相同；該次前台已釋放，不代表目前工作段已釋放。受控測試入口保留 stacktrace／非零 exit，Content 50 pass，受控 fail 未新增對應 WER。

分組／Records／table import 的既有工程基準与來源層性能保存於 [S3／S4 Validation](Engineering/S3-S4-Validation.md)，S2 圖片／導航及備份原生結果見 [S2 Validation](Engineering/S2-Validation.md)。不因本段文件更新重跑整套已有工程測試。

## 已接受的重大契約

- Windows 為本次平台；iPhone／iPad、同步、Programming、rollup／通用公式不納入本次 Goal。
- 四 Projects 與 .NET 10／MAUI Blazor Hybrid／Razor／CodeMirror／獨立 ASP.NET Core Host／SQLite 沿用，Portable 優先、先目前 PC unpackaged。
- **Markdown 是已保存原文權威**；SQLite 管索引／計算／基底、durable drafts 及恢復日誌。原文保存、語意接受、跨檔回寫分開呈現；不完整語法保留原文及 last-good 狀態。
- 外部一般存檔自動解析；reference 顯示值變更用共同基底判別共享意圖，唯一 literal 才可自動回寫。Composition 不 flatten；dirty／IME、版本／身分不明及矛盾修改保留資料。
- YAML 保存必要 IDs／schema／定位，未知 metadata 保留。關閉 Host，重開 reconciliation；跨檔操作 journal／guards／receipt，不宣稱多檔 ACID。
- 分組实际合併／拆分檔案，保留成員身分及 metadata，接受 Obsidian 以實體檔為筆記的差異。新輸出及恢復材料驗證後才移除舊檔。
- 有變更每五分鐘及正常關閉 checkpoint，保留三份完整版本，可設定；新 generation 完整後才發布，restore 預設新 workspace。舊 DB-only 遷到新資料夾並保留原 DB。
- S4 型別：Markdown／文字、數字、布林、date-only、單選、多選、tag、單／多關聯。Null／空字串／零／false 分開，無效外部值保留原文及診斷。
- 欄位正文唯一來源；`RecordKey.FieldKey` 自動屬性提供計算後 Markdown，沿用名稱唯一性、相依、missing／cycle。Key 與中文顯示名分開，view 名不入 key，來源型別決定正確寫回位置。
- 寬表採 H2／H3／H4 縱向，次選 nested list；轉換後 headings 無 H1、深度超限不壓平，保留轉換原文／mapping。表格可固定標題行列、凍結前列欄，focus 按 IDs，分頁／虛擬化。
- 已接受 rc.3 syntax profile 由 [Syntax rc.6](Engineering/Binding-Syntax-Review-v1.0.0-rc.6.md) 維護，不重問既定語法；literal／reference cache／求值結果不遞迴解析。
- Wiki／Grasp 在非編輯區採可讀連結及單擊／Enter 直接導航，Grasp 定位定義 file／block；Records 各呈現面保持同等操作。Active source／IME／draft 與原始 source parsing 邊界保留。
- 暫定效能門檻及有界測試維持，不因「仍可操作」降低要求。普通工程選擇自行決定；同一問題兩輪無改善或驗證成本失衡時回頭檢視全局。

## 目前進度

| 階段 | 實作 | 必要驗證 | 使用者接受 |
| --- | --- | --- | --- |
| P0 | Implemented：以 62780134 續作；Wiki／Grasp UI 契約已歸檔並實作 | 本段 18 份文件／99 個本機檔案連結及 diff whitespace 核對通過；Grasp `:ref:` 範例不視為檔案路徑 | 最新計畫已明確接受 |
| S0 既有啟動主幹 | Implemented | 先前 build／publish／App＋Host 啟動及工程驗證 | 不等於 S1 UX 接受 |
| S1 | PARTIAL：Reading 保留定義排版、delimiter 配對／同步與基本原生 IME 已驗 | Core 162、Host HTTP 34、editor 回歸、架構檢查、Host／App Release 發行通過；IME／dirty 競態、policy GUI、DPI、量化端到端仍待驗 | 尚未宣告接受 |
| S2 | PARTIAL：Markdown adapter／coordinator、protocol 3、實際檔案樹／右鍵、來源處理、圖片／link 及舊 DB 複製遷移已實作 | 工程及 Windows GUI 部分通過；實際 Obsidian 交替、衝突 UI、完整附件／link 流程與 GUI 效能尚待驗；來源層量測見 S3／S4 Validation | 範圍已接受，成品未接受 |
| S3 | IN_PROGRESS：backup／restore、排程、實體檔案合併／拆分及其 API／UI／恢復已整合 | backup primitive 39 assertions／manager 9 groups；分組工程測試與真 link／backup 整合通過；備份選單已原生重驗；合併／拆分其餘原生操作待驗 | 同上 |
| S4a–c | IN_PROGRESS：Records codec／Knowledge／Host、九型別、長文卡片／關聯、凍結／分頁／視圖 UI 及 table import 已整合並本機發行 | 15×8 import、view／凍結保存、雙向固定與排序編輯已有限原生驗證；Aura 81×5 import／兩頁切換已原生驗證；Wiki／Grasp 各呈現面與部分鍵盤／dirty guard 已驗；九型別／關聯、其餘卡片／carrier、import 初始選取與足量 GUI 量測待驗，詳见 S3／S4 Validation | 同上 |

本表依 2026-10-04 本段 checkpoint 更新，主代理每完成實作段再接續。任何功能完成／測試 pass 需實際證據；文件升版不代表程式已切換資料權威。

## 歷史：2026-10-04 較早 S2 實際 checkpoint

以下保存當時結果與未完事項；最新實作狀態以上方進度表為準。

Markdown adapter／coordinator 已接入實際 Program，App／Host protocol 3。已保存 raw source 與最後接受的 AST／diagnostics 分開，無效外部來源標示 Stale；外部版本與 dirty draft 衝突保留資料。schema 1 舊 DB 遷移至新建相鄰 workspace，保留原環境。

Sources 59 assertions、MarkdownWorkspace 12 groups、Coordinator 7 groups（含真 watcher）、Migration 42 assertions、FileActions 15 fixtures、Host HTTP 35 assertions、FileOperations 62 assertions、Envelope 12 groups、ExternalEdits 15 fixtures／68 assertions 已通過；Core 162／SQLite 63 是本段較早通過結果。App／Host Release build／publish 已完成，該發行尚未包含最新版 link codec 與後續 tree 自動選取修正。完整邊界見 [S2 Validation](Engineering/S2-Validation.md)。

真實 Windows App 使用 `workspaces/S2-Review-1004`：Projects 右鍵建立資料夾、子資料夾建立 `右鍵新筆記.md`，貼中文與 TreeCheck 定義後保存，再改名為 `重新命名驗證.md`、搬移至 Notes。ID 前綴 `3d3aba5a`、正文及定義保留；shell 模擬外部修改值為「外部修改也保留身分」後 GUI 同步。正常關閉／重開，搜尋並開啟筆記，確認同一 ID、值與路徑。App 已關閉，前台釋放。

以上不是 Obsidian GUI 交替編輯，也沒有當時的原生 IME 重測或量化效能結果。該歷史 checkpoint 尚未量測跨檔 journal／完整 snapshot 成本，當時 S3 持續整合、S4 尚待實作；目前已整合並有來源層量測，狀態以上方表格為準。

## 歷史：2026-10-04 較早 S3 備份整合 checkpoint

以下「獨立底層／尚未構成 UI」是當時狀態；目前已接產品並取得上方列出的有限原生證據，完整驗收仍未完成。

已接入手動／有變更定時 checkpoint、設定、正常關閉前備份及還原至新 workspace。Sources 59、Coordinator 7、App Release build 重新通過；Host HTTP 擴充為 43 assertions，實際啟動還原 Host 驗證 raw source、較新 draft、last-good identity 與備份設定。

整合測試曾發現新還原資料夾缺少啟動檢查所需的 `.grasp.lock`，導致 Host 啟動失敗；已在還原驗證後、發布前建立新的空鎖檔，原 runtime lock 仍不備份。針對性 regression 與 HTTP 全流程已通過。備份 manager 修正外部通知未抵達時的關閉備份及設定變更跨重啟的 dirty 偵測，9 groups 通過；primitive 39 assertions 通過。這不是原生備份／還原 GUI 驗收。

GroupedNoteCodec 12 fixtures、Records codec 44 assertions 當時已完成；在該 checkpoint 仍為獨立底層，未接合併／拆分或資料表 UI。分組未閉合 fence 會拒絕自動改寫，原文／草稿仍保存。Records 保留原始欄位及 typed projection，复杂 heading 轉換無法保證時明示診斷。

本次額度快照：帳戶共用七日窗口 usedPercent 75%，ordinaryUsageAllowed=true，兩張重置券仍可用。與本 Goal 起始 37% 同窗口差值為 38 個百分點，不能當作本任務精確計費；監測尚未兌換。

## 歷史：2026-10-04 較早 S1 checkpoint

主代理已重新通過 Core 162 fixtures（含 authoritative binding region 的 raw UTF-16 與宿主停用區排除）、Host HTTP 34 assertions、四專案架構檢查、Host／App Release publish，以及真 CodeMirror regression（含未閉合前綴的實體鍵事件）。本段沒有重測或更新先前 SQLite／後端性能數字。

經 sky 操作真實 Windows App，Reading 的 `@code` 定義區保留換行、縮排及多段空行。在 FirstUI 新筆記「S1 補完與 IME 1004」以中文注音按鍵 s／u／3 形成「你」，Enter 提交、Esc 取消未完成組字；以 Ctrl+Space 切英文後驗證 `{}` 補對、`{{}}` 兩端同步、一次 Ctrl+Z 撤回兩端，插入 `pair-pass` 時游標位於 literal 內。中文組字期間刻意不介入 delimiter 補完。

完整語法提交後診斷清除；正常關閉／重開仍可見「你」與 `pair-pass`，Host 隨 App 正常關閉。前台已釋放。這是基本原生 IME 及有界編輯流程證據，**不是 IME／dirty 競態、allowlist GUI、DPI 或量化端到端全部通過**；S1 與 Goal 仍未完成。

## 既有成果與證據（截至 2026-10-03）

Windows FirstUI 可由 launcher 啟動。四 Projects、Core／SQLite／HTTP、editor regression、Release 發行已有成功紀錄；原生 UI 已操作新增筆記、編輯／撤銷、三模式、多段引用、兩層相依共享更新、導航、原文 rename、來源草稿保護及關閉重開。已保留 App／editor 相關修正與驗證文件，不 reset 或重建專案。

[S1 Validation](Engineering/S1-Validation.md) 保存上述歷史與本輪新增證據；以下數字屬 2026-10-03 基線。既有 Core 161、SQLite 63、HTTP／process 34 assertions 及一組 editor 回歸紀錄保留。曾測 backend prepare＋SQLite 小改 p95 0.77 ms、chain 1,000 32.02 ms、fan-out 10,000 210.48 ms，**不是本次跨檔／GUI／IME 端到端通過證據**。

Computer Use 舊 runtime 阻塞先前已解除並取得上述操作證據；目前可用能力仍依每次工具觀測，不用 API、DOM 或程序存活替代原生操作。基本原生 IME 已在 2026-10-04 補驗；完整快速切換／IME／dirty 競態、解析政策 GUI、不同縮放與端到端流暢度仍未全部驗收。

現有入口：[FirstUI／S2 操作說明](Engineering/FirstUI-Quickstart.md)。發行仍放在 `artifacts/FirstUI/App`／`Host`，目前 S2 原生驗收使用 `workspaces/S2-Review-1004`。`Start-GraspPortable.cmd` 預設仍是 `workspaces/FirstUI`；舊 DB-only workspace 由遷移流程複製至新的相鄰資料夾，不以舊測試資料冒充本次 Markdown 共同編輯證據。

## Workspace、資料與 Git 基線

Workspace：`C:\Users\ASUS\MyData\AgentWorkspace\All-of-Me\GraspProject\GraspPortableWorkspace`。Repository：其下 `GraspPortable/`，origin `https://github.com/000Sean000/GraspPortable.git`，branch `rewrite/dotnet`。P0 文件整合讀取 HEAD `f4830e757007401489e169e989ad500ae69b9119`；已有八個文件／App／editor 未提交修改，保留有效成果。動態狀態以 Git 為準，未 reset／搬移 repository。

歷史 checkpoint `522482affeb4979ac8a6e39b77a6a426f5b89725`、`afcf4ab1d2f1d07259e006d60dc9461f4336683f`、`62780134a29ab49f8d7a25de973e2f9b0e0041c6` 已核對 push；62780134 包含前段凍結／排序互動及 carrier 修正。其後 Wiki／Grasp UI 的本機發行、驗證及提交主題見最新工作段；續作先核對實際 HEAD／origin／工作目錄，不依本段基底猜測最新 hash。

根目錄 `AGENTS.md` 保存 Workspace／repository 角色、搜尋限定及主動協作，不在本 repository 追蹤。Legacy1 不盤點、不搜索、不修改；舊清理待辦無須接續。

使用者指定 `TestData/MainVault-Source` 已是副本，可按測試需求取用適量，不设無意義硬性上限、不整庫過度測試。四份 Markdown 與四張直接引用圖片已定點複製至忽略的 `workspaces/S4-Sample-Source`；Mentors 第 1 張 15×8 已在 S4-Acceptance-1004 原生轉換及編輯；Aura 81×5 已轉換並驗第二頁 `Aura51`；Mentors 第 2 張 15×3 仍只有解析統計、無錯誤。Triensa／Anria 的完整卡片、關聯與其餘真實樣本流程仍待驗。私人內容及本機 sample manifest 不提交。

目前分工：主代理擁有 Contracts／Host／Knowledge／跨檔一致性及整合；subagents 按指定不重疊檔案實作 editor 或歸檔文件。共享接面、DI、migration 單一 owner，主代理核對差異並執行必要整合驗證。

## 額度與工具觀測

2026-10-04 本段結束前，官方 usage API 回傳 weekly usedPercent 27（剩餘 73%）、ordinaryUsageAllowed true；窗口 10,080 分鐘，reset Unix 1791685406，剩餘重置券 1，未再兌換。這是帳戶共用額度，不是本段的精確費用；工作段基底為 62780134，成果及提交主題見上方。

2026-10-04 本輪起始帳戶共享七日窗口 usedPercent 約 37%，有兩張重置券；那是當時未消耗快照，不是本任務精確成本。04:53:17 已兌換一次，04:56:18 額度恢復但 Goal 未自動恢復；使用者手動 resume 後確認 active。後續狀態由主代理按工具觀測追加。

2026-10-04 01:45（Asia/Taipei），主代理審查後成功啟動本次 Goal 的 12 小時隱藏額度監測；觀測 poll 為 `no_confirmed_exhaustion`，未使用重置券。GoalSupport 工具位於 repository 外，交付時另列，不視為已由產品 Git 追蹤。

本機工具及先前故障由 [Development Environment](Engineering/Development-Environment.md) 保存。監測啟動及未耗盡輪詢成功不等於已驗證零額度後兌換／恢復平台回合。

## Exact next step

先完成本段文件及差異核對，依授權 commit／push 並核對 SHA；Wiki／Grasp 的 reader、cell、完整欄位、card、來源定位、field dirty guard、一般 Wiki Enter 與返回 collection 已有有限必要證據，不重跑完整流程。後續補 Grasp Enter／缺失來源的具體原生案例，再續驗 import 初始選取、carrier 修正、九型別／關聯及剩餘長文卡片。補 S3 合併／拆分其餘流程、S2 Obsidian 交替／衝突 UI，以及 S1 IME／dirty 競態、allowlist、DPI。Opt-in Records／UI 探針已有有限樣本，仍須取得至少 30 次代表操作及約五分鐘原生互動的完整證據；區分父元件更新與 child renderer ready，不拿來源層數字替代可見端到端延遲。只重測受影響項目，測試成本失衡即回頭檢視全局。本段前台已釋放，下次操作前另行提醒；未滿足全部完成條件不宣布 Goal complete。
