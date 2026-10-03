---
title: GraspPortable — Environment and Implementation Planning State
version: 1.8.0
updated: 2026-10-03
scope: rewrite-decisions-and-current-authorization
---

## 目前成果與授權

`rewrite/dotnet` 的現行需求、方法、模型、技術、產品架構及圖解已形成文件基準。2026-10-03 本輪完成新版 Workspace／repository 確認、根目錄指示與 Windows 實作規劃。**新版程式尚未開始；本輪只授權環境與規劃文件，停在等待使用者審閱，不能自動接續 coding。**

先看 [Windows 實作規劃 rc.5](Engineering/Implementation-Plan-v1.0.0-rc.5.md)，第 8 節是第一個可操作 UI，第 10 節記錄已接受決策；[Binding Syntax Review](Engineering/Binding-Syntax-Review-v1.0.0-rc.3.md)集中保存 `@code{}` 與 raw literal 的剩餘語法提案。[環境紀錄](Engineering/Development-Environment.md)保存本機實況。使用者已明確接受多項產品決策及效能暫定門檻；仍未授權開始產品程式。

## 已接受且仍有效的基準

- 新版從零實作，沿用文件與有效 insight；舊程式作歷史參考。
- 2026-10-03 使用者確認：目標裝置至少包含 Windows PC；未來再嘗試擴充至 iPhone／iPad。Windows 是必要平台，Apple 裝置是後續探索方向，不是首版同步交付承諾。保留可攜核心及平台接面；沒有其他平台的實作／效能證據，最低 PC 硬體規格也尚未確認。
- 已選 C#／.NET 10、MAUI Blazor Hybrid／Razor、CodeMirror 6／TypeScript、獨立本機 ASP.NET Core Host、SQLite；見 [Technology Selection](Engineering/Decisions/Technology-Selection-v1.1.1.md)。Class Library 組織邏輯，Host 承擔可執行後端。
- 採[產品適配的 Explicit Architecture](Engineering/Decisions/Architecture-Model-v1.0.1.md)：功能模組、Ports／Adapters、明示公開契約依賴、單一共享提交與可恢復通知；[架構 rc.2](Engineering/GraspPortable-Architecture-v1.0.0-rc.2.md)及[圖解](Engineering/GraspPortable-Architecture-Diagrams-v1.0.0.md)保持基準。
- Excel 類型高互動依賴、真實資料 UI 流暢、未來成長餘裕三項要求均保留。「仍可操作」及寬鬆 regression gate 不代表達標。
- Seed 保存完整 WHAT／WHY，Engineering 分開保存整體方法、模型、stack、架構及實作計畫；進度／授權放本文件。
- UI／UX 試用用於校準需求和技術；實作完成、必要驗證通過與使用者接受分開記錄。
- 最新決策：identifier 為 `[A-Za-z_][A-Za-z0-9_]*` 的 ASCII segment，點號兩側無空白，大小寫敏感；只有定義左側加 @，取值不加，不用分號。同 workspace／namespace 同名 definition 唯一；即時連動、退出編輯立即更新、首輪多段落引用維持。
- Code fence parsing 使用 workspace 可設定清單；起始啟用未標語言及 grasp，停用 json／grasp-demo／其他未列語言。Disabled 區不建立或回寫 Grasp 資料。設定影響依賴資料，需版本核對及原子套用。
- Parser 要容易換 syntax：context／policy、syntax codec、binding AST、名稱解析與計算分層，不把 delimiter 寫進 graph 或 DB 語義。
- 已接受 block literal 分行 marker 的排版空白不屬 value；內容行空白仍保留。Literal 已選單層 {value} 起始，遇內容括弧 run 則增加 marker 層數；JSON 可自然分行隔開首尾，只有 inline 邊界黏合用局部 escape。撤回固定雙括弧與全面解碼反斜線提案。
- 先在目前 PC 方便試用，Portable 優先；正式安裝是否必要依實際 runtime／功能及效能證據判断，自由度與資料主權對標 Obsidian。性能候選已接受為暫定門檻，驗證成本須有界，不無限擴張。

## 本機初始化已完成的範圍

Workspace 維持 `C:\Users\ASUS\MyData\AgentWorkspace\All-of-Me\GraspProject\GraspPortableWorkspace`；repository 是其中 `GraspPortable/`。現有 origin 為 `https://github.com/000Sean000/GraspPortable.git`、branch 為 `rewrite/dotnet`，起始工作目錄乾淨；HEAD 與即時 `ls-remote` 均為 `0e08a4899647ee8d5f10b9cc21af9848eedcaba5`，因此沿用，無 clone／搬移／reset。

Workspace 及適用父層未有 AGENTS.md，已建立根目錄指示，記錄新版搜尋只指定 GraspPortable、根目錄設定定點讀取及 Legacy1 不作指示來源。**根目錄 AGENTS.md 在 repository 外，未受其 Git 追蹤。**

使用者已告知 Legacy1 完整保存舊 repo、未追蹤檔、驗收、暫存與舊環境文件；本輪未盤點或修改封存。先前關於 4,597 項 changes 的本機清理待辦已過時，由本輪明確範圍取代，不再要求先清理或建立封存索引。

