---
title: GraspPortable — S3 / S4 Validation
version: 1.8.0
updated: 2026-10-04
status: implemented-parts-with-partial-native-evidence
---

## 判定

分組、Records engine／metadata／service、資料表 UI 與 Markdown table 轉換已接入產品，最新 App／Host 已完成本機 publish。下列有界工程測試及 15×8 import／view／凍結／排序編輯已有實際結果；完整原生驗收仍未完成，不是阶段完成或使用者接受聲明。S1／S2 仍 PARTIAL，動態進度由 [EXECUTION-STATE](../EXECUTION-STATE.md) 維護。

## 合併、拆分及完整版本還原（revision 33–36）

2026-10-04 13:18–13:39（Asia/Taipei），以 `3cdea60` 本機發行操作 `S4-Acceptance-1004`。右鍵將連結來源與閱讀兩篇合併，預覽列出兩成員及兩個 incoming-link 檔案，套用 revision 33；側欄顯示一個實體檔。Wiki 可開來源成員，member 選單可切閱讀成員，多段 Grasp reference 仍定位 Message 定義第 10 行。兩個 note IDs 前綴 `dd4b773e`／`497387e6` 不變。

再從右鍵拆分，預覽兩個新 Markdown 路徑、相同 incoming-link 檔案及分組保留 JSON；套用 revision 34。側欄恢復兩個檔案，ID 保留，Wiki heading 導航隨新檔名更新。未分配材料與原始 bytes 保存於 grouping／operation journal，不以檔名當資料身分。

新增「恢復草稿驗收」，保存中文空行及未閉合 literal，revision 35–36；顯示原文已保存、語意尚未接受及一項 literal 診斷。13:28:48 手動完整備份顯示 368 檔，還原至新的 `workspaces/S4-Restored-1004-1329` 並從 UI 開啟。這是未接受語意的已保存原文案例，當時 durable drafts 表為零，不能稱為較新 durable draft 的原生測試。

還原後原生確認未完成原文／空行／診斷、四個 collections（15／81／2／1 筆）、Mentors 的既存「角色職責」view、資料表 Wiki／Reference 可讀呈現。點表格短 reference 直接選中拆分後來源的 `LiveLinks.Short` 第 15 行；Triensa 真實長文中的圖片正常顯示。

還原 receipt 與畫面選取的 generation `generation-20261004T0528486092976Z-e7be5244fd11491781668b40d0af60da` 相同，manifest hash 一致。正常關閉後比對 368 個檔案：366 個相同，包含全部 13 份 Markdown、4 張圖片、分組與匯入映射及 operation 材料；SQLite 與 backup-manager state 因開啟／關閉更新。以唯讀 SQLite 核對，meta 5、notes 13、definitions 550、drafts 0、receipts 36、source_files 13，各表內容與選定備份完全一致。報告在忽略的 `workspaces/AcceptanceSupport/restore-1329-verification.json`／`restore-1329-database.json`，私人內容不進 Git。

以上補足主要 S3 正常流程；較新 durable draft、失敗恢復的原生案例及其餘 S1／S2／S4 缺口仍依工作狀態續驗，不宣稱整個 Goal 完成。

## 可讀數字與搜尋（revision 36，未改資料）

Host 13:41:39／App 13:41:51 發行。數字 UI 使用字串與整數 scale 格式化，常用值 `425e-1` 顯示為 `42.5`，超長值保留完整精度的科學記號，不經浮點轉換、不改原文。搜尋及文字 equals／contains 同時接受 canonical 與可讀值；typed 排序不变。含 Grasp References／Regions 的 cell 繼續 managed rendering，不攤平導航。

