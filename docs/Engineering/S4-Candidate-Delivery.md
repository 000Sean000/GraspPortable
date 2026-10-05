---
title: GraspPortable — Windows S4 Candidate Delivery
version: 1.0.0
updated: 2026-10-05
status: candidate-ready-user-acceptance-pending
scope: p0-s4-local-windows-delivery
---

## 交付與停止位置

目前Windows PC的P0–S4候選版已完成實作、必要有界工程與原生驗證。產品source checkpoint為 `959cda2561220dfc9d41cceb685c2ebe35112910`；11:24:10 Host／11:24:19 App發行，後續僅補驗與文件。最終文件checkpoint由Git HEAD及EXECUTION-STATE核對，不能用未commit檔案代替推送成功。

使用者接受尚待實際體驗。完成最終commit／push及遠端核對後停止；不自行展開同步、mobile、rollup、通用公式或新的UX工作段。候選版通過不是所有Notion／Obsidian能力或所有資料規模均等的宣稱。

## 啟動與驗收資料

Workspace維持 `C:\Users\ASUS\MyData\AgentWorkspace\All-of-Me\GraspProject\GraspPortableWorkspace`；repository位於其下 `GraspPortable`。目前PC不需要正式安裝GraspPortable，可直接執行：

```powershell
& 'C:\Users\ASUS\MyData\AgentWorkspace\All-of-Me\GraspProject\GraspPortableWorkspace\GraspPortable\Start-GraspPortable.ps1' -Workspace 'C:\Users\ASUS\MyData\AgentWorkspace\All-of-Me\GraspProject\GraspPortableWorkspace\GraspPortable\workspaces\S4-Acceptance-1004'
```

App完整路徑：`C:\Users\ASUS\MyData\AgentWorkspace\All-of-Me\GraspProject\GraspPortableWorkspace\GraspPortable\artifacts\FirstUI\App\GraspPortable.App.exe`。獨立Host在同級 `artifacts\FirstUI\Host\GraspPortable.Host.dll`；使用launcher以設定正確Host／workspace。已配置 .NET10／WebView2，未驗乾淨電腦移機Portable。

| Repository內本機路徑 | 用途／保留狀態 |
| --- | --- |
| `workspaces/S4-Acceptance-1004` | 主試用資料：15位Mentors、81列Aura、Triensa／Anria長文、型別與參照案例；revision88、三份既有durable drafts保留 |
| `workspaces/S4-FinalFlows-1005` | 純合成三篇、20bindings／100references；已合併、Obsidian修改、拆分；revision13、零draft，Base為gamma |
| `workspaces/S4-Draft-Restored-1004-1447` | 含較新durable draft的完整還原副本；與來源的session／revision／base／正文曾逐項核對 |
| `workspaces/S4-Restored-1004-1329` | 先前分組後完整版本還原；Records、連結與圖片保留 |
| `workspaces/AcceptanceSupport` | 私人測試ledger、基底與核對資料；不是產品日用筆記 |

上述完整路徑皆由repository實際根路徑接續；全部在Git忽略區，沒有上傳私人vault／資料庫／圖片。原TestData／Legacy1未修改。本次發布不移除既有草稿或恢復日誌。主試用資料刻意保留衝突案例；若初始筆記要求處理衝突，可選「保留草稿，稍後處理」再切換，這不會接受或覆寫外部版本。

## 使用者可體驗項目

1. **筆記及參照**：在檔案樹搜尋「連結驗收」或「連續互動驗收」，切Source／即時預覽／閱讀。非編輯區Wiki及两式Grasp參照隱語法、高亮、單擊／Enter導航；Grasp到來源definition block。輸入、貼上、撤銷、保存、關閉重開；一般Ctrl+Z是本地editor history。
2. **角色與資料表**：左下「資料表」選Mentors的「角色職責」view或「角色篩選驗收」view，開Triensa／Anria完整卡片；橫捲、排序、隱欄及凍結設定。點連結直接導航，點cell的↗編輯長文；返回資料表仍指向原collection。
3. **型別與關聯**：選型別驗收表，體驗Markdown、數字、布林、日期、單選、多選、tag、單／多record關聯；欄位標題可改display name／key，關聯依ID保存。跨表標籤入口按名稱搜尋並開原record。
4. **Aura／大於一頁**：選Aura，確認81筆、第二頁從Aura51起；搜尋、排序、換view不把修改套到錯列。
5. **實際檔案操作**：右鍵新增筆記／資料夾、改名／移動、複製路徑、Explorer定位；合併／拆分及舊Markdown table轉換先看預覽，再確認。合併後可用檔案內筆記下拉選成員。
6. **共同編輯**：用Obsidian管理器「Open folder as vault」明確選上述獨立測試workspace。外部改定義／引用值／欄位後回Grasp核對；dirty／組字遇外部修改會保留兩版。避免直接用尚未註冊的檔案URI，Obsidian可能選到既有祖先vault。
7. **恢復**：「備份與還原」可看最近完整時間、尚待備份狀態、立即建立及還原到新資料夾。預設有變更每五分鐘／正常關閉補做、保留三份。不要刪DB、journal或草稿來繞過衝突。

更完整操作、語法與狀態說明見 [FirstUI Quickstart](FirstUI-Quickstart.md)。

