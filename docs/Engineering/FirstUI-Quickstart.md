---
title: GraspPortable — First UI Trial
version: 1.2.0
updated: 2026-10-04
status: s1-s2-trial-partially-verified
---

## 啟動與資料位置

本頁描述目前 Windows 試用版：S2 Markdown workspace 與實際檔案樹已接入，尚非完整 S2／S4 交付。目標與進度見 [EXECUTION-STATE](../EXECUTION-STATE.md)，本段操作證據及未驗範圍見 [S2 Validation](S2-Validation.md)。

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

本段已實測 shell 外部修改，**尚未實測 Obsidian GUI 交替編輯、完整衝突 UI、附件呈現或 link 導航**。複製相對路徑／在檔案總管顯示已有接面，仍須原生操作驗證。最新 link codec 及 tree 自動選取修正未包含在本段 GUI 使用的發行；重新發布後需另驗。

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

必要結果與尚未驗證項目見 [S1 驗證紀錄](S1-Validation.md) 與 [S2 驗證紀錄](S2-Validation.md)。基本原生 IME 是較早 S1 結果，本段 S2 未重測；IME／dirty 競態、allowlist GUI、DPI 與量化端到端尚未完整通過，S1／S2 仍為部分驗證。產品程式、工程驗證、Windows 使用者體驗接受分開記錄。GUI 工具不能啟動時，不能用 API、DOM 或 build 結果冒充中文 IME、桌面操作及流暢度已通過。

本次試用尚未完整交付 Vault 匯入、複雜 list／blockquote 等 Markdown 的完整 Live Preview、分組／還原、Records、共享語意 undo、专用 composition 編輯器、同步及 mobile。Markdown 共同編輯正在 S2 驗證，分組／恢復及 Records 沿同一 Goal 的 S3–S4 繼續；S3 backup primitive 的工程通過不代表 UI／排程或還原流程完成。

## 開發接續

以 [Implementation Plan](Implementation-Plan-v1.0.0-rc.8.md) 為階段邊界。parser／ValueEngine 在 Core；交易與 ID 規則在 Core/Knowledge；SQLite、API 與通知在 Host；CodeMirror／Razor 與 Host client 在 App；wire types 在 Contracts。

工程測試依責任分成小型 console runners，使用 `dotnet run --project tests/<project> -c Release`；它們會以失敗 exit code 結束，不依賴測試平台服務。依當次風險選 Core／SQLite／Host、Markdown／Coordinator、檔案操作／恢復等相關 runner，不要求每次全量重跑。Editor 使用其 package.json 內的 typecheck／fixture 指令。
