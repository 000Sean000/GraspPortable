# Current Working State — GraspPortable

更新：2026-09-28。本輪是 **v0.3 UI 操作修復 Goal**，不是重新實作 M1–M4。目標為恢復主要流程，讓 Human 重新驗收；不宣告 Human 驗收通過。

## 現行授權與來源

使用者已授權自主診斷、coding、tests、build、封裝／驗收入口更新、coherent checkpoint commit/push。普通 bug 不設人工 gate；只有改變已接受語義、資料权限或重大流程才提問。修改測試只在完整 Acceptance workspace 的 Scratch 獨立副本；MainVault-Source 與原始 MainVault 唯讀、私人資料不入 Git。

依序承接 [Seed](Project_Seed/README.md) 指定 Requirements rc.3／Development Method rc.3、[Goal Plan](GOAL-PLAN.md)、[Binding contract](BINDING-EDITING-CONTRACT.md)、[Shared contract](SHARED-VALUE-CONTRACT.md)、[Projection contract](PROJECTION-CONTRACT.md)。舊 candidate／pending 政策不升格為已接受需求。現行實作接面見 [Implementation](IMPLEMENTATION-CONTRACT.md)／[Architecture](../ARCHITECTURE.md)。

已接受且本輪不改：DB runtime authority；自由放置 binding／raw literal／串接；兩種 managed reference；语意结构優先於隱藏連結；共享交易＋獨立共享撤銷；未完成草稿保存而不冒充 committed values；missing/cycle 可保存並標錯；單一 readable projection；外部 Markdown 必須 Review／Import；完整 fallback 保留語意與重建資料。

## 起點與本輪實作

Git preflight 20:14 UTC 工作樹乾淨、fetch 成功，HEAD=origin/master=8e3d3f0c4270303b74d4b531bd6b31e233e61473；20:33及21:05 UTC fetch 仍0/0，保留本機變更。既有一鍵入口指向0.3.0 package、43861、Acceptance/MainVault-Grasp-v0.3/.grasp/workspace.grasp.db；GET /host 確認 build 5f008760-bd1b-4906-90cc-86a52177616d，與套件一致。開始 listener PID25248，43821無host；目前仍保留舊host，沒有對原Acceptance做測試寫入。

已實作：Files／Projection GET 不占全域 mutation queue，關閉時取消 view-owned 讀取；一般 GET 30秒 timeout、files/projection狀態檢查5分鐘（先等checkpoint）；背景檔案定位＋進度＋5分鐘等待上限（不宣稱 server checkpoint 取消）；workspace 切換後拒絕舊定位結果；native dialog 內呈現錯誤、保留表單；Files checkpoint 不阻擋全域導航。策略晚回應有 workspace/revision guard，但原先猜測「策略使 snapshot revision 過期」已被 store 實作排除，不能當已證實根因。

完整根因／失敗樣本／驗證界線見 [UI repair evidence](UI-REPAIR-VERIFICATION.md)。最終0.3.1 build=bcab7a56-8871-45b9-bd04-4430de960c4f。定位改以可讀內容 fingerprint 判斷並發變化，settings／draft-only 更新不再誤報dirty；真正內容變動仍fail closed。另修復啟動DB失敗後建立新workspace，分組按鈕未重新啟用。

## 實際證據與待完成

- 最終 production build 通過，42 files／540 unit + integration tests 通過，7.07s；全部44 production Edge E2E通過，1.2m。
- 原0.3.0四項故障 held-network browser tests全紅；0.3.1六項 focused browser tests全綠，5.1s。
- 完整44 E2E：首輪43pass／1fixture斷言錯誤，已修；第二輪43pass／1真實定位競爭失敗（1.5m），已保留失敗證據。新增3個確定性host regression，涵蓋發布期間metadata-only更新、dirty掃描期間metadata-only更新、真正內容更新；最終整合全綠。
- 完整Corpus browser已通過啟動1.334s、search47ms、三模式797ms、References210ms、shared edit+nested+undo3.308s；5min檔案狀態與定位／draft尚待最終B階段驗證。中間腳本超時／未處理listener拒絕未當成產品成功。Scratch clone使用SQLite online backup、quick_check=ok、2,821 notes；36,676其他files／6,778,948,363bytes逐檔source-before／target／source-after hash一致，7空目錄保留。這是隔離測試副本，不把在線DB＋tree分別複製當成新的離線備份保證。
- 本段為已通過build／完整回歸的核心修復checkpoint，提交主旨 `fix: keep UI responsive during file and projection operations`。diagnose-ui.mjs仍在獨立全量驗證中，留待下個checkpoint。尚未打包0.3.1、尚未切換Human入口；整個修復Goal尚未完成。