RecordsUi 11 fixtures 通過，包括既有保存通知競態、15 個數字案例、raw／managed 保護與可讀搜尋／filter。主代理審查差異，另一 agent 唯讀核對精度及邊界；架構檢查、TypeScript build 與 App／Host publish 通過。13:45 左右原生確認表格顯示 42.5、搜尋只留下 Alpha、完整欄位輸入與預覽皆為 42.5，未改 source 或 revision。沒有新增性能數字，不把有界功能操作當成 30 次代表量測。

## 九型別原生驗證與關聯導航缺口（revision 16–25）

2026-10-04 12:06–12:31（Asia/Taipei），主代理使用已推送 `dd55127fde437ab4110a68c9088d3ef4e8357ca9` 的本機 Windows App，操作同一驗收 workspace 的兩筆合成紀錄。不是整個 vault 的壓力測試。

| 欄位／步驟 | 原生觀測 |
| --- | --- |
| Markdown 空字串 | Alpha 取消 null 後以空字串保存，revision 16；表格為空白，Beta 仍為 null；重開欄位確認 |
| Markdown 長文 | 保存中文兩段、段間空行、粗體及 Wiki alias，revision 17；摘要與另一篇引用筆記兩式多段展開保留內容 |
| 數字／布林 | 0、false 分別保存為 revision 18／19，表格與引用筆記顯示正確，未混同 null |
| 日期 | 原生日曆選擇 2026-10-04，保存 revision 20，引用筆記显示 date-only 值 |
| 單選／多選／tag | 單選甲、多選甲乙、兩行中文標籤依序保存 revision 21–23，表格與引用筆記保留各項 |
| 單筆／多筆關聯 | 跨表 Triensa 單筆關聯保存 revision 24；Triensa 加同表 Beta 多筆關聯保存 revision 25，表格呈現兩個可讀連結 |
| 關聯導航缺口 | 點 Beta 只開啟所屬筆記頂部，未定位紀錄；不能列為 record 導航通過。正以既有 carrier ID 改為開啟對應卡片，待新版原生重驗 |
| 布林選單缺口 | false 選取後選單曾顯空白，但保存為 false 正確。已改為明確字串對應選項，待新版原生重驗 |

原生保存後，引用檢查筆記無診斷，長文、零、false、日期、選項、標籤及關聯內容隨欄位更新。尚未以本段證據宣稱高精度小數、重開全部型別、選項／record 改名或關聯移動皆已原生驗收。App／Host 正常關閉後程序皆不存在；原驗收檔與私人樣本不進 Git。

`ui-20261004-040644.json` 的前十分鐘探針只有 query 4 筆（p95 155.7 ms）、collection switch 1 筆（72.1 ms）、input 1 筆（5.1 ms）；不能涵蓋之後的原生保存，也不足 30 次代表操作。這仍是舊父層 paint opportunity，不能與正在整合的 managed child DOM ready＋雙 rAF 混算。新 barrier 等待目前 generation 的文字及 handlers，過期／失敗／逾時不計成功；lazy 圖片下載解碼不列入完成條件，尚待整合發行驗證。

### 新版原生回歸（revision 25–26）

本機 Host 12:40:48／App 12:40:58 發行後，12:41–12:49 原生重開同 workspace。Alpha 的長文、0、false、日期仍在，Boolean 欄位選單明確顯示 false。點表格 Beta 關聯直接開 `Checks.Beta` 卡片；跨表 Triensa 開 `Imported1` 卡片並渲染 Wiki 內容。從引用檢查筆記的 Live Preview 多筆 reference 內點 Beta，亦開 Beta 卡片，沒有誤觸外層定義導航。

關聯搜尋以 Beta／LiveLinks 找到 1／99 筆，原來兩個已選 ID 保留。加入第三筆 LiveLinks 後，點已保存預覽中的 Beta 被 dirty guard 阻止，三個選取仍在。保存為 revision 26，重新開啟完整欄位可見三筆關聯；表格摘要只顯示前兩行，不等於正文截斷。App／Host 正常退出，程序皆不存在。

