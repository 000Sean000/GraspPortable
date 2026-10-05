---
title: GraspPortable — P0–S4 Goal Execution State
version: 1.41.0
updated: 2026-10-05
scope: rewrite-decisions-current-authorization-and-checkpoints
---

## 最新工作段：代表操作、暖機查詢與備份可見狀態（2026-10-05）

Goal active；窄視窗焦點修正已提交並核對遠端 `18743c5f39912f566a9a7b35db35945712723cf1`。接續完成30次具體原生功能操作，涵蓋編輯／undo／redo／兩層相依、模式與參照導航、長文卡片、view／搜尋／分頁及備份。私人操作ledger、採样範圍及限制見 S3-S4-Validation；不把選單子步驟或探針停止後的操作當效能樣本。

備份UI補齊既有計畫要求：最近完整版本時間、尚待備份變更、執行／失敗及更新狀態。Host以既有change counter提供唯讀HasPendingChanges，不改排程、journal或檔案權威。BackupManager10groups及架構／Release publish通過；原生確認pending→手動建立→目前沒有待備份變更，完整generation時間同步更新。上一輪操作期間的自動generation已核對captured revision88。

334秒補測中，首次Mentors query154.3ms、首次Aura switch212.2ms；6次暖機switch p95/max198.6ms、query193.7ms，本組符合200ms暫定門檻。前景frame max58.3ms，無≥200ms。小樣本不推論任意日用容量；完整edit→committed-visible尚待補足，commit-only188.2ms不代替該門檻。

兩轮正常關閉後App／Host零、Computer Use重設、前台釋放；workspace revision88、3份durable draft hash與原checkpoint相同，恢復資料保留。`Export-GraspPortable-SubagentReview.ps1`仍為原先未追蹤使用者檔，不執行／不夾帶。原worker完成唯讀驗收缺口核對及限定Host/tests修正，無active child工作。

## 最新授權：再次 Resume（2026-10-05）

使用者已明確允許繼續既有 Goal，runtime 核對為 active；先前暫停失效，不重建／縮減 scope。branch rewrite/dotnet、HEAD 與即時遠端皆為 `3037b2c043e4746316e08b8dfc95f39c6403b6b4`。產品 tracked working tree 起始無差異；新增未追蹤 `Export-GraspPortable-SubagentReview.ps1` 是本段開始前已有的外部 review 輔助檔，保留、不執行、不夾帶提交。App／Host 起始無存活程序。

已完成窄視窗焦點修正：150%／1064px 寬，Tab 到右側 Casual Role 標題原先被凍結 Name 欄遮住。沿原 Records worker 將 focus reveal 擴及標題／按鈕，header 不加入自身垂直遮擋；Markdown links 的 generation guard 保留。18 項直接 JS tests、架構及 App／Host Release publish 通過。Root 在 1064×894 原生重驗 Name→Symbol→Official→Casual，標題完整可見、Enter 開正確欄位、Escape 返回後焦點仍可見，未修改 schema 或原文。

正常關閉後 App／Host 程序零、Computer Use kernel 重設、前台釋放；三份 durable draft hash 全同、revision85未變，私人核對檔為 `workspaces/AcceptanceSupport/header-focus-1005-verification.json`。其他已通過流程未重跑，完整代表性效能與交付審核仍待完成，Goal active。

## 歷史授權：使用者再次要求暫停（2026-10-05）

使用者在本次 UX 修正原生重驗時要求「稍微準備暫停一下」。完成已開始的新增筆記 departure／表單保留及 Records 捲動位置修正、必要測試／publish／有限原生重驗，更新 checkpoint 並提交推送後暫停既有 Goal。不開始下一工作段，不標 complete、不重建或縮減 Goal；實際 paused 狀態由 runtime pause 後重新核對。

工程：DraftDeparture 109 assertions、Records UI 33 fixtures、Records JS 16 tests、架構及 App／Host Release publish 通過。原生確認新增前先處理衝突、保留草稿後開表單；換表回第一筆第一欄，換頁回該頁首筆且保留橫向。晚到衝突保留有 fixtures，未追加原生競態。詳見 S3／S4 Validation。三份既有 durable drafts／revision 85／新增驗收筆記及全部恢復材料保留，無資料重設。

正常關閉後 App／Host（含 dotnet Host）程序零；Computer Use kernel 已重設、前台釋放，worker 全部完成。`workspaces/AcceptanceSupport/pause-1005-navigation-verification.json` 核對三份草稿 SHA-256 不變，私人資料不進 Git。工作段文件、程式及 targeted fixtures 一起提交，未夾帶其他產品段。

## 本輪復工核對（歷史，2026-10-05）

使用者已正式恢復產品開發，關機前暫停指示失效；既有完整 P0–S4 Goal 工具確認 active，不重建或縮減範圍。Repository／origin 不變，branch rewrite/dotnet；HEAD 與即時 ls-remote 均為 `574dc16c71e1272209b5fb909a121e3b34704ae0`，working tree 起始乾淨，前次成果確已推送。

最小 runtime 核對：沒有 App、Host（含 dotnet Host）、Computer Use helper 或前次 profiling 程序；無存活 child workers。既有 workspace lock 可取得且立即釋放，未刪檔；Host 使用動態 loopback port、endpoint 保存在 App session 記憶體，無固定 port／磁碟 endpoint 待清理。三份 durable draft JSON hash 與關機 checkpoint 相同。沒有 reset、清 DB 或重跑已通過驗證。

