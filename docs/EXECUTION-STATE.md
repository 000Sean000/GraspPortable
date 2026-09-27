# Current Working State — GraspPortable

更新：2026-09-28。**使用者重置額度後已恢復執行，完整 A+B Goal 未完成。這是 current Working State 的唯一入口。** 新 thread 先讀此頁及下列 locator；不需要原對話、provider memory 或本機未提交檔案才能理解目標及續作。

## 1. Current objective、WHY 與範圍

當前交付是 **正式產品 Goal，完整 A+B，依 M1–M4 自主推進**。使用者於 2026-09-27 明確授權 coding、驗證及每個 coherent milestone 的 commit／push；M1 通過後直接接續 M2–M4，不設例行人工批准。前次 docs-only publication 已在 `6bb2024959d39dc0753e3b0baac6d25cdd45d244` 完成並確認遠端。

本次完整產品 Goal 是兩條配套流程：**A 共享 Identifier／Value 一致編輯**；**B MainVault 副本確定性匯入 → 審查保存分組策略 → 可讀 Markdown → 完整 fallback 重建**。WHY 是自然筆記、可追溯的共享資料與低管理負擔；獨立 DB identities 不必各占一個 Markdown 檔案。日用 Obsidian Vault 尚未切換 authority，Grasp 使用副本。

先完成 M1 語義／往返 gate 再接 M2–M4；不以 codec 或第一個小實驗替代完整產品目標。普通實作問題自行修正，只有需要改變已接受語義、重大產品行為或未裁定資料權限時才交回 Human。

**授權狀態明示**：最新使用者直接要求「現在開始 Goal」完成兩條完整流程，取代前次 docs-only 停點；可以修改產品、tests 及必要設定。各契約記述的 publication-only 授權是歷史背景，不是本次限制。仍待裁定的資料含義／來源政策不因此自動定案。

## 2. Read order 與 authority

| 順序 | Locator | 角色／狀態 |
| --- | --- | --- |
| 1 | [Project Seed 入口](Project_Seed/README.md) | 現行路由；Core Requirements rc.3 ＋ Core Development Method rc.3，WHY／方法 authority |
| 2 | [完整 Goal Plan](GOAL-PLAN.md) | A+B 範圍、技術責任、M1–M4、驗收、Git preflight |
| 3 | [Binding／Reference contract](BINDING-EDITING-CONTRACT.md) | Parsing、serialization、raw literal、multiline、editor、generative invariants |
| 4 | [Shared-value contract](SHARED-VALUE-CONTRACT.md) | Shared commands、draft、persistent cache、transaction／external review、M2 |
| 5 | [Projection contract](PROJECTION-CONTRACT.md) | Semantic units、strategy schema、export／checkpoint／rebuild、M3 |
| 6 | [Reference host gate evidence](REFERENCE-HOST-GATE.md) | 已知 AST 限制、最新 Human 裁定及 M1 待驗矩陣 |
| 7 | [Implementation contract](IMPLEMENTATION-CONTRACT.md)、[Limitations](LIMITATIONS.md) | v0.2 實作事實基線，不是新規格完成證據 |
| 8 | [Verification](VERIFICATION.md)、[Phase 2 evidence](PHASE2-VERIFICATION.md)、[Files performance](FILES-PERFORMANCE.md)、[Migration](MIGRATION.md)、[Usage log](USAGE-LOG.md) | 歷史測試、效能、資料邊界及 quota；按報告版本解讀 |

設計背景三份候選稿已在 Git： [Definition rc.2](Design-References/Legacy-Grasp-Syntax/Markdown_Extension_Definition-v1.0.0-rc.2.md)、[Reference Syntax rc.2](Design-References/Legacy-Grasp-Syntax/Reference_Syntax-v1.0.0-rc.2.md)、[Config rc.1](Design-References/Legacy-Grasp-Syntax/Markdown_Extension_Config-v1.0.0-rc.1.md)。Seed 入口提及「當時遠端未含」是其原始編輯背景；當前實際 tracked files 為準。Pending／carried-forward 不升格成默認政策；被 rc.3／下列決策取代的舊 `@code`、grouped reference、single-line、RHS／更新政策不沿用。

## 3. Settled decisions

- Note-first；binding 自由放置，無 mandatory section/container。Raw literal＋identifier 取值＋`+` composition；真正 fenced code 不作 binding 執行。
- 正文維持 `[value](:ref:Identifier)` 與 `[[@Identifier|value]]`；完整 cached value、identity、composition、dependency、raw source 角色分開。
- **最新 Human 裁定**：「link只是視覺考量，優先確保語意結構正確，link的視覺隱藏不用強求」。不再要求 native Markdown AST 必須保留 outer Link，也不再詢問同一視覺取捨。標記可見可接受；資料、正文邊界與重建仍須正確。不得自行新增第三種 managed form。
- 完整 expression 遇 EOL/EOF 或下一 binding 結束；`=`／行尾 `+` 允許續行；同行接 prose 用 `;`。`@Name = First Last` 報錯；下一行 Markdown `+ item` 不接入前一個完整 binding。
- 共享 UI 操作指向 definition，連同受影響 nested results、persistent caches 一致提交；展開文字不能唯一反推時引導編輯 literal／dependency。外部檔案經 Review／Import，無 silent bidirectional sync。
- Projection member 不限制整篇 Note／Record：stable Binding／Entity identity 可獨立分組。保留 owner／source lineage／原 binding placement；同一 canonical binding 不重複配置、不合併 identities。普通正文以 Note identity 分組。
- DB 唯一 runtime authority；單一 Human-readable projection 共用於 fallback、inspection、AI。按需匯出與完整 checkpoint 共用 exporter；輸出形式可轉換且保留重建資訊，link 隱藏不構成強制轉換理由。

