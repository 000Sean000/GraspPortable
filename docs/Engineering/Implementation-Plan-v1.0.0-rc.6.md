---
title: GraspPortable — Windows S1 Implementation Plan
version: 1.0.0-rc.6
updated: 2026-10-03
status: accepted-authorized-for-s0-through-s1
scope: first-complete-windows-ui-and-bounded-verification
supersedes: Implementation-Plan-v1.0.0-rc.5.md
---

## 目標、授權與停止位置

2026-10-03 使用者明確要求實作已接受計畫。先完成 **S1：目前 Windows PC 可操作的完整筆記流程**，再停下讓使用者體驗與調整需求。S0 是內部啟動里程碑；S1a 是早期寫作體驗，不以空殼或部分 UI 代替完整 S1。實際進度、證據及未完成項由 [EXECUTION-STATE](../EXECUTION-STATE.md)單一維護。

[Seed rc.10](../Project_Seed/GraspPortable-Core-Requirements-v1.0.0-rc.10.md)維護 WHAT／WHY；[Method rc.10](GraspPortable-Core-Development-Method-v1.0.0-rc.10.md)維護工程與協作方法；[Guide rc.8](graspportable-architecture-planning-guide-v1.0.0-rc.8.md)維護目錄／模組原則；[Architecture rc.3](GraspPortable-Architecture-v1.0.0-rc.3.md)與[圖解 v1.1.0](GraspPortable-Architecture-Diagrams-v1.1.0.md)維護架構。[Syntax Review rc.4](Binding-Syntax-Review-v1.0.0-rc.4.md)記錄使用者已整體接受的 rc.3 profile 與 reference／context 明確化。

S1 包含真實中文編輯、建立／尋找筆記、literal／composition、兩種 reference、多段引用、相依更新、定義／引用導航、共享 literal 修改、原文 rename、Source／Reading／一般段落 Live Preview、草稿保存／提交／重載，以及可設定的 code fence parsing 清單。

延後專用 rename UI、共享語意 undo、composition 專用編輯器、複雜 Markdown 完整 Live Preview、日用資料整庫匯入、完整 export／fallback／restore、Records、同步、iPhone／iPad、Programming 及乾淨電腦完整 Portable 發行驗證。一般 Ctrl+Z 保留。這些延後項仍是完整產品方向，不先建立空模組。

## 1. Solution、Projects 與目錄原則

產品 projects 收斂為四個；保留 Explicit Architecture 的 owner、Ports／Adapters、依賴方向與共享交易。目錄按功能責任劃分，Project 是實際編譯／部署邊界，不是把概念分層每層各建一個專案。

| 路徑 | 責任 | 產品 project 依賴 |
| --- | --- | --- |
| `src/GraspPortable.App/` | MAUI Blazor Hybrid／Razor、畫面狀態、CodeMirror／TypeScript、backend client、平台與 Host 生命週期 | Contracts |
| `src/GraspPortable.Host/` | ASP.NET Core executable、HTTP／SSE、DI、背景排程、SQLite／filesystem adapters | Core、Contracts |
| `src/GraspPortable.Core/` | use cases、domain rules、owner ports、syntax／graph／evaluation | 無 |
| `src/GraspPortable.Contracts/` | 按 owner／use case 分區的 wire commands、queries、results、notifications | 無 |

Core／Contracts 不反向引用其他產品 projects。Host 映射 wire DTO 到 Core 型別；Core 的 `Public` 接面不等同 wire Contracts。App 不直接開 DB，不引用 Core。Class Library 組織邏輯，Host 承擔可執行後端。

採淺層功能目錄：App 的 Authoring／Editing 將 Razor、css、ViewModel、Editor TypeScript／Interop 鄰近放置，另有 References、Workspace、Shell、Backend、Platforms、wwwroot。Core 的 Authoring／Drafts、Knowledge、ValueEngine、Query、Workspace 各自管理公開接面、model、use case 與必要 ports；ValueEngine 再按 Syntax／Dependencies／Evaluation 分工。Host 的 owner endpoint／adapter 鄰近放置，共用 SQLite mechanism、Jobs、Notifications、Composition 才集中。

只建立用到的目錄，不強制 Contexts／Features／UserInterface 包裝、不預建 mobile partitions、不作 interface-per-class。同 assembly 的模組邊界以明示 Public 與少量依賴檢查保護；未來實際出現獨立重用、build／test 摩擦時再拆 Project。

Core 內方向為 Knowledge → ValueEngine.Public、Query → Knowledge.Public；未來 Exchange → Knowledge.Public。ValueEngine 僅計算輸入快照，不反向讀 Knowledge 私有狀態。Workspace 生命週期由 Host 組裝，避免循環。

