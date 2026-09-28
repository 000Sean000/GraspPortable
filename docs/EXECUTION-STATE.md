# Current Working State — GraspPortable

更新：2026-09-28。當前工作段收斂為 E1 launcher-first 結果與可恢復交接：啟動器／host PASS，Computer Use 瀏覽器畫面取得 BLOCKED，E1 native selection 及本輪 UI/UX 未完成。使用者已要求停止重試此受阻操作，只更新證據／Working State／既有 Task Index、commit/push 並核對後停止；本工作段交接不等於產品桌面驗收完成。E2 EPERM 不展開。正常收尾仍須觀察手動 reset、新窗口已使用至少1%且最多10%，保留至少90%。

## 授權、基底與停點

使用者已明確取代 smoke-test 唯讀限制，授權同步、局部修復、測試、更新文件與 commit/push。最新指示只完成交接：不重試 Computer Use URL-policy 拒絕、不修 Codex 環境、不換自動化繞過、不重跑自動測試代替桌面驗收；沒有已確認新產品問題就不製造修改任務。已完成的啟動流程使用 Explorer 雙擊 Scratch 啟動器與既有 scripts/launch.mjs；原入口/Acceptance保持不變。重置由使用者操作，不使用 Reserve/reset券；不自行開始下一個 Goal。

適用上層 SandboxRoot/AGENTS.md。Authority：[Seed](Project_Seed/README.md) 的 Requirements/Development Method rc.3、[已接受 Plan](GOAL-PLAN.md)、[Binding](BINDING-EDITING-CONTRACT.md)、[Shared](SHARED-VALUE-CONTRACT.md)、[Projection](PROJECTION-CONTRACT.md)。SQLite runtime authority、stable identities、原子共享操作、獨立 shared undo、可恢復未完成草稿、dirty 不覆寫等契約不變。MainVault/Source 唯讀；會寫資料的測試只用完整 Scratch 副本。

本機原基底 `9eeabc48a884d1bfc63250f5c3ce1f07422fe881`，工作樹乾淨；fetch 後安全 fast-forward 到 `8813e755d8ae879c9096fc02aaf713704b86fc3f`，master → origin/master。遠端既有修正 `bd1b9a0`、測試 `11820b7` 已納入，不重新實作。先前兩次自動核准拒絕已因本輪明確授權解除；未繞過審查。

## 架構核對

本節及前輪自動測試為已完成的 `2e5414a` 交接，不重新盤點。

以 [ARCHITECTURE](../ARCHITECTURE.md) 與 [IMPLEMENTATION-CONTRACT](IMPLEMENTATION-CONTRACT.md) 為主，對照 `8813e75` source。核對範圍限交接所需，不宣稱全庫 correctness audit：

- [main.ts](../src/app/main.ts) 的 toolbar/navigation → ordered draft flush → beginFileAction/activity → locate → workspace guard → reveal → toast。file work 不占 editor mutation queue。
- [API client](../src/app/api.ts) 的取消與 timeout、[ProjectionPanel](../src/app/projection-panel.ts) 的 show/run/destroy、[FilesPanel](../src/app/files-panel.ts) 的 callbacks 與 view-owned reads。
- [HTTP host](../server/api.ts) 的 workspace/path validation 與平台 command；spawn event 只代表啟動，不等於 Explorer 選中。
- [ProjectionWorkspaceFiles](../server/projection.ts) inspect 等待 active publication，再 initialize/dirty/catalog；publish 先建立並驗證 recovery/stage、journal，再 [GenerationTree.move](../server/projection-generation.ts) cutover；[SafeTree](../server/files.ts) 保持 confinement/handle close。
- SharedCommand、SourceEditProof、schema 5、EditorAdapter/RuntimeClient 的公開宣告與責任分界和文件一致；未修改資料契約。

未发现需要改寫架構文件的實質落差，故不新增另一份架構文件。任務依驗證負擔分類；Explorer patch 很小，仍需 Windows native 驗證。

## 當前 E1 Windows 操作

