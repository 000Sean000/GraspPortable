---
title: GraspPortable — S1 Validation
version: 1.5.0
updated: 2026-10-04
status: native-gui-partially-verified
---

## 判定

Windows 試用版已完成 Release 發行，並於 2026-10-03／04 透過原生 Computer Use 實際操作及修正。**S1 未宣告全部驗收通過。** Reading 排版、delimiter 協助、基本原生中文 IME 及 allowlist 預覽／套用已有本次證據；IME／dirty 競態、DPI 及量化端到端仍未完整驗收。使用者接受另記。

## 2026-10-04 衝突草稿暫存與正常退出

修正合併視窗「稍後處理」只關對話框、退出又再次要求合併的問題。現在先保存右側新增標題／正文，沿用原版本基底；只有確認合併才接受外部版本。未知操作、組字及尚未得到 durable acknowledgement 的新編輯仍不可直接離開。

DraftDeparture guard 67 assertions、App Release build／publish 通過；guard 測試不替代 Home UI。主代理另以實際 Windows App 完成右側加字→保留→正常關閉→重開恢復→明確保存仍提示衝突→再次保留退出。唯讀核對外部 revision 77、草稿 base 76／revision 2 和文字均保留，未接受改名未發布。

本段嘗試按鍵未進入中文組字，未取得新的 IME 競態證據；保留先前基本注音流程的有限證據，不把 ASCII 輸入、貼上或 dirty conflict 當作組字驗收。收工時 App／Host 均正常退出，依使用者要求暫停。

## 2026-10-04 解析清單原生流程

獨立 `workspaces/S4-Policy-1004` 僅一篇合成 Markdown，含 grasp、grasp-demo、json 及未標語言四個完整 fence。預設 Windows UI 僅列 Policy.Active 與 Policy.Unlabelled。設定清單新增 grasp-demo 後，先按「預覽影響」，確認按鈕才可用；確認套用至 revision 2，UI 新增 Policy.Demo，json 仍未建立定義，診斷零。未操作日用 vault 或主驗收 workspace 的 parsing policy。

正常關閉後唯讀 SQLite 核對 policyRevision=1、languages=[空字串, grasp, grasp-demo]，定義恰為上述三筆；證據在忽略的 `workspaces/AcceptanceSupport/policy-missing-verification.json`。這證明基本 allowlist 預覽／套用及停用 fence，不取代政策衝突／過期版本的工程測試。IME／dirty 競態、縮放及足量端到端效能仍未完成。

## 2026-10-04 未接受草稿的引用呈現

沒有匹配 Host metadata 的 reference 原先可能被普通 Markdown link 或 GFM URL 呈現並觸發錯誤導航。現以共用 opaque carrier 呈現遮罩保留原文與「尚未取得匹配的 Grasp 解析結果」提示，不解值、不給身分／導航、不在 cache 建立語意。保留 code context，inline code／HTML tag 可作 carrier 內文字，正常 Wiki／有 metadata 的 reference 維持既有呈現。

真 CodeMirror／Reading 回歸含 7 個 raw cases：兩式、多段 CRLF／Unicode、裸 URL、escaped link、inline code／HTML，另驗 code fence／inline code 排除及點擊無導航。TypeScript build、editor suite 通過；獨立 review 指出的 HTML 漏遮已修。既有 physical bracket composition fixture 曾一次時序失敗、後續重跑通過；原生 IME／dirty 競態仍列待驗，不將重跑視為完整排除。

App 15:18:21 發行後，原生恢復原 rename draft（accepted Resolution.Pending／draft Resolution.Deferred），Live Preview 與 Reading 都露出完整 reference 原文，點擊停留原筆記。已接受資料表的完整欄位仍隱 syntax／highlight，Tab→Enter 正確開來源並選中 LiveLinks.Short 第 15 行。未更動此草稿；正常關閉後與前次還原基底 JSON 完全相同。這是有界引用呈現驗收，不代表 S1 所有狀態完成。

## 2026-10-04 Reading、補完與基本原生 IME

本段由主代理透過 sky 操作真實 Windows MAUI App，在既有 FirstUI 建立「S1 補完與 IME 1004」；沒有以貼上中文字或 API 代替組字驗證。

- Reading 的 `@code` 區域保持換行、縮排與多段空行，不再由普通 Markdown 折疊定義排版。區域資料沿用 Core 提供的 authoritative ranges，不在 UI 另造完整 parser。
- 中文注音 s／u／3 形成「你」，Enter 提交，Esc 可取消尚未完成的組字。中文 IME 組字期間刻意不做 delimiter pairing。
- Ctrl+Space 切到英文後，以實體鍵驗證 `{}` 自動補對、`{{}}` marker 兩端同步；一次 Ctrl+Z 同時撤回兩端變更。輸入 `pair-pass` 時游標仍在 literal 內。
- 完整語法提交後診斷清除。正常關閉再開啟，確認「你」與 `pair-pass` 持久保存；Host 隨 App 正常關閉。
- 測試完成已釋放前台。

工程複測：Core 162 fixtures 通過，新增 authoritative region 的 UTF-16／宿主停用區排除；Host HTTP 34 assertions、架構檢查、Host／App Release publish 成功；真 CodeMirror 回歸通過，包含未閉合前綴的實體鍵事件。沒有宣稱本段重新驗完所有 SQLite 故障或量化性能。