工程：editor build／tests 通過；Records JS syntax check 及 15 個有界 fixtures 通過（readiness 13、ID／普通路由 2）；四專案架構檢查及 App／Host publish 通過。沒有因 UI 變動重跑未受影響的 Core／SQLite 全套測試。Record ID 缺失、快速跨 workspace、原生 Enter 及全部 IME／外部修改邊界仍待有界補驗。

新報告 `ui-20261004-044122.json` 時長 490.6 秒：child-ready query 3 筆 p95 230.6 ms、collection switch 1 筆 83.6 ms、input 2 筆 p95 5.4 ms、首次 note switch 1 筆 30.8 ms；frame 36,000 筆 p95 4.3 ms／max 54.2 ms，scroll 233 筆 p95 4.4 ms／max 37.6 ms。Frame 達 cap 後另有 80,465 個樣本未保存，故不是全時段無停頓證明。

**效能仍未驗收通過：**一次成功的 revision 26 關聯提交沒有產生 `recordsCommitToPaintOpportunity`，須定位 own refresh／SSE／generation 使 span 被取消的情況；不拿 query 數字代替提交至可見结果，也不把這批少量操作推算成足量 p95。新 barrier 已原生帶入 query 顯示，但其提交量測完整性尚未證明。關聯搜尋結果數改變時 modal 高度會改變，亦記為後續有界 UX 修整項目。

### 保存通知去重與提交量測回歸（revision 32）

已修同次保存的 SSE 重複 Refresh 導致 own read-back epoch 被取消：已套用 revision 只消費通知，本地保存期間合併最高 revision，結束後僅對仍較新的版本補讀。保留 exact epoch／paint token／child-ready 驗證；真正過期的提交不借用其他 query 算成功。RecordsUi 8 個直接執行 Panel 控制流的 fixtures 通過，涵蓋 command／read-back 兩時序、較高通知、dirty／unknown／conflict、讀取失敗與 workspace／query supersession。新 runner 已列入 solution 及完整建置腳本。

Host 13:08:25／App 13:08:34 發行後，13:09–13:14 使用同一 S4 workspace。原生將 Alpha Number 從 0 改為 42.5，保存 revision 32；畫面成功更新（目前顯示精確 canonical `425e-1`，可讀格式仍待改善）。探針 `ui-20261004-050918.json` 的 `recordsCommitToPaintOpportunity` 留下 1 筆 **207.6 ms**，證明這次定點保存不再漏記；不是足量效能驗收。

本報告時長 283.0 秒，query 3 筆 p95 179.9 ms、collection switch 1 筆 75.8 ms、input 1 筆 2.0 ms、首次 note switch 1 筆 58.0 ms。Foreground frame 36,000 筆 p95 4.3 ms／max 41.8 ms，達 cap 後 10,048 個樣本未保存；不宣稱完整時段無停頓。雙 rAF 是呈現機會，含 child DOM／handlers ready，不含 lazy 圖片下載解碼。

關聯搜尋清單已固定高度避免結果變少時 modal 跳動，本段未另做其原生重驗。App／Host 正常退出且程序不存在，驗收 Obsidian 視窗亦正常關閉，前台已釋放。尚未完成 30 次代表操作及約五分鐘連續互動的整體門檻。

## 本段 Wiki／Grasp 參照原生驗證（有限必要流程通過）

2026-10-04（Asia/Taipei），主代理使用真實 Windows App 與 `workspaces/S4-Acceptance-1004`。Links fixture 經公開服務準備至 revision 15；既有九篇筆記、檔案及草稿維持不變。前輪探針 `ui-20261004-034024.json` 自 11:40 開始，記錄 reader／table／card 操作；最新 Host 11:47:31、App 11:47:38 的 publish 已含 missing-origin 保護及 return-collection 記憶修正，後輪 `ui-20261004-034807.json` 自 11:48 開始，至 11:55 正常關閉。這些是尚未 commit 工作段的本機發行，不冒充新的已推送 checkpoint。

