---
title: GraspPortable — Windows S1–S4 Goal Implementation Plan
version: 1.0.0-rc.10
updated: 2026-10-04
status: accepted-authorized-for-p0-through-s4
scope: markdown-collaboration-recovery-records-and-bounded-verification
supersedes: Implementation-Plan-v1.0.0-rc.9.md
---

## 目標與完成條件

2026-10-04 使用者明確授權 IMPLEMENT：**完成目前 Windows PC 可操作的 S4 候選版，包含完整筆記流程、Markdown 共同編輯、工作檔案整理與恢復，以及長文屬性、關聯和凍結行列資料表。** 從現有程式及未提交變更續作，以同一 Goal 依 P0 → S1 → S2 → S3 → S4 推進，不在每阶段等待再次授權。

只有功能、必要驗證、實際 Windows GUI、可啟動版本、驗收 workspace、操作說明、效能結果、文件同步及 commit／push 核對均完成，才能標記 Goal complete。實作、驗證及使用者接受分開；目前進度及 exact next step 只由 [EXECUTION-STATE](../EXECUTION-STATE.md) 維護，本文不是完成證據。

[Seed rc.13](../Project_Seed/GraspPortable-Core-Requirements-v1.0.0-rc.13.md) 保存 WHAT／WHY；[Engineering 入口](README.md) 指定現行工程方法、目錄原則與 Agent 模型路由；[Architecture rc.6](GraspPortable-Architecture-v1.0.0-rc.6.md) 及 [圖解 v1.2.1](GraspPortable-Architecture-Diagrams-v1.2.1.md) 保存 HOW；[Syntax Review rc.6](Binding-Syntax-Review-v1.0.0-rc.6.md) 延續已接受 rc.3 syntax profile。

S4 完成後停止等待使用者體驗。不自行擴展 mobile、同步、任意程式執行、rollup、通用公式、完整 Notion、共享語意 undo、專用 composition／rename UI 或乾淨電腦完整 Portable 認證。不承諾一晚完成，不降低驗收標準以結束 Goal。

## 1. 實作基準與共同接面

### 1.1 Projects、程序與資料權威

沿用四 Projects：App → Contracts，Host → Core＋Contracts，Core／Contracts 無其他產品依賴。Core 管 use cases／domain／ports／syntax／graph，Host 管 executable、HTTP／SSE、DI、jobs、SQLite／filesystem adapters；App 管 MAUI／Razor／CodeMirror、畫面狀態、client 及平台。

功能採淺目錄、明示公開接面、不預建空模組及 interface-per-class。共同契約、DI、migration 單一 owner；同 project 跨模組依賴以少量檢查保護。保留 .NET 10／目前已固定工具鏈；具體來源入口及依賴見架構。

App／Host 獨立程序，loopback HTTP JSON＋SSE；credential 只由 .NET client 管理。每 workspace 一個 Host writer，可開多筆記。關閉 App 先保存草稿、追蹤 accepted operations、補 checkpoint 再關閉 Host；重開 reconciliation 處理外部變動。先目前 PC unpackaged 發行、單一啟動入口，不以正式安裝產品為前提。

Markdown 為已保存原文權威；SQLite 為索引、計算、版本基底、草稿、恢復日誌。普通 Markdown 無 metadata 仍可讀，不因掃描重寫整庫；必要 IDs／schema／成員及定位在 YAML frontmatter，保留使用者原 metadata。既有 DB-only workspace 遷到新資料夾並核對，保留原 DB。

### 1.2 版本、更新與來源接面

沿用 `SaveDraft`、`CommitNote`、`ChangeLiteral`、`ReadNote`、`ReadDefinition`、`FindReferences`、`ReadReceipt` 與 revision feed，依新契約增補：

| 接面組 | 必要契約 |
| --- | --- |
| 文件／reconciliation | 文件 ID／path／hash／來源與共同基底版本；保存、語意接受、回寫及衝突分開回報 |
| Workspace explorer／檔案操作 | 實際資料夾／檔案階層與搜尋；建立筆記／資料夾、改名／搬移的目標 path、IDs／expected versions、operation ID；複製路徑、開啟／reveal 的平台接面 |
| Definition／write target | 手寫 literal／composition 與 record field 來源、所屬 note／file、definition block raw UTF-16 range／版本、可寫位置，不混用 serializer |
| Records／schema | collection、record／field／option IDs、key／display name、typed value／診斷、單／多關聯；原始欄位 source 與其 local reference ranges／來源版本供共用 renderer 使用；欄位修改、schema 預覽／套用 |
| Query／views | 分頁／總數或游標、record／field IDs、版本、搜尋／排序／篩選、欄序與凍結設定 |
| 分組／轉換 | 基底版本、成員／path／metadata／連結影響、未知內容、轉換原文；preview 後可恢復 apply |
| Backup／restore | generation、snapshot revision、manifest／hash、附件及草稿狀態、最後成功／落後／缺件、新 workspace restore |