本機已觀測 .NET SDK 10.0.401、MAUI Windows workload、Node／npm、WebView2，未安裝新套件。Windows SDK／Windows App SDK 的實際 build 相容性尚未驗證；S0 才建立產品 projects 並 restore／build。一般 sandbox 啟動錯誤與受審核指令替代結果見環境紀錄，不宣稱 sandbox 已修復。

## 規劃結果與覆蓋

Implementation Plan 對應現行架構的七個 projects，補齊模組 source／tests 預定入口、四維狀態、UI／Host／平台程序與部署、command/query、owner、draft／共享提交交易、解析與增量計算、取消、stale result、局部更新及重啟流程。

第一個完整成果 S1 為可操作 Windows UI：建立測試 workspace／Note，真實中文編輯，literal／composition、兩種 reference、definition／references 導航、共享修改／rename、相依更新、draft／commit 狀態與關閉後重新載入。S0 僅是此成果的內部啟動里程碑，不以空殼 UI 作第一階段交付。

後續 S2 真實資料及日常 UX、S3 export／fallback／restore、S4 records／完整 PC 流程、S5 跨裝置／程式接面，各自有完成判準。Seed 的完整目標未刪除，也不因寫入本計畫自動授權所有階段。

Seed rc.9 記錄使用者的新 literal 決策；方法 rc.9 與計畫 rc.5 同步 marker 疊層、JSON 原樣及 S1 操作例子。Syntax Review rc.3 以 `@code{ @Name = {value} }` 為基礎，保留只在定義左側加 @、取值裸名稱、無分號。單層起始、依內容 run 疊層與首尾局部 escape 已選；最長 opener、空值、inline 邊界 escape 優先序與 raw block 的補充仍待整體審閱，不重問已定方向。

## 歷史參考與證據限制

[Reference](Reference/README.md)的 Prototype 副本來源固定為 `5ca1373dca91e16d9e161de498bf8fcaebac1031`；[Originals](Reference/Originals/README.md)保存最早可查 rc.1 原文。歷史授權、HOW、next step 不作新版指示。

本輪僅定點讀取新版內的 binding／shared／reference-host 語義參考與現有 P0／M4 insight 摘要，沒有讀 Legacy1、私人 evidence 或舊程式。P0 Trial-1R 曾 complete-with-measured-failures，matched recovery passed；P0 整體仍 partial，未有完整三輪 baseline／最終 aggregate。本輪沒有重跑或重新認證它們。

## 本輪驗證與 Git

檢查範圍為 repository identity／起始狀態、遠端 SHA、本機工具觀測、文件版本／入口／相對連結及 diff whitespace。未建立程式、未執行產品 build／tests／GUI／benchmark；規劃不構成性能或恢復通過證據。

環境與首版規劃由本機 commit `43b0828` 保存；此次接手已有前輪平台澄清／計畫 rc.2 的未提交文件，完整保留並接續升版，branch 相對本機 upstream 顯示 ahead 1。本輪接續記錄 marker 疊層、JSON 分行與 raw value，保留 ASCII／@ 左側／無分號、parsing allowlist 及可替換 parser，只修改文件，不建立 parser／build／benchmark，不 stage／commit／push。建議 message：`docs: adopt layered literal markers and preserve raw content`。外層 AGENTS.md 仍不受本 repository 追蹤，本輪未修改。

額度來源為 Codex account usage tool；規劃前觀測 7 日窗口 usedPercent=8（未擷取精確時刻），2026-10-03 約 16:28 Asia/Taipei 收尾核對仍為 8，同一 reset Unix=1791604086。顯示差值為 0 個百分點，不代表本輪零用量；這是帳戶共享整數百分比，不是本任務計費。成果為環境／規劃文件，未建立 commit 關聯。

語法審查本輪另記：2026-10-03 約 17:36 Asia/Taipei 為 9%，17:50 為 10%，同一 7 日窗口 reset=1791604086；顯示增加 1 個百分點，仍為帳戶共享量，非此任務精確用量。成果是需求／方法／計畫升版及語法審查文件，未 commit。

本次 syntax／parsing-policy 修訂：2026-10-03 約 18:33 與 18:45 Asia/Taipei 的共享帳戶 7 日額度均為 11%，reset=1791604086。顯示差值 0 個百分點，不等於零用量，也不是本任務精確成本；成果為未提交文件修訂。

本次 marker 疊層修訂：2026-10-03 約 19:09 與 19:14 Asia/Taipei 的共享帳戶 7 日額度均為 12%，reset=1791604086；顯示差值 0 個百分點，不代表零用量。成果是未提交文件更新，無產品程式或 commit。

## Exact next step

審閱 Syntax Review rc.3 的 marker 疊層、空值及局部邊界優先序；單層起始、JSON 分行與 value 原文優先已由使用者選定，不再提交固定雙括弧／全面 backslash escape 選項。ASCII、點號無空白、@ 只在定義左側、無分號、code fence allowlist，以及 namespace／即時更新／多段引用／Portable／暫定效能不再重問。語法批准後再標記 Seed／Plan 的接受狀態；只有收到明確開始實作指示，才從 S0 工具鏈固定／Windows build 推進 S1。不得以這次回答規劃問題當作 coding 授權。