使用 .NET 10；本機 SDK 10.0.401 為 S0 起點，Windows App target 起始為 `net10.0-windows10.0.19041.0`，可攜 projects 為 `net10.0`。實際 restore 相容後固定 SDK／NuGet／npm versions 與 locks；workload manifest 不當作所有套件版本。最低 PC／Windows 支援範圍依實測，不從 TFM 推定。

## 2. 程序、部署與資料所有權

App 啟動同批次 Host binary，Host 鎖定 workspace、開啟 SQLite、恢復草稿／receipts／衍生索引，ready 後接受寫入。使用 OS 配置的 loopback port，受控子程序 pipe 交換啟動 credential、endpoint、protocol／workspace／Host instance。Credential 不放 URL、一般 log 或 editor JavaScript；.NET HTTP client 管理認證。

HTTP JSON 承載 command／query；SSE 經 `IRevisionFeed` 傳遞 revision／受影響 IDs。通知不是 node-per-event，重連有缺口就補讀當前 snapshot。Razor 在 App 的 .NET 執行；後端不負責逐次按鍵 rendering。

初版一個 App session／workspace／Host writer，可開多筆記。另一個 session 開相同 workspace 顯示占用；revision guard 仍保留。關閉先 flush 草稿並追蹤已接受提交 receipt，再 drain Host。結果未明保留 operation ID 供查證，不把 UI 取消視為 DB rollback。

先採本機 unpackaged 發行目錄與單一啟動入口，使用者選擇 workspace，binary 與資料分開。S0 驗證實際 runtime；S1 不以正式安裝為前提，也不宣稱乾淨電腦免依賴。後期才確認 .NET／Windows App SDK／WebView2 隨包方式、移機與目標 filesystem。iPhone／iPad 未來探索，不假設可沿用 Windows 子程序。

| Owner | 資料／責任 | 主要接面 |
| --- | --- | --- |
| Workspace | ID、schema、解析政策／設定版本、開啟鎖 | Open／Close／Settings／RecoveryStatus |
| Authoring | UI transient state；核心 durable draft、session、base revision | SaveDraft／ReadDraft、editor session／patch |
| Knowledge | committed Notes、canonical IDs／名稱索引、binding parts、edges、occurrences、resolved caches／provenance、revision／receipts | CommitNote／ChangeLiteral／ReadReceipt、原文 rename 準備及提交 |
| ValueEngine | parse／impact／evaluation、可重建 graph／cache | versioned snapshot → results／diagnostics |
| Query | 最小標題搜尋、definition／references、版本化讀取投影 | ReadNote／ReadDefinition／FindReferences |

Query adapter 使用 Knowledge 公開且可版本化的 read schema，不任意讀私有表。IDs 與名稱、檔案位置、source range 分離；名稱採 ordinal case-sensitive workspace＋namespace 唯一，無 Note-local 重複。Source range 為 raw UTF-16 `[from,to)` 並綁 revision。

### 最小接面與交易

- `SaveDraft(noteId, sessionId, draftRevision, baseNoteRevision, source/delta)` 只承諾 durable draft；不提升 knowledge revision。
- `CommitNote(operationId, noteId, expectedKnowledgeRevision, expectedNoteRevision, draftRevision, sourceHash)` 使用同版 draft 準備並提交。
- `ChangeLiteral` 攜帶 target ID、預期 owner revision、內容及影響確認；只修改唯一 literal definition。Composition 導向來源，不 flatten。Owner 有 dirty draft 時轉入該草稿，不覆蓋它。
- 原文 rename 核心在 S1：可靠 edit mapping 延續 canonical ID，更新真 dependency／reference tokens，不改普通 prose、literal 或停用區。高影響變更顯示影響確認；名稱衝突或 correspondence 不唯一時保留 draft／舊 committed state，回報診斷。
- Queries 回傳 snapshot／source revision、cache status；revision feed 可補讀。`ReadReceipt` 回覆 pending／committed／rejected／unknown；同 operation 同 payload 重試等冪，不同 payload 拒絕。

Prepare 在寫交易外使用版本化 snapshot；單 writer 進入短 transaction 再核對版本。一次原子保存原文、身分、binding parts、edges、所有受影響 results／持久 occurrence caches／必要 patches、diagnostics、revision、receipt 及可恢復工作標記。過期 plan 拒絕；只對仍有效明確意圖重準備，不重送過期 source 覆蓋新資料。

若先回 durable accepted／pending，須先保存 operation intent、payload hash 與 guards；僅記憶體排隊不能宣稱已接受。SQLite 起始為本機 NTFS、WAL、`synchronous=FULL`。Syntax incomplete 只存 draft；完整 missing／cycle 可保存帶診斷 state，last-good value 有 provenance，不能偽裝最新成功。DB／I/O failure rollback。

