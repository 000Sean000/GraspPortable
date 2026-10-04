---
title: GraspPortable — First UI Trial
version: 1.3.1
updated: 2026-10-04
status: s1-s4-trial-awaiting-native-acceptance
---

## 啟動與資料位置

本頁描述最新本機 Windows 發行：Markdown workspace、檔案樹、備份／還原、實體檔案合併／拆分、長文資料表及 Markdown table 轉換已接入。最新 S3／S4 流程尚未完成原生驗收；下方新功能步驟是操作入口，不是已驗證成功的聲明。進度見 [EXECUTION-STATE](../EXECUTION-STATE.md)，證據見 [S2 Validation](S2-Validation.md) 與 [S3／S4 Validation](S3-S4-Validation.md)。

目前已操作的 S2 驗收 workspace 完整啟動指令：

```powershell
& 'C:\Users\ASUS\MyData\AgentWorkspace\All-of-Me\GraspProject\GraspPortableWorkspace\GraspPortable\Start-GraspPortable.ps1' -Workspace 'C:\Users\ASUS\MyData\AgentWorkspace\All-of-Me\GraspProject\GraspPortableWorkspace\GraspPortable\workspaces\S2-Review-1004'
```

App／獨立 Host 發行檔仍在 repository 的 `artifacts/FirstUI/App`、`artifacts/FirstUI/Host`。Markdown 檔案是已保存原文，workspace 的 `workspace.grasp.db` 保存索引、版本基底及 durable drafts，`.grasp` 保存內部 journal／恢復材料；不要把資料庫及日誌當作可任意刪除的快取。這些試用資料、依賴與建置產物不進 Git。

`Start-GraspPortable.cmd`／未傳 `-Workspace` 的 PowerShell 入口預設仍開啟 `workspaces/FirstUI`。若它是 schema 1 舊 DB-only workspace，Host 會安全複製到新的相鄰資料夾進行遷移並保留原環境；以畫面顯示的實際 workspace 為準。本段 S2 證據來自上述 `S2-Review-1004`，不混用舊 FirstUI 驗收結果。

這個版本使用目前電腦已有的 .NET 10 與 WebView2。Windows App SDK 隨 App 發行目錄攜帶，未要求正式安裝本產品；不宣稱可移到未配置的電腦直接執行。第一次從新 checkout 使用時需要已確認的 .NET／MAUI、Node 工具鏈。Launcher 只在發行檔不存在或傳入 `-Build` 時呼叫建置腳本，不會每次自動更新至最新 source。

重新建置：

```powershell
./scripts/Build-FirstUI.ps1
```

`-SkipTests` 僅用於同一 source 已完成必要驗證後重新封裝。指定另一個獨立工作區可用 `./Start-GraspPortable.ps1 -Workspace 'C:\path\to\test-workspace'`，也可從 App 左上角開啟／建立資料夾。現階段使用獨立試用 workspace；需要真實樣本時從已授權的 `TestData/MainVault-Source` 副本按測試需求選取，不用日用原始 Vault 驗證恢復行為。

## S2 檔案流程

1. 啟動上述 workspace，展開實際資料夾樹；搜尋「重新命名」可找到 `Notes/重新命名驗證.md`。
2. 開啟該筆記，確認中文內容、`TreeCheck` 定義及值「外部修改」。這是本段原生 GUI 保存／改名／搬移／外部更新／重開後的驗收資料。
3. 在自選測試資料夾按右鍵新增資料夾或筆記；編輯並等待保存後，再由右鍵改名或搬移，核對預覽與目標路徑。相同操作不應改變 note／definition 身分。
4. 未在 Grasp 編輯的測試筆記，可用另一個 editor 修改其 Markdown 正文並保存，再回到 Grasp 查看更新。尚未完成的語法應保留原文及來源診斷，不能當成最新成功計算結果。存在 dirty draft／衝突時先保留兩側內容並依提示處理。

較早 S2 checkpoint 已實測 shell 外部修改；後續另有圖片／wiki 導航與 incoming link 改名的有限原生證據。**Obsidian GUI 交替、完整衝突 UI 與完整附件／導航流程仍未驗收。** 最新 link codec、tree 自動選取及下方 S3／S4 入口已包含於本機發行，尚待補齊原生操作。

## 資料表與長文卡片

