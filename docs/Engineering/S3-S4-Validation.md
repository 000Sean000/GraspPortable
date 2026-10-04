---
title: GraspPortable — S3 / S4 Validation
version: 1.18.0
updated: 2026-10-05
status: implemented-parts-with-partial-native-evidence
---

## 判定

分組、Records engine／metadata／service、資料表 UI 與 Markdown table 轉換已接入產品，最新 App／Host 已完成本機 publish。下列有界工程測試及 15×8 import／view／凍結／排序編輯已有實際結果；完整原生驗收仍未完成，不是阶段完成或使用者接受聲明。S1／S2 仍 PARTIAL，動態進度由 [EXECUTION-STATE](../EXECUTION-STATE.md) 維護。

## 共用 Records JS module（2026-10-05）

在 70a6f62 基底上，RecordsPanel 與各 cell／card／完整欄位共用一個 panel-local module owner。單一 import task 配合 child leases，parent 離開不等待尚未執行的 child Dispose；最後引用等待 in-flight import 並釋放一次。Child 先清理自己的 DOM／事件／receiver，再釋放 lease。這同時移除每個新 cell 各自 import／dispose module reference 的跨界呼叫，修正 import 完成前離開可能漏釋放 reference 的情況。沒有更動 Markdown renderer、導航契約、generation／workspace guards、圖片上限或量測成功判準。

Records UI 26 fixtures（新增 5 個 module lifetime fixtures）通過，App／Host Release publish 與架構檢查通過。延遲 fake runtime 驗證共享 import、parent 先離開、最後 child 清理、import 途中離開及 fault／未使用 owner；這不是實際 Razor lifecycle 的全面測試。

原生同 workspace revision 77、同前五次集合切換在私人報告 `ui-20261004-213854.json` 得到 252.0、110.2、192.2、105.0、228.1 ms。第一個 Aura 為首次；Aura 暖機 192.2／228.1 ms，改善但仍有樣本超過 200 ms，**尚未通過暖機效能**。Mentors 暖機 110.2／105.0 ms。第六次 102.1 ms 是另開型別驗收表，不能併入 Aura 樣本。兩次暖機僅供有界比較，未聲稱完整 p95 或模型效果。

原生開 Alpha 角色卡，圖片、Wiki 高亮、兩式多段 Grasp 參照及段落粗體保持；點第一式第二段後直接開來源並選中第 10 行 LiveLinks.Message 定義。這同時實際經過離開 RecordsPanel 的 module 清理流程。正常關閉後 App／Host（含 dotnet Host）程序零，前台釋放；既有衝突草稿只選保留，沒有提交或改掉原 revision。

全局檢視：兩段修正已有小幅／部分改善，剩餘成本不能由總延遲直接歸因。下一步先分開觀察資料讀取、Razor／interop及 child 呈現成本，再決定是否批次 render；不縮小既有頁面規模、不關閉 managed links、不放寬門檻。IME／焦點／足量代表操作等整體 S4 缺口仍保留。

## Records 暖機比較與有界優化（2026-10-05）

保留主 workspace revision 77、兩份 durable drafts 及既有外部原文。先以原發行版走 Mentors → Aura → Mentors → Aura → Mentors → Aura，私人報告 `ui-20261004-181607.json` 的 collection-switch 五次樣本依序為 277.7、123.5、261.1、114.4、254.1 ms。第一個 Aura 為首次；其後暖機 Aura 261.1／254.1 ms 明確超過 200 ms 門檻，不能把首次成本混入後就忽略暖機失敗。

本次 Read 捕捉同一 knowledge snapshot、只建立一次 Owners、以 request-local lookup 取欄位／definition／syntax，仍以 Single／SingleOrDefault 拒絕所查 key 的重複。草稿狀態每次 Read 取一次（記憶體字典，不是 SQLite I/O）。App 每次 render 重用 visible fields、filtered rows、display rows 與頁數，不保留跨 view／source 的 cache；identity、reference metadata、revision、導航與圖片 invalidation 不改。