## 3. 編輯、計算與畫面更新

1. CodeMirror 本地 transaction 立即更新文字、selection、IME、local undo，不等 HTTP／Razor。保留 EOL／UTF-16 mapping。
2. 合併 delta 保存草稿，起始約 250 ms；普通有效編輯短合併後提交，約 400 ms 只是預算而非必等時間。退出編輯／切 Note／Reading／Ctrl+S 立即 flush 最新版，IME 正常結束後送最終 snapshot。
3. Context／policy、syntax codec、syntax-independent AST、名稱解析、graph／evaluation 分層。Host 是語意權威；editor 不另造不同語法。Literal／reference value 是 opaque，disabled fence 不建立或回寫資料。
4. 背景最多兩個 CPU prepare workers／workspace；更新正反向 graph，包含移除邊、missing 重現、SCC cycle、傳遞失效。Graph 邊可去重，ordered operands 不可去重。取消／revision 分段檢查。
5. Commit 序列化，原子保存後發 revision／IDs；UI 只查必要變更並對 clean editor 作局部 patch，保留 selection／history。Dirty／IME 相交或 base 不明時保留草稿並提示比較；舊 query／preview 不覆蓋新資料。
6. ViewModel 經 `IEditingBackend`／`IEditorSession` 協調；HTTP 在 Backend adapter。Blazor dispatcher 套用畫面狀態，dispose 清理訂閱與無用 query；durable operation 由 session 層持續追蹤。
7. 開 DB 後恢復 committed snapshot／衍生索引，另載保存的 draft 並標示；不靠同程序記憶體冒充重啟。

UI 分開顯示未存草稿、草稿已存、處理中、已提交、衝突／錯誤。超過 200 ms 的計算顯示 pending，UI 仍能輸入。高頻 selection 留 JS，不逐字傳全篇／重建 EditorState；render 與通知按可見及受影響範圍合併。

Source 提供完整原文；Reading 顯示完整 value；基本 Live Preview 在一般段落非編輯區呈現，active 區保留可編輯原文。複雜 table／heading／nested Markdown 本階段不做完整互動，但原文無損，不静默截斷或誤寫。

## 4. 分期、可體驗成果與完成判準

【可體驗】表示使用者可直接操作；【工程驗證】表示必要底層判準。每階段分開記實作、驗證、使用者接受。

| 階段 | 成果 | 判準 |
| --- | --- | --- |
| S0：啟動主幹 | 工具鏈固定、四 Projects、App／Host／SQLite | 【工程驗證】restore／build、握手、workspace 鎖、DB 建立／重開、正常關閉及可见錯誤 |
| S1a：真實編輯與保存 | 清單／標題搜尋、建立／切換筆記、Source、草稿 | 【可體驗】中文、貼上、Ctrl+Z、切換及重開；【工程驗證】已確認保存文字恢復，舊回應不覆蓋新草稿 |
| S1b：完整 Grasp 流程 | 定義／composition／兩式多段 reference、相依、導航、共享 literal、原文 rename、三種視圖、解析設定 | 【可體驗】下列完整腳本；【工程驗證】身分、版本、交易與解析政策一致 |
| S1c：可靠性與流暢度收尾 | 單一啟動、本機驗收 workspace、操作說明、實測與限制 | 【可體驗】啟動到連動、重開；【工程驗證】必要故障案例及本階段效能門檻 |

### 使用者操作腳本

1. 啟動、建立測試 workspace 及三篇筆記。左側清單／搜尋，中間 editor／Reading，右側可收合的 definition／references／diagnostics。
2. 建立 literal、多段落值及至少兩層 composition，例如 `@code{ @Fruit = {apple} @Slogan = {An } + Fruit @Greeting = Slogan + {!} }`；delimiter pairing 可撤銷，中文／paste／undo 不破壞內容。
3. 其他筆記插入 `[apple](:ref:Fruit)`、`[[@Fruit|apple]]` 及多段 value；前後正文、空行完整。
4. 修改來源，觀察相依／引用更新；退出編輯不繼續等 debounce。快速输入和切換不被舊回應覆蓋。
5. 切 Source／Reading／Live Preview；active 區原文可編輯，其他一般段落可讀完整結果。
6. 引用跳定義及 references；共享 literal 修改先看影響再確認；composition 導向來源，不提供 flatten 或專用 parts editor。
7. 從原文 rename，確認 ID 不變、相依與引用 token 更新；同名／不唯一對應保留草稿，沒有半套修改。
8. `json`／`grasp-demo` 展示 syntax 不建立資料；未標語言／`grasp` 依 allowlist 啟用。UI 修改清單先顯示影響再原子套用，重開仍相同。
9. 留未完成語法，關閉整個 App／Host 並重開；草稿恢復，committed ID／值／cache 一致，舊 committed 值沒有被標成最新成功。