直接接續 Records 暖機渲染成本：Root 保有整合／GUI與共同狀態；依 policy rc.2 指派一位 Sol Medium worker，唯讀核對實際 Aura 首頁 250 格：239 個不同原文，僅空字串重複，且零 Grasp references；因此不新增 batch 快取。現接續無 metadata／無保留 carrier 的普通 Markdown 快速路徑，沿用相同 renderer 與 sanitizer，保留所有 managed content 原路徑；必要 differential fixtures 與實際樣本定位完成後再原生量測。舊 worker 本次 runtime 已不存在，因此提供最小必要交接。實際 child model metadata 仍未知，不以要求值代替。

## 已完成工作段：代表操作與兩項 UX 修正

以已核對遠端的 84ef5a0 接續，working tree 起始乾淨。代表原生操作已走通新筆記、真實注音／撤銷／Ctrl+Y 重做、兩層 composition 更新、兩段引用及 Wiki／定義導航、角色卡與凍結捲動、Aura 分頁／搜尋。workspace 現 revision 85，新增驗收筆記保留，三份既有 durable draft hash 不變。600 秒探針僅涵蓋較早筆記操作，後面的表格操作不冒充量測通過；完整 30 次／五分鐘代表操作仍缺。詳細有限結果見 S3／S4 Validation。

已完成原生發現的新增筆記遇衝突遺失待填標題，以及表格／分頁保留不相干捲動位置修正。Root 負責 Records、整合／GUI／文件；一位 Sol Medium worker 處理 Home 新增流程與直接 fixtures。不改資料權威、衝突語意、效能門檻或產品範圍。Goal active。

## 先前工作段：普通 Markdown 渲染快速路徑

復工基底 574dc16，普通 Markdown 無 References／Regions 且無保留引用 carrier 時，跳過 Grasp 專用 context／替換 DOM 建立，仍走同一 Markdown renderer 與 sanitizer；managed／未完成引用保持原路徑。沒有新增快取、修改頁數、遮蔽連結或放寬 paint 成功条件。Differential fixture 11 個一般／12 個 fallback 案例通過；editor／fastpath／Records batch 共 3 tests、TypeScript／bundle、架構及 Release publish 通過。

真實 Aura 首頁 250 格新舊 HTML 完全相同，五次 renderer-only 暖機中位數 23.9→12.0 ms；這是有界 headless 定位。原生報告 `ui-20261005-002714.json` 中 Aura 首次 207.5 ms、暖機 185.9／182.9 ms，Mentors 暖機 89.5／98.5 ms；兩次樣本低於 200 ms，但不足完整 p95／30 次代表操作判定。卡片兩張圖片、兩式多段參照、粗體／空行及點第二段定位來源第 10 行正常。App／Host 正常關閉、Computer Use 重設、前台已釋放；三份 durable draft hash 不變，revision 79 保留。Goal active，尚未使用者接受或 S4 完成。

## 歷史 checkpoint：關機前完整收尾（2026-10-05）

使用者明確要求完成目前工作段後暫停既有 P0–S4 Goal，供關機／移動電腦。本節取代下方較早 active／續跑指示；不縮減 scope、不標 complete。完成 Git checkpoint 及程序核對後使用 runtime pause，實際結果以工具回傳為準。未經後續 Resume 不啟動下一產品工作段。

基底為已核對遠端的 `b77f56dcf985b1950242f4fd847a1e155a50ddb2`。本段完成 Records 凍結區鍵盤焦點修正：依 sticky 行列的實際遮擋範圍捲動，保留 generation、導航與來源身分。3 項直接 JS tests、四 Project 架構及 App／Host publish 通過。125%／150% 原生表格與欄位對話框有界檢查完成；修正後在目前 150% 實際 Shift+Tab 露出 Wiki 焦點，Enter 正確顯示缺失目標，沒有改寫來源。125% 修正後焦點僅有合成測試，不擴稱原生重驗。

效能定位沒有證實 compact read/write 重複 layout；未採用收益不明的 direct-DOM 改造。Aura 暖機仍沿前次 211.4／229.4 ms 未達標。六處現行文件失效連結已修正；版本化規格僅連結勘誤，不變更契約。細節見 S3／S4 Validation。

正常關閉後 App／Host（含 dotnet Host）程序零；Computer Use kernel 已重設，worker 均完成或 interrupted，沒有 active worker。Windows 比例恢復並確認 150%、解析度 2560×1600。主 workspace revision 79 與三份 durable drafts 保留，全部 draft JSON SHA-256 和原基底相同；原還原 workspace、私人驗收材料與既有外部原文未清除。私人核對檔 `workspaces/AcceptanceSupport/shutdown-1005-focus-verification.json` 不進 Git。前台已釋放。

## 先前授權：routing 遷移後恢復產品開發

2026-10-05 使用者明確澄清：完成 routing 文件／設定遷移後，已讓原產品 Goal 繼續。此恢復授權取代下方暫停 checkpoint；保留完整 P0–S4 目標、既有 Git 授權與驗收門檻。Root 先前將 continuation 誤判為未授權而再次暫停，現在接續保留的四檔 Records 優化，沒有 reset、清除資料或重建 Goal。本次收到續跑後，get_goal 已確認 active；沿恢復授權持續推進，不再依較舊停工記錄暫停。使用者另確認本機採微軟注音、Shift 切換中／英文；IME 競態以此進行原生驗證。