## 必要驗證對照

| 階段 | 實作及必要驗證結果 | 證據 |
| --- | --- | --- |
| P0／S0 | 四Projects、工具鏈、程序／workspace handshake、Markdown權威、routing三責任與可恢復checkpoint | [計畫](Implementation-Plan-v1.0.0-rc.11.md)、[環境](Development-Environment.md)、[AgentOps](../AgentOps/Model-Routing/README.md) |
| S1 | 真編輯／IME、兩層composition／兩式多段ref、共享修改／rename、三模式、delimiter／allowlist、草稿及重開；必要版本／交易tests通過 | [S1 Validation](S1-Validation.md) |
| S2 | watcher／reconciliation、Markdown／SQLite／receipt／journal、Obsidian交替、dirty／IME保護、檔案樹／改名移動／copy／reveal；bounded故障tests | [S2 Validation](S2-Validation.md)、[最新GUI](S3-S4-Validation.md) |
| S3 | 三篇merge→Obsidian修改→split；3IDs／20definition IDs不變、100refs及新值保留；自動／手動backup、較新draft完整restore、失敗保留前版tests | [S3／S4 Validation](S3-S4-Validation.md) |
| S4a/b/c | 九型別、長文唯一來源、generated property／missing／cycle、單多關聯、rename、外部往返、15×8／81×5轉換、views／凍結／排序編輯／焦點 | [S3／S4 Validation](S3-S4-Validation.md) |

工程結果沿對應source受影響範圍重測，未為交付重跑無關全部suite。最後probe／真CodeMirror兩套測試、TypeScript、架構及App／Host Release publish通過；此前DraftDeparture109 assertions、Records UI33 fixtures、Records JS18tests、BackupManager10groups等結果按原驗證紀錄保留，不混算成涵蓋率。

## 本機效能與觀測界線

目前PC為i9-13980HX／約32GB／Windows x64，原生主要150%／1348×894，另有125%／窄1064px有界焦點證據。30次具體功能操作完成；最後另做378.6秒單一前台輸入與逐步閱讀觀察，沒有穿插build／文件／sleep。Computer Use操作有工具等待，不等同人類不停鍵入或高速事件壓力測試。

| 指標 | 最新有界結果 | 暫定門檻 |
| --- | --- | --- |
| input→paint opportunity | 代表操作n6/p95 7.8ms；後段n1/8.6ms；合成段n1/2.8ms，分組不混算 | ≤50ms |
| 捲動rAF interval | 代表段n161/p95 12.4ms；最後段n400/p95 4.3ms | ≤33ms |
| 暖機筆記切換 | 最新n1/28.9ms；代表段22.2ms | ≤200ms |
| 暖機Records切換／query | n6/p95-max198.6／193.7ms | ≤200ms |
| 首次note／Records | 最新note n2/max45.5ms；首次Aura214.4ms | ≤1秒 |
| 完整edit→可見committed結果 | n5/p95-max617.7ms；最後n4/p95-max664.2ms | ≤800ms |
| 深鏈1000／扇出10000固定小值 | 真Markdown完整提交242.4／832.0ms，各一次 | ≤2秒 |
| 前景UI停頓 | 最後n93972 frames/max29.2ms；代表段max41.8ms，無≥200ms | 無App造成≥200ms停頓 |

完整編輯鏈包含180＋250ms debounce、draft、跨檔寫入／查回及DOM有效版本雙rAF；commit-only另記，不相加冒充端到端。Records等待children render ready。rAF是paint opportunity，不是螢幕光子時間；每項不是30個樣本，亦非統計認證。真實樣本、三篇20bindings／100refs及兩個固定值graph案例支援當前候選版判斷，不宣稱任意日用vault、最低硬體或完整成長餘裕。

## 已知限制與保存材料

- 先交目前Windows PC；未做乾淨電腦完整Portable發行，沒有iPhone／iPad、同步、rollup、任意程式執行、通用公式或完整Notion功能。
- Live Preview以一般段落為主；組字期間不強制補delimiter。原文／computed／未接受draft明確分開；尚未接受reference保留syntax及提示。
- 保守拒絕歧義wiki／anchor、case-only改名、無法可靠定位／不支援的相對HTML改寫；保留原文而非猜測。失效typed value保留診斷。長文有H1／深heading先預覽轉換；沒有一鍵反向還原UI。
- 表格每頁50筆。Mentors第二張15×3只做解析統計，未再轉換；目前有限樣本缺少的短名Wiki會顯示找不到，並不自動匯入目標。
- 多檔提交使用journal逐檔恢復，不是跨檔ACID；DB含durable drafts／版本基底，不可當純快取刪除。restore建立新workspace。
- 所有使用者接受仍待體驗；未知軟體缺陷不以本輪通過保證不存在。遇到問題可提供workspace／筆記與操作，保留恢復材料。

Repository外：Workspace `AGENTS.md`、`GoalSupport/`（舊額度monitor及state／events，完成後停用）、`RoutingUpdate-v2.0.0-Review/`與原zip保留，不受產品Git追蹤。`Export-GraspPortable-SubagentReview.ps1`在repository內但原本未追蹤，未執行／修改／提交。無監測或額度重置後自動續跑承諾。