後期路線：S2 真實資料／日常 UX／R-M-G 成長驗證；S3 export／fallback／restore；S4 Records／完整 PC；S5 mobile／continuity／Programming 各自確認。完成 S1 後停止，不自動接續。

## 5. 有界測試與暫定效能

不設 coverage quota，不做完整語法組合／平台矩陣或 benchmark 平台。新增 fixtures 只保護本次契約、發現的 regression 與具體資料風險。

- Codec／evaluation：已選 grammar、boundary escape、真實混合 EOL、UTF-16 ranges、disabled contexts、round-trip；串接、重複 operand、傳遞／diamond、missing／cycle。
- SQLite 整合：原子 rollback、stale guard、同 operation 重試、commit 成功但回應遺失的 receipt／重開、invalid draft recovery、rename 成功與衝突、policy 原子套用。
- Windows 實際 UI：中文 IME、paste／undo、多段 reference、快速輸入／切換、dirty／IME patch 保護、Source／Reading／Live、代表性 125%／150% 縮放。API／headless 不冒充 Windows GUI 成功；工具不足明記未驗證。

F 功能資料為 3–10 Notes、約 20 bindings、100 occurrences。至少 30 次代表性小改與約五分鐘連續操作；另用固定短值測 deep chain 1,000 與 fan-out 10,000 各一次，避免指數文字膨脹。30 個樣本只作首輪工程訊號，不是統計認證。

使用者另授權唯讀取用 Workspace `TestData/MainVault-Source` 的 Obsidian Vault。只按具體測試缺口挑少量檔案複製到 repository 忽略的測試 workspace；原始資料不改、不 commit，不因此展開 S2 整庫匯入或無界量測。Legacy1 不在授權搜尋範圍。

| 指標 | 已接受暫定門檻 |
| --- | --- |
| input-visible | p95 ≤ 50 ms，無 App 造成的 ≥ 200 ms UI 停頓 |
| 捲動 | rAF frame interval p95 ≤ 33 ms；僅輔助 proxy |
| 暖筆記／查詢切換 | p95 ≤ 200 ms；cold open ≤ 1 秒 |
| ≤100 affected nodes／1,000 occurrences 小改 | 完整編輯至 committed visible p95 ≤ 800 ms，退出編輯繞過合併等待；另記 commit-to-visible |
| chain 1,000／fan-out 10,000 | 明確提交至 committed ≤ 2 秒；>200 ms 有 pending |

本機觀測基準為 i9-13980HX、約 32 GB、Windows x64／NTFS。S2 才加使用者真實 R、M（10,000 Notes／100 MiB source、50,000 bindings、200,000 edges／occurrences）、G（R／M 較大值 3 倍），以及 M≤2GB／G≤4GB 候選記憶體門檻。S1 只觀察持續增長，不宣稱已證明日用資料／最低硬體／完整成長餘裕。

每組先一次必要驗證，修正後僅重跑受影響項目；新失敗／契約改變／具體未解風險才擴大。資料一致性失敗不得完成；UX／效能未達可交早期試用但標示失敗，不降門檻冒稱通過。不重跑 P0，僅沿用整體 prepare／transport／render 成本可能大於 graph 的 insight。

## 6. 協作、全局檢視及交付

每個工作段開始，主代理不論 medium 或 high effort 都主動評估可分派的獨立實作／有界審查。通常主代理＋1–2 subagents，目前同時上限四個；不強拆小工作。主代理保有範圍、契約、資料 owner／交易、整合與最後驗收。

固定契約後可平行 parser／fixtures、App editor／ViewModel、Host／Knowledge persistence。交棒包含目的、指定檔案、契約、排除範圍、驗收／回報；共用 Contracts／DI／migration 單一 owner，cross-boundary 先協調。模型／effort 預設沿用，不自動降級或改用 Reserve。完成回報由主代理查 diff、整合並走必要端到端；不重複全量測試。

每里程碑及連續兩輪修正無改善／驗證成本接近產品改動時，短記四項：下一個可體驗流程缺口、被推翻的假設、當前主要風險、繼續／簡化／調整／延後理由。普通 HOW 自主處理；產品語意、主要技術／部署及重大成本才請使用者裁決。

交付提供實際絕對啟動路徑、驗收 workspace、操作步驟、build／必要測試／GUI／性能的分開結果與已知限制。保留 source、必要 tests、短架構／debug map；生成資料、私人資料與大量 evidence 不進 Git。未授權 commit／push，本輪保留可審閱變更並提供建議 message。

動態進度以 EXECUTION-STATE 為準；本文件是已接受的完成標準，不代表功能或測試已完成。