這是基本原生 IME 與有界完整編輯流程；IME／dirty patch 競態、快速切換完整時序、解析 allowlist GUI、代表性 DPI 及量化端到端仍列待驗。

## 2026-10-03 原生 UI 複測與修正

使用既有 FirstUI 測試 workspace，新建「UI 驗證 1003」及「UI 範例與導航」，未更動原始 Vault。正常啟動／關閉／重開實際 MAUI App，使用真實視窗的點擊、鍵盤、文字輸入與截圖，沒有用 API 操作冒充 GUI。

已操作確認：

- 新建筆記、中文文字輸入／貼上、Ctrl+Z、原文／即時預覽／閱讀切換。
- 單值與真正多段落引用、空行、兩層 composition；共享修改「梨子」為「香蕉」後直接引用及相依結果更新，關閉重開仍保留。
- json fence 的 UiDisabled 未建立定義；未測本次 allowlist 政策變更。
- 跨筆記 reference 跳至定義，引用清單保留兩個位置；原文 UiFruit 改名 UiProduce 確認後，本篇 operand／reference 與另一篇 reference 更新。GUI 沒有直接顯示 canonical ID，ID 保留沿用既有整合測試證據。
- 來源留下未完成 literal 草稿後，從另一篇進行共享修改會導回完整來源草稿；補完後可提交。此情境驗證切換恢復，未涵蓋未完成草稿下整個 App 重啟。
- 重開目前工作區自動載入第一篇；不同工作區及搜尋中切換仍待專項 GUI 複測。

本次修正：範例名稱自動避開 workspace／草稿既有 identifier；新筆記自動聚焦與 Enter 提交；定義導航重取引用清單；共享修改導向 owner 草稿、其他受影響草稿提供入口；一般輸入只失效受修改 reference，不再清空整篇 Live Preview；提交／切換清除過期筆記提示；新筆記載入重設 editor 捲動；提高常用工具列、側欄與保存狀態字級及對比。

修正後原生 GUI 已複測範例建立（Fruit2／Description2／Slogan2）、Enter、自動聚焦、引用導航、草稿導向及普通輸入時保留多段引用。Editor 的真 CodeMirror 有界回歸新增 CRLF／emoji range mapping、前後編輯保留、內部修改失效、模式切換與原子 committed patch；npm build／test 通過。App win-x64 Release publish 通過。Core／Host／SQLite 未變更，不重跑無關完整測試。

當時發現 Reading 以普通 Markdown 折疊 @code 定義排版；此項已在 2026-10-04 以 Core authoritative region 修正並原生複測。Live Preview 仍為基本段落支援；未完成的競態、DPI、量化效能與解析設定 GUI 以本文最新待驗清單為準。

## 已完成的必要工程檢查

| 檢查 | 實測 |
| --- | --- |
| Core fixture runner | 2026-10-04：162 fixtures 通過；含原 literal／reference／graph 案例及新 authoritative binding region 的 UTF-16／host exclusion |
| SQLite integration runner | 2026-10-03：63 assertions 通過，本段未重測；含改名保留 ID、兩層串接、兩式多段引用、rollback、草稿／receipt 重開、stale／dirty protection、policy、未知 schema 拒絕與資源超限保留草稿 |
| Host HTTP/process runner | 2026-10-04 再次通過 34 assertions；覆蓋 handshake、401／403、HTTP 提交、SSE 重連、等冪、shutdown／restart、credential 輪替 |
| Host Release build／publish | 2026-10-04 Release publish 成功；沿用 SQLite 3.0.5 bundle，lock file 記錄 SQLite 3.53.4 |
| App native build／publish | 2026-10-04 win-x64 Release publish 成功；unpackaged、WindowsAppSDKSelfContained=true、使用本機 .NET runtime |
| Editor regression | 2026-10-04 真 CodeMirror 回歸通過，含未閉合前綴的實體鍵事件與先前範圍／過期更新案例；headless composition guard 與上節原生 IME 證據分開 |
| 實際程序／GUI | 2026-10-03／04 已有上節真實 GUI；最新正常關閉／重開驗證文字保存及 Host 關閉。初次程序存活觀測不作 GUI 證據 |
| 架構邊界 | 2026-10-04 再次通過四產品 project references 及 Core 不依賴外層 adapters 的輕量檢查 |
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

初次交付時 node_repl 曾因 `windows sandbox failed: helper_unknown_error: setup refresh had errors` 阻止 GUI 檢查。2026-10-03 使用者將兩份無法讀取的舊 cua_node runtime 移到 runtime-backup 後，預設 shell、Node REPL、Computer Use 初始化及原生操作恢復；未變更 sandbox 模式或 ACL。視窗擷取需先選定及啟用實際 App，並在最大化動畫結束後重新觀測；不能把過渡畫面或遮擋當作產品缺陷。

## 尚待驗證

- 真實 Windows UI：IME／dirty patch 競態、快速編輯／切換完整時序、allowlist 設定操作、125%／150% 縮放、視窗縮窄及長時間操作。基本注音組字／提交／取消與 Reading 多段空行已驗，不擴稱所有輸入法及組字時序通過。
- 端到端 input-visible／commit-visible、捲動及 warm／cold note 切換門檻。
- 使用者按 [First UI 操作說明](FirstUI-Quickstart.md) 體驗並接受結果。
- 清潔電腦 Portable、正式日用資料、完整 Markdown 複雜宿主與跨裝置均屬後期，沒有宣稱本輪通過。