修改帶 operation ID 及版本 guards。同 ID／同 payload 冪等，異 payload 拒絕；未知結果查 receipt，不重複盲寫。相容 schema／protocol 變動同步 client handshake，未知版本明示拒絕，不猜測解讀。

### 1.3 編輯至畫面更新

1. CodeMirror 本地處理文字、selection、IME、local undo；草稿起始合併約 250 ms，普通有效編輯約 400 ms 為可調工程預算。退出編輯／切筆記／Ctrl+S bypass debounce，IME 結束後送最終 snapshot。
2. 原文可先保存。未完整語法留下原文及診斷，不發布部分 definitions，last-good 結果清楚標過期；保存不等於語意成功。
3. Context／policy、syntax codec、AST、名稱解析、graph／evaluation 分層。只解析原始 source，literal／reference cache／求值輸出不遞迴建立語意。
4. 每 workspace 最多兩個 CPU prepare workers，受影響相依增量計算。新草稿取代舊準備、過期結果拒絕；ordered operands 不因 graph 去重而丟失。
5. 提交序列化：核對版本，先保存 intent／journal，再逐檔比對與寫入；DB 短交易保存語意投影／receipt。跨檔失敗可恢復，第三方新 hash 停止覆寫；不得宣稱多檔 ACID。
6. 發 revision／受影響 IDs，UI 經 dispatcher 補讀必要變更、clean editor 局部 patch，dirty／IME 保留。通知遺失補查，取消準備不撤銷已接受寫入。

外部一般存檔自動解析。外部修改引用顯示值依共同基底判斷意圖；只有唯一 literal、版本有效且不矛盾才共享回寫。Composition 導向來源，不能 flatten；舊 cache 不當新修改。Watcher 僅提示變動，自身輸出 hash 防循環，啟動／遺漏事件以 reconciliation 補查。

### 1.4 Records 及縱向 Markdown

支援文字／Markdown、數字、布林、date-only、單選、多選、tag、單筆／多筆關聯。數字不靜默截斷；null、空字串、零、false 分開；option rename 保留 ID、多選選項由欄位管理、tag 跨表搜尋。外部無效值保留原文及診斷，relation 使用 record ID 與可讀連結、missing target 明示。

欄位正文只有一份，YAML 不另放競爭值；自动屬性 `RecordKey.FieldKey` 取得計算後 Markdown，與手寫 binding 共用唯一性、missing／cycle、相依及導航。Key 使用 ASCII case-sensitive，display name 可中文；view／collection 名不參與。可靠 rename 保留 ID，搬移或分組不改名稱；回寫依來源類型更新 Markdown，不包成 literal。

寬表預設轉成 H2 資料集／H3 record／H4 field；複雜內容或结构衝突改階層巢狀清單及明確縮排邊界。結構與轉換後 headings 不用 H1，深度超限用 nested list，不壓平；第一次轉換預覽層級及欄位映射，保留原文／mapping 供恢復。後續原文為準，不猜測舊層級；fence 中 `#` 不是 heading。不能只用下一個 heading 切欄位，結構不明保留原文並停止自動改寫。

表格／完整角色卡／多 views 共用 source。表格固定欄位標題列、record 標題欄，凍結前列／欄數隨 view 保存；支援雙向捲動、排序、篩選、搜尋、欄序及顯示設定。長文摘要點開完整 editor；focus／pending edits 綁 IDs，不綁 row index；分頁／虛擬化控制 DOM，凍結區不遮 editor／menu／鍵盤焦點。

### 1.5 S2 實際檔案樹與右鍵操作

側邊欄參照 Obsidian／VS Code 顯示目前 workspace 實際資料夾及檔案，支援展開／收合與名稱／路徑搜尋；載入及更新依可見範圍處理，不為每次展開一次載入全庫。`.grasp`、`.git`、`artifacts` 等內部／生成路徑不進日常筆記樹。

