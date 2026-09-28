# v0.3.2 UI 操作修復

本輪目標是恢復主要操作，讓 Human 重新驗收；不是宣告 Human 驗收通過。基線為 origin/master 的 8e3d3f0，實際舊套件 0.3.0 build 5f008760-bd1b-4906-90cc-86a52177616d。0.3.1 build 為 bcab7a56-8871-45b9-bd04-4430de960c4f，已封裝且實際入口核對；後續0.3.2補原Acceptance發布錯誤提示；第一版修復 build 49738c2b-b530-4cae-b93c-2b06a11710f1 已由下述全量檢查找出逾時回歸，後續重新建置。

## 已證實的問題與修正

| 問題 | 證據 | 修正 |
| --- | --- | --- |
| 關閉分組／Files 面板後，Reading／選筆記仍等候慢 GET | 舊套件瀏覽器 held-response 測試：兩項均超過 2 秒，後續點擊已送達 | 面板讀取脫離全域 mutation queue；面板關閉 AbortController；一般 GET 30 秒、檔案狀態檢查 5 分鐘上限，逾時可重試 |
| 檔案定位等待沒有回饋，阻擋模式及 workspace 切換 | 舊套件無 operation-status，兩操作均超時 | flush 仍有序；定位在背景執行並顯示進度；5 分鐘停止等待，明說 host checkpoint 可能仍在執行 |
| 定位晚回應可觸發舊 workspace 的 reveal | 舊套件釋放定位回應後，仍送出 reveal；測試攔截 OS 呼叫 | 每次取得定位結果後核對 workspace；已切換則不送 reveal/open-folder |
| native dialog 遮住外部 toast，使用者看不到錯誤 | 舊套件空路徑錯誤的 dialog 內沒有可見 notice | 錯誤直接呈現在 dialog，保留表單／editor；409 也有回歸 |
| 策略完成回應與已關閉 view 的生命週期 | 防護性整理，非已證實的舊版資料錯誤 | 提交完成交由 workspace/revision guard 接收，舊 view 跳過重繪 |
| Files 手動 checkpoint 仍占全域 queue | source audit，同等待路徑；新增 held-response 回歸 | 僅 flush 進 queue，checkpoint 由 Files busy 狀態管理 |

完整性／dirty 檢查沒有削弱，沒有 silent Markdown sync、沒有自動重試 mutation。讀取 abort 只結束 client 等待，不承諾終止 host 工作。

全量實測發現初版修復的30秒預設不足：inspect() 會先等待進行中的 checkpoint，冷啟動或共享更新可遇到長發布。故檔案／分組狀態使用5分鐘專用上限，面板明示大型資料庫可能數分鐘且可先關閉。8項API fake-timer tests驗證一般讀取30秒與專用檢查5分鐘（不自動重試）；這不是把等待時間當成效能改善。

已排除假設：strategy apply 回傳的 WorkspaceSnapshot 本身不增加 workspace revision，策略有自己的 revision。因此「關閉面板導致主 snapshot 過期」不是已證实問題。新增測試驗證策略保存後重開仍可見，以及跨 workspace 晚回應防護，不將這兩例宣稱為舊版紅綠回歸。

定位並發回歸：整合E2E第二輪在保存導航設定與檔案發布重疊時收到409，截圖顯示誤報dirty/error。generation-complete測試hook已確定性重現：settings/draft更新使狀態pending，但可讀內容未變。已以readingFingerprint重新確認內容，保留真正dirty/error及內容過期阻擋；3項確定性host回歸及完整44 E2E通過。另修復啟動DB失敗後新建workspace，分組按鈕未重新啟用（fallback E2E覆蓋）。

## 驗證

- 最終 Production build 通過；42 files／540 unit + integration tests，7.07秒；44 production Edge E2E全部通過，1.2分鐘。
- 舊套件4個故障回歸全紅（實際browser＋人工延遲network）；修正版6項focused browser回歸全綠，5.1秒。另兩項為新增覆蓋，不聲稱舊版已跑過紅測試。
- 完整44 E2E首輪43pass／1fixture假設錯誤（1.4m），第二輪43pass／1真實定位競爭（1.5m），已分別修正並保留Scratch失敗證據。
- Full-corpus Scratch有效A流程：啟動1.334s、搜尋選取47ms、三模式797ms、References210ms、共享修改／nested更新／獨立撤銷3.308s。證據：Scratch/UI-Repair-20260928-0423/Evidence/diagnose-ui-2026-09-27T204600-569Z。
- 該全量run後續遇到初版30秒讀取逾時；修正後final build的B流程（210545-837Z）：啟動1.337s、搜尋46ms、三模式1.068s、References228ms、分組搜尋含冷checkpoint124.384s、Files4.928s、定位3.536s，定位檔案stat與reveal request path一致。Explorer是stub。
- 草稿211339-834Z獨立確認：fresh client明確按「恢復草稿」→「恢復」，80ms後狀態與未完成source正確；1440×1000／1024×768畫面已檢視。先前runner自動恢復假設、過早title填寫疑點另有失敗證據及focused檢查，沒有抹去失敗或宣稱整個舊run全通過。
- 0.3.1 package smoke於21:13:20UTC通過：無node_modules／私人檔案、獨立temp啟動、DB保存／export／重啟、附件bytes重啟、完整projection發布。實際Human入口待切換。匿名流程彙整見 benchmarks/ui-repair-full-corpus.json；完整44E2E報告獨立保留。