| 呈現位置／操作 | 已觀測結果 |
| --- | --- |
| Live Preview reader 的 Wiki alias | 括號／syntax 隱藏且有 link highlight；點擊成功開 Source |
| Reader 的多段 pure reference | 點擊直接開 Source，定位 `@LiveLinks.Message` 第 10 行並選中 identifier |
| Table Wiki 欄的短 pure reference | 點擊直接開 Source，定位 `@LiveLinks.Short` 第 15 行 |
| Table Wiki 的來源標題連結 | 點擊開 Source，Reading 目標 heading 可見 |
| Record card | 兩式短／多段 reference 保留空行、粗體及 highlight；點 managed wiki 多段值直接到 Source 的 Message 第 10 行 |
| 完整 Longform 欄位 | 兩式多段 reference 的粗體、空行及預覽正確；加入未保存「 草稿保護驗收」後點 reference，dirty guard 阻止導航並保留文字 |
| Longform 恢復原文與導航 | 原生 Ctrl+Z 恢復原文，再點 managed wiki（ref2）開 Source 的 `@LiveLinks.Message`，實際 selected_text 為 `LiveLinks.Message` |
| 返回資料表 | 點側欄資料表後仍為原連結驗收 collection，return-collection 記憶有效 |
| 完整 Links 欄位的鍵盤導航 | Tab 從 textarea 聚焦 Wiki，焦點 outline 可見；Enter 成功開 Source 的 Reading 導航目標 heading |

後輪未提交 fixture 原文，workspace 仍為 revision 15；暫存驗收文字已由 Ctrl+Z 撤回。App／Host 正常關閉後程序皆不存在，前台已釋放。一般 Wiki 的 Enter 已測；Grasp reference 的 Enter 尚未專項原生測試。

工程：editor build／test 通過；RecordsService render 6 assertions 通過，涵蓋 UTF-16／origin、disabled context、cache 不遞迴及更新。Missing-origin 回退 reader 的缺陷已修、測試且包含於最新 publish，但**未做原生缺失來源案例**；不因正常來源导航成功推定缺失來源保護已原生驗收。這批 UI 已實作且上述有限必要原生流程通過，S4／全 Goal 仍 IN_PROGRESS，使用者接受另記。

Records 父層雙 rAF 只界定父元件的繪製機會，**不保證包含子 JS renderer 的完整 paint**；相關時間不得當成完整 card／cell 可見端到端延遲。驗證保持有界，後續只補具體缺口及受影響回歸，不重跑既有全套 parser／性能測試。

## 已有原生證據：S4-Acceptance-1004（revision 2–6）

以下原生結果的發行基底為 f3eb9ea；凍結／carrier 修正已由主代理審查，並隨 `62780134a29ab49f8d7a25de973e2f9b0e0041c6` commit／push。當時 publish 已含 import 初始選取修正及 Records performance hooks（App 11:17:07／Host 11:05:58，2026-10-04 Asia/Taipei），TS build／架構檢查通過，新的 import 導航仍待原生重驗。以下使用真實 Windows App 與忽略的 `workspaces/S4-Acceptance-1004`；App／Host 已正常退出、程序清單為空，前台已釋放。

