# Current Working State — GraspPortable

更新：2026-09-28 12:19（Asia/Taipei）。本輪是使用者重新授權的 **Computer Use 驗證與 v0.3 修復續作 Goal（blocked，未完成）**。本次重新授權後，必要Computer Use入口連續至少三輪仍缺失；Goal工具已再次確認blocked。Computer Use 的node_repl工具仍未載入，不能觸發App approval或宣稱GUI操作；原Acceptance發布仍EPERM。正常額度尚有餘量，並非額度停工。

## 授權與 authority

沿用 SandboxRoot/AGENTS.md、[Seed](Project_Seed/README.md) 的 Requirements rc.3／Development Method rc.3、[Goal Plan](GOAL-PLAN.md)、[Binding](BINDING-EDITING-CONTRACT.md)、[Shared Value](SHARED-VALUE-CONTRACT.md)、[Projection](PROJECTION-CONTRACT.md)。當前授權自主修復、測試、封裝、更新既有入口及coherent checkpoint commit/push；不需例行批准。真正改變已接受語義、資料權限或重大流程才回Human。

已接受且不變：DB runtime authority；自由binding／raw literal／串接、兩種reference、語意優先；共享交易及獨立共享撤銷；未完成草稿持久保存；missing/cycle可保存且標錯；單一readable projection；外部修改必須Review／Import。修改測試全部在Scratch；原MainVault及MainVault-Source唯讀。不要用測試clone覆蓋Human資料，也不要另造persistent AI projection。

## 已修正與證據

- 慢Files／Projection讀取脫離全域mutation queue，關閉即取消view等待；一般GET30秒，檔案狀態／定位5分鐘。background定位顯示進度，workspace切換後拒絕舊reveal。
- native dialog內顯示錯誤並保留表單；Files checkpoint不鎖導航；壞DB恢復後重新啟用分組按鈕。
- 定位以reading fingerprint分辨metadata-only更新，避免settings／draft並發誤報dirty，內容真的變更仍拒絕過期結果。
- 發布失敗在inspect、apiState、settings/schedule及定位中持續顯示；Windows rename拒絕有可操作提示及原始error，成功checkpoint才清除。不削弱dirty檢查。
- 0.3.2 build **4102f62d-bfca-4a69-90d5-3c7027963cdc**：build通過；42files／541unit+integration tests通過7.75s；**45production Edge E2E全通過74.009s，0skip／0flaky**。package smoke通過：獨立temp啟動、DB／export／附件／projection／重啟。
- 原0.3.0四個UI故障held-network browser回歸全紅，修正版全綠。EPERM regression注入真實檔案fixture的rename失敗，先RED後GREEN；不等於原Windows資料夾已解鎖。
- MainVault全量Scratch流程已驗搜尋、三模式、references、共享修改／nested／undo、分組檢視、Files、實體檔案定位及草稿恢復。B流程首讀含checkpoint124.384s、Files4.928s、定位3.536s。Explorer stub／實體stat分開陳述。1440×1000及1024×768已看。完整明細：[UI repair evidence](UI-REPAIR-VERIFICATION.md)、benchmarks/ui-repair-full-corpus.json。
- 草稿runner兩個錯誤假設已更正：新client要手動恢復；建立transition未完不可提前填title。新增正常title/source保存及reload回歸通過。失敗runner證據保留，不以新結果抹去。

## 實際啟動與未解除的 Windows 障礙

原一鍵cmd已指向0.3.2，同一port43861、同一Acceptance/MainVault-Grasp-v0.3/.grasp/workspace.grasp.db；21:35:49UTC GET/host核對build、DB、2,821notes、revision53及2個靜態assets。當時host PID20676／launcher32204；恢復工作時須重查，不能沿用PID直接終止。

原projection仍在revision13。直接checkpoint明確回傳EPERM：rename Markdown到.grasp/internal/projection/old-UUID被拒絕；原資料夾ACL與Scratch相同、非readonly，尚未指認占用程序。固定journal inventory與目前Markdown3,333/3,333files、615,863,057bytes完全一致，無missing／extra／hash／size／unreadable／unstable；70條長路徑均可讀，沒有.obsidian。不能僅因Obsidian程序存在就認定它是原因。

0.3.2於21:36:07及21:36:13UTC兩次GET projection/state仍正確保留error與Windows提示，dirtyPaths空；DB53／public13未變。未修改ACL、未關閉外部App、未手動刪stage／journal。已向Human提出：關閉使用此Markdown資料夾的Explorer／Obsidian／terminal視窗，然後回覆。尚未收到答覆。