右鍵依目標類型提供新增筆記、新增資料夾、重新命名、搬移、複製路徑、開啟筆記及在系統檔案總管顯示。新增落在所選目錄；改名／搬移使用既有 IDs、expected versions、operation ID、journal／恢復管線，先核對目標與路徑衝突，更新可可靠辨識的引用，不能繞過 dirty／版本 guards 直接 shell 搬檔。成功或失敗後以最新文件狀態刷新樹，不用過期 row index 決定操作目標。

檔案樹是檔案配置，Records views 是資料檢視，S3 分組是內容合併／拆分，三者分開；本階段不是完整 VS Code 功能複製。

### 1.6 共用連結呈現與直接導航

Wiki Link 在 Live Preview 非編輯區及 Reading 隱藏括號／語法，顯示醒目可讀標籤；單擊或聚焦後 Enter 直接開 target。兩種 Grasp reference 同等呈現，操作後開定義所在 file 並定位 definition block，不停在 inspector。Active source editing 區露原 syntax，不攔截正常文字輸入／IME，不以導航覆蓋 dirty draft。

筆記、資料表 cell、完整欄位及 record 卡片共用 Markdown／連結 rendering 與 navigation 接面；cell 摘要保留參照可操作性，不能 flatten 純字。Cell link 操作與開啟 field editor 明確分流，避免點 link 只觸發編輯。

Host／Contracts 投影原始 field source 的 local Grasp reference ranges、來源 note／版本及定義定位資料；App renderer 消費既有語意 metadata，不能在 cached／resolved value 上另跑 Grasp parser。範圍綁定对应 source，禁止將求值後文字 offset 冒充原文位置。普通 Markdown／Wiki link 的可讀呈現可保留，disabled Grasp fence 不生成 managed link。Source／target 版本過期或 missing 時保留內容並顯示狀態，不跳錯 block。

## 2. 里程碑與可驗收成果

【可體驗】是使用者可直接操作；【工程驗證】是必要完成條件。主要順序固定，暫時工具阻礙時可先做不依賴它的工作，但不能把未驗證階段標完成。

| 階段 | 實作成果 | 完成判準 |
| --- | --- | --- |
| P0 續作基線 | 保留既有 UI 修正；歸檔最新決策；建立 Goal／可續作狀態 | 【工程驗證】舊 DB authority／S1 停點／Git 未授權不再是現行契約；入口、版本及差異核對 |
| S1 完整筆記流程 | Reading／editor 修正、delimiter 配對／游標／marker 同步、既有完整 Grasp 流程收尾 | 【可體驗】以下筆記脚本；【工程驗證】原生 IME、草稿、版本、rename／政策及端到端品質 |
| S2 Markdown 共同編輯 | 文件來源、watcher／reconciliation、journal、附件／連結、分頁及實際檔案樹／右鍵選單 | 【可體驗】展開／搜尋／右鍵操作、與 Obsidian 交替編輯；【工程驗證】改名搬移保留 IDs／引用、不丟原文、不覆寫 dirty／第三方，無循環、遺漏補查、中斷恢復、無 500 筆靜默截斷 |
| S3 整理／恢復 | 分組預覽／實際合併拆分、手動／自動 backup、restore | 【可體驗】三篇合併為一檔再拆回，取得備份還原新資料夾；【工程驗證】內容、ID、metadata、bindings、附件、策略及草稿恢復，失敗保留上次完整版本 |
| S4a Records／欄位 | schema／record／各欄位型別／relation、cell 與角色卡 | 【可體驗】建立資料表、長文與關聯編輯；【工程驗證】單一 source、option／field rename 保留 ID、型別／空值 |
| S4b 屬性／互通 | generated bindings、source write target、外部欄位修改 | 【可體驗】引用欄位屬性並從 Obsidian 修改；【工程驗證】相依、missing／cycle、衝突及不遞迴解析 |
| S4c 表格／交付 | 多 views、凍結行列、舊表轉換、整合恢復 | 【可體驗】角色職責／氣場 views、長文、篩選排序、恢復；【工程驗證】真實樣本、往返重建、GUI／效能及文件／Git 核對 |

### S1 筆記操作腳本

建立三篇筆記；輸入中文、paste、Ctrl+Z；建立 literal、多段值、至少兩層 composition；插入兩式 managed reference，空行保留。修改來源立即連動，退出編輯不等 debounce。切 Source／Reading／Live Preview，active 區可編輯，其他一般段落可讀。

