# Current Working State — GraspPortable

更新：2026-09-28。當前工作段：架構核對、既有 Explorer 修正驗證、Chat 單題交接。環境已恢复，舊 Computer Use 缺失及原 Acceptance publication EPERM 均屬歷史，不再作開工前置任務。

## 授權、基底與停點

使用者已明確取代 smoke-test 唯讀限制，授權同步、局部修復、測試、更新文件與 commit/push。本輪完成一個 coherent segment 後停止，不為清空索引繼續開發。只有產品語義、資料權限或重大流程改變才回交 Human。

適用上層 SandboxRoot/AGENTS.md。Authority：[Seed](Project_Seed/README.md) 的 Requirements/Development Method rc.3、[已接受 Plan](GOAL-PLAN.md)、[Binding](BINDING-EDITING-CONTRACT.md)、[Shared](SHARED-VALUE-CONTRACT.md)、[Projection](PROJECTION-CONTRACT.md)。SQLite runtime authority、stable identities、原子共享操作、獨立 shared undo、可恢復未完成草稿、dirty 不覆寫等契約不變。MainVault/Source 唯讀；會寫資料的測試只用完整 Scratch 副本。

本機原基底 `9eeabc48a884d1bfc63250f5c3ce1f07422fe881`，工作樹乾淨；fetch 後安全 fast-forward 到 `8813e755d8ae879c9096fc02aaf713704b86fc3f`，master → origin/master。遠端既有修正 `bd1b9a0`、測試 `11820b7` 已納入，不重新實作。先前兩次自動核准拒絕已因本輪明確授權解除；未繞過審查。

## 架構核對

以 [ARCHITECTURE](../ARCHITECTURE.md) 與 [IMPLEMENTATION-CONTRACT](IMPLEMENTATION-CONTRACT.md) 為主，對照 `8813e75` source。核對範圍限交接所需，不宣稱全庫 correctness audit：

- [main.ts](../src/app/main.ts) 的 toolbar/navigation → ordered draft flush → beginFileAction/activity → locate → workspace guard → reveal → toast。file work 不占 editor mutation queue。
- [API client](../src/app/api.ts) 的取消與 timeout、[ProjectionPanel](../src/app/projection-panel.ts) 的 show/run/destroy、[FilesPanel](../src/app/files-panel.ts) 的 callbacks 與 view-owned reads。
- [HTTP host](../server/api.ts) 的 workspace/path validation 與平台 command；spawn event 只代表啟動，不等於 Explorer 選中。
- [ProjectionWorkspaceFiles](../server/projection.ts) inspect 等待 active publication，再 initialize/dirty/catalog；publish 先建立並驗證 recovery/stage、journal，再 [GenerationTree.move](../server/projection-generation.ts) cutover；[SafeTree](../server/files.ts) 保持 confinement/handle close。
- SharedCommand、SourceEditProof、schema 5、EditorAdapter/RuntimeClient 的公開宣告與責任分界和文件一致；未修改資料契約。

未发现需要改寫架構文件的實質落差，故不新增另一份架構文件。任務依驗證負擔分類；Explorer patch 很小，仍需 Windows native 驗證。

## 本輪結果與證據

- 既有 Explorer 修正：Windows 單一 `/select,<path>` argument，macOS/Linux 保持原行為。本輪沒有新增產品 code。
- `npx vitest run tests/api.test.ts tests/files-api.test.ts`：2 files / 20 tests PASS（2.62s）。
- `npm run build`：PASS，build `874a5a4b-3c75-4620-8bb1-0fee988a3346`；Vite 有 >500 kB chunk warning，未當作新功能擴張。
- `npx playwright test tests/e2e/files.spec.ts tests/e2e/ui-responsiveness.spec.ts --reporter=line`：10 PASS（10.2s）。Explorer fixture 明確不用真實 Explorer；不代替 native selection。
- 原 Acceptance 成功證據有效。本輪只讀 manifest 確認 revision53、3331 files、createdAt `2026-09-28T06:58:32.936Z`、fingerprint `a97194cce889bc371d1346a064cf7cebbab74637989f243cc1a81d58b277dfe8`；未重新發布或逐檔重算 hash。
- 新完整副本 `Scratch/Chat-Handoff-20260928-1818/Workspace`：robocopy 40016 files、3145 dirs，failed/mismatch=0；DB SHA256 與來源一致。這不聲稱全樹逐檔 hash 驗證。
- 新 host 已核對 build/DB，port43862。Computer Use 成功列窗，但選取 Chrome 並嘗試開新 tab 時安全檢查終止本 turn：`could not determine the current browser URL on Windows with enough confidence to enforce policy`。未繼續 GUI 輸入，也未改用其他工具繞過；此輪沒有新版 native Explorer 成功證據。host 已停止，listener 查詢為空。
- 完整 corpus browser 歷史證據 [ui-repair-full-corpus.json](benchmarks/ui-repair-full-corpus.json) 每步有各自 buildId，涵蓋搜尋/三模式/reference/shared/undo/策略/Files/草稿。最終 0.3.2 541 tests/45 E2E 屬此前 build `4102f62d-bfca-4a69-90d5-3c7027963cdc`，不能冒稱它們全部已針對新 build 重跑。

## 交接入口與精確下一步

[Task Index：Chat 單題接手](UI-REPAIR-VERIFICATION.md#chat-單題接手) 是唯一當前索引。建議先接 **E1 Explorer 已修待驗**：在允許取得 browser URL 的 Computer Use session，以本輪新 build 與新 Scratch 副本點「顯示筆記檔」，觀察父資料夾與選中 Markdown。若仍失敗，沿同一 request 查 handler/queue/API/state/native 結果，不重做 command helper。

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
| Scratch/Chat-Handoff-20260928-1818/Workspace/ | 本輪新完整獨立副本；測試 host 已停止 |
| Scratch/UI-Repair-20260928-0423/Workspace/ | 先前副本，DB92/public89 EPERM 的歷史目標，不取代原 Acceptance |
| Scratch/UI-Repair-20260928-0423/Evidence/ | 舊 full-corpus browser/private 證據 |
| Scratch/UI-Repair-Deployment/ | 完整更新前備份、舊原路徑 Win32/EPERM private 證據 |

若需啟動新 Scratch host，在 repo cwd 設 PORT=43862，GRASP_WORKSPACE 指向本輪副本的 .grasp/workspace.grasp.db，再執行 `node dist/server.mjs`；先確認 port 身分，不能沿用舊 PID。host 開啟成功不等於 GUI。

## 保存與額度

本輪測試/架構/交接文件納入同一 docs checkpoint；包含本文的最終 SHA 由 Git history 與最終回覆提供，避免自指 commit。push 和遠端核對須實際成功才宣稱發布。

[Usage log](USAGE-LOG.md)：本輪正常 bucket 95%→97%，同10080分鐘/reset1791128122窗口；屬帳戶觀測，不是任務精確計費。未派子代理、未使用 Reserve/reset；本輪在 coherent handoff 發布後停止，native GUI 缺口如上，並非宣稱全部驗收完成。更早環境診斷詳情見 Git 中 `8813e75:docs/EXECUTION-STATE.md`，不再重啟為前置任務。