1. 點左下角「資料表」，按「＋ 資料表」或「建立資料表」。輸入顯示名稱及 ASCII record key，建立後選取該資料表。
2. 用「＋ 紀錄」「＋ 欄位」增加內容。欄位標題按鈕可設定顯示名稱、key 及型別；支援 Markdown、數字、布林、日期、單選、多選、tag、單筆與多筆關聯。顯示名稱可用中文，key 區分大小寫。
3. 點 cell 展開完整內容；點紀錄名稱開啟長文卡片。Markdown 可含多段落及 Grasp 引用；其他型別透過專用輸入或選項控制修改。Null 與空字串／0／false 分開操作；診斷或草稿提示應先處理，不把舊成功值當作最新結果。
4. 新增另一筆紀錄，建立單筆／多筆關聯並檢查目標。用搜尋、視圖設定、欄位順序／顯示、篩選與排序檢查內容。標題列與紀錄名稱欄固定，可另凍結前幾筆及前幾欄；每頁最多 50 筆。排序後再編輯，確認仍修改原來的 record ID。
5. 以「開啟原文 ↗」檢查 H2 資料表、H3 紀錄、H4 欄位及唯一 Markdown 值；正常關閉重開，核對內容、typed 值、關聯與視圖設定。

## 右鍵合併／拆分檔案

1. 在檔案樹對筆記按右鍵，選「與其他筆記合併檔案…」，再勾選至少兩個實體檔案。確認新的 `.md` 相對路徑及 `.json` 保留位置；目的父資料夾需先存在。
2. 按「預覽影響」，核對成員、來源／目的路徑、連結改寫及未分配內容；只有可安全套用時按「確認套用」。合併後是一個實體檔案承載多個原 note IDs，保留成員正文與定義身分。
3. 對合併檔右鍵選「拆分檔案中的筆記…」，核對每篇的獨立新路徑，再預覽並套用。未分配正文／共用 YAML 會另外保存為 `.json`；原始 bytes 仍留在恢復日誌。
4. 檢查 incoming／outgoing links 與 member／heading 導航，再關閉重開。受影響來源有 dirty draft、路徑或版本變動、anchor 無法唯一定位時會阻止套用；不要透過刪日誌繞過。

## 從舊 Markdown table 建立資料表

1. 對已觀測的單篇 `.md` 筆記按右鍵，選「從 Markdown 表格建立資料表…」。群組檔首輪需先拆分。
2. 選來源中的表格序號（畫面從 **1** 起算），填新資料表名稱與 record key prefix，按「預覽轉換」。最多先顯示五筆樣本；可調整欄位 key／顯示名稱，修改後重新預覽。
3. 核對列數、欄數及轉換警示：表格外框空白會修剪、空 cell 是空字串；程式碼外 `<br>` 會轉成真正換行；欄位內標題移到 H5／H6，過深時轉巢狀清單。Wiki alias、code span 與 escaped pipe 保留其 Markdown 內容；不規則 table 明確拒絕。
4. 按「建立新資料表」。新筆記放在來源的同一資料夾，**原筆記完整保留**。欄位起始均為 Markdown，之後可用欄位設定調整型別；wiki link 不會自動變成 Records 關聯或匯入其目標。
5. 在左下「資料表」中選新 collection，核對長文、空行、圖片相對路徑與數量。相同 prefix／field key 與既有定義或既有引用衝突時需調整 prefix，再預覽。完整原文 snapshot、欄位 mapping 及標題轉換對照保存在 `.grasp/record-import/previews`，隨完整備份保存。

指定私人樣本的解析統計：Mentors 第 1 張 15×8、第 2 張 15×3（40 個 `<br>`）；Aura 第 1 張 81×5。實際轉換／GUI 尚未驗收，不需把整個 vault 匯入才能檢查這些案例。

## 備份與還原

左下「備份與還原」可立即建立完整版本、修改 interval／retention，或選 generation 還原到新的工作區資料夾。預設有變更每五分鐘與正常關閉前建立、保留三份；沒有變更不重複 capture。還原不覆蓋現有資料夾，並保留 Markdown、較新 draft、metadata 與 journal。最新 generation 選單修正已發行，仍待原生重驗；請核對實際選取版本與還原目的地。

## 選用原生效能量測

平常啟動不開量測。需要這輪有界驗證時，明確加 `-MeasurePerformance`；以下使用既有獨立 S2 試用 workspace，不代表該 workspace 已通過 S4 驗收：

```powershell
& 'C:\Users\ASUS\MyData\AgentWorkspace\All-of-Me\GraspProject\GraspPortableWorkspace\GraspPortable\Start-GraspPortable.ps1' -Workspace 'C:\Users\ASUS\MyData\AgentWorkspace\All-of-Me\GraspProject\GraspPortableWorkspace\GraspPortable\workspaces\S2-Review-1004' -MeasurePerformance
```