在非編輯區確認 Wiki／兩種 Grasp reference 隱語法且為可讀連結，單擊／聚焦 Enter 直接導航；Grasp 到所屬 file 的 definition block。再看 references、確認影響後改共享 literal；來源有 dirty draft 則回到草稿。原文 rename 維持 ID 並更新相依 token，同名／不明對應不部分套用。調整 fence allowlist 先看影響；json／grasp-demo 停用區不建立／回寫資料。留未完成語法，關閉 App／Host 後重開，草稿及 last-good 狀態可辨。

### S2–S4 整合腳本

1. 在獨立測試 Markdown workspace 展開實際檔案樹、搜尋，從右鍵新增筆記／資料夾、改名／搬移、複製路徑及開啟／reveal；核對 Explorer 的真實位置與引用。再由 Grasp／Obsidian 交替改正文、定義及引用值，外部移檔／改名後觀察更新；關閉 Grasp 後修改再重開，辨識有效變動與衝突。
2. 預覽三篇合併／拆分，檢查連結與 metadata；在 Obsidian 閱讀修改合併檔，回 Grasp 保有成員身分。
3. 建立角色及 Aura collections，編輯所有型別，打開長文角色卡，選單／多筆關聯，引用 `Characters.Triensa.Description` 觀察传遞更新；在 cell／完整欄位／卡片確認 Wiki 與 Grasp 參照保持相同呈現和直接跳轉。
4. 切職責／氣場 views、排序篩選、凍結行列，長文編輯不中斷；舊 Markdown table 轉縱向 source，確認無 H1、未知內容及原文可找回。
5. 手動／排程 checkpoint，觀察最後成功／落後／缺件；還原新 workspace，核對 notes、records、relation、metadata、設定與草稿。

### S3 預設政策

有變更每五分鐘啟動 checkpoint，正常關閉補做，保留最近三份完整版本；UI 可調整。日常 Markdown 保存不等此週期。固定 snapshot 輸出新 generation，檢查 hashes、paths、attachments、schema／policy／strategy、草稿與 journal 狀態後才發布。失敗保留前次完整版本，restore 預設新 workspace。

## 3. 有界驗證與效能門檻

測試只保護本次契約、實際回歸及主要資料風險，不設 coverage quota、不建通用 benchmark 平台。每階段先跑一次必要驗證；修正後只重測受影響範圍，有新失敗、契約變動或具體未解風險才擴大。

| 層面 | 必要案例 |
| --- | --- |
| Codec／graph | 已選 syntax、boundary escape、EOL／UTF-16、disabled context、round-trip、重複 operand、傳遞／diamond、missing／cycle；欄位含 headings／fence／空行／圖片／wikilink，多值與 H1 層級轉換 |
| SQLite／filesystem | rollback、stale guard、重試／receipt、已提交回覆遺失、草稿恢復；自身／重複／遺漏事件、同時修改、部分檔案寫入中斷、重啟、重複 ID、附件缺失、分組／restore、檔案樹目標版本／路徑衝突、改名搬移後 IDs／引用 |
| Records | generated／手寫名稱衝突、record／field／option rename、null／空字串／零／false、單／多關聯、屬性計算／source writeback、無效外部 typed values |
| Windows GUI | 原生中文 IME、paste／undo、多段引用、快速操作、dirty／IME 保護、Source／Reading／Live、外部編輯、長文／relation、代表性縮放、排序中編輯／篩選後修改、凍結區焦點、檔案樹展開／搜尋／右鍵操作及實際 reveal |

指定資料是使用者提供的 `TestData/MainVault-Source` 副本，可按需求選取適量；工程上把試驗放獨立且忽略的驗收 workspace，保留比較基線。私人筆記、samples、credentials、大量 evidence 不進 Git。Legacy1 不在搜尋範圍，不因授權副本而無目的整庫測試。

功能 F 為 3–10 Notes、約 20 bindings、100 occurrences。S4 使用 15 位 Eternal Mentors、81 列 Aura、Triensa／Anria 長文卡與少量合成型別／衝突案例；逐項核對實際挑取結果，計畫樣本數不冒充已完成驗收。至少 30 次代表操作及約五分鐘連續互動；chain 1,000／fan-out 10,000 用固定短值避免文字指數膨脹。

| 指標 | 已接受暫定門檻 |
| --- | --- |
| input-visible | p95 ≤ 50 ms；無 App 造成的 ≥ 200 ms UI 停頓 |
| 捲動 | rAF frame interval p95 ≤ 33 ms，僅輔助 proxy |
| 暖筆記／查詢切換 | p95 ≤ 200 ms；首次開啟 ≤ 1 秒 |
| ≤100 affected nodes／1,000 occurrences 小改 | 完整編輯至可見 committed 結果 p95 ≤ 800 ms；另記 commit-to-visible |
| chain 1,000／fan-out 10,000 | 計算與提交 ≤ 2 秒；>200 ms 有處理中，UI 可互動 |