必要驗證：RecordsService `query-read render baseline` 60 assertions、Records UI 21 fixtures、四 Project 架構檢查及 App／Host Release publish 通過。fixtures 涵蓋 typed null、兩式 reference／UTF-16 ranges、relation choices、missing definition、重複 field origin、dirty／stale 編輯限制；build 或 fixtures 不證明原生效能。

新版同一集合切換流程在私人 `ui-20261004-212000.json` 得到 274.4、118.8、246.1、115.0、247.9 ms。Mentors 暖機 115.0–118.8 ms；Aura 暖機 246.1–247.9 ms，較基線稍降但**仍未達標**。兩次暖機不是足量 p95 驗收，也不能隔離每項優化的因果貢獻。query 及 collection-switch 屬同一操作的不同 span，不重複算驗收次數。

原生畫面：既有 conflict draft 選保留後進入表格，沒有接受或覆寫外部原文；Mentors 15 筆／8 顯示欄位與 Aura 81 筆／5 欄位仍有 Wiki 高亮；Aura 第二頁從 Aura51 起，分頁未套錯列。正常關閉後 App／Host（含 dotnet Host）程序均無，前台釋放。本次不重宣告舊連結點擊、IME、DPI 或整體 S4 通過；下一步針對 cell rendering／interop 成本做必要定位，不擴大測試資料或降低門檻。

## 先前有界補驗與收工（revision 60–77）

主 workspace 以定點外部段落修改觸發重解析至 60，原生相依筆記的整欄 reference 保留多段粗體、空行與清單，不再落入 indented code。欄位 definition ID 不變。既有未完成原文和其他 durable draft 保留，沒有清 DB 或全域重建。

Mentors 新增 Markdown 欄位 Biography（61），Anria 卡片貼入按需求選取的原卡長文，確認五個 heading 的巢狀清單轉換後保存（62）。重開卡片可見圖片、層級、隱語法／highlight 的 Wiki；點「查看 Anria 原卡」直接到實際來源檔。短名稱在有限樣本不存在時仍屬 missing，不猜測其他目標。私人來源、圖片及 manifest 不進 Git。

合成互動筆記的 dirty rename draft 與外部原文保持兩版本；確認合併後至 76。再次外部修改至 77，合併右側另加文字，選「保留草稿，稍後處理」後正常關閉／重開，新增文字與 base 76 保留。明確保存仍顯示最新外部原文與本地草稿，不自動採用新基底。再次保留、正常退出後核對 draft revision 2、兩份 durable drafts、原文存在 SavedSource.Text 及實體檔，未接受改名未發布。App／Host 程序零。這是 dirty conflict 原生證據，非 IME 競態證據。

本段 `ui-20261004-091004.json` 為 600 秒上限的私人量測，skipped 0：

| 指標 | 樣本與結果 |
| --- | --- |
| 前景 rAF interval | n=142,356，p95 4.3 ms，max 70.9 ms，≥200 ms 為 0 |
| 前景 long task | n=9，p95／max 74 ms |
| 滾動 rAF interval | n=758，p95 8.3 ms，max 29.2 ms |
| 輸入至 paint opportunity | n=5，p95／max 10.6 ms |
| 筆記切換／首次 | 各 n=1，82.4／49.3 ms |
| Records query 至 paint opportunity | n=3，p95／max 491.3 ms，尚須區分首次／暖機 |
| Records commit 至 paint opportunity | n=2，p95／max 652.8 ms |
| Note commit 至 rendered note | n=2，p95／max 111.6 ms |

這不是完整效能通過：600 秒含操作間工具等待，不等於五分鐘連續互動；有效樣本不足 30 次代表操作，暖機 query 200 ms 門檻尚未證明。探針達上限後的操作不計入。使用者要求暫時收工，IME／縮放／焦點與足量效能留到恢復 Goal 後，不擴充資料規模。

## 歷史：長文轉換與巢狀參照（revision 58–59）

續作補驗：最新 publish 在三篇合成 workspace revision 7 的 Reader／Reading 顯示兩段粗體、空行及 A→B→C 三層清單，沒有多出的 code block；外層屬性 reference 隱藏語法／highlight，點第二段開 Projection.md 並定位欄位正文第 7 行。Alt+F4 正常關閉後 App／Host（含 dotnet Host）程序皆零。此為先前 Esc 中斷後重新提醒並完成的原生檢查；不代表主 workspace 59 已重建解析，也不代替 IME／DPI／效能驗收。

