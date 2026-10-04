---
title: GraspPortable — S3 / S4 Validation
version: 1.5.0
updated: 2026-10-04
status: implemented-parts-with-partial-native-evidence
---

## 判定

分組、Records engine／metadata／service、資料表 UI 與 Markdown table 轉換已接入產品，最新 App／Host 已完成本機 publish。下列有界工程測試及 15×8 import／view／凍結／排序編輯已有實際結果；完整原生驗收仍未完成，不是阶段完成或使用者接受聲明。S1／S2 仍 PARTIAL，動態進度由 [EXECUTION-STATE](../EXECUTION-STATE.md) 維護。

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