前段優化已提交並核對遠端 `70a6f62f170566d4b2a70a7369986d6bbbca2b42`；本段從該 clean checkpoint 續作。主 workspace revision 77 與兩份 durable drafts 保留。前段 RecordsPanel 投影、WorkspaceRecords lookup 及 RecordsService fixtures 均已提交。必要 targeted tests 已取得 RecordsService 60 assertions 與 Records UI 21 fixtures；四 Project 架構檢查及新版 App／Host publish 通過。原生同流程 Aura 暖機 246.1／247.9 ms，較基線 261.1／254.1 ms 略降但仍未達 200 ms 門檻；Mentors 118.8／115.0 ms。Aura 第二頁身分與高亮正常；正常關閉後 App／Host 程序均無、前台已釋放。詳見 S3／S4 Validation；尚未通過完整效能或 S4。

## 最新工作段：IME 外部競態與 Records 分段定位

從已核對遠端 `409821e0899a05f150af87c5ae385ff20caaf63f` 續作，Goal active。以微軟注音真實按鍵確認組字期间外部修改不覆蓋 composition；Return 後保留兩版衝突，正常關閉、重開恢復中文及原基底。主 workspace 現為 revision 79、三份 durable drafts；所有 draft JSON 重開後 hash 不變，外部實體原文保留。詳見 S1 Validation。本案不代替其他時序、DPI 或整體 S4。

Records 新增只在原有效成功樣本附帶的三段 query 診斷，UI 29 fixtures、probe test、架構及 publish 通過。原生 Aura 暖機 227.3／232.1 ms，HTTP 合計約 22–24 ms、套用至 children ready 約 150–160 ms；仍未達 200 ms。Root 審查與操作，原 worker 延續已定位的渲染批次工作。正常關閉後 App／Host 程序零，前台釋放。下一步不擴張樣本或降低門檻；詳細數據見 S3／S4 Validation。

後續批次 render／cleanup 已整合：33 UI fixtures、2 JS tests、架構及 publish 通過。原生 Aura 暖機 211.4／229.4 ms，尚未達標；卡片圖片、兩式參照與第 10 行定義導航通過有限重驗。正常關閉後 App／Host 程序零，三份草稿 hash 不變。現已到可提交 checkpoint，產品 Goal 繼續 active。

## 先前工作段：Records module 共用與釋放

本段新增 panel-local module owner，cell leases 共用一個 import 且在最後清理後才釋放，包含尚在 import 時離開的處理。Records UI 26 fixtures、四 Project 架構檢查與 App／Host publish 通過。原生同流程 Aura 暖機 192.2／228.1 ms，仍未穩定通過 200 ms；Mentors 110.2／105.0 ms。型別驗收卡的圖片、兩式多段 Grasp 高亮及點擊定位來源第 10 行 LiveLinks.Message 通過有限重驗。正常關閉後 App／Host 程序零，前台已釋放；既有 drafts／revision 77 保留。Goal 已由工具確認 active，S4 尚未完成。

## 先前收工 checkpoint：依使用者要求暫停

2026-10-04 使用者要求在可告一段落時暫時收工。本段完成衝突草稿離開修正與必要核對後暫停 Goal，不再擴大測試；尚未達 S4 完成條件，使用者接受仍另記。以下較早段落的 active／待驗描述是歷史，續作以本節與文末為準。

從 `6977ba378d8a0b4ee9c7350e37de9f7ab4f95ddc` 續作。主驗收 workspace 已到 revision 77：長文屬性重新解析及 Anria 卡片圖片／Wiki 導航通過有限原生流程；外部修改與 dirty draft 衝突保持兩版本。修正合併視窗「稍後處理」原先無法正常退出的問題：保存右側新增內容，保留原版本基底，明確提交仍重新核對衝突。DraftDeparture 67 assertions、App Release build 及本機 publish 通過；原生正常關閉、重開恢復、再次明確保存的衝突提示已驗。

收工正常關閉後 App、Host executable 及 dotnet Host 均無程序，前台已釋放。唯讀核對 draft revision 2／base 76、最新原文 revision 77，右側新增文字與原基底完整保留；外部第二版同時存在 SavedSource.Text 與實體 Markdown；未接受的 ImeRaceDeferred 沒有發布成 definition。兩份 durable drafts 保留。私人證據：`workspaces/AcceptanceSupport/shutdown-checkpoint-verification.json`，不進 Git。

收工官方額度快照：ordinaryUsageAllowed true，七日窗口 usedPercent 13（剩餘 87%），reset Unix 1791708203，可用重置券 0。相較同窗口上一 checkpoint 5% 增加 8 個百分點，屬帳戶共享量，不是本任務精確成本。沒有啟動新監測或兌換。

效能仍未通過：本段探針上限 600 秒，但有效操作樣本少；Records query n=3、p95 491.3 ms，須區分首次及暖機查詢後再判斷，不降低 200 ms 暖機門檻。IME 本段按鍵未進入組字，不能把 dirty conflict 驗收當作 IME 競態通過。縮放／凍結區焦點與足量代表操作仍待驗。資料表 Wiki／Grasp 各呈現面的參照、高亮、隱語法、直接導航需求持續有效，既有有限原生證據見 S3／S4 Validation。

## 先前授權與 Goal 觀測

本次續作核對：一般額度可用，七日窗口 usedPercent 5（剩餘 95%），reset Unix 1791708203，可用重置券 0；未兌換。這是帳戶共用快照。長文修正的有界獨立 code review 無發現，未重跑已通過測試。`d9715a49bbaa383d43fd734199dde859b8c5f7ae` 已 commit／push 並以 ls-remote 核對；其後補驗結果如下。