## 資料與證據界線

原 Acceptance host 43861／PID25248 起始時使用 MainVault-Grasp-v0.3，未對它做寫入測試。完整測試副本位於 SandboxRoot/Scratch/UI-Repair-20260928-0423/Workspace，DB 使用 SQLite online backup、quick_check=ok、2,821 notes。其餘 36,676 files／6,778,948,363 bytes 以 source-before/target/source-after SHA-256 逐檔核對；7 個空目錄另保留。私人清單在 copy-private.json，不入 Git。

舊版 traces：Scratch/UI-Repair-Synthetic/PreFix-Red-20260928-045700。修復後 focused traces/results：PostFix-Green-20260928-050000；逐項時序 JSON 位於同層 timestamp-pid/Evidence。合成資料、沒有私人內容進 Git。

Computer Use 所需 node_repl／Windows GUI 入口在本輪不可呼叫；使用真正 Edge Playwright browser，但不冒稱桌面 Computer Use。Explorer reveal 測試使用 stub／檔案存在性；Obsidian／Explorer 桌面、Windows 實體 IME 仍需 Human 驗收。

## 安全更新準備

核心修復已push並核對 `fd8a8a776745f6fefca47d26f67cb24644d64305`。舊0.3.0 host重新核對build／DB／PID25248後於21:17:59UTC使用Windows定向終止；不是graceful shutdown證據。無active publication journal，兩小時未變的pending rev53及所有stages／done journals原樣保留。離線backup於21:18:56UTC完成：36,677files、2,881directories、7,408,155,403bytes，source-before／target／source-after SHA-256全一致、SQLite quick_check=ok、2,821notes。備份在Scratch/UI-Repair-Deployment/MainVault-Grasp-v0.3-before-0.3.1；private inventory在backup-private.json，未入Git。

## 原驗收資料夾發布障礙（後续0.3.2）

0.3.1原入口已啟動且build/DB/assets核對通過，但21:25:08UTC直接checkpoint回傳error：Windows EPERM拒絕將Markdown目錄rename至內部old-generation。沒有原始內容遺失；舊Markdown停在revision13、DB為53，離線全樹備份已保留。原Acceptance與Scratch目錄ACL相同、非唯讀屬性，尚不能指認哪個外部process占用。未停止Obsidian或其他外部App，已請Human關閉使用該目錄的視窗後再試。

發現伴随產品bug：下一次inspect重新接受舊baseline時會清掉先前error，畫面只剩pending。已修正錯誤持續顯示與可操作的Windows占用／權限提示；checkpoint、後續inspect/apiState、settings/schedule及定位均保留錯誤，成功retry才清除。focused regression先RED（inspect誤變pending）後GREEN，15/15 pass；不放寬dirty檢查、不覆蓋外部檔案。原Acceptance最新發布仍等待Windows障礙解除。

標題疑點已由新增focused E2E排除（1pass/2.3s）：等建立與settings操作完成，再填標題／保存未完成source，GET drafts與reload後title/source均保留。最初runner提前對inert transition填值；已修runner等待與斷言。最終產品bundle未因此變動，尚未將全44E2E報告改稱45項全套。

固定journal前後唯讀比對：3,333/3,333files、615,863,057bytes，missing／extra／size／hash／unreadable／unstable全0；70個超過260字元的absolute paths亦可讀，`.obsidian`數0。不是已證實的外部筆記修改，亦不能僅因Obsidian正在執行就指認它占用。Windows拒絕rename的原始API證據保存於Scratch/UI-Repair-Deployment/checkpoint-direct-private.json；未更改ACL或關閉外部App。

## 最終0.3.2產品驗證

Build `4102f62d-bfca-4a69-90d5-3c7027963cdc`：production build通過，42files／541unit+integration tests通過（7.75s），全部45production Edge E2E通過（1.2m，無skip/flaky）。包含新標題恢復test與既有UI操作紅綠回歸；EPERM regression為真實檔案fixture＋注入rename失敗，不能代替原Windows目錄已解鎖的證據。原Acceptance publication仍受EPERM阻擋，Goal尚未完成。