本次從乾淨 `2e5414a` 開始，fetch確認0/0。使用正確 build `874a5a4b-3c75-4620-8bb1-0fee988a3346` 與完整副本，不重新 build/test。Computer Use 已從 Explorer 雙擊 `Scratch/Chat-Handoff-20260928-1818/Start-Grasp-E1.cmd`，開出 Grasp browser，GET host 核對 build/Scratch DB；接著取得 browser state 時工具以無法可靠確認 URL 終止本 turn。

**E1 BLOCKED，未取得 native PASS**：停在選 synthetic note 之前，沒有 reveal click、locate/reveal response 或目標 Markdown selection。Source/Live/Reading、reference/shared/undo、Strategy/Files、draft recovery 這一輪全部 NOT TESTED，不拿前輪 headless 證據改列本輪 GUI PASS。完整當次結果與 exact error 見 [E1 Windows evidence](E1-WINDOWS-VERIFICATION.md)。沒有產品 code 修改，沒有重試 checkpoint/E2 或工具初始化。

重置前成果已保存於 `a8d5539`、`9f5a306`；本次文件交接 preflight：乾淨 `9f5a306f40303702cc93b5cc5e36c9c7510cd2fc`、master、fetch成功、HEAD與origin/master 0/0。使用者已通知手動重置，工具已回傳新10080分鐘窗口/reset1791200482、初次0%used、ordinaryUsageAllowed=true；與舊reset1791128122分開計算。完整觀測及交付前用量見 [Usage log](USAGE-LOG.md)，不把舊100%讀值與使用者介面1%的差異解釋為已證明的額度耗盡。

11:34UTC最後核對：Scratch port43862 listener PID28156、node.exe dist/server.mjs、parent7708（launcher）；當時保留live host，收尾未重新檢查或停止，不能把歷史PID當現況。精確停點是選 synthetic note 前的 browser observation 被工具policy中止。原始工具名稱、完整錯誤、時間精度及 unavailable 欄位見 [E1 Windows evidence](E1-WINDOWS-VERIFICATION.md)；缺漏不靠再觸發拒絕補齊。

## 前輪結果與證據（2e5414a）

- 既有 Explorer 修正：Windows 單一 `/select,<path>` argument，macOS/Linux 保持原行為。本輪沒有新增產品 code。
- `npx vitest run tests/api.test.ts tests/files-api.test.ts`：2 files / 20 tests PASS（2.62s）。
- `npm run build`：PASS，build `874a5a4b-3c75-4620-8bb1-0fee988a3346`；Vite 有 >500 kB chunk warning，未當作新功能擴張。
- `npx playwright test tests/e2e/files.spec.ts tests/e2e/ui-responsiveness.spec.ts --reporter=line`：10 PASS（10.2s）。Explorer fixture 明確不用真實 Explorer；不代替 native selection。
- 原 Acceptance 成功證據有效。本輪只讀 manifest 確認 revision53、3331 files、createdAt `2026-09-28T06:58:32.936Z`、fingerprint `a97194cce889bc371d1346a064cf7cebbab74637989f243cc1a81d58b277dfe8`；未重新發布或逐檔重算 hash。
- 新完整副本 `Scratch/Chat-Handoff-20260928-1818/Workspace`：robocopy 40016 files、3145 dirs，failed/mismatch=0；DB SHA256 與來源一致。這不聲稱全樹逐檔 hash 驗證。
- 新 host 已核對 build/DB，port43862。Computer Use 成功列窗，但選取 Chrome 並嘗試開新 tab 時安全檢查終止本 turn：`could not determine the current browser URL on Windows with enough confidence to enforce policy`。未繼續 GUI 輸入，也未改用其他工具繞過；此輪沒有新版 native Explorer 成功證據。host 已停止，listener 查詢為空。
- 完整 corpus browser 歷史證據 [ui-repair-full-corpus.json](benchmarks/ui-repair-full-corpus.json) 每步有各自 buildId，涵蓋搜尋/三模式/reference/shared/undo/策略/Files/草稿。最終 0.3.2 541 tests/45 E2E 屬此前 build `4102f62d-bfca-4a69-90d5-3c7027963cdc`，不能冒稱它們全部已針對新 build 重跑。

## 交接入口與精確下一步