前台另行提醒後，以既有三篇合成 workspace revision 7 開 Reader 的 Reading：兩段 new bold 都為粗體，保留段落及三層清單，整體 reference 隱藏語法／highlight；點第二段直接開 Projection.md 並定位欄位第 7 行。這補完 computed Markdown 的有界原生畫面及導航確認。正常 Alt+F4 後視窗消失，唯讀核對 App、Host exe 及 dotnet Host 均無程序，前台已釋放。主驗收 workspace revision 59 尚待目標來源重新解析，IME／DPI／足量效能與完整 S4 仍未通過。

最新平台觀測（2026-10-04）：原生捲動因額度耗盡未通過自動審核後，本對話收到 Goal continuation，`get_goal` 為 **active**，usage API 為 usedPercent 0、ordinaryUsageAllowed true、可用重置券 0；已實際恢復工具與 GUI 操作。GoalSupport 日誌 08:40:29 UTC 為 redemption_checked／ordinaryUsageAllowed true，08:43:31 UTC 為 reset_cap_reached／guard_exited，原 PID 31452 已不存在；不宣稱監測仍在執行，也未因券耗盡重啟兌換程式。先前 04:53 的 reset 曾仍需使用者手動 resume；本次續作成功不能保證所有平台中斷都能自動恢復。

上一已發行工作段取得 15×8／81×5 table import、view 保存、雙向凍結與排序中編輯的有限原生證據；新增 Wiki／Grasp 共用呈現與直接導航已有 reader／table／record card／完整 field、dirty guard、返回 collection 與一般 Wiki Enter 的有限原生證據；S3／S4 完整驗收仍未完成。使用者回報多個 dotnet.exe 錯誤視窗；Windows Application log 查到多次本專案測試 executable 的 unhandled exception（檔案鎖、備份驗證、symlink 權限），但尚不能把每個 dotnet.exe 視窗精確對應到某筆事件。未據此宣稱 App／Host 無崩潰；測試失敗輸出與事件來源仍須核對。本段 App／Host 已正常退出，程序皆不存在，前台已釋放。