原生將指定 Triensa 副本的長文、兩張圖片、Wiki、JSON fence 與一個 Grasp reference 放入 Alpha 的 Description。保存先列出五個標題的 H1／H2／H3 對照與巢狀清單預覽，確認後 revision 58；資料集／record／field 結構仍為 H2／H3／H4，程式碼 fence 內的 `#` 不改。轉換前原文與 mapping 保存在同一提交的 immutable metadata history，source／locator／receipt 使用既有恢復日誌。尚無一鍵反轉 UI。

實際操作抓到六空格正文被當 indented code、失去 reference metadata。Core 修正 list container-aware context，保留實體 source offsets；跨行 reference cache 不再使 scanner 誤判退出清單，真正 code／停用 fence 仍不解析。預覽另核對轉換前後引用 kind／name 序列，不允許靜默漏掉 reference。

修正後受控外部編輯加入一段文字及兩式多段 reference，watcher 自動接受 revision 59。原生卡片的 Wiki 隱 syntax／highlight、兩張圖片載入，兩式多段 reference 保留粗體與空行，分別點擊均選中來源第 10 行 LiveLinks.Message。正常關閉後確認同一 generated definition ID／FieldOrigin、三個 references、兩張圖片、外部段落、零來源診斷；原始輸入與恢復歷史一致（以 textarea 的 LF 正規化核對），歷史恰一份，既有 durable draft JSON 完全相同。

重開後相依筆記仍顯示更新後長文、revision 59／診斷零；但另抓到 generated Markdown 的多段值缺少 continuation prefix，第二式展開文字被通用 Markdown 當 code。此問題另作 Core 修正，不能將卡片內導航通過擴張為所有衍生呈現已通過。私人證據為 `workspaces/AcceptanceSupport/longfield-closed-verification.json`、`longfield-reopened-verification.json`，不進 Git。

本主 workspace 保留一篇未完成來源，因此全域相同 allowlist 重建被正確攔下，未改其他資料；本次靠目標檔的外部編輯重新解析。沒有 stale source 時的同清單重建、另一篇 rename draft 保留及重開已有合成服務測試；不刪 DB，也不宣稱新 binary 會自動重建舊解析索引。

後續 computed Markdown 修正已完成並 publish：僅 Markdown generated field 的 identifier part 帶清單 continuation prefix，求值後每個換行保留 CR/LF 並補容器縮排；原始 literal／reference cache／普通 composition 不改。Core 167、Records 47、RecordsService 受影響三組 18 assertions 通過，先前 conversion 18 與 RecordsUi 21 維持有效。同版 marked renderer 對三層清單內兩式引用產生兩段粗體、零程式碼區塊，私人報告 `workspaces/AcceptanceSupport/computed-markdown-render.json`。最後原生合成畫面確認被使用者 Esc 中止，尚未通過；主 workspace revision 59 也尚未重新解析此 prefix，不將 renderer 證據擴張為原生驗收。

## 缺失 record／definition 與 parsing 政策（revision 54–57）

以受控檔案修改在既有獨立 workspace 暫時把 Alpha 單筆關聯換成不存在的 record ID。原生點擊 Triensa 的可讀標籤，顯示「找不到這筆關聯紀錄」，沒有退回依名稱／路徑猜測；恢復原 carrier 後 revision 55 無該診斷。再暫時移除 LiveLinks.Short 定義，revision 56 點引用明示找不到定義且停留原表；恢復後 revision 57 點同引用重新選中來源第 15 行。私人原文與恢復片段未入 Git，原 TestData 不變。

另在只含一篇合成筆記的 `workspaces/S4-Policy-1004`，由原生設定介面將 grasp-demo 加入 allowlist，預覽影響後套用。原本兩個有效定義增加為三個；json fence 仍不解析，無標籤 fence 設定保留。詳見 [S1 Validation](S1-Validation.md)；本次不是 policy 故障注入。正常關閉後唯讀報告 `workspaces/AcceptanceSupport/policy-missing-verification.json` 核對結果。