續作診斷21:49–21:53UTC：一般Windows使用者（不啟用額外privilege）對原Markdown及Scratch root的DELETE-access／share RWD／OPEN_EXISTING／BACKUP_SEMANTICS handle均成功開啟後立即關閉；原tree共3,594個檔案／目錄亦全部成功。沒有rename/delete/write。預設Codex sandbox的相同root probe均error5，屬不同權限環境，不能拿來推論原host失敗原因。實際43861 host PID20676與正常probe的token均IsTokenRestricted=false。成功開handle不證明整棵tree可rename，也不排除transient/filter限制。21:51:01UTC正式checkpoint仍回EPERM（52.050s），DB53／public13／recovery53不變，無active journal；不能指認Explorer／Obsidian／ACL。產品source review的SafeTree.read已在finally關handle，未找到持續佔用的產品stream。private證據：directory-access-probe-private.json、tree-access-probe-private.json、host-token-probe-private.json、checkpoint-after-access-probe-private.json，均在Scratch/UI-Repair-Deployment。

阻擋審查21:56UTC：同一Windows發布障礙已跨連續三個Goal turn；上一輪屬有進展（新增Win32／host-token證據與實際checkpoint），本轮重新fetch為0/0、工作樹乾淨、實際host回應build4102...、GET projection/state仍error EPERM／DB53／public13／recovery53／dirty0，無active journal。所有子代理已完成，沒有待輪詢的工作。Human問題尚未答覆；再重試或重跑既有測試不能解除目前障礙。已用Goal工具設status=blocked，並非complete或quota-stop；只保存此最小交接，等待Human或外部狀態變更後續作。

**本次續作（09-28 04:03–04:15UTC）**：依使用者要求優先核對真正Computer Use。完整skill／guidance／confirmation已讀；工具目錄無node_repl或Windows操作入口，plugin directory精確查詢亦未找到可接入的對應能力。本機Computer Use已enabled，node_repl MCP已配置，但這個thread沒有其callable tools；沒有修改設定、改走shell UI automation或把Playwright冒稱CU。已請Human重新啟動Codex並回报MCP載入錯誤；新turn仍無工具。不能保證重啟即修好，也不能僅憑features.js_repl=false認定MCP原因。

原正式host build4102...及DB核對後，04:07:08UTC再走既有checkpoint一次：51.966s、HTTP200/state=error/EPERM、DB53/public13/recovery53/dirty0，完整備份仍在。本輪未開啟原Vault；實際桌面仍未驗。private結果為Scratch/UI-Repair-Deployment/resumed-checkpoint-private.json。沒有指认Obsidian是原因。Sysinternals Handle未安裝到可呼叫路徑、EULA無已接受紀錄、當前Windows token非admin，本輪未下載、接受license、提權或關handle。

已用0.3.2套件準備Scratch/UI-Repair-20260928-0423/Workspace測試host，04:08:13UTC API核對ready、DB89/public89/dirty0。中斷後04:12UTC原host PID20676與Scratch PID40164均不存在、43861/43862無listener；這是實際程序查詢，不依timeout猜測，也未認定停止原因。核對無listener後只重啟Scratch 43862（新PID5836，使用時須重查）；原43861不在執行，Human原一鍵入口仍指向正確0.3.2。啟動及HTTP成功均不算GUI驗證。04:15:19UTC重啟後再驗HTTP200/build4102.../Scratch ready/DB89/public89/dirty0。private紀錄在scratch-resumed-launch-private.json及scratch-resumed-state-private.json。

04:19:23UTC最新阻擋審查：目前工具列表仍無node_repl／Computer Use callable entry；未取得畫面、未點擊、未觸發App approval。Scratch port43862由PID5836實際監聽且程序存在，不重啟；原43861無listener。上一輪中斷前只發出說明、未執行核對，屬無新進展，不能當作GUI證據。本輪只重驗工具與程序後，按連續阻擋規則設Goal=blocked，停止自動初始化／checkpoint重試。待宿主MCP工具載入恢復，或Human提供node_repl啟動錯誤後續作；正常額度94%used、ordinaryUsageAllowed=true，非quota-stop。

**精確下一步**：先恢復本thread可呼叫的node_repl MCP入口，不要再放寬filesystem當作CU修復。工具可用時選擇實際返回的browser window，取得畫面，開Scratch http://127.0.0.1:43862/，觀察→切換Reading→重新觀察；遇App approval由Human按一律允許，原Acceptance Obsidian Vault保持關閉。之後才繼續同路徑GUI debug。原EPERM需新的Windows原因證據，不反覆無資訊checkpoint；最小source/test/待驗項見[Chat單題接手](UI-REPAIR-VERIFICATION.md#chat-單題接手)。原路徑發布ready且revision一致後，才開回原Vault驗閱讀與檔案定位。完整Goal尚未完成。