| 操作 | 實際結果 | 邊界 |
| --- | --- | --- |
| Mentors 第 1 張 table，15×8 | 預覽並建立獨立縱向 collection，revision 2；來源原筆記仍列在檔案樹 | 不代表第 2 張表已轉換驗收；Aura 的獨立結果見下方 |
| 「角色職責」view | Name 升序，額外凍結 1 row／1 column；revision 3，重開仍保留 | 只涵蓋本 view 的設定與保存 |
| 雙向捲動 | 發現 frozen Name header 被其他 scroll headers 覆蓋；修正層級後重新發行，Name 標題、首列、record title 均維持固定 | 原生觀察，不是量化 frame／input 成績 |
| 排序中編輯 | `Imported1.Name` 加 `AA` 前綴，revision 4；Triensa 移首列、key 不變；重開同 cell 確認保存 | 只驗本次文字欄位／排序組合 |
| 恢復原文 | 同 cell 還原，revision 5；排序恢復 | 保留資料與身分，未驗全部型別 |
| Toolbar／返回筆記 | 長路徑擠壓已修；Records 模式提供返回筆記；側欄直接點 Triensa 可回真實筆記 | 不表示完整導航／卡片互動已完成 |
| Aura 第 1 張 table，81×5 | key prefix `Aura`，預覽／建立新 collection 成功，revision 6；原來源仍列出 | import 後先顯示舊 collection 的缺陷已修，已發行，待原生重驗 |
| Aura 分頁 | 手動下拉選新 collection，第 1／2 頁 → 第 2／2 頁，首列 `Aura51` 可見 | 不代表 81 筆欄位／關聯及全部卡片皆驗完 |

凍結修正將 frozen field header 層級提高至 13，普通 header 為 12、record title 為 14；只修重疊順序，不改 Records 身分或排序契約。

Aura import 後仍先顯示舊 collection 的缺陷，root 已以 `InitialCollectionId` 修正，已 publish，尚待原生重驗。本段還未完成九型別、跨筆關聯、完整圖片／link 卡片、Obsidian 交替、IME／dirty 競態或至少 30 次代表操作效能。Records performance hooks 已加入並 publish，尚未取得新版 hooks 的有效代表量測，不報 pass。

本節保留較早 revision 2–6 的資料表證據；新增 Wiki／Grasp fixture 及最新原生操作見上節，不以先前狀態覆蓋本段結果。

## 工程證據

| 範圍 | 本段結果 | 主要契約 |
| --- | --- | --- |
| Grouped storage | 30 assertions | 一實體檔多 note IDs、精確正文、外部修改與來源註冊 |
| Grouping metadata | 10 fixtures | 未知 YAML／original ownership／unassigned 保存 |
| Grouping links | 11 fixtures | incoming／outgoing links、anchor 唯一性、不猜改寫 |
| Grouping service | 6 groups | merge／split、guards、部分寫入恢復、receipt、真導航與 backup |
| Records codec | 44 assertions | typed／null、長文 carrier、UTF-16 mapping、heading conversion |
| Records Knowledge | 先前 13 groups；本段擴至 16 groups 通過 | generated property、相依、ID、rename、nested external shared edit；generated Markdown 欄位中手寫 binding 改名拒絕走 shared value 入口，改走 source／field 確認以保 ID；外部 raw 保留 |
| Records workspace | 30 assertions | YAML metadata、raw 唯一來源、group move、無效 metadata 保留 |
| Records service | baseline 45 assertions 本段重跑通過；另 targeted 11 assertions 通過 | 九型別、option／relation IDs、view／retry；新增 option／record name 的 raw、generated property、cache 同 journal |
| Markdown table import | 6 groups | alias／code／escaped pipes、ragged rows 拒絕、原始 bytes 保留、同 parent、metadata／mapping、source guards、receipt 重試及 backup |
| Host HTTP | 57 assertions | 原有流程加真 HTTP collection／field／rename／view／grouped navigation |
| Content resolver | 50 assertions | 圖片來源邊界、wiki／相對 path、group member 定位 |
| 本段相關回歸 | Core 162 fixtures；Coordinator targeted 1 fixture 通過 | 共享 rename 保護、外部搬移依 ID 調整相對 link、dirty draft 保留、自己的 echo 為 no-op |

App Release（含 RecordsPanel、分組／轉換 dialogs）建置零警告／錯誤，Host／App 本機 publish 成功。因 Upsert 同時改 key／label 亦受 carrier 影響，補跑一次 RecordsService baseline 45 assertions，未重跑全 suite。本段 carrier 修正已由主代理審查並成功 publish，但該 carrier 路徑尚未原生驗收；不沿用 build／publish 為 GUI 證據。