跨檔回寫納入端到端觀察，不以 SQLite 內部耗時代替。依真實樣本先完成代表流程，再按容量風險擴大一次有界檢查。舊 M（10,000 Notes／100 MiB、50,000 bindings、200,000 edges／occurrences）、G（較大基準三倍）、記憶體 M≤2 GB／G≤4 GB 是候選成長 workload；只有有助當前容量判斷時採用，不自動要求整套矩陣。未測規模與硬體明列，不宣稱已證明全部成長餘裕。

本次連結修正以少量跨筆記與跨 cell／完整欄位／卡片案例驗單擊及 Enter、Wiki alias、Grasp definition block 定位、active source／dirty 保護，以及 disabled fence／cached value 不新建 managed links；只補受影響的 renderer／metadata 回歸，不擴大完整語法或性能矩陣。

API／headless、程序存活及貼上中文不代替原生 GUI／IME。資料一致性失敗不得完成；UX／效能未達可供早期試用但標示未達，不下修門檻宣稱通過。

## 4. Goal、協作、checkpoint 與交付

### 持續工作與分工

正式執行建立或恢復原 P0–S4 Goal，每回合從 EXECUTION-STATE、Git 差異及測試證據續作，避免重做探索。已存在的 thread／Goal 優先延續；使用者的最新暫停／恢復指示保持有效，配置提交不自行恢復 Goal。普通工程及可逆 UX 自行處理，已定案語法／權威不重問。

主代理持有範圍、共同契約、資料權威、journal／transaction、整合及驗收。模型／effort、topology、Context Affinity 與交接規則依 [Model Routing Policy](Model-Routing-Policy-v1.0.0-rc.1.md)，實際生效與試行進度另見 [Routing Trial State](../ROUTING-TRIAL-STATE.md)。只有存在有界獨立收益才分派 editor／table UI、codec／field projection／fixtures 或 recovery 審查；遵守執行環境上限。每次委派明定目標、ownership、契約、範圍、驗收與停止條件，Contracts／migration／DI／共同文件單一 owner。實作與其必要 targeted tests 原則上由同一 owner 完成；Root 核對關鍵差異及整合接縫，不以 subagent 自述代替驗收，也不要求使用者逐包批准。

每里程碑、連續兩輪修正無改善或測試成本失衡時，短記下一個可體驗成果缺口、被推翻假設、主要風險及繼續／簡化／調整／延後理由。工具阻礙某項驗證時先做獨立工作，未測仍列未測；新的重大產品語意矛盾才提出具體決策，不為等待而停掉所有進度。

### Git、額度與前台

已授權每個完整且經必要驗證的工作段自行 commit／push 到 `origin/rewrite/dotnet`，核對遠端。保留既有修改，不 force push／破壞性 reset；遠端並行變更先整合。Push 暫時失敗保留 local checkpoint 並記待推送，不阻止獨立開發。私人資料與生成物不提交。

額度監測僅服務本次 Goal。正式確認正常額度耗盡才使用已授權可用重置券；同一邏輯重試沿用 idempotency key，之後重讀，不因網路錯誤提前兌換，不購買額度，也不因額度不足改用未授權模型或 Reserve；正常的已授權任務路由與額度 fallback 分開。Goal 完成或使用者停止時終止監測。已讀額度與可用券不等於端到端兌換／平台續跑已驗證；工具與平台限制如實記錄，不承諾任何中斷都能自動恢復。

前台測試前提醒勿干擾，完成後告知釋放。使用者已同意電腦保持開機、不休眠／不鎖定並提供前台；不因此自行修改系統政策。

### 完成與交付

Goal 只在頂部完成條件成立時標 complete，不以回合結束、額度或時間取代驗收。若重大阻礙確實不能續作，保存已完成／未完成、證據及 exact next step，按 Goal 工具規則處理阻礙。

交付實際絕對啟動位置、驗收 workspace、短操作清單、各階段功能／GUI／效能／恢復證據、已知限制及 commit／push 結果。Repo 只保留 source、必要 tests、短 architecture/debug map 與文件；Workspace 根目錄輔助檔另列，不宣稱受 repository 追蹤。S4 完成後停止，等待使用者體驗與決定下一階段。