2026-10-04 使用者明確要求 IMPLEMENT 已接受的 [P0–S4 計畫 rc.9](https://github.com/000Sean000/GraspPortable/blob/f634bcd9b650d89f57ff0d866a086612e7e2fc2e/docs/Engineering/Implementation-Plan-v1.0.0-rc.9.md)：完成 Windows S4 候選版，涵蓋完整筆記、Markdown 共同編輯、分組／恢復、長文屬性／關聯及凍結表格。主代理已建立本對話 Goal，狀態 **active**；沒有指定 token budget。

這次授權取代「S1 後停下／不自動 S2」「未授權 commit／push」舊停點。自行完成 coherent segment 的必要驗證、commit／push 至 `origin/rewrite/dotnet` 並核對；不 force push，不提交私人資料／credentials／驗收 workspace。每階段續作，只有 S4 全部完成條件成立才能標 Goal complete；使用者接受仍另記。

同意前台測試期間不干擾，電腦保持開機、不休眠／不鎖定；測試前提醒、完成後告知釋放。正常額度正式確認耗盡才可用重置券，不購買額度、不自動降模型或切換 Reserve；監測與兌換的實際能力另據工具結果記錄，不宣稱已驗證耗盡後自動續跑。

## 最新工作段：長文轉換、參照與外部往返

從已核對遠端 `fa17e97b8a4554af08282d62483eea70cbccdb6f` 續作。補上 Markdown 欄位保存前的標題轉換預覽與明確確認：H5／H6 放不下原層級時轉巢狀清單，保留 Wiki inline Markdown、圖片及 fence；原文和 heading mapping 隨既有 journal／同一提交保存為不可變恢復歷史。原文、版本或操作對象改變使 token 失效，未知結果保留同一 request／operation。沒有加入一鍵反向轉換，會改變多行 literal 空白的情況明確拒絕。

原生 Triensa 長文於 revision 58 完成預覽及套用，但當場抓到清單縮排被當 code 而漏掉 reference。已修 Markdown host context：扣除父清單縮排判斷真正 code，引用快取的跨行內容不改變外層 list 狀態；原始 UTF-16 ranges／換行不變，停用 fence 仍排除。再以受控外部檔案修改增加一段正文及兩式多段引用，revision 59 無診斷；原生卡片隱語法／highlight、粗體／空行正常，兩式都直接選中來源第 10 行 LiveLinks.Message。

正常關閉及重開後，唯讀核對同一欄位 definition ID／來源、兩張圖片、三個 reference、外部段落、僅一份轉換前原文恢復歷史；既有 rename durable draft JSON 完全相同。主 workspace 的全域相同 allowlist 重套被既有未完成來源正確拒絕，因此本案由目標筆記外部修改觸發重新解析，沒有清除 DB 或處理其他未完成原文。一般無 stale source 的相同 allowlist 重建已有工程測試。

重開相依筆記時另發現：整個長文屬性的 computed Markdown 沒有保留多段值的清單 continuation prefix，使後續粗體成為 indented code。已修正 Markdown generated field 的衍生輸出層，普通 composition、原始 source、reference cache 與 CR/LF 保留；增量比較和政策預覽包含 prefix。Core 167、Records 47、RecordsService 受影響三組 18 assertions 通過，同版 renderer 核對兩段 strong、零 code block。最新 App／Host 已 publish；原生合成案例啟動後遭使用者 Esc 中止，最後畫面尚未確認，不能宣稱完整長文流程通過。主驗收 workspace revision 59 尚須目標來源重新解析，不能把新 binary 當已重建索引。

本段已補 missing record／definition 原生拒絕及恢復（54–57），另以單篇合成 workspace 驗 allowlist 預覽／套用，詳見 S1／S3-S4 Validation。私人原文、資料庫和報告均不進 Git。本輪捲動曾因自動審核額度耗盡而未執行；收到 Goal continuation 後 usage API 確認 ordinaryUsageAllowed true、usedPercent 0、可用重置券 0，Goal active，正常工具恢復。這是本次觀測，不保證所有平台中斷都可自行續跑。

主驗收 workspace 已正常關閉；其後的小型合成案例前台測試被 Esc 中止。續作只做背景審查與文件整理，唯讀程序核對為 App PID 16788 仍在、未見 Host；不宣稱這次已正常關閉或新畫面驗收通過。Goal active，S1／S2 PARTIAL、S3／S4 IN_PROGRESS。不要重做已通過的 missing、基本 allowlist、兩式卡片 reference 導航及本段身分／草稿核對；最新待辦統一見文末 Exact next step。

## 已完成工作段：第二 view、表格連結與量測結果保護

从遠端已核對的 `90ad6f72b42f19ea8de75a34b8d7af403d84b03b` 續作。在同一獨立驗收 workspace 建立「角色篩選驗收」view，隱藏 Symbol、Name contains Triensa，revision 51；修改 Triensa 的 Name 後篩選結果變零筆（52），切回原 view 確认只改同 record，再恢復 Wiki 原文（53）。新版重開後第二 view 仍顯示 1／15 筆、七欄，原角色職責 view 保留八欄及凍結設定。

表格 cell 的 Wiki 與 Grasp reference 仍隱藏語法及 highlight；點 Wiki 開改名後來源，點 reference 選中同來源第 15 行 LiveLinks.Short。Mentors 的短名稱 Wiki 在本次有限取樣 workspace 缺失，點擊明示找不到目標並停留原表，沒有猜測其他同類角色檔。此案是 missing Wiki，不代替 missing record／definition 原生驗收。

量測修正由 editor_fix／ui_review 分別處理 Home／JS 與 Records，主代理整合。只有成功套用的結果才送成功 span，兩次 rAF 均核對前景、輸入世代與實際 DOM token；Records 保留既有 child-ready barrier。raw samples 上限改為 180,000，count／max／200 ms 停頓數在上限後仍累計；p95 清楚標明資料範圍。定點 probe／Records fixtures、editor tests、Release build、架構檢查與 publish 通過。量測例外不改變正常保存或離開結果。

15:49–15:53 原生重開及導航取得 `ui-20261004-074913.json`：236.8 秒，query n=3／p95 197.6 ms、view n=1／22.1 ms、collection n=1／58.0 ms；不把同一操作的 query 與 switch 重複計為兩次驗收操作。這次沒有 note commit／輸入樣本，不足 30 次代表操作及五分鐘完整流程。詳見 [S3／S4 Validation](Engineering/S3-S4-Validation.md)。正常關閉後 App／Host 程序數零，前台已釋放，私人樣本／量測未入 Git。

Goal active；S1／S2 PARTIAL、S3／S4 IN_PROGRESS，未宣稱使用者接受。下一步補 missing record／definition、真實長文欄位外部往返、IME／dirty 競態、allowlist GUI、縮放／凍結區鍵盤焦點及足量代表性效能。不要重做第二 view 的隱欄／篩選／重開及一般 cell Wiki／reference 跳轉；新探針 Home 保存端仍需取得原生有效樣本。

## 已完成工作段：改名、轉換選取與未接受引用保護

從已核對遠端 `6081a724e0ba6fa299a97ac3cfe618e316238a0a` 續作。原生 `S4-Acceptance-1004` 完成欄位 key Markdown→Description（revision 47）、Beta 顯示名及 key→Checks.BetaRenamed（48）、單選選項甲改名（49）。兩式多段引用保留粗體／空行／Wiki，點引用定位同來源欄位；record 關聯更新顯示名並仍開正確卡片。唯讀比對前次還原基底：20 個 generated definition IDs 全保留且名稱映射正確，原 durable draft 完全不變。證據在忽略的 `workspaces/AcceptanceSupport/rename-1523-verification.json`。

一列兩欄 NavCheck 小表從檔案右鍵預覽／建立，revision 50，套用後立即選中新 collection，原筆記保留。現在驗收 workspace 15 notes、555 definitions、100 records、1 durable draft；私人材料未入 Git。

修正未接受草稿 reference 被普通 Markdown Link／GFM URL 呈現：沒有匹配 Host metadata 的保留 carrier 只呈現原文與提示，不建立導航，不解析 cache；`:ref:` 永不當一般檔案 URL。共用 Reading／Live Preview 保護，正常 Wiki／managed references 維持原流程。editor_fix 實作，ui_review 唯讀指出 inline HTML 漏遮並已修回歸，主代理審查整合。7 個 raw cases 加 code exclusions／點擊不導航及既有 editor suite 通過，TypeScript build／四 Project 架構檢查／publish 通過。既有 IME 時序 fixture 曾一次失敗、重跑通過，不据此消除原生 IME 競態缺口。

Host 15:18:10／App 15:18:21 發行後，原生確認同一恢復草稿在 Live Preview／Reading 都露完整 reference 原文，點擊不誤跳；已接受完整欄位仍 highlight 隱語法。Tab 聚焦純式 Grasp reference 有外框，Enter 導向改名後來源並選中第 15 行 `LiveLinks.Short`。正常關閉後核對 App／Host 程序數零，前台已釋放。

Goal active，S1／S2 PARTIAL、S3／S4 IN_PROGRESS，未宣稱使用者接受。下一段補 missing record／origin、第二 view 的篩選／隱欄／鍵盤焦點、真實長文外部往返、IME／dirty 外部競態、allowlist UI、縮放及至少 30 次代表操作／五分鐘流暢度。不要重做本段三類改名、小表自動選取或 Grasp Enter。正常改名已有原生證據，dirty owner 拒絕及未取得結果仍主要依工程證據，未宣稱完整故障注入驗收。

## 已完成工作段：跨表標籤及較新草稿恢復

以遠端 `6bbfd48478dfc201069792c1ea37f53d4e57e48a` 續作。已補 workspace 範圍 tag query／UI：只搜尋有效計算後 Tag，每 record／field 一項、50 項 UI 分頁、穩定 ID 導航，顯示 dirty／來源不可用狀態；取消、SSE、關閉及 workspace 變更防止舊回應套用。RecordsService tags 13 assertions、RecordsUi 16 fixtures 通過。原生從 Mentors 表搜尋「角色」，開啟 Types 的 Alpha 卡片；卡片 Wiki 仍 highlight 並導向 Obsidian 改名後來源。

已修 rename「保留草稿，稍後提交」：最新 note／session／revision／base／title／source 必須與已確認 durable snapshot 相同才可離開；後續新增文字需重存；明確儲存／Ctrl+S 才再次提交。未知 operation 保留相同 request／ID 查核，IME 不放行；切換 workspace 清舊 ack／暫緩決策，恢復 draft 不換原基底。暫緩偏好不跨 App 重啟保存。原生發現首次 Keep 把失焦背景提交視為未知，已改為先等 writer 再判結果；DraftDeparture 53 assertions 含真 semaphore 排隊與未知／連線失敗，App compile 零 warnings／errors，已加入完整建置入口。

原生保留後新增第二版、切換再返回、手動備份及新 workspace restore 成功。14:46:47 generation 共 401 檔，還原至 `workspaces/S4-Draft-Restored-1004-1447`；新草稿／第二版文字可見，舊 Resolution.Pending 已接受定義仍保留。正常關閉後，原與還原 workspace 的 draft JSON 完全相同（revision 2、base 46、同 session／title／source）；證據在忽略的 `workspaces/AcceptanceSupport/draft-1447-verification.json`。這次確實含較新 durable draft，區別於前次 drafts=0。

最終 App 14:52:35／Host 14:37:02 發行。重開原 workspace 恢復同草稿，Ctrl+S 後第一次 Keep 成功，沒有未知操作誤報，再正常關閉；App／Host 程序數零，前台釋放。曾從 sandbox 啟動無視窗 App，已由原 sandbox 身分清理指定 PID，未殘留程序；後續直接用使用者桌面環境啟動。

Goal active，S1／S2 PARTIAL、S3／S4 IN_PROGRESS。下一段聚焦剩餘 native carrier／key／option 改名、小表 import 自動選取、view 篩選／鍵盤焦點、缺失目標／Grasp Enter、長文外部往返，以及 IME／policy／縮放與代表性效能。未知結果故障目前有工程證據，未做完整原生故障注入；不重做已通過的備份還原／基本型別／跨表搜尋。草稿未接受語意時的 reference 呈現另需檢查，不能把已接受來源的 link 驗收擴張到所有草稿狀態。未宣稱使用者接受。

## 已完成工作段：外部改檔名、重新提交與合併標題

以已核對遠端 `5917c3246f41db625823ba8fc01796fc0e2a270c` 續作。真實 Obsidian 在獨立 S4 驗收 vault 改來源檔名，選擇本次更新 4 links／3 files，Grasp revision 39 自動接收。資料表 Wiki 仍開新檔名，多段 Grasp reference 仍定位同一 Message 定義；原 note ID 不變，原日用 vault 未操作。

App 14:03:10 publish 包含三項修正：新欄位傳空 ID 讓 Host 依 operation 派生身分；未接受原文提供明確重新提交入口；合併對話框同時保留／確認標題及正文。RecordsUi 12 fixtures、App build 及四 Project 架構檢查通過。原生新增第十個 Markdown 欄位至 revision 40，重開欄位設定一致。另一筆通知抵達時，開啟中的欄位表單保留輸入及原始版本。

受控外部原文改定義與引用名稱後，明確重新提交及 rename 確認使 revision 42→43，定義 ID 保留。再建立 pending rename 草稿，外部修改標題與正文觸發合併；合併期間第二次外部修改會攔下過期提交，右侧自訂標題及草稿仍在。補入第二版正文、確認改名後 revision 46 診斷零；唯讀檔案／SQLite 核對最終標題、本地與兩次外部正文、同步引用及同一 definition ID。外部衝突案例由 shell 改檔，不冒稱 Obsidian GUI。App／Host 正常退出，程序數零，前台釋放。

Goal active，下一段優先修復已確認的草稿離開缺陷：rename 的「保留草稿」只關 modal，後續切換／備份／關閉會再次提交並阻擋。需核對最新 durable snapshot 才允許延後語意，不能僅看 `_hasDraft`；未知 operation／IME 仍阻擋。另一項尚未實作的 S4 契約是跨資料表 tag 搜尋，目前搜尋只作用於當前 collection。其餘原生 carrier／view／缺失來源、IME／policy／縮放及代表性效能仍待完成；不重做已通過的正常合併還原與基本九型別。

## 已完成工作段：分組還原、外部引用增減及可讀數字

以已核對遠端 `3cdea60a4ca456106a59dbe172164ba39ae2561d` 續作。原生右鍵合併兩篇連結驗收筆記至 revision 33，再拆分至 revision 34；原 IDs 保留，兩個 incoming-link 檔案隨之更新，member／Wiki heading／Grasp 定義導航有效。新增未完成 literal 原文至 revision 36，13:28:48 完整備份 368 檔，從 UI 還原並開啟 `workspaces/S4-Restored-1004-1329`。未完成原文、診斷、四 collections、資料表參照定位及 Triensa 圖片均原生確認。

關閉後核對 366／368 檔與 generation 相同，包含全部 13 份 Markdown、4 圖片、分組／匯入／operation 材料；SQLite 與備份管理狀態因啟動而更新，但唯讀六表完整內容相同（notes 13、definitions 550、receipts 36、source_files 13、meta 5、drafts 0）。本案驗證的是已保存但未接受語意的原文，不是較新 durable draft。詳見 [S3／S4 Validation](Engineering/S3-S4-Validation.md)。

editor_fix 修正外部新增／移除 reference 的 ordinary-source 誤判，唯一配對且既有 cache 不變才放行；ExternalEdits 24 fixtures／98 assertions、Coordinator 定點 2 groups 通過。ui_review 修正數字可讀呈現與搜尋，保留精度、原文、typed sort 及 References／Regions managed rendering；RecordsUi 11 fixtures 通過。主代理整合與原生驗收，另一 agent 唯讀檢查數字精度／邊界。

Host 13:41:39／App 13:41:51 publish 通過。原生表格／完整欄位顯示 42.5，按 42.5 可搜尋 Alpha。Grasp 開啟期間，以受控檔案修改新增 Interop.Value reference，revision 37 無診斷、可讀 highlight 並跳到第 23 行定義；移除該區段後 revision 38 仍有效，既有 literal 未被新 cache 改值。這次外部修改由 shell 執行，不冒稱另一次 Obsidian GUI。App／Host 已正常關閉，在使用者環境核對程序数零，前台釋放。

Goal active，S1／S2 PARTIAL、S3／S4 IN_PROGRESS。下一步補外部改檔名／dirty 衝突與剩餘原生缺口、足量代表效能；不要重做本段正常分組／還原或數字基本流程。未宣稱使用者接受。

## 已完成工作段：Obsidian 共同編輯及保存刷新修正

以已核對遠端 `123084c7b4d93b76f58dbc13e4ac727097650e4b` 續作。真實 Obsidian 1.13.7 開啟獨立 `S4-Acceptance-1004`，關閉期間新增定義／兩層 composition／兩式 reference，Grasp 重開讀入 revision 27；同時開啟時修改 literal，revision 28 及 Obsidian cache 更新成功。原生發現同篇 reference 改值被誤判 shared-source-conflict，已最小修正 Core guard，保留真正 draft／stale／mixed／版本矛盾。Coordinator 新 2 組與既有 shared 1 組通過。

Records 同版 SSE 重複刷新已修正，保存期間合併通知且保留較高版本補讀；RecordsUi 8 fixtures 通過，已加入 solution／完整建置入口。架構檢查、editor build、Host 13:08:25／App 13:08:34 publish 通過。本段由主代理整合與原生驗證，editor_fix 負責 Core／Coordinator，ui_review 負責 Records UI。

13:09–13:14 原生重驗：恢復原衝突 reference 的已接受基底後 revision 30 正常；再從 Obsidian 只改引用值，來源 literal 與兩層相依成功更新 revision 31、診斷零，Obsidian 亦顯示回寫結果。Alpha Number 保存 42.5 至 revision 32，提交至 child-ready＋paint opportunity 有 1 筆 207.6 ms，漏記問題定點回歸通過，仍不足 30 次代表效能樣本。詳見 [S2 Validation](Engineering/S2-Validation.md)及 [S3／S4 Validation](Engineering/S3-S4-Validation.md)。App／Host 正常關閉且程序不存在，前台釋放。

已確認下一缺陷：已有引用的筆記在外部新增／移除引用，被 topology classifier 一律保留為衝突，尚未修正。數字顯示目前採 canonical `425e-1`，可读格式仍待改善。Goal active；S1／S2 PARTIAL、S3／S4 IN_PROGRESS，未宣稱使用者接受。

## 已完成工作段：九型別原生流程及 record ID 導航

本段以已核對遠端 `dd55127fde437ab4110a68c9088d3ef4e8357ca9` 續作。12:06–12:31 原生驗收在 `S4-Acceptance-1004` 完成 Alpha 的空字串→長文、0、false、date-only、單選、多選、tag、跨表單筆關聯與跨表＋同表多筆關聯，revision 16–25。引用檢查筆記同步更新且無診斷，兩式多段引用保留正文；Beta 的未設定欄位保持 null。詳見 [S3／S4 Validation](Engineering/S3-S4-Validation.md)。這是基本流程，不等於九型別的所有邊界或 S4 完成。

已修正 Boolean 選單 false 重繪空白（實際保存值正確），以及關聯 link 只開所屬檔案頂部。Record 導航以既有 canonical carrier ID 定位 fresh record card，不依顯示名或檔案頂部猜測；保護 missing／dirty／過期結果。Relation selector 加本地搜尋，保留已選 ID。主代理負責 Home、整合與原生驗證；editor_fix 負責 renderer／fixtures；ui_review 負責 Records UI／readiness。

新版 Host 12:40:48／App 12:40:58 已發行；12:41–12:49 原生重開確認 false 正確顯示，同表 Beta／跨表 Triensa、Live Preview reference 內 Beta 都直接開正確卡片。搜尋 Beta／LiveLinks 保留選取；新增第三筆關聯時 dirty guard 阻止離開並保留輸入，保存 revision 26 後重開完整欄位仍見三筆。Editor tests、Records 15 fixtures、架構檢查及 publish 通過。App／Host 正常關閉後皆不存在，前台已釋放。未宣稱全部 native 邊界或 S4 完成。

Opt-in Records 已加入 managed child DOM／handlers readiness barrier 再使用雙 rAF；過期、失敗、取消、逾時不算成功，lazy 圖片下載解碼不含在內。新探針 `ui-20261004-044122.json` 有 3 筆 query（p95 230.6 ms），但成功的 revision 26 保存未留下 commit span，須釐清 own refresh／SSE 競態；目前不能宣稱完整提交至可見效能達標。詳見 Validation；關聯搜尋 modal 高度變動亦留作有界 UX 改善。

## 已完成工作段：Wiki／Grasp 共用呈現與直接導航

進入本段時已核對的遠端 checkpoint 為 `62780134a29ab49f8d7a25de973e2f9b0e0041c6`。以下工作已實作、本機 publish 並通過有限必要原生流程；提交主題為 `fix: preserve wiki and reference navigation across record views`，實際 commit／push 結果以 Git 與交付核對為準。全 Goal 維持 `IN_PROGRESS`，未宣稱全部階段完成。

使用者新決策已歸檔 [Seed rc.13](Project_Seed/GraspPortable-Core-Requirements-v1.0.0-rc.13.md)、[Plan rc.9](https://github.com/000Sean000/GraspPortable/blob/f634bcd9b650d89f57ff0d866a086612e7e2fc2e/docs/Engineering/Implementation-Plan-v1.0.0-rc.9.md)及[Architecture rc.6](Engineering/GraspPortable-Architecture-v1.0.0-rc.6.md)：Live Preview 非編輯區隱藏 Wiki／Grasp syntax，以醒目連結呈現；單擊／聚焦 Enter 直接跳 target，Grasp 開 definition 所屬 file 並定位 block，不僅開 inspector。Cell／完整 field／record card 保留同樣渲染與跳轉，不能 flatten 純字。

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
| S3 | IN_PROGRESS：backup／restore、排程、實體檔案合併／拆分及其 API／UI／恢復已整合 | backup primitive 39 assertions／manager 9 groups；原生合併／拆分、ID／link、368 檔完整還原及重開通过；未完成原文／Records／圖片保留，六表邏輯內容相同；較新 durable draft 原生恢復及故障邊界另驗 | 同上 |
| S4a–c | IN_PROGRESS：Records codec／Knowledge／Host、九型別、長文卡片／關聯、凍結／分頁／視圖 UI 及 table import 已整合並本機發行 | 15×8 import、view／凍結保存、雙向固定與排序編輯已有限原生驗證；Aura 81×5 import／兩頁切換已原生驗證；Wiki／Grasp 各呈現面與部分鍵盤／dirty guard 已驗；九型別基本保存／引用更新、同表／跨表 ID 卡片導航及關聯 dirty guard 已驗；其餘 carrier、import 初始選取、missing／IME 邊界與足量 GUI 量測待驗，詳见 S3／S4 Validation | 同上 |

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

Goal active，不暫停或重建。完成本段備份狀態修正與驗證文件的commit／push核對後，接續以下剩餘缺口；已完成的30次功能操作、窄視窗焦點、基本備份狀態與本組暖機查詢不整輪重跑。

1. 補「完整編輯至可見committed結果」的有界量測：現有probe只有input-visible及commit-request-visible，不能把兩者相加或用後端耗時冒充完整鏈。保留既有generation／foreground／DOM有效性，不擴建benchmark平台、不改800ms門檻；已通過chain／fan-out無新風險不重跑。
2. 檔案樹平台操作：同一筆合成筆記右鍵複製相對路徑並貼出核對、Explorer reveal確認實際選中路徑。已有改名／搬移／Wiki身分驗證不重跑。
3. 三篇小型合成筆記merge→Obsidian修改合併檔的成員正文→Grasp接受→split；確認三ID／內容。現有兩篇merge/split與完整restore證據保留，不重測全矩陣。備份缺件／失敗保全已有工程測試；只補具體UI顯示缺口，勿擴張故障矩陣。
4. 按Implementation Plan完成最後交付核對、同步現行入口／測量限制、啟動位置／workspace／操作清單，commit／push後才依完整條件判Goal。使用者接受獨立記錄。

S1／S2 PARTIAL、S3／S4 IN_PROGRESS；不是S4完成聲明。已通過的IME外部競態、allowlist、兩式卡片導航、第二view、rename及草稿還原不重跑。GoalSupport原監測已退出，沒有持續監測承諾。