0.3.2實際入口21:35:49UTC核對build4102f62d-bfca-4a69-90d5-3c7027963cdc、同一DB／2,821notes／revision53／2個assets。21:36:07與21:36:13兩次GET state均保留error及可操作Windows提示；原EPERM未解除，public revision仍13。完整53-file套件smoke21:34:05UTC通過。當前停止位置是等待Human解除原目錄Windows阻擋後重試並驗證，而非Goal完成／額度停止。

## 原路徑唯讀存取診斷（21:49–21:53UTC）

未改動資料的Win32 probe：CreateFileW要求DELETE access、share R/W/D、OPEN_EXISTING、BACKUP_SEMANTICS，沒有DELETE_ON_CLOSE；成功立即close。原Markdown及Scratch root成功，原tree的3,594個檔案／目錄全部成功。預設Codex restricted sandbox兩root回5，而正常Windows使用者均成功；因此受限sandbox結果不當作原host權限結論。實際host與probe token均IsTokenRestricted=false，沒有提權或改ACL。此probe只測當下handle的access/share compatibility，不測完整rename、目的parent、filter或競態。[CreateFileW官方契約](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)。

基於新probe證據重試正式checkpoint一次：21:51:01UTC、HTTP200、52.050s、state=error，仍是Markdown→internal old-generation的EPERM；DB53／public13／recovery53保留。開始的無Content-Type請求回415，於mutation前拒絕，沒有發布。重試後無active journal。read-only source追查未見產品未關閉handle：SafeTree.read在finally關閉，API先讀成bytes才回傳，SQLite在.grasp而非Markdown。不能以此排除其他Windows原因，亦未找到可安全自行關閉的確定占用程序。

私人完整證據仍在Scratch/UI-Repair-Deployment：directory-access-probe-private.json、tree-access-probe-private.json、host-token-probe-private.json及checkpoint-after-access-probe-private.json。沒有外部App終止、權限變更、強制move或測試DB覆蓋。Human解除相關視窗占用／確認目錄存取的問題仍待答覆；未宣稱Goal完成。

## Chat 單題接手

以下三卡可分開交接。共同驗收缺口：本輪沒有可用的 node_repl／Computer Use GUI 入口；Explorer reveal 測試使用 stub。不要把 browser E2E 或錯誤注入測試說成 Human 桌面驗收或原路徑發布成功。2026-09-28 04:07:08UTC原路徑正式重試仍失敗，51.966秒、EPERM、DB53/public13/recovery53/dirty0，private證據為Scratch/UI-Repair-Deployment/resumed-checkpoint-private.json。本段未改產品或重跑完整M1–M4。

### 1. 慢讀取時保持 UI 可操作，阻止舊 workspace 晚 reveal（已修）

- **重現／預期：** 在 `/api/projection/state`、`/api/files/status` 或定位請求被 hold 時關閉 Projection／Files 面板；Reading、搜尋及筆記選取應能在 2 秒內繼續。另 hold 定位回應後切換 workspace；舊 workspace 的結果不得送出 reveal/open-folder。停止等待不表示停止 host checkpoint。
- **根因／改動：** view-owned GET 有 AbortSignal／timeout，關閉或重開面板取消舊讀取；定位在背景呈現進度，workspace guard 阻止舊結果 reveal。5 分鐘定位等待只停止 client 等候，不取消 server 工作。主要介面在 `src/app/api.ts` 的 `request<T>(..., { signal, timeoutMs })` 與 `requestFileLocation<T>()`；呼叫端在 `src/app/main.ts`、`src/app/projection-panel.ts`、`src/app/files-panel.ts`，host 操作在 `server/api.ts`／`server/projection.ts`。
- **基線／最小測試：** `fd8a8a7`。`npx vitest run tests/app-api.test.ts tests/files-browser.test.ts`；`npx playwright test tests/e2e/ui-responsiveness.spec.ts --reporter=line`。產品有改動時先執行 `npm run build`；focused E2E用line reporter避免覆蓋已保存全套JSON證據。現有結果：最終 build `4102f62d-bfca-4a69-90d5-3c7027963cdc` 的 541 unit/integration tests 與 45 production Edge E2E 全通過；full-corpus B 流程定位 3.536 秒，Explorer 使用 stub。
- **仍待驗證：** Human 使用實際 Explorer／Obsidian 的桌面 reveal、外部程式佔用下的互動，以及 Windows 實體 GUI；不能由 stub 推論。

### 2. 發布錯誤不得被 inspect／schedule 清除（已修）