## 資料保存與 locator

SandboxRoot為實際Git repository的上一層（本機資料夾名GraspPortableWorkspace），repo為其下GraspPortable。以 git rev-parse --show-toplevel 核對；舊cwd .../GraspProject/GraspPortable 已不存在，命令必須指定實際workdir。完整本機位置保存在repo外的README-驗收.md及本thread，public文件只使用相對locator。

| 相對SandboxRoot位置 | 用途 |
| --- | --- |
| 開啟 MainVault 驗收.cmd、README-驗收.md | 已更新0.3.2；原資料位置不變 |
| GraspPortable/artifacts/GraspPortable-0.3.2/ | 新套件；需獨立Node24+，不是native installer |
| Acceptance/MainVault-Source/ | 未修改／移動的原snapshot |
| Acceptance/MainVault-Grasp-v0.3/ | Human資料；DB在.grasp/workspace.grasp.db |
| Acceptance/MainVault-Grasp-v0.3/Markdown/ | 唯一projection，目前因Windows阻擋落後；不要當作最新DB |
| Scratch/UI-Repair-Deployment/MainVault-Grasp-v0.3-before-0.3.1/ | 更新前完整離線備份，包含DB、舊Markdown及所有recovery／stage／journal |
| Scratch/UI-Repair-Deployment/ | backup-private.json、原始入口備份、啟停／HTTP／EPERM private證據 |
| Scratch/UI-Repair-20260928-0423/Workspace/ | 全量測試副本，含synthetic修改，不是交付DB |
| Scratch/UI-Repair-20260928-0423/Evidence/ | A／B／草稿結果及失敗run，private不入Git |
| Scratch/UI-Repair-Synthetic/ | 原版red／修版green traces及title-recovery證據 |

離線備份21:17:59–21:18:56UTC：36,677files／2,881directories／7,408,155,403bytes，逐檔source-before／target／source-after SHA256一致、SQLite quick_check=ok、2,821notes。舊host已核對身份及無active journal後用Windows定向終止，非graceful證據；完整backup保留既有pending/stages。後續只更換程式host，未改筆記。前輪v0.2 rehearsal、0.3.0／0.3.1套件均保留，未破壞性清理。

## Git、工具、模型與額度

master → origin/master，https://github.com/000Sean000/GraspPortable.git；21:35fetch成功0/0，root統一Git。原M1–M4基線8e3d3f0已發布；本輪第一修復checkpoint **fd8a8a776745f6fefca47d26f67cb24644d64305** 已push並核對。0.3.2修正、診斷runner與匿名證據已由 **a52b67ec9239d852700af62443982bc1c0c408d7** commit/push，origin/master實際SHA完全一致，21:43UTC工作樹乾淨。本文最後收尾紀錄另隨docs checkpoint發布；最新SHA查Git history。私人Acceptance／Scratch／generated files均不納Git，package在ignored artifacts。

Computer Use SKILL先前已讀，但本輪無node_repl／Windows GUI callable入口。Playwright Edge真browser可用；Explorer reveal是stub＋檔案stat，不能冒稱桌面驗收。Explorer／Obsidian／實體IME及Human最終操作仍未驗。沒有以API或spawn當畫面證据。

本輪明確允許正常額度Luna子代理，兩worker透過model=gpt-6-luna selector啟動，serving-model獨立metadata不可得；root負責整合。worker已完成且閒置。本次最新09-28 04:19:23UTC正常額度94%used、ordinaryUsageAllowed=true、10080分鐘/reset1791128122；起點73%，為帳戶觀測，不是task扣額。使用者曾通知reset，宿主本輪尚未反映新window。100%或正常額度耗盡，全部代理停實質工作，只最低安全收尾；不使用Reserve／自行reset。[Usage](USAGE-LOG.md)。

目前缺口是Computer Use工具載入與原資料夾Windows發布障礙；**不是因額度停止，也不宣稱Goal完成**。其他限制：大型checkpoint約1–3分鐘；100ms編輯目標未全面達成；Markdown fallback不含DB operation receipts／共享undo history，完整備份需DB與全樹。

發布payload審查：自動核准曾因可能含私人絕對路徑而拒絕commit/push，尚未執行Git mutation。逐檔檢查後，package-smoke.json原本僅含套件basename／數字；E2E報告中的機器source paths已轉成repo-relative，原始完整報告另存Scratch，測試stats完全不變。本文移除機器使用者根目錄。完成18個staged payload逐一檢查與synthetic PNG目視確認後，重新申請核准已通過；a52b67e正常push成功並核對遠端SHA。這是改正payload後的重新審查，沒有繞過拒絕或改寫history。