核對最新發行後，做至少 30 次代表性操作與約五分鐘連續互動，再正常關閉。報告位於當時 workspace 的 `.grasp/measurements/ui-*.json`，上述例子的完整資料夾為 `C:\Users\ASUS\MyData\AgentWorkspace\All-of-Me\GraspProject\GraspPortableWorkspace\GraspPortable\workspaces\S2-Review-1004\.grasp\measurements`。探針最多十分鐘，只記時長／次數，不保存正文或識別碼；意外結束可能沒有完整報告。

報告還需結合實際 IME、操作流程與前台狀態判讀；rAF 不是螢幕實際呈現時間。來源層 30 次提交 p95 334.1 ms、深鏈 242.4 ms、扇出 832.0 ms 是另外的工程結果，不能代填 UI 門檻。詳見 [S3／S4 Validation](S3-S4-Validation.md)。

## 原 FirstUI 範例流程

原 `workspaces/FirstUI` 預先建立三篇操作筆記：01 定義與組合、02 多段落引用、03 語法展示與操作，共 20 個 bindings、100 個引用位置。另有三篇使用者指定 Vault 的少量 Markdown 樣本，最初存於忽略的測試 DB；`sample-manifest.json` 保存本機來源與雜湊，不納入 repository。以下是這組範例的操作方式；若經遷移，使用新的遷移副本，並以目前保存／來源狀態為準。

1. 打開「01 定義與組合」，將 Fruit 的「蘋果」改成「梨子」。切到「02 多段落引用」，檢查兩式引用、Slogan 和 Message 的連動。
2. 修改 Description 的兩段文字及空行，確認引用保留真正段落；切換原文／即時預覽／閱讀。編輯中的引用區域顯示原文。
3. 點引用查看定義；從右側前往定義或引用位置。共享 literal 修改先顯示影響再確認；composition 請到來源修改。
4. 在原文將 `@Fruit =` 改為 `@Produce =`，确认影響後，檢查 composition 與引用名稱同步改變。定義 canonical ID 應保留，普通文字與停用 fence 不改。
5. 在「03 語法展示與操作」的 grasp-demo／json fence 放語法，確認沒有建立 Example。解析設定可預覽並修改啟用語言，設定隨 workspace 保存。
6. 在來源留下未閉合語法，等狀態顯示草稿已保存；切換或關閉後重開，檢查未完成文字可恢復，先前共享值仍有清楚狀態。
7. 試中文輸入法、貼上、Ctrl+Z、快速輸入後切換筆記，以及關閉重開。發現問題時記錄操作、所見狀態與涉及的測試筆記；勿用日用資料測試恢復行為。

另有「S1 補完與 IME 1004」可查看較早 S1 checkpoint 保存的中文字及 `pair-pass`。Reading 保留 `@code` 定義的換行／縮排／空行；Source 在英文輸入模式可體驗 `{}` 補對、marker 兩端同步及一次撤銷。中文組字期間不介入符號補完，先完成或取消組字後再輸入語法。

共享來源有 dirty draft 時，先回到來源核對；畫面上的合併確認不會自行覆蓋較新提交。一般 Ctrl+Z 是 editor history，不是跨筆記的共享語意 undo。

## 驗證界線

必要結果與尚未驗證項目見 [S1 驗證紀錄](S1-Validation.md)、[S2 驗證紀錄](S2-Validation.md) 與 [S3／S4 驗證紀錄](S3-S4-Validation.md)。基本原生 IME 是較早 S1 結果；IME／dirty 競態、allowlist GUI、DPI 與量化端到端尚未完整通過，S1／S2 仍為部分驗證。產品程式、工程驗證、Windows 使用者體驗接受分開記錄。GUI 工具不能啟動時，不能用 API、DOM 或 build 結果冒充中文 IME、桌面操作及流暢度已通過。

分組／還原、Records 及 table import 已實作並發行到本機，原生流程待驗；不能由 primitive 通過推定整個 UI 完成。完整 Vault 批次匯入、複雜 Markdown 的完整 Live Preview、共享語意 undo、專用 composition 編輯器、同步及 mobile 不在這個試用版本的完成聲明內。

## 開發接續

以 [Implementation Plan](Implementation-Plan-v1.0.0-rc.9.md) 為階段邊界。parser／ValueEngine 在 Core；交易與 ID 規則在 Core/Knowledge；SQLite、API 與通知在 Host；CodeMirror／Razor 與 Host client 在 App；wire types 在 Contracts。

工程測試依責任分成小型 console runners，使用 `dotnet run --project tests/<project> -c Release`；它們會以失敗 exit code 結束，不依賴測試平台服務。依當次風險選 Core／SQLite／Host、Markdown／Coordinator、檔案操作／恢復等相關 runner，不要求每次全量重跑。Editor 使用其 package.json 內的 typecheck／fixture 指令。