- **重現／預期：** checkpoint 在 `Markdown` 目錄 rename 時注入 `EPERM`；接著呼叫 `inspect()`、`apiState()`、settings 更新與 `schedule()`，並試定位。狀態和原始錯誤提示應持續為 error，定位應顯示可處理原因；只有成功重試 checkpoint 才清除錯誤。
- **根因／改動：** inspect 初始化重新接受舊 baseline 時曾重設狀態，scheduler 也會把 error 覆蓋成 pending。`server/projection.ts` 現保存 `lastPublicationError`，讓初始化、schedule、inspect/apiState 和定位維持 error；rename error 保留原始碼與 Windows 操作提示，不放寬 dirty 檢查。測試在 `tests/projection-host.test.ts` 的 `retains actionable Windows rename errors through inspection and clears them after retry succeeds`。
- **基線／最小測試：** `a52b67e`。`npx vitest run tests/projection-host.test.ts -t "retains actionable Windows rename errors"`。現有結果：此錯誤持續性 regression 曾先 RED 後 GREEN；加入 settings/schedule 情境後，完整 541 unit/integration 套件通過。這是測試 fixture 中的 rename error 注入。
- **仍待驗證：** 原 Acceptance 實際遇到 EPERM 時 UI 提示、成功解除原因後 retry 清除狀態的 Windows 桌面流程；注入測試不證明原路徑 rename 可行。

### 3. 原 Acceptance 路徑的 Windows `EPERM`（尚未解）

- **重現／預期：** 以 0.3.2 host 對原 `Acceptance/MainVault-Grasp-v0.3` 執行 checkpoint。預期發布成功後 projection revision 與 DB revision 一致，並可由 UI 開啟／定位最新筆記；目前保存的實際結果仍是 `Markdown` rename 到 `.grasp/internal/projection/old-*` 回 `EPERM`，DB revision 53、public revision 13、recovery revision 53、`dirtyPaths` 空，舊 Markdown 與全樹備份保留。21:51:01 UTC 的 checkpoint 仍失敗；全樹 3,594 個檔案／目錄的 DELETE-open probe 成功，但這不等價於 rename 成功。2026-09-28 04:07:08UTC又一次正式checkpoint仍EPERM（51.966秒），沒有新的已確認根因。
- **根因／假設：** 尚未定位。`server/projection-generation.ts` 的 `GenerationTree.move()` 呼叫 `fs/promises.rename`；`server/projection.ts` 的 `publish()` 在 `Markdown` 到 `old-*` 的切換點捕捉並保留 error。source review 未找到 GraspPortable 長期持有 Markdown 子檔 handle：`SafeTree.read()` 在 `finally` 關閉 handle，API 路由先讀成 bytes 再回應，SQLite 位於 `.grasp`。外部 child handle、瞬時競態或檔案系統 filter 仍只是可能性，未證實程序／ACL 原因。
- **基線／最小測試：** 診斷文件基線 `a3121db`；提示與錯誤保留實作 `a52b67e`。`npx vitest run tests/projection-host.test.ts -t "retains actionable Windows rename errors"` 已通過，但僅證明注入失敗的復原與提示。真正驗收需在原 UI 執行 checkpoint，讀回 state 為 ready、manifest 對齊當時 DB revision，再確認舊資料可讀且 dirty 保護仍工作；不要以測試副本或強制搬移代替。
- **仍待驗證：** 原路徑成功發布及內容／定位核對；Human Windows GUI／外部 app 實際互動。本輪未關閉外部程序、改 ACL、手動搬動原 Markdown 或安裝／提權工具；不要在未指認原因前終止程序或更動資料權限。

### Computer Use 接力前置條件（工具缺口，非產品patch）

- 本機plugin已啟用、node_repl MCP已配置，但本thread工具列表沒有node_repl；未取得畫面／點擊／App approval。已請Human重啟Codex，之後仍需核對工具載入；不把任意feature開關或full filesystem access當成已驗證修復。
- 真正GUI目標：Scratch/UI-Repair-20260928-0423/Workspace，0.3.2，port43862；04:08:13UTC API為ready/DB89/public89/dirty0。中斷後兩host程序及listener都實際消失，已確認後只重啟Scratch，04:15:19UTC再次API核對ready/DB89/public89/dirty0；先GET/host核對build4102f62d-bfca-4a69-90d5-3c7027963cdc與Scratch路徑，再用CU取得畫面→Reading點擊→新畫面。Shell啟動、HTTP、Playwright都不是這個CU驗收。
- 原Acceptance Vault保持關閉；要測Obsidian先用上述已發布Scratch/Markdown。原路徑成功發布後才開原Vault。