## 第二 view、連結與量測保護（15:29–15:53）

原生建立 Mentors 第二 view「角色篩選驗收」，隱藏 Symbol、Name contains Triensa，revision 51。將唯一結果的 Name 改為普通文字後變為零筆（52）；切回原 view 確認同 Imported1 record 被修改，再恢復原 Wiki（53）。重新啟動新 publish 後，第二 view 仍為 1／15 筆、七欄；原角色職責 view 八欄及凍結設定保留。

新版表格 cell 的 Wiki 及 Grasp reference 保持隱藏 syntax、highlight。Wiki 開啟 Obsidian 改名後來源檔，reference 選中 LiveLinks.Short 第 15 行（accessibility selected text 同名）。Mentors 中短名稱 Wiki 缺失時明示找不到工作區目標，停留原表而不猜測其他檔。尚未完成 missing record／definition 的對應原生案例。

修正 opt-in 探針只接受確實套用結果，保留 Records child-ready barrier，兩次 rAF 均核對前景、輸入世代及相同 DOM token。Home 區分操作已接受與畫面已套用；草稿、拒絕、過期、失敗不記成功 span，量測失敗不阻斷保存。raw 上限 180,000，完整 count／max／≥200 ms 次數不被截斷，p95 標示 all 或 retained-prefix。新增受控 RAF 回歸及 Records guard fixture 通過；editor suite／App Release／四 Project 架構檢查／publish 通過。

新 publish 原生報告 `workspaces/S4-Acceptance-1004/.grasp/measurements/ui-20261004-074913.json`（私人報告不進 Git）：

| 指標 | 本次結果 |
| --- | --- |
| 觀測時間 | 236.8 秒；skipped 0 |
| Records query 至 paint opportunity | n=3，p95／max 197.6 ms |
| View 切換 | n=1，22.1 ms |
| Collection 切換 | n=1，58.0 ms |
| 前景 rAF interval | n=52,356，p95 4.3 ms、max 50 ms、≥200 ms 為 0 |
| 滾動 rAF interval | n=98，p95 4.3 ms |

這是新探針有界核對，**不是完整效能驗收**：未達 30 次代表操作／五分鐘，無本輪 note commit 或輸入樣本；rAF 是繪製機會，不是螢幕顯示時間。query 與 switch 可來自同一次操作，不重複計數。前一份舊探針報告不補入新探針樣本。原生確認與探針修正分開記錄，S4 狀態不變。

## 改名、轉換選取及 Grasp Enter（15:03–15:23）

使用同一 `S4-Acceptance-1004` 的小型資料，不擴大私人樣本。Windows GUI 完成：

| 操作 | 結果 |
| --- | --- |
| 長文欄位 key Markdown→Description | revision 47；確認後兩式跨筆記引用改為 Checks.Alpha.Description，粗體／空行／Wiki 保留，點引用開來源欄位第 7 行 |
| Beta 的 display name／key 改名 | revision 48；同 record ID，關聯欄及引用正文顯示「Beta 改名後關聯目標」；點關聯仍開 Checks.BetaRenamed 卡片 |
| 單選「選項甲」改為「選項甲（已改名）」 | revision 49；option ID 保留，表格值、Markdown source 及另一筆記 reference cache 同步；獨立多選欄的選項未被混同 |
| 一列兩欄 NavCheck Markdown table 轉換 | revision 50；套用後直接選中新 collection 並顯示 NavCheck1，原來源筆記仍在檔案樹 |
| 完整 Links 欄位鍵盤導航 | 最新 App 中 Tab 依序聚焦 Wiki／純式 reference；Enter 開來源檔並選中 LiveLinks.Short 第 15 行，沒有改內容 |

正常關閉後，唯讀 SQLite 比對 revision 46 的前次還原基底：Types 的 20 個 generated definition IDs 全保留、新名稱映射正確，原 durable draft JSON 不變。現有 15 notes、555 definitions、100 records、1 draft；報告 `workspaces/AcceptanceSupport/rename-1523-verification.json` 不進 Git。