[Task Index：Chat 單題接手](UI-REPAIR-VERIFICATION.md#chat-單題接手) 是唯一當前索引。**本輪到此交接，不再觸發受阻操作。** 一般 Chat 可直接讀 E1 證據及索引中的少量 source/tests/contracts，理解現有 patch 和證據邊界；沒有新確認產品 bug 可交 coding。

**待外部提供 Windows 結果**：E1 仍需本機操作人員或已能合法取得 browser 畫面的 Windows session，先核對新 build／Scratch DB，沿 Scratch 啟動器流程選 `Grasp acceptance shared workflow` → 按一次「顯示筆記檔」→ 記錄正確父資料夾與目標 Markdown 確實選中。隨結果提供時間、build、workspace locator、筆記／檔名、可得 locate/reveal 結果及 Explorer 證據；缺漏標 unavailable。只有收到此證據才能改列 native PASS。若真正操作失敗，再沿同一 request 定位，不重做已存在 helper patch。這是下一段外部驗證依賴，不是本輪改用其他自動化執行。

E2 是 Scratch EPERM 診斷，根因未定；不得因原 sandbox probe 拒絕就斷定 host 同因，不重試無新資訊 checkpoint。E3 是 GUI coverage/long-wait 補證據，不能把 headless 測試或曾經的 timeout 當成 native PASS 或新的確定 bug。這些是明列待辦，本輪不全部展开。

目前沒有新確認、未修正且適合獨立交 Chat coding 的一般 bug；已有修正留作驗證任務。後續任務只讀索引的少量 source/tests/contracts。

## 本機資料與版本 locator

SandboxRoot 是 repo 的上一層；實際絕對位置見 repo 外 README-驗收.md。私人資料/驗收副本/生成檔不進 Git。

| 相對 SandboxRoot | 用途 |
|---|---|
| 開啟 MainVault 驗收.cmd、README-驗收.md | 使用者入口；仍指向既有 packaged 0.3.2，未替換為本輪新 build |
| GraspPortable/dist/ | 本輪含 Explorer patch 的 build，未重新封裝；不要拿舊 package 驗新 patch |
| Acceptance/MainVault-Source/ | 唯讀原 snapshot |
| Acceptance/MainVault-Grasp-v0.3/ | 保留原 Acceptance，publication DB53/public53 成功 |
| Scratch/Chat-Handoff-20260928-1818/Workspace/ | 完整獨立副本；launcher-first host 最後11:34UTC仍在，收尾未重新檢查 |
| Scratch/Chat-Handoff-20260928-1818/Start-Grasp-E1.cmd | 已實際雙擊的測試入口；既有 launch.mjs、新 dist、port43862、Scratch DB |
| Scratch/Chat-Handoff-20260928-1818/Evidence/e1-launcher-20260928.md | 私人原始觀察轉錄與完整本機 locator；不進 Git |
| Scratch/UI-Repair-20260928-0423/Workspace/ | 先前副本，DB92/public89 EPERM 的歷史目標，不取代原 Acceptance |
| Scratch/UI-Repair-20260928-0423/Evidence/ | 舊 full-corpus browser/private 證據 |
| Scratch/UI-Repair-Deployment/ | 完整更新前備份、舊原路徑 Win32/EPERM private 證據 |

下一段授權驗證沿 `Start-Grasp-E1.cmd` 與既有 launcher 邏輯啟動，不手動開 Chrome 新 tab 或用 API 成功替代 GUI。先確認 port 身分，不能沿用舊 PID；本輪不重新啟動或操作。

## 保存與額度

本輪收尾只改交接文件，不改產品 source/tests/config/Seed/Plan，也不重跑既有測試。包含本文的最終 SHA 由 Git history 與最終回覆提供，避免自指 commit。push 和遠端核對須實際成功才宣稱發布。

[Usage log](USAGE-LOG.md) 分列舊窗口與已確認的使用者重置後窗口；帳戶觀測不是單任務精確計費。未派子代理、未使用Reserve或代理操作reset。達成本輪重置／預算與Git交付條件後結束的是**可恢復交接工作段**，不是全部桌面驗收；E1/E3仍待外部Windows證據。更早環境診斷見Git中 `8813e75:docs/EXECUTION-STATE.md`，不再重啟為前置任務。