**精確下一步**：核心修復checkpoint commit／push並核對origin/master；ui_route_audit以UI_DIAG_PHASE=files-draft完成全量檔案／定位／草稿驗證（每step落盤），保留早先A流程證據。打包0.3.1並package smoke。核對舊host與保存狀態，避免兩個host開同一DB；停止已辨識舊host，逐檔hash核對完整離線備份後沿用同一Acceptance資料及一鍵入口，確認實際build／path。更新交付文件、最後commit／push，回報Human重驗。

## 本機 locator

SandboxRoot為 C:/Users/ASUS/MyData/AgentWorkspace/All-of-Me/GraspProject/GraspPortableWorkspace；repo為其下GraspPortable。舊cwd .../GraspProject/GraspPortable 已移走，所有命令指定實際workdir。

| 位置（相對SandboxRoot） | 用途 |
| --- | --- |
| Acceptance/MainVault-Source/ | 唯讀原始snapshot，未修改／移動 |
| Acceptance/MainVault-Grasp-v0.3/ | 目前Human全量驗收workspace，DB在.grasp/workspace.grasp.db |
| Acceptance/MainVault-Grasp-v0.3/Markdown/ | 唯一可讀projection；hidden .grasp-export為完整重建metadata |
| Scratch/UI-Repair-20260928-0423/Workspace/ | 本輪完整操作測試副本，不能當無測試修改的交付資料 |
| Scratch/UI-Repair-20260928-0423/copy-private.json | 本輪私有複製inventory／hash證據 |
| Scratch/UI-Repair-Synthetic/ | 本輪合成回歸、原版red與修復green traces／時序JSON |
| GraspPortable/artifacts/GraspPortable-0.3.0/ | 舊套件保留；0.3.1尚待封裝 |
| README-驗收.md、開啟 MainVault 驗收.cmd | Human入口，交付前必須更新及核實 |

MainVault原始2,820notes／244folders／506assets及1篇synthetic acceptance note。優先操作 Grasp acceptance shared workflow，從M4.Root reference修改，檢查M4.Nested、獨立共享撤銷、Reading、策略與檔案定位。私人內容不需要重新分類。原v0.2 rehearsal Acceptance/MainVault-Grasp 保留。

## 工具、模型與額度

Computer Use SKILL已完整讀取，但當前沒有node_repl／@oai/sky／Windows GUI callable入口；不反覆初始化或繞過核准。Playwright Edge實際browser操作可用；Explorer／Obsidian桌面與實體IME無本輪GUI證據，不用API／spawn取代。歷史Notepad核准不推及新executable。

使用者本輪明確允許正常額度Luna subagents，取代先前全面禁用解讀；已透過model=gpt-6-luna selector啟動ui_route_audit與host_wait_audit，fork_turns=none。宿主不另提供實際serving-model核對資料；沒有把worker名稱當證據，沒有開Ultra替代子代理。root負責整合/Git。所有代理在正常額度耗盡時停實質工作，不用Reserve／reset信用。

最新額度觀測21:05:55 UTC：84%used，ordinaryUsageAllowed=true，正常10080分鐘／reset1791128122。同窗口起點73%；是帳戶觀測，不是本task精確扣額。使用者通知重置，但宿主仍回報以上數值，依實際資料控管。細節在 [Usage](USAGE-LOG.md)。

## Git 與歷史

master → origin/master，https://github.com/000Sean000/GraspPortable.git。Root統一stage／commit／push，不reset/stash/force/newbranch；每個coherent milestone先合理測試、更新state、檢查staging，再push及遠端核對。只纳source/tests/docs／匿名證據，不納私人資料或dist/artifacts。必要時command-local safe.directory及http.sslBackend=openssl，不改global設定。

M1–M4前輪已交付並推送8e3d3f0；詳細 [M1](M1-VERIFICATION.md)、[M2](M2-VERIFICATION.md)、[M3](M3-VERIFICATION.md)、[M4](M4-VERIFICATION.md)。前輪528tests／36E2E與MainVault往返證據不能抵銷本輪Human回報故障。本輪修正不重做新產品功能。

既有限制：browser host＋獨立Node24+，非native installer；大型定位全樹檢查約數秒、完整checkpoint曾93–190s；100ms編輯目標未全面達成。Full fallback不含DB operation receipts／共享撤銷history；完整workspace備份須保留DB與全樹。這些限制仍有效，不能因UI回應修復宣稱全部解除。