最新 App 15:18:21／Host 15:18:10 包含未接受引用的呈現防線；原生確認 Live Preview／Reading 保留完整 source、不誤跳，而有效欄位仍 highlight／可導航。工程範圍與限制見 [S1 Validation](S1-Validation.md)。App／Host 正常退出後程序數零，前台已釋放。

本段沒有足量效能測量；剩餘 native missing／view／真實長文／IME／policy／縮放與端到端門檻依 EXECUTION-STATE 繼續，不宣稱 S4 全部完成。

## 跨表 tag 與較新 durable draft 還原（14:37–14:54）

跨表 tag 已補實作：Host 以 snapshot 的已接受 computed Tag 搜尋，無效／null／stale 不冒充有效結果，不再解析 Grasp 求值結果。每 record／field 一項、API limit 上限 100、UI 每頁 50，總數不靜默截斷；回傳穩定 record／field IDs、dirty 及不可用 collection 資訊。UI 入口「跨表標籤」，Enter 搜尋、可分頁、點結果沿 fresh record ID 開卡片。查詢與 workspace／SSE／關閉版本分開，保護 dirty editor。

RecordsService tags 13 assertions 通過，涵蓋兩表、computed reference tag、中文／非標籤不匹配、分頁 ID、dirty、invalid／unavailable、bounds／取消；RecordsUi 16 fixtures 通過，涵蓋新 query 編碼／導航、舊回應、初次 SSE 及 dirty guard。原生從 Mentors 表搜尋「角色」，找到 Types Alpha，點開同卡片；其中 Wiki 隱 syntax／highlight 並跳到改名後來源，無新增內容副本。

較新草稿案例：在來源處理驗收筆記把 definition 改為 Resolution.Deferred，舊 committed 仍是 Resolution.Pending；選保留後再加入「保留後新增第二版，必須一併恢復。」。切換再返回及手動備份可行。14:46:47 的 `generation-20261004T0646474421136Z-4cd7779bd8644039835dea0cdf3dda8f` 含 401 檔，UI 還原至 `workspaces/S4-Draft-Restored-1004-1447` 並開啟，較新兩版草稿、標題及舊定義分開可見。

正常關閉後唯讀確認：原與還原 workspace 的 draft JSON 完全相同（同 note ID／session、revision 2、base 46、title／source／hash），accepted note revision 46 不變。報告 `workspaces/AcceptanceSupport/draft-1447-verification.json` 忽略於 Git。沒有重跑先前全檔 hash restore 驗證；本案補的是 durable draft 差異。

初版 Keep 的背景時序誤報已修；最終 App 14:52:35 重驗第一次 Keep 即成功，正常關閉，程序數零。完整 Goal 仍未完成：其餘 carrier／views／missing／長文／IME／performance 以 EXECUTION-STATE 的下一步為準。

## 新欄位與當時功能缺口（revision 40）

新欄位原先傳入隨機非空 ID，被 Host 判定未知現有欄位而拒絕。改為 create 傳空 ID，由 Host 按 operation 派生；update 仍保留原 ID。RecordsUi 的實際 Save request fixture 覆蓋兩條路徑，合計 12 fixtures 通過。App 14:03:10 原生新增「新增欄位驗收」／Field1／Markdown 成功，型別 collection 由九欄成十欄，兩筆 null；重開設定正確。另一筆 workspace 通知到達時，表單保留輸入與原 revision，未誤寫。

Obsidian 改來源檔名後，型別表中的 Wiki 及多段 reference 導航仍有效，詳見 [S2 Validation](S2-Validation.md)。Field key／option／record carrier 改名、缺失目標、第二個 view 的篩選／鍵盤焦點及真實長文外部往返尚有原生缺口。

當時全局審查發現跨資料表 tag 搜尋缺口與 durable draft 的手動備份／關閉阻擋；後續已修正並取得上方 14:37–14:54 的原生證據。代表性 30 次操作及五分鐘連續互動仍待量測。

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

下一步處理主驗收資料重解析，再補 IME／dirty 競態、代表性縮放／凍結區鍵盤焦點、Anria 長文與足量端到端量測。computed Markdown 合成原生畫面、Import 自動選取、正常 carrier 改名、九型別基本操作、關聯、合併／拆分、Obsidian 交替、一般來源衝突及基本解析政策已有上述有限證據，不重做全部案例。備份 generation 選取與還原收據一致，較新 durable draft 另已核對；詳見本頁與 [S2 Validation](S2-Validation.md)。

