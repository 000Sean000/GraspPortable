---
title: GraspPortable — First UI Trial
version: 1.0.0
updated: 2026-10-03
status: executable-trial-gui-verification-pending
---

## 啟動與資料位置

從 repository 根目錄執行 `Start-GraspPortable.cmd`，或使用 `Start-GraspPortable.ps1`。預設開啟 `workspaces/FirstUI`，資料在其中的 `workspace.grasp.db`；App 與獨立 Host 的發行檔位於 `artifacts/FirstUI/App`、`artifacts/FirstUI/Host`。以上資料、依賴與建置產物不進 Git。

本機實際入口為 `C:\Users\ASUS\MyData\AgentWorkspace\All-of-Me\GraspProject\GraspPortableWorkspace\GraspPortable\Start-GraspPortable.cmd`；測試資料為同一 repository 的 `workspaces\FirstUI`。2026-10-03 已由 launcher 啟動，觀測到標題為「GraspPortable · Windows 試用版」的原生視窗、WebView2 與其獨立 Host；此程序檢查不代表 GUI 操作已驗收。

這個版本使用目前電腦已有的 .NET 10 與 WebView2。Windows App SDK 隨 App 發行目錄攜帶，未要求正式安裝本產品；不宣稱可移到未配置的電腦直接執行。第一次從新 checkout 使用時需要已確認的 .NET／MAUI、Node 工具鏈，launcher 會呼叫建置腳本。

重新建置：

```powershell
./scripts/Build-FirstUI.ps1
```

`-SkipTests` 僅用於同一 source 已完成必要驗證後重新封裝。指定另一個獨立工作區可用 `./Start-GraspPortable.ps1 -Workspace 'C:\path\to\test-workspace'`，也可從 App 左上角開啟／建立資料夾。不要選日用 Obsidian Vault 作 Grasp workspace。

## 可體驗流程

預先建立三篇操作筆記：01 定義與組合、02 多段落引用、03 語法展示與操作，共 20 個 bindings、100 個引用位置。另有三篇使用者指定 Vault 的少量 Markdown 樣本；來源只讀，內容只存於忽略的測試 DB。`sample-manifest.json` 保存本機來源與雜湊，不納入 repository。

1. 打開「01 定義與組合」，將 Fruit 的「蘋果」改成「梨子」。切到「02 多段落引用」，檢查兩式引用、Slogan 和 Message 的連動。
2. 修改 Description 的兩段文字及空行，確認引用保留真正段落；切換原文／即時預覽／閱讀。編輯中的引用區域顯示原文。
3. 點引用查看定義；從右側前往定義或引用位置。共享 literal 修改先顯示影響再確認；composition 請到來源修改。
4. 在原文將 `@Fruit =` 改為 `@Produce =`，确认影響後，檢查 composition 與引用名稱同步改變。定義 canonical ID 應保留，普通文字與停用 fence 不改。
5. 在「03 語法展示與操作」的 grasp-demo／json fence 放語法，確認沒有建立 Example。解析設定可預覽並修改啟用語言，設定隨 workspace 保存。
6. 在來源留下未閉合語法，等狀態顯示草稿已保存；切換或關閉後重開，檢查未完成文字可恢復，先前共享值仍有清楚狀態。
7. 試中文輸入法、貼上、Ctrl+Z、快速輸入後切換筆記，以及關閉重開。發現問題時記錄操作、所見狀態與涉及的測試筆記；勿用日用資料測試恢復行為。

共享來源有 dirty draft 時，先回到來源核對；畫面上的合併確認不會自行覆蓋較新提交。一般 Ctrl+Z 是 editor history，不是跨筆記的共享語意 undo。

## 驗證界線

本輪必要結果與尚未驗證項目見 [S1 驗證紀錄](S1-Validation.md)。產品程式、工程驗證、Windows 使用者體驗接受分開記錄。GUI 工具不能啟動時，不能用 API、DOM 或 build 結果冒充中文 IME、桌面操作及流暢度已通過。

S1 不含完整 Vault 匯入、複雜 list／blockquote 等 Markdown 的完整 Live Preview、完整匯出／還原、共享語意 undo、專用 composition／rename 編輯器、同步及 mobile。這些未從產品需求刪除，等待本版體驗後再安排。

## 開發接續

以 [Implementation Plan](Implementation-Plan-v1.0.0-rc.6.md) 為階段邊界。parser／ValueEngine 在 Core；交易與 ID 規則在 Core/Knowledge；SQLite、API 與通知在 Host；CodeMirror／Razor 與 Host client 在 App；wire types 在 Contracts。

測試入口是三個小型 console runners（Core、Integration、Host），使用 `dotnet run --project tests/<project> -c Release`；它們會以失敗 exit code 結束，不依賴測試平台服務。Editor 使用其 package.json 內的 typecheck／fixture 指令。測試只針對當次變更風險擴增。