分組限制：目的父資料夾須存在；20,000 visible entries／64 層為操作上限；不跟隨 reparse points。不明或非 plain heading 的 anchor 轉換拒絕自動套用。未分配正文／YAML 保存為 `.json`，原始 bytes 留在 journal；正常正文保存不因這些分組限制失效。

Table import 首輪只處理已觀測、無草稿、single note 的實體 Markdown 檔。預覽允許修改 record key prefix／field keys／顯示名稱；建立同 parent 的新 collection，保留原筆記。所有欄位先採 Markdown；空 cell 是空字串，`<br>` 明示轉真換行、code span 內的 `<br>` 保留，heading 轉 H5／H6 或巢狀清單。原檔 snapshot、欄位原文與轉換 mapping 保存在 `.grasp/record-import/previews`，backup 包含該資料。Wiki links 不代表目標已匯入，也不自動推斷 Records 關聯。

## 真 Markdown 提交效能

Release，SDK 10.0.401／runtime 10.0.12，Windows 10.0.26200 X64，目前 PC 32 logical processors。資料全為固定短值的合成資料，不讀私人 vault。量測 `ChangeLiteralAsync` 包含 prepare、durable journal、實體來源回寫、SQLite 與 receipt；驗值成本另列於量測外。

| 案例 | 完整更新 | 種子建立（另計） | 判定 |
| --- | ---: | ---: | --- |
| 100 nodes／1,000 references／5 notes，暖機後 30 次 | p95 334.1 ms | 377.0 ms | 後端部分低於 800 ms |
| 1,000-edge chain／1,001 nodes／3 notes，1 次 | 242.4 ms | 355.0 ms | 低於 2 秒 |
| 10,000-target fan-out／10,001 nodes／3 notes，1 次 | 832.0 ms | 1,162.6 ms | 低於 2 秒 |

小型 prepare／source-journal／database-finalize median 約 1.4／252.7／52.7 ms。主要成本是 durable physical path；沒有超標，不進行無目的優化。這些是本機工程量測，**不包含 GUI 可見時間，也不是最低硬體認證**。

本機結果：`workspaces/SourcePerformance-ce97070ba4204eb6a92fb6a39d5a4d53/result.json`（忽略，不提交）。重測指令：`dotnet run --project tests/GraspPortable.SourcePerformance.Tests -c Release`；此 runner 不放入每次 build 的預設回歸清單。深鏈／扇出各一次是有界案例結果，不是 p95 或完整長期容量認證。

## 原生量測與尚待驗證

Launcher 可用 `-MeasurePerformance` 啟用本機有界探針，正常關閉寫入當時 workspace 的 `.grasp/measurements/ui-*.json`。只記時長與次數，不記正文／識別碼；最長十分鐘，foreground frame 排除初始五秒與失焦。兩次 rAF 是下一次繪製機會的保守近似，不是螢幕光子時間。Records hooks 已取得下列有限樣本，足量代表操作及完整可見延遲仍待收集。

目前仍缺至少 30 次代表操作與約五分鐘連續互動的完整原生證據，須分開記 note／commit／Records 操作及可見延遲，不以後端數字代填。完整啟動指令見 [FirstUI Quickstart](FirstUI-Quickstart.md)；探針預設關閉，修正後只重測受影響流程，不為累積數字重跑全庫。

下一步以最新 publish 原生重驗 import 初始 collection 選取，再做 carrier 修正原生確認、九型別／關聯／完整長文卡片、合併／拆分其他流程、Obsidian 交替與衝突 UI、IME／dirty 競態、解析政策及縮放。已完成的有限 import／凍結／排序流程以上表為準；備份 generation 選取已重驗，畫面選取與還原收據一致，詳見 [S2 Validation](S2-Validation.md)。