指定真實樣本為四份 Markdown 與四張直接引用圖片，原始基線在忽略的 `workspaces/S4-Sample-Source`，hash 存 sample manifest；實際操作副本為 `S4-Acceptance-1004`。未掃全 vault 或 Legacy1，私人內容不進 Git。Mentors 第 1 張為 15×8、已原生轉換；第 2 張為 15×3（40 個 `<br>`），目前僅解析統計、無診斷；Aura 第 1 張 81×5 已原生轉換，並確認第 2 頁 `Aura51` 可見。Triensa 長文及兩張圖片已有欄位轉換／外部修改／卡片參照原生證據；Anria 完整長文仍待定點取樣。跨筆／跨表關聯的基本建立、改名與缺失已驗，不能據此推定全部故障邊界完成。

主代理補驗時記錄發行 checkpoint／未提交來源、實際 workspace、資料規模、操作及通過／失敗／未驗項、探針路徑與結果、DPI／IME 模式、前台釋放狀態。尚無證據的欄位保持待驗。


本段兩份報告在 `workspaces/S4-Acceptance-1004/.grasp/measurements/`（忽略，不提交）。最新 `ui-20261004-034807.json`：recordQuery 3 samples／p95 135.5 ms，collectionSwitch 1／78.9 ms，input 2／p95 5.3 ms，noteSwitchFirst 1／46.9 ms；frame 36,000／p95 4.3 ms／max 50 ms，scroll 95／p95 4.3 ms／max 16.7 ms。前輪 `ui-20261004-034024.json`：noteSwitchFirst 2／p95 88 ms、warm 2／p95 37.6 ms、recordQuery 6／p95 121.9 ms、collectionSwitch 3／p95 71 ms。樣本不足 30 次代表操作，Records 指標亦未包含 child renderer ready／完整 paint，**不構成完整端到端效能通過**；不為湊樣本擴張本段測試。

當次 `ui-20261004-030650.json` elapsed 556.9 秒：input 1 sample／4.4 ms，noteSwitchFirst 1 sample／36.3 ms，scroll 169 samples／p95 8.4 ms／max 25 ms，frames 36,000 samples／p95 4.3 ms／max 37.5 ms，long tasks 8／max 65 ms；仍缺 30 次代表操作，不構成階段完成或新版 Records hooks 的完整量測。

## 歷史：已推送 f3eb9ea 的卡片與受控測試證據

下列是較早 `S2-Review-1004` 操作，當次前台已釋放；不是目前工作段已釋放的聲明。

原生建立「角色資料驗證」，將 null 改文字，輸入中文兩段、空行、粗體與清單並保存。實體 Markdown 使用 H2／H3／H4 與 field markers，正文只保存一份，generated key 為 `Record1.Description`。最初卡片顯示 Markdown 標記；修正並重開後，粗體／真正 list items／段落正確呈現，沒有重新解析 Grasp 求值結果。

Escape 關閉卡片且焦點框回原 record 按鈕；modal 開啟時 UIA 不暴露背景控制項。Shift+Tab 有操作，但 focused_element 只回原生 pane，不宣稱完整 Tab 巡覽通過。該次 App 正常關閉、視窗消失；不是九型別／關聯／凍結完整驗收。

歷史探針 `workspaces/S2-Review-1004/.grasp/measurements/ui-20261004-022936.json`：約 382.6 秒，foreground frame 36,000 samples、p95 4.3 ms／max 20.9 ms，達取樣上限；input 只有 2 samples、最大 8.2 ms。**不足以宣稱 UX／端到端門檻通過**，本段未重用為新的 Records 性能結果。

受控測試入口已改 try/catch 正常 unwinding，保留 stacktrace／exit 1，不改 Windows 錯誤設定。`TestEntry.Tests --fail` 驗 exit 1／finally；Content 50 assertions pass／exit 0。當次未新增匹配 WER／CLR 事件、沒有 WerFault process；不宣稱產品子程序任何崩潰都被攔截。
