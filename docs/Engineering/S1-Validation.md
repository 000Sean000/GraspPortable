---
title: GraspPortable — S1 Validation
version: 1.0.0
updated: 2026-10-03
status: engineering-checks-passed-gui-verification-pending
---

## 判定

Windows 試用版已完成 Release 發行並以 launcher 啟動。**S1 未宣告全部驗收通過。** Windows GUI、中文 IME 與端到端流暢度仍須實際操作；它們不由後端測試代替。使用者接受尚未進行。

## 已完成的必要工程檢查

| 檢查 | 實測 |
| --- | --- |
| Core fixture runner | 最終 161 assertions 通過；含 literal／reference codec、UTF-16 ranges、fence policy、取消、非遞迴 SCC、展開資源限制與未受影響值重用 |
| SQLite integration runner | 63 assertions 通過；含改名保留 ID、兩層串接、兩式多段引用、rollback、草稿／receipt 重開、stale／dirty protection、policy、未知 schema 拒絕與資源超限保留草稿 |
| Host HTTP/process runner | 34 assertions 通過；實際 Host 啟動兩次，驗 handshake、401／403、HTTP 編輯提交、SSE 重連、等冪、shutdown／restart、credential 輪替 |
| Host Release build／publish | 成功，0 warnings／errors；SQLite native dependency 已改用 3.0.5 bundle，lock file 記錄 SQLite 3.53.4 |
| App native build／publish | 最終 win-x64 Release 成功，0 warnings／errors；unpackaged、WindowsAppSDKSelfContained=true、使用本機 .NET runtime |
| Editor regression | 1 組有界 headless Edge／真 CodeMirror 測試通過；包含 EOL／UTF-16 delta、stale patch、transition lock、多段引用／導航、synthetic composition guard、HTML 不執行；不是原生 IME 測試 |
| 實際程序啟動 | Launcher 啟動 App；觀測到原生視窗標題、Responding=true、WebView2 與 child Host。未進行 GUI 操作或視覺驗證 |
| 架構邊界 | 四產品 project references 及 Core 不依賴外層 adapters 的輕量檢查通過 |
| 文件 | 現行入口、檔名／frontmatter 版本、79 個本機 links 與 diff whitespace 已檢查；Grasp :ref 語法示例不當作檔案連結 |

獨立 subagent 審查發現並修正兩項資料保護缺口：展開超限不得消耗草稿，以及拒絕未知 SQLite schema 前不得先寫 DDL。App 已修正「await 儲存期間新輸入／較舊 refresh／rename 確認基底／草稿 revert」：離開 editor 前凍結並取得最終 snapshot、使用 revision/context guard 與固定請求基底、序列化 JS patch、合併時重存 draft base。工程回歸涵蓋 editor 端保護；這些完整 C#／JS／Windows 時序仍列入實際 GUI 待驗。

## 有界性能數據

本機 Windows x64／NTFS、i9-13980HX、約 32 GB RAM，Release，獨立生成的測試 DB；測量沒有包含 Razor／WebView 呈現。

| 資料與路徑 | 觀測 |
| --- | --- |
| 30 次代表性 literal 修改：prepare＋SQLite commit | 最後一次增量失效接入後 p95 0.77 ms |
| 深鏈 1,000：prepare＋SQLite commit | 32.02 ms |
| 扇出 10,000：prepare＋SQLite commit | 210.48 ms |

這些數字僅覆蓋小型功能資料與兩個固定小值的相依形狀；不能推論一般 PC、完整日用 Vault、輸入可見延遲或大型記憶體成長。S1 的 50 ms input-visible、33 ms frame interval、切換延遲與約五分鐘真實連續操作仍未驗證，不改寫門檻。

ValueEngine 依變更的 ordered parts／名稱及反向相依找出受影響閉包，重用未受影響的有效結果。首版仍重建 graph/SCC 中繼結構並檢查全體資源預算；未聲稱大型 workspace 的所有成本均已增量化。單值上限為 4,000,000 UTF-16 units、总展開預算 32,000,000，超限保留草稿並拒絕該次共享提交，不截斷為成功值。

## 真實樣本與工具限制

按使用者明確授權，只取指定 Vault 的三篇 Markdown 筆記（總計 9,268 bytes），複製內容至獨立 FirstUI 的 SQLite 筆記。操作前後 SHA256 相同；未遞迴盤點整庫、未修改来源、未讀 Legacy1、私人內容未進 Git。功能測試另有 20 bindings／100 occurrences，並未以舊產品測試資料代替新版驗證。

Computer Use skill 已讀取並初始化；node_repl 兩次（含 reset）在 import runtime 前後即因 `windows sandbox failed: helper_unknown_error: setup refresh had errors` 結束。未修改 sandbox、安全設定或繞行私有 helper。這阻止了本輪的實際 Windows GUI／IME 檢查，非產品本身已觀測的 GUI 故障。

## 尚待驗證

- 真實 Windows UI：中文 IME、快速編輯／切換、125%／150% 縮放、視窗縮窄、多段落視覺與長時間操作。
- 端到端 input-visible／commit-visible、捲動及 warm／cold note 切換門檻。
- 使用者按 [First UI 操作說明](FirstUI-Quickstart.md) 體驗並接受結果。
- 清潔電腦 Portable、正式日用資料、完整 Markdown 複雜宿主與跨裝置均屬後期，沒有宣稱本輪通過。