指定真實樣本為四份 Markdown 與四張直接引用圖片，原始基線在忽略的 `workspaces/S4-Sample-Source`，hash 存 sample manifest；實際操作副本為 `S4-Acceptance-1004`。未掃全 vault 或 Legacy1，私人內容不進 Git。Mentors 第 1 張為 15×8、已原生轉換；第 2 張為 15×3（40 個 `<br>`），目前僅解析統計、無診斷；Aura 第 1 張 81×5 已原生轉換，並確認第 2 頁 `Aura51` 可見。Triensa／Anria 完整卡片與跨筆關聯仍待驗，不能由 table 解析或單 cell 編輯推定完成。

主代理補驗時記錄發行 checkpoint／未提交來源、實際 workspace、資料規模、操作及通過／失敗／未驗項、探針路徑與結果、DPI／IME 模式、前台釋放狀態。尚無證據的欄位保持待驗。


本段兩份報告在 `workspaces/S4-Acceptance-1004/.grasp/measurements/`（忽略，不提交）。最新 `ui-20261004-034807.json`：recordQuery 3 samples／p95 135.5 ms，collectionSwitch 1／78.9 ms，input 2／p95 5.3 ms，noteSwitchFirst 1／46.9 ms；frame 36,000／p95 4.3 ms／max 50 ms，scroll 95／p95 4.3 ms／max 16.7 ms。前輪 `ui-20261004-034024.json`：noteSwitchFirst 2／p95 88 ms、warm 2／p95 37.6 ms、recordQuery 6／p95 121.9 ms、collectionSwitch 3／p95 71 ms。樣本不足 30 次代表操作，Records 指標亦未包含 child renderer ready／完整 paint，**不構成完整端到端效能通過**；不為湊樣本擴張本段測試。

當次 `ui-20261004-030650.json` elapsed 556.9 秒：input 1 sample／4.4 ms，noteSwitchFirst 1 sample／36.3 ms，scroll 169 samples／p95 8.4 ms／max 25 ms，frames 36,000 samples／p95 4.3 ms／max 37.5 ms，long tasks 8／max 65 ms；仍缺 30 次代表操作，不構成階段完成或新版 Records hooks 的完整量測。

## 歷史：已推送 f3eb9ea 的卡片與受控測試證據

下列是較早 `S2-Review-1004` 操作，當次前台已釋放；不是目前工作段已釋放的聲明。

原生建立「角色資料驗證」，將 null 改文字，輸入中文兩段、空行、粗體與清單並保存。實體 Markdown 使用 H2／H3／H4 與 field markers，正文只保存一份，generated key 為 `Record1.Description`。最初卡片顯示 Markdown 標記；修正並重開後，粗體／真正 list items／段落正確呈現，沒有重新解析 Grasp 求值結果。

Escape 關閉卡片且焦點框回原 record 按鈕；modal 開啟時 UIA 不暴露背景控制項。Shift+Tab 有操作，但 focused_element 只回原生 pane，不宣稱完整 Tab 巡覽通過。該次 App 正常關閉、視窗消失；不是九型別／關聯／凍結完整驗收。

歷史探針 `workspaces/S2-Review-1004/.grasp/measurements/ui-20261004-022936.json`：約 382.6 秒，foreground frame 36,000 samples、p95 4.3 ms／max 20.9 ms，達取樣上限；input 只有 2 samples、最大 8.2 ms。**不足以宣稱 UX／端到端門檻通過**，本段未重用為新的 Records 性能結果。

受控測試入口已改 try/catch 正常 unwinding，保留 stacktrace／exit 1，不改 Windows 錯誤設定。`TestEntry.Tests --fail` 驗 exit 1／finally；Content 50 assertions pass／exit 0。當次未新增匹配 WER／CLR 事件、沒有 WerFault process；不宣稱產品子程序任何崩潰都被攔截。