Supplemental 中的 lexical 細節、schema、10 分鐘／兩代 checkpoint、效能預算標為**工程推薦／待 M1–M4 驗證**，不是已測試結果或已默認裁定所有政策。

## 4. Actual implementation and evidence

M1 codecs/context/exact source reconstruction：361tests/build，已發布 `480f073b69fb7e79dd6d7bcd86c29dcfa243c834`，見 [M1](M1-VERIFICATION.md)。M2 shared commands/drafts/cache/undo/source rebase/Reading：436tests／32productionE2E，已發布 `9734f06e50ad1ad491104595a0e469263a73f31b`，見 [M2](M2-VERIFICATION.md)。

M3 semantic-unit strategy/scoped planning/review/partial+full renderer/DB-trusted external import/單一publisher/兩代recovery/freshDB重建/App UI 已完成。Schema5保存策略與可信baseline；fullfallback保留source/owner/IDs/dependencies/strategy/provenance/drafts，附件逐項讀取，不承諾完整operation history。**38files／512tests pass（9.19s）、build pass、36productionEdgeE2E pass（1.3m）**，見 [M3](M3-VERIFICATION.md)。

本段也完成M4 streaming/resumable migration基礎及獨立私密corpus verifier，14migrationtests通過；完整MainVault實際往返仍未跑。現有Acceptance/MainVault-Grasp仍是160-note rehearsal。10k identifiers／50k occurrences正測量；失敗及修正證據保留，不把1k/5k結果冒稱10k/50k。

## 5. Current point and remaining work

**M3整合通過，正在保存checkpoint；接續M4，完整A+B Goal尚未完成。** Milestone subject為 `feat: add semantic projection strategy and portable recovery`；從 `git log -1 --format='%H %s' -- docs/EXECUTION-STATE.md` 取得實際checkpoint，另核對origin/master；不預填文件自身SHA。

M4需完成全MainVault副本inventory/import/strategy/controlled return/fallback/rebuild/re-edit/restart、大型互動性能、新package／驗收workspace／launch note，以及最終成品browser驗收。私人資料只在repo外，原MainVault／MainVault-Source唯讀。

Human已接受durable drafts＋保留已提交值、完整missing/cycle保存且報錯、獨立共享undo；已實作，不再待批准。外部rendered/cache observation未取得共享寫入權限；不可唯一反推composition時編輯canonical literal/dependency。

Computer Use skill已讀，但目前沒有其需要的node_repl／Computer Use callable tool。Playwright實際production browser操作可用；Obsidian／Explorer／原生Windows IME／真實zoom缺當次desktop證據。API/mock/spawn不替代画面，依環境fallback授權完成其他工作並明列缺口。

## 6. Exact next executable steps

1. M3 commit/push並確認遠端。下一milestone前fetch；保留本機工作，不reset/history rewrite。
2. 新build執行 GRASP_PERF_SCALE=10 的 tests/e2e/shared-performance.spec.ts；保存全部samples，若測出問題依profile修正重測。真正performance run不與全corpus同時執行。
3. 執行 node --import tsx scripts/verify-portable-roundtrip.ts --source=<SandboxRoot>/Acceptance/MainVault-Source --output=<SandboxRoot>/Scratch/<新目錄>。Output必須不存在；只在Scratch獨立副本寫入。只有aggregate-results.json可整理進Git；私人locations/inventory/reports不可提交。
4. 成功後copy關閉且一致的Imported到新的Acceptance路徑，保留舊rehearsal，hash核對，更新README/launcher。若交付Rebuilt，先發布最後共享修改的最新checkpoint。
5. 發布v0.3、package啟動／實際DB核對／browser驗收；記錄desktop缺口，最後M4 checkpoint/push。

## 7. Repository, local data and quota

SandboxRoot：C:\Users\ASUS\MyData\AgentWorkspace\All-of-Me\GraspProject\GraspPortableWorkspace；repo為其中GraspPortable。舊cwd ...\GraspProject\GraspPortable 已移走，命令必須指定實際workdir。異機先git rev-parse --show-toplevel。

Branch master→origin/master；remote https://github.com/000Sean000/GraspPortable.git 。本次M3前fetch成功，HEAD/origin同9734f06、0/0；提交前再次fetch仍0/0。需要时可單次加入 -c safe.directory=<actualrepo> -c http.sslBackend=openssl，不改全域config。只stage本段source/tests/docs；私人資料/dist/node_modules不入Git。

Acceptance/MainVault-Source與原MainVault唯讀；Acceptance/MainVault-Grasp/.grasp/workspace.grasp.db及Markdown為舊rehearsal。測試位於Scratch。原啟動入口Sandbox/開啟 MainVault 驗收.cmd及README-驗收.md尚待M4更新；一般repo npm ci、npm run build、npm start需Node24+。異機缺私人資料是預期，不得因此聲稱全量驗證。

最新quota 2026-09-27 17:39UTC：**55%used、ordinaryUsageAllowed=true**，正常10080分鐘窗口/reset1791128122，M2的31%至此+24pp約49分鐘，帳戶觀測非任務帳單。歷史前窗口100%已依規則停工，使用者重置後恢復；未用Luna/Reserve/agent reset。詳見 [Usage log](USAGE-LOG.md)。達100%或只剩Luna/Reserve時停止實質工作，只安全保存coherent checkpoint，未完成就標因額度停止。

已授權每個coherent milestone commit/push。不因普通實作問題新增Human gate。Temporary network失敗保留commit/待push，credential/protection/conflict/history risk停Git mutation不繞過。Native新executable的application approval與舊Notepad確認分開。
