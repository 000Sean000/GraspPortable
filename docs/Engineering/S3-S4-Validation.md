---
title: GraspPortable — S3 / S4 Validation
version: 1.3.0
updated: 2026-10-04
status: implemented-parts-awaiting-native-acceptance
---

## 判定

分組、Records engine／metadata／service、資料表 UI 與 Markdown table 轉換已接入產品，最新 App／Host 已完成本機 publish。下列有界工程測試有實際結果；最新 S3／S4 原生操作尚待驗證，不是阶段完成或使用者接受聲明。S1／S2 仍 PARTIAL，動態進度由 [EXECUTION-STATE](../EXECUTION-STATE.md) 維護。

## 工程證據

| 範圍 | 本段結果 | 主要契約 |
| --- | --- | --- |
| Grouped storage | 30 assertions | 一實體檔多 note IDs、精確正文、外部修改與來源註冊 |
| Grouping metadata | 10 fixtures | 未知 YAML／original ownership／unassigned 保存 |
| Grouping links | 11 fixtures | incoming／outgoing links、anchor 唯一性、不猜改寫 |
| Grouping service | 6 groups | merge／split、guards、部分寫入恢復、receipt、真導航與 backup |
| Records codec | 44 assertions | typed／null、長文 carrier、UTF-16 mapping、heading conversion |
| Records Knowledge | 13 groups | generated property、相依、ID、rename、nested external shared edit |
| Records workspace | 30 assertions | YAML metadata、raw 唯一來源、group move、無效 metadata 保留 |
| Records service | 45 assertions | 九型別、精確數字、option／relation IDs、views 同交易及 retry |
| Markdown table import | 6 groups | alias／code／escaped pipes、ragged rows 拒絕、原始 bytes 保留、同 parent、metadata／mapping、source guards、receipt 重試及 backup |
| Host HTTP | 57 assertions | 原有流程加真 HTTP collection／field／rename／view／grouped navigation |
| Content resolver | 50 assertions | 圖片來源邊界、wiki／相對 path、group member 定位 |

App Release（含 RecordsPanel、分組／轉換 dialogs）建置零警告／錯誤，Host／App 本機 publish 成功。後續 source 修正仍須核對發行版本，不沿用 build／publish 為 GUI 證據。

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

## 原生量測方式與待辦

卡片修正後重驗：最新四產品 Projects／全部 solution 測試專案編譯零警告／錯誤，Host／App publish 成功；重開 `S2-Review-1004`，既有 record 長文恢復，卡片粗體及真正 list items 正確 render，未重新解析 Grasp 求值结果。Escape 可關閉卡片，畫面焦點框返回原 record 按鈕；modal 開啟時 UIA 不再暴露背景控制項。Shift+Tab 已操作，但 UIA focused_element 只回報原生 pane，未據此宣稱全部 Tab 巡覽驗收。App 正常關閉且視窗消失，前台釋放。卡片圖片／link、九型別、關聯、凍結與排序仍待下一段原生驗證。

2026-10-04 手動 resume 後的原生 App 使用 `S2-Review-1004`：從「資料表」建立 `角色資料驗證`，切換 null 為文字，輸入兩段中文、空行、粗體標記及清單，保存後表格摘要與完整卡片可讀。實體 `角色資料驗證.md` 使用 H2/H3/H4 與明確 field markers，正文只保存一份；generated key 為 `Record1.Description`。發現完整卡片仍顯示 Markdown 標記，已委派改善 render／modal focus，待重新發行驗證。不能把這次 create／Markdown cell 流程當成九型別、關聯及凍結全部通過。

本輪正常關閉 App，前台釋放。探針 `workspaces/S2-Review-1004/.grasp/measurements/ui-20261004-022936.json` 時長約 382.6 秒，foreground frame 36,000 samples 的 p95 4.3 ms/max 20.9 ms，但達取樣上限；input 僅 2 samples（最大 8.2 ms），沒有足夠 30 次代表操作，**不足以宣稱 UX／端到端門檻通過**。下一次針對筆記切換／提交及表格互動取得所需樣本，不重跑後端效能。

受控測試入口已改為正常 try/catch unwinding：完整 stacktrace 與 exit 1 仍保留，不改產品或 Windows 錯誤設定。`TestEntry.Tests --fail` 驗 exit 1、finally 執行；Content 50 assertions 正常 pass/exit 0。該次未新增匹配的 WER／CLR 事件，沒有 WerFault process；並非宣稱產品子程序任何崩潰都會被攔截。

Launcher 可用 `-MeasurePerformance` 啟用本機有界探針，正常關閉寫入當時 workspace 的 `.grasp/measurements/ui-*.json`。只記錄時長與次數，不記錄正文／識別碼。最長十分鐘；foreground frame 排除最初五秒與失焦期間。兩次 rAF 代表下一次繪製機會的保守近似，不當作螢幕光子時間；長 frame 還需核對 App 或其他背景成本。

完整啟動指令見 [FirstUI Quickstart](FirstUI-Quickstart.md)。不傳 `-MeasurePerformance` 時不啟用探針；量測前先核對最新發行，再以限定資料做一次代表性互動。修正後只重測受影響流程，不為累積數字重跑全庫。

仍需原生 GUI 的完整資料表／關聯／凍結／排序編輯、合併／拆分及 table import、中文 IME／dirty 競態、Obsidian 交替、政策及縮放，並完成至少 30 次操作與約五分鐘連續互動。Backup UI generation 選取修正已納入最新發行，待原生重驗，詳見 [S2 Validation](S2-Validation.md)。

指定真實樣本只複製四份 Markdown 與四張直接引用的圖片到忽略的 `workspaces/S4-Sample-Source`，來源 hash 保存在該目錄的 sample manifest。未掃描全 vault 或 Legacy1，私人內容不進 Git。只讀解析統計已確認：Mentors 的 table index 0 為 15×8、index 1 為 15×3（40 個 `<br>`）；Aura index 0 為 81×5，均無 parser 診斷。這些是解析結果；實際建立 collection、長文與圖片、跨筆關聯、凍結／排序及 Triensa／Anria 卡片的 GUI 結果仍待記錄。UI 表格序號從 1 起算，分別為 Mentors 第 1／2 張與 Aura 第 1 張。

主代理補驗時應追加：發行 checkpoint／source 版本、實際 workspace、操作與資料規模、通過／失敗項目、探針輸出位置及 p95／停頓結果、DPI／IME 模式、已知限制與前台釋放狀態。尚未取得的欄位保留待驗，不以後端數字填入 GUI 欄位。
