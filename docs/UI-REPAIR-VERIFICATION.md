# v0.3.1 UI 操作修復

本輪目標是恢復主要操作，讓 Human 重新驗收；不是宣告 Human 驗收通過。基線為 origin/master 的 8e3d3f0，實際舊套件 0.3.0 build 5f008760-bd1b-4906-90cc-86a52177616d。修正版最終 build 為 bcab7a56-8871-45b9-bd04-4430de960c4f，封裝待核對；第一版修復 build 49738c2b-b530-4cae-b93c-2b06a11710f1 已由下述全量檢查找出逾時回歸，後續重新建置。

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
- 該全量run後續分組面板遇到初版30秒讀取逾時，已改5分鐘專用等待；B／draft正在final build重驗。第一輪runner等待load／aria取樣錯誤及第三輪runner listener拒絕不是產品成功證據。
- 封裝、全量B／draft、實際Human啟動入口仍待完成；目前只發布已通過的核心修復checkpoint。

## 資料與證據界線

原 Acceptance host 43861／PID25248 起始時使用 MainVault-Grasp-v0.3，未對它做寫入測試。完整測試副本位於 SandboxRoot/Scratch/UI-Repair-20260928-0423/Workspace，DB 使用 SQLite online backup、quick_check=ok、2,821 notes。其餘 36,676 files／6,778,948,363 bytes 以 source-before/target/source-after SHA-256 逐檔核對；7 個空目錄另保留。私人清單在 copy-private.json，不入 Git。

舊版 traces：Scratch/UI-Repair-Synthetic/PreFix-Red-20260928-045700。修復後 focused traces/results：PostFix-Green-20260928-050000；逐項時序 JSON 位於同層 timestamp-pid/Evidence。合成資料、沒有私人內容進 Git。

Computer Use 所需 node_repl／Windows GUI 入口在本輪不可呼叫；使用真正 Edge Playwright browser，但不冒稱桌面 Computer Use。Explorer reveal 測試使用 stub／檔案存在性；Obsidian／Explorer 桌面、Windows 實體 IME 仍需 Human 驗收。
